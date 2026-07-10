"""
Central auth & identity module.

THE rule: anything auth/identity-related lives here. Routes, services, and
subprocess spawn code call helpers from this module — they never read
headers or the users table directly for identity purposes. See AUTH.md
(in backend/) for the full model.

What lives here:
  - detect_mode(headers)                  → "local" | "deployed"
  - whoami(headers, session)              → WhoAmI response
  - request_user_pat(headers)             → the current user's PAT or None
  - subprocess_auth_env(project_dir, …)   → dict[str, str] for child env
  - write_project_auth_file(project_dir, …)
  - delete_project_auth_file(project_dir)

What does NOT live here:
  - The Databricks CLI profile list (that's plumbing for the local setup
    wizard; stays in routes/config.py).
  - Database connection status / health (routes/config.py).
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Literal

import time

from fastapi import Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..models import User
from ._defaults import ConfigDependency
from ._headers import DatabricksAppsHeaders, HeadersDependency
from .lakebase import LakebaseDependency

logger = logging.getLogger(__name__)

Mode = Literal["local", "deployed"]

# Stanza we write in deployed mode. Fixed to DEFAULT so subprocess env is
# trivially predictable: always point at the same profile name.
AUTH_FILE_NAME = ".databrickscfg"
AUTH_FILE_PROFILE = "DEFAULT"

# Dev knob: pretend we're deployed even without the header. Useful when
# testing the deployed-mode code path on a laptop. Never set in prod.
_FORCE_MODE_ENV = "DEMO_PROMPT_GENERATOR_FORCE_MODE"


# ---------------------------------------------------------------------------
# Mode detection
# ---------------------------------------------------------------------------


def detect_mode(headers: DatabricksAppsHeaders) -> Mode:
    """Return "deployed" if the Databricks Apps proxy injected a user PAT,
    else "local". One rule, one place, no other call sites.

    Never sniff env vars to decide mode — the header is the contract. Env
    vars like DATABRICKS_CLIENT_ID indicate the *parent* process is running
    as a Databricks App, but that alone doesn't mean THIS request came
    through the proxy with a user identity attached.

    The _FORCE_MODE_ENV dev knob is the one exception — it exists so you
    can exercise the deployed path locally.
    """
    forced = os.environ.get(_FORCE_MODE_ENV)
    if forced == "deployed":
        return "deployed"
    if forced == "local":
        return "local"
    return "deployed" if headers.token is not None else "local"


def request_user_pat(headers: DatabricksAppsHeaders) -> str | None:
    """Return the user's PAT from the request, or None in local mode."""
    if headers.token is None:
        return None
    return headers.token.get_secret_value()


def is_admin(email: str | None, admin_emails: list[str]) -> bool:
    """True if `email` is in the configured admin list (case-insensitive).

    Admins get read access to any project (list/get/files/messages) so they
    can support users debugging their own demos. Mutations remain owner-only.
    """
    if not email:
        return False
    needle = email.strip().lower()
    return any(needle == e.strip().lower() for e in admin_emails)


# ---------------------------------------------------------------------------
# whoami
# ---------------------------------------------------------------------------


class WhoAmI(BaseModel):
    """Single source of truth for "who is the user".

    Consumers (UI + other services) read this. Nothing else. See AUTH.md.
    """

    email: str | None
    databricks_profile: str | None
    mode: Mode
    is_configured: bool


def whoami(headers: DatabricksAppsHeaders, session: Session) -> WhoAmI:
    """Resolve the current user's identity.

    Deployed mode: header is authoritative; profile is N/A (the PAT is the
    auth). Always `is_configured=True` — there's nothing to configure.

    Local mode: single User row in the DB populated by /setup.
    """
    mode = detect_mode(headers)

    if mode == "deployed":
        if not headers.user_email:
            # Should be impossible through the Apps proxy — it always
            # sends x-forwarded-email alongside the token. Log loud: if we
            # see this, something bypassed the proxy.
            logger.warning(
                "deployed mode but no x-forwarded-email header; proxy bypass?"
            )
        return WhoAmI(
            email=headers.user_email,
            databricks_profile=None,
            mode="deployed",
            is_configured=True,
        )

    # Local mode: the DB row is the user.
    user = session.exec(select(User).limit(1)).first()
    if user is None:
        return WhoAmI(
            email=None,
            databricks_profile=None,
            mode="local",
            is_configured=False,
        )
    return WhoAmI(
        email=user.email,
        databricks_profile=user.databricks_profile,
        mode="local",
        is_configured=True,
    )


