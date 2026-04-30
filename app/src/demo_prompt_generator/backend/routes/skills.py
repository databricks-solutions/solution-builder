"""Skills management endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel
from sqlmodel import select

from ..core import Dependencies, create_router
from ..core.auth import detect_mode
from ..models import Project, User
from ..services.skills_manager import (
    get_project_directory,
    get_project_skills_list,
    get_skill_file_content,
    get_skill_files_tree,
    refresh_project_skills,
)
from ..services.system_prompt import get_system_prompt, get_workspace_url

router = create_router()


class SkillInfo(BaseModel):
    """Skill metadata."""

    name: str
    description: str
    dir_name: str


class SkillFileContent(BaseModel):
    """Skill file content response."""

    path: str
    content: str


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


def _verify_project_access(session, project_id: str, user_email: str) -> Project:
    """Verify user has access to project."""
    row = session.get(Project, project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    if row.user_email != user_email:
        raise HTTPException(status_code=404, detail="Project not found")
    return row


@router.get(
    "/projects/{project_id}/skills",
    response_model=list[SkillInfo],
    operation_id="getProjectSkills",
)
def get_skills(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Get list of skills in project's .claude/skills folder."""
    user_email = _get_user_email(headers)
    _verify_project_access(session, project_id, user_email)

    skills = get_project_skills_list(project_id)
    return [SkillInfo(**s) for s in skills]


