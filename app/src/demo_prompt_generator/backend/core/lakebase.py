"""Lakebase integration: OAuth-only, single env var, sync SQLAlchemy.

Identity model
--------------
The Databricks SDK auth chain handles WHO we are (laptop profile or App SP) —
this module never sees a password or token from config. It mints fresh OAuth
tokens via /api/2.0/postgres/credentials and lets psycopg's pool inject them
into every new connection automatically.

Configuration
-------------
ONE env var: ``LAKEBASE_DATABASE_PATH`` of the form
    projects/<project-id>/branches/<branch-id>/databases/<db-name>

Set ``USE_PGLITE=1`` to skip Lakebase entirely and run a local Postgres for
offline dev. Without either, startup fails fast with a clear message.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import threading
from collections.abc import Generator
from concurrent.futures import TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, AsyncGenerator, TypeAlias

import psycopg
from alembic import command
from alembic.config import Config as AlembicConfig
from databricks.sdk import WorkspaceClient
from fastapi import FastAPI, Request
from sqlalchemy import Engine, create_engine, inspect
from sqlmodel import Session, SQLModel, text

from ._base import LifespanDependency
from ._config import logger


# ---------------------------------------------------------------------------
# PGLite (offline dev only — set USE_PGLITE=1 to opt in)
# ---------------------------------------------------------------------------

PGLITE_DIR = Path.home() / ".pglite"


def _is_pglite_mode() -> bool:
    """True iff the user explicitly opted into PGLite OR no Lakebase path is set.

    Rationale: without a Lakebase path we can't authenticate to anything real,
    so falling back to PGLite gives a working dev loop with zero configuration.
    """
    if os.environ.get("USE_PGLITE") == "1":
        return True
    return not os.environ.get("LAKEBASE_DATABASE_PATH")


def _create_pglite_engine() -> Engine:
    """Boot a local Postgres cluster in ~/.pglite/ for offline dev."""
    import subprocess

    import pglite

    if os.environ.get("RESET_DB") == "1" and PGLITE_DIR.exists():
        logger.warning(f"RESET_DB=1 — deleting PGLite directory: {PGLITE_DIR}")
        shutil.rmtree(PGLITE_DIR)

    PGLITE_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["PGLITE_DATA_DIR"] = str(PGLITE_DIR)
    logger.info(f"Using PGLite database at: {PGLITE_DIR}")

    pg_ctl = subprocess.run(["which", "pg_ctl"], capture_output=True, text=True)
    if pg_ctl.returncode != 0:
        raise RuntimeError(
            "PostgreSQL not found. Install with `brew install postgresql@16` "
            "or set LAKEBASE_DATABASE_PATH to use Lakebase."
        )

    if not pglite.check_cluster():
        pglite.init_cluster(pg_ctl_path=pg_ctl.stdout.strip())
    if not pglite.is_started():
        pglite.start_cluster()

    db = "demo_prompt_generator"
    if db not in pglite.list_db():
        pglite.create_db(db)

    params = dict(item.split("=") for item in pglite.cluster_params().split())
    user = os.environ.get("USER", "postgres")
    url = f"postgresql+psycopg://{user}@{params.get('host','localhost')}:{params.get('port','5432')}/{db}"
    return create_engine(url, pool_size=10, max_overflow=20, pool_timeout=5, pool_pre_ping=True)


# ---------------------------------------------------------------------------
# Lakebase OAuth — endpoint resolution, token minting, refresh
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Endpoint:
    """Resolved OAuth-target endpoint for a Lakebase database path."""
    database_path: str   # projects/<id>/branches/<b>/databases/<d>
    endpoint_path: str   # projects/<id>/branches/<b>/endpoints/<e>  (token audience)
    host: str            # ep-xxx.database.<region>.cloud.databricks.com
    database_name: str   # last segment of database_path


def _resolve_endpoint(ws: WorkspaceClient, database_path: str) -> _Endpoint:
    """Turn a database path into the read-write endpoint we'll connect to.

    ``database_path`` shape: projects/<id>/branches/<b>/databases/<d>.
    We pick the branch's primary read-write endpoint; multi-endpoint setups
    aren't supported here (uncommon for this app).
    """
    parts = database_path.strip("/").split("/")
    if len(parts) != 6 or parts[0] != "projects" or parts[2] != "branches" or parts[4] != "databases":
        raise ValueError(
            f"LAKEBASE_DATABASE_PATH must be `projects/<id>/branches/<b>/databases/<d>`, got: {database_path}"
        )
    branch_path = "/".join(parts[:4])  # projects/<id>/branches/<b>
    db_name = parts[5]

    resp = ws.api_client.do("GET", f"/api/2.0/postgres/{branch_path}/endpoints")
    endpoints = resp.get("endpoints", []) if isinstance(resp, dict) else []
    rw = next(
        (e for e in endpoints if e.get("status", {}).get("endpoint_type") == "ENDPOINT_TYPE_READ_WRITE"),
        None,
    )
    if rw is None:
        raise RuntimeError(f"No read-write endpoint found on {branch_path}")

    return _Endpoint(
        database_path=database_path,
        endpoint_path=rw["name"],
        host=rw["status"]["hosts"]["host"],
        database_name=db_name,
    )


@dataclass
class _Credential:
    token: str
    expires_at: datetime


def _mint_token(ws: WorkspaceClient, endpoint_path: str) -> _Credential:
    """Pure function — given a workspace and endpoint, return a fresh token."""
    resp = ws.api_client.do(
        "POST", "/api/2.0/postgres/credentials",
        body={"endpoint": endpoint_path},
    )
    return _Credential(
        token=resp["token"],
        expires_at=datetime.fromisoformat(resp["expire_time"].replace("Z", "+00:00")),
    )


def _user_from_token(token: str) -> str:
    """Postgres user is the JWT's `sub` claim. We minted the token, so trust it."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))["sub"]


