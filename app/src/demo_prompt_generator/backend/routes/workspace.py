from __future__ import annotations

import asyncio
import io
import json
import logging
import zipfile

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import (
    Generation,
    PACKAGE_FILES,
    WorkspaceAgentRefineRequest,
    WorkspaceApproveRequest,
    WorkspaceBuildRequest,
    WorkspaceBuildoutFileRequest,
    WorkspaceBuildoutRequest,
    WorkspaceGenerateRequest,
    WorkspaceProposeRequest,
    WorkspaceBuildoutSaveRequest,
    WorkspaceRefineFileRequest,
    WorkspaceRefineRequest,
)
from .generations import _get_user_id, _get_user_generation
from ..services.build_executor import stream_build_execution
from ..services.docx_export import walkthrough_md_to_docx
from ..services.skill_generator import (
    parse_proposal_metadata,
    parse_skill_metadata,
    stream_agent_refine,
    stream_buildout_file,
    stream_file_refinement,
    stream_proposal,
    stream_proposal_refinement,
    stream_skill_from_topic,
    stream_skill_refinement,
    stream_section_refinement,
)

logger = logging.getLogger(__name__)

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
    headers: Dependencies.Headers,
):
    """Generate a full SKILL.md from a freeform topic, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model
    user_id = _get_user_id(headers)

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
                owner_name=headers.user_name or "AI Generated",
                user_id=user_id,
                industry=req.topic[:120],
                form_json=json.dumps({"topic": req.topic}),
                skill_md=skill_md,
            )
            session.add(row)
            session.commit()
            session.refresh(row)

            yield f"data: {json.dumps({'type': 'complete', 'id': row.id, 'demo_name': row.demo_name, 'industry': row.industry})}\n\n"
        except Exception as e:
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
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
    headers: Dependencies.Headers,
):
    """Refine an existing SKILL.md based on user chat message, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))

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
                logger.exception("SSE stream error")
                yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
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
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
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
    headers: Dependencies.Headers,
):
    """Generate a demo proposal (storyline + architecture) from a topic, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model
    user_id = _get_user_id(headers)

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
                owner_name=headers.user_name or "AI Generated",
                user_id=user_id,
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
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/propose/refine", operation_id="workspaceProposeRefine")
async def workspace_propose_refine(
    req: WorkspaceRefineRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
    headers: Dependencies.Headers,
):
    """Refine an existing proposal based on user chat, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))

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
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/approve", operation_id="workspaceApprove")
async def workspace_approve(
    req: WorkspaceApproveRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Approve a proposal, transitioning it to the buildout stage."""
    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))
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
    headers: Dependencies.Headers,
):
    """Sequentially generate all package files from an approved proposal, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))
    if not row.proposal_md:
        raise HTTPException(status_code=400, detail="No proposal to build from")

    user_arch = req.user_architecture

    _SENTINEL = object()

    async def _stream_to_queue(
        queue: asyncio.Queue,
        filename: str,
        proposal_md: str,
        generated_files: dict[str, str],
        host: str,
        token: str,
        model: str,
        user_arch: str | None,
    ):
        """Run LLM stream in a task, pushing chunks into a queue."""
        try:
            async for chunk in stream_buildout_file(
                filename, proposal_md, generated_files, host, token, model=model,
                user_architecture=user_arch,
            ):
                await queue.put(chunk)
        except Exception as exc:
            await queue.put(exc)
        finally:
            await queue.put(_SENTINEL)

    async def event_stream():
        generated_files: dict[str, str] = {}
        try:
            for filename in PACKAGE_FILES:
                yield f"data: {json.dumps({'type': 'file_start', 'filename': filename})}\n\n"

                collected = ""
                queue: asyncio.Queue = asyncio.Queue()
                task = asyncio.create_task(_stream_to_queue(
                    queue, filename, row.proposal_md, generated_files,
                    host, token, model, user_arch,
                ))

                consecutive_keepalives = 0
                while True:
                    try:
                        item = await asyncio.wait_for(queue.get(), timeout=5.0)
                    except asyncio.TimeoutError:
                        consecutive_keepalives += 1
                        if consecutive_keepalives > 60:
                            yield f"data: {json.dumps({'type': 'error', 'content': 'Stream timed out waiting for LLM response'})}\n\n"
                            break
                        yield ": keepalive\n\n"
                        continue
                    consecutive_keepalives = 0
                    if item is _SENTINEL:
                        break
                    if isinstance(item, Exception):
                        raise item
                    collected += item
                    yield f"data: {json.dumps({'type': 'file_content', 'filename': filename, 'content': item})}\n\n"

                await task  # propagate any unhandled errors

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
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/buildout-file", operation_id="workspaceBuildoutFile")
async def workspace_buildout_file(
    req: WorkspaceBuildoutFileRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
    headers: Dependencies.Headers,
):
    """Generate a single buildout file, streaming via SSE. Called per-file from the frontend."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))
    if not row.proposal_md:
        raise HTTPException(status_code=400, detail="No proposal to build from")

    if req.filename not in PACKAGE_FILES:
        raise HTTPException(status_code=400, detail=f"Unknown file: {req.filename}")

    _SENTINEL = object()

    async def _stream_to_queue(queue: asyncio.Queue):
        try:
            async for chunk in stream_buildout_file(
                req.filename, row.proposal_md, req.generated_files, host, token,
                model=model, user_architecture=req.user_architecture,
            ):
                await queue.put(chunk)
        except Exception as exc:
            await queue.put(exc)
        finally:
            await queue.put(_SENTINEL)

    async def event_stream():
        try:
            queue: asyncio.Queue = asyncio.Queue()
            task = asyncio.create_task(_stream_to_queue(queue))
            collected = ""

            consecutive_keepalives = 0
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    consecutive_keepalives += 1
                    if consecutive_keepalives > 60:
                        yield f"data: {json.dumps({'type': 'error', 'content': 'Stream timed out waiting for LLM response'})}\n\n"
                        break
                    yield ": keepalive\n\n"
                    continue
                consecutive_keepalives = 0
                if item is _SENTINEL:
                    break
                if isinstance(item, Exception):
                    raise item
                collected += item
                yield f"data: {json.dumps({'type': 'file_content', 'filename': req.filename, 'content': item})}\n\n"

            await task
            clean = _strip_fences(collected)
            yield f"data: {json.dumps({'type': 'file_complete', 'filename': req.filename, 'content': clean})}\n\n"
        except Exception as e:
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/buildout-save", operation_id="workspaceBuildoutSave")
async def workspace_buildout_save(
    req: WorkspaceBuildoutSaveRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Save partial buildout progress (completed files so far) without finalizing."""
    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))

    row.skill_files = json.dumps(req.files)
    row.stage = "building"
    session.add(row)
    session.commit()
    return {"id": row.id, "files_saved": len(req.files)}


