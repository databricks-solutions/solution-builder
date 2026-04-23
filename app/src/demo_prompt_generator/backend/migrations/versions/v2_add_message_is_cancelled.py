"""Add is_cancelled to messages table.

Marks assistant messages that were interrupted by the user so the chat UI can
render them with a clear 'canceled' state on refresh (instead of looking like
a silently truncated success).

Revision ID: v2_msg_cancelled
Revises: v1_active_exec
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "v2_msg_cancelled"
down_revision: Union[str, None] = "v1_active_exec"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("is_cancelled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("messages", "is_cancelled")
