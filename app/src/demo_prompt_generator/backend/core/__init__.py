from ._factory import create_app as create_app, create_router as create_router
from .dependencies import Dependencies as Dependencies
from ._config import logger as logger
from .lakebase import LakebaseDependency
# Side-effect import: registers _CatalogBootstrapDependency so create_app()
# picks it up and runs the bootstrap once at startup. Keep AFTER lakebase so
# the lifespan chain order is Config → Workspace → Lakebase → CatalogBootstrap.
from . import _catalog_bootstrap  # noqa: F401
