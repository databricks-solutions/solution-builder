"""Constants API endpoints for industries, capabilities, and current user."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..core.constants import CAPABILITIES, INDUSTRIES

router = create_router()


class Capability(BaseModel):
    """Capability definition."""
    id: str
    name: str
    category: str


class CurrentUser(BaseModel):
    """Current user information."""
    email: str
    user_name: Optional[str] = None
    is_template_admin: bool


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


@router.get(
    "/current-user",
    response_model=CurrentUser,
    operation_id="getCurrentUser",
)
def get_current_user(
    headers: Dependencies.Headers,
    config: Dependencies.Config,
):
    """Get current user info including admin status."""
    # Get email from headers (already falls back to Databricks SDK in dev mode)
    email = headers.user_email or "anonymous@local"
    user_name = headers.user_name
    is_admin = email in config.template_admin_emails

    return CurrentUser(
        email=email,
        user_name=user_name,
        is_template_admin=is_admin,
    )
