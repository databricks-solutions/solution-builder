"""Normalize all table ownership to databricks_superuser.

The original prod database had its tables owned by an individual service
principal that was later deleted from IAM. Once that SP was gone, no other
identity could ALTER the tables (Postgres 16 requires you to BE the owner
or have ADMIN OPTION on the owner role — peer membership in a shared
group isn't enough). The next migration that touched any of those tables
crashed the app on startup.

This migration transfers every table's owner to the shared
`databricks_superuser` role so that any current OR future SP that's a
member of that role can ALTER. Combined with the `SET ROLE
databricks_superuser` added in env.py, future tables created by
migrations will also land owned by the shared role.

Idempotent: re-running ALTER OWNER to the same role is a no-op. Silent
in dev (PGLite has no such role) so the local dev loop stays unchanged.

Revision ID: v5_normalize_ownership
Revises: v4_proj_narrative
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v5_normalize_ownership"
down_revision: Union[str, None] = "v4_proj_narrative"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SHARED_OWNER_ROLE = "databricks_superuser"

# Tables managed by this app. Keep in sync with models.py / earlier
# migrations. `alembic_version` is included so the version table is also
# owned by the shared role.
MANAGED_TABLES = (
    "alembic_version",
    "event_logs",
    "executions",
    "messages",
    "project_files",
    "project_shares",
    "project_stars",
    "projects",
    "template_content",
    "templates",
    "users",
)


def _shared_role_exists(bind) -> bool:
    row = bind.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = :n"),
        {"n": SHARED_OWNER_ROLE},
    ).first()
    return row is not None


def upgrade() -> None:
    bind = op.get_bind()
    if not _shared_role_exists(bind):
        # Dev (PGLite) or any Postgres without the Databricks role — leave
        # ownership alone. The env.py SET ROLE is also a silent no-op there.
        return

    for table in MANAGED_TABLES:
        # Only alter tables that actually exist (defensive — e.g. if this
        # migration runs against a freshly-created DB where v0/v1/v2/v3/v4
        # have only just created their tables, all should be present).
        row = bind.execute(
            sa.text(
                "SELECT 1 FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename = :t"
            ),
            {"t": table},
        ).first()
        if row is None:
            continue
        op.execute(f'ALTER TABLE public."{table}" OWNER TO {SHARED_OWNER_ROLE}')


def downgrade() -> None:
    # No-op: we never want to give ownership back to an individual SP.
    # Re-assigning to a specific role on downgrade would require knowing
    # who the previous owner was, and the whole point of this migration
    # is to make ownership identity-independent.
    pass
