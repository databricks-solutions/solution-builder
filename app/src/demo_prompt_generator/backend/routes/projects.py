"""Projects CRUD endpoints."""

from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
from datetime import datetime, timezone

from databricks.sdk import WorkspaceClient
from fastapi import HTTPException, Request
from sqlmodel import func, select, text

from ..core import Dependencies, create_router
from ..core._config import logger
from ..core.auth import is_admin
from ..services.llm_service import LLMService, ModelSize
from ..models import (
    DescriptionAiEditRequest,
    DescriptionAiEditResponse,
    Message,
    Project,
    ProjectCreateRequest,
    ProjectFile,
    ProjectListItem,
    ProjectOut,
    ProjectResourcesUpdateRequest,
    ProjectShare,
    ProjectShareOut,
    ProjectShareRequest,
    ProjectStar,
    ProjectUpdateRequest,
    Template,
    compute_project_stage,
)
from ..services.file_sync import FileSyncService
from ..services.skills_manager import (
    create_project_directory,
    get_project_directory,
)
from .resources import list_clusters, list_warehouses

router = create_router()

# Default resource settings
DEFAULT_CATALOG = "ai_demo_gen"
DEFAULT_SCHEMA_PREFIX = "demo_"


def _find_shared_warehouse(ws) -> tuple[str | None, str | None]:
    """Find a warehouse with 'shared' in the name (uses cached list).

    Returns (warehouse_id, warehouse_name) tuple.
    """
    try:
        warehouses = list_warehouses(ws)
        for w in warehouses:
            if "shared" in w.name.lower():
                logger.info(f"Found shared warehouse: {w.name} ({w.id})")
                return w.id, w.name
    except Exception as e:
        logger.warning(f"Failed to find shared warehouse: {e}")
    return None, None


def _find_shared_cluster(ws) -> tuple[str | None, str | None]:
    """Find a cluster with 'shared' in the name (uses cached list).

    Returns (cluster_id, cluster_name) tuple.
    Returns (None, None) if no shared cluster found - cluster is optional.
    """
    try:
        clusters = list_clusters(ws)
        for c in clusters:
            if "shared" in c.name.lower():
                logger.info(f"Found shared cluster: {c.name} ({c.id})")
                return c.id, c.name
        logger.info("No shared cluster found, leaving cluster_id empty")
    except Exception as e:
        logger.warning(f"Failed to find shared cluster: {e}")
    return None, None


def _generate_schema_name(project_name: str) -> str:
    """Generate a valid schema name from project name."""
    # Convert to lowercase, replace non-alphanumeric with underscore
    clean_name = re.sub(r"[^a-z0-9]+", "_", project_name.lower())
    # Remove leading/trailing underscores
    clean_name = clean_name.strip("_")
    # Limit length
    clean_name = clean_name[:50]
    return f"{DEFAULT_SCHEMA_PREFIX}{clean_name}"


def _generate_project_metadata(llm: LLMService, description: str) -> dict[str, str]:
    """Generate project name, description, and schema name from user prompt via LLM."""
    prompt = f"""Based on this demo description, return JSON:
{{
    "name": "Short Demo Name (max 100 chars)",
    "description": "Brief summary (max 200 chars)",
    "schema_name": "sql_safe_lowercase_name"
}}

User prompt:
{description[:4000]}
"""
    try:
        result = llm.chat_json(prompt, size=ModelSize.MINI, max_tokens=300)
        name = result.get("name", "Untitled Demo")[:100]
        short_desc = result.get("description", "")[:200]
        schema_name = result.get("schema_name", "demo")
        schema_name = re.sub(r"[^a-z0-9_]", "_", schema_name.lower())
        schema_name = re.sub(r"_+", "_", schema_name).strip("_")
        if not schema_name or not schema_name[0].isalpha():
            schema_name = "demo_" + schema_name
        return {"name": name, "description": short_desc, "schema_name": schema_name[:50]}
    except Exception as e:
        logger.error(f"Failed to generate project metadata: {e}")
        first_line = description.split("\n")[0].strip()[:100]
        return {"name": first_line or "Untitled Demo", "description": "", "schema_name": "demo_project"}


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