# ---------------------------------------------------------------------------
# Subprocess environment
# ---------------------------------------------------------------------------


def subprocess_auth_env(
    project_dir: Path,
    *,
    mode: Mode,
    local_profile: str | None = None,
) -> dict[str, str]:
    """Env overrides to pass to any Databricks-authenticated subprocess.

    Local mode:   delegate to ~/.databrickscfg via the user's selected profile.
                  The CLI handles token refresh via its own OAuth cache — no
                  file writes here. `local_profile` must be provided (the
                  user's choice from /setup).

    Deployed mode: point at <project_dir>/.databrickscfg, which middleware
                   keeps fresh from x-forwarded-access-token on every
                   request. Profile name is fixed to DEFAULT.
    """
    if mode == "deployed":
        auth_file = project_dir / AUTH_FILE_NAME
        # Scrub OAuth-M2M creds the Databricks Apps runtime sets in the parent
        # process. Without this, the subprocess inherits DATABRICKS_CLIENT_ID/
        # SECRET and the SDK auth chain picks oauth-m2m (the app SP) over the
        # PAT in our config file — so resources get created as the SP instead
        # of the user. Pinning DATABRICKS_AUTH_TYPE=pat is belt-and-braces.
        return {
            "DATABRICKS_CONFIG_FILE": str(auth_file),
            "DATABRICKS_CONFIG_PROFILE": AUTH_FILE_PROFILE,
            "DATABRICKS_AUTH_TYPE": "pat",
            "DATABRICKS_CLIENT_ID": "",
            "DATABRICKS_CLIENT_SECRET": "",
        }

    # local
    if not local_profile:
        # No profile configured yet (fresh install, /setup not done). Let
        # the subprocess inherit whatever the parent has; the CLI will
        # fall through to its default resolution chain. Logged so the
        # "why is my agent unauthenticated" question is answerable.
        logger.info(
            "subprocess spawning with no explicit profile — "
            "relying on inherited Databricks auth env",
        )
        return {}
    return {"DATABRICKS_CONFIG_PROFILE": local_profile}


# ---------------------------------------------------------------------------
# Per-project .databrickscfg (deployed mode only)
# ---------------------------------------------------------------------------


def write_project_auth_file(project_dir: Path, host: str, token: str) -> Path:
    """Atomically rewrite <project_dir>/.databrickscfg with the user's PAT.

    Called from middleware on every authenticated deployed-mode request
    that has a project context (and from the ping endpoint, which counts
    as a keepalive). The CLI and SDK re-read the file per invocation, so
    a fresh write on each request → fresh token for the subprocess.

    Atomicity: write to a same-directory tempfile, set mode 0600, then
    os.replace() onto the target. Readers never see a half-written file.
    """
    project_dir.mkdir(parents=True, exist_ok=True)
    target = project_dir / AUTH_FILE_NAME
    content = (
        f"[{AUTH_FILE_PROFILE}]\n"
        f"host = {host}\n"
        f"token = {token}\n"
    )

    fd, tmp_path = tempfile.mkstemp(
        dir=str(project_dir),
        prefix=".databrickscfg.",
        suffix=".tmp",
    )
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp_path, target)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return target


def delete_project_auth_file(project_dir: Path) -> None:
    """Called from project delete. Belt & braces — rmtree would get it
    anyway, but explicit is easier to audit."""
    try:
        (project_dir / AUTH_FILE_NAME).unlink(missing_ok=True)
    except OSError:
        pass


def resolve_host(headers: DatabricksAppsHeaders) -> str | None:
    """Resolve the WORKSPACE host (e.g. https://e2-demo-…cloud.databricks.com)
    for the per-project .databrickscfg.

    `X-Forwarded-Host` (= `headers.host`) is the App's *public* hostname
    (`<app>-<id>.aws.databricksapps.com`) — useless for Databricks API
    calls. The workspace URL only lives in `DATABRICKS_HOST`, which the
    Apps runtime sets in the container env. Prefer it.

    Always returned with an `https://` scheme. Bundle CLI does naive
    string-equality between the host in the profile and the host in
    databricks.yml — `e2-demo…` vs `https://e2-demo…` fails the check
    and breaks `databricks bundle …` from the agent's subprocess.
    """
    env_host = os.environ.get("DATABRICKS_HOST")
    if env_host:
        return _normalize_host(env_host)
    # Fallback: only useful in local dev where the request actually came
    # from the workspace itself (rare). Skip the X-Forwarded-Host case
    # entirely in deployed mode — it ALWAYS points at the App, not the WS.
    if headers.host and "databricksapps.com" not in headers.host:
        return _normalize_host(headers.host)
    return None


