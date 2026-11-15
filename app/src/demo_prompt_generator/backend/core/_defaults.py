from __future__ import annotations
import hashlib
import threading
import time
from collections import OrderedDict
from typing import Annotated, Any, AsyncGenerator, TypeAlias
from contextlib import asynccontextmanager

from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from fastapi import Depends, FastAPI, Request

from ._base import LifespanDependency
from ._config import AppConfig, logger
from ._headers import HeadersDependency

# Bounds for every app-SP / OBO WorkspaceClient. The SDK defaults (300 s retry
# budget, 60 s per attempt, 20 blocking connections) let a slow control plane pin
# the threadpool: calls past the 20th block on the connection pool. `max_connection_pools`
# is the SDK's pool_maxsize (connections per host); 100 matches the anyio thread
# limiter set in _factory.py, so the pool never becomes the bottleneck.
APP_SP_CLIENT_OPTIONS: dict[str, Any] = {
    "retry_timeout_seconds": 60,
    "http_timeout_seconds": 30,
    "max_connection_pools": 100,
}


def make_app_sp_client(**auth: Any) -> WorkspaceClient:
    """WorkspaceClient with APP_SP_CLIENT_OPTIONS applied. WorkspaceClient only forwards
    its own named args to Config, so the SDK tuning knobs go through a Config object.
    product/product_version mirror WorkspaceClient's own defaults."""
    return WorkspaceClient(
        config=Config(product="unknown", product_version="0.0.0", **auth, **APP_SP_CLIENT_OPTIONS)
    )


class _ConfigDependency(LifespanDependency):
    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        app.state.config = AppConfig()
        logger.info(f"Starting app with configuration:\n{app.state.config}")
        yield

    @staticmethod
    async def __call__(request: Request) -> AppConfig:
        # async: a plain attribute read, no I/O — avoids a threadpool hop per request.
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
        # Lazy create on first access. Stays sync: building the client may run
        # the CLI auth chain (blocking I/O), so it must not run on the event loop.
        if request.app.state._workspace_client is None:
            request.app.state._workspace_client = make_app_sp_client()
        return request.app.state._workspace_client


# OBO clients keyed by sha256(token), reused for a few minutes instead of building
# a new requests.Session + TLS handshake on every request. The key is a digest, so a
# request only ever gets the client built for its own token; an expired or revoked
# token is still rejected by the server on the call itself.
_OBO_CACHE_MAX = 256
_OBO_CACHE_TTL_SECONDS = 300.0
_obo_cache: OrderedDict[str, tuple[float, WorkspaceClient]] = OrderedDict()
_obo_lock = threading.Lock()


def _obo_workspace_client(token: str) -> WorkspaceClient:
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.monotonic()
    with _obo_lock:
        hit = _obo_cache.get(key)
        if hit is not None and now - hit[0] < _OBO_CACHE_TTL_SECONDS:
            _obo_cache.move_to_end(key)
            return hit[1]
    # set pat explicitly to avoid issues with SP client
    ws = make_app_sp_client(token=token, auth_type="pat")
    with _obo_lock:
        _obo_cache[key] = (now, ws)
        _obo_cache.move_to_end(key)
        while len(_obo_cache) > _OBO_CACHE_MAX:
            _obo_cache.popitem(last=False)
    return ws


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

    return _obo_workspace_client(headers.token.get_secret_value())


ConfigDependency: TypeAlias = Annotated[AppConfig, _ConfigDependency.depends()]

ClientDependency: TypeAlias = Annotated[
    WorkspaceClient, _WorkspaceClientDependency.depends()
]

UserWorkspaceClientDependency: TypeAlias = Annotated[
    WorkspaceClient, Depends(_get_user_ws)
]
