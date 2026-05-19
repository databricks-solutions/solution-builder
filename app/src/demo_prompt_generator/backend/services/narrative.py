"""LLM-generated project narrative — the 1-2 paragraph storytelling pitch
shown in the Overview hero.

Generation happens in two places that share this module:
  - The `/projects/{id}/narrative/generate` route (manual "Regenerate" button).
  - The file watcher's debounced flush (auto-regen when README.md changes).

Both call `regenerate_narrative_if_stale` (or `generate_narrative` for the
forced/manual path), which handles README extraction, content-hash dedup,
LLM call, and DB persist. Returns the updated narrative + hash or None.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from sqlmodel import Session, select

from ..core._config import AppConfig
from ..models import Project
from .llm_service import LLMService, ModelSize
from .skills_manager import PROJECTS_BASE_DIR

if TYPE_CHECKING:
    from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

# Per-project locks prevent concurrent regen tasks (file watcher fires
# rapidly during agent streaming; we don't want two LLM calls racing on
# the same project row).
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(project_id: str) -> asyncio.Lock:
    lock = _locks.get(project_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[project_id] = lock
    return lock


# ---------------------------------------------------------------------------
# README helpers
# ---------------------------------------------------------------------------

def readme_hash(markdown: str) -> str:
    """Stable hash used to detect when the narrative is out-of-date."""
    return hashlib.sha256(markdown.strip().encode("utf-8")).hexdigest()


def read_project_readme(project_id: str) -> Optional[str]:
    """Read the project's README.md from disk. Returns None if missing/empty."""
    readme = Path(PROJECTS_BASE_DIR) / project_id / "README.md"
    if not readme.is_file():
        return None
    try:
        text_ = readme.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to read README for project {project_id}: {e}")
        return None
    text_ = text_.strip()
    return text_ or None


def strip_frontmatter(markdown: str) -> str:
    """Drop a leading `---` YAML frontmatter block before sending to the LLM."""
    if not markdown.startswith("---"):
        return markdown
    lines = markdown.split("\n")
    if lines[0].strip() != "---":
        return markdown
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[i + 1:]).lstrip("\n")
    return markdown


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You write the elevator pitch for a Databricks demo. The reader is "
    "an account executive, a seller, or the customer themselves — they "
    "want to know in 10 seconds what this demo is about and why it "
    "matters.\n"
    "\n"
    "Voice: write like you're telling a friend at a bar what you've "
    "been building. Conversational, specific, human. Lead with the "
    "PERSONA (who is this for? what's their job?) and the USE CASE "
    "(what problem are they trying to solve, with real stakes/numbers "
    "when the README gives them). Then a second short paragraph on "
    "what the demo lets them do or see — still in plain English.\n"
    "\n"
    "Hard rules:\n"
    "  - Exactly 1 or 2 short paragraphs, separated by a blank line.\n"
    "  - 350-700 characters total.\n"
    "  - No headings, no bullet points, no markdown formatting.\n"
    "  - No marketing words: never use 'leverage', 'showcase', 'unlock', "
    "'empower', 'end-to-end', 'seamlessly', 'solution', 'unify'.\n"
    "  - No 'This demo...' opener. Start with the persona or the problem.\n"
    "  - Stay strictly grounded in the README — do not invent capabilities, "
    "personas, dollar figures, or industries that aren't there.\n"
    "\n"
    "Reply with ONLY the narrative text. No preamble, no labels, no quotes."
)


class NarrativeError(Exception):
    """Raised when narrative generation hits a recoverable error (missing
    README, empty LLM response, LLM exception). Callers decide whether to
    surface it (route handler → HTTP 4xx/5xx) or swallow it (watcher task)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code  # e.g. "no_readme", "empty", "llm_error"


def generate_narrative(
    project_id: str,
    project: Project,
    session: Session,
    ws: "WorkspaceClient",
    config: AppConfig,
) -> tuple[str, str]:
    """Generate (or regenerate) the narrative for a project and persist it.

    Unconditional — call this when the user clicks Regenerate. For the
    background watcher path use `regenerate_narrative_if_stale` which
    skips when the hash matches.

    Returns (narrative, readme_hash).
    Raises NarrativeError on missing README / empty result / LLM failure.
    """
    readme = read_project_readme(project_id)
    if not readme:
        raise NarrativeError(
            "no_readme",
            "No README.md yet — ask the assistant to draft the demo story first.",
        )

    body = strip_frontmatter(readme)
    if len(body) > 6000:
        body = body[:6000]

    user_prompt = (
        f"Project name: {project.name}\n\n"
        f"README:\n{body}\n\n"
        "Write the narrative now."
    )

    try:
        narrative = LLMService(ws, config).chat(
            user_prompt,
            size=ModelSize.MINI,
            system_prompt=_SYSTEM_PROMPT,
            max_tokens=900,
        )
    except Exception as e:
        logger.error(f"Narrative generation failed for project {project_id}: {e}")
        raise NarrativeError("llm_error", "Narrative generation failed") from e

    narrative = (narrative or "").strip().strip('"').strip("'").strip()
    if not narrative:
        raise NarrativeError("empty", "LLM returned an empty narrative")

    hash_ = readme_hash(readme)
    project.narrative = narrative
    project.narrative_readme_hash = hash_
    session.add(project)
    session.commit()
    session.refresh(project)
    return narrative, hash_


async def regenerate_narrative_if_stale(
    project_id: str,
    session_factory,
    ws: "WorkspaceClient",
    config: AppConfig,
) -> Optional[tuple[str, str]]:
    """Auto-regen path called by the file watcher.

    Checks the README hash against `project.narrative_readme_hash` and
    skips the LLM call when they match (dedup). Holds a per-project lock
    so rapid README writes during agent streaming don't race.

    `session_factory` is a callable returning a fresh SQLModel Session
    (the watcher's caller hands us its DI factory). Synchronous DB work
    runs inside the lock; the LLM call itself is also synchronous (the
    LLMService is sync today) — we accept that this blocks the asyncio
    loop briefly. If it becomes a hot path, move the LLM call to
    `loop.run_in_executor`.

    Returns (narrative, hash) on a fresh generation, None when skipped
    (already up to date, no README, or LLM error).
    """
    lock = _lock_for(project_id)
    if lock.locked():
        # Another regen task is in flight — let it finish. If the README
        # changes again, the next debounce cycle will re-fire and find
        # the hash still stale.
        logger.debug(f"[narrative] {project_id}: regen already in flight, skipping")
        return None

    async with lock:
        readme = read_project_readme(project_id)
        if not readme:
            return None
        hash_ = readme_hash(readme)

        # DB lookup + maybe-write happen in a sync section. We don't await
        # anything else inside the lock except the LLM call.
        with session_factory() as session:
            project = session.exec(
                select(Project).where(Project.id == project_id)
            ).one_or_none()
            if project is None:
                return None
            if project.narrative_readme_hash == hash_ and project.narrative:
                logger.debug(f"[narrative] {project_id}: hash unchanged, skipping")
                return None

            try:
                return generate_narrative(project_id, project, session, ws, config)
            except NarrativeError as e:
                logger.info(
                    f"[narrative] {project_id}: skipped ({e.code}: {e})"
                )
                return None
            except Exception as e:
                logger.warning(
                    f"[narrative] {project_id}: unexpected error: {e}",
                    exc_info=True,
                )
                return None
