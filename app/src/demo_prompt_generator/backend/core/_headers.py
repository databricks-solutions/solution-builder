from __future__ import annotations

import logging
from functools import lru_cache
from typing import Annotated, TypeAlias
from uuid import UUID

from fastapi import Depends, Header
from pydantic import BaseModel, SecretStr

logger = logging.getLogger(__name__)


class DatabricksAppsHeaders(BaseModel):
    """Structured model for Databricks Apps HTTP headers.

    See: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/http-headers
    """

    host: str | None
    user_name: str | None
    user_id: str | None
    user_email: str | None
    request_id: UUID | None
    token: SecretStr | None


@lru_cache(maxsize=1)
def _get_dev_user_email() -> str | None:
    """Get current user email from Databricks SDK (for dev mode fallback).

    Uses lru_cache to avoid repeated API calls.
    """
    try:
        from databricks.sdk import WorkspaceClient
        ws = WorkspaceClient()
        me = ws.current_user.me()
        email = me.user_name  # user_name is typically the email
        logger.info(f"Dev mode: using Databricks SDK user email: {email}")
        return email
    except Exception as e:
        logger.warning(f"Failed to get user from Databricks SDK: {e}")
        return None


def get_databricks_headers(
    host: Annotated[str | None, Header(alias="X-Forwarded-Host")] = None,
    user_name: Annotated[
        str | None, Header(alias="X-Forwarded-Preferred-Username")
    ] = None,
    user_id: Annotated[str | None, Header(alias="X-Forwarded-User")] = None,
    user_email: Annotated[str | None, Header(alias="X-Forwarded-Email")] = None,
    request_id: Annotated[str | None, Header(alias="X-Request-Id")] = None,
    token: Annotated[str | None, Header(alias="X-Forwarded-Access-Token")] = None,
) -> DatabricksAppsHeaders:
    """Extract Databricks Apps headers from the incoming request.

    In dev mode (no headers), falls back to Databricks SDK current user.
    """
    # If no user_email from headers, try to get it from Databricks SDK (dev mode)
    if not user_email:
        user_email = _get_dev_user_email()

    return DatabricksAppsHeaders(
        host=host,
        user_name=user_name,
        user_id=user_id,
        user_email=user_email,
        request_id=UUID(request_id) if request_id else None,
        token=SecretStr(token) if token else None,
    )


HeadersDependency: TypeAlias = Annotated[
    DatabricksAppsHeaders, Depends(get_databricks_headers)
]