class _LakebaseConnector:
    """Self-refreshing source of psycopg connections for SQLAlchemy.

    Holds the current OAuth token, hands a fresh one to every new psycopg
    connection (so SQLAlchemy's pool always opens connections with valid
    creds), and refreshes the token in the background ~5min before expiry.
    """

    REFRESH_SKEW = timedelta(minutes=5)

    def __init__(self, ws: WorkspaceClient, endpoint: _Endpoint):
        self._ws = ws
        self._endpoint = endpoint
        self._cred: _Credential | None = None
        self._lock = threading.Lock()
        self._refresh_thread: threading.Thread | None = None
        self._stop = threading.Event()

    # --- SQLAlchemy hook ----------------------------------------------------

    def connect(self) -> psycopg.Connection:
        """Open a fresh psycopg connection. Called by SQLAlchemy as `creator`."""
        with self._lock:
            if self._cred is None or self._is_expiring(self._cred):
                self._cred = _mint_token(self._ws, self._endpoint.endpoint_path)
            cred = self._cred
        return psycopg.connect(
            host=self._endpoint.host,
            port=5432,
            dbname=self._endpoint.database_name,
            user=_user_from_token(cred.token),
            password=cred.token,
            sslmode="require",
        )

    # --- background refresh -------------------------------------------------

    def start_refresh(self) -> None:
        """Mint the initial token and start the background refresher.

        Refresh is best-effort: if it fails, in-flight pooled connections keep
        working until token expiry, and the next ``connect()`` will retry the
        mint synchronously and surface the error to the caller.
        """
        with self._lock:
            if self._cred is None:
                self._cred = _mint_token(self._ws, self._endpoint.endpoint_path)
        self._refresh_thread = threading.Thread(
            target=self._refresh_loop, name="lakebase-token-refresh", daemon=True
        )
        self._refresh_thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _is_expiring(self, c: _Credential) -> bool:
        return c.expires_at - datetime.now(timezone.utc) < self.REFRESH_SKEW

    def _refresh_loop(self) -> None:
        while not self._stop.is_set():
            with self._lock:
                cred = self._cred
            sleep_for = (cred.expires_at - datetime.now(timezone.utc) - self.REFRESH_SKEW).total_seconds()
            if self._stop.wait(timeout=max(sleep_for, 60)):
                return
            try:
                fresh = _mint_token(self._ws, self._endpoint.endpoint_path)
                with self._lock:
                    self._cred = fresh
                logger.info(f"Lakebase token refreshed (expires {fresh.expires_at.isoformat()})")
            except Exception as e:
                logger.warning(f"Lakebase token refresh failed: {e!r} — will retry in 30s")
                self._stop.wait(timeout=30)


