"""Collection service: manages curated block groups with dependency graphs."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from ..core._config import logger
from .block_registry import registry

# Collections directory lives at project root
_COLLECTIONS_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "collections"


@dataclass
class OutputFile:
    """A file in the collection's output plan."""
    filename: str
    purpose: str
    depends_on: list[str]


@dataclass
class Collection:
    """A curated group of blocks with an output dependency graph."""
    slug: str
    name: str
    description: str
    industry: str
    block_slugs: list[str]
    output_files: list[OutputFile]

    def to_summary(self) -> dict:
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "industry": self.industry,
            "block_slugs": self.block_slugs,
            "output_file_count": len(self.output_files),
        }

    def to_full(self) -> dict:
        return {
            **self.to_summary(),
            "output_files": [
                {"filename": f.filename, "purpose": f.purpose, "depends_on": f.depends_on}
                for f in self.output_files
            ],
        }

    def dependency_tiers(self) -> list[list[OutputFile]]:
        """Compute generation tiers from the dependency graph.

        Returns a list of tiers, where each tier contains files that can be
        generated in parallel (all their dependencies are in earlier tiers).
        """
        remaining = list(self.output_files)
        completed: set[str] = set()
        tiers: list[list[OutputFile]] = []

        while remaining:
            # Find files whose dependencies are all satisfied
            tier: list[OutputFile] = []
            for f in remaining:
                deps = f.depends_on
                if not deps:
                    tier.append(f)
                elif deps == ["*"]:
                    # Depends on everything — only ready when nothing else remains
                    continue
                elif all(d in completed for d in deps):
                    tier.append(f)

            if not tier:
                # Only wildcard deps left — they go in the final tier
                tier = [f for f in remaining if f.depends_on == ["*"]]
                if not tier:
                    # Circular dependency — break by adding everything remaining
                    logger.warning(
                        "Circular dependency detected in collection %s, "
                        "forcing remaining files into final tier",
                        self.slug,
                    )
                    tier = remaining

            for f in tier:
                remaining.remove(f)
                completed.add(f.filename)
            tiers.append(tier)

        return tiers


def _parse_collection(manifest_path: Path) -> Collection | None:
    """Parse a collection manifest.json file."""
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Could not read collection manifest %s", manifest_path)
        return None

    output_files = [
        OutputFile(
            filename=f["filename"],
            purpose=f["purpose"],
            depends_on=f.get("depends_on", []),
        )
        for f in data.get("output_files", [])
    ]

    return Collection(
        slug=data.get("slug", manifest_path.parent.name),
        name=data.get("name", ""),
        description=data.get("description", ""),
        industry=data.get("industry", ""),
        block_slugs=data.get("blocks", []),
        output_files=output_files,
    )


