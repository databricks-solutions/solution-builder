"""Collections API: browse, create, update, and delete curated block groups."""

from __future__ import annotations

import json

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ..core import Dependencies, create_router
from ..models import CollectionCreateRequest
from ..services.collection_service import Collection, OutputFile, collection_service

router = create_router()


@router.get(
    "/collections",
    operation_id="listCollections",
)
def list_collections():
    """List all available collections (summary only)."""
    return collection_service.list_collections()


@router.get(
    "/collections/match",
    operation_id="matchCollection",
)
def match_collection(topic: str = ""):
    """Check if a topic matches an existing collection via keyword scoring."""
    match = collection_service.match_topic(topic)
    return {"match": match}


@router.get(
    "/collections/{slug}",
    operation_id="getCollection",
)
def get_collection(slug: str):
    """Get a single collection with full details and resolved block content."""
    coll = collection_service.get_collection(slug)
    if not coll:
        raise HTTPException(status_code=404, detail=f"Collection '{slug}' not found")
    return coll


@router.post(
    "/collections",
    operation_id="createCollection",
)
def create_collection(
    req: CollectionCreateRequest,
    headers: Dependencies.Headers,
):
    """Create a new collection."""
    existing = collection_service.get_collection_obj(req.slug)
    if existing:
        raise HTTPException(status_code=409, detail=f"Collection '{req.slug}' already exists")

    coll = Collection(
        slug=req.slug,
        name=req.name,
        description=req.description,
        industry=req.industry,
        block_slugs=req.block_slugs,
        output_files=[
            OutputFile(f["filename"], f["purpose"], f.get("depends_on", []))
            for f in req.output_files
        ],
    )
    created_by = headers.user_name or ""
    collection_service.save_collection(coll, created_by=created_by)
    return coll.to_full()


@router.put(
    "/collections/{slug}",
    operation_id="updateCollection",
)
def update_collection(
    slug: str,
    req: CollectionCreateRequest,
    headers: Dependencies.Headers,
):
    """Update an existing collection."""
    existing = collection_service.get_collection_obj(slug)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Collection '{slug}' not found")

    coll = Collection(
        slug=req.slug,
        name=req.name,
        description=req.description,
        industry=req.industry,
        block_slugs=req.block_slugs,
        output_files=[
            OutputFile(f["filename"], f["purpose"], f.get("depends_on", []))
            for f in req.output_files
        ],
    )
    created_by = headers.user_name or ""
    collection_service.save_collection(coll, created_by=created_by)
    return coll.to_full()


@router.delete(
    "/collections/{slug}",
    operation_id="deleteCollection",
)
def delete_collection(
    slug: str,
    headers: Dependencies.Headers,
):
    """Delete a collection."""
    if not collection_service.delete_collection(slug):
        raise HTTPException(status_code=404, detail=f"Collection '{slug}' not found")
    return {"deleted": slug}


@router.post(
    "/collections/output-files",
    operation_id="suggestOutputFiles",
)
async def suggest_output_files(
    req: dict,
    config: Dependencies.Config,
    ws_client: Dependencies.Client,
):
    """Suggest output files for a given set of blocks."""
    import httpx

    block_slugs = req.get("block_slugs", [])
    if not block_slugs:
        raise HTTPException(status_code=400, detail="block_slugs is required")

    host = config.databricks_host
    token = config.databricks_token
    if not token and ws_client:
        headers_dict = ws_client.config.authenticate()
        auth_header = headers_dict.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
        if not host:
            host = ws_client.config.host

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    model = config.llm_model
    system_prompt = collection_service.suggest_output_files_prompt(block_slugs)

    url = f"{host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Suggest output files for these blocks: {', '.join(block_slugs)}"},
        ],
        "max_tokens": 1024,
        "temperature": 0.3,
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=30.0, read=60.0, write=30.0, pool=30.0)
    ) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"]
    clean = content.strip()
    if clean.startswith("```"):
        clean = clean[clean.index("\n") + 1:]
    if clean.rstrip().endswith("```"):
        clean = clean[:clean.rfind("```")]

    try:
        output_files = json.loads(clean.strip())
        return {"output_files": output_files}
    except json.JSONDecodeError:
        return {"output_files": [], "raw": content}


