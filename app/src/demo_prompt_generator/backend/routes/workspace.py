from __future__ import annotations

import json

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import (
    Generation,
    WorkspaceGenerateRequest,
    WorkspaceRefineRequest,
)
from ..services.skill_generator import (
    parse_skill_metadata,
    stream_skill_from_topic,
    stream_skill_refinement,
    stream_section_refinement,
)

router = create_router()


def _strip_fences(content: str) -> str:
    """Remove wrapping ```markdown fences if the LLM added them."""
    text = content.strip()
    if text.startswith("```"):
        text = text[text.index("\n") + 1 :]
    if text.rstrip().endswith("```"):
        text = text[: text.rfind("```")]
    return text.strip()


@router.post("/workspace/generate", operation_id="workspaceGenerate")
async def workspace_generate(
    req: WorkspaceGenerateRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
):
    """Generate a full SKILL.md from a freeform topic, streaming via SSE."""
    host = config.databricks_host
    token = config.databricks_token
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    async def event_stream():
        collected = ""
        try:
            async for chunk in stream_skill_from_topic(req.topic, host, token, model=model):
                collected += chunk
                yield f"data: {json.dumps({'type': 'skill', 'content': chunk})}\n\n"

            skill_md = _strip_fences(collected)
            meta = parse_skill_metadata(skill_md)

            row = Generation(
                demo_name=meta["name"],
                owner_name="AI Generated",
                industry=req.topic[:120],
                form_json=json.dumps({"topic": req.topic}),
                skill_md=skill_md,
            )
            session.add(row)
            session.commit()
            session.refresh(row)

            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name, 'industry': row.industry})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _extract_section(skill_md: str, section_title: str) -> tuple[str, int, int] | None:
    """Find a ## section and return (content, header_line_idx, end_line_idx).

    Returns None if the section is not found.
    """
    lines = skill_md.split("\n")
    header = f"## {section_title}"
    start_idx = None

    for i, line in enumerate(lines):
        if line.strip() == header:
            start_idx = i
            break

    if start_idx is None:
        return None

    end_idx = len(lines)
    for i in range(start_idx + 1, len(lines)):
        if lines[i].startswith("## "):
            end_idx = i
            break

    content = "\n".join(lines[start_idx + 1 : end_idx])
    return content, start_idx, end_idx


def _splice_section(skill_md: str, section_title: str, new_content: str) -> str:
    """Replace a section's body while preserving the ## header and rest of doc."""
    lines = skill_md.split("\n")
    header = f"## {section_title}"
    start_idx = None

    for i, line in enumerate(lines):
        if line.strip() == header:
            start_idx = i
            break

    if start_idx is None:
        return skill_md

    end_idx = len(lines)
    for i in range(start_idx + 1, len(lines)):
        if lines[i].startswith("## "):
            end_idx = i
            break

    before = lines[: start_idx + 1]
    after = lines[end_idx:]
    return "\n".join(before + new_content.split("\n") + after)


@router.post("/workspace/refine", operation_id="workspaceRefine")
async def workspace_refine(
    req: WorkspaceRefineRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
):
    """Refine an existing SKILL.md based on user chat message, streaming via SSE."""
    host = config.databricks_host
    token = config.databricks_token
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = session.get(Generation, req.generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")

    history = [{"role": m.role, "content": m.content} for m in req.history]

    # --- Targeted single-section edit ---
    if len(req.focused_sections) == 1:
        section_title = req.focused_sections[0]
        section_info = _extract_section(row.skill_md, section_title)

        if not section_info:
            raise HTTPException(
                status_code=404,
                detail=f"Section '{section_title}' not found in skill",
            )

        section_content, _, _ = section_info

        async def section_stream():
            yield f"data: {json.dumps({'type': 'section_start', 'title': section_title})}\n\n"

            collected = ""
            try:
                async for chunk in stream_section_refinement(
                    section_title,
                    section_content,
                    req.message,
                    row.skill_md,
                    history,
                    host,
                    token,
                    model=model,
                ):
                    collected += chunk
                    yield f"data: {json.dumps({'type': 'skill', 'content': chunk})}\n\n"

                new_body = _strip_fences(collected)
                # Strip the header if the LLM included it anyway
                header_prefix = f"## {section_title}"
                stripped = new_body.lstrip()
                if stripped.startswith(header_prefix):
                    new_body = stripped[len(header_prefix) :].lstrip("\n")

                updated_skill = _splice_section(row.skill_md, section_title, new_body)
                meta = parse_skill_metadata(updated_skill)

                row.skill_md = updated_skill
                row.demo_name = meta["name"]
                session.add(row)
                session.commit()

                yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(section_stream(), media_type="text/event-stream")

    # --- Full skill refinement (default, or multi-section) ---
    async def event_stream():
        collected = ""
        try:
            async for chunk in stream_skill_refinement(
                row.skill_md, req.message, history, host, token, model=model,
                focused_sections=req.focused_sections or None,
            ):
                collected += chunk
                yield f"data: {json.dumps({'type': 'skill', 'content': chunk})}\n\n"

            skill_md = _strip_fences(collected)
            meta = parse_skill_metadata(skill_md)

            row.skill_md = skill_md
            row.demo_name = meta["name"]
            session.add(row)
            session.commit()

            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
