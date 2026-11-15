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

# Sentinel value for subprocess_auth_env: "REMOVE this key from the child's
# inherited env" (as opposed to "" = set it to empty). A child spawns as
# {**os.environ, **extra}, so a "" entry leaves the key PRESENT-but-empty —
# which the Node SDK's credential chain treats as "use PAT" → empty bearer →
# 400. Removing the key instead lets every SDK (Node AND Python) fall through
# to the explicit oauth-m2m creds. Consumers MUST merge via build_subprocess_env
# (below), never `{**os.environ, **extra}` directly, so the sentinel is honored.
UNSET_ENV = "\x00__DPG_UNSET__"


def build_subprocess_env(
    base: "dict[str, str] | os._Environ[str]", extra: dict[str, str]
) -> dict[str, str]:
    """Merge `extra` over `base`, honoring the UNSET_ENV sentinel as key-REMOVAL.

    The single choke point for building any Databricks-authenticated child's
    env. `extra` (from subprocess_auth_env) may map a key to UNSET_ENV to mean
    "remove whatever the parent inherited", which a plain dict-merge can't
    express (a dict entry is always present). See UNSET_ENV above.
    """
    merged = dict(base)
    for k, v in extra.items():
        if v is UNSET_ENV:
            merged.pop(k, None)
        else:
            merged[k] = v
    return merged


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
    # A user named by the trusted MCP service principal came through the proxy too: it
    # has no token of theirs, and the build runs as the deployer SP.
    if headers.delegated_by:
        return "deployed"
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


def _read_host_from_cfg(auth_file: Path) -> str | None:
    """Read `host = ...` from a written .databrickscfg. Returns None if
    unreadable / no host line."""
    host, _, _ = _read_sp_creds_from_cfg(auth_file)
    return host


def _read_sp_creds_from_cfg(auth_file: Path) -> tuple[str | None, str | None, str | None]:
    """Read (host, client_id, client_secret) from a deployer-SP .databrickscfg.

    These must be re-injected as explicit env vars for target deploys — the
    inherited Apps-runtime env (app SP creds + host) otherwise takes precedence
    over the config file. Returns (None, None, None) fields it can't find."""
    host = cid = secret = None
    try:
        for line in auth_file.read_text().splitlines():
            s = line.strip()
            key, sep, value = s.partition("=")
            if not sep:
                continue
            key, value = key.strip(), value.strip()
            if key == "host" and value:
                host = value
            elif key == "client_id" and value:
                cid = value
            elif key == "client_secret" and value:
                secret = value
    except OSError:
        pass
    return host, cid, secret


