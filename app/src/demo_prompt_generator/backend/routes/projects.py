"""Projects CRUD endpoints."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Optional

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
    HomeProjects,
    ProjectListItem,
    ProjectOut,
    ProjectProvisionRequest,
    ProjectResourcesUpdateRequest,
    ProjectShare,
    ProjectShareOut,
    ProjectShareRequest,
    ProjectStar,
    ProjectUpdateRequest,
    ShareResponseRequest,
    ShareRole,
    ShareRoleUpdateRequest,
    ShareStatus,
    SuccessResponse,
    Template,
    compute_project_stage,
    generate_uuid,
    utc_now,
)
from ..services.file_sync import FileSyncService, decompress_content
from ..services.skills_manager import (
    build_initial_resources_json,
    create_project_directory,
    get_project_directory,
)


def _load_resources_text(session, project_id: str) -> str | None:
    """Load the raw resources.json content for a project, or None if absent
    or undecodable. Used to gate BUILT on per-capability completeness."""
    row = session.exec(
        select(ProjectFile.content_compressed)
        .where(ProjectFile.project_id == project_id)
        .where(ProjectFile.relative_path == "resources.json")
    ).first()
    if not row:
        return None
    try:
        return decompress_content(row).decode("utf-8")
    except Exception:
        return None


def _batch_load_resources_text(session, project_ids: list[str]) -> dict[str, str]:
    """Bulk variant for list endpoints — one query for many projects."""
    if not project_ids:
        return {}
    rows = session.exec(
        select(ProjectFile.project_id, ProjectFile.content_compressed)
        .where(ProjectFile.project_id.in_(project_ids))  # type: ignore[attr-defined]
        .where(ProjectFile.relative_path == "resources.json")
    ).all()
    out: dict[str, str] = {}
    for pid, blob in rows:
        try:
            out[pid] = decompress_content(blob).decode("utf-8")
        except Exception:
            pass
    return out
from .resources import list_clusters, list_warehouses

router = create_router()

# Default schema prefix. The default catalog itself is config-driven —
# read via `config.default_catalog` (set by config.default_catalog env var, with
# `ai_demo_gen` as the fallback). It's created on app boot if missing
# (see core/_catalog_bootstrap.py).
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


def _quick_arch_name(description: str) -> str:
    """Fast, local project name for architecture-first creation (no LLM call).

    First line of the user's description, whitespace-collapsed and capped —
    good enough for the project list until /provision replaces it with the
    LLM-generated name when the user kicks off the build.
    """
    stripped = (description or "").strip()
    first_line = stripped.splitlines()[0] if stripped else ""
    name = re.sub(r"\s+", " ", first_line).strip(" .:-")
    if len(name) > 60:
        cut = name[:60]
        name = (cut.rsplit(" ", 1)[0] if " " in cut else cut) + "…"
    return name or "Architecture draft"


def _resolve_unique_schema_name(
    user_ws,
    *,
    warehouse_id: str | None,
    catalog: str,
    base_schema: str,
) -> str:
    """Pick a schema name that doesn't collide with an existing schema in
    `catalog`. Tries `base_schema`, then `base_schema_1`, `_2`, ... and
    returns the first free name (up to a small cap).

    Listing happens via `SHOW SCHEMAS LIKE` so we only fetch the relevant
    bucket — avoids paginating the whole catalog.

    Soft-fails to `base_schema` on any error (no warehouse, permission
    denied, network blip): callers treat the create itself as best-effort
    too, so handing back the original name is a reasonable default.

    The point of this guard is to keep two concurrent project creations
    from picking the same schema and writing into each other's data.
    """
    if not warehouse_id:
        return base_schema
    try:
        # Pattern lists `base_schema` AND `base_schema_*` in one shot.
        # Backticks not allowed inside LIKE so we plain-string the pattern.
        pattern = f"{base_schema}%"
        resp = user_ws.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=f"SHOW SCHEMAS IN `{catalog}` LIKE '{pattern}'",
            wait_timeout="10s",
        )
        existing: set[str] = set()
        if resp.result and resp.result.data_array:
            for row in resp.result.data_array:
                if row:
                    # SHOW SCHEMAS returns a single-column row per schema.
                    existing.add(str(row[0]))
        if base_schema not in existing:
            return base_schema
        # Find the highest `_<n>` suffix already in use and pick n+1.
        # That gives O(1) growth: 200 existing → `_201`. The pattern in
        # SHOW SCHEMAS was `base_schema%`, so anything not matching
        # `^base_schema(_<digits>)?$` is a near-miss (e.g. `base_schemaX`)
        # and gets ignored. No hard cap — Postgres/UC identifier limits
        # apply far above any realistic project count.
        pat = re.compile(rf"^{re.escape(base_schema)}_(\d+)$")
        max_suffix = 0
        for name in existing:
            m = pat.match(name)
            if m:
                max_suffix = max(max_suffix, int(m.group(1)))
        return f"{base_schema}_{max_suffix + 1}"
    except Exception as e:  # noqa: BLE001
        logger.warning(
            f"schema name resolution failed for {catalog}.{base_schema}: {e}; "
            f"using base name as-is"
        )
        return base_schema


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


# Access levels a caller can hold on a project, ordered by capability.
ACCESS_OWNER = "owner"
ACCESS_ADMIN = "admin"
ACCESS_EDITOR = "editor"
ACCESS_VIEWER = "viewer"


def _get_project_access(
    session, project_id: str, user_email: str, admin_emails: list[str]
) -> tuple[Project, str]:
    """Fetch a project and the caller's access level, or raise 404.

    Access is granted to: the owner, any admin, or a recipient of an ACCEPTED
    share (at the share's role — 'editor' or 'viewer'). Pending/declined shares
    grant NOTHING. Non-existent access is reported as 404 (not 403) so we don't
    leak which project IDs exist to users with no relationship to them.

    One query: LEFT JOIN the caller's accepted share so the grant is fetched in
    the same round-trip; the in-memory owner/admin check short-circuits first.

    Returns (project, access_level) where access_level is one of ACCESS_*.
    Callers pick the right gate: reads accept any level, writes reject viewers
    (_require_write_access), owner-only actions reject shares (_require_owner).
    """
    row = session.exec(
        select(Project, ProjectShare)
        .outerjoin(
            ProjectShare,
            (ProjectShare.project_id == Project.id)
            & (ProjectShare.shared_with_email == user_email)
            & (ProjectShare.status == ShareStatus.ACCEPTED.value),
        )
        .where(Project.id == project_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project, share = row
    if project.user_email == user_email:
        return project, ACCESS_OWNER
    if is_admin(user_email, admin_emails):
        return project, ACCESS_ADMIN
    if share is not None:
        # 'editor' or 'viewer'; default to viewer for any unexpected value.
        level = ACCESS_EDITOR if share.role == ShareRole.EDITOR.value else ACCESS_VIEWER
        return project, level
    raise HTTPException(status_code=404, detail="Project not found")


def _get_authorized_project(
    session, project_id: str, user_email: str, admin_emails: list[str]
) -> Project:
    """READ access: owner, admin, or accepted share of ANY role.

    Use on read-only endpoints. For mutations use _require_write_access; for
    owner-only actions use _require_owner.
    """
    project, _ = _get_project_access(session, project_id, user_email, admin_emails)
    return project


def _require_write_access(
    session, project_id: str, user_email: str, admin_emails: list[str]
) -> Project:
    """WRITE access: owner, admin, or EDITOR share. Viewers get 403."""
    project, level = _get_project_access(session, project_id, user_email, admin_emails)
    if level == ACCESS_VIEWER:
        raise HTTPException(
            status_code=403,
            detail="You have read-only access to this project. Make your own copy to edit it.",
        )
    return project


def _require_owner(
    session, project_id: str, user_email: str, admin_emails: list[str]
) -> Project:
    """OWNER-only actions (delete, manage shares). Admins allowed; shares are not."""
    project, level = _get_project_access(session, project_id, user_email, admin_emails)
    if level not in (ACCESS_OWNER, ACCESS_ADMIN):
        raise HTTPException(
            status_code=403,
            detail="Only the project owner can perform this action.",
        )
    return project


def _build_project_list_items(
    session,
    projects: list[Project],
    user_email: str,
    *,
    shares_by_id: dict[str, ProjectShare] | None = None,
    persist_stage: bool = False,
) -> list[ProjectListItem]:
    """Turn a set of Project rows into ProjectListItems with BATCHED counts —
    one query per table (files, messages, stars, templates, resources) instead
    of ~5 per project. Shared by listProjects / listSharedProjects / home.

    `shares_by_id` (project_id → accepted ProjectShare) populates the
    shared_by/role fields for "shared with me" tiles. Preserves the input
    `projects` ordering. `persist_stage` writes back a changed stage (owner list
    only; skipped for shared views where the caller doesn't own the row)."""
    from .project_files import _is_hidden_from_listing

    project_ids = [p.id for p in projects]
    if not project_ids:
        return []

    starred_ids = set(
        session.exec(
            select(ProjectStar.project_id).where(
                ProjectStar.user_email == user_email,
                ProjectStar.project_id.in_(project_ids),  # type: ignore[attr-defined]
            )
        ).all()
    )

    files_by_project: dict[str, list[str]] = {pid: [] for pid in project_ids}
    for pid, path in session.exec(
        select(ProjectFile.project_id, ProjectFile.relative_path)
        .where(ProjectFile.project_id.in_(project_ids))  # type: ignore[attr-defined]
    ).all():
        files_by_project[pid].append(path)

    msg_count_by_project: dict[str, int] = {pid: 0 for pid in project_ids}
    for pid, cnt in session.exec(
        select(Message.project_id, func.count(Message.id))
        .where(Message.project_id.in_(project_ids))  # type: ignore[attr-defined]
        .group_by(Message.project_id)
    ).all():
        msg_count_by_project[pid] = int(cnt)

    template_ids = {p.source_template_id for p in projects if p.source_template_id}
    template_name_map: dict[str, str] = {}
    if template_ids:
        template_name_map = {
            t.id: t.name
            for t in session.exec(
                select(Template).where(Template.id.in_(template_ids))  # type: ignore[attr-defined]
            ).all()
        }

    resources_text_by_project = _batch_load_resources_text(session, project_ids)

    result = []
    for p in projects:
        file_paths = files_by_project.get(p.id, [])
        visible_file_count = sum(1 for f in file_paths if not _is_hidden_from_listing(f))
        stage = compute_project_stage(file_paths, resources_text_by_project.get(p.id))
        if persist_stage and stage != p.stage:
            p.stage = stage
            session.add(p)
        share = shares_by_id.get(p.id) if shares_by_id else None
        result.append(
            ProjectListItem(
                id=p.id,
                name=p.name,
                description=p.description,
                customer=p.customer,
                project_type=p.project_type,
                stage=stage,
                created_at=p.created_at,
                updated_at=p.updated_at,
                message_count=msg_count_by_project.get(p.id, 0),
                file_count=visible_file_count,
                is_starred=p.id in starred_ids,
                shared_by=share.owner_email if share else None,
                shared_message=share.message if share else None,
                shared_role=share.role if share else None,
                owner_email=p.user_email,
                source_template_id=p.source_template_id,
                source_template_name=template_name_map.get(p.source_template_id) if p.source_template_id else None,
            )
        )
    return result


def _owned_projects(session, user_email: str, admin_view: bool) -> list[ProjectListItem]:
    """Owned (or, for admins, all) projects newest-first."""
    stmt = select(Project).order_by(Project.created_at.desc())
    if not admin_view:
        stmt = stmt.where(Project.user_email == user_email)
    projects = session.exec(stmt).all()
    items = _build_project_list_items(session, projects, user_email, persist_stage=True)
    session.commit()
    return items


def _shared_projects(session, user_email: str) -> list[ProjectListItem]:
    """Projects shared with the user that they've ACCEPTED, newest-first."""
    shares = session.exec(
        select(ProjectShare)
        .where(
            ProjectShare.shared_with_email == user_email,
            ProjectShare.status == ShareStatus.ACCEPTED.value,
        )
        .order_by(ProjectShare.created_at.desc())
    ).all()
    if not shares:
        return []
    share_by_project = {s.project_id: s for s in shares}
    project_ids = list(share_by_project.keys())
    projects = session.exec(
        select(Project).where(Project.id.in_(project_ids))  # type: ignore[attr-defined]
    ).all()
    # Preserve share (newest-first) ordering, not the arbitrary IN() order.
    by_id = {p.id: p for p in projects}
    ordered = [by_id[pid] for pid in project_ids if pid in by_id]
    return _build_project_list_items(session, ordered, user_email, shares_by_id=share_by_project)


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
    return _owned_projects(session, user_email, admin_view)


@router.get(
    "/projects/home",
    response_model=HomeProjects,
    operation_id="getHomeProjects",
)
def get_home_projects(session: Dependencies.Session, headers: Dependencies.Headers):
    """Everything the home page needs in ONE round-trip: owned projects, shared
    projects, and pending invitations — so they render together instead of
    popping in at different times. Each sub-list is batched internally.

    (Registered before `/projects/{project_id}` so "home" isn't parsed as an id.)
    """
    user_email = _get_user_email(headers)
    return HomeProjects(
        owned=_owned_projects(session, user_email, admin_view=False),
        shared=_shared_projects(session, user_email),
        invitations=_pending_invitations(session, user_email),
    )


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

    if body.architecture_first:
        # Architecture-first: keep creation INSTANT — no LLM call, no workspace
        # round-trips. All the remote work below (LLM name/schema generation,
        # warehouse discovery, unique-schema resolution, CREATE SCHEMA) is
        # deferred to POST /projects/{id}/provision, which the "Build the
        # solution" dialog calls when the user actually kicks off the build.
        project_name = _quick_arch_name(body.description)
        project_description = body.description[:200]
        warehouse_id, warehouse_name = None, None
        default_schema = None
    else:
        # LLM calls go through the SP client — Apps OBO tokens lack the
        # model-serving scope vocabulary, so user-attributed serving-endpoint
        # calls 403. The SP has CAN_QUERY on the LLM endpoints via the bundle
        # resource bindings.
        llm_service = LLMService(ws, config)
        metadata = _generate_project_metadata(llm_service, body.description)
        project_name = metadata["name"]
        project_description = metadata.get("description") or body.description[:200]
        base_schema = f"{DEFAULT_SCHEMA_PREFIX}{metadata['schema_name']}"

        # Find default resources (returns tuples of id, name)
        warehouse_id, warehouse_name = _find_shared_warehouse(ws)

        # Pick a non-colliding schema name BEFORE the DB write so the project
        # row records the final, unique value. Two SAs creating projects with
        # similar themes (e.g. "fraud detection v1" and "fraud detection v2")
        # would otherwise both resolve to `dbgen_fraud_detection` and write
        # into each other's tables.
        default_schema = _resolve_unique_schema_name(
            user_ws,
            warehouse_id=warehouse_id,
            catalog=config.default_catalog,
            base_schema=base_schema,
        )

    # Create DB record with default resources (cluster left empty - user sets it manually)
    project = Project(
        user_email=user_email,
        name=project_name,
        description=project_description,
        warehouse_id=warehouse_id,
        warehouse_name=warehouse_name,
        cluster_id=None,
        cluster_name=None,
        default_catalog=config.default_catalog,
        default_schema=default_schema,
        architecture_first=body.architecture_first,
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
    # Architecture-first projects have no schema yet (deferred to /provision).
    if default_schema:
        _ensure_default_schema(
            user_ws,
            warehouse_id=warehouse_id,
            catalog=config.default_catalog,
            schema=default_schema,
            project_id=project.id,
        )

    # Create project directory (no README yet - agent will create it).
    # Passing capabilities scopes the copied skills to what this demo needs.
    create_project_directory(project.id, capabilities=body.capabilities)

    # Seed a clean resources.json up front: the selected capabilities,
    # classified buildable/talking_track, with `created_resources` EMPTY.
    # The build agent appends real IDs as it creates each resource. Seeding
    # an empty file (rather than letting the agent invent one by mirroring
    # the example, whose `created_resources` is fully populated) guarantees a
    # freshly created project never carries placeholder IDs — a pre-seeded
    # `dashboard_id`/`genie_space_id` would otherwise render as a dead link
    # to a resource that doesn't exist yet.
    project_dir = get_project_directory(project.id)
    (project_dir / "resources.json").write_text(
        json.dumps(build_initial_resources_json(body.capabilities or []), indent=2),
        encoding="utf-8",
    )

    # Save uploaded context files (home-page widget) + the legacy
    # single-document fallback.
    #
    # New shape (body.context_files): each file produces TWO artifacts
    # under context/uploads/ — the raw original (so the user can re-open
    # it) and an .extracted.md sibling (so the agent can read the text
    # without re-parsing PDFs / XLSXs). Filenames are sanitized to a
    # leaf-only basename to block path traversal.
    if body.context_files:
        project_dir = get_project_directory(project.id)
        uploads_dir = project_dir / "context" / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        # Per-file size cap on the decoded original, matching the upload
        # route's limit. Stops a hand-crafted request from sneaking a
        # huge base64 blob past the original upload guard.
        MAX_ORIGINAL_BYTES = 10 * 1024 * 1024  # 10 MB
        seen_names: set[str] = set()
        for f in body.context_files:
            # Pure-Posix basename — strips any "../" the client could
            # have stuffed into `filename`. We never trust client paths.
            safe_name = PurePosixPath(f.filename or "unknown").name or "unknown"
            # Dedupe — if two uploads share a basename, suffix the later
            # one so they don't clobber each other.
            if safe_name in seen_names:
                stem = PurePosixPath(safe_name).stem
                suffix = PurePosixPath(safe_name).suffix
                n = 2
                while f"{stem}-{n}{suffix}" in seen_names:
                    n += 1
                safe_name = f"{stem}-{n}{suffix}"
            seen_names.add(safe_name)
            (uploads_dir / f"{safe_name}.extracted.md").write_text(
                f.text, encoding="utf-8"
            )
            if f.original_b64:
                try:
                    raw = base64.b64decode(f.original_b64, validate=False)
                except (ValueError, TypeError):
                    # Bad base64 from a misbehaving client — skip the
                    # original, keep the extracted text. The user still
                    # has the content; only the re-download link is lost.
                    logger.warning(
                        "could not decode original_b64 for %s; "
                        "extracted text saved without original",
                        safe_name,
                    )
                    continue
                if len(raw) > MAX_ORIGINAL_BYTES:
                    logger.warning(
                        "original_b64 for %s decoded to %d bytes (> %d cap); "
                        "skipping original write",
                        safe_name,
                        len(raw),
                        MAX_ORIGINAL_BYTES,
                    )
                    continue
                (uploads_dir / safe_name).write_bytes(raw)
    elif body.context_document:
        # Legacy single-document path — kept so older clients (or anyone
        # still POSTing the old field) keep working.
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
        customer=project.customer,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        architecture_first=project.architecture_first,
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
    project, my_role = _get_project_access(
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

    stage = compute_project_stage(file_paths, _load_resources_text(session, project.id))
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
        customer=project.customer,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=stage,
        architecture_first=project.architecture_first,
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
        my_role=my_role,
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
    project = _require_write_access(session, project_id, user_email, config.template_admin_emails)

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.customer is not None:
        # Empty string clears back to "unknown" (→ "Not specified" in the UI).
        project.customer = body.customer.strip() or None
    if body.architecture_first is not None:
        project.architecture_first = body.architecture_first

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
        customer=project.customer,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        architecture_first=project.architecture_first,
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
    "/projects/{project_id}/provision",
    response_model=ProjectOut,
    operation_id="provisionProject",
)
def provision_project(
    project_id: str,
    body: ProjectProvisionRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    request: Request,
    ws: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    config: Dependencies.Config,
):
    """Provision the remote assets an architecture-first project skipped at
    creation: LLM name/schema generation, warehouse discovery and the
    CREATE SCHEMA. Idempotent — the "Build the solution" dialog calls this
    right before sending the build prompt, and it no-ops the pieces that
    already exist (safe on any project)."""
    user_email = _get_user_email(headers)
    project = _require_write_access(session, project_id, user_email, config.template_admin_emails)

    # 1. Name/schema/warehouse — only when creation deferred them (no schema
    #    picked yet). The story description from the build dialog is richer
    #    input for the LLM than the original architecture topic.
    if not project.default_schema:
        llm_service = LLMService(ws, config)
        seed = body.description or project.description or project.name
        metadata = _generate_project_metadata(llm_service, seed)
        if body.description:
            project.name = metadata["name"]
            project.description = metadata.get("description") or body.description[:200]
        if not project.warehouse_id:
            project.warehouse_id, project.warehouse_name = _find_shared_warehouse(ws)
        if not project.default_catalog:
            project.default_catalog = config.default_catalog
        base_schema = f"{DEFAULT_SCHEMA_PREFIX}{metadata['schema_name']}"
        project.default_schema = _resolve_unique_schema_name(
            user_ws,
            warehouse_id=project.warehouse_id,
            catalog=project.default_catalog,
            base_schema=base_schema,
        )
        project.updated_at = datetime.now(timezone.utc)
        session.add(project)
        session.commit()
        session.refresh(project)

    # 2. Make sure the schema actually exists (soft-fails like create does —
    #    the agent can retry later, the user can change Settings).
    if project.default_schema:
        _ensure_default_schema(
            user_ws,
            warehouse_id=project.warehouse_id,
            catalog=project.default_catalog or config.default_catalog,
            schema=project.default_schema,
            project_id=project.id,
        )

    # 3. Final capability selection from the dialog: re-seed resources.json —
    #    but NEVER clobber a file that already carries created-resource IDs
    #    (the build already started). Skills are always the full set (see
    #    create_project_directory); the only capability-scoped scaffold is the
    #    app spec folder.
    if body.capabilities:
        project_dir = get_project_directory(project.id)
        res_path = project_dir / "resources.json"
        reseed = True
        if res_path.exists():
            try:
                existing = json.loads(res_path.read_text(encoding="utf-8"))
                created = existing.get("created_resources") or {}
                if any(v for v in created.values()):
                    reseed = False
            except (json.JSONDecodeError, OSError):
                pass  # unreadable → replace with a clean seed
        if reseed:
            res_path.write_text(
                json.dumps(build_initial_resources_json(body.capabilities), indent=2),
                encoding="utf-8",
            )
        if "databricks-apps" in body.capabilities:
            (project_dir / "specifications" / "app").mkdir(parents=True, exist_ok=True)
        file_sync: FileSyncService = request.app.state.file_sync
        file_sync.full_sync_project(project.id, session=session)

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
        customer=project.customer,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        architecture_first=project.architecture_first,
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
    project = _require_write_access(session, project_id, user_email, config.template_admin_emails)

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
    project = _require_write_access(
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
        customer=project.customer,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        architecture_first=project.architecture_first,
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
    project = _require_write_access(session, project_id, user_email, config.template_admin_emails)

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
        customer=project.customer,
        narrative=project.narrative,
        narrative_readme_hash=project.narrative_readme_hash,
        project_type=project.project_type,
        stage=project.stage,
        architecture_first=project.architecture_first,
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
    # Owner-only: a shared editor can modify but must not destroy the original.
    project = _require_owner(session, project_id, user_email, config.template_admin_emails)

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
    project = _require_write_access(session, project_id, user_email, config.template_admin_emails)

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
    stage = compute_project_stage(file_paths, _load_resources_text(session, project.id))
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
    config: Dependencies.Config,
):
    """Toggle the starred status of a project. Returns the new state."""
    user_email = _get_user_email(headers)
    # Verify the user can read the project (owner, admin, or accepted share).
    _get_authorized_project(session, project_id, user_email, config.template_admin_emails)

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


def _share_out(share: ProjectShare, project_name: Optional[str] = None) -> ProjectShareOut:
    """Serialize a ProjectShare row to its API shape."""
    return ProjectShareOut(
        id=share.id,
        project_id=share.project_id,
        owner_email=share.owner_email,
        shared_with_email=share.shared_with_email,
        message=share.message,
        role=share.role,
        status=share.status,
        created_at=share.created_at,
        responded_at=share.responded_at,
        project_name=project_name,
    )


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
    """Invite another user to a project at a given role (owner/admin only).

    The invite starts pending; the recipient must accept it before it grants
    access (see respond_to_share). Re-sharing a project that was previously
    declined re-opens the invitation rather than erroring.
    """
    user_email = _get_user_email(headers)
    # Owner-only: managing who can access a project is not delegated to editors.
    project = _require_owner(session, project_id, user_email, config.template_admin_emails)

    target = body.email.strip()
    if target.lower() == user_email.lower():
        raise HTTPException(status_code=400, detail="Cannot share a project with yourself")
    if target.lower() == project.user_email.lower():
        raise HTTPException(status_code=400, detail="This user already owns the project")

    role = body.role if body.role in (ShareRole.VIEWER.value, ShareRole.EDITOR.value) else ShareRole.VIEWER.value

    existing = session.exec(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.shared_with_email == target,
        )
    ).first()
    if existing:
        if existing.status == ShareStatus.DECLINED.value:
            # Re-invite: reopen the previously declined share with the new role.
            # Keep the original created_at so the audit trail / ordering is
            # preserved; responded_at is cleared since it's pending again.
            existing.role = role
            existing.message = body.message
            existing.status = ShareStatus.PENDING.value
            existing.responded_at = None
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return _share_out(existing)
        raise HTTPException(status_code=409, detail="Project already shared with this user")

    share = ProjectShare(
        project_id=project_id,
        owner_email=user_email,
        shared_with_email=target,
        message=body.message,
        role=role,
        status=ShareStatus.PENDING.value,
    )
    session.add(share)
    session.commit()
    session.refresh(share)
    return _share_out(share)


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
    """List everyone a project is shared with, and each share's role/status
    (owner or admin only)."""
    user_email = _get_user_email(headers)
    _require_owner(session, project_id, user_email, config.template_admin_emails)

    shares = session.exec(
        select(ProjectShare)
        .where(ProjectShare.project_id == project_id)
        .order_by(ProjectShare.created_at.desc())
    ).all()

    return [_share_out(s) for s in shares]


@router.patch(
    "/projects/{project_id}/share/{share_id}",
    response_model=ProjectShareOut,
    operation_id="updateProjectShare",
)
def update_project_share(
    project_id: str,
    share_id: int,
    body: ShareRoleUpdateRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Change an existing share's role (owner/admin only)."""
    user_email = _get_user_email(headers)
    _require_owner(session, project_id, user_email, config.template_admin_emails)

    share = session.exec(
        select(ProjectShare).where(
            ProjectShare.id == share_id,
            ProjectShare.project_id == project_id,
        )
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    if body.role in (ShareRole.VIEWER.value, ShareRole.EDITOR.value):
        share.role = body.role
    session.add(share)
    session.commit()
    session.refresh(share)
    return _share_out(share)


@router.delete(
    "/projects/{project_id}/share/{share_id}",
    response_model=SuccessResponse,
    operation_id="unshareProject",
)
def unshare_project(
    project_id: str,
    share_id: int,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Revoke a share (owner or admin)."""
    user_email = _get_user_email(headers)
    _require_owner(session, project_id, user_email, config.template_admin_emails)

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
    return SuccessResponse(success=True)


def _pending_invitations(session, user_email: str) -> list[ProjectShareOut]:
    """Pending shares addressed to the user, with project names batched in."""
    shares = session.exec(
        select(ProjectShare)
        .where(
            ProjectShare.shared_with_email == user_email,
            ProjectShare.status == ShareStatus.PENDING.value,
        )
        .order_by(ProjectShare.created_at.desc())
    ).all()
    if not shares:
        return []
    name_by_id = {
        pid: name
        for pid, name in session.exec(
            select(Project.id, Project.name).where(
                Project.id.in_([s.project_id for s in shares])  # type: ignore[attr-defined]
            )
        ).all()
    }
    return [
        _share_out(s, project_name=name_by_id[s.project_id])
        for s in shares
        if s.project_id in name_by_id  # skip invites whose project was deleted
    ]


@router.get(
    "/share-invitations",
    response_model=list[ProjectShareOut],
    operation_id="listShareInvitations",
)
def list_share_invitations(session: Dependencies.Session, headers: Dependencies.Headers):
    """Pending share invitations addressed to the current user.

    Powers the notifications badge — these are shares the user has NOT yet
    accepted, so they don't appear under "shared with me" yet.
    """
    return _pending_invitations(session, _get_user_email(headers))


@router.post(
    "/projects/{project_id}/share/respond",
    response_model=ProjectShareOut,
    operation_id="respondToShare",
)
def respond_to_share(
    project_id: str,
    body: ShareResponseRequest,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Accept or decline a pending share invitation (recipient only)."""
    user_email = _get_user_email(headers)
    share = session.exec(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.shared_with_email == user_email,
        )
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if share.status != ShareStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="This invitation has already been responded to")

    share.status = ShareStatus.ACCEPTED.value if body.accept else ShareStatus.DECLINED.value
    share.responded_at = utc_now()
    session.add(share)
    session.commit()
    session.refresh(share)
    return _share_out(share)


def _fresh_resources_from(session, source_project_id: str) -> dict:
    """resources.json for a clone: keep the source's capability selection but
    reset created_resources to empty so the clone points at no live Databricks
    objects until its owner builds their own."""
    try:
        raw = _load_resources_text(session, source_project_id)
        data = json.loads(raw) if raw else {}
        caps = data.get("capabilities") or {"buildable": [], "talking_track": []}
        return {"capabilities": caps, "created_resources": {}}
    except (json.JSONDecodeError, TypeError, ValueError):
        return {"capabilities": {"buildable": [], "talking_track": []}, "created_resources": {}}


@router.post(
    "/projects/{project_id}/clone",
    response_model=ProjectOut,
    operation_id="cloneProject",
)
def clone_project(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Clone a project into a new one owned by the caller.

    Anyone with READ access (owner, admin, or an accepted share of any role)
    can make their own independent, fully-editable copy. This is the escape
    hatch for a read-only viewer who wants to iterate without touching the
    original: the clone gets a new id, is owned by the caller, copies every
    file EXCEPT resources.json, and seeds a fresh resources.json with
    created_resources cleared — so it is wired to no live Databricks objects
    (and cannot write into the source's UC schema) until its owner builds.
    """
    user_email = _get_user_email(headers)
    source = _get_authorized_project(
        session, project_id, user_email, config.template_admin_emails
    )

    new_id = generate_uuid()
    clone = Project(
        id=new_id,
        user_email=user_email,
        name=f"Copy of {source.name}",
        description=source.description,
        customer=source.customer,
        project_type=source.project_type,
        # Leave compute/schema bindings null — the clone provisions its own on
        # first build rather than inheriting the source owner's resources.
        default_catalog=config.default_catalog,
    )
    session.add(clone)

    # Scaffold the project dir (skills + structure) up front so we can copy DB
    # rows and materialize files to disk in a SINGLE pass over src_files. Every
    # file except resources.json is copied verbatim from the compressed blobs we
    # already hold; resources.json is reset below.
    create_project_directory(new_id)
    project_dir = get_project_directory(new_id)
    src_files = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    ).all()
    for f in src_files:
        if f.relative_path == "resources.json":
            continue
        session.add(
            ProjectFile(
                project_id=new_id,
                relative_path=f.relative_path,
                content_compressed=f.content_compressed,
                content_hash=f.content_hash,
                file_size=f.file_size,
            )
        )
        dest = project_dir / f.relative_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            dest.write_bytes(decompress_content(f.content_compressed))
        except Exception as e:  # noqa: BLE001 - best-effort per-file, don't fail the clone
            logger.warning(f"[clone {new_id}] failed to write {f.relative_path}: {e}")
    session.commit()

    (project_dir / "resources.json").write_text(
        json.dumps(_fresh_resources_from(session, project_id), indent=2),
        encoding="utf-8",
    )

    file_count = session.exec(
        select(func.count())
        .select_from(ProjectFile)
        .where(ProjectFile.project_id == new_id)
    ).one()

    session.refresh(clone)
    return ProjectOut(
        id=clone.id,
        name=clone.name,
        user_email=clone.user_email,
        description=clone.description,
        customer=clone.customer,
        narrative=clone.narrative,
        narrative_readme_hash=clone.narrative_readme_hash,
        project_type=clone.project_type,
        stage=clone.stage,
        architecture_first=clone.architecture_first,
        created_at=clone.created_at,
        updated_at=clone.updated_at,
        message_count=0,
        file_count=file_count,
        cluster_id=clone.cluster_id,
        cluster_name=clone.cluster_name,
        warehouse_id=clone.warehouse_id,
        warehouse_name=clone.warehouse_name,
        default_catalog=clone.default_catalog,
        default_schema=clone.default_schema,
        source_template_id=clone.source_template_id,
        source_template_name=None,
    )


@router.get(
    "/shared-projects",
    response_model=list[ProjectListItem],
    operation_id="listSharedProjects",
)
def list_shared_projects(session: Dependencies.Session, headers: Dependencies.Headers):
    """Projects shared with the current user that they've ACCEPTED.

    Pending invitations live in /share-invitations; declined shares are hidden.
    """
    return _shared_projects(session, _get_user_email(headers))
