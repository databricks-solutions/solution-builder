"""
Preview module — run a project's generated app as a subprocess and proxy it.

Self-contained feature; see README.md for removal instructions. Only public API:
    from .preview import register_routes
    register_routes(main_router, get_project_dir=...)
"""

from .routes import register_routes as register_routes

__all__ = ["register_routes"]