# ---------------------------------------------------------------------------
# Engine factory
# ---------------------------------------------------------------------------

# Lakebase always provisions a `databricks_postgres` DB on every new branch —
# we connect to it as a "maintenance" DB to issue CREATE DATABASE for ours.
_BOOTSTRAP_DB = "databricks_postgres"


def _ensure_database_exists(ws: WorkspaceClient, endpoint: _Endpoint) -> None:
    """Create the target database if it's missing. Idempotent.

    Runs once at boot. If the DB already exists, this is a single SELECT and
    a connection close. If it doesn't, we open a maintenance connection to
    `databricks_postgres`, run `CREATE DATABASE`, and return — the caller's
    real connection then opens against the now-existing target.
    """
    target = endpoint.database_name
    if target == _BOOTSTRAP_DB:
        return  # nothing to bootstrap; we *are* the bootstrap DB

    cred = _mint_token(ws, endpoint.endpoint_path)
    user = _user_from_token(cred.token)
    # dict[str, Any] so **common splats cleanly into psycopg.connect's overloads
    # (a plain dict infers dict[str, object], which mypy can't match to any overload).
    common: dict[str, Any] = dict(host=endpoint.host, port=5432, user=user, password=cred.token, sslmode="require")
    try:
        # Cheap probe — if connect succeeds, the DB exists, we're done.
        with psycopg.connect(dbname=target, **common, connect_timeout=5):
            return
    except psycopg.OperationalError as e:
        # `3D000` (invalid_catalog_name) is the explicit "DB doesn't exist" code.
        # Anything else (auth failure, network, timeout) is a real error worth surfacing.
        if getattr(e, "sqlstate", None) != "3D000" and "does not exist" not in str(e):
            raise

    logger.info(f"Lakebase: database '{target}' not found — creating via {_BOOTSTRAP_DB}")
    with psycopg.connect(dbname=_BOOTSTRAP_DB, **common, autocommit=True) as conn:
        with conn.cursor() as cur:
            # Defensive double-check inside the maintenance connection so concurrent
            # boot races don't both try to CREATE.
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target,))
            if cur.fetchone() is None:
                # Identifier can't be parameterized in CREATE DATABASE — use the
                # DB-name validation we already did when parsing LAKEBASE_DATABASE_PATH.
                cur.execute(f'CREATE DATABASE "{target}"')
                logger.info(f"Lakebase: database '{target}' created")
            else:
                logger.info(f"Lakebase: database '{target}' already exists (race)")


def create_db_engine(ws: WorkspaceClient | None) -> Engine:
    """Return a SQLAlchemy engine for the active mode.

    Two modes:
    - PGLite (USE_PGLITE=1 or LAKEBASE_DATABASE_PATH unset): local PG cluster.
    - Lakebase (LAKEBASE_DATABASE_PATH set): OAuth-via-SDK to the resolved
      project endpoint. ``ws`` must be provided in this mode.
    """
    if _is_pglite_mode():
        return _create_pglite_engine()

    if ws is None:
        raise RuntimeError("Lakebase mode requires a WorkspaceClient")

    db_path = os.environ["LAKEBASE_DATABASE_PATH"]
    endpoint = _resolve_endpoint(ws, db_path)
    logger.info(f"Lakebase: project endpoint {endpoint.endpoint_path} → {endpoint.host}/{endpoint.database_name}")

    # Bootstrap the target DB if it doesn't exist yet. CREATE DATABASE can't run
    # against the DB we're trying to create, so we connect to `databricks_postgres`
    # (the always-provisioned default DB on every Lakebase branch) and issue it
    # there. Requires the SP to have CREATEDB on the project.
    _ensure_database_exists(ws, endpoint)

    connector = _LakebaseConnector(ws, endpoint)
    connector.start_refresh()

    engine = create_engine(
        # The URL is a placeholder — `creator` overrides actual connection.
        # Driver MUST be psycopg (not psycopg2) to match the Connection objects.
        f"postgresql+psycopg://{endpoint.host}/{endpoint.database_name}",
        creator=connector.connect,
        # See _create_pglite_engine for pool sizing rationale; same choices apply.
        pool_size=10,
        max_overflow=20,
        pool_timeout=5,
        pool_recycle=45 * 60,  # under token TTL — recycles before expiry
        pool_pre_ping=True,
    )
    # Stash the connector so lifespan shutdown can stop the refresh thread.
    engine._lakebase_connector = connector  # type: ignore[attr-defined]
    return engine