class CollectionService:
    """Manages collections loaded from disk + DB."""

    def __init__(self) -> None:
        self._collections: dict[str, Collection] = {}
        self._loaded = False
        self._engine = None

    def set_engine(self, engine) -> None:
        self._engine = engine

    def load(self, collections_dir: Path | None = None) -> None:
        """Load from disk first, then overlay DB collections."""
        root = collections_dir or _COLLECTIONS_DIR
        disk_count = 0
        if root.is_dir():
            for manifest_path in sorted(root.glob("*/manifest.json")):
                coll = _parse_collection(manifest_path)
                if coll:
                    self._collections[coll.slug] = coll
                    disk_count += 1

        db_count = 0
        if self._engine:
            try:
                from sqlmodel import Session, select
                from ..models import CollectionRecord
                import json as _json

                with Session(self._engine) as session:
                    rows = session.exec(select(CollectionRecord)).all()
                    for row in rows:
                        ofs = _json.loads(row.output_files) if row.output_files else []
                        self._collections[row.slug] = Collection(
                            slug=row.slug,
                            name=row.name,
                            description=row.description,
                            industry=row.industry,
                            block_slugs=_json.loads(row.block_slugs) if row.block_slugs else [],
                            output_files=[
                                OutputFile(f["filename"], f["purpose"], f.get("depends_on", []))
                                for f in ofs
                            ],
                        )
                        db_count += 1
            except Exception:
                logger.debug("Could not load collections from DB — using disk only")

        self._loaded = True
        logger.info("Collection service loaded: %d from disk, %d from DB, %d total", disk_count, db_count, len(self._collections))

    def seed_to_db(self) -> None:
        """Write disk-loaded collections to DB as seed data."""
        if not self._engine:
            return

        from sqlmodel import Session, select
        from ..models import CollectionRecord
        import json as _json

        with Session(self._engine) as session:
            for coll in self._collections.values():
                existing = session.exec(
                    select(CollectionRecord).where(CollectionRecord.slug == coll.slug)
                ).first()

                ofs_json = _json.dumps([
                    {"filename": f.filename, "purpose": f.purpose, "depends_on": f.depends_on}
                    for f in coll.output_files
                ])

                if existing:
                    if existing.is_seed:
                        existing.name = coll.name
                        existing.description = coll.description
                        existing.industry = coll.industry
                        existing.block_slugs = _json.dumps(coll.block_slugs)
                        existing.output_files = ofs_json
                        session.add(existing)
                else:
                    row = CollectionRecord(
                        slug=coll.slug,
                        name=coll.name,
                        description=coll.description,
                        industry=coll.industry,
                        block_slugs=_json.dumps(coll.block_slugs),
                        output_files=ofs_json,
                        is_seed=True,
                    )
                    session.add(row)

            session.commit()
            logger.info("Collection seed complete: %d collections", len(self._collections))

    def save_collection(self, coll: Collection, created_by: str = "") -> Collection:
        """Save or update a collection in memory and DB."""
        import json as _json
        self._collections[coll.slug] = coll

        if self._engine:
            from sqlmodel import Session, select
            from ..models import CollectionRecord
            from datetime import datetime

            ofs_json = _json.dumps([
                {"filename": f.filename, "purpose": f.purpose, "depends_on": f.depends_on}
                for f in coll.output_files
            ])

            with Session(self._engine) as session:
                existing = session.exec(
                    select(CollectionRecord).where(CollectionRecord.slug == coll.slug)
                ).first()

                if existing:
                    existing.name = coll.name
                    existing.description = coll.description
                    existing.industry = coll.industry
                    existing.block_slugs = _json.dumps(coll.block_slugs)
                    existing.output_files = ofs_json
                    existing.updated_at = datetime.utcnow()
                    if created_by:
                        existing.created_by = created_by
                    session.add(existing)
                else:
                    row = CollectionRecord(
                        slug=coll.slug,
                        name=coll.name,
                        description=coll.description,
                        industry=coll.industry,
                        block_slugs=_json.dumps(coll.block_slugs),
                        output_files=ofs_json,
                        created_by=created_by,
                        is_seed=False,
                    )
                    session.add(row)

                session.commit()
        return coll

    def delete_collection(self, slug: str) -> bool:
        """Delete a collection from memory and DB."""
        if slug not in self._collections:
            return False
        del self._collections[slug]

        if self._engine:
            from sqlmodel import Session, select
            from ..models import CollectionRecord

            with Session(self._engine) as session:
                existing = session.exec(
                    select(CollectionRecord).where(CollectionRecord.slug == slug)
                ).first()
                if existing:
                    session.delete(existing)
                    session.commit()
        return True

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def match_topic(self, topic: str) -> dict | None:
        """Check if a topic matches an existing collection via keyword scoring.

        Returns the best-matching collection summary if score > threshold, else None.
        """
        self._ensure_loaded()
        if not topic:
            return None

        words = [w for w in topic.lower().split() if len(w) >= 3]
        best_score = 0
        best_coll = None

        for coll in self._collections.values():
            score = 0
            searchable = f"{coll.name} {coll.description} {coll.industry} {' '.join(coll.block_slugs)}".lower()
            for word in words:
                if word in coll.name.lower():
                    score += 3
                if word in coll.slug:
                    score += 2
                if word in searchable:
                    score += 1
            if score > best_score:
                best_score = score
                best_coll = coll

        if best_score >= 4 and best_coll:
            return best_coll.to_summary()
        return None

    def list_collections(self) -> list[dict]:
        """List all collections (summary only)."""
        self._ensure_loaded()
        return [c.to_summary() for c in sorted(self._collections.values(), key=lambda c: c.name)]

    def get_collection(self, slug: str) -> dict | None:
        """Get a collection with full details including resolved block info."""
        self._ensure_loaded()
        coll = self._collections.get(slug)
        if not coll:
            return None

        result = coll.to_full()
        # Resolve block metadata
        resolved_blocks = []
        for block_slug in coll.block_slugs:
            block = registry.get_block(block_slug)
            if block:
                resolved_blocks.append(block)
            else:
                resolved_blocks.append({"slug": block_slug, "name": block_slug, "error": "not found"})
        result["blocks"] = resolved_blocks
        return result

    def get_collection_obj(self, slug: str) -> Collection | None:
        """Get the raw Collection object (for internal use)."""
        self._ensure_loaded()
        return self._collections.get(slug)

    def get_block_context(self, slug: str) -> str:
        """Load and combine all block content for a collection.

        Returns the combined context string ready for LLM prompt assembly.
        """
        self._ensure_loaded()
        coll = self._collections.get(slug)
        if not coll:
            return ""
        return registry.load_blocks(coll.block_slugs)

    def suggest_output_files_prompt(self, block_slugs: list[str]) -> str:
        """Build an LLM prompt to suggest output files for a set of blocks."""
        block_details = []
        for slug in block_slugs:
            block = registry.get_block(slug)
            if block:
                block_details.append(f"- **{slug}** ({block['category']}): {block['description'][:150]}")

        return f"""\
You are a Databricks demo architect. Given a set of context blocks, suggest \
what output files should be generated for this demo package.

# Selected Blocks
{"chr(10)".join(block_details)}

# Instructions

Respond with a JSON array of output files:
[
  {{"filename": "01-story-and-data.md", "purpose": "...", "depends_on": []}},
  {{"filename": "02-pipeline.md", "purpose": "...", "depends_on": ["01-story-and-data.md"]}},
  ...
]

Rules:
- Always start with 01-story-and-data.md (no deps) for the narrative and data schemas
- Always end with a walkthrough file that depends on ["*"]
- Each capability block should map to at least one output file
- Group related capabilities (e.g. Genie + KA can share a file)
- Keep to 4-8 output files total
- Use dependency graph: files in the same tier can be generated in parallel
- Output ONLY valid JSON array, no commentary"""

    def suggest_collection_prompt(self, topic: str) -> str:
        """Build an LLM prompt that asks it to suggest a collection for a topic.

        Returns the system prompt portion. The caller adds the user message.
        """
        block_index = registry.get_block_index()
        existing = "\n".join(
            f"- **{c.slug}**: {c.description} (blocks: {', '.join(c.block_slugs)})"
            for c in self._collections.values()
        )

        return f"""\
You are a Databricks demo architect. Given a use-case topic, suggest which \
blocks should be combined into a collection to build this demo.

# Available Blocks
{block_index}

# Existing Collections (for reference)
{existing}

# Instructions

Respond with a JSON object:
{{
  "name": "Collection display name",
  "slug": "kebab-case-slug",
  "description": "One sentence describing the demo",
  "industry": "Industry name",
  "blocks": ["slug1", "slug2", ...],
  "output_files": [
    {{"filename": "01-story-and-data.md", "purpose": "...", "depends_on": []}},
    {{"filename": "02-pipeline.md", "purpose": "...", "depends_on": ["01-story-and-data.md"]}},
    ...
  ]
}}

Rules:
- Always include at least one domain block and one pattern block
- Include capability blocks for each Databricks component the demo will use
- Always include synthetic-data-gen if data needs to be generated
- Output files should follow a dependency graph where 01-story-and-data.md has no deps,
  and the final walkthrough file depends on ["*"]
- Keep to 4-7 output files
- Output ONLY valid JSON, no commentary"""


# Module-level singleton
collection_service = CollectionService()
