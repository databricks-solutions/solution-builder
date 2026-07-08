"""Add role + status to project_shares (harden direct project sharing).

Two columns turn the old "share = full access, granted unilaterally" model into
a real permission grant with an acceptance handshake:

- ``role``   : 'viewer' | 'editor'
    viewer = read-only (can view + clone, cannot mutate the original);
    editor = can modify the project (run the agent, edit files) but NOT delete
             it or manage its shares (owner-only).
- ``status`` : 'pending' | 'accepted' | 'declined'
    A new share starts 'pending'; the recipient must accept before it grants any
    access. Declined shares grant nothing.

Backfill: EXISTING rows are set to editor+accepted so we do NOT silently revoke
access from anyone who already had a share (the old code granted full write). We
then flip the server-side DEFAULT to the SAFE values (viewer+pending) so any new
row is safe-by-default even if a caller forgets to set them; the app always sets
them explicitly.

Revision ID: v8_share_role_status
Revises: v7_msg_context_hint
Create Date: 2026-07-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "v8_share_role_status"
down_revision: Union[str, None] = "v7_msg_context_hint"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add columns with a PRESERVE-existing server_default so the backfill of
    # existing rows keeps their prior (full-access, already-granted) behavior.
    op.add_column(
        "project_shares",
        sa.Column("role", sa.String(length=20), nullable=False, server_default="editor"),
    )
    op.add_column(
        "project_shares",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="accepted"),
    )
    # When the recipient accepted/declined (NULL until they respond).
    op.add_column(
        "project_shares",
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Flip the DB-level default to the safe values for future inserts. This does
    # NOT touch existing rows (they keep editor/accepted).
    op.alter_column("project_shares", "role", server_default="viewer")
    op.alter_column("project_shares", "status", server_default="pending")


def downgrade() -> None:
    op.drop_column("project_shares", "responded_at")
    op.drop_column("project_shares", "status")
    op.drop_column("project_shares", "role")
