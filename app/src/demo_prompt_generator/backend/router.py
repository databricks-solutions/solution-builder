from databricks.sdk.service.iam import User as UserOut

from .core import Dependencies, create_router
from .models import VersionOut

router = create_router()

# Import route modules so their decorators register on the singleton router.
from .routes import generate as _generate  # noqa: E402, F401
from .routes import generations as _generations  # noqa: E402, F401
from .routes import inspire as _inspire  # noqa: E402, F401
from .routes import workspace as _workspace  # noqa: E402, F401
from .routes import conversations as _conversations  # noqa: E402, F401
from .routes import library as _library  # noqa: E402, F401
from .routes import blocks as _blocks  # noqa: E402, F401
from .routes import collections as _collections_rt  # noqa: E402, F401


@router.get("/version", response_model=VersionOut, operation_id="version")
async def version():
    return VersionOut.from_metadata()


@router.get("/current-user", response_model=UserOut, operation_id="currentUser")
def me(user_ws: Dependencies.UserClient):
    return user_ws.current_user.me()
