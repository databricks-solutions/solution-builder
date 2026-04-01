from __future__ import annotations

import io
import json
import zipfile

from fastapi import HTTPException, UploadFile
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import Generation, GenerationListItem, GenerationOut, StarRequest

router = create_router()


def _get_user_id(headers) -> str | None:
    """Extract user_id from Databricks Apps headers. Returns None in local dev."""
    return headers.user_id if headers and headers.user_id else None


def _get_user_generation(session, generation_id: int, user_id: str | None) -> Generation:
    """Fetch a generation by ID, verifying ownership if user_id is available."""
    row = session.get(Generation, generation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Generation not found")
    # Library items are public — skip ownership check
    if row.is_library:
        return row
    # If the caller has a user_id, verify they own this generation
    if user_id and row.user_id and row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Generation not found")
    return row


@router.get(
    "/generations",
    response_model=list[GenerationListItem],
    operation_id="listGenerations",
)
def list_generations(session: Dependencies.Session, headers: Dependencies.Headers):
    """Return the current user's past generations, newest first."""
    user_id = _get_user_id(headers)
    stmt = (
        select(Generation)
        .where(Generation.is_library == False)  # noqa: E712
        .order_by(Generation.created_at.desc())  # type: ignore[attr-defined]
    )
    if user_id:
        stmt = stmt.where(
            (Generation.user_id == user_id) | (Generation.user_id == None)  # noqa: E711
        )
    rows = session.exec(stmt).all()
    return [
        GenerationListItem(
            id=r.id,  # type: ignore[arg-type]
            demo_name=r.demo_name,
            industry=r.industry,
            stage=r.stage,
            is_starred=r.is_starred,
            created_at=r.created_at,
        )
        for r in rows
    ]


def _parse_skill_files(raw: str | None) -> dict[str, str] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


@router.post(
    "/generations/import",
    response_model=GenerationOut,
    operation_id="importGeneration",
)
def import_generation(
    file: UploadFile,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Import a previously downloaded zip back as a new generation."""
    raw = file.file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid zip.")

    # Collect markdown files, inferring demo_name from the top-level folder
    md_files: dict[str, str] = {}
    demo_name = ""
    for name in zf.namelist():
        if name.endswith("/"):
            continue
        parts = name.replace("\\", "/").split("/")
        if not demo_name and len(parts) >= 2:
            demo_name = parts[0]
        if name.endswith(".md"):
            filename = parts[-1]
            try:
                md_files[filename] = zf.read(name).decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(status_code=400, detail=f"File '{filename}' is not valid UTF-8 text.")

    if not md_files:
        raise HTTPException(status_code=400, detail="No markdown files found in zip.")

    skill_md = md_files.get("SKILL.md", next(iter(md_files.values())))
    # Ensure skill_md has YAML frontmatter with a name so workspace edits
    # don't overwrite demo_name with "untitled" via parse_skill_metadata.
    if not skill_md.startswith("---"):
        resolved_name = demo_name or (file.filename or "Imported").removesuffix(".zip")
        skill_md = f"---\nname: {resolved_name}\n---\n\n{skill_md}"
        md_files["SKILL.md"] = skill_md
    user_id = _get_user_id(headers)
    row = Generation(
        demo_name=demo_name or file.filename or "Imported",
        owner_name="AI Generated",
        user_id=user_id,
        industry=demo_name[:120] if demo_name else "Imported",
        form_json="{}",
        skill_md=skill_md,
        stage="package",
        skill_files=json.dumps(md_files),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return GenerationOut(
        id=row.id,  # type: ignore[arg-type]
        demo_name=row.demo_name,
        owner_name=row.owner_name,
        industry=row.industry,
        skill_md=row.skill_md,
        stage=row.stage,
        is_starred=row.is_starred,
        proposal_md=row.proposal_md,
        skill_files=_parse_skill_files(row.skill_files),
        created_at=row.created_at,
    )


@router.patch(
    "/generations/{generation_id}/star",
    response_model=GenerationListItem,
    operation_id="toggleGenerationStar",
)
def toggle_generation_star(
    generation_id: int,
    body: StarRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Toggle the starred state of a generation."""
    row = _get_user_generation(session, generation_id, _get_user_id(headers))
    row.is_starred = body.is_starred
    session.add(row)
    session.commit()
    session.refresh(row)
    return GenerationListItem(
        id=row.id,  # type: ignore[arg-type]
        demo_name=row.demo_name,
        industry=row.industry,
        stage=row.stage,
        is_starred=row.is_starred,
        created_at=row.created_at,
    )


@router.get(
    "/generations/{generation_id}",
    response_model=GenerationOut,
    operation_id="getGeneration",
)
def get_generation(
    generation_id: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Return a single generation by ID."""
    row = _get_user_generation(session, generation_id, _get_user_id(headers))
    return GenerationOut(
        id=row.id,  # type: ignore[arg-type]
        demo_name=row.demo_name,
        owner_name=row.owner_name,
        industry=row.industry,
        skill_md=row.skill_md,
        stage=row.stage,
        is_starred=row.is_starred,
        proposal_md=row.proposal_md,
        skill_files=_parse_skill_files(row.skill_files),
        created_at=row.created_at,
    )
