"""
/api/me — unified identity endpoint.

Single source of truth for "who is the user" across both local and
deployed modes. See backend/AUTH.md for the full model.

UI components that need identity call this. Nothing else. The legacy
`current_user` field on /api/config/status is deprecated.
"""

from __future__ import annotations

from ..core import Dependencies, create_router
from ..core.auth import WhoAmI, whoami

router = create_router()


@router.get("/me", response_model=WhoAmI, operation_id="getMe")
def get_me(
    headers: Dependencies.Headers,
    session: Dependencies.Session,
) -> WhoAmI:
    """Return the current user's identity.

    - Deployed mode: email from `x-forwarded-email`, profile=null.
    - Local mode: single User row from the DB.
    - No user row in local mode: `is_configured=false` → UI routes to /setup.
    """
    return whoami(headers, session)
