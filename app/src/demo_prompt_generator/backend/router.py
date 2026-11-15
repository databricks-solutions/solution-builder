"""Main router with all API endpoints."""

from databricks.sdk.service.iam import User as UserOut

from .core import Dependencies, create_router
from .models import VersionOut

router = create_router()

# Import new route modules (project-based architecture)
from .routes import projects as _projects  # noqa: E402, F401
from .routes import project_files as _project_files  # noqa: E402, F401
from .routes import messages as _messages  # noqa: E402, F401
from .routes import skills as _skills  # noqa: E402, F401
from .routes import resources as _resources  # noqa: E402, F401
from .routes import agent as _agent  # noqa: E402, F401
from .routes import templates as _templates  # noqa: E402, F401
from .routes import constants as _constants  # noqa: E402, F401
from .routes import config as _config  # noqa: E402, F401
from .routes import block_factory as _block_factory  # noqa: E402, F401
from .routes import me as _me  # noqa: E402, F401  # /api/me — see AUTH.md
from .routes import stats as _stats  # noqa: E402, F401  # /api/stats — admin dashboard
from .routes import internal as _internal  # noqa: E402, F401  # /api/internal/metrics — live runtime metrics page
from .routes import uploads as _uploads  # noqa: E402, F401  # /api/uploads/extract — home-page file upload
from .routes import brands as _brands  # noqa: E402, F401  # /api/brands/resolve — company brand (logo + palette)
from .routes import collab as _collab  # noqa: E402, F401  # /api/projects/{id}/collab — live multi-user architecture editing (WS)
from .routes import architecture_history as _architecture_history  # noqa: E402, F401  # /api/projects/{id}/architecture-history — arch-tab History panel
from .routes import usage as _usage  # noqa: E402, F401  # /api/projects/{id}/usage — chat "$" chip (tokens + cost)
from .routes import grounding as _grounding  # noqa: E402, F401  # /api/grounding/analyze — real-UC-schema vs story gap analysis
from .routes import mcp as _mcp  # noqa: E402, F401  # /api/mcp/* — a trusted MCP server builds for a user (MCP_CALLER_SP_ID)
from .routes import arch_scan as _arch_scan  # noqa: E402, F401  # /api/architecture/scan-prompt — "from an existing project" prompt


@router.get("/health", operation_id="health")
async def health():
    """Health check endpoint for Electron app startup."""
    return {"status": "ok"}


@router.get("/version", response_model=VersionOut, operation_id="version")
async def version():
    return VersionOut.from_metadata()


@router.get("/current-user", response_model=UserOut, operation_id="currentUser")
def me(user_ws: Dependencies.UserClient):
    return user_ws.current_user.me()
