"""Skills management endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..models import Project
from ..services.skills_manager import (
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

    # Get skills
    skills = get_project_skills_list(project_id)

    # Build prompt with project's resources
    prompt = get_system_prompt(
        cluster_id=project.cluster_id,
        warehouse_id=project.warehouse_id,
        default_catalog=project.default_catalog,
        default_schema=project.default_schema,
        workspace_url=get_workspace_url(),
        skills=skills,
    )

    return SystemPromptResponse(prompt=prompt)