def subprocess_auth_env(
    project_dir: Path,
    *,
    mode: Mode,
    local_profile: str | None = None,
    target_deploy: bool = False,
) -> dict[str, str]:
    """Env overrides to pass to any Databricks-authenticated subprocess.

    Local mode:   delegate to ~/.databrickscfg via the user's selected profile.
                  The CLI handles token refresh via its own OAuth cache — no
                  file writes here. `local_profile` must be provided (the
                  user's choice from /setup).

    Deployed mode: point at <project_dir>/.databrickscfg, which middleware
                   keeps fresh from x-forwarded-access-token on every
                   request. Profile name is fixed to DEFAULT.

    `target_deploy=True` (Option A cross-workspace): the project's
    .databrickscfg was written by `write_project_sp_auth_file` with the
    deployer SP's OAuth-M2M creds pointed at a TARGET workspace. We must NOT
    scrub DATABRICKS_CLIENT_ID/SECRET (that scrub exists to FORCE the OBO PAT
    over the app-SP for same-workspace deploys) and must pin auth_type to
    oauth-m2m so the SDK reads client_id/client_secret from the file. When
    False the behavior is byte-for-byte the original OBO path.
    """
    if mode == "deployed":
        auth_file = project_dir / AUTH_FILE_NAME
        if target_deploy:
            # SP-target (Option A cross-workspace). The deployer SP's creds +
            # the TARGET host must deploy into the target workspace.
            #
            # CRITICAL — why we inject creds as ENV, not just point at the cfg
            # file: the Databricks Apps runtime sets DATABRICKS_HOST *and*
            # DATABRICKS_CLIENT_ID/SECRET (the APP's own SP) in the parent env.
            # The SDK/CLI auth precedence puts those inherited env vars ABOVE the
            # `host`/creds in a DATABRICKS_CONFIG_FILE. So if we only set
            # DATABRICKS_CONFIG_FILE, the subprocess authenticates as the APP SP
            # against the HOST workspace — exactly the bug where demo resources
            # landed in the host workspace owned by the app SP. We therefore read
            # the deployer SP's host + client_id/secret back out of the cfg we
            # just wrote and set them as explicit env vars, which unambiguously
            # win, and REMOVE DATABRICKS_TOKEN so a stray inherited PAT can't
            # shadow the oauth-m2m creds.
            #
            # ⚠️ REMOVE, don't blank. We map DATABRICKS_TOKEN -> UNSET_ENV (a
            # key-REMOVAL sentinel honored by build_subprocess_env), NOT "". The
            # child spawns as {**os.environ, **this}: an "" entry leaves the key
            # PRESENT-but-empty. The PYTHON SDK/CLI (the agent) ignores an empty
            # token given auth_type=oauth-m2m, but the NODE SDK inside the
            # generated app treats a PRESENT (even empty) DATABRICKS_TOKEN as
            # "use PAT" -> empty bearer -> 400 Invalid Token on serving/REST. The
            # Apps runtime shadows via CLIENT_ID/SECRET (overwritten above), not a
            # PAT, so removing the key is safe AND lets EVERY path in the app
            # (authHeaders, execSql, mlflow, warehouse, the Lakebase pool) plus
            # the Python agent resolve oauth-m2m from the explicit creds — with
            # ZERO app-side auth logic. This is the single choke point; the
            # template's server/lib/auth.ts stays dumb (no M2M pinning).
            host, cid, secret = _read_sp_creds_from_cfg(auth_file)
            if not (host and cid and secret) or not _valid_target_host(host):
                logger.error(
                    "target_deploy: could not read a valid SP host/creds from %s — "
                    "refusing to fall through to the app SP / host workspace",
                    auth_file,
                )
                # Fail closed: without a real target identity, better to write
                # nothing than to silently deploy to the host as the app SP.
                return {"DATABRICKS_CONFIG_FILE": str(auth_file)}
            return {
                "DATABRICKS_CONFIG_FILE": str(auth_file),
                "DATABRICKS_CONFIG_PROFILE": AUTH_FILE_PROFILE,
                "DATABRICKS_AUTH_TYPE": "oauth-m2m",
                "DATABRICKS_HOST": host,
                "DATABRICKS_CLIENT_ID": cid,
                "DATABRICKS_CLIENT_SECRET": secret,
                "DATABRICKS_TOKEN": UNSET_ENV,  # REMOVE the inherited key (not "")
            }
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


def target_deploy_active(config, target_workspace_host: str | None) -> bool:
    """Is THIS project deploying cross-workspace? Delegates to the remote_deploy
    module's predicate; returns False if that module is absent (generic Tier-1
    build) so the whole app degrades to same-workspace OBO. Re-exported here so
    existing callers can keep importing it from `core.auth`."""
    try:
        from ..remote_deploy.auth import target_deploy_active as _impl
    except ImportError:
        return False  # remote_deploy/ excluded → never cross-workspace.
    return _impl(config, target_workspace_host)


