from __future__ import annotations

import io
import json
import zipfile

from fastapi import HTTPException, UploadFile
from sqlmodel import select

from ..core import Dependencies, create_router
from ..models import Generation, GenerationListItem, GenerationOut

router = create_router()


@router.get(
    "/generations",
    response_model=list[GenerationListItem],
    operation_id="listGenerations",
)
def list_generations(session: Dependencies.Session):
    """Return all past generations, newest first."""
    stmt = (
        select(Generation)
        .order_by(Generation.created_at.desc())  # type: ignore[attr-defined]
    )
    rows = session.exec(stmt).all()
    return [
        GenerationListItem(
            id=r.id,  # type: ignore[arg-type]
            demo_name=r.demo_name,
            industry=r.industry,
            stage=r.stage,
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
    row = Generation(
        demo_name=demo_name or file.filename or "Imported",
        owner_name="AI Generated",
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
        proposal_md=row.proposal_md,
        skill_files=_parse_skill_files(row.skill_files),
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
):
    """Return a single generation by ID."""
    row = session.get(Generation, generation_id)
    if not row:
        raise HTTPException(
            status_code=404, detail="Generation not found",
        )
    return GenerationOut(
        id=row.id,  # type: ignore[arg-type]
        demo_name=row.demo_name,
        owner_name=row.owner_name,
        industry=row.industry,
        skill_md=row.skill_md,
        stage=row.stage,
        proposal_md=row.proposal_md,
        skill_files=_parse_skill_files(row.skill_files),
        created_at=row.created_at,
    )