# ---------------------------------------------------------------------------
# Validation + migrations
# ---------------------------------------------------------------------------

def validate_db(engine: Engine) -> None:
    """SELECT 1 — fails fast with a clear error if connect or auth is broken."""
    mode = "PGLite" if _is_pglite_mode() else "Lakebase"
    logger.info(f"Validating {mode} database connection")
    try:
        with Session(engine) as session:
            session.connection().execute(text("SELECT 1"))
    except Exception as e:
        raise ConnectionError(f"Failed to connect to the database ({mode}): {e}") from e
    logger.info(f"{mode} database connection validated successfully")


def _prune_orphan_migration_pyc(versions_dir: Path) -> None:
    """Delete compiled migration files whose `.py` source no longer exists.

    A renamed/deleted migration can leave a stale `.pyc` behind (in the
    `versions/` dir or its `__pycache__/`). If Alembic ever loads such an orphan
    — e.g. in a sourceless/compiled layout, or when the `.py` is missing — it
    resurrects the deleted revision, producing "Multiple head revisions" on
    startup. This is purely a FILESYSTEM cleanup (no DB access): Python
    regenerates a valid `.pyc` from the present `.py` on next import.
    """
    sources = {p.stem for p in versions_dir.glob("*.py")}
    candidates = list(versions_dir.glob("*.pyc"))
    cache = versions_dir / "__pycache__"
    if cache.is_dir():
        candidates += list(cache.glob("*.pyc"))
    for pyc in candidates:
        # "__pycache__/v6_foo.cpython-312.pyc" → stem "v6_foo"; "v6_foo.pyc" → "v6_foo"
        stem = pyc.name.split(".")[0]
        if stem not in sources:
            try:
                pyc.unlink()
                logger.warning(f"Pruned orphan migration bytecode (no matching .py): {pyc.name}")
            except OSError:
                pass


def _get_alembic_config(connection) -> AlembicConfig:
    """Build Alembic config that reuses our existing connection.

    env.py reads the connection from config.attributes (instead of opening a
    new one from a URL), which is the only way to migrate Lakebase — fresh
    URL-based connections wouldn't carry our minted OAuth token.
    """
    migrations_dir = Path(__file__).parent.parent / "migrations"
    # Guard against stale compiled migrations (renamed/deleted revisions) that
    # would otherwise show up as extra Alembic heads. Filesystem-only.
    _prune_orphan_migration_pyc(migrations_dir / "versions")
    alembic_cfg = AlembicConfig()
    alembic_cfg.set_main_option("script_location", str(migrations_dir))
    alembic_cfg.attributes["connection"] = connection
    return alembic_cfg