@router.post(
    "/collections/modify",
    operation_id="modifyCollectionBlocks",
)
async def modify_collection_blocks(
    req: dict,
    config: Dependencies.Config,
    ws_client: Dependencies.Client,
):
    """Use the LLM to modify a collection's blocks based on natural language.

    Takes: {block_slugs: [...], message: "swap retail for healthcare"}
    Returns: {updated_slugs: [...], explanation: "..."}
    """
    import httpx
    from ..services.block_registry import registry

    current_slugs = req.get("block_slugs", [])
    message = req.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    host = config.databricks_host
    token = config.databricks_token
    if not token and ws_client:
        headers_dict = ws_client.config.authenticate()
        auth_header = headers_dict.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
        if not host:
            host = ws_client.config.host

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    # Build context: all available blocks + current selection
    block_index = registry.get_block_index()

    system_prompt = f"""\
You modify a collection's block list based on the user's request.

# Available Blocks
{block_index}

# Current Collection Blocks
{json.dumps(current_slugs)}

# Instructions
The user wants to change which blocks are in this collection.
Respond with ONLY a JSON object:
{{
  "updated_slugs": ["slug1", "slug2", ...],
  "explanation": "Brief description of what changed"
}}

Rules:
- Return the COMPLETE updated list (not just additions/removals)
- Only use slugs from the Available Blocks list above
- Keep blocks that the user didn't ask to change
- If the user asks to "use X" or "switch to X", swap the domain block
- If the user asks to "add X", add it to the list
- If the user asks to "remove X", remove it from the list
- Output ONLY valid JSON, no commentary"""

    model = config.llm_model
    url = f"{host.rstrip('/')}/serving-endpoints/{model}/invocations"
    req_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=30.0, read=60.0, write=30.0, pool=30.0)
    ) as client:
        resp = await client.post(url, json=payload, headers=req_headers)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"]
    clean = content.strip()
    if clean.startswith("```"):
        clean = clean[clean.index("\n") + 1:]
    if clean.rstrip().endswith("```"):
        clean = clean[:clean.rfind("```")]

    try:
        result = json.loads(clean.strip())
        return result
    except json.JSONDecodeError:
        return {"updated_slugs": current_slugs, "explanation": "Could not parse LLM response", "raw": content}


@router.post(
    "/collections/suggest",
    operation_id="suggestCollection",
)
async def suggest_collection(
    req: dict,
    config: Dependencies.Config,
    ws_client: Dependencies.Client,
):
    """Ask the LLM to suggest a collection for a given topic.

    Returns streaming JSON with the suggested collection manifest.
    """
    import httpx

    topic = req.get("topic", "")
    if not topic:
        raise HTTPException(status_code=400, detail="topic is required")

    host = config.databricks_host
    token = config.databricks_token
    if not token and ws_client:
        headers_dict = ws_client.config.authenticate()
        auth_header = headers_dict.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
        if not host:
            host = ws_client.config.host

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    model = config.llm_model
    system_prompt = collection_service.suggest_collection_prompt(topic)

    url = f"{host.rstrip('/')}/serving-endpoints/{model}/invocations"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Suggest a collection for this use-case:\n\n{topic}"},
        ],
        "max_tokens": 2048,
        "temperature": 0.5,
        "stream": True,
    }

    async def event_stream():
        collected = ""
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=30.0)
            ) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        chunk = line[6:]
                        if chunk == "[DONE]":
                            break
                        try:
                            data = json.loads(chunk)
                            delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if delta:
                                collected += delta
                                yield f"data: {json.dumps({'type': 'suggestion', 'content': delta})}\n\n"
                        except (json.JSONDecodeError, IndexError, KeyError):
                            continue

            # Try to parse the collected JSON
            clean = collected.strip()
            if clean.startswith("```"):
                clean = clean[clean.index("\n") + 1:]
            if clean.rstrip().endswith("```"):
                clean = clean[:clean.rfind("```")]

            suggested = json.loads(clean.strip())
            yield f"data: {json.dumps({'type': 'complete', 'collection': suggested})}\n\n"
        except json.JSONDecodeError:
            yield f"data: {json.dumps({'type': 'complete', 'collection': None, 'raw': collected})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
