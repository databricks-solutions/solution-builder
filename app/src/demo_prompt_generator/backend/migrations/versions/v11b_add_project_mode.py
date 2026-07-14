"""Add projects.mode.

Home-page entry mode for a project: "story" (the default build flow),
"architecture" (lead-with-diagram; see architecture_first), or "workshop"
(Genie Code workshop — the agent generates notebooks + data-gen + context
instead of provisioning Databricks resources). Drives which Build fork the
agent takes. Existing rows default to "story".

NOTE on the revision id + position: this originally branched off v10 in
parallel with `v11_driver_handoff` (two heads). It's now re-parented to the tip
of that chain (`v12_brand_cache`) so history is linear again. The revision id is
kept as `v11_project_mode` (NOT renumbered to v13) on purpose: some dev DBs were
already stamped `v11_project_mode` by the branched version before the re-parent,
so keeping the id lets those DBs resolve their current revision. `upgrade()` is
idempotent (ADD COLUMN IF NOT EXISTS) so it's safe whether the column already
exists (already-stamped DBs) or not (fresh DBs running the full chain).

Revision ID: v11_project_mode
Revises: v12_brand_cache
Create Date: 2026-07-14
"""
from typing import Sequence, Union

from alembic import op

revision: str = "v11_project_mode"
down_revision: Union[str, None] = "v12_brand_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: a dev DB may already carry this column from the pre-re-parent
    # branched migration (which was stamped v11_project_mode). Postgres supports
    # IF NOT EXISTS on ADD COLUMN.
    op.execute(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS mode "
        "VARCHAR(20) NOT NULL DEFAULT 'story'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS mode")