def initialize_models(engine: Engine) -> None:
    """Run Alembic migrations to head, with an advisory lock to avoid worker races.

    Set RESET_DB=1 to drop all tables (PGLite resets the dir; Lakebase drops
    SQLModel-managed tables + alembic_version).
    """
    if os.environ.get("RESET_DB") == "1" and not _is_pglite_mode():
        logger.warning("RESET_DB=1 — dropping all tables")
        SQLModel.metadata.drop_all(engine)
        with engine.connect() as conn:
            conn.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
            conn.commit()

    logger.info("Initializing database with Alembic migrations")
    _MIGRATION_LOCK_ID = 8675309  # arbitrary; same id used by all workers

    with engine.connect() as lock_conn:
        lock_conn.execute(text(f"SELECT pg_advisory_lock({_MIGRATION_LOCK_ID})"))
        lock_conn.commit()

    try:
        # Drop default-schema tables if there's no alembic_version (legacy/first run).
        inspector = inspect(engine)
        if "alembic_version" not in inspector.get_table_names():
            tables = inspector.get_table_names()
            if tables:
                logger.warning(f"No alembic_version table — dropping legacy tables: {tables}")
                with engine.connect() as conn:
                    for t in tables:
                        conn.execute(text(f'DROP TABLE IF EXISTS "{t}" CASCADE'))
                    conn.commit()

        # pgvector for template embeddings (PGLite doesn't ship the extension).
        if not _is_pglite_mode():
            try:
                with engine.connect() as conn:
                    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                    conn.commit()
            except Exception as e:
                logger.warning(f"Could not create pgvector extension: {e}")

        with engine.connect() as migration_conn:
            command.upgrade(_get_alembic_config(migration_conn), "head")
            logger.info("Alembic migrations completed successfully")
    finally:
        with engine.connect() as lock_conn:
            lock_conn.execute(text(f"SELECT pg_advisory_unlock({_MIGRATION_LOCK_ID})"))
            lock_conn.commit()

    logger.info("Database models initialized successfully")


# ---------------------------------------------------------------------------
# Lifespan + dependency
# ---------------------------------------------------------------------------

