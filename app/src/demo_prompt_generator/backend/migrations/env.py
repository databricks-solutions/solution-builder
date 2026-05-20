"""Alembic environment configuration.

This module configures Alembic to use our SQLModel metadata and database engine.
Migrations run automatically on app startup via lakebase.py.

Note: This file is loaded by Alembic as a standalone script, so we can't use
relative imports. The SQLModel metadata is sufficient for autogenerate support.

IMPORTANT: We run migrations with an existing connection passed via config attributes
(not by URL) because production Databricks Lakebase uses dynamic OAuth tokens that
aren't in the URL string.
"""

from alembic import context
from sqlmodel import SQLModel

# Alembic Config object — set programmatically in lakebase.py
config = context.config

# SQLModel metadata for autogenerate support
# Models are imported when the app starts, so metadata is already populated
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (generate SQL without DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (with existing DB connection).

    The connection is passed via config.attributes["connection"] from lakebase.py.
    This is required because Databricks Lakebase uses dynamic OAuth tokens that
    aren't available in the URL string.
    """
    connectable = config.attributes.get("connection")

    if connectable is None:
        raise RuntimeError(
            "No database connection provided. "
            "Alembic migrations must be run programmatically via lakebase.py, "
            "not via the alembic CLI."
        )

    context.configure(
        connection=connectable,
        target_metadata=target_metadata,
    )

    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
