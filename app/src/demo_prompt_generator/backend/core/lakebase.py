"""Lakebase (Databricks Database) integration: config, engine, session, and dependency."""

from __future__ import annotations

import os
import shutil
from collections.abc import Generator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, AsyncGenerator, TypeAlias

from alembic import command
from alembic.config import Config as AlembicConfig
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from fastapi import FastAPI, Request
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Engine, create_engine, event, inspect
from sqlmodel import Session, SQLModel, text

from ._base import LifespanDependency
from ._config import logger


# --- PGLite Configuration ---

PGLITE_DIR = Path.home() / ".pglite"
"""Directory where PGLite stores its data (~/.pglite/ in home directory)."""


def _is_pglite_mode() -> bool:
    """Check if we should use PGLite (local dev only, no external DB configured).

    PGLite is used ONLY when there's no external database configured AND we're
    not running as a Databricks App. In a Databricks App, the service principal
    credentials (DATABRICKS_CLIENT_ID) are set by the runtime, and the Lakebase
    database resource is accessed via the Databricks SDK.
    """
    # Databricks App runtime sets client credentials for the service principal
    if os.environ.get("DATABRICKS_CLIENT_ID"):
        return False
    return not os.environ.get("LAKEBASE_PG_URL")


def _reset_pglite() -> None:
    """Delete the PGLite directory to reset the database."""
    if PGLITE_DIR.exists():
        logger.warning(f"RESET_DB=1 detected - deleting PGLite directory: {PGLITE_DIR}")
        shutil.rmtree(PGLITE_DIR)
        logger.info("PGLite directory deleted. Will recreate on startup.")


def _create_pglite_engine() -> Engine:
    """Create a SQLAlchemy engine using PGLite for local development.

    PGLite manages a local PostgreSQL cluster in .pglite/ directory.
    Requires PostgreSQL to be installed (e.g., via Homebrew: brew install postgresql).
    """
    import subprocess

    import pglite

    # Check for reset flag BEFORE creating the database
    if os.environ.get("RESET_DB") == "1":
        _reset_pglite()

    # Ensure directory exists
    PGLITE_DIR.mkdir(parents=True, exist_ok=True)

    # Set the data directory for pglite
    os.environ["PGLITE_DATA_DIR"] = str(PGLITE_DIR)

    logger.info(f"Using PGLite database at: {PGLITE_DIR}")

    # Find pg_ctl path (for macOS/Linux)
    pg_ctl_path = None
    try:
        result = subprocess.run(["which", "pg_ctl"], capture_output=True, text=True)
        if result.returncode == 0:
            pg_ctl_path = result.stdout.strip()
    except Exception:
        pass

    if not pg_ctl_path:
        raise RuntimeError(
            "PostgreSQL not found. Please install it:\n"
            "  macOS: brew install postgresql@16\n"
            "  Ubuntu: sudo apt install postgresql\n"
            "Or set LAKEBASE_PG_URL to use an external database."
        )

    # Initialize cluster if needed
    if not pglite.check_cluster():
        logger.info("Initializing PGLite cluster...")
        pglite.init_cluster(pg_ctl_path=pg_ctl_path)

    # Start cluster if not running
    if not pglite.is_started():
        logger.info("Starting PGLite cluster...")
        pglite.start_cluster()

    # Create database if it doesn't exist
    db_name = "demo_prompt_generator"
    existing_dbs = pglite.list_db()
    if db_name not in existing_dbs:
        logger.info(f"Creating database: {db_name}")
        pglite.create_db(db_name)

    # Get connection parameters (returns string like "host=localhost port=55432")
    params_str = pglite.cluster_params()
    params = dict(item.split("=") for item in params_str.split())
    host = params.get("host", "localhost")
    port = params.get("port", "5432")
    user = os.environ.get("USER", "postgres")  # pglite uses current user

    # Build connection URL
    engine_url = f"postgresql+psycopg://{user}@{host}:{port}/{db_name}"

    # Pool sized for the app's concurrent access pattern: multiple sync handlers
    # (dispatched to FastAPI's thread pool) + agent background tasks + file-watcher
    # debounce flushes all can grab a session at once. pool_timeout keeps a session
    # exhaustion from looking like a deadlock — raises `TimeoutError` fast instead.
    engine = create_engine(
        engine_url,
        pool_size=10,
        max_overflow=20,
        pool_timeout=5,
        pool_pre_ping=True,
    )

    return engine


# --- Database Config ---


class DatabaseConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="")

    port: int = Field(
        description="The port of the database", default=5432, validation_alias="PGPORT"
    )
    database_name: str = Field(
        description="The name of the database", default="databricks_postgres"
    )
    instance_name: str = Field(
        description="The name of the database instance (override via DB_INSTANCE_NAME env var)",
        default="demo-prompt-gen-lakebase",
        validation_alias="DB_INSTANCE_NAME",
    )