class _LakebaseDependency(LifespanDependency):
    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        import concurrent.futures

        # Stash the lifespan loop so sync route handlers (which run in
        # FastAPI's threadpool) can schedule fire-and-forget background
        # tasks via run_coroutine_threadsafe.
        app.state.event_loop = asyncio.get_running_loop()

        ws: WorkspaceClient | None = None
        if not _is_pglite_mode():
            ws = getattr(app.state, "_workspace_client", None)
            if ws is None:
                ws = WorkspaceClient()
                app.state._workspace_client = ws

        engine = create_db_engine(ws)
        app.state.engine = engine
        app.state.db_ready = False

        # init_db raises on migration or validation failure — we re-raise
        # below so the app fails to start instead of silently 500-ing every
        # DB-backed route. Template seeding is the only soft-failure path.
        def init_db():
            validate_db(engine)
            initialize_models(engine)
            try:
                from ..services.seed_templates import seed_default_templates
                seed_default_templates(engine)
            except Exception as e:
                logger.warning(f"Template seeding failed (non-fatal): {e}")
            app.state.db_ready = True
            logger.info("Database ready")

        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        db_future = executor.submit(init_db)

        # File sync + watcher (independent of DB readiness).
        from ..services.file_sync import FileSyncService
        file_sync = FileSyncService(engine)
        app.state.file_sync = file_sync

        from ..services.file_watcher import init_watcher

        async def sync_callback(project_id: str, paths: list[str]):
            await file_sync.sync_files_to_db(project_id, paths)
            from ..services.active_stream import get_stream_manager
            stream = get_stream_manager().get_project_stream(project_id)
            # .claude/projects/** holds Claude Code session transcripts. We
            # sync them to PG (so the SDK can resume after a container
            # restart) but we don't want them surfaced to the UI — they
            # aren't user-facing project files and would clutter the file
            # viewer / refresh logic.
            ui_paths = [p for p in paths if not p.startswith(".claude/")]
            if stream and ui_paths:
                logger.debug(
                    f"[watcher] emitting {len(ui_paths)} file_changed event(s) "
                    f"for project {project_id} (exec {stream.execution_id}): {ui_paths}"
                )
                for path in ui_paths:
                    stream.add_event({"type": "file_changed", "path": path})
            elif not stream:
                logger.debug(
                    f"[watcher] no active stream for project {project_id} — "
                    f"{len(paths)} file change(s) NOT pushed to UI: {paths}"
                )

            # If README.md changed, kick off a background narrative regen.
            # The service hashes the README and skips when it matches the
            # cached hash, so rapid agent writes during streaming don't
            # cause repeated LLM calls. Fire-and-forget — failures log
            # and the next debounce cycle retries.
            if "README.md" in ui_paths:
                from ..services.narrative import regenerate_narrative_if_stale
                from ..core._config import AppConfig
                from databricks.sdk import WorkspaceClient
                from sqlmodel import Session

                # Hold the agent SSE stream open across mark_complete so the
                # narrative event isn't dropped if the agent finishes before
                # the LLM regen does. The SSE loop in stream_progress checks
                # this flag and waits a short grace period.
                pending_stream = get_stream_manager().get_project_stream(project_id)
                if pending_stream:
                    pending_stream.narrative_pending = True
                    logger.debug(
                        f"[watcher] narrative_pending=True for exec "
                        f"{pending_stream.execution_id} (project {project_id})"
                    )
                else:
                    logger.debug(
                        f"[watcher] README.md changed for project {project_id} "
                        f"but no active stream — narrative event may be missed "
                        f"by the UI; lazy-on-read in GET will recover."
                    )

                async def _regen():
                    try:
                        result = await regenerate_narrative_if_stale(
                            project_id=project_id,
                            session_factory=lambda: Session(engine),
                            ws=WorkspaceClient(),
                            config=AppConfig(),
                        )
                        if result is None:
                            logger.info(
                                f"[watcher] narrative regen returned None for "
                                f"{project_id} (hash unchanged, no README, or LLM error)"
                            )
                            return
                        narrative, narrative_readme_hash = result
                        # Re-fetch the stream — by now the agent may have
                        # finished, but the SSE loop is still draining due to
                        # narrative_pending. Push the event onto whatever
                        # stream is still associated with this project.
                        stream2 = get_stream_manager().get_project_stream_any(project_id)
                        if stream2:
                            stream2.add_event({
                                "type": "narrative_updated",
                                "narrative": narrative,
                                "narrative_readme_hash": narrative_readme_hash,
                            })
                            logger.debug(
                                f"[watcher] narrative_updated event emitted for "
                                f"{project_id} on exec {stream2.execution_id} "
                                f"(is_complete={stream2.is_complete})"
                            )
                        else:
                            logger.debug(
                                f"[watcher] narrative ready for {project_id} but "
                                f"no stream to deliver on — UI will pick it up on "
                                f"next GET via lazy backfill."
                            )
                    except Exception as e:
                        logger.warning(
                            f"[watcher] narrative regen failed for {project_id}: {e}",
                            exc_info=True,
                        )
                    finally:
                        if pending_stream is not None:
                            pending_stream.narrative_pending = False

                asyncio.create_task(_regen())

        try:
            watcher = init_watcher(sync_callback)
            watcher.start(asyncio.get_event_loop())
            app.state.file_watcher = watcher
            logger.info("File watcher started successfully")
        except Exception as e:
            logger.warning(f"Failed to start file watcher: {e}")
            app.state.file_watcher = None

        # FMAPI token refresher: rewrites every project's `.anthropic_token`
        # every 15 min (deployed mode only — no-op locally). Makes the
        # apiKeyHelper-based settings.json flow self-sustaining without
        # per-request token minting or env-var leakage.
        from . import fmapi_auth
        from ..services.skills_manager import PROJECTS_BASE_DIR
        from pathlib import Path as _P

        async def _fmapi_refresh_loop():
            base = _P(PROJECTS_BASE_DIR)
            # Wait until DB ready before first refresh (no functional reason
            # — just stops a flood of "0 projects" logs at boot).
            while True:
                try:
                    fmapi_auth.refresh_all_projects(base)
                except Exception as e:
                    logger.warning(f"[fmapi-auth] refresh loop error: {e!r}")
                await asyncio.sleep(fmapi_auth.REFRESH_INTERVAL_SECONDS)

        fmapi_task = None
        if fmapi_auth.is_deployed_mode():
            fmapi_task = asyncio.create_task(_fmapi_refresh_loop())
            logger.info(
                f"[fmapi-auth] background refresher started "
                f"(every {fmapi_auth.REFRESH_INTERVAL_SECONDS}s)"
            )
        app.state.fmapi_refresh_task = fmapi_task

        # Idle-client reaper: walk the pool every 5 min, disconnect any client
        # that's been unused longer than CLIENT_IDLE_TIMEOUT. This frees the
        # SDK subprocess + pipes proactively. Without this the same eviction
        # only happens on the NEXT turn that hits get_client(), so a project
        # the user abandoned would hold its subprocess until the app restarts.
        from ..services.agent import get_client_pool, CLIENT_IDLE_TIMEOUT

        async def _client_reaper_loop():
            pool = get_client_pool()
            while True:
                try:
                    await pool.reap_idle()
                except Exception as e:
                    logger.warning(f"[client-pool] reaper error: {e!r}")
                await asyncio.sleep(CLIENT_IDLE_TIMEOUT)

        reaper_task = asyncio.create_task(_client_reaper_loop())
        app.state.client_reaper_task = reaper_task
        logger.info(
            f"[client-pool] idle reaper started (every {CLIENT_IDLE_TIMEOUT}s)"
        )

        # ─── Eager SSE-stream cancellation on SIGTERM ────────────────────
        #
        # Uvicorn's graceful shutdown drains all in-flight HTTP / SSE
        # connections BEFORE running FastAPI's lifespan teardown, so the
        # teardown's `cancel_all()` (below) fires only after the drain
        # wait has already elapsed. With an active SSE stream, the drain
        # can hit the generator's 50 s reconnect window — 87 s on
        # 2026-05-21T23:15:46Z — exceeding the Apps platform grace period
        # and tripping a "crashed unexpectedly" alert despite a clean
        # internal shutdown.
        #
        # We hook SIGTERM/SIGINT and flip `is_cancelled=True` on every
        # active stream before uvicorn starts draining, so the SSE
        # generator loops exit on their next 100 ms poll. The teardown's
        # `cancel_all()` then becomes an idempotent safety net.
        #
        # We MUST chain to uvicorn's prior handler: uvicorn registers via
        # `signal.signal()` (not `loop.add_signal_handler`), so
        # installing ours replaces it. Without the chain, uvicorn never
        # sees `should_exit=True` and the process hangs on the next await.
        #
        # Signal-handler safety: CPython delivers signals on the main
        # thread between bytecodes (same thread the loop runs on), and
        # `cancel_all()` only does a dict snapshot, flag writes, a list
        # append (atomic under GIL) and `task.cancel()` — no awaits, no
        # blocking C calls.
        import signal

        prev_handlers: dict[int, object] = {
            signal.SIGTERM: signal.getsignal(signal.SIGTERM),
            signal.SIGINT: signal.getsignal(signal.SIGINT),
        }

        def _eager_cancel_on_signal(signum, frame):
            """Cancel active SSE streams, then chain to uvicorn's handler.

            Bounded to in-memory mutations + non-blocking `task.cancel()`.
            Errors are logged but swallowed — the signal must still reach
            uvicorn's handler for the server to actually exit.
            """
            try:
                from ..services.active_stream import get_stream_manager
                cancelled = get_stream_manager().cancel_all()
                if cancelled:
                    logger.info(
                        f"[shutdown-signal] cancelled {cancelled} active "
                        f"stream(s) on signal {signum}"
                    )
            except Exception as e:
                logger.warning(f"[shutdown-signal] cancel_all failed: {e!r}")
            prev = prev_handlers.get(signum)
            if callable(prev):
                prev(signum, frame)

        try:
            signal.signal(signal.SIGTERM, _eager_cancel_on_signal)
            signal.signal(signal.SIGINT, _eager_cancel_on_signal)
            logger.info("[shutdown-signal] SIGTERM/SIGINT eager-cancel handler installed")
        except (ValueError, OSError) as e:
            # `signal.signal()` is main-thread only — falls back to the
            # lifespan teardown's `cancel_all()` for non-main-thread
            # embedders (Electron, pytest workers, etc.).
            logger.warning(f"[shutdown-signal] could not install handler: {e!r}")

        # Block until DB init completes. If it errored, surface the exception
        # so uvicorn aborts startup instead of serving an app whose DB-backed
        # routes will all 500. The 60s timeout covers a cold-start Lakebase
        # autoscaler waking + Alembic migrations.
        try:
            db_future.result(timeout=60)
        except concurrent.futures.TimeoutError:
            raise RuntimeError(
                "Database initialization timed out (>60s). Check Lakebase "
                "connectivity / endpoint status."
            )
        except Exception as e:
            raise RuntimeError(
                f"Database initialization failed — aborting startup: {e}"
            ) from e

        yield

        # ── Shutdown — every step has a hard timeout. ────────────────────
        # Apps platform sends SIGTERM and gives us ~15s before SIGKILL.
        # We must exit promptly even when external handles are wedged
        # (a Node SDK subprocess that won't die, a psycopg connection
        # blocked on a Lakebase query, etc.). Order matters: cancel
        # streams + agent subprocesses FIRST so nothing new lands in
        # the executor, then drain the executor with a deadline.

        # 1. Cancel any still-running SSE streams + their agent tasks.
        #    Normally a no-op — `_eager_cancel_on_signal` already
        #    flipped every stream when SIGTERM arrived. Kept as a
        #    fallback for paths where that handler couldn't be
        #    installed (non-main-thread embedders) or wasn't invoked
        #    (e.g. programmatic `Server.shutdown()`).
        try:
            from ..services.active_stream import get_stream_manager
            cancelled = get_stream_manager().cancel_all()
            if cancelled:
                logger.info(f"[shutdown] cancelled {cancelled} active stream(s)")
        except Exception as e:
            logger.warning(f"[shutdown] stream cancel failed: {e!r}")

        # 2. Cancel background loops. cancel() is non-blocking; the
        #    coroutines may not unwind synchronously but the event loop
        #    is about to be torn down anyway.
        for name, task in (("fmapi-refresh", fmapi_task), ("client-reaper", reaper_task)):
            if task is not None:
                task.cancel()
                logger.info(f"[shutdown] cancelled {name} task")

        # 2b. Cancel fire-and-forget customer-inference tasks — they aren't tied
        #     to a stream, so nothing else cancels them, and an in-flight one
        #     keeps the event loop busy past SIGTERM.
        try:
            from ..routes.agent import cancel_customer_tasks
            n = cancel_customer_tasks()
            if n:
                logger.info(f"[shutdown] cancelled {n} customer task(s)")
        except Exception as e:
            logger.warning(f"[shutdown] customer-task cancel failed: {e!r}")

        # 3. Disconnect every pooled Claude SDK client with a per-client
        #    timeout. SDK disconnect waits for the Node subprocess to
        #    exit; if the subprocess is wedged, abandon it.
        try:
            dropped = await asyncio.wait_for(
                get_client_pool().shutdown_all(timeout=3.0),
                timeout=8.0,
            )
            if dropped:
                logger.info(f"[shutdown] disconnected {dropped} pooled client(s)")
        except asyncio.TimeoutError:
            logger.warning("[shutdown] client pool shutdown overran 8s — abandoning")
        except Exception as e:
            logger.warning(f"[shutdown] client pool shutdown error: {e!r}")

        # 4. Drain the executor used for DB init / sync writes. Bound
        #    to 5s — anything still running gets dropped on the floor.
        try:
            db_future.result(timeout=5)
        except FuturesTimeoutError:
            logger.warning("[shutdown] db init future overran 5s — abandoning")
        except Exception as e:
            logger.warning(f"[shutdown] db init future raised: {e!r}")

        executor.shutdown(wait=False, cancel_futures=True)

        # 5. Stop the file watcher (filesystem observer thread).
        try:
            if app.state.file_watcher:
                app.state.file_watcher.stop()
        except Exception as e:
            logger.warning(f"[shutdown] file watcher stop error: {e!r}")

        # 6. Stop the Lakebase token-refresh thread + dispose the engine.
        connector = getattr(engine, "_lakebase_connector", None)
        if connector is not None:
            try:
                connector.stop()
            except Exception as e:
                logger.warning(f"[shutdown] lakebase connector stop error: {e!r}")
        try:
            engine.dispose()
        except Exception as e:
            logger.warning(f"[shutdown] engine.dispose error: {e!r}")

        logger.info("[shutdown] lifespan teardown complete")

    @staticmethod
    def __call__(request: Request) -> Generator[Session, None, None]:
        with Session(bind=request.app.state.engine) as session:
            yield session


LakebaseDependency: TypeAlias = Annotated[Session, _LakebaseDependency.depends()]
