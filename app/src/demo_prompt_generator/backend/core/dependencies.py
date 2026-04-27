from __future__ import annotations

from typing import TypeAlias
from ._defaults import ConfigDependency, ClientDependency, UserWorkspaceClientDependency
from ._headers import HeadersDependency
from .lakebase import LakebaseDependency


class Dependencies:
    """FastAPI dependency injection shorthand for route handler parameters."""

    Client: TypeAlias = ClientDependency
    """Databricks WorkspaceClient using app-level service principal credentials.
    Recommended usage: `ws: Dependencies.Client`"""

    UserClient: TypeAlias = UserWorkspaceClientDependency
    """WorkspaceClient authenticated on behalf of the current user via OBO token.
    Requires the X-Forwarded-Access-Token header.
    Recommended usage: `user_ws: Dependencies.UserClient`

    NOTE: On Databricks Apps, OBO tokens have a limited configurable-scope
    vocabulary — only `serving.serving-endpoints` (in `user_api_scopes`) plus
    the auto-added `iam.*` defaults are accepted today. Calls to
    `serving_endpoints` (LLM/embeddings) and UC/clusters/warehouses listing
    return 403 with `Invalid scope, required scopes: <name>` from the
    downstream API. Use `Dependencies.Client` (service principal) for those
    code paths and reserve `UserClient` for identity-attributed reads
    (current-user info, etc.)."""

    Config: TypeAlias = ConfigDependency
    """Application configuration loaded from environment variables.
    Recommended usage: `config: Dependencies.Config`"""

    Headers: TypeAlias = HeadersDependency
    """Databricks Apps HTTP headers for the current request.
    Recommended usage: `headers: Dependencies.Headers`"""
    Session: TypeAlias = LakebaseDependency
    """Lakebase session dependency.
    Recommended usage: `session: Dependencies.Session`"""

