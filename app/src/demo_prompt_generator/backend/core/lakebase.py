"""Lakebase (Databricks Database) integration: config, engine, session, and dependency."""

from __future__ import annotations

import os
import shutil
from collections.abc import Generator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, AsyncGenerator, TypeAlias

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from fastapi import FastAPI, Request
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Engine, create_engine, event
from sqlmodel import Session, SQLModel, text

from ._base import LifespanDependency
from ._config import logger


# --- PGLite Configuration ---

PGLITE_DIR = Path.home() / ".pglite"
"""Directory where PGLite stores its data (~/.pglite/ in home directory)."""


def _is_pglite_mode() -> bool:
    """Check if we should use PGLite (no external DB URL configured)."""
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

    engine = create_engine(
        engine_url,
        pool_size=4,
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
        default="demo-prompt-gen-db",
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
    engine_url = _build_engine_url(db_config, ws)

    if static_url:
        # Static URL mode: real Postgres with connection pool
        engine_kwargs: dict[str, Any] = {
            "pool_size": 4,
            "pool_recycle": 45 * 60,
            "pool_pre_ping": True,
        }
        # SSL is specified in the URL itself (sslmode=require)
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

    # Only use dynamic token refresh for production Databricks Database
    if not static_url:
        event.listens_for(engine, "do_connect")(before_connect)

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


def initialize_models(engine: Engine) -> None:
    """Create all SQLModel tables and add any missing columns.

    Set RESET_DB=1 environment variable to drop all tables and start fresh.
    For PGLite, this deletes the .pglite directory.
    For other databases, this drops all tables.
    """
    # For non-PGLite databases, handle RESET_DB by dropping tables
    # (PGLite reset is handled earlier in _create_pglite_engine)
    if not _is_pglite_mode() and os.environ.get("RESET_DB") == "1":
        logger.warning("RESET_DB=1 detected - dropping all tables!")
        SQLModel.metadata.drop_all(engine)
        logger.info("All tables dropped. Recreating...")

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

        # Add catalog/schema columns to projects
        ("projects_add_catalog", "ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_catalog VARCHAR(255)"),
        ("projects_add_schema", "ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_schema VARCHAR(255)"),

        # Add session_id to executions for conversation resumption
        ("executions_add_session_id", "ALTER TABLE executions ADD COLUMN IF NOT EXISTS session_id VARCHAR(100)"),

        # Add reasoning_data JSON column to messages
        ("messages_add_reasoning_data", "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reasoning_data JSON"),

        # Add cluster_name and warehouse_name to projects
        ("projects_add_cluster_name", "ALTER TABLE projects ADD COLUMN IF NOT EXISTS cluster_name VARCHAR(255)"),
        ("projects_add_warehouse_name", "ALTER TABLE projects ADD COLUMN IF NOT EXISTS warehouse_name VARCHAR(255)"),

        # --- Template Library Feature ---

        # Enable pgvector extension (for semantic search) - skip for PGLite
        ("pgvector_extension", "CREATE EXTENSION IF NOT EXISTS vector"),

        # Templates table (stores approved/pending templates)
        ("templates_table", """
            CREATE TABLE IF NOT EXISTS templates (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'REVIEW_REQUESTED',
                owner_email VARCHAR(255) NOT NULL,
                industry VARCHAR(100),
                description TEXT,
                full_description TEXT,
                capabilities TEXT,
                embedding vector(1024),
                submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                reviewed_at TIMESTAMP WITH TIME ZONE,
                reviewed_by VARCHAR(255),
                source_project_id VARCHAR(50)
            )
        """),
        ("templates_status_idx", "CREATE INDEX IF NOT EXISTS ix_templates_status ON templates (status)"),
        ("templates_industry_idx", "CREATE INDEX IF NOT EXISTS ix_templates_industry ON templates (industry)"),
        ("templates_owner_idx", "CREATE INDEX IF NOT EXISTS ix_templates_owner ON templates (owner_email)"),

        # Template content table (stores files from templates)
        ("template_content_table", """
            CREATE TABLE IF NOT EXISTS template_content (
                id SERIAL PRIMARY KEY,
                template_id VARCHAR(50) NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
                relative_path VARCHAR(500) NOT NULL,
                content_compressed BYTEA NOT NULL,
                content_hash VARCHAR(64) NOT NULL,
                file_size INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """),
        ("template_content_template_idx", "CREATE INDEX IF NOT EXISTS ix_template_content_template_id ON template_content (template_id)"),
        ("template_content_unique_path", "CREATE UNIQUE INDEX IF NOT EXISTS ix_template_content_unique_path ON template_content (template_id, relative_path)"),
    ]

    with Session(engine) as session:
        for migration_name, ddl in _migrations:
            try:
                # Skip pgvector extension for PGLite (not supported)
                if _is_pglite_mode() and "vector" in migration_name:
                    logger.debug(f"Migration {migration_name} skipped (PGLite mode)")
                    continue
                # Skip vector column for PGLite
                if _is_pglite_mode() and "embedding vector" in ddl:
                    # Replace vector column with TEXT for PGLite
                    ddl = ddl.replace("embedding vector(1024)", "embedding TEXT")

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
        with Session(bind=request.app.state.engine) as session:
            yield session


LakebaseDependency: TypeAlias = Annotated[Session, _LakebaseDependency.depends()]
