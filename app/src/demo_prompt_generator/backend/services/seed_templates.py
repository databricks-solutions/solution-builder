"""
Seed the curated ("official") templates into the database on startup.

Reads pre-authored demo folders from initial_templates/ (metadata in
manifest.json) and upserts them as APPROVED + official templates. No LLM or
external-service dependency — description, industry, and capabilities come from
the manifest + each folder's resources.json.

Keyed by FOLDER NAME (manifest `id` == `directory`), so a restart UPGRADES the
existing template in place rather than duplicating. Upgrades are SMOOTH: a
per-folder content checksum lets unchanged templates skip entirely, and changed
ones diff-update only the files that actually changed (see
`_upsert_template_content`). Failures are logged, never fatal to startup.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select

from ..models import Template, TemplateScreenshot, TemplateStatus, utc_now
from .file_sync import compress_content, compute_file_hash
from .template_service import (
    _should_include_in_template,
    _upsert_template_content,
    _store_embedding,
    _embedding_text,
)

logger = logging.getLogger(__name__)

SCREENSHOT_FILENAME = "template_screenshot.png"


def _find_initial_templates_dir() -> Optional[Path]:
    """Locate the initial_templates/ directory.

    Same path inside the wheel and the dev tree:
    `demo_prompt_generator/initial_templates/` (wheel) or `<repo>/initial_templates/` (dev).
    A valid dir contains at least one seed folder (a subdir with a manifest.json).
    """
    def _valid(d: Path) -> bool:
        return d.exists() and any(True for _ in _discover_template_dirs(d))

    bundled = Path(__file__).parent.parent.parent / "initial_templates"
    if _valid(bundled):
        return bundled

    current_file = Path(__file__)
    repo_root = current_file.parent.parent.parent.parent.parent.parent
    templates_dir = repo_root / "initial_templates"
    if _valid(templates_dir):
        return templates_dir

    for parent in current_file.parents:
        candidate = parent / "initial_templates"
        if _valid(candidate):
            return candidate

    return None


def _discover_template_dirs(templates_root: Path):
    """Yield every seed-template folder — a directory anywhere under
    `initial_templates/` that contains its own `manifest.json` (the per-folder
    seed/gallery metadata). Folders self-register by dropping a manifest in; no
    central index to edit. Nested paths (e.g. healthcare/<demo>) are supported."""
    for mf in sorted(templates_root.rglob("manifest.json")):
        if mf.parent != templates_root:  # skip a stray top-level manifest, if any
            yield mf.parent


def _collect_files(template_dir: Path) -> list[tuple[str, bytes]]:
    """Collect template-eligible files (relative_path, raw_content).

    Applies `_should_include_in_template` (which excludes junk AND the
    template_screenshot.png — that goes to the Template.screenshot column, not a
    shipped file)."""
    files = []
    for path in sorted(template_dir.rglob("*")):
        if not path.is_file():
            continue
        rel_path = str(path.relative_to(template_dir))
        if any(part.startswith(".") or part == "__pycache__" for part in Path(rel_path).parts):
            continue
        if not _should_include_in_template(rel_path):
            continue
        try:
            files.append((rel_path, path.read_bytes()))
        except Exception as e:
            logger.warning(f"Could not read seed template file {rel_path}: {e}")
    return files


def _read_resources_meta(template_dir: Path) -> dict:
    """Read the metadata a seed template owns in its `resources.json` — which is
    the demo's OWN file and looks exactly like a real generated project's
    (NOT the manifest, and NOT a place for gallery-only prose like narrative):

      - `short_description` → the Template's short `description`
      - `capabilities`      → the demo's real {buildable, talking_track} sets,
                              flattened to the ordered flat list the Template
                              stores (buildable first, then talking_track).

    (`narrative` is gallery-only and lives in the manifest entry, not here —
    a real project keeps its narrative in the DB, not in resources.json.)

    Returns {short_description, capabilities} (capabilities is a list;
    short_description Optional[str]). Empty dict on parse failure so callers
    can fall back to manifest values.
    """
    rj = template_dir / "resources.json"
    if not rj.exists():
        return {}
    try:
        data = json.loads(rj.read_text())
    except Exception as e:
        logger.warning(f"Could not read resources.json from {rj}: {e}")
        return {}

    caps = data.get("capabilities")
    flat_caps: list[str] = []
    if isinstance(caps, dict):
        # {buildable: [...], talking_track: [...]} → ordered flat list, deduped.
        seen: set[str] = set()
        for group in ("buildable", "talking_track"):
            for c in caps.get(group, []) or []:
                if c not in seen:
                    seen.add(c)
                    flat_caps.append(c)
    elif isinstance(caps, list):
        flat_caps = list(caps)

    return {
        "short_description": data.get("short_description"),
        "capabilities": flat_caps,
    }


def _read_screenshot(template_dir: Path) -> Optional[bytes]:
    """Read the HERO screenshot (template_screenshot.png) bytes if present."""
    p = template_dir / SCREENSHOT_FILENAME
    if p.exists():
        try:
            return p.read_bytes()
        except Exception as e:
            logger.warning(f"Could not read {p}: {e}")
    return None


def _read_extra_screenshots(template_dir: Path) -> list[tuple[int, bytes]]:
    """Read EXTRA gallery images: template_screenshot_1.png, _2.png, … in order.
    Stops at the first missing ordinal. Returns [(ordinal, png_bytes), …]
    (ordinal is 1-based; the hero is template_screenshot.png)."""
    stem = SCREENSHOT_FILENAME.rsplit(".", 1)[0]  # "template_screenshot"
    out: list[tuple[int, bytes]] = []
    n = 1
    while True:
        p = template_dir / f"{stem}_{n}.png"
        if not p.exists():
            break
        try:
            out.append((n, p.read_bytes()))
        except Exception as e:
            logger.warning(f"Could not read {p}: {e}")
        n += 1
    return out


def _folder_signature(template_dir: Path, meta: str) -> str:
    """CHEAP change-detector for the skip fast-path: hash each eligible file's
    (relative_path, size, mtime_ns) + the metadata string — `stat()` only, NO
    content reads. On an unchanged restart this is a handful of stats, so seeding
    short-circuits instantly instead of re-reading every template file (luxebeauty
    alone is ~180 files). Content is only read + hashed when this signature
    changes (i.e. an actual insert/update — see the loop). Trade-off: an edit that
    preserves size AND mtime is missed; a `touch` / rebuild re-triggers it."""
    h = hashlib.sha256()
    entries = []
    for path in template_dir.rglob("*"):
        if not path.is_file():
            continue
        rel_path = str(path.relative_to(template_dir))
        if any(part.startswith(".") or part == "__pycache__" for part in Path(rel_path).parts):
            continue
        # include the screenshots in the signature (they're excluded from the
        # fork file-set but ARE written to the Template.screenshot column +
        # template_screenshots table, so adding/changing one must re-seed).
        is_screenshot = path.name == SCREENSHOT_FILENAME or bool(
            re.fullmatch(r"template_screenshot_\d+\.png", path.name.lower())
        )
        if not _should_include_in_template(rel_path) and not is_screenshot:
            continue
        try:
            st = path.stat()
            entries.append((rel_path, st.st_size, st.st_mtime_ns))
        except OSError:
            continue
    for rel_path, size, mtime_ns in sorted(entries):
        h.update(f"{rel_path}\0{size}\0{mtime_ns}\0".encode())
    h.update(b"meta:")
    h.update(meta.encode())
    return h.hexdigest()


def seed_default_templates(engine: Engine, ws: "WorkspaceClient | None" = None) -> None:
    """Upsert the official templates from the initial_templates/ folders.

    Each seed template is a self-contained folder carrying its OWN
    `manifest.json` (seed/gallery metadata: id, name, customer, industry,
    narrative). We discover them by scanning — no central index to edit; add a
    template by dropping a folder in.

    `ws` (a WorkspaceClient) is needed to build the embedding for semantic
    search; when None (or unavailable) seeding still runs, just without
    embeddings (search then relies on the lexical fallback).

    Called once at startup after migrations. Idempotent + smooth:
      - new id            → insert (official, APPROVED)
      - existing, same    → skip (checksum match)
      - existing, changed → diff-update only changed files + refresh metadata
    """
    # Build one LLMService for the whole seed pass (embeddings). Best-effort:
    # if it can't be constructed, we seed without embeddings.
    llm: "LLMService | None" = None
    if ws is not None:
        try:
            from .llm_service import LLMService
            llm = LLMService(ws)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"Embedding disabled for seeding (LLMService init failed): {e}")
    templates_dir = _find_initial_templates_dir()
    if not templates_dir:
        logger.warning(
            "No initial_templates/ folders with a manifest.json found — skipping "
            f"template seeding (searched from {Path(__file__).resolve()})"
        )
        return

    owner_email = "system@databricks.com"
    inserted = updated = skipped = 0

    with Session(engine) as session:
        for template_dir in _discover_template_dirs(templates_dir):
            rel_dir = str(template_dir.relative_to(templates_dir))
            try:
                entry = json.loads((template_dir / "manifest.json").read_text())
            except Exception as e:
                logger.warning(f"Failed to read manifest for seed template '{rel_dir}': {e}")
                continue
            template_id = entry.get("id")
            if not template_id:
                logger.warning(f"Seed template '{rel_dir}' manifest has no id — skipping")
                continue
            try:
                # Metadata split:
                #   - resources.json is the demo's OWN file — it looks exactly like
                #     a real generated project (short_description + capabilities +
                #     created_resources), so those come from there.
                #   - the per-folder manifest is the seed/gallery metadata and owns
                #     the gallery-only `narrative` (a real project keeps its narrative
                #     in the DB, not in resources.json, so it doesn't belong here).
                rmeta = _read_resources_meta(template_dir)
                short_description = rmeta.get("short_description") or entry.get("description")
                narrative = entry.get("narrative")
                capabilities = rmeta.get("capabilities") or entry.get("capabilities", [])
                capabilities_json = json.dumps(capabilities)
                # Metadata that, if changed, should trigger a re-seed even when files are identical.
                meta = "|".join([
                    entry.get("name", ""), entry.get("industry", "") or "",
                    entry.get("customer", "") or "", short_description or "",
                    narrative or "", capabilities_json,
                ])

                # CHEAP skip check: stat-based signature vs the stored checksum.
                # Query ONLY the checksum column (not the ~half-MB screenshot BLOB).
                signature = _folder_signature(template_dir, meta)
                stored_checksum = session.exec(
                    select(Template.content_checksum).where(Template.id == template_id)
                ).first()
                if stored_checksum is not None and stored_checksum == signature:
                    skipped += 1
                    continue

                # Something changed (or brand new) → now do the expensive reads.
                files = _collect_files(template_dir)
                if not files:
                    logger.warning(f"No files found for seed template: {entry['name']}")
                    continue
                readme_path = template_dir / "README.md"
                full_description = readme_path.read_text() if readme_path.exists() else None
                screenshot = _read_screenshot(template_dir)
                extra_screenshots = _read_extra_screenshots(template_dir)
                checksum = signature

                existing = session.exec(
                    select(Template).where(Template.id == template_id)
                ).first()

                now = utc_now()
                if existing is None:
                    template = Template(
                        id=template_id,
                        name=entry["name"],
                        status=TemplateStatus.APPROVED.value,
                        owner_email=owner_email,
                        industry=entry.get("industry"),
                        description=short_description,
                        narrative=narrative,
                        full_description=full_description,
                        capabilities=capabilities_json,
                        customer=entry.get("customer"),
                        official=True,
                        screenshot=screenshot,
                        content_checksum=checksum,
                        submitted_at=now,
                        reviewed_at=now,
                        reviewed_by=owner_email,
                    )
                    session.add(template)
                    is_new = True
                else:
                    # Refresh metadata + screenshot (keep it official; keep owner/review as-is).
                    existing.name = entry["name"]
                    existing.industry = entry.get("industry")
                    existing.description = short_description
                    existing.narrative = narrative
                    existing.full_description = full_description
                    existing.capabilities = capabilities_json
                    existing.customer = entry.get("customer")
                    existing.official = True
                    existing.screenshot = screenshot
                    existing.content_checksum = checksum
                    session.add(existing)
                    is_new = False

                counts = _upsert_template_content(
                    session,
                    template_id,
                    [(rel, compress_content(content), compute_file_hash(content), len(content))
                     for rel, content in files],
                )

                # Extra gallery screenshots → replace the template's set wholesale
                # (cheap: a handful of rows; we only get here when the folder changed).
                for row in session.exec(
                    select(TemplateScreenshot).where(TemplateScreenshot.template_id == template_id)
                ).all():
                    session.delete(row)
                for ordinal, img in extra_screenshots:
                    session.add(TemplateScreenshot(template_id=template_id, ordinal=ordinal, image=img))

                # Best-effort embedding (skips on PGLite / no pgvector, or when
                # no LLMService was available). Index a COMBINED text — name,
                # industry, narrative, short description, and README — so search
                # matches the title/industry/story, not just the README prose.
                if llm is not None:
                    embed_text = _embedding_text(
                        name=entry["name"],
                        industry=entry.get("industry"),
                        narrative=narrative,
                        description=short_description,
                        readme=full_description,
                    )
                    if embed_text:
                        try:
                            _store_embedding(session, template_id, llm.get_embedding(embed_text))
                        except Exception as e:
                            logger.debug(f"Skipping embedding for seed template {template_id}: {e}")

                session.commit()
                if is_new:
                    inserted += 1
                    logger.info(f"Seeded template '{template_id}' ({counts['added']} files)")
                else:
                    updated += 1
                    logger.info(
                        f"Updated template '{template_id}': "
                        f"{counts['added']} added, {counts['changed']} changed, "
                        f"{counts['removed']} removed, {counts['unchanged']} unchanged"
                    )

            except Exception as e:
                logger.warning(f"Failed to seed template '{entry.get('name')}': {e}")
                session.rollback()

    if inserted or updated or skipped:
        logger.info(f"Template seeding: {inserted} new, {updated} updated, {skipped} unchanged")