# --- Engine creation ---


def _get_static_pg_url() -> str | None:
    """Check for static PostgreSQL URL (e.g., Lakebase connection string).

    If LAKEBASE_PG_URL is set, use it directly for database connection.
    """
    url = os.environ.get("LAKEBASE_PG_URL")
    if url:
        # Convert to psycopg driver if needed
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url
    return None


def _build_engine_url(db_config: DatabaseConfig, ws: WorkspaceClient) -> str:
    """Build the database engine URL for static or production mode."""
    # Check for static Lakebase URL first (highest priority)
    static_url = _get_static_pg_url()
    if static_url:
        logger.info("Using static LAKEBASE_PG_URL for database connection")
        return static_url

    # Production mode: use Databricks Database
    logger.info(f"Using Databricks database instance: {db_config.instance_name}")
    instance = ws.database.get_database_instance(db_config.instance_name)
    prefix = "postgresql+psycopg"
    host = instance.read_write_dns
    port = db_config.port
    database = db_config.database_name
    username = (
        ws.config.client_id if ws.config.client_id else ws.current_user.me().user_name
    )
    return f"{prefix}://{username}:@{host}:{port}/{database}"


def create_db_engine(db_config: DatabaseConfig, ws: WorkspaceClient) -> Engine:
    """
    Create a SQLAlchemy engine.

    Priority:
    1. PGLite for local development (if LAKEBASE_PG_URL not set)
    2. Static LAKEBASE_PG_URL (real Postgres with SSL)
    3. Production Databricks Database (SSL, dynamic OAuth tokens)
    """
    # Check for PGLite mode first
    if _is_pglite_mode():
        return _create_pglite_engine()

    static_url = _get_static_pg_url()

    # See comment in _create_pglite_engine for pool sizing rationale.
    POOL_KWARGS: dict[str, Any] = {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_timeout": 5,
        "pool_recycle": 45 * 60,
        "pool_pre_ping": True,
    }

    if static_url:
        # Static URL mode: real Postgres with connection pool
        engine_kwargs: dict[str, Any] = dict(POOL_KWARGS)
        # SSL is specified in the URL itself (sslmode=require)
        engine = create_engine(static_url, **engine_kwargs)
        return engine

    # Production mode: Databricks Lakebase with dynamic OAuth tokens
    engine_url = _build_engine_url(db_config, ws)
    engine_kwargs = dict(POOL_KWARGS)
    engine_kwargs["connect_args"] = {"sslmode": "require"}

    # In Lakebase, the SP's CAN_CONNECT_AND_CREATE permission does NOT
    # grant CREATE on the public schema. The SP must use its own schema.
    # We create the schema on first connect, then redirect all table ops there.
    sp_schema = ws.config.client_id
    if sp_schema:
        engine_kwargs.setdefault("execution_options", {})
        engine_kwargs["execution_options"]["schema_translate_map"] = {None: sp_schema}
        logger.info(f"Using Lakebase SP schema: {sp_schema}")

    engine = create_engine(engine_url, **engine_kwargs)

    def before_connect(dialect, conn_rec, cargs, cparams):
        cred = ws.database.generate_database_credential(
            instance_names=[db_config.instance_name]
        )
        cparams["password"] = cred.token

    def after_connect(dbapi_connection, connection_record):
        """Set search_path for raw SQL. Schema itself is created once in initialize_models()."""
        if sp_schema:
            dbapi_connection.autocommit = True
            cursor = dbapi_connection.cursor()
            cursor.execute(f'SET search_path TO "{sp_schema}", public')
            cursor.close()
            dbapi_connection.autocommit = False

    # Dynamic token refresh for production Databricks Database
    event.listens_for(engine, "do_connect")(before_connect)
    event.listen(engine, "connect", after_connect)

    # Stash SP schema so initialize_models() can scope introspection/DDL to it.
    # This is critical on shared Lakebase instances to avoid touching other tenants' tables.
    engine._sp_schema = sp_schema  # type: ignore[attr-defined]

    return engine