# ── SP mode: the deployer-SP identity, not a per-user OBO token ──────────────
# When a project runs cross-workspace it authenticates as the deployer SERVICE
# PRINCIPAL (oauth-m2m, non-expiring machine creds in the container env), NOT the
# viewing user's short-lived OBO PAT. The whole conversation-DRIVER model —
# active_driver_email, token-freshness gating, the 409-on-stale, take-over —
# exists ONLY to manage a per-user OBO PAT (one file, one identity, refreshed per
# request; see AUTH.md "Conversation driver"). In SP mode there is exactly ONE
# non-expiring identity and nothing to "take over", so that model is meaningless
# and is bypassed entirely. `active_driver_email` is stamped with this sentinel
# instead of a human email so the field stays meaningful/queryable but never gates
# anything. (It's also why interrupted SP conversations are RESUMABLE on boot: the
# SP creds are always present, unlike a dead OBO token — see services/resume_agent.)
SP_DRIVER_SENTINEL = "remote_sp"


def project_runs_as_sp(config, project) -> bool:
    """True iff THIS project's agent authenticates as the deployer SP (oauth-m2m)
    rather than the viewing user's OBO PAT. The single predicate that gates the
    driver-model bypass + boot-time resume. Same rule as the subprocess-env /
    proxy-strip split (`target_deploy_active`), read from the project's pinned
    target host. `project` is a `Project` row (needs `.target_workspace_host`);
    tolerant of None so callers can pass a possibly-missing project."""
    if project is None:
        return False
    return target_deploy_active(config, getattr(project, "target_workspace_host", None))


def write_project_databrickscfg(
    project_dir: Path,
    *,
    config,
    target_workspace_host: str | None,
    user_pat: str | None,
    user_host: str | None,
) -> str | None:
    """Write <project>/.databrickscfg with the right identity for this project,
    and return the label of what was written ("sp-target" | "obo" | None).

    - Cross-workspace (target set + deployer SP configured): OAuth-M2M creds
      for the deployer SP pointed at the TARGET workspace host. This branch lives
      in the OPTIONAL `remote_deploy/` module; imported under try/except so a
      generic build without that module simply never takes it.
    - Otherwise (classic): the user's OBO PAT pointed at the app's host workspace.

    Callers pass whatever they have; this decides. Returns None (writes nothing)
    if the required inputs for the chosen mode are missing, so callers can log.
    """
    try:
        from ..remote_deploy.auth import (
            target_deploy_active as _sp_active,
            write_project_sp_auth_file,
        )
    except ImportError:
        _sp_active = None  # remote_deploy/ excluded from this build.

    if _sp_active is not None and _sp_active(config, target_workspace_host):
        host = _normalize_host(target_workspace_host)  # type: ignore[arg-type]
        if not _valid_target_host(host):
            # Fail closed: the deployer secret is never written for a non-Databricks host.
            logger.error("refusing to write deployer-SP creds for non-workspace target %r", host)
            return None
        write_project_sp_auth_file(
            project_dir,
            host=host,
            client_id=config.deployer_sp_client_id,
            client_secret=config.deployer_sp_client_secret,
        )
        return "sp-target"
    # classic OBO
    if user_pat and user_host:
        write_project_auth_file(project_dir, user_host, user_pat)
        return "obo"
    return None


def delete_project_auth_file(project_dir: Path) -> None:
    """Called from project delete. Belt & braces — rmtree would get it
    anyway, but explicit is easier to audit."""
    try:
        (project_dir / AUTH_FILE_NAME).unlink(missing_ok=True)
    except OSError:
        pass