def _resolve_template_name(session, source_template_id: str | None) -> str | None:
    """Look up the template name for a source_template_id, if set."""
    if not source_template_id:
        return None
    template = session.get(Template, source_template_id)
    return template.name if template else None


def _ensure_default_schema(
    user_ws,
    *,
    warehouse_id: str | None,
    catalog: str,
    schema: str,
    project_id: str,
) -> None:
    """Create `catalog.schema` on the user's behalf using their OBO client.

    Soft-fails: any error (no warehouse, permission denied, warehouse asleep,
    network blip) is logged and swallowed. The agent will retry later if it
    needs the schema, and the user can change the default catalog/schema from
    Settings.
    """
    if not warehouse_id:
        logger.warning(
            f"[{project_id}] no shared warehouse — skipping default-schema create"
        )
        return
    statement = (
        f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}` "
        f"COMMENT 'Generated by Demo Prompt Generator for project {project_id}'"
    )
    try:
        resp = user_ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=statement,
            wait_timeout="30s",
        )
        state = resp.status.state if resp.status else None
        if state and str(state).endswith("SUCCEEDED"):
            logger.info(
                f"[{project_id}] provisioned default schema {catalog}.{schema}"
            )
        else:
            err = resp.status.error.message if resp.status and resp.status.error else f"state={state}"
            logger.warning(
                f"[{project_id}] default-schema create returned non-SUCCEEDED state: {err}"
            )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            f"[{project_id}] default-schema create failed for {catalog}.{schema}: {e}"
        )


def _get_authorized_project(
    session, project_id: str, user_email: str, admin_emails: list[str]
) -> Project:
    """Fetch a project by ID, verifying owner OR admin OR share-recipient.

    Used on every project-scoped endpoint, read AND mutation. Admins get
    full access (read + write) so they can support users debugging their
    own demos and clean up stuck state without playing impersonation
    games. Share recipients keep their existing access.

    One query: LEFT JOIN ProjectShare so a share grant is fetched in the
    same round-trip. The in-memory owner/admin check still short-circuits
    before we look at the share row.
    """
    row = session.exec(
        select(Project, ProjectShare)
        .outerjoin(
            ProjectShare,
            (ProjectShare.project_id == Project.id)
            & (ProjectShare.shared_with_email == user_email),
        )
        .where(Project.id == project_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project, share = row
    if (
        project.user_email == user_email
        or is_admin(user_email, admin_emails)
        or share is not None
    ):
        return project
    raise HTTPException(status_code=404, detail="Project not found")


@router.get(
    "/projects",
    response_model=list[ProjectListItem],
    operation_id="listProjects",
)
def list_projects(
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    include_all: bool = False,
):
    """Return the current user's projects, newest first.

    When `include_all=true` and the caller is an admin, return every project
    in the system instead — used by the admin "browse all" view.
    """
    user_email = _get_user_email(headers)
    admin_view = include_all and is_admin(user_email, config.template_admin_emails)

    # Get user's starred project IDs
    starred_ids = set(
        session.exec(
            select(ProjectStar.project_id).where(ProjectStar.user_email == user_email)
        ).all()
    )

    # Get projects with counts. Admin "view all" skips the user_email filter.
    stmt = select(Project).order_by(Project.created_at.desc())
    if not admin_view:
        stmt = stmt.where(Project.user_email == user_email)
    projects = session.exec(stmt).all()

    # Batch-resolve template names for projects created from templates
    template_ids = {p.source_template_id for p in projects if p.source_template_id}
    template_name_map: dict[str, str] = {}
    if template_ids:
        templates = session.exec(
            select(Template).where(Template.id.in_(template_ids))  # type: ignore[attr-defined]
        ).all()
        template_name_map = {t.id: t.name for t in templates}

    # Batch-load file paths in one query — stage derivation needs the
    # full list (looks for `databricks.yml`, `.py`/`.sql` files, etc., all
    # of which are user-visible).
    project_ids = [p.id for p in projects]
    files_by_project: dict[str, list[str]] = {pid: [] for pid in project_ids}
    if project_ids:
        rows = session.exec(
            select(ProjectFile.project_id, ProjectFile.relative_path)
            .where(ProjectFile.project_id.in_(project_ids))  # type: ignore[attr-defined]
        ).all()
        for pid, path in rows:
            files_by_project[pid].append(path)

    # Batch message counts: one GROUP BY query instead of N round-trips.
    msg_count_by_project: dict[str, int] = {pid: 0 for pid in project_ids}
    if project_ids:
        msg_rows = session.exec(
            select(Message.project_id, func.count(Message.id))
            .where(Message.project_id.in_(project_ids))  # type: ignore[attr-defined]
            .group_by(Message.project_id)
        ).all()
        for pid, cnt in msg_rows:
            msg_count_by_project[pid] = int(cnt)

    # The tile's file count should match what the user sees in the
    # file viewer — exclude .databrickscfg, .claude/skills/, etc.
    from .project_files import _is_hidden_from_listing

    result = []
    for p in projects:
        file_paths = files_by_project.get(p.id, [])
        visible_file_count = sum(1 for f in file_paths if not _is_hidden_from_listing(f))
        stage = compute_project_stage(file_paths)

        # Persist stage if it changed
        if stage != p.stage:
            p.stage = stage
            session.add(p)

        result.append(
            ProjectListItem(
                id=p.id,
                name=p.name,
                description=p.description,
                project_type=p.project_type,
                stage=stage,
                created_at=p.created_at,
                updated_at=p.updated_at,
                message_count=msg_count_by_project.get(p.id, 0),
                file_count=visible_file_count,
                is_starred=p.id in starred_ids,
                owner_email=p.user_email,
                source_template_id=p.source_template_id,
                source_template_name=template_name_map.get(p.source_template_id) if p.source_template_id else None,
            )
        )

    session.commit()
    return result


@router.post(
    "/projects",
    response_model=ProjectOut,
    operation_id="createProject",
)
def create_project(
    body: ProjectCreateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    config: Dependencies.Config,
):
    """Create a new project with default resources."""
    user_email = _get_user_email(headers)

    # LLM calls go through the SP client — Apps OBO tokens lack the model-serving
    # scope vocabulary, so user-attributed serving-endpoint calls 403. The SP has
    # CAN_QUERY on the LLM endpoints via the bundle resource bindings.
    llm_service = LLMService(ws, config)
    metadata = _generate_project_metadata(llm_service, body.description)
    project_name = metadata["name"]
    project_description = metadata.get("description") or body.description[:200]
    default_schema = f"{DEFAULT_SCHEMA_PREFIX}{metadata['schema_name']}"

    # Find default resources (returns tuples of id, name)
    warehouse_id, warehouse_name = _find_shared_warehouse(ws)

    # Create DB record with default resources (cluster left empty - user sets it manually)
    project = Project(
        user_email=user_email,
        name=project_name,
        description=project_description,
        warehouse_id=warehouse_id,
        warehouse_name=warehouse_name,
        cluster_id=None,
        cluster_name=None,
        default_catalog=DEFAULT_CATALOG,
        default_schema=default_schema,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    # Provision the default schema on the user's behalf so the agent doesn't
    # spend its first 5-10 tool calls discovering a CREATE_SCHEMA grant gap
    # (the default catalog is often workspace-shared and only a handful of
    # admins have CREATE_SCHEMA on it by default). Uses the user's OBO client
    # so the schema is owned by the user, not the App's service principal.
    # Soft-fails: if the create errors out (permission denied, network blip,
    # warehouse asleep), we log and continue — the agent can still try later
    # OR the user can change default_catalog in Settings.
    _ensure_default_schema(
        user_ws,
        warehouse_id=warehouse_id,
        catalog=DEFAULT_CATALOG,
        schema=default_schema,
        project_id=project.id,
    )

    # Create project directory (no README yet - agent will create it).
    # Passing capabilities scopes the copied skills to what this demo needs.
    create_project_directory(project.id, capabilities=body.capabilities)

    # Save context document as a project file if provided
    if body.context_document:
        project_dir = get_project_directory(project.id)
        context_dir = project_dir / "context"
        context_dir.mkdir(exist_ok=True)
        (context_dir / "source-document.md").write_text(body.context_document, encoding="utf-8")

    # Sync files to database so they appear in the file list
    file_sync: FileSyncService = request.app.state.file_sync
    file_sync.full_sync_project(project.id, session=session)

    # Persist the opening prompt so it renders as the first chat bubble on load
    # (instead of being passed through the URL and added optimistically in the UI,
    # which was racy against message-list fetches).
    message_count = 0
    if body.initial_prompt and body.initial_prompt.strip():
        session.add(Message(
            project_id=project.id,
            role="user",
            content=body.initial_prompt,
        ))
        session.commit()
        message_count = 1

    # Get actual file count from DB
    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == project.id)
    ).one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=message_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.get(
    "/projects/{project_id}",
    response_model=ProjectOut,
    operation_id="getProject",
)
def get_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Get a single project by ID.

    Restores files from the DB **only** when the local project folder is missing
    or empty — the common hot path (folder populated, watcher cache warm) avoids
    the expensive DB-to-disk reconcile and the redundant file-list SELECT.
    """
    user_email = _get_user_email(headers)
    project = _get_authorized_project(
        session, project_id, user_email, config.template_admin_emails
    )

    # Lazy import (avoids a module-level cycle with project_files which imports
    # service helpers itself).
    from ..services.skills_manager import PROJECTS_BASE_DIR
    from pathlib import Path as _Path
    project_dir = _Path(PROJECTS_BASE_DIR) / project_id

    # Restore from DB if missing/empty. Serialized per-project (see
    # ensure_project_files_restored) so concurrent loaders — frontend fires
    # getProject + listProjectFiles in parallel — don't both restore and
    # step on each other's cache, which would surface as an empty file list
    # until the user force-refreshes.
    from .project_files import ensure_project_files_restored, _get_cached_files
    ensure_project_files_restored(
        project_id,
        project_dir,
        request.app.state.file_sync,
        session,
    )
    file_entries = _get_cached_files(project_id, project_dir)
    file_paths = [f["path"] for f in file_entries]
    file_count = len(file_paths)

    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()

    stage = compute_project_stage(file_paths)
    if stage != project.stage:
        project.stage = stage
        session.add(project)
        session.commit()

    # Lazy narrative backfill for legacy projects: if README exists on
    # disk but the narrative was never generated (or the agent finished
    # writing while the previous backend was down and the watcher missed
    # it), fire a regen in the background. The service uses a per-project
    # lock + hash dedup so concurrent calls are cheap. The frontend picks
    # up the result via the `narrative_updated` SSE event.
    # Legacy-project backfill: synchronously generate the narrative inline
    # so the response already has it. This blocks the GET for ~1-3s (LLM
    # latency), which is fine — it only triggers once per project, on the
    # first open after README exists but narrative was never written.
    if not (project.narrative or "").strip():
        from ..services.narrative import (
            generate_narrative,
            read_project_readme,
            NarrativeError,
        )
        if read_project_readme(project_id):
            logger.info(
                f"[get_project] {project_id}: legacy backfill — generating "
                f"narrative synchronously"
            )
            try:
                generate_narrative(project_id, project, session, WorkspaceClient(), config)
                session.refresh(project)
                logger.info(
                    f"[get_project] {project_id}: legacy backfill complete"
                )
            except NarrativeError as e:
                logger.info(
                    f"[get_project] {project_id}: legacy backfill skipped "
                    f"({e.code}: {e})"
                )
            except Exception as e:
                logger.warning(
                    f"[get_project] {project_id}: legacy backfill failed: {e}",
                    exc_info=True,
                )

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )

@router.patch(
    "/projects/{project_id}",
    response_model=ProjectOut,
    operation_id="updateProject",
)
def update_project(
    project_id: str,
    body: ProjectUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Update a project's name or description."""
    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description

    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    session.commit()
    session.refresh(project)

    # Get counts
    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()

    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == project.id)
    ).one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.post(
    "/projects/{project_id}/description/ai-edit",
    response_model=DescriptionAiEditResponse,
    operation_id="aiEditProjectDescription",
)
def ai_edit_project_description(
    project_id: str,
    body: DescriptionAiEditRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    ws: Dependencies.Client,
):
    """Ask the mini LLM to rewrite a project's description per a user instruction.

    Returns the suggested description without saving — the client previews it
    and decides whether to PATCH the project. SP client handles the model
    serving call (OBO tokens lack the model-serving scope).
    """
    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    instruction = (body.instruction or "").strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="Instruction is required")

    current = (body.current_description or project.description or "").strip()

    system_prompt = (
        "You write conversational, persona-focused summaries of Databricks demo "
        "projects. The reader is an account executive, a customer, or a seller "
        "trying to understand what this demo is about at a glance. "
        "\n\n"
        "Voice: write like you're casually explaining your job to a friend at a "
        "bar — first-person or natural third-person, not marketing copy. Lead "
        "with WHO the persona is and WHAT they're trying to do. Avoid jargon "
        "(no 'leverage', 'showcase', 'end-to-end solution'). Avoid bullet "
        "points and headings. 1-2 short paragraphs, max ~800 characters. "
        "\n\n"
        "Reply with ONLY the new description — no quotes, no preamble, no "
        "markdown. Stay factual; do not invent capabilities that aren't "
        "already implied by the project."
    )
    user_prompt = (
        f"Project name: {project.name}\n\n"
        f"Current description:\n{current or '(empty)'}\n\n"
        f"Instruction: {instruction}\n\n"
        "Return the new description only."
    )

    llm = LLMService(ws, config)
    try:
        suggestion = llm.chat(
            user_prompt,
            size=ModelSize.MINI,
            system_prompt=system_prompt,
            max_tokens=800,
        )
    except Exception as e:
        logger.error(f"AI description edit failed for project {project_id}: {e}")
        raise HTTPException(status_code=502, detail="AI edit failed") from e

    suggestion = (suggestion or "").strip().strip('"').strip("'").strip()
    if not suggestion:
        raise HTTPException(status_code=502, detail="AI returned an empty description")

    return DescriptionAiEditResponse(description=suggestion)


# ---------------------------------------------------------------------------
# Narrative — LLM-generated storytelling summary for the Overview hero.
# Distinct from `description` (the short one-liner). Generated from the
# README and cached on the project row.
# ---------------------------------------------------------------------------


# Narrative generation helpers live in services/narrative.py (shared with
# the file watcher's auto-regen path).


@router.post(
    "/projects/{project_id}/narrative/generate",
    response_model=ProjectOut,
    operation_id="generateProjectNarrative",
)
def generate_project_narrative(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    ws: Dependencies.Client,
):
    """Generate (or regenerate) the LLM-driven 1-2 paragraph storytelling
    summary shown on the Overview hero. Reads README.md from the project
    directory, prompts the mini LLM for a persona-focused narrative, and
    caches the result on `project.narrative`.

    Returns the updated ProjectOut so the frontend can refresh in one round-trip.
    """
    from ..services.narrative import generate_narrative, NarrativeError

    user_email = _get_user_email(headers)
    project = _get_authorized_project(
        session, project_id, user_email, config.template_admin_emails
    )

    try:
        generate_narrative(project_id, project, session, ws, config)
    except NarrativeError as e:
        if e.code == "no_readme":
            raise HTTPException(status_code=400, detail=str(e)) from e
        raise HTTPException(status_code=502, detail=str(e)) from e

    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    session.commit()
    session.refresh(project)

    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()
    file_count = session.exec(
        select(func.count()).select_from(ProjectFile).where(ProjectFile.project_id == project.id)
    ).one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.patch(
    "/projects/{project_id}/resources",
    response_model=ProjectOut,
    operation_id="updateProjectResources",
)
def update_project_resources(
    project_id: str,
    body: ProjectResourcesUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Update a project's resource settings (cluster, warehouse, catalog, schema)."""
    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    # Update only the provided fields
    if body.cluster_id is not None:
        project.cluster_id = body.cluster_id if body.cluster_id else None
    if body.cluster_name is not None:
        project.cluster_name = body.cluster_name if body.cluster_name else None
    if body.warehouse_id is not None:
        project.warehouse_id = body.warehouse_id if body.warehouse_id else None
    if body.warehouse_name is not None:
        project.warehouse_name = body.warehouse_name if body.warehouse_name else None
    if body.default_catalog is not None:
        project.default_catalog = body.default_catalog if body.default_catalog else None
    if body.default_schema is not None:
        project.default_schema = body.default_schema if body.default_schema else None

    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    session.commit()
    session.refresh(project)

    # Get counts
    msg_count = session.exec(
        select(func.count()).select_from(Message).where(Message.project_id == project.id)
    ).one()

    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == project.id)
    ).one()

    return ProjectOut(
        id=project.id,
        name=project.name,
        user_email=project.user_email,
        description=project.description,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
        message_count=msg_count,
        file_count=file_count,
        cluster_id=project.cluster_id,
        cluster_name=project.cluster_name,
        warehouse_id=project.warehouse_id,
        warehouse_name=project.warehouse_name,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        source_template_id=project.source_template_id,
        source_template_name=_resolve_template_name(session, project.source_template_id),
    )


@router.delete(
    "/projects/{project_id}",
    operation_id="deleteProject",
)
def delete_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Delete a project and all associated data."""
    from ..services.agent import get_client_pool

    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    # Clear source_project_id on any linked templates (don't delete the template)
    session.execute(
        text("UPDATE templates SET source_project_id = NULL WHERE source_project_id = :pid"),
        {"pid": project_id}
    )

    # Delete messages
    messages = session.exec(
        select(Message).where(Message.project_id == project_id)
    ).all()
    for msg in messages:
        session.delete(msg)

    # Delete files from DB (pass session to avoid new connection)
    file_sync: FileSyncService = request.app.state.file_sync
    file_sync.delete_project_files(project_id, session=session)

    # Delete project
    session.delete(project)
    session.commit()

    # Disconnect + drop the pooled SDK subprocess. Without this it would
    # linger up to CLIENT_IDLE_TIMEOUT before the reaper sweeps it. Bridge
    # the async pool API from this sync handler — the threadpool worker
    # running this request has no event loop, so asyncio.run is safe.
    asyncio.run(get_client_pool().remove_client(project_id))

    # Drop the per-project restore lock + file cache (best-effort cleanup).
    from .project_files import _restore_locks, _restore_locks_lock, cache_evict_project
    with _restore_locks_lock:
        _restore_locks.pop(project_id, None)
    cache_evict_project(project_id)

    try:
        project_dir = get_project_directory(project_id)
        if project_dir.exists():
            shutil.rmtree(project_dir)
    except Exception as e:
        logger.warning(f"Failed to remove project directory for {project_id}: {e}")

    return {"success": True, "deleted_project_id": project_id}


@router.post(
    "/projects/{project_id}/sync",
    operation_id="syncProject",
)
def sync_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
    request: Request,
):
    """Trigger full bidirectional sync for a project."""
    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    file_sync: FileSyncService = request.app.state.file_sync
    # Pass session to avoid new connection
    stats = file_sync.full_sync_project(project_id, session=session)

    # Recompute stage after sync
    file_paths = [
        row for row in session.exec(
            select(ProjectFile.relative_path)
            .where(ProjectFile.project_id == project.id)
        ).all()
    ]
    stage = compute_project_stage(file_paths)
    if stage != project.stage:
        project.stage = stage
        session.add(project)
        session.commit()

    return stats


# ---------------------------------------------------------------------------
# Starring
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/star",
    operation_id="toggleProjectStar",
)
def toggle_project_star(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Toggle the starred status of a project. Returns the new state."""
    user_email = _get_user_email(headers)
    # Verify the user owns the project OR it's shared with them
    _get_accessible_project(session, project_id, user_email)

    existing = session.exec(
        select(ProjectStar)
        .where(ProjectStar.user_email == user_email, ProjectStar.project_id == project_id)
    ).first()

    if existing:
        session.delete(existing)
        session.commit()
        return {"starred": False, "project_id": project_id}
    else:
        star = ProjectStar(user_email=user_email, project_id=project_id)
        session.add(star)
        session.commit()
        return {"starred": True, "project_id": project_id}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------


def _get_accessible_project(session, project_id: str, user_email: str) -> Project:
    """Fetch a project the user can access — either owned or shared with them."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.user_email == user_email:
        return project
    # Check if shared with user
    share = session.exec(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.shared_with_email == user_email,
        )
    ).first()
    if share:
        return project
    raise HTTPException(status_code=404, detail="Project not found")


@router.post(
    "/projects/{project_id}/share",
    response_model=ProjectShareOut,
    operation_id="shareProject",
)
def share_project(
    project_id: str,
    body: ProjectShareRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Share a project with another user via email."""
    user_email = _get_user_email(headers)
    project = _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    if body.email.lower() == user_email.lower():
        raise HTTPException(status_code=400, detail="Cannot share a project with yourself")

    # Check if already shared
    existing = session.exec(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.shared_with_email == body.email,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Project already shared with this user")

    share = ProjectShare(
        project_id=project_id,
        owner_email=user_email,
        shared_with_email=body.email,
        message=body.message,
    )
    session.add(share)
    session.commit()
    session.refresh(share)

    return ProjectShareOut(
        id=share.id,
        project_id=share.project_id,
        owner_email=share.owner_email,
        shared_with_email=share.shared_with_email,
        message=share.message,
        created_at=share.created_at,
    )


@router.get(
    "/projects/{project_id}/shares",
    response_model=list[ProjectShareOut],
    operation_id="listProjectShares",
)
def list_project_shares(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """List all users a project is shared with (owner or admin)."""
    user_email = _get_user_email(headers)
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    shares = session.exec(
        select(ProjectShare).where(ProjectShare.project_id == project_id)
    ).all()

    return [
        ProjectShareOut(
            id=s.id,
            project_id=s.project_id,
            owner_email=s.owner_email,
            shared_with_email=s.shared_with_email,
            message=s.message,
            created_at=s.created_at,
        )
        for s in shares
    ]


@router.delete(
    "/projects/{project_id}/share/{share_id}",
    operation_id="unshareProject",
)
def unshare_project(
    project_id: str,
    share_id: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Remove a share (owner or admin)."""
    user_email = _get_user_email(headers)
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

    share = session.exec(
        select(ProjectShare).where(
            ProjectShare.id == share_id,
            ProjectShare.project_id == project_id,
        )
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    session.delete(share)
    session.commit()
    return {"success": True}


@router.get(
    "/shared-projects",
    response_model=list[ProjectListItem],
    operation_id="listSharedProjects",
)
def list_shared_projects(session: Dependencies.Session, headers: Dependencies.Headers):
    """Return projects shared with the current user by others."""
    user_email = _get_user_email(headers)

    # Get user's starred project IDs
    starred_ids = set(
        session.exec(
            select(ProjectStar.project_id).where(ProjectStar.user_email == user_email)
        ).all()
    )

    shares = session.exec(
        select(ProjectShare)
        .where(ProjectShare.shared_with_email == user_email)
        .order_by(ProjectShare.created_at.desc())
    ).all()

    result = []
    for share in shares:
        project = session.get(Project, share.project_id)
        if not project:
            continue

        msg_count = session.exec(
            select(func.count()).select_from(Message).where(Message.project_id == project.id)
        ).one()

        file_paths = [
            row for row in session.exec(
                select(ProjectFile.relative_path)
                .where(ProjectFile.project_id == project.id)
            ).all()
        ]
        stage = compute_project_stage(file_paths)

        result.append(
            ProjectListItem(
                id=project.id,
                name=project.name,
                description=project.description,
                project_type=project.project_type,
                stage=stage,
                created_at=project.created_at,
                updated_at=project.updated_at,
                message_count=msg_count,
                file_count=len(file_paths),
                is_starred=project.id in starred_ids,
                shared_by=share.owner_email,
                shared_message=share.message,
                owner_email=project.user_email,
                source_template_id=project.source_template_id,
                source_template_name=_resolve_template_name(session, project.source_template_id),
            )
        )

    return result
