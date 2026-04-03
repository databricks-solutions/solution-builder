"""Block registry API: browse, search, create, update, and delete structured context blocks."""

from __future__ import annotations

import re

from fastapi import HTTPException

from ..core import Dependencies, create_router
from ..models import BlockCreateRequest
from ..services.block_registry import Block, registry

router = create_router()

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")


def _validate_slug(slug: str) -> None:
    if not slug or len(slug) > 128 or not _SLUG_RE.match(slug):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid slug '{slug}'. Must be lowercase kebab-case (a-z, 0-9, hyphens), 2-128 chars.",
        )


@router.get(
    "/blocks",
    operation_id="listBlocks",
)
def list_blocks(
    category: str | None = None,
    tags: str | None = None,
):
    """List all blocks, optionally filtered by category and/or tags."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    return registry.list_blocks(category=category, tags=tag_list)


@router.get(
    "/blocks/search",
    operation_id="searchBlocks",
)
def search_blocks(q: str = ""):
    """Search blocks by name, description, and tags."""
    if not q.strip():
        return registry.list_blocks()
    return registry.search_blocks(q)


@router.get(
    "/blocks/index",
    operation_id="getBlockIndex",
)
def get_block_index():
    """Get a compact text index of all blocks (for LLM prompt assembly)."""
    return {"index": registry.get_block_index(), "count": registry.block_count}


@router.get(
    "/blocks/{slug}",
    operation_id="getBlock",
)
def get_block(slug: str):
    """Get a single block by slug, including full content."""
    block = registry.get_block(slug)
    if not block:
        raise HTTPException(status_code=404, detail=f"Block '{slug}' not found")
    return block


@router.post(
    "/blocks",
    operation_id="createBlock",
)
def create_block(
    req: BlockCreateRequest,
    headers: Dependencies.Headers,
):
    """Create a new block."""
    _validate_slug(req.slug)
    existing = registry.get_block(req.slug)
    if existing:
        raise HTTPException(status_code=409, detail=f"Block '{req.slug}' already exists")

    block = Block(
        slug=req.slug,
        name=req.name,
        category=req.category,
        tags=req.tags,
        description=req.description,
        content=req.content,
        related=req.related,
    )
    created_by = headers.user_name or ""
    registry.save_block(block, created_by=created_by)
    return block.to_full()


@router.put(
    "/blocks/{slug}",
    operation_id="updateBlock",
)
def update_block(
    slug: str,
    req: BlockCreateRequest,
    headers: Dependencies.Headers,
):
    """Update an existing block. Slug is immutable — use the URL path slug."""
    existing = registry.get_block(slug)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Block '{slug}' not found")

    block = Block(
        slug=slug,  # immutable — always use the URL path slug
        name=req.name,
        category=req.category,
        tags=req.tags,
        description=req.description,
        content=req.content,
        related=req.related,
    )
    created_by = headers.user_name or ""
    registry.save_block(block, created_by=created_by)
    return block.to_full()


@router.delete(
    "/blocks/{slug}",
    operation_id="deleteBlock",
)
def delete_block(
    slug: str,
    headers: Dependencies.Headers,
):
    """Delete a block."""
    if not registry.delete_block(slug):
        raise HTTPException(status_code=404, detail=f"Block '{slug}' not found")
    return {"deleted": slug}
