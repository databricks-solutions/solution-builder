"""Constants API endpoints for industries and capabilities."""

from __future__ import annotations

from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..core.constants import CAPABILITIES, INDUSTRIES

router = create_router()


def _get_user_email(headers) -> str:
    """Extract user email from Databricks Apps headers."""
    if headers and headers.user_email:
        return headers.user_email
    if headers and headers.user_id:
        return headers.user_id
    return "anonymous@local"


class Capability(BaseModel):
    """Capability definition."""
    id: str
    name: str
    category: str


@router.get(
    "/constants/industries",
    response_model=list[str],
    operation_id="getIndustries",
)
def get_industries():
    """Get list of available industries."""
    return INDUSTRIES


@router.get(
    "/constants/capabilities",
    response_model=list[Capability],
    operation_id="getCapabilities",
)
def get_capabilities():
    """Get list of available capabilities."""
    return [
        Capability(id=c["id"], name=c["name"], category=c["category"])
        for c in CAPABILITIES
    ]


class TemplateAdminStatus(BaseModel):
    """Response for template admin check."""
    is_admin: bool


@router.get(
    "/constants/template-admin-status",
    response_model=TemplateAdminStatus,
    operation_id="getTemplateAdminStatus",
)
def get_template_admin_status(
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Check if the current user is a template admin."""
    user_email = _get_user_email(headers)
    is_admin = user_email in config.template_admin_emails
    return TemplateAdminStatus(is_admin=is_admin)