@router.post("/workspace/buildout-finalize", operation_id="workspaceBuildoutFinalize")
async def workspace_buildout_finalize(
    req: WorkspaceBuildoutRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
    headers: Dependencies.Headers,
):
    """Save all generated files to the database after per-file buildout completes."""
    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))

    payload = req.files_payload or req.user_architecture
    if not payload:
        raise HTTPException(status_code=400, detail="No files provided")

    try:
        generated_files: dict[str, str] = json.loads(payload)
    except (json.JSONDecodeError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid files payload: {e}")
    row.skill_md = generated_files.get("SKILL.md", "")
    row.skill_files = json.dumps(generated_files)
    row.stage = "package"
    meta = parse_skill_metadata(row.skill_md)
    row.demo_name = meta["name"]
    session.add(row)
    session.commit()

    return {"id": row.id, "demo_name": row.demo_name, "stage": "package"}


@router.post("/workspace/refine-file", operation_id="workspaceRefineFile")
async def workspace_refine_file(
    req: WorkspaceRefineFileRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
    headers: Dependencies.Headers,
):
    """Refine a single package file via chat, streaming via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))

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
            logger.exception("SSE stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': 'An internal error occurred. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/workspace/agent-refine", operation_id="workspaceAgentRefine")
async def workspace_agent_refine(
    req: WorkspaceAgentRefineRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
    headers: Dependencies.Headers,
):
    """Agentic cross-file editing: the LLM decides which files to read/write."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))

    all_files: dict[str, str] = json.loads(row.skill_files) if row.skill_files else {}
    if not all_files:
        raise HTTPException(status_code=400, detail="No package files to edit")

    history = [{"role": m.role, "content": m.content} for m in req.history]

    # Run agent loop to completion, collect events, then persist and stream.
    # stream_agent_refine mutates `final_files` via its internal working_files reference.
    final_files = dict(all_files)
    events: list[dict] = []
    try:
        async for event in stream_agent_refine(
            final_files,
            req.message,
            history,
            host, token,
            model=model,
        ):
            events.append(event)
    except Exception:
        logger.exception("Agent refine failed")
        events.append({"type": "error", "content": "An internal error occurred. Please try again."})

    # Persist updated files
    row.skill_files = json.dumps(final_files)
    if "SKILL.md" in final_files:
        row.skill_md = final_files["SKILL.md"]
        meta = parse_skill_metadata(final_files["SKILL.md"])
        row.demo_name = meta["name"]
    session.add(row)
    session.commit()

    events.append({"type": "complete", "id": row.id, "demo_name": row.demo_name})

    async def replay_stream():
        for event in events:
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(replay_stream(), media_type="text/event-stream")


@router.get("/workspace/{generation_id}/download", operation_id="workspaceDownload")
async def workspace_download(
    generation_id: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Download all package files as a zip archive."""
    row = _get_user_generation(session, generation_id, _get_user_id(headers))

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


# ---------------------------------------------------------------------------
# Build phase: execute package via agent loop
# ---------------------------------------------------------------------------


@router.post("/workspace/build", operation_id="workspaceBuild")
async def workspace_build(
    req: WorkspaceBuildRequest,
    config: Dependencies.Config,
    session: Dependencies.Session,
    ws_client: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    headers: Dependencies.Headers,
):
    """Execute a completed package by spawning a build agent, streaming progress via SSE."""
    host, token = _resolve_credentials(config, ws_client)
    model = config.llm_model

    if not host or not token:
        raise HTTPException(status_code=500, detail="Databricks host/token not configured")

    row = _get_user_generation(session, req.generation_id, _get_user_id(headers))
    if row.stage not in ("package", "execute_error", "built"):
        raise HTTPException(
            status_code=400,
            detail=f"Generation must be in 'package' stage to build (current: {row.stage})",
        )

    all_files: dict[str, str] = json.loads(row.skill_files) if row.skill_files else {}
    if not all_files:
        raise HTTPException(status_code=400, detail="No package files to build from")

    # Get user email for scoping
    try:
        user_email = user_ws.current_user.me().user_name or "unknown"
    except Exception:
        user_email = "unknown"

    # Transition stage
    row.stage = "executing"
    session.add(row)
    session.commit()

    async def event_stream():
        final_stage = "built"
        try:
            async for event in stream_build_execution(
                files=all_files,
                user_email=user_email,
                demo_name=row.demo_name or "demo",
                generation_id=row.id,
                databricks_host=host,
                databricks_token=token,
                model=model,
            ):
                if event.get("type") == "build_error":
                    final_stage = "execute_error"
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.exception("Build stream error")
            final_stage = "execute_error"
            yield f"data: {json.dumps({'type': 'build_error', 'content': str(e)})}\n\n"
        finally:
            row.stage = final_stage
            session.add(row)
            session.commit()
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
