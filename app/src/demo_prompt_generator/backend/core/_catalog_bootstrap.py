"""Hard-gate on the default Unity Catalog at boot.

Every project the generator creates lives under `config.default_catalog`
(default: `ai_demo_gen`, override via the `DEFAULT_CATALOG` env var). If
that catalog is missing — or doesn't grant USE_CATALOG + CREATE_SCHEMA to
`account users` — every new project hits PERMISSION_DENIED on its first
CREATE SCHEMA call. The user sees a stack trace instead of actionable
guidance.

Strategy: at boot, fire a daemon thread that validates the catalog. The
check is non-blocking — FastAPI starts serving immediately while the
thread does its work — but if validation fails we log the exact `GRANT`
statements the deployer needs to run, then `os._exit(1)` so the container
restarts in a known-bad-but-loud state instead of limping along.

Checks performed:
  1. Catalog exists (`ws.catalogs.get`).
  2. `account users` has BOTH `USE_CATALOG` and `CREATE_SCHEMA` on it.
  3. Each admin in `template_admin_emails` has `ALL_PRIVILEGES`.

A missing privilege triggers the crash; everything else is informational.
The deployer is expected to run the GRANT statements manually — we don't
attempt to grant from the app's own SP because most deployments don't
give the SP metastore-admin rights.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError, NotFound
from fastapi import FastAPI

from ._base import LifespanDependency
from ._config import AppConfig

logger = logging.getLogger(__name__)

# Required for any signed-in user to spin up + populate a schema.
_USER_REQUIRED = ("USE_CATALOG", "CREATE_SCHEMA")

# Required for admins so they can clean up across users' schemas.
_ADMIN_REQUIRED = ("ALL_PRIVILEGES",)


def _principal_privileges(
    ws: WorkspaceClient, catalog: str, principal: str
) -> set[str]:
    """Return the set of privilege names `principal` holds on the catalog.

    Uses the `principal=` filter on `grants.get` so the response only
    carries the one assignment we care about. Returns an empty set on any
    error so the caller treats the principal as un-granted (the right
    failure mode for a permission gate).
    """
    try:
        resp = ws.grants.get(
            securable_type="CATALOG",
            full_name=catalog,
            principal=principal,
        )
    except DatabricksError as e:
        logger.warning(
            f"[catalog-bootstrap] could not list grants on {catalog!r} "
            f"for {principal!r}: {e}"
        )
        return set()

    out: set[str] = set()
    for assignment in resp.privilege_assignments or []:
        for p in assignment.privileges or []:
            # `p.privilege` is the SDK enum; .value is the canonical
            # string ("USE_CATALOG", etc.).
            name = getattr(p.privilege, "value", None) or str(p.privilege)
            if name:
                out.add(name)
    return out


def _fail(reasons: list[str], catalog: str, admins: list[str]) -> None:
    """Log a multi-line, actionable error message and crash the process.

    The deployer needs to know *exactly* what to GRANT. We dump copy-paste
    SQL statements alongside the failure summary.
    """
    grants_sql = [
        f"GRANT USE CATALOG ON CATALOG `{catalog}` TO `account users`;",
        f"GRANT CREATE SCHEMA ON CATALOG `{catalog}` TO `account users`;",
    ]
    for admin in admins:
        grants_sql.append(
            f"GRANT ALL PRIVILEGES ON CATALOG `{catalog}` TO `{admin}`;"
        )

    banner = "═" * 70
    msg = "\n".join(
        [
            "",
            banner,
            "  CATALOG BOOTSTRAP FAILED — APP IS REFUSING TO START",
            banner,
            f"  Default catalog: {catalog!r}",
            "",
            "  Problems detected:",
            *[f"    • {r}" for r in reasons],
            "",
            "  Fix: run these statements in the workspace SQL editor",
            "  (as a metastore admin or the catalog owner), then redeploy:",
            "",
            *[f"    {sql}" for sql in grants_sql],
            "",
            "  If the catalog doesn't exist yet, create it first:",
            f"    CREATE CATALOG IF NOT EXISTS `{catalog}`;",
            "",
            "  To use a different catalog instead, set DEFAULT_CATALOG in",
            "  databricks.<target>.yml's app_env: block (or in .env locally)",
            "  and redeploy.",
            banner,
            "",
        ]
    )
    logger.error(msg)
    # Use os._exit so we don't get caught by uvicorn's lifespan exception
    # handling — we want the container to die and restart, not the app to
    # half-start with an opaque error somewhere up the stack.
    os._exit(1)


def _check(config: AppConfig) -> None:
    """Validate the catalog + grants. Crash the process on failure.

    Runs in a daemon thread so FastAPI startup isn't blocked.
    """
    catalog = (config.default_catalog or "").strip()
    if not catalog:
        logger.info("[catalog-bootstrap] no default_catalog configured — skipping")
        return

    admins = config.template_admin_emails

    try:
        ws = WorkspaceClient()
    except Exception as e:  # noqa: BLE001
        # Can't build a client → can't verify anything. This is fatal
        # because every project create path needs a working WorkspaceClient
        # anyway; failing loud here is better than failing per-request.
        logger.error(
            f"[catalog-bootstrap] could not build WorkspaceClient: {e}. "
            f"Cannot verify default catalog — refusing to start."
        )
        os._exit(1)

    # 1. Catalog must exist.
    try:
        ws.catalogs.get(catalog)
        logger.info(f"[catalog-bootstrap] catalog {catalog!r} exists")
    except NotFound:
        _fail(
            [f"catalog {catalog!r} does not exist in this workspace"],
            catalog,
            admins,
        )
    except DatabricksError as e:
        _fail(
            [
                f"could not look up catalog {catalog!r}: {e}",
                "(the app's service principal likely needs USE CATALOG on it)",
            ],
            catalog,
            admins,
        )

    # 2. `account users` must have BOTH user-level privileges.
    user_grants = _principal_privileges(ws, catalog, "account users")
    missing_user = [p for p in _USER_REQUIRED if p not in user_grants]

    # 3. Each admin must have ALL_PRIVILEGES.
    missing_admin: list[str] = []
    for admin in admins:
        admin_grants = _principal_privileges(ws, catalog, admin)
        if "ALL_PRIVILEGES" not in admin_grants:
            missing_admin.append(admin)

    reasons: list[str] = []
    if missing_user:
        reasons.append(
            f"`account users` is missing on {catalog!r}: "
            f"{', '.join(missing_user)}"
        )
    if missing_admin:
        reasons.append(
            f"admins missing ALL_PRIVILEGES on {catalog!r}: "
            f"{', '.join(repr(a) for a in missing_admin)}"
        )

    if reasons:
        _fail(reasons, catalog, admins)

    logger.info(
        f"[catalog-bootstrap] {catalog!r} OK — "
        f"`account users` has {sorted(user_grants & set(_USER_REQUIRED))}, "
        f"{len(admins)} admin(s) verified"
    )


class _CatalogBootstrapDependency(LifespanDependency):
    """Spawn a daemon thread at startup to validate the default catalog.

    The thread is daemonic so it doesn't keep the process alive after the
    app exits cleanly. If validation fails, the thread calls `os._exit(1)`
    which terminates the whole process (uvicorn included).
    """

    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        config: AppConfig | None = getattr(app.state, "config", None)
        if config is None:
            logger.warning(
                "[catalog-bootstrap] AppConfig not on app.state — skipping. "
                "(Did _ConfigDependency get reordered out of the chain?)"
            )
        else:
            t = threading.Thread(
                target=_check,
                args=(config,),
                name="catalog-bootstrap",
                daemon=True,
            )
            t.start()
            logger.info(
                "[catalog-bootstrap] check dispatched in background thread"
            )
        yield
