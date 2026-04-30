"""Per-project FMAPI auth for the Claude Code subprocess.

Goal
----
Stop passing `ANTHROPIC_*` env vars on the subprocess (they confuse the agent
into copying them onto Databricks CLI calls). Instead, drop a project-local
`.claude/settings.json` that points Claude Code at the FMAPI Anthropic bridge,
plus a tiny shell helper that prints a fresh OAuth token from a file the
backend rewrites every ~15 min.

Layout per project (deployed mode only)::

    <project_dir>/
    ├── .anthropic_token              ← refreshed by background task
    ├── get_anthropic_token.sh        ← written once, prints the token above
    └── .claude/
        └── settings.json             ← apiKeyHelper + env (BASE_URL, MODEL, ...)

Tokens are SP OAuth bearers minted via WorkspaceClient — same source the
existing FMAPI-env-var path used. Refresh cadence is 15 min (FMAPI tokens last
~1h, so we have plenty of headroom even if a refresh blips).

In local dev (no `DATABRICKS_CLIENT_ID`) we don't write any of these files —
Claude Code falls back to the developer's existing ANTHROPIC_API_KEY/`claude
login` setup. The settings.json is also skipped because there's nothing
useful to point at; the agent uses default Anthropic API.
"""

from __future__ import annotations

import json
import logging
import os
import stat
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


TOKEN_FILE_NAME = ".anthropic_token"
HELPER_SCRIPT_NAME = "get_anthropic_token.sh"
SETTINGS_DIR = ".claude"
SETTINGS_FILE = "settings.json"


def is_deployed_mode() -> bool:
    """True when running inside a Databricks App container.

    Mirrors `agent._build_claude_env` — relies on the App runtime injecting
    DATABRICKS_CLIENT_ID into the container. Locally we never bother with
    these files.
    """
    return bool(os.environ.get("DATABRICKS_CLIENT_ID"))


def _atomic_write(path: Path, content: str, *, mode: int = 0o600) -> None:
    """Same atomic-write pattern as core.auth.write_project_auth_file.

    Write to a same-directory temp file, set perms, then `os.replace` onto
    the target. Readers never see a half-written file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def write_token_file(project_dir: Path, token: str) -> Path:
    """Atomically rewrite `<project_dir>/.anthropic_token` with the OAuth bearer."""
    target = project_dir / TOKEN_FILE_NAME
    _atomic_write(target, token, mode=0o600)
    return target


def write_helper_script(project_dir: Path) -> Path:
    """Write the apiKeyHelper script (idempotent, written once per project).

    Two-line script: print the contents of `.anthropic_token` next to it.
    Claude Code execs this in `/bin/sh` and uses stdout as the bearer token.
    """
    target = project_dir / HELPER_SCRIPT_NAME
    if target.exists():
        return target
    content = (
        "#!/bin/sh\n"
        '# Print the FMAPI bearer token from the file the backend keeps fresh.\n'
        '# Backend refreshes ./'
        + TOKEN_FILE_NAME
        + ' every ~15 min — see core/fmapi_auth.py.\n'
        'cat "$(dirname "$0")/'
        + TOKEN_FILE_NAME
        + '"\n'
    )
    _atomic_write(target, content, mode=0o700)
    return target


def write_settings_json(
    project_dir: Path,
    *,
    anthropic_base_url: str,
    anthropic_model: str,
) -> Path:
    """Write `<project_dir>/.claude/settings.json` with apiKeyHelper + env.

    `apiKeyHelper` uses an absolute path because the SDK guide flags
    project-relative helper paths as not-officially-documented.
    """
    settings_dir = project_dir / SETTINGS_DIR
    target = settings_dir / SETTINGS_FILE

    helper_abs = (project_dir / HELPER_SCRIPT_NAME).resolve()

    payload = {
        # Absolute path required — see core/fmapi_auth.py docstring.
        "apiKeyHelper": str(helper_abs),
        "env": {
            "ANTHROPIC_BASE_URL": anthropic_base_url,
            "ANTHROPIC_MODEL": anthropic_model,
            "ANTHROPIC_CUSTOM_HEADERS": "x-databricks-use-coding-agent-mode: true",
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
        },
        # Stop the SDK from inheriting any MCP servers from elsewhere — same
        # belt-and-braces as agent.py's mcp_servers={}.
        "enableAllProjectMcpServers": False,
    }
    _atomic_write(target, json.dumps(payload, indent=2) + "\n", mode=0o600)
    return target


def provision_project_files(
    project_dir: Path,
    *,
    anthropic_base_url: str,
    anthropic_model: str,
    token: str,
) -> None:
    """One-shot: write all three files for a project.

    Called when a project is first provisioned (skills_manager) and during
    background token refresh (refresh just rewrites the token file).
    """
    write_helper_script(project_dir)
    write_settings_json(
        project_dir,
        anthropic_base_url=anthropic_base_url,
        anthropic_model=anthropic_model,
    )
    write_token_file(project_dir, token)


def mint_fmapi_token() -> tuple[str, str] | None:
    """Mint a fresh SP OAuth bearer for FMAPI's Anthropic bridge.

    Returns (host, token) or None if not deployed / cannot authenticate.
    """
    if not is_deployed_mode():
        return None
    from databricks.sdk import WorkspaceClient

    ws = WorkspaceClient()
    host = (ws.config.host or "").rstrip("/")
    if not host:
        return None
    headers = ws.config.authenticate()
    token = headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return None
    return host, token


def delete_project_files(project_dir: Path) -> None:
    """Best-effort cleanup on project delete (rmtree handles it anyway)."""
    for name in (TOKEN_FILE_NAME, HELPER_SCRIPT_NAME):
        try:
            (project_dir / name).unlink(missing_ok=True)
        except OSError:
            pass
    try:
        (project_dir / SETTINGS_DIR / SETTINGS_FILE).unlink(missing_ok=True)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Background refresher
# ---------------------------------------------------------------------------

REFRESH_INTERVAL_SECONDS = 15 * 60  # FMAPI bearers last ~1h; 15 min is comfortable.


def refresh_all_projects(projects_base_dir: Path) -> int:
    """Mint a fresh token and rewrite `.anthropic_token` for every existing project.

    Skips projects that don't yet have a helper script (haven't been provisioned
    for FMAPI auth — likely a project from before this feature shipped, or a
    fresh project that hasn't gone through skills_manager yet). Returns the
    number of projects updated.

    Atomic write means concurrent reads from Claude Code's apiKeyHelper see
    either the old or the new token, never a partial file.
    """
    if not is_deployed_mode():
        return 0
    minted = mint_fmapi_token()
    if minted is None:
        logger.warning("[fmapi-auth] could not mint token; skipping refresh")
        return 0
    _, token = minted
    if not projects_base_dir.exists():
        return 0

    updated = 0
    for child in projects_base_dir.iterdir():
        if not child.is_dir():
            continue
        # Only refresh projects that opted into the helper-based flow.
        if not (child / HELPER_SCRIPT_NAME).exists():
            continue
        try:
            write_token_file(child, token)
            updated += 1
        except Exception as e:
            logger.warning(f"[fmapi-auth] refresh failed for {child.name}: {e!r}")
    if updated:
        logger.info(f"[fmapi-auth] refreshed token for {updated} project(s)")
    return updated