def validate_db(engine: Engine, db_config: DatabaseConfig) -> None:
    """Validate that the database connection works."""
    if _is_pglite_mode():
        logger.info("Validating PGLite database connection")
    else:
        static_url = _get_static_pg_url()
        if static_url:
            logger.info("Validating static LAKEBASE_PG_URL database connection")
        else:
            logger.info(
                f"Validating database connection to instance {db_config.instance_name}"
            )
            try:
                ws = WorkspaceClient()
                ws.database.get_database_instance(db_config.instance_name)
            except NotFound:
                raise ValueError(
                    f"Database instance {db_config.instance_name} does not exist"
                )

    try:
        with Session(engine) as session:
            session.connection().execute(text("SELECT 1"))
            session.close()
    except Exception as e:
        raise ConnectionError(f"Failed to connect to the database: {e}")

    if _is_pglite_mode():
        logger.info("PGLite database connection validated successfully")
    elif _get_static_pg_url():
        logger.info("Static LAKEBASE_PG_URL database connection validated successfully")
    else:
        logger.info(
            f"Database connection to instance {db_config.instance_name} validated successfully"
        )


def _get_alembic_config(connection) -> AlembicConfig:
    """Create Alembic config pointing to our migrations directory.

    Passes the existing connection to env.py via config.attributes["connection"].
    This is required for Databricks Lakebase which uses dynamic OAuth tokens.
    """
    migrations_dir = Path(__file__).parent.parent / "migrations"
    alembic_cfg = AlembicConfig()
    alembic_cfg.set_main_option("script_location", str(migrations_dir))
    # Pass the connection to env.py (not URL, because URL lacks OAuth token)
    alembic_cfg.attributes["connection"] = connection
    return alembic_cfg


def _has_alembic_version_table(engine: Engine, schema: str | None = None) -> bool:
    """Check if alembic_version table exists in the given schema (scoped introspection)."""
    inspector = inspect(engine)
    return "alembic_version" in inspector.get_table_names(schema=schema)


def _drop_all_tables(engine: Engine, schema: str | None = None) -> None:
    """Drop all tables in the given schema only.

    IMPORTANT: On shared Lakebase instances, introspection MUST be scoped to the
    SP's own schema — otherwise search_path would expose tables in `public` and
    other tenants' schemas, which this function must never touch.
    """
    if schema is None:
        raise RuntimeError(
            "_drop_all_tables requires an explicit schema on shared Lakebase. "
            "Refusing to run unscoped introspection that could return other tenants' tables."
        )
    logger.warning(
        f"No alembic_version table found in schema '{schema}' - dropping tables there for fresh migration"
    )
    inspector = inspect(engine)
    table_names = inspector.get_table_names(schema=schema)
    if table_names:
        logger.info(f"Dropping tables in schema '{schema}': {table_names}")
        with engine.connect() as conn:
            for table in table_names:
                conn.execute(text(f'DROP TABLE IF EXISTS "{schema}"."{table}" CASCADE'))
            conn.commit()
        logger.info(f"All tables in schema '{schema}' dropped")


def initialize_models(engine: Engine) -> None:
    """Initialize database using Alembic migrations.

    Uses a PostgreSQL advisory lock to prevent race conditions when multiple
    uvicorn workers start simultaneously.

    If alembic_version table doesn't exist (legacy DB or first run), drops all
    existing tables to ensure clean Alembic-managed schema.

    Set RESET_DB=1 environment variable to drop all tables and start fresh.
    For PGLite, this deletes the .pglite directory (handled earlier).
    For other databases, this drops all tables.
    """
    # SP schema (set in create_db_engine for production Lakebase mode). None for PGLite / static URL.
    sp_schema: str | None = getattr(engine, "_sp_schema", None)

    # For non-PGLite databases, handle RESET_DB by dropping tables
    # (PGLite reset is handled earlier in _create_pglite_engine)
    if not _is_pglite_mode() and os.environ.get("RESET_DB") == "1":
        logger.warning("RESET_DB=1 detected - dropping all tables!")
        # drop_all respects schema_translate_map (set on engine), so this drops only our SP schema's tables
        SQLModel.metadata.drop_all(engine)
        # Also drop alembic_version (not in SQLModel metadata) — scoped to our schema
        with engine.connect() as conn:
            if sp_schema:
                conn.execute(text(f'DROP TABLE IF EXISTS "{sp_schema}".alembic_version CASCADE'))
            else:
                conn.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
            conn.commit()
        logger.info("All tables dropped. Recreating via Alembic...")

    logger.info("Initializing database with Alembic migrations")

    # Use a PostgreSQL advisory lock so only one worker runs migrations.
    _MIGRATION_LOCK_ID = 8675309  # arbitrary fixed int

    # Acquire advisory lock
    with engine.connect() as lock_conn:
        lock_conn.execute(text(f"SELECT pg_advisory_lock({_MIGRATION_LOCK_ID})"))
        lock_conn.commit()

    try:
        # Ensure our SP schema exists (done here under advisory lock, not on every
        # new connection, to avoid races on CREATE SCHEMA IF NOT EXISTS).
        if sp_schema:
            with engine.connect() as conn:
                conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{sp_schema}"'))
                conn.commit()
            logger.info(f"Ensured SP schema exists: {sp_schema}")

        # Check if this is a legacy DB (no alembic_version in OUR schema) - if so,
        # drop only our schema's tables. Never touches public/other tenants.
        if sp_schema:
            if not _has_alembic_version_table(engine, schema=sp_schema):
                _drop_all_tables(engine, schema=sp_schema)
        else:
            # PGLite / single-tenant static URL: operate on default schema
            inspector = inspect(engine)
            if "alembic_version" not in inspector.get_table_names():
                logger.warning("No alembic_version table - dropping default-schema tables for fresh migration")
                with engine.connect() as conn:
                    for table in inspector.get_table_names():
                        conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
                    conn.commit()

        # Enable pgvector extension for production (PGLite doesn't support it)
        if not _is_pglite_mode():
            try:
                with engine.connect() as conn:
                    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                    conn.commit()
            except Exception as e:
                logger.warning(f"Could not create pgvector extension: {e}")

        # Run Alembic migrations with a fresh connection
        with engine.connect() as migration_conn:
            alembic_cfg = _get_alembic_config(migration_conn)
            command.upgrade(alembic_cfg, "head")
            logger.info("Alembic migrations completed successfully")

    finally:
        # Release advisory lock
        with engine.connect() as lock_conn:
            lock_conn.execute(text(f"SELECT pg_advisory_unlock({_MIGRATION_LOCK_ID})"))
            lock_conn.commit()

    logger.info("Database models initialized successfully")


