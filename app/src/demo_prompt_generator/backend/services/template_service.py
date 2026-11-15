"""
Template Service for template library feature.

Handles:
- Template submission from projects
- Semantic search using pgvector
- Creating projects from templates
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select, text

from ..models import (
    Project,
    ProjectFile,
    Template,
    TemplateContent,
    TemplateStatus,
    TemplateType,
    generate_uuid,
    resource_suffix,
    utc_now,
)
from .file_sync import compress_content, decompress_content, compute_file_hash
from .live_demo import sync_seed_live_demo
from ..core.constants import INDUSTRIES, get_capabilities
from .llm_service import LLMService, ModelSize

logger = logging.getLogger(__name__)

PROJECTS_BASE_DIR = os.getenv("PROJECTS_BASE_DIR", "./projects")

# Process-level cache for the template-search LLM re-rank: normalized query text
# → ordered list of template ids (best first). Bounded in _llm_rerank. Keyed by
# query only (the candidate SET for a given query is stable enough for a demo
# gallery); insertion order = eviction order (drop oldest when full).
_RERANK_CACHE: dict[str, list[str]] = {}


def fork_mode_for(template_type: str) -> str:
    """The project mode a fork of this template opens in: a Genie Code workshop
    stays in workshop mode (tabs, kit, the system prompt's flow B), an
    architecture template stays architecture-only. The reverse of publish's
    mode_to_type."""
    return {
        TemplateType.GENIE_WORKSHOP.value: "workshop",
        TemplateType.ARCHITECTURE.value: "architecture",
    }.get(template_type, "story")


def _extract_id_list(raw: str) -> list[str] | None:
    """Parse a JSON array of id strings out of an LLM reply (tolerating code
    fences / stray prose). Returns the list, or None if nothing parseable."""
    if not raw:
        return None
    text_ = raw.strip()
    # Grab the first [...] block so surrounding prose/fences don't break parsing.
    start = text_.find("[")
    end = text_.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        val = json.loads(text_[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(val, list):
        return None
    ids = [str(x) for x in val if isinstance(x, (str, int))]
    return ids or None

def _should_include_in_template(relative_path: str) -> bool:
    """A template carries the whole demo a fork can deploy — narrative (README,
    specs), the deployable assets (data-gen, dashboard/genie JSON, DAB, app
    source), everything. It does NOT carry build artifacts, dependencies,
    local/deploy state, or heavy binaries — those are regenerated per fork.

    Exclude-list (reject junk, keep the rest). A path is excluded if any of its
    directory segments is a known-junk dir, or its basename/extension is junk."""
    parts = Path(relative_path).parts
    name = parts[-1] if parts else relative_path

    # Junk directories (dependencies, virtualenvs, build outputs, agent state,
    # local deploy state, caches, test outputs).
    JUNK_DIRS = {
        ".claude", "node_modules", ".venv", "venv", "__pycache__", ".databricks",
        "dist", "build", ".git", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        "test-results", "playwright-report", "raw_data", ".turbo", ".next",
    }
    if any(seg in JUNK_DIRS for seg in parts):
        return False
    # The project's POV deck (stages/pov-deck.md) is built from its own story and
    # links, so a fork builds its own. Only the top-level folder: an app may have
    # its own deck/ source.
    if parts and parts[0] == "deck":
        return False

    # Junk basenames (local env, deploy-state markers, OS cruft). NOTE: lockfiles
    # (package-lock.json, uv.lock, …) are KEPT — the DAB/app needs them at deploy
    # time (a missing app lockfile crashes the Apps container with ERR_MODULE_NOT_FOUND).
    # `template_screenshot.png` is excluded here: it's loaded into the Template's
    # `screenshot` binary column (not shipped as a fork file).
    JUNK_NAMES = {
        ".env", ".ds_store", ".preview.pgid", ".preview.server.pid",
        "app.yaml.template", "template_screenshot.png",
        # Seed-only per-folder metadata — read by the seeder, never shipped as a
        # fork file (a real generated project has no manifest.json).
        "manifest.json",
    }
    if name.lower() in JUNK_NAMES:
        return False
    if name.startswith(".env."):
        return False
    # Extra gallery screenshots (template_screenshot_1.png, _2.png, …) are
    # gallery-only like the hero — loaded into the template_screenshots table,
    # never shipped as fork files.
    if re.fullmatch(r"template_screenshot_\d+\.png", name.lower()):
        return False

    # Junk extensions (compiled/binary/archive artifacts).
    JUNK_EXTS = {
        ".pyc", ".pyo", ".so", ".o", ".class", ".log", ".tmp", ".zip",
        ".tar", ".gz", ".tgz", ".whl", ".map",
    }
    if any(name.lower().endswith(ext) for ext in JUNK_EXTS):
        return False

    return True


def _capabilities_from_resources_json(resources_json_text: str) -> list[str]:
    """The project's REAL capability selection, flattened from its resources.json
    `capabilities.{buildable, talking_track}` (buildable first, then talking_track,
    deduped, order preserved). This is the source of truth — far better than
    LLM-guessing the capabilities from the README. Returns [] on parse failure or
    when the block is absent (caller falls back to the LLM extraction)."""
    try:
        caps = json.loads(resources_json_text).get("capabilities")
    except (json.JSONDecodeError, AttributeError, ValueError):
        return []
    if not isinstance(caps, dict):
        return list(caps) if isinstance(caps, list) else []
    out: list[str] = []
    seen: set[str] = set()
    for group in ("buildable", "talking_track"):
        for c in caps.get(group, []) or []:
            if c not in seen:
                seen.add(c)
                out.append(c)
    return out


def _clear_created_resources(resources_json_bytes: bytes, resource_suffix: str | None = None) -> bytes:
    """Return a resources.json with `created_resources` emptied but `capabilities`
    (and any other keys) preserved. Used when forking a template into a new project
    so the fork inherits the capability selection but points at NO live Databricks
    objects (the template's stored IDs are the author's workspace — dead links +
    false "built" status otherwise). Mirrors projects._fresh_resources_from /
    clone_project.

    `resource_suffix` (the NEW project's short id) overwrites any inherited
    `resource_suffix` so the fork stamps its OWN suffix on the resources it builds —
    the whole point of the isolation fix (two forks of one template must not share
    a suffix). Dropped from the file if not provided. On parse failure, returns the
    bytes unchanged."""
    try:
        data = json.loads(resources_json_bytes.decode("utf-8"))
        if isinstance(data, dict):
            data["created_resources"] = {}
            if resource_suffix:
                data["resource_suffix"] = resource_suffix
            else:
                data.pop("resource_suffix", None)
            return json.dumps(data, indent=2).encode("utf-8")
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        pass
    return resources_json_bytes


# dbdemos usage-tracker app id, as written in a template app (server/lib/tracker.ts):
# `"dbdemosAppId": "${DBDEMOS_APP_ID:<id>}"` in app/config/app.json, or a
# `- name: DBDEMOS_APP_ID / value: <id>` env entry in databricks.yml.
_TRACKER_ID_JSON = re.compile(r'("dbdemosAppId"\s*:\s*"\$\{DBDEMOS_APP_ID:)([^}"]*)(\}")')
_TRACKER_ID_YAML = re.compile(r"(-\s*name:\s*DBDEMOS_APP_ID\s*\n\s*value:\s*)([^\s#]+)")


def _unique_tracker_app_id(text: str, resource_suffix: str) -> str:
    """Make a forked app report its OWN tracker app id: `<template-id>` →
    `<template-id>-<resource_suffix>`, so two forks of one template (or the template
    itself) never aggregate as one app. Empty ids (tracking off) stay empty;
    idempotent (an id already ending in the suffix is left alone)."""

    def _suffix(m: re.Match) -> str:
        app_id = m.group(2)
        if not app_id or app_id.endswith(f"-{resource_suffix}"):
            return m.group(0)
        return m.group(1) + f"{app_id}-{resource_suffix}" + (m.group(3) if m.lastindex == 3 else "")

    return _TRACKER_ID_YAML.sub(_suffix, _TRACKER_ID_JSON.sub(_suffix, text))


def _upsert_template_content(
    session: Session,
    template_id: str,
    files: list[tuple[str, bytes, str, int]],
) -> dict[str, int]:
    """Sync a template's stored files to exactly `files`, touching only changes.

    `files` = list of (relative_path, content_compressed, content_hash, file_size).
    Compares against existing TemplateContent rows by content_hash:
      - unchanged (same hash) → left in place (row id preserved)
      - changed (path exists, different hash) → content updated
      - new (path absent) → inserted
      - removed (existing path not in `files`) → deleted
    Returns counts {added, changed, unchanged, removed} for logging. The caller
    commits. This replaces the old delete-all-then-reinsert so re-seeds/updates
    are smooth (no churn on unchanged files, no unique-constraint dance)."""
    existing = {
        tc.relative_path: tc
        for tc in session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all()
    }
    incoming_paths = {f[0] for f in files}
    added = changed = unchanged = removed = 0

    for rel_path, compressed, content_hash, file_size in files:
        row = existing.get(rel_path)
        if row is None:
            session.add(TemplateContent(
                template_id=template_id,
                relative_path=rel_path,
                content_compressed=compressed,
                content_hash=content_hash,
                file_size=file_size,
            ))
            added += 1
        elif row.content_hash != content_hash:
            row.content_compressed = compressed
            row.content_hash = content_hash
            row.file_size = file_size
            session.add(row)
            changed += 1
        else:
            unchanged += 1

    for rel_path, row in existing.items():
        if rel_path not in incoming_paths:
            session.delete(row)
            removed += 1

    return {"added": added, "changed": changed, "unchanged": unchanged, "removed": removed}


def _embedding_text(
    *,
    name: str | None = None,
    industry: str | None = None,
    narrative: str | None = None,
    description: str | None = None,
    readme: str | None = None,
) -> str:
    """Combined text indexed for semantic search.

    We embed the title, industry, narrative, short description AND the README —
    not the README alone — so a query about a template's name/industry/story
    matches, not only its body prose. Parts are newline-joined; empties skipped.
    The README is truncated so one long doc doesn't dominate the vector.
    """
    parts = [
        name,
        industry,
        narrative,
        description,
        (readme or "")[:8000] or None,
    ]
    return "\n\n".join(p.strip() for p in parts if p and p.strip())


# Recent search-query embeddings (LRU). The same few queries repeat (home-page search,
# retries), and each one is a model round-trip. Keyed by the whitespace-normalized query.
_QUERY_EMBED_CACHE_MAX = 256
_query_embed_cache: "OrderedDict[str, list[float]]" = OrderedDict()
_query_embed_lock = threading.Lock()


def _cached_query_embedding(llm: LLMService, query: str) -> list[float]:
    key = " ".join(query.split())
    with _query_embed_lock:
        hit = _query_embed_cache.get(key)
        if hit is not None:
            _query_embed_cache.move_to_end(key)
            return hit
    embedding = llm.get_embedding(query)
    # get_embedding returns the zero vector on failure: never pin that for later searches.
    if any(embedding):
        with _query_embed_lock:
            _query_embed_cache[key] = embedding
            _query_embed_cache.move_to_end(key)
            while len(_query_embed_cache) > _QUERY_EMBED_CACHE_MAX:
                _query_embed_cache.popitem(last=False)
    return embedding


def _store_embedding(session: Session, template_id: str, embedding: list[float]) -> None:
    """Store an embedding vector, gracefully skipping if pgvector is unavailable (PGLite)."""
    # PGLite doesn't support the vector type — skip embedding storage.
    # In Lakebase mode (the default), LAKEBASE_DATABASE_PATH is set.
    if os.environ.get("USE_PGLITE") == "1" or not os.environ.get("LAKEBASE_DATABASE_PATH"):
        logger.debug("Skipping embedding storage (PGLite mode, no pgvector)")
        return
    session.execute(
        text("""
            UPDATE templates
            SET embedding = CAST(:embedding AS vector)
            WHERE id = :template_id
        """),
        {"embedding": str(embedding), "template_id": template_id}
    )


def _summarize_readme(llm: LLMService, readme_content: str) -> dict:
    """Extract metadata (description, capabilities, industry) from README via LLM."""
    import json
    capability_ids = [c["id"] for c in get_capabilities()]
    prompt = f"""Analyze this README and return JSON:
{{
    "description": "1-2 sentence summary",
    "capabilities": ["capability-id-1", "capability-id-2"],
    "industry": "one of the industries listed below"
}}

Available capability IDs: {json.dumps(capability_ids)}
Available industries: {json.dumps(INDUSTRIES)}

README:
{readme_content[:8000]}
"""
    try:
        result = llm.chat_json(prompt, size=ModelSize.MINI)
        result["capabilities"] = [c for c in result.get("capabilities", []) if c in capability_ids]
        if result.get("industry") not in INDUSTRIES:
            result["industry"] = None
        return result
    except Exception as e:
        logger.error(f"Failed to summarize README: {e}")
        return {"description": None, "capabilities": [], "industry": None}


class TemplateService:
    """
    Service for template CRUD operations and semantic search.
    """

    def __init__(self, engine: Engine, llm_service: LLMService):
        self.engine = engine
        self.llm = llm_service

    def submit_template(
        self,
        project_id: str,
        owner_email: str,
        session: Session,
    ) -> Template:
        """
        Submit a project as a template for review.

        1. Copy all project files to template_content
        2. Read README.md and call LLM for summary
        3. Generate embedding from README
        4. Create template entry with REVIEW_REQUESTED status

        Args:
            project_id: Source project UUID
            owner_email: Email of the submitter
            session: Database session

        Returns:
            Created Template object
        """
        # Get the project
        project = session.exec(
            select(Project).where(Project.id == project_id)
        ).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Get project files
        project_files = session.exec(
            select(ProjectFile).where(ProjectFile.project_id == project_id)
        ).all()

        if not project_files:
            raise ValueError(f"Project {project_id} has no files")

        # Find README.md
        readme_content = None
        for f in project_files:
            if f.relative_path.lower() == "readme.md":
                readme_content = decompress_content(f.content_compressed).decode("utf-8")
                break

        # Use project name as fallback if no README
        if not readme_content:
            readme_content = f"# {project.name}\n\n{project.description or ''}"

        # Real capabilities come from the project's own resources.json — the
        # source of truth. Only fall back to the LLM's README guess if that
        # block is missing/empty.
        resources_text = None
        for f in project_files:
            if f.relative_path.lower() == "resources.json":
                resources_text = decompress_content(f.content_compressed).decode("utf-8")
                break
        real_capabilities = (
            _capabilities_from_resources_json(resources_text) if resources_text else []
        )

        # LLM extraction (still used for description + industry, and as the
        # capabilities fallback when resources.json has none).
        extracted = _summarize_readme(self.llm, readme_content)
        capabilities = real_capabilities or extracted.get("capabilities", [])

        # Generate embedding from the COMBINED text (title + industry + narrative
        # + description + README) so search matches more than the README prose.
        embedding = self.llm.get_embedding(
            _embedding_text(
                name=project.name,
                industry=extracted.get("industry"),
                narrative=project.narrative,
                description=extracted.get("description"),
                readme=readme_content,
            )
        )

        # Template kind, derived from the source project's mode: an architecture-only
        # project publishes as ARCHITECTURE, a Genie-Code workshop as GENIE_WORKSHOP,
        # everything else (a normal story-mode demo) as SOLUTION. Workshop TRAINING
        # templates aren't user-published — they're seeded from initial_templates/.
        mode_to_type = {
            "architecture": TemplateType.ARCHITECTURE.value,
            "workshop": TemplateType.GENIE_WORKSHOP.value,
        }
        template_type = mode_to_type.get(project.mode, TemplateType.SOLUTION.value)

        # Create template record
        template_id = generate_uuid()
        template = Template(
            id=template_id,
            name=project.name,
            status=TemplateStatus.REVIEW_REQUESTED.value,
            owner_email=owner_email,
            industry=extracted.get("industry"),
            description=extracted.get("description"),
            # The story summary the project already generated from its README —
            # copied verbatim, never re-generated on the template side.
            narrative=project.narrative,
            full_description=readme_content,
            capabilities=json.dumps(capabilities),
            customer=project.customer,
            template_type=template_type,
            submitted_at=utc_now(),
            source_project_id=project_id,
        )
        session.add(template)

        # Store embedding (gracefully skips on PGLite where pgvector is unavailable)
        _store_embedding(session, template_id, embedding)

        # Bulk copy project files to template_content (skip excluded files).
        # resources.json is scrubbed of `created_resources` first — a template is
        # a reusable blueprint pointing at NO live objects, so the author's real
        # resource IDs (and any app URL) must not ship in the stored/exported
        # files. Capabilities (which the gallery + fork rely on) are preserved.
        template_files = []
        for f in project_files:
            if not _should_include_in_template(f.relative_path):
                continue
            if f.relative_path.lower() == "resources.json":
                scrubbed = _clear_created_resources(decompress_content(f.content_compressed))
                template_files.append(
                    TemplateContent(
                        template_id=template_id,
                        relative_path=f.relative_path,
                        content_compressed=compress_content(scrubbed),
                        content_hash=compute_file_hash(scrubbed),
                        file_size=len(scrubbed),
                    )
                )
            else:
                template_files.append(
                    TemplateContent(
                        template_id=template_id,
                        relative_path=f.relative_path,
                        content_compressed=f.content_compressed,
                        content_hash=f.content_hash,
                        file_size=f.file_size,
                    )
                )
        session.add_all(template_files)
        session.commit()
        session.refresh(template)
        return template

    def search_templates(
        self,
        query: str,
        session: Session,
        limit: int = 3,
        status: str = "APPROVED",
    ) -> list[dict]:
        """
        Search templates: pgvector semantic ranking BLENDED with a lexical
        (ILIKE) match on name / industry / description, so both meaning-level
        queries AND literal title/industry fragments (e.g. "heath" → Healthcare)
        surface. Falls back to lexical-only when pgvector is unavailable (PGLite).

        Args:
            query: Search query text
            session: Database session
            limit: Max number of results
            status: Filter by status (default APPROVED)

        Returns:
            List of template dicts with similarity scores, best first.

        WORKSHOP training templates are always excluded — they surface only via an
        explicit `?type=WORKSHOP` link on the templates page, never in the general
        home-page / gallery search that this method backs.
        """
        # Normalize "unlimited" (callers pass -1 for "all matches"). A raw
        # `LIMIT -1` returns ZERO rows on our engine (not "all"), so map any
        # non-positive limit to a large finite cap before it reaches the SQL.
        if limit <= 0:
            limit = 1000

        # Official (curated/validated) templates get a small ranking bonus so
        # that, among comparable matches, the one we trust surfaces first. It's
        # a FLAT additive nudge — enough to win a near-tie, but small enough that
        # a clearly-stronger community match still outranks a weak official one.
        OFFICIAL_BONUS = 0.06

        def _row_to_dict(r, similarity: float) -> dict:
            official = bool(getattr(r, "official", False))
            return {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "industry": r.industry,
                "capabilities": json.loads(r.capabilities) if r.capabilities else [],
                # Boost official templates; cap at 1.0 so it stays a valid score.
                "similarity": min(1.0, similarity + (OFFICIAL_BONUS if official else 0.0)),
            }

        # Merge helper: keep the highest similarity per id, preserving best-first.
        merged: dict[str, dict] = {}

        def _add(rows, sim_fn):
            for r in rows:
                d = _row_to_dict(r, sim_fn(r))
                prev = merged.get(d["id"])
                if prev is None or d["similarity"] > prev["similarity"]:
                    merged[d["id"]] = d

        # 1) Semantic (pgvector). Best-effort enhancement on top of lexical —
        #    unavailable on PGLite, and a no-op when embeddings aren't populated
        #    (the `embedding IS NOT NULL` filter simply returns no rows). Lexical
        #    (below) always runs regardless, so search never depends on this.
        try:
            query_embedding = _cached_query_embedding(self.llm, query)
            rows = session.execute(
                text("""
                    SELECT
                        id, name, description, industry, capabilities, official,
                        1 - (embedding <=> CAST(:query_embedding AS vector)) AS similarity
                    FROM templates
                    WHERE status = :status
                    AND template_type != 'WORKSHOP'
                    AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:query_embedding AS vector)
                    LIMIT :limit
                """),
                {"query_embedding": str(query_embedding), "status": status, "limit": limit},
            ).fetchall()
            _add(rows, lambda r: float(r.similarity) if r.similarity is not None else 0.0)
        except Exception as e:
            logger.debug(f"pgvector search unavailable, using lexical only: {e}")
            session.rollback()

        # 2) Lexical (ILIKE) — ALWAYS run and BLEND with the semantic hits above
        #    (`merged` keeps the best score per id). This is what the docstring
        #    promises. It used to be fallback-only (`if not semantic_ok`), but the
        #    semantic block sets semantic_ok=True even when it returns ZERO rows —
        #    e.g. when embeddings aren't populated, `embedding IS NOT NULL` matches
        #    nothing and no exception is raised. That silently skipped lexical, so
        #    an obvious literal match like "customer" → "Customer Support" returned
        #    nothing. Running lexical unconditionally guarantees literal
        #    name/industry/description/narrative matches always surface, while
        #    semantic still adds meaning-level matches on top when available.
        try:
            # Tokenize: split on non-alphanumerics, drop stopwords + short/
            # generic words so "for", "the", a brand name, etc. don't match
            # everything.
            _STOPWORDS = {
                "a", "an", "the", "for", "of", "to", "and", "or", "with", "in",
                "on", "my", "our", "we", "use", "using", "build", "builds",
                "building", "solution", "demo", "app", "data", "databricks",
            }
            raw_tokens = re.split(r"[^a-zA-Z0-9]+", query.lower())
            tokens = [t for t in raw_tokens if len(t) >= 3 and t not in _STOPWORDS]
            # De-dupe, cap to keep the SQL bounded.
            seen_tok: set[str] = set()
            tokens = [t for t in tokens if not (t in seen_tok or seen_tok.add(t))][:8]

            # Match the whole phrase broadly (name/industry/description/narrative),
            # but INDIVIDUAL tokens only against high-signal fields (name +
            # industry + description) — matching a lone token against the long
            # narrative would pull in unrelated templates. Score by how many
            # distinct tokens hit, phrase matches weighted highest.
            clauses: list[str] = []
            params: dict[str, object] = {"status": status, "limit": limit}
            score_terms: list[str] = []
            phrase_fields = ("name", "industry", "description", "narrative")
            token_fields = ("name", "industry", "description")
            params["q_phrase"] = query
            phrase_or = " OR ".join(f"{f} ILIKE '%' || :q_phrase || '%'" for f in phrase_fields)
            clauses.append(f"({phrase_or})")
            score_terms.append(
                "(CASE WHEN " + " OR ".join(
                    f"{f} ILIKE '%' || :q_phrase || '%'" for f in phrase_fields
                ) + " THEN 3 ELSE 0 END)"
            )
            for i, tok in enumerate(tokens):
                key = f"q_tok_{i}"
                params[key] = tok
                tok_or = " OR ".join(f"{f} ILIKE '%' || :{key} || '%'" for f in token_fields)
                clauses.append(f"({tok_or})")
                score_terms.append(
                    "(CASE WHEN " + " OR ".join(
                        f"{f} ILIKE '%' || :{key} || '%'" for f in token_fields
                    ) + " THEN 1 ELSE 0 END)"
                )

            where_or = " OR ".join(clauses)
            score_sql = " + ".join(score_terms)
            lex_rows = session.execute(
                text(f"""
                    SELECT id, name, description, industry, capabilities, official,
                           ({score_sql}) AS match_score
                    FROM templates
                    WHERE status = :status AND template_type != 'WORKSHOP' AND ({where_or})
                    ORDER BY match_score DESC
                    LIMIT :limit
                """),
                params,
            ).fetchall()
            # Map the discrete match score → a similarity band. Baseline 0.55 (a
            # solid literal match should be able to out-rank a weak semantic hit)
            # + a small per-match nudge so more-complete matches sort higher.
            max_score = max((int(r.match_score) for r in lex_rows), default=1) or 1
            _add(lex_rows, lambda r: 0.55 + 0.1 * (int(r.match_score) / max_score))
        except Exception as e:
            logger.debug(f"Lexical search failed: {e}")
            session.rollback()

        ranked = sorted(merged.values(), key=lambda d: d["similarity"], reverse=True)

        # LLM re-rank of the TOP candidates. Cosine similarity alone is a poor
        # confidence signal ("health care" legitimately matches the Healthcare
        # template at only ~0.47), so a mini model re-orders the top-N by actual
        # relevance to the query — trusting official templates a bit more — and
        # drops clearly-irrelevant ones. Cached by normalized query (bounded).
        # Best-effort: any failure falls back to the similarity order.
        ranked = self._llm_rerank(query, ranked)

        # `limit` was normalized to a positive cap at the top (never <= 0 here).
        return ranked[:limit]

    # Top-N to re-rank + the in-memory query→ordered-ids cache (bounded).
    _RERANK_TOP_N = 6
    _RERANK_CACHE_MAX = 1000

    def _llm_rerank(self, query: str, ranked: list[dict]) -> list[dict]:
        """Re-order the top `_RERANK_TOP_N` candidates by LLM-judged relevance to
        `query` (official templates weighted up), returning the full list with the
        re-ranked head followed by the untouched tail. Cached per normalized
        query. Never raises — on any issue returns `ranked` unchanged."""
        if len(ranked) < 2:
            return ranked
        qkey = " ".join(query.lower().split())
        if not qkey:
            return ranked

        cache = _RERANK_CACHE
        cached_order = cache.get(qkey)
        head = ranked[: self._RERANK_TOP_N]
        tail = ranked[self._RERANK_TOP_N :]
        by_id = {d["id"]: d for d in head}

        if cached_order is None:
            try:
                cached_order = self._call_rerank_llm(query, head)
            except Exception as e:  # noqa: BLE001 — best-effort; keep similarity order
                logger.debug("template rerank LLM failed: %s", e)
                cached_order = None
            # Cache even a None/failed result briefly? No — only cache a real
            # ordering, so a transient failure can retry next keystroke.
            if cached_order is not None:
                if len(cache) >= self._RERANK_CACHE_MAX:
                    cache.pop(next(iter(cache)))  # drop oldest (FIFO-ish)
                cache[qkey] = cached_order

        if not cached_order:
            return ranked

        # Rebuild head from the LLM order (ids it kept, in its order); append any
        # head ids it dropped (defensive — never lose a candidate), then the tail.
        reordered = [by_id[i] for i in cached_order if i in by_id]
        dropped = [d for d in head if d["id"] not in set(cached_order)]
        return reordered + dropped + tail

    def _call_rerank_llm(self, query: str, candidates: list[dict]) -> list[str] | None:
        """Ask the mini model to re-order candidate ids by relevance. Returns a
        list of ids (best first) or None if the response can't be parsed."""
        lines = []
        for c in candidates:
            official = " [OFFICIAL]" if c.get("official") or False else ""
            desc = (c.get("description") or "").replace("\n", " ")[:300]
            lines.append(f'- id: {c["id"]}{official}\n  name: {c["name"]}\n  about: {desc}')
        catalog = "\n".join(lines)
        system_prompt = (
            "You rank Databricks demo templates for a search box. Given the user's "
            "query and a few candidate templates (name + description), return the "
            "ids ordered from MOST to LEAST relevant to the query. Judge by meaning, "
            "not keyword overlap (e.g. 'health care' matches a 'Healthcare' template). "
            "Templates marked [OFFICIAL] are curated and trusted: strongly prefer "
            "them — when an [OFFICIAL] template is a reasonable match for the query, "
            "rank it above non-official ones, and only place a non-official template "
            "first when it is a clearly better or more specific match. DROP ids that "
            "are clearly irrelevant to the query. Reply with ONLY a JSON array of id "
            'strings, e.g. ["id1","id2"].'
        )
        user_prompt = f'User query: "{query}"\n\nCandidates:\n{catalog}'
        raw = self.llm.chat(
            user_prompt, size=ModelSize.MINI, system_prompt=system_prompt, max_tokens=300
        )
        return _extract_id_list(raw)

    def list_templates(
        self,
        session: Session,
        status: Optional[str] = None,
        industry: Optional[str] = None,
        owner_email: Optional[str] = None,
    ) -> list[Template]:
        """
        List templates with optional filters.

        Args:
            session: Database session
            status: Filter by status
            industry: Filter by industry
            owner_email: Filter by owner

        Returns:
            List of Template objects
        """
        query = select(Template)

        if status:
            query = query.where(Template.status == status)
        if industry:
            query = query.where(Template.industry == industry)
        if owner_email:
            query = query.where(Template.owner_email == owner_email)

        query = query.order_by(Template.submitted_at.desc())

        return list(session.exec(query).all())

    def get_template(self, template_id: str, session: Session) -> Optional[Template]:
        """Get a template by ID."""
        return session.exec(
            select(Template).where(Template.id == template_id)
        ).first()

    def get_template_files(self, template_id: str, session: Session) -> list[TemplateContent]:
        """Get all files for a template."""
        return list(session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all())

    def get_template_file_content(
        self,
        template_id: str,
        relative_path: str,
        session: Session,
    ) -> Optional[str]:
        """Get content of a specific template file."""
        file = session.exec(
            select(TemplateContent)
            .where(TemplateContent.template_id == template_id)
            .where(TemplateContent.relative_path == relative_path)
        ).first()

        if not file:
            return None

        try:
            return decompress_content(file.content_compressed).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to decompress template file {relative_path}: {e}")
            return None

    def update_template_status(
        self,
        template_id: str,
        status: str,
        reviewer_email: str,
        session: Session,
    ) -> Optional[Template]:
        """
        Update template status (admin review action).

        Args:
            template_id: Template to update
            status: New status (APPROVED or REJECTED)
            reviewer_email: Email of the reviewer
            session: Database session

        Returns:
            Updated Template or None if not found
        """
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()

        if not template:
            return None

        template.status = status
        template.reviewed_at = utc_now()
        template.reviewed_by = reviewer_email

        session.commit()
        session.refresh(template)
        return template

    def create_project_from_template(
        self,
        template_id: str,
        project_name: str,
        user_email: str,
        session: Session,
        warehouse_id: Optional[str] = None,
        warehouse_name: Optional[str] = None,
        default_catalog: Optional[str] = None,
        default_schema: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Project:
        """
        Create a new project from a template.

        1. Create new project record
        2. Copy template_content to project_files
        3. Copy files to local filesystem

        Args:
            template_id: Template to copy from
            project_name: Name for the new project
            user_email: Email of the user creating the project
            session: Database session
            warehouse_id: Default warehouse ID
            warehouse_name: Default warehouse name
            default_catalog: Default catalog name
            default_schema: Default schema name

        Returns:
            Created Project object
        """
        # Get template
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()
        if not template:
            raise ValueError(f"Template {template_id} not found")

        # Get template files
        template_files = session.exec(
            select(TemplateContent).where(TemplateContent.template_id == template_id)
        ).all()

        # Create new project with default resources. The caller may pass the
        # project_id (so it can derive default_schema's per-project suffix from
        # the SAME id before calling — see routes/templates.py); otherwise mint one.
        project_id = project_id or generate_uuid()
        sfx = resource_suffix(project_id)
        fork_mode = fork_mode_for(template.template_type)
        project = Project(
            mode=fork_mode,
            architecture_first=fork_mode == "architecture",
            id=project_id,
            user_email=user_email,
            name=project_name,
            description=f"Created from template: {template.name}",
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            default_catalog=default_catalog,
            default_schema=default_schema,
            source_template_id=template_id,
            customer=template.customer,
        )
        session.add(project)

        # Materialize each template file for the fork. resources.json is rewritten
        # with created_resources cleared (the fork points at no live Databricks
        # objects until its owner builds — the template's IDs are the author's
        # workspace). Everything else copies through verbatim (compressed bytes
        # reused, no re-compress).
        def _fork_bytes(tf) -> Optional[bytes]:
            """Decompressed content for the fork, with resources.json transformed.
            Returns None to fall back to the verbatim compressed copy (perf path)."""
            if tf.relative_path.lower() == "resources.json":
                return _clear_created_resources(decompress_content(tf.content_compressed), sfx)
            # The fork gets its own dbdemos tracker app id (<template-id>-<suffix>).
            if sfx and tf.relative_path in ("app/config/app.json", "databricks.yml"):
                text = decompress_content(tf.content_compressed).decode("utf-8", errors="replace")
                rewritten = _unique_tracker_app_id(text, sfx)
                if rewritten != text:
                    return rewritten.encode("utf-8")
            return None

        project_files = []
        for tf in template_files:
            new_bytes = _fork_bytes(tf)
            if new_bytes is None:
                project_files.append(ProjectFile(
                    project_id=project_id,
                    relative_path=tf.relative_path,
                    content_compressed=tf.content_compressed,
                    content_hash=tf.content_hash,
                    file_size=tf.file_size,
                ))
            else:
                project_files.append(ProjectFile(
                    project_id=project_id,
                    relative_path=tf.relative_path,
                    content_compressed=compress_content(new_bytes),
                    content_hash=compute_file_hash(new_bytes),
                    file_size=len(new_bytes),
                ))
        session.add_all(project_files)
        session.commit()

        # Copy files to local filesystem (same transform for resources.json).
        project_dir = Path(PROJECTS_BASE_DIR) / project_id
        project_dir.mkdir(parents=True, exist_ok=True)

        for tf in template_files:
            file_path = project_dir / tf.relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                new_bytes = _fork_bytes(tf)
                content = new_bytes if new_bytes is not None else decompress_content(tf.content_compressed)
                file_path.write_bytes(content)
            except Exception as e:
                logger.error(f"Failed to write file {tf.relative_path}: {e}")

        # The seed's live demo (same workspace only), so the POV deck stage can link it
        # while this fork has no build of its own. The file watcher syncs it to the DB.
        try:
            sync_seed_live_demo(project_dir, template_id, template.live_demo)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to write the seed live demo for {project_id}: {e}")

        session.refresh(project)
        return project

    def delete_template(self, template_id: str, session: Session) -> bool:
        """
        Delete a template and its files.

        Args:
            template_id: Template to delete
            session: Database session

        Returns:
            True if deleted, False if not found
        """
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()

        if not template:
            return False

        # Delete template (cascade will delete template_content)
        session.delete(template)
        session.commit()
        return True

    def get_template_by_project(
        self,
        project_id: str,
        session: Session,
    ) -> Optional[Template]:
        """
        Get template linked to a project.

        Args:
            project_id: Project ID to search for
            session: Database session

        Returns:
            Template if found, None otherwise
        """
        return session.exec(
            select(Template).where(Template.source_project_id == project_id)
        ).first()

    def update_template_from_project(
        self,
        template_id: str,
        project_id: str,
        session: Session,
    ) -> Template:
        """
        Update template content from project files.

        Replaces all template files with current project files and regenerates embedding.

        Args:
            template_id: Template to update
            project_id: Source project ID
            session: Database session

        Returns:
            Updated Template

        Raises:
            ValueError: If template or project not found
        """
        # Get template
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()
        if not template:
            raise ValueError(f"Template {template_id} not found")

        # Get project
        project = session.exec(
            select(Project).where(Project.id == project_id)
        ).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Get project files
        project_files = session.exec(
            select(ProjectFile).where(ProjectFile.project_id == project_id)
        ).all()
        if not project_files:
            raise ValueError(f"Project {project_id} has no files")

        # Filter files (skip excluded) and capture README + resources.json content
        readme_content = None
        resources_text = None
        filtered_files = []
        for f in project_files:
            if not _should_include_in_template(f.relative_path):
                continue
            filtered_files.append(f)
            # Capture README for embedding update
            if f.relative_path.lower() == "readme.md":
                readme_content = decompress_content(f.content_compressed).decode("utf-8")
            elif f.relative_path.lower() == "resources.json":
                resources_text = decompress_content(f.content_compressed).decode("utf-8")

        # Smooth sync: only touch changed/added/removed files (no delete-all
        # churn). resources.json is scrubbed of `created_resources` first (see
        # create_template_from_project) so a stored template never ships the
        # author's live resource IDs / app URL.
        def _content_tuple(f: ProjectFile) -> tuple[str, bytes, str, int]:
            if f.relative_path.lower() == "resources.json":
                scrubbed = _clear_created_resources(decompress_content(f.content_compressed))
                return (
                    f.relative_path,
                    compress_content(scrubbed),
                    compute_file_hash(scrubbed),
                    len(scrubbed),
                )
            return (f.relative_path, f.content_compressed, f.content_hash, f.file_size)

        _upsert_template_content(
            session,
            template_id,
            [_content_tuple(f) for f in filtered_files],
        )

        # Use project name/description if no README
        if not readme_content:
            readme_content = f"# {project.name}\n\n{project.description or ''}"

        # Real capabilities from the project's resources.json (source of truth);
        # LLM only for description/industry + capabilities fallback.
        real_capabilities = (
            _capabilities_from_resources_json(resources_text) if resources_text else []
        )
        extracted = _summarize_readme(self.llm, readme_content)
        template.name = project.name
        template.industry = extracted.get("industry")
        template.description = extracted.get("description")
        template.narrative = project.narrative
        template.full_description = readme_content
        template.capabilities = json.dumps(real_capabilities or extracted.get("capabilities", []))
        template.customer = project.customer
        template.source_project_id = project_id

        # Update embedding (gracefully skips on PGLite)
        embedding = self.llm.get_embedding(readme_content)
        _store_embedding(session, template_id, embedding)

        session.commit()
        session.refresh(template)
        return template

    def get_or_create_source_project(
        self,
        template_id: str,
        user_email: str,
        session: Session,
        warehouse_id: Optional[str] = None,
        warehouse_name: Optional[str] = None,
        default_catalog: Optional[str] = None,
        default_schema: Optional[str] = None,
    ) -> Project:
        """
        Get the source project for a template, or create a new one if it was deleted.

        Args:
            template_id: Template ID
            user_email: User email (for creating new project)
            session: Database session
            warehouse_id: Default warehouse ID (for new project)
            warehouse_name: Default warehouse name (for new project)
            default_catalog: Default catalog name (for new project)
            default_schema: Default schema name (for new project)

        Returns:
            Existing or newly created Project

        Raises:
            ValueError: If template not found
        """
        template = session.exec(
            select(Template).where(Template.id == template_id)
        ).first()
        if not template:
            raise ValueError(f"Template {template_id} not found")

        # If source project exists, return it
        if template.source_project_id:
            project = session.exec(
                select(Project).where(Project.id == template.source_project_id)
            ).first()
            if project:
                return project

        # Project was deleted or never existed - create a new one from template
        project = self.create_project_from_template(
            template_id=template_id,
            project_name=f"Edit: {template.name}",
            user_email=user_email,
            session=session,
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            default_catalog=default_catalog,
            default_schema=default_schema,
        )

        # Link the new project to the template
        template.source_project_id = project.id
        session.commit()
        session.refresh(template)

        return project
