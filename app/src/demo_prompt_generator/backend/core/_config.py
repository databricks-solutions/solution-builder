from __future__ import annotations

import logging
from importlib import resources
from pathlib import Path
from typing import ClassVar

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from ..._metadata import app_name, app_slug

# --- Config ---

project_root = Path(__file__).parent.parent.parent.parent.parent
env_file = project_root / ".env"

if env_file.exists():
    load_dotenv(dotenv_path=env_file)


class AppConfig(BaseSettings):
    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_file=env_file,
        env_prefix=f"{app_slug.upper()}_",
        extra="ignore",
        env_nested_delimiter="__",
    )
    app_name: str = Field(default=app_name)

    databricks_host: str = Field(default="")
    databricks_token: str = Field(default="")

    # Endpoint name passed as Anthropic `model` field by Claude Code
    # (Agent SDK). For FMAPI default endpoints this is the
    # workspace-shipped Anthropic-shape model name (e.g.
    # databricks-claude-sonnet-4-6); for custom AI Gateway endpoints
    # this is the AI Gateway endpoint name (e.g. demo-generator-do-not-delete).
    # The model is dispatched by whatever bridge anthropic_base_path
    # resolves to.
    anthropic_llm_endpoint: str = Field(
        default="databricks-claude-sonnet-4-6",
        validation_alias="ANTHROPIC_LLM_ENDPOINT",
    )

    # URL path segment appended to the workspace host to form
    # ANTHROPIC_BASE_URL for Claude Code. Two real options today:
    #
    #   serving-endpoints/anthropic  → FMAPI Anthropic bridge. Routes by
    #                                  the `model` field to a built-in
    #                                  databricks-claude-* endpoint.
    #                                  Default — works out of the box on
    #                                  any workspace.
    #
    #   ai-gateway/anthropic         → AI Gateway Anthropic shim. Routes
    #                                  by the `model` field to a custom
    #                                  AI Gateway endpoint (you create
    #                                  these in the AI Gateway UI). Use
    #                                  this when you want Claude Code
    #                                  to hit a routed/governed endpoint
    #                                  with budgets, rate limits, etc.
    #
    # Full URL becomes: {host}/{anthropic_base_path}/v1/messages
    # No leading or trailing slash — added by callers.
    anthropic_base_path: str = Field(
        default="serving-endpoints/anthropic",
        validation_alias="ANTHROPIC_BASE_PATH",
    )

    # AI Gateway model names (no app prefix — these are workspace-level)
    ai_gateway_mini: str = Field(default="databricks-gpt-5-4-mini", validation_alias="AI_GATEWAY_MINI")
    ai_gateway: str = Field(default="databricks-claude-opus-4-7", validation_alias="AI_GATEWAY")
    ai_gateway_embedding: str = Field(default="databricks-qwen3-embedding-0-6b", validation_alias="AI_GATEWAY_EMBEDDING")

    # Default Unity Catalog that every new project lands in. Created on
    # app boot if missing, with `USE CATALOG` + `CREATE SCHEMA` granted
    # to `account users` so any signed-in user can spin up a demo schema.
    # Each admin in `template_admin_emails` gets `ALL PRIVILEGES` so they
    # can clean up across users' schemas. Override per-environment via
    # the `DEFAULT_CATALOG` env var (set by databricks.<target>.yml).
    default_catalog: str = Field(
        default="ai_demo_gen",
        validation_alias="DEFAULT_CATALOG",
    )

    # Admin emails for template review. Stored as a comma-separated string
    # so pydantic-settings doesn't try to JSON-decode it (its default
    # `list[str]` parser expects `["a","b"]` syntax and errors on a bare
    # comma-list). Read via `template_admin_emails` (the property below)
    # which returns the parsed list — every caller uses `email in config.template_admin_emails`
    # which works against the parsed list unchanged.
    # Defaults to empty (no admins). Set DEMO_PROMPT_GENERATOR_TEMPLATE_ADMIN_EMAILS
    # in .env (local) or databricks.<target>.yml's app_env (deployed).
    template_admin_emails_raw: str = Field(
        default="",
        validation_alias="DEMO_PROMPT_GENERATOR_TEMPLATE_ADMIN_EMAILS",
    )

    @property
    def template_admin_emails(self) -> list[str]:
        return [e.strip() for e in self.template_admin_emails_raw.split(",") if e.strip()]

    @property
    def static_assets_path(self) -> Path:
        return Path(str(resources.files(app_slug))).joinpath("__dist__")

    def __hash__(self) -> int:
        return hash(self.app_name)


# --- Logger ---

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s: %(message)s")
logger = logging.getLogger(app_name)

# Quiet noisy loggers we don't care about in dev:
#   - `httpx` logs every outbound request at INFO. The preview iframe proxies
#     every asset through httpx → hundreds of lines per page load.
#   - uvicorn's access logger ("127.0.0.1 - GET /preview/... 200") fires for
#     each proxied vite HMR asset. Filter preview noise out, keep real API.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


class _DropPreviewAccessLog(logging.Filter):
    """Drop uvicorn.access records whose request path is under /preview/.

    Uvicorn's access record message is formatted like:
        '%s - "%s %s HTTP/%s" %d' via positional args:
        args = (client_addr, method, full_path, http_version, status_code)
    We pattern-match the 3rd arg; if it starts with /preview/ we drop the record.
    Keeps visibility on /api/* — the ones that actually matter.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3:
            path = args[2]
            if isinstance(path, str) and path.startswith("/preview/"):
                return False
        # Fallback: check the rendered message (covers format variants).
        msg = record.getMessage()
        if '"GET /preview/' in msg or '"POST /preview/' in msg or '"HEAD /preview/' in msg:
            return False
        return True


logging.getLogger("uvicorn.access").addFilter(_DropPreviewAccessLog())
