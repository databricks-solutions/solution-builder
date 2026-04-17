from __future__ import annotations
from typing import Annotated, AsyncGenerator, TypeAlias
from contextlib import asynccontextmanager

from databricks.sdk import WorkspaceClient
from fastapi import Depends, FastAPI, Request

from ._base import LifespanDependency
from ._config import AppConfig, logger
from ._headers import HeadersDependency


class _ConfigDependency(LifespanDependency):
    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        app.state.config = AppConfig()
        logger.info(f"Starting app with configuration:\n{app.state.config}")
        yield

    @staticmethod
    def __call__(request: Request) -> AppConfig:
        return request.app.state.config


class _WorkspaceClientDependency(LifespanDependency):
    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        # Lazy initialization - don't create WorkspaceClient at startup
        # (Databricks CLI auth is slow, ~20-30 seconds)
        app.state._workspace_client = None
        yield

    @staticmethod
    def __call__(request: Request) -> WorkspaceClient:
        # Lazy create on first access
        if request.app.state._workspace_client is None:
            request.app.state._workspace_client = WorkspaceClient()
        return request.app.state._workspace_client


def _get_user_ws(
    headers: HeadersDependency,
) -> WorkspaceClient:
    """
    Returns a Databricks Workspace client with authentication behalf of user.
    If the request contains an X-Forwarded-Access-Token header, on behalf of user authentication is used.
    In local development (no OBO token), falls back to unified auth (config profile or env vars).

    Example usage: `user_ws: Dependencies.UserClient`
    """

    if not headers.token:
        # Local development mode - use unified auth (config profile, env vars, etc.)
        logger.debug("No OBO token found, using default unified auth for local development")
        return WorkspaceClient()

    return WorkspaceClient(
        token=headers.token.get_secret_value(), auth_type="pat"
    )  # set pat explicitly to avoid issues with SP client


ConfigDependency: TypeAlias = Annotated[AppConfig, _ConfigDependency.depends()]

ClientDependency: TypeAlias = Annotated[
    WorkspaceClient, _WorkspaceClientDependency.depends()
]

UserWorkspaceClientDependency: TypeAlias = Annotated[
    WorkspaceClient, Depends(_get_user_ws)
]