def _normalize_host(host: str) -> str:
    host = host.strip().rstrip("/")
    if not host.startswith("http://") and not host.startswith("https://"):
        host = f"https://{host}"
    return host


# Debounce window for the per-project auth file refresh. The proxy fires on
# every static asset the iframe loads — without debouncing we'd thrash the
# disk. 30s is comfortably below the PAT's typical 1h TTL but well above
# static-asset burst rate. Keyed by project_id + token-prefix so a token
# change invalidates the debounce (rare, but correct).
_AUTH_REFRESH_DEBOUNCE_SECONDS = 30.0
_auth_refresh_last: dict[tuple[str, str], float] = {}


def make_project_auth_refresher(
    get_project_dir: "callable[[str], Path]",
    *,
    debounce: bool = True,
):
    """Build a FastAPI dependency that keeps <project>/.databrickscfg fresh.

    Attach to deployed-mode project-scoped routes that spawn or proxy to
    subprocesses (chat stream, preview start/restart/ping, preview proxy).
    The dependency resolves `project_id` from the path, writes the file
    if we're in deployed mode with a PAT, and is a no-op otherwise.

    Set `debounce=False` for lifecycle endpoints (start/restart/invoke) that
    MUST see a fresh write before spawning a subprocess. `debounce=True`
    is the default and is appropriate for the proxy (fires on every iframe
    request) and ping — they're keepalive-style touches where once-per-30s
    is plenty.

    Usage:
        refresh_project_auth = make_project_auth_refresher(get_project_dir)

        @router.post("/api/preview/{project_id}/start",
                     dependencies=[Depends(refresh_project_auth)])
        async def start(...): ...
    """

    def refresh_project_auth(
        project_id: str,
        headers: HeadersDependency,
        session: LakebaseDependency,
        config: ConfigDependency,
    ) -> None:
        if detect_mode(headers) != "deployed":
            return
        pat = request_user_pat(headers)
        if pat is None:
            return
        # IDENTITY GUARD: only the DRIVER (a write-access caller who currently
        # holds the conversation) may write the project's token file. A viewer
        # would stamp their PAT into the owner's dir; a non-driver editor would
        # thrash the token the current driver's agent run depends on — both swap
        # the agent's CLI identity. Lazy import to avoid a core→routes cycle.
        from ..routes.projects import ACCESS_VIEWER, _get_project_access, is_driver
        # Deployed mode always carries the caller's email in the header.
        caller_email = headers.user_email or ""
        try:
            _, access = _get_project_access(
                session, project_id, caller_email, config.template_admin_emails
            )
        except Exception:
            return  # no access / project gone — never write
        if access == ACCESS_VIEWER:
            return  # read-only: never overwrite the owner's token
        if not is_driver(session, project_id, caller_email):
            return  # not the driver: don't thrash the current driver's token
        host = resolve_host(headers)
        if not host:
            logger.warning(
                "deployed mode + PAT present but no host resolvable — "
                "skipping .databrickscfg refresh for project %s",
                project_id,
            )
            return
        if debounce:
            # Key on PAT prefix so a token refresh forces a write, but we don't
            # store the whole PAT in a process-global dict.
            key = (project_id, pat[:16])
            now = time.monotonic()
            last = _auth_refresh_last.get(key, 0.0)
            if now - last < _AUTH_REFRESH_DEBOUNCE_SECONDS:
                return
            _auth_refresh_last[key] = now
        try:
            write_project_auth_file(get_project_dir(project_id), host, pat)
            # Stamp the driver token-freshness clock so non-drivers know the
            # token is current (the driver just refreshed it via preview).
            from ..routes.projects import claim_driver
            claim_driver(session, project_id, caller_email)
        except Exception:
            # Non-fatal: if the refresh fails, the subprocess will use the
            # previous file. Next request will try again.
            logger.exception(
                "failed to refresh .databrickscfg for project %s", project_id
            )

    return refresh_project_auth


__all__ = [
    "AUTH_FILE_NAME",
    "AUTH_FILE_PROFILE",
    "Mode",
    "WhoAmI",
    "delete_project_auth_file",
    "detect_mode",
    "is_admin",
    "make_project_auth_refresher",
    "request_user_pat",
    "resolve_host",
    "subprocess_auth_env",
    "whoami",
    "write_project_auth_file",
]
