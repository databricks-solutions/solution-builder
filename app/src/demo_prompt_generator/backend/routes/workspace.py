from __future__ import annotations

import asyncio
import io
import json
import zipfile

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import (
    Generation,
    PACKAGE_FILES,
    WorkspaceApproveRequest,
    WorkspaceBuildoutRequest,
    WorkspaceGenerateRequest,
    WorkspaceProposeRequest,
    WorkspaceRefineFileRequest,
    WorkspaceRefineRequest,
)
from ..services.docx_export import walkthrough_md_to_docx
from ..services.skill_generator import (
    parse_proposal_metadata,
    parse_skill_metadata,
    stream_buildout_file,
    stream_file_refinement,
    stream_proposal,
    stream_proposal_refinement,
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


def _resolve_credentials(config, ws_client):
    """Resolve host and token, falling back to WorkspaceClient SDK auth."""
    host = config.databricks_host
    token = config.databricks_token
    if not token and ws_client:
        headers = ws_client.config.authenticate()
        auth_header = headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
        if not host:
            host = ws_client.config.host
    return host, token


@router.post("/workspace/generate", operation_id="workspaceGenerate")
async def workspace_generate(
    req: WorkspaceGenerateRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
):
    """Generate a full SKILL.md from a freeform topic, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
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
    ws_client: Dependencies.Client,
):
    """Refine an existing SKILL.md based on user chat message, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
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


# ---------------------------------------------------------------------------
# Stage 1: Proposal endpoints
# ---------------------------------------------------------------------------


@router.post("/workspace/propose", operation_id="workspacePropose")
async def workspace_propose(
    req: WorkspaceProposeRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
):
    """Generate a demo proposal (storyline + architecture) from a topic, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    async def event_stream():
        collected = ""
        try:
            async for chunk in stream_proposal(req.topic, host, token, model=model):
                collected += chunk
                yield f"data: {json.dumps({'type': 'proposal', 'content': chunk})}\n\n"

            proposal_md = _strip_fences(collected)
            meta = parse_proposal_metadata(proposal_md)

            row = Generation(
                demo_name=meta["name"],
                owner_name="AI Generated",
                industry=req.topic[:120],
                form_json=json.dumps({"topic": req.topic}),
                skill_md="",
                stage="proposal",
                proposal_md=proposal_md,
            )
            session.add(row)
            session.commit()
            session.refresh(row)

            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name, 'industry': row.industry})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/propose/refine", operation_id="workspaceProposeRefine")
async def workspace_propose_refine(
    req: WorkspaceRefineRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
):
    """Refine an existing proposal based on user chat, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = session.get(Generation, req.generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")

    history = [{"role": m.role, "content": m.content} for m in req.history]

    async def event_stream():
        collected = ""
        try:
            async for chunk in stream_proposal_refinement(
                row.proposal_md or "",
                req.message,
                history,
                host, token,
                model=model,
                focused_sections=req.focused_sections or None,
            ):
                collected += chunk
                yield f"data: {json.dumps({'type': 'proposal', 'content': chunk})}\n\n"

            proposal_md = _strip_fences(collected)
            meta = parse_proposal_metadata(proposal_md)

            row.proposal_md = proposal_md
            row.demo_name = meta["name"]
            session.add(row)
            session.commit()

            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/approve", operation_id="workspaceApprove")
async def workspace_approve(
    req: WorkspaceApproveRequest,
    session: Dependencies.Session,
):
    """Approve a proposal, transitioning it to the buildout stage."""
    row = session.get(Generation, req.generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")
    if row.stage != "proposal":
        raise HTTPException(status_code=400, detail="Generation is not in proposal stage")

    row.stage = "approved"
    session.add(row)
    session.commit()
    session.refresh(row)

    return {"id": row.id, "stage": row.stage, "demo_name": row.demo_name}


# ---------------------------------------------------------------------------
# Stage 2: Multi-file buildout endpoints
# ---------------------------------------------------------------------------


@router.post("/workspace/buildout", operation_id="workspaceBuildout")
async def workspace_buildout(
    req: WorkspaceBuildoutRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
):
    """Sequentially generate all package files from an approved proposal, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = session.get(Generation, req.generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")
    if not row.proposal_md:
        raise HTTPException(status_code=400, detail="No proposal to build from")

    user_arch = req.user_architecture

    async def event_stream():
        generated_files: dict[str, str] = {}
        try:
            for filename in PACKAGE_FILES:
                yield f"data: {json.dumps({'type': 'file_start', 'filename': filename})}\n\n"

                collected = ""
                # Wrap the LLM stream with a keepalive: if no chunk arrives
                # within 15s, send an SSE comment to prevent proxy timeouts.
                llm_stream = stream_buildout_file(
                    filename, row.proposal_md, generated_files, host, token, model=model,
                    user_architecture=user_arch,
                )
                while True:
                    try:
                        chunk = await asyncio.wait_for(llm_stream.__anext__(), timeout=15.0)
                        collected += chunk
                        yield f"data: {json.dumps({'type': 'file_content', 'filename': filename, 'content': chunk})}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                    except StopAsyncIteration:
                        break

                clean = _strip_fences(collected)
                generated_files[filename] = clean
                yield f"data: {json.dumps({'type': 'file_complete', 'filename': filename})}\n\n"

            row.skill_md = generated_files.get("SKILL.md", "")
            row.skill_files = json.dumps(generated_files)
            row.stage = "package"
            meta = parse_skill_metadata(row.skill_md)
            row.demo_name = meta["name"]
            session.add(row)
            session.commit()

            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/refine-file", operation_id="workspaceRefineFile")
async def workspace_refine_file(
    req: WorkspaceRefineFileRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
):
    """Refine a single package file via chat, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = session.get(Generation, req.generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")

    all_files: dict[str, str] = json.loads(row.skill_files) if row.skill_files else {}
    if req.filename not in all_files:
        raise HTTPException(status_code=404, detail=f"File '{req.filename}' not found in package")

    history = [{"role": m.role, "content": m.content} for m in req.history]

    async def event_stream():
        collected = ""
        try:
            yield f"data: {json.dumps({'type': 'file_start', 'filename': req.filename})}\n\n"
            async for chunk in stream_file_refinement(
                req.filename,
                all_files[req.filename],
                all_files,
                row.proposal_md or "",
                req.message,
                history,
                host, token,
                model=model,
            ):
                collected += chunk
                yield f"data: {json.dumps({'type': 'file_content', 'filename': req.filename, 'content': chunk})}\n\n"

            clean = _strip_fences(collected)
            all_files[req.filename] = clean
            row.skill_files = json.dumps(all_files)
            if req.filename == "SKILL.md":
                row.skill_md = clean
                meta = parse_skill_metadata(clean)
                row.demo_name = meta["name"]
            session.add(row)
            session.commit()

            yield f"data: {json.dumps({'type': 'file_complete', 'filename': req.filename})}\n\n"
            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/workspace/{generation_id}/download", operation_id="workspaceDownload")
async def workspace_download(
    generation_id: int,
    session: Dependencies.Session,
):
    """Download all package files as a zip archive."""
    row = session.get(Generation, generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")

    all_files: dict[str, str] = {}
    if row.skill_files:
        all_files = json.loads(row.skill_files)
    elif row.skill_md:
        all_files = {"SKILL.md": row.skill_md}

    if not all_files:
        raise HTTPException(status_code=404, detail="No files to download")

    buf = io.BytesIO()
    folder = row.demo_name or "demo-package"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in all_files.items():
            zf.writestr(f"{folder}/{fname}", content)
        # Auto-generate walkthrough.docx from walkthrough.md
        walkthrough_md = all_files.get("walkthrough.md")
        if walkthrough_md:
            docx_bytes = walkthrough_md_to_docx(walkthrough_md, demo_name=row.demo_name or "Demo")
            zf.writestr(f"{folder}/walkthrough.docx", docx_bytes)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder}.zip"'},
    )