def resolve_host(headers: DatabricksAppsHeaders) -> str | None:
    """Resolve the WORKSPACE host (e.g. https://<workspace>.cloud.databricks.com)
    for the per-project .databrickscfg.

    `X-Forwarded-Host` (= `headers.host`) is the App's *public* hostname
    (`<app>-<id>.aws.databricksapps.com`) — useless for Databricks API
    calls. The workspace URL only lives in `DATABRICKS_HOST`, which the
    Apps runtime sets in the container env. Prefer it.

    Always returned with an `https://` scheme. Bundle CLI does naive
    string-equality between the host in the profile and the host in
    databricks.yml — `<workspace>…` vs `https://<workspace>…` fails the check
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


def _valid_target_host(host: str | None) -> bool:
    """True iff `host` is a Databricks workspace URL — the only kind of host the
    deployer SP's client secret may be written for or handed to. Lazy import:
    remote_deploy/ may be excluded from a build (then no target ever activates)."""
    from ..remote_deploy.probe import validate_target_host

    if not host:
        return False
    try:
        validate_target_host(host)
    except ValueError:
        return False
    return True


# Debounce window for the per-project auth file refresh. The proxy fires on
# every static asset the iframe loads — without debouncing we'd thrash the
# disk. 30s is comfortably below the PAT's typical 1h TTL but well above
# static-asset burst rate. Keyed by project_id + token-prefix so a token
# change invalidates the debounce (rare, but correct).
_AUTH_REFRESH_DEBOUNCE_SECONDS = 30.0
# (project_id, caller_email, pat_prefix) → last-write monotonic time. Bounded
# (drop-oldest) so it can't grow one entry per (project, user, token) over the
# app's lifetime. An entry is only ever STAMPED after the caller passed the
# writer checks, so a debounce hit proves that same caller was already authorized.
_auth_refresh_last: dict[tuple[str, str, str], float] = {}
_AUTH_REFRESH_LAST_MAX = 10_000


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
        # Deployed mode always carries the caller's email in the header.
        caller_email = headers.user_email or ""
        # Debounce check FIRST so a proxied asset burst costs no DB reads. Safe to
        # skip the auth reads on a hit: the key is only stamped (below) after this
        # same caller passed the writer checks, and a hit writes nothing anyway.
        key = (project_id, caller_email, pat[:16])
        if debounce:
            last = _auth_refresh_last.get(key, 0.0)
            if time.monotonic() - last < _AUTH_REFRESH_DEBOUNCE_SECONDS:
                return
        # IDENTITY GUARD: only the DRIVER (a write-access caller who currently
        # holds the conversation) may write the project's token file. A viewer
        # would stamp their PAT into the owner's dir; a non-driver editor would
        # thrash the token the current driver's agent run depends on — both swap
        # the agent's CLI identity. Lazy import to avoid a core→routes cycle.
        from ..routes.projects import ACCESS_VIEWER, _get_project_access, is_driver
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
        # Cross-workspace (SP-target) mode doesn't need the user host/PAT for the
        # file itself, but a resolvable host is still cheap context; only bail on
        # missing host in the classic OBO path.
        from ..models import Project
        project = session.get(Project, project_id)
        target_host = project.target_workspace_host if project else None
        sp_target = target_deploy_active(config, target_host)
        if not sp_target and not host:
            logger.warning(
                "deployed mode + PAT present but no host resolvable — "
                "skipping .databrickscfg refresh for project %s",
                project_id,
            )
            return
        if debounce:
            # Stamped only for an authorized writer. The PAT prefix (not the whole
            # token) keeps a token refresh forcing a write without storing the PAT.
            if len(_auth_refresh_last) >= _AUTH_REFRESH_LAST_MAX:
                _auth_refresh_last.pop(next(iter(_auth_refresh_last)), None)  # drop-oldest
            _auth_refresh_last[key] = time.monotonic()
        try:
            wrote = write_project_databrickscfg(
                get_project_dir(project_id),
                config=config,
                target_workspace_host=target_host,
                user_pat=pat,
                user_host=host,
            )
            if wrote is None:
                return
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
    "SP_DRIVER_SENTINEL",
    "build_subprocess_env",
    "WhoAmI",
    "delete_project_auth_file",
    "detect_mode",
    "is_admin",
    "make_project_auth_refresher",
    "project_runs_as_sp",
    "request_user_pat",
    "resolve_host",
    "subprocess_auth_env",
    "target_deploy_active",
    "whoami",
    "write_project_auth_file",
    "write_project_databrickscfg",
    "write_project_sp_auth_file",
]
