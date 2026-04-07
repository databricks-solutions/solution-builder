"""Lakebase (Databricks Database) integration: config, engine, session, and dependency."""

from __future__ import annotations

import os
import threading
from collections.abc import Generator
from contextlib import asynccontextmanager
from typing import Annotated, Any, AsyncGenerator, TypeAlias

# Global lock for serializing database connections in dev mode (PGLite can't handle concurrency)
_dev_db_lock: threading.Lock | None = None

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from fastapi import FastAPI, Request
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, text

from ._base import LifespanDependency
from ._config import logger


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
        default="demo-prompt-gen-db",
        validation_alias="DB_INSTANCE_NAME",
    )


# --- Engine creation ---


def _get_dev_db_port() -> int | None:
    """Check for local development database port.

    Checks APX_DEV_DB_PORT first, then PGPORT as fallback.
    Returns port if found, None for production mode.
    """
    # APX sets this when it manages the dev database
    port = os.environ.get("APX_DEV_DB_PORT")
    if port:
        return int(port)

    # Fallback: check PGPORT (APX may set this even without APX_DEV_DB_PORT)
    pgport = os.environ.get("PGPORT")
    if pgport:
        # PGPORT is set - likely local dev mode
        return int(pgport)

    return None


def _build_engine_url(
    db_config: DatabaseConfig, ws: WorkspaceClient, dev_port: int | None
) -> str:
    """Build the database engine URL for dev or production mode."""
    if dev_port:
        logger.info(f"Using local dev database at 127.0.0.1:{dev_port}")
        username = "postgres"
        password = os.environ.get("APX_DEV_DB_PWD", "postgres")
        # Use 127.0.0.1 explicitly to avoid IPv6 resolution issues with PGLite
        return f"postgresql+psycopg://{username}:{password}@127.0.0.1:{dev_port}/postgres?sslmode=disable"

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

    In dev mode: no SSL, no password callback, smaller pool.
    In production: require SSL and use Databricks credential callback.
    """
    dev_port = _get_dev_db_port()
    engine_url = _build_engine_url(db_config, ws, dev_port)

    global _dev_db_lock
    if dev_port:
        # Dev mode: use NullPool and serialized access - PGLite can't handle concurrency
        engine_kwargs: dict[str, Any] = {
            "poolclass": NullPool,
        }
        # Initialize the lock for serializing database access
        _dev_db_lock = threading.Lock()
        logger.info("Dev mode: database access will be serialized via lock")
    else:
        # Production mode: larger pool with standard settings
        engine_kwargs = {"pool_size": 4, "pool_recycle": 45 * 60, "pool_pre_ping": True}
        engine_kwargs["connect_args"] = {"sslmode": "require"}

    engine = create_engine(engine_url, **engine_kwargs)

    def before_connect(dialect, conn_rec, cargs, cparams):
        cred = ws.database.generate_database_credential(
            instance_names=[db_config.instance_name]
        )
        cparams["password"] = cred.token

    if not dev_port:
        event.listens_for(engine, "do_connect")(before_connect)

    return engine


def validate_db(engine: Engine, db_config: DatabaseConfig) -> None:
    """Validate that the database connection works."""
    dev_port = _get_dev_db_port()

    if dev_port:
        logger.info(f"Validating local dev database connection at 127.0.0.1:{dev_port}")
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
    except Exception:
        raise ConnectionError("Failed to connect to the database")

    if dev_port:
        logger.info("Local dev database connection validated successfully")
    else:
        logger.info(
            f"Database connection to instance {db_config.instance_name} validated successfully"
        )


def initialize_models(engine: Engine) -> None:
    """Create all SQLModel tables and add any missing columns."""
    logger.info("Initializing database models")
    SQLModel.metadata.create_all(engine)

    # Migrations for the new project-based schema
    _migrations = [
        # Projects table
        ("projects_table", """
            CREATE TABLE IF NOT EXISTS projects (
                id VARCHAR(50) PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                project_type VARCHAR(50) DEFAULT 'DATABRICKS_DEMO',
                skills TEXT DEFAULT '[]',
                session_id VARCHAR(100),
                cluster_id VARCHAR(100),
                warehouse_id VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """),
        ("projects_user_email_idx", "CREATE INDEX IF NOT EXISTS ix_projects_user_email ON projects (user_email)"),
        ("projects_user_created_idx", "CREATE INDEX IF NOT EXISTS ix_projects_user_created ON projects (user_email, created_at)"),

        # Project files table
        ("project_files_table", """
            CREATE TABLE IF NOT EXISTS project_files (
                id SERIAL PRIMARY KEY,
                project_id VARCHAR(50) NOT NULL,
                relative_path VARCHAR(500) NOT NULL,
                content_compressed BYTEA NOT NULL,
                content_hash VARCHAR(64) NOT NULL,
                file_size INTEGER DEFAULT 0,
                last_modified TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """),
        ("project_files_project_idx", "CREATE INDEX IF NOT EXISTS ix_project_files_project_id ON project_files (project_id)"),
        ("project_files_unique_path", "CREATE UNIQUE INDEX IF NOT EXISTS ix_project_files_project_path ON project_files (project_id, relative_path)"),

        # Messages table
        ("messages_table", """
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                project_id VARCHAR(50) NOT NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                is_error BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """),
        ("messages_project_idx", "CREATE INDEX IF NOT EXISTS ix_messages_project_id ON messages (project_id)"),
        ("messages_project_created_idx", "CREATE INDEX IF NOT EXISTS ix_messages_project_created ON messages (project_id, created_at)"),

        # Executions table
        ("executions_table", """
            CREATE TABLE IF NOT EXISTS executions (
                id VARCHAR(50) PRIMARY KEY,
                project_id VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'running',
                events_json TEXT DEFAULT '[]',
                error TEXT,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            )
        """),
        ("executions_project_idx", "CREATE INDEX IF NOT EXISTS ix_executions_project_id ON executions (project_id)"),
        ("executions_project_status_idx", "CREATE INDEX IF NOT EXISTS ix_executions_project_status ON executions (project_id, status)"),
        ("executions_project_created_idx", "CREATE INDEX IF NOT EXISTS ix_executions_project_created ON executions (project_id, created_at)"),
    ]

    with Session(engine) as session:
        for migration_name, ddl in _migrations:
            try:
                session.connection().execute(text(ddl))
                session.commit()
                logger.debug(f"Migration {migration_name} applied successfully")
            except Exception as e:
                session.rollback()
                logger.debug(f"Migration {migration_name} skipped: {e}")

    logger.info("Database models initialized successfully")


# --- Dependency ---


class _LakebaseDependency(LifespanDependency):
    @asynccontextmanager
    async def lifespan(self, app: FastAPI) -> AsyncGenerator[None, None]:
        db_config = DatabaseConfig()  # ty: ignore[missing-argument]
        ws = app.state.workspace_client

        engine = create_db_engine(db_config, ws)
        validate_db(engine, db_config)
        initialize_models(engine)

        # Initialize skills manager (clone/pull ai-dev-kit on startup)
        from ..services.skills_manager import clone_or_pull_ai_dev_kit
        try:
            clone_or_pull_ai_dev_kit()
        except Exception as e:
            logger.warning(f"Failed to initialize skills: {e}")

        # Initialize file sync service
        from ..services.file_sync import FileSyncService
        file_sync = FileSyncService(engine)
        app.state.file_sync = file_sync

        # Initialize and start file watcher
        import asyncio
        from ..services.file_watcher import init_watcher

        async def sync_callback(project_id: str, paths: list[str]):
            await file_sync.sync_files_to_db(project_id, paths)

        try:
            watcher = init_watcher(sync_callback)
            watcher.start(asyncio.get_event_loop())
            app.state.file_watcher = watcher
            logger.info("File watcher started successfully")
        except Exception as e:
            logger.warning(f"Failed to start file watcher: {e}")
            app.state.file_watcher = None

        app.state.engine = engine
        yield

        # Cleanup
        if app.state.file_watcher:
            app.state.file_watcher.stop()
        engine.dispose()

    @staticmethod
    def __call__(request: Request) -> Generator[Session, None, None]:
        # In dev mode, serialize database access to avoid PGLite concurrency issues
        if _dev_db_lock is not None:
            with _dev_db_lock:
                with Session(bind=request.app.state.engine) as session:
                    yield session
        else:
            with Session(bind=request.app.state.engine) as session:
                yield session


LakebaseDependency: TypeAlias = Annotated[Session, _LakebaseDependency.depends()]