@router.get(
    "/projects/{project_id}/skills/{skill_name}/files",
    operation_id="getSkillFiles",
)
def get_skill_files(
    project_id: str,
    skill_name: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Get file tree for a skill directory as nested structure."""
    user_email = _get_user_email(headers)
    _verify_project_access(session, project_id, user_email)

    return get_skill_files_tree(project_id, skill_name)


@router.get(
    "/projects/{project_id}/skills/{skill_name}/files/{file_path:path}",
    response_model=SkillFileContent,
    operation_id="getSkillFileContent",
)
def get_skill_file(
    project_id: str,
    skill_name: str,
    file_path: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Get content of a specific skill file."""
    user_email = _get_user_email(headers)
    _verify_project_access(session, project_id, user_email)

    content = get_skill_file_content(project_id, skill_name, file_path)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found")

    return SkillFileContent(path=file_path, content=content)


@router.post(
    "/projects/{project_id}/skills/refresh",
    operation_id="refreshProjectSkills",
)
def refresh_skills(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Re-copy skills from ai-dev-kit to project."""
    user_email = _get_user_email(headers)
    _verify_project_access(session, project_id, user_email)

    success = refresh_project_skills(project_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to refresh skills")

    # Return updated skills list
    skills = get_project_skills_list(project_id)
    return {"success": True, "skills": [SkillInfo(**s) for s in skills]}


class SystemPromptResponse(BaseModel):
    """System prompt response."""

    prompt: str


@router.get(
    "/projects/{project_id}/system-prompt",
    response_model=SystemPromptResponse,
    operation_id="getProjectSystemPrompt",
)
def get_project_system_prompt(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Get the current system prompt for a project (for debugging)."""
    user_email = _get_user_email(headers)
    project = _verify_project_access(session, project_id, user_email)

    # Get skills and project directory
    skills = get_project_skills_list(project_id)
    project_dir = get_project_directory(project_id)

    # Build prompt with project's resources
    prompt = get_system_prompt(
        cluster_id=project.cluster_id,
        warehouse_id=project.warehouse_id,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        workspace_url=get_workspace_url(),
        skills=skills,
        project_dir=str(project_dir),
    )

    return SystemPromptResponse(prompt=prompt)


# ---------------------------------------------------------------------------
# Agent env vars (debug surface)
#
# Surfaces exactly what `_build_claude_env` produces for this user/project
# combination. Token-shaped values are redacted (first 4 + last 4 chars
# only) — those tokens can mint requests as the SP, so leaking them in the
# UI would be a real auth boundary violation. See backend/AUTH.md for the
# full identity model (LLM = SP, Databricks CLI = user PAT, two identities
# at once when deployed).
# ---------------------------------------------------------------------------


# Names whose values must be redacted in the UI. Treat conservatively: if
# in doubt, redact. The user is troubleshooting auth shape, not value.
_REDACT_KEYS = {
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "DATABRICKS_TOKEN",
    "DATABRICKS_CLIENT_SECRET",
    # Headers that carry tokens
    "ANTHROPIC_CUSTOM_HEADERS",  # contains workspace coding-agent header — safe but log conservatively
}


def _redact(name: str, value: str) -> tuple[str, bool]:
    """Return (display_value, was_redacted). For token-shaped names, show
    only the first 4 + last 4 chars (or "***" if too short). The
    coding-agent header is shown verbatim because it doesn't carry a token."""
    if name == "ANTHROPIC_CUSTOM_HEADERS":
        return value, False
    if name in _REDACT_KEYS:
        if len(value) <= 12:
            return "***", True
        return f"{value[:4]}…{value[-4:]}", True
    return value, False


class AgentEnvVar(BaseModel):
    name: str
    value: str
    redacted: bool


class AgentEnvResponse(BaseModel):
    """Snapshot of the env passed to the Claude Agent SDK subprocess for
    this project. Lets users / SAs verify which Databricks identity the
    agent runs as (always the user via PAT for `databricks ...` calls;
    always the SP for the Claude LLM itself when deployed)."""

    mode: str  # "local" | "deployed"
    notes: str
    vars: list[AgentEnvVar]


@router.get(
    "/projects/{project_id}/agent-env",
    response_model=AgentEnvResponse,
    operation_id="getProjectAgentEnv",
)
def get_project_agent_env(
    project_id: str,
    session: Dependencies.Session,
    headers: Dependencies.Headers,
):
    """Return the env dict that would be passed to the next agent run for
    this project. Used by the Skills/Agent Configuration panel to debug
    auth issues (e.g. "why does the agent's databricks call 401 when the
    UI is fine?" — answer: LLM uses SP, CLI uses user PAT, and the PAT
    expired)."""
    # Imported here to avoid circular import (services/agent.py imports
    # heavy modules at top level; this debug endpoint shouldn't pay that
    # cost on cold start).
    from ..services.agent import _build_claude_env

    user_email = _get_user_email(headers)
    _verify_project_access(session, project_id, user_email)

    mode = detect_mode(headers)
    user = session.exec(select(User).where(User.email == user_email)).first()
    databricks_profile = user.databricks_profile if user else None
    project_dir = get_project_directory(project_id)

    raw_env = _build_claude_env(
        project_dir,
        mode=mode,
        local_profile=databricks_profile,
    )

    items: list[AgentEnvVar] = []
    for name in sorted(raw_env.keys()):
        display, was_redacted = _redact(name, raw_env[name])
        items.append(AgentEnvVar(name=name, value=display, redacted=was_redacted))

    if mode == "deployed":
        notes = (
            "Deployed mode. The Claude LLM (ANTHROPIC_*) is authenticated as the "
            "APP'S SERVICE PRINCIPAL — every Anthropic call's audit + billing rolls "
            "up to the SP, not the human. The Databricks CLI/SDK calls the agent "
            "makes (DATABRICKS_CONFIG_FILE) authenticate as the HUMAN USER via the "
            "PAT in <project>/.databrickscfg. Middleware refreshes that file from "
            "x-forwarded-access-token on every request; PATs are ~1h TTL. If a "
            "databricks CLI call 401s mid-turn, reopen the tab to mint a fresh PAT."
        )
    else:
        notes = (
            "Local mode. The Claude LLM uses ANTHROPIC_API_KEY from your shell. "
            "Databricks CLI/SDK calls run as the profile from /setup. Token "
            "refresh is handled by the Databricks CLI's own OAuth cache."
        )

    return AgentEnvResponse(mode=mode, notes=notes, vars=items)
