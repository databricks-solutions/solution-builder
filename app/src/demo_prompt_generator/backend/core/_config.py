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
    llm_model: str = Field(
        default="databricks-claude-sonnet-4-6",
    )

    # AI Gateway model names (no app prefix — these are workspace-level)
    ai_gateway_mini: str = Field(default="databricks-gpt-5-4-mini", validation_alias="AI_GATEWAY_MINI")
    ai_gateway: str = Field(default="databricks-claude-opus-4-7", validation_alias="AI_GATEWAY")
    ai_gateway_embedding: str = Field(default="databricks-qwen3-embedding-0-6b", validation_alias="AI_GATEWAY_EMBEDDING")

    # Admin emails for template review (comma-separated in env var)
    template_admin_emails: list[str] = Field(
        default=["quentin.ambard@databricks.com", "cal.reynold@gmail.com"]
    )

    @property
    def static_assets_path(self) -> Path:
        return Path(str(resources.files(app_slug))).joinpath("__dist__")

    def __hash__(self) -> int:
        return hash(self.app_name)


# --- Logger ---

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s: %(message)s")
logger = logging.getLogger(app_name)
