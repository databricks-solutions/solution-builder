"""Load vetted library packages from disk into Lakebase on startup."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import Engine
from sqlmodel import Session, select

from ..core._config import logger
from ..models import Generation

# Library directory lives alongside the backend package
_LIBRARY_DIR = Path(__file__).resolve().parent.parent.parent / "library"


def seed_library(engine: Engine) -> None:
    """Scan library/ for package directories and upsert into Lakebase."""
    if not _LIBRARY_DIR.is_dir():
        logger.info("No library directory found at %s — skipping seed", _LIBRARY_DIR)
        return

    manifests = sorted(_LIBRARY_DIR.glob("*/manifest.json"))
    if not manifests:
        logger.info("No library packages found — skipping seed")
        return

    logger.info("Seeding %d library package(s) from %s", len(manifests), _LIBRARY_DIR)

    with Session(engine) as session:
        for manifest_path in manifests:
            try:
                _upsert_package(session, manifest_path)
            except Exception:
                session.rollback()
                logger.exception("Failed to seed library package %s", manifest_path.parent.name)

    logger.info("Library seed complete")


def _upsert_package(session: Session, manifest_path: Path) -> None:
    pkg_dir = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    demo_name: str = manifest["demo_name"]
    industry: str = manifest.get("industry", "")
    tags: list[str] = manifest.get("tags", [])
    owner_name: str = manifest.get("owner_name", "Demo Library")
    description: str = manifest.get("description", "")

    # Read all .md files in the package directory
    md_files: dict[str, str] = {}
    for md_path in sorted(pkg_dir.glob("*.md")):
        md_files[md_path.name] = md_path.read_text(encoding="utf-8")

    if not md_files:
        logger.warning("Library package %s has no .md files — skipping", pkg_dir.name)
        return

    skill_md = md_files.get("SKILL.md", next(iter(md_files.values())))
    skill_files_json = json.dumps(md_files)
    library_tags_json = json.dumps(tags)
    form_json = json.dumps({
        "source": "library",
        "demo_name": demo_name,
        "industry": industry,
        "description": description,
    })

    # Check for existing library row with same demo_name
    stmt = select(Generation).where(
        Generation.is_library == True,  # noqa: E712
        Generation.demo_name == demo_name,
    )
    existing = session.exec(stmt).first()

    if existing:
        # Update content from disk (repo is source of truth)
        existing.skill_md = skill_md
        existing.skill_files = skill_files_json
        existing.library_tags = library_tags_json
        existing.industry = industry
        existing.owner_name = owner_name
        existing.form_json = form_json
        session.add(existing)
        session.commit()
        logger.info("Updated library package: %s", demo_name)
    else:
        row = Generation(
            demo_name=demo_name,
            owner_name=owner_name,
            industry=industry,
            form_json=form_json,
            skill_md=skill_md,
            stage="package",
            skill_files=skill_files_json,
            is_library=True,
            library_tags=library_tags_json,
        )
        session.add(row)
        session.commit()
        logger.info("Seeded library package: %s", demo_name)
