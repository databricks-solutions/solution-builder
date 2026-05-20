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

    # env.py issues `SET ROLE databricks_superuser` before this runs so future
    # CREATE TABLE statements land owned by the shared role. But ALTER OWNER
    # requires being the CURRENT owner (or having ADMIN OPTION on the owner)
    # — and the existing tables are owned by whatever SP first created them,
    # not by databricks_superuser. Switch back to our login role for this
    # migration, which IS one of the historical owners. Re-apply SET ROLE
    # at the end so the rest of the migration chain stays consistent.
    bind.execute(sa.text("RESET ROLE"))
    try:
        for table in MANAGED_TABLES:
            # Only alter tables that actually exist (defensive — e.g. against
            # a freshly-created DB where some earlier migrations haven't run).
            row = bind.execute(
                sa.text(
                    "SELECT 1 FROM pg_tables "
                    "WHERE schemaname = 'public' AND tablename = :t"
                ),
                {"t": table},
            ).first()
            if row is None:
                continue
            # Skip tables already owned by the shared role — keeps the
            # migration idempotent on re-runs and on the new-DB path where
            # env.py's SET ROLE already made databricks_superuser the owner.
            owner = bind.execute(
                sa.text(
                    "SELECT tableowner FROM pg_tables "
                    "WHERE schemaname = 'public' AND tablename = :t"
                ),
                {"t": table},
            ).scalar()
            if owner == SHARED_OWNER_ROLE:
                continue
            try:
                op.execute(
                    f'ALTER TABLE public."{table}" OWNER TO {SHARED_OWNER_ROLE}'
                )
            except Exception as e:
                # We can't ALTER OWNER if the current login role is neither
                # the table owner nor a member of the owner role. Log and
                # carry on rather than crash the app — operators can fix
                # ownership out-of-band and re-run.
                import logging
                logging.getLogger("alembic").warning(
                    "v5_normalize_ownership: skipping %s (cannot ALTER OWNER): %s",
                    table, e,
                )
    finally:
        # Restore the SET ROLE so subsequent migrations (none today, but
        # future ones) still create new objects owned by the shared role.
        bind.execute(sa.text("SET ROLE databricks_superuser"))


def downgrade() -> None:
    # No-op: we never want to give ownership back to an individual SP.
    # Re-assigning to a specific role on downgrade would require knowing
    # who the previous owner was, and the whole point of this migration
    # is to make ownership identity-independent.
    pass
