"""
LLM Service for AI operations.

Provides a centralized interface for:
- Chat completions (mini/normal models)
- Embeddings
"""

from __future__ import annotations

import json
import logging
import re
from enum import Enum
from typing import Any, Literal

from databricks.sdk import WorkspaceClient

from ..core._config import AppConfig
from ..core.constants import INDUSTRIES, get_capabilities

logger = logging.getLogger(__name__)


class ModelSize(str, Enum):
    """Model size options for chat completions."""
    MINI = "mini"
    NORMAL = "normal"


# Centralized model name mapping
MODEL_NAMES = {
    ModelSize.MINI: "databricks-gpt-5-4-mini",
    ModelSize.NORMAL: "databricks-gpt-5-4",
}
EMBEDDING_MODEL = "databricks-qwen3-embedding-0-6b"
EMBEDDING_DIMENSION = 1024


class LLMService:
    """
    Service for LLM operations: chat completions and embeddings.

    Centralizes model name configuration and provides a clean interface.
    """

    def __init__(self, ws: WorkspaceClient, config: AppConfig | None = None):
        self.ws = ws
        self.config = config
        self._client = None

    @property
    def client(self):
        """Lazy-load the OpenAI client."""
        if self._client is None:
            self._client = self.ws.serving_endpoints.get_open_ai_client()
        return self._client

    # -------------------------------------------------------------------------
    # Core Methods
    # -------------------------------------------------------------------------

    def chat(
        self,
        prompt: str,
        *,
        size: ModelSize | Literal["mini", "normal"] = ModelSize.MINI,
        system_prompt: str | None = None,
        json_output: bool = False,
        max_tokens: int = 1000,
    ) -> str:
        """
        Send a chat completion request.

        Args:
            prompt: The user prompt
            size: Model size - "mini" for fast/cheap, "normal" for more capable
            system_prompt: Optional system prompt
            json_output: If True, request JSON output format
            max_tokens: Maximum tokens in response

        Returns:
            The model's response text
        """
        # Normalize size to enum
        if isinstance(size, str):
            size = ModelSize(size)

        model = MODEL_NAMES[size]
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if json_output:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            response = self.client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Chat completion failed (model={model}): {e}")
            raise

    def chat_json(
        self,
        prompt: str,
        *,
        size: ModelSize | Literal["mini", "normal"] = ModelSize.MINI,
        system_prompt: str | None = None,
        max_tokens: int = 1000,
    ) -> dict[str, Any]:
        """
        Send a chat completion request expecting JSON response.

        Args:
            prompt: The user prompt
            size: Model size - "mini" for fast/cheap, "normal" for more capable
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens in response

        Returns:
            Parsed JSON response as dict
        """
        response = self.chat(
            prompt,
            size=size,
            system_prompt=system_prompt,
            json_output=True,
            max_tokens=max_tokens,
        )
        return json.loads(response)

    def get_embedding(self, text: str) -> list[float]:
        """
        Get embedding vector for text.

        Args:
            text: Text to embed (will be truncated if too long)

        Returns:
            List of floats representing the embedding vector
        """
        # Truncate text if too long (embedding models have token limits)
        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars]

        try:
            response = self.client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Failed to get embedding: {e}")
            return [0.0] * EMBEDDING_DIMENSION

    def get_embeddings_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Get embeddings for multiple texts in a single request.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """
        max_chars = 8000
        truncated = [t[:max_chars] if len(t) > max_chars else t for t in texts]

        try:
            response = self.client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=truncated,
            )
            return [item.embedding for item in response.data]
        except Exception as e:
            logger.error(f"Failed to get batch embeddings: {e}")
            return [[0.0] * EMBEDDING_DIMENSION for _ in texts]

    # -------------------------------------------------------------------------
    # Higher-Level Methods
    # -------------------------------------------------------------------------

    def summarize_readme(self, readme_content: str) -> dict[str, Any]:
        """
        Analyze README content and extract structured metadata.

        Returns:
            dict with description, capabilities, and industry
        """
        capability_ids = [c["id"] for c in get_capabilities()]

        prompt = f"""Analyze this README and return JSON with the following structure:
{{
    "description": "1-2 sentence summary of what this demo does",
    "capabilities": ["capability-id-1", "capability-id-2"],
    "industry": "one of the industries listed below"
}}

Available capability IDs (only use these exact IDs):
{json.dumps(capability_ids, indent=2)}

Available industries (choose exactly one):
{json.dumps(INDUSTRIES, indent=2)}

README:
{readme_content[:8000]}
"""

        try:
            result = self.chat_json(prompt, size=ModelSize.MINI)

            # Validate capabilities are valid IDs
            valid_capabilities = [c for c in result.get("capabilities", []) if c in capability_ids]
            result["capabilities"] = valid_capabilities

            # Validate industry
            if result.get("industry") not in INDUSTRIES:
                result["industry"] = None

            return result
        except Exception as e:
            logger.error(f"Failed to summarize README: {e}")
            return {
                "description": None,
                "capabilities": [],
                "industry": None,
            }

    def generate_project_metadata(self, description: str) -> dict[str, str]:
        """
        Generate a concise project name and schema name from a description.

        Returns:
            dict with 'name' (display name, max 100 chars) and 'schema_name' (SQL-safe, max 50 chars)
        """
        prompt = f"""Based on this demo/project description, generate:
1. A concise demo name (max 100 characters, human-readable title)
2. A SQL schema name (lowercase, underscores only, no spaces, max 50 characters, start with letter)

Return JSON:
{{
    "name": "Short Demo Name Here",
    "schema_name": "short_schema_name"
}}

Description:
{description[:4000]}
"""

        try:
            result = self.chat_json(prompt, size=ModelSize.MINI, max_tokens=200)

            # Validate and sanitize name
            name = result.get("name", "Untitled Demo")[:100]

            # Validate and sanitize schema_name
            schema_name = result.get("schema_name", "demo")
            schema_name = re.sub(r"[^a-z0-9_]", "_", schema_name.lower())
            schema_name = re.sub(r"_+", "_", schema_name).strip("_")
            if not schema_name or not schema_name[0].isalpha():
                schema_name = "demo_" + schema_name
            schema_name = schema_name[:50]

            return {"name": name, "schema_name": schema_name}

        except Exception as e:
            logger.error(f"Failed to generate project metadata: {e}")
            # Fallback: extract first line as name
            first_line = description.split("\n")[0].strip()[:100]
            return {
                "name": first_line or "Untitled Demo",
                "schema_name": "demo_project",
            }
