"""
Seed default templates into the database on startup.

Reads pre-authored templates from initial_templates/ (with metadata from
manifest.json) and inserts them as APPROVED templates. No LLM or external
service dependencies — descriptions, industries, and capabilities are
pre-computed in the manifest. Embeddings are left NULL (text search fallback
handles discovery).

Idempotent: uses deterministic IDs from the manifest and skips templates
that already exist.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy import Engine
from sqlmodel import Session, select, text

from ..models import Template, TemplateContent, TemplateStatus, utc_now
from .file_sync import compress_content, compute_file_hash
from .template_service import _should_include_in_template

logger = logging.getLogger(__name__)


def _find_initial_templates_dir() -> Optional[Path]:
    """Locate the initial_templates/ directory.

    Same path inside the wheel and the dev tree:
    `demo_prompt_generator/initial_templates/` (wheel) or `<repo>/initial_templates/` (dev).
    """
    bundled = Path(__file__).parent.parent.parent / "initial_templates"
    if bundled.exists() and (bundled / "manifest.json").exists():
        return bundled

    current_file = Path(__file__)
    # Direct: services/ -> backend/ -> demo_prompt_generator/ -> src/ -> app/ -> repo root
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
    """Collect all template-eligible files from a directory.

    Returns (relative_path, raw_content) tuples. Applies the same filtering
    as template publishing: skip .claude/, resources.json, hidden files.
    """
    files = []
    for path in sorted(template_dir.rglob("*")):
        if not path.is_file():
            continue
        rel_path = str(path.relative_to(template_dir))
        # Skip hidden files and __pycache__
        if any(part.startswith(".") or part == "__pycache__" for part in Path(rel_path).parts):
            continue
        if not _should_include_in_template(rel_path):
            continue
        try:
            files.append((rel_path, path.read_bytes()))
        except Exception as e:
            logger.warning(f"Could not read seed template file {rel_path}: {e}")
    return files


def seed_default_templates(engine: Engine) -> None:
    """Seed default templates from initial_templates/manifest.json.

    Called once during startup after migrations complete. Idempotent —
    skips templates whose deterministic IDs already exist in the database.
    Failures are logged but never prevent the app from starting.
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

    seeded = 0
    skipped = 0

    with Session(engine) as session:
        for entry in entries:
            template_id = entry["id"]
            try:
                # Idempotency: skip if this ID already exists
                exists = session.exec(
                    select(Template.id).where(Template.id == template_id)
                ).first()
                if exists:
                    skipped += 1
                    continue

                # Resolve directory
                template_dir = templates_dir / entry["directory"]
                if not template_dir.exists():
                    logger.warning(f"Seed template directory not found: {entry['directory']}")
                    continue

                # Read README for full_description
                readme_path = template_dir / "README.md"
                full_description = readme_path.read_text() if readme_path.exists() else None

                # Collect and compress files
                files = _collect_files(template_dir)
                if not files:
                    logger.warning(f"No files found for seed template: {entry['name']}")
                    continue

                # Insert Template row
                now = utc_now()
                template = Template(
                    id=template_id,
                    name=entry["name"],
                    status=TemplateStatus.APPROVED.value,
                    owner_email=owner_email,
                    industry=entry.get("industry"),
                    description=entry.get("description"),
                    full_description=full_description,
                    capabilities=json.dumps(entry.get("capabilities", [])),
                    submitted_at=now,
                    reviewed_at=now,
                    reviewed_by=owner_email,
                )
                session.add(template)

                # Insert TemplateContent rows
                for rel_path, content in files:
                    tc = TemplateContent(
                        template_id=template_id,
                        relative_path=rel_path,
                        content_compressed=compress_content(content),
                        content_hash=compute_file_hash(content),
                        file_size=len(content),
                    )
                    session.add(tc)

                session.commit()
                seeded += 1

            except Exception as e:
                logger.warning(f"Failed to seed template '{entry.get('name')}': {e}")
                session.rollback()

    if seeded or skipped:
        logger.info(f"Template seeding: {seeded} new, {skipped} already existed")