# --- Dependency ---


class _LakebaseDependency(LifespanDependency):
    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        import asyncio
        import concurrent.futures

        db_config = DatabaseConfig()  # ty: ignore[missing-argument]

        # For static LAKEBASE_PG_URL, we don't need WorkspaceClient (avoids slow CLI auth)
        # Only get it for production Lakebase mode
        ws = None
        if not _is_pglite_mode() and not _get_static_pg_url():
            ws = app.state._workspace_client
            if ws is None:
                ws = WorkspaceClient()
                app.state._workspace_client = ws

        # Create engine (fast - just config)
        engine = create_db_engine(db_config, ws)
        app.state.engine = engine
        app.state.db_ready = False

        # Run DB validation and migrations in background thread
        def init_db():
            try:
                validate_db(engine, db_config)
                initialize_models(engine)
                # Seed default templates (non-fatal if it fails)
                try:
                    from ..services.seed_templates import seed_default_templates
                    seed_default_templates(engine)
                except Exception as e:
                    logger.warning(f"Template seeding failed (non-fatal): {e}")
                app.state.db_ready = True
                logger.info("Database ready")
            except Exception as e:
                logger.error(f"Database initialization failed: {e}")

        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        db_future = executor.submit(init_db)

        # Initialize file sync service (needs engine, not migrations)
        from ..services.file_sync import FileSyncService
        file_sync = FileSyncService(engine)
        app.state.file_sync = file_sync

        # Initialize and start file watcher
        from ..services.file_watcher import init_watcher

        async def sync_callback(project_id: str, paths: list[str]):
            await file_sync.sync_files_to_db(project_id, paths)
            # Notify active SSE stream so the frontend sees changes instantly.
            # Only works during an active agent run — get_project_stream returns
            # None once the stream is marked complete/cancelled/errored. For
            # idle projects the UI refreshes on other triggers (tool_result
            # for FILE_MUTATING_TOOLS, project load).
            from ..services.active_stream import get_stream_manager
            stream = get_stream_manager().get_project_stream(project_id)
            if stream:
                logger.info(
                    f"[watcher] emitting {len(paths)} file_changed event(s) "
                    f"for project {project_id} (exec {stream.execution_id}): {paths}"
                )
                for path in paths:
                    stream.add_event({"type": "file_changed", "path": path})
            else:
                logger.info(
                    f"[watcher] no active stream for project {project_id} — "
                    f"{len(paths)} file change(s) NOT pushed to UI: {paths}"
                )

        try:
            watcher = init_watcher(sync_callback)
            watcher.start(asyncio.get_event_loop())
            app.state.file_watcher = watcher
            logger.info("File watcher started successfully")
        except Exception as e:
            logger.warning(f"Failed to start file watcher: {e}")
            app.state.file_watcher = None

        yield

        # Wait for DB init to complete before shutdown
        db_future.result(timeout=30)
        executor.shutdown(wait=True)

        # Cleanup
        if app.state.file_watcher:
            app.state.file_watcher.stop()
        engine.dispose()

    @staticmethod
    def __call__(request: Request) -> Generator[Session, None, None]:
        with Session(bind=request.app.state.engine) as session:
            yield session


LakebaseDependency: TypeAlias = Annotated[Session, _LakebaseDependency.depends()]
