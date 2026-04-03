"""Block registry: scans blocks/ directory and provides search/load capabilities."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from ..core._config import logger

# Blocks directory lives at project root
_BLOCKS_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "blocks"


@dataclass
class Block:
    """A single structured context block."""
    slug: str
    name: str
    category: str  # domain | capability | pattern
    tags: list[str]
    description: str
    related: list[str]
    content: str  # full markdown body (after frontmatter)
    suggested_capabilities: list[str] = field(default_factory=list)
    file_path: str = ""

    def to_summary(self) -> dict:
        """Metadata-only representation (no content)."""
        return {
            "slug": self.slug,
            "name": self.name,
            "category": self.category,
            "tags": self.tags,
            "description": self.description,
            "related": self.related,
            "suggested_capabilities": self.suggested_capabilities,
        }

    def to_full(self) -> dict:
        """Full representation including content."""
        return {**self.to_summary(), "content": self.content}


# ---------------------------------------------------------------------------
# Frontmatter parser
# ---------------------------------------------------------------------------

_FM_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_block_file(path: Path) -> Block | None:
    """Parse a block markdown file with YAML frontmatter."""
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception:
        logger.warning("Could not read block file %s", path)
        return None

    match = _FM_PATTERN.match(raw)
    if not match:
        logger.warning("Block file %s has no valid frontmatter — skipping", path)
        return None

    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        logger.warning("Invalid YAML frontmatter in %s — skipping", path)
        return None

    content = raw[match.end():]
    slug = meta.get("slug", path.stem)

    return Block(
        slug=slug,
        name=meta.get("name", slug),
        category=meta.get("category", "unknown"),
        tags=meta.get("tags", []),
        description=meta.get("description", "").strip(),
        related=meta.get("related", []),
        suggested_capabilities=meta.get("suggested_capabilities", []),
        content=content.strip(),
        file_path=str(path),
    )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class BlockRegistry:
    """In-memory index of all blocks, loaded from disk + DB."""

    def __init__(self) -> None:
        self._blocks: dict[str, Block] = {}
        self._loaded = False
        self._engine = None

    def set_engine(self, engine) -> None:
        """Set the SQLAlchemy engine for DB persistence."""
        self._engine = engine

    def load(self, blocks_dir: Path | None = None) -> None:
        """Load blocks from disk first, then overlay DB blocks (DB wins on conflict)."""
        # 1. Load from disk (seed data)
        root = blocks_dir or _BLOCKS_DIR
        disk_count = 0
        if root.is_dir():
            for md_path in sorted(root.rglob("*.md")):
                block = _parse_block_file(md_path)
                if block:
                    self._blocks[block.slug] = block
                    disk_count += 1

        # 2. Load from DB (user-created + updated seeds override disk)
        db_count = 0
        if self._engine:
            try:
                from sqlmodel import Session, select
                from ..models import BlockRecord
                import json

                with Session(self._engine) as session:
                    rows = session.exec(select(BlockRecord)).all()
                    for row in rows:
                        self._blocks[row.slug] = Block(
                            slug=row.slug,
                            name=row.name,
                            category=row.category,
                            tags=json.loads(row.tags) if row.tags else [],
                            description=row.description,
                            related=json.loads(row.related) if row.related else [],
                            content=row.content,
                            file_path="",
                        )
                        db_count += 1
            except Exception:
                logger.debug("Could not load blocks from DB — using disk only")

        self._loaded = True
        logger.info("Block registry loaded: %d from disk, %d from DB, %d total", disk_count, db_count, len(self._blocks))

    def seed_to_db(self) -> None:
        """Write disk-loaded blocks to DB as seed data (upsert)."""
        if not self._engine:
            return

        from sqlmodel import Session, select
        from ..models import BlockRecord
        import json

        with Session(self._engine) as session:
            for block in self._blocks.values():
                existing = session.exec(
                    select(BlockRecord).where(BlockRecord.slug == block.slug)
                ).first()

                if existing:
                    if existing.is_seed:
                        # Update seed data from disk
                        existing.name = block.name
                        existing.category = block.category
                        existing.tags = json.dumps(block.tags)
                        existing.description = block.description
                        existing.content = block.content
                        existing.related = json.dumps(block.related)
                        session.add(existing)
                else:
                    row = BlockRecord(
                        slug=block.slug,
                        name=block.name,
                        category=block.category,
                        tags=json.dumps(block.tags),
                        description=block.description,
                        content=block.content,
                        related=json.dumps(block.related),
                        is_seed=True,
                    )
                    session.add(row)

            session.commit()
            logger.info("Block seed complete: %d blocks", len(self._blocks))

    def save_block(self, block: Block, created_by: str = "") -> Block:
        """Save or update a block in both memory and DB."""
        import json
        self._blocks[block.slug] = block

        if self._engine:
            from sqlmodel import Session, select
            from ..models import BlockRecord
            from datetime import datetime

            with Session(self._engine) as session:
                existing = session.exec(
                    select(BlockRecord).where(BlockRecord.slug == block.slug)
                ).first()

                if existing:
                    existing.name = block.name
                    existing.category = block.category
                    existing.tags = json.dumps(block.tags)
                    existing.description = block.description
                    existing.content = block.content
                    existing.related = json.dumps(block.related)
                    existing.updated_at = datetime.utcnow()
                    if created_by:
                        existing.created_by = created_by
                    session.add(existing)
                else:
                    row = BlockRecord(
                        slug=block.slug,
                        name=block.name,
                        category=block.category,
                        tags=json.dumps(block.tags),
                        description=block.description,
                        content=block.content,
                        related=json.dumps(block.related),
                        created_by=created_by,
                        is_seed=False,
                    )
                    session.add(row)

                session.commit()
        return block

    def delete_block(self, slug: str) -> bool:
        """Delete a block from memory and DB."""
        if slug not in self._blocks:
            return False

        del self._blocks[slug]

        if self._engine:
            from sqlmodel import Session, select
            from ..models import BlockRecord

            with Session(self._engine) as session:
                existing = session.exec(
                    select(BlockRecord).where(BlockRecord.slug == slug)
                ).first()
                if existing:
                    session.delete(existing)
                    session.commit()

        return True

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def list_blocks(
        self,
        category: str | None = None,
        tags: list[str] | None = None,
    ) -> list[dict]:
        """List block summaries, optionally filtered by category and/or tags."""
        self._ensure_loaded()
        results = []
        for block in self._blocks.values():
            if category and block.category != category:
                continue
            if tags and not set(tags).intersection(block.tags):
                continue
            results.append(block.to_summary())
        return sorted(results, key=lambda b: (b["category"], b["name"]))

    def get_block(self, slug: str) -> dict | None:
        """Get a single block by slug (full content)."""
        self._ensure_loaded()
        block = self._blocks.get(slug)
        return block.to_full() if block else None

    def search_blocks(self, query: str) -> list[dict]:
        """Fuzzy search blocks by name, description, and tags."""
        self._ensure_loaded()
        query_lower = query.lower()
        scored: list[tuple[int, dict]] = []

        for block in self._blocks.values():
            score = 0
            if query_lower in block.name.lower():
                score += 10
            if query_lower in block.slug:
                score += 8
            if any(query_lower in tag for tag in block.tags):
                score += 5
            if query_lower in block.description.lower():
                score += 3
            if score > 0:
                scored.append((score, block.to_summary()))

        scored.sort(key=lambda x: -x[0])
        return [item for _, item in scored]

    def load_blocks(self, slugs: list[str]) -> str:
        """Load multiple blocks and combine their content into a single context string.

        This is the primary method used by the LLM prompt assembly pipeline.
        Returns a formatted string with each block's content clearly delimited.
        """
        self._ensure_loaded()
        parts: list[str] = []
        for slug in slugs:
            block = self._blocks.get(slug)
            if block:
                parts.append(
                    f"## Block: {block.name} ({block.category})\n\n"
                    f"{block.content}"
                )
            else:
                logger.warning("Block '%s' not found in registry", slug)
        return "\n\n---\n\n".join(parts)

    def get_block_index(self) -> str:
        """Return a compact index of all blocks for LLM collection suggestion.

        Format is compact enough to fit in a system prompt.
        """
        self._ensure_loaded()
        lines: list[str] = []
        by_category: dict[str, list[Block]] = {}
        for block in self._blocks.values():
            by_category.setdefault(block.category, []).append(block)

        for category in ["domain", "capability", "pattern"]:
            blocks = by_category.get(category, [])
            if not blocks:
                continue
            lines.append(f"\n### {category.title()} Blocks")
            for b in sorted(blocks, key=lambda x: x.name):
                tags_str = ", ".join(b.tags[:5])
                lines.append(f"- **{b.slug}**: {b.description[:120]} [{tags_str}]")

        return "\n".join(lines)

    @property
    def block_count(self) -> int:
        self._ensure_loaded()
        return len(self._blocks)


# Module-level singleton
registry = BlockRegistry()
