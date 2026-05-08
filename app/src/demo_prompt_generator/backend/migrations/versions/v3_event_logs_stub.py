"""Stub for v3_event_logs after revert of #51.

The original v3 migration created the event_logs table for the reverted
backend-event-logging feature. Live Lakebase databases that received the
prior deploy already have alembic_version = 'v3_event_logs'; without this
stub revision in the chain, alembic refuses to boot with
"Can't locate revision identified by 'v3_event_logs'".

This file lets such databases keep running on the reverted code without
needing a manual rewind. upgrade() is a no-op (table either exists from
the prior deploy or doesn't — neither blocks the app).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v3_event_logs"
down_revision: Union[str, None] = "v2_msg_cancelled"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
