"""Block factory endpoint — decomposes documents into standard-format blocks."""

from __future__ import annotations

from fastapi import HTTPException

from ..core import Dependencies, create_router
from ..models import BlockFactoryRequest, BlockFactoryResponse
from ..services.block_factory import BlockFactory
from ..services.llm_service import LLMService

router = create_router()


@router.post(
    "/block-factory/process",
    response_model=BlockFactoryResponse,
    operation_id="processDocument",
)
def process_document(
    request: BlockFactoryRequest,
    ws: Dependencies.Client,
    config: Dependencies.Config,
):
    """Decompose a document into standard-format context blocks.

    Takes raw document text, uses LLM to identify distinct topics,
    then generates a properly formatted block for each topic.
    Set write=false for a dry-run preview without writing to disk.
    """
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Document content is empty")

    llm = LLMService(ws, config)
    factory = BlockFactory(llm)

    try:
        return factory.process(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Block factory failed: {e}")
