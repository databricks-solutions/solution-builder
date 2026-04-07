"""Main router with all API endpoints."""

from databricks.sdk.service.iam import User as UserOut

from .core import Dependencies, create_router
from .models import VersionOut

router = create_router()

# Import new route modules (project-based architecture)
from .routes import projects as _projects  # noqa: E402, F401
from .routes import project_files as _project_files  # noqa: E402, F401
from .routes import messages as _messages  # noqa: E402, F401
from .routes import agent as _agent  # noqa: E402, F401
from .routes import skills as _skills  # noqa: E402, F401
from .routes import resources as _resources  # noqa: E402, F401


@router.get("/version", response_model=VersionOut, operation_id="version")
async def version():
    return VersionOut.from_metadata()


@router.get("/current-user", response_model=UserOut, operation_id="currentUser")
def me(user_ws: Dependencies.UserClient):
    return user_ws.current_user.me()
