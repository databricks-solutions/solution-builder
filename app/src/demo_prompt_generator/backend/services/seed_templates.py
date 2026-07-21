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
from pathlib import Path
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select

from ..models import Template, TemplateStatus, utc_now
from .file_sync import compress_content, compute_file_hash
from .template_service import _should_include_in_template, _upsert_template_content, _store_embedding

logger = logging.getLogger(__name__)

SCREENSHOT_FILENAME = "template_screenshot.png"


def _find_initial_templates_dir() -> Optional[Path]:
    """Locate the initial_templates/ directory.

    Same path inside the wheel and the dev tree:
    `demo_prompt_generator/initial_templates/` (wheel) or `<repo>/initial_templates/` (dev).
    """
    bundled = Path(__file__).parent.parent.parent / "initial_templates"
    if bundled.exists() and (bundled / "manifest.json").exists():
        return bundled

    current_file = Path(__file__)
    repo_root = current_file.parent.parent.parent.parent.parent.parent
    templates_dir = repo_root / "initial_templates"
    if templates_dir.exists() and (templates_dir / "manifest.json").exists():
        return templates_dir

    for parent in current_file.parents:
        candidate = parent / "initial_templates"
        if candidate.exists() and (candidate / "manifest.json").exists():
            return candidate

    return None


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


def _read_short_description(template_dir: Path) -> Optional[str]:
    """Read `short_description` from the folder's resources.json (used as the
    Template's short `description`). Falls back to None."""
    rj = template_dir / "resources.json"
    if not rj.exists():
        return None
    try:
        return json.loads(rj.read_text()).get("short_description")
    except Exception as e:
        logger.warning(f"Could not read short_description from {rj}: {e}")
        return None


def _read_screenshot(template_dir: Path) -> Optional[bytes]:
    """Read template_screenshot.png bytes if present."""
    p = template_dir / SCREENSHOT_FILENAME
    if p.exists():
        try:
            return p.read_bytes()
        except Exception as e:
            logger.warning(f"Could not read {p}: {e}")
    return None


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
        # include the screenshot in the signature (it's excluded from the file-set
        # but IS written to the Template.screenshot column, so a change must re-seed).
        if not _should_include_in_template(rel_path) and path.name != SCREENSHOT_FILENAME:
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


def seed_default_templates(engine: Engine) -> None:
    """Upsert the official templates from initial_templates/manifest.json.

    Called once at startup after migrations. Idempotent + smooth:
      - new id            → insert (official, APPROVED)
      - existing, same    → skip (checksum match)
      - existing, changed → diff-update only changed files + refresh metadata
    """
    templates_dir = _find_initial_templates_dir()
    if not templates_dir:
        logger.warning(
            "No initial_templates/manifest.json found — skipping template seeding "
            f"(searched from {Path(__file__).resolve()})"
        )
        return

    try:
        manifest = json.loads((templates_dir / "manifest.json").read_text())
    except Exception as e:
        logger.warning(f"Failed to read template manifest: {e}")
        return

    owner_email = manifest.get("owner_email", "system@databricks.com")
    entries = manifest.get("templates", [])
    if not entries:
        return

    inserted = updated = skipped = 0

    with Session(engine) as session:
        for entry in entries:
            template_id = entry["id"]
            try:
                template_dir = templates_dir / entry["directory"]
                if not template_dir.exists():
                    logger.warning(f"Seed template directory not found: {entry['directory']}")
                    continue

                capabilities_json = json.dumps(entry.get("capabilities", []))
                short_description = _read_short_description(template_dir) or entry.get("description")
                # Metadata that, if changed, should trigger a re-seed even when files are identical.
                meta = "|".join([
                    entry.get("name", ""), entry.get("industry", "") or "",
                    entry.get("customer", "") or "", short_description or "",
                    capabilities_json,
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

                # Best-effort embedding (skips on PGLite / no pgvector).
                if full_description:
                    try:
                        # Local import to avoid an LLM dependency at module load.
                        from .llm_service import LLMService
                        _store_embedding(session, template_id, LLMService().get_embedding(full_description))
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
