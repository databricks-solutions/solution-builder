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
from collections.abc import Iterator
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
        self._clients: dict[str, Any] = {}

    def _client_for(self, endpoint_name: str):
        """Build an OpenAI client scoped to a specific serving endpoint.

        Uses base_url `<host>/serving-endpoints/<endpoint_name>` so requests hit
        `/serving-endpoints/<endpoint_name>/chat/completions` (or /embeddings) —
        these paths are authorized by the per-endpoint CAN_QUERY grant from
        Databricks Apps resources. The generic `/serving-endpoints/chat/completions`
        router path requires a broader scope that Apps don't receive.
        """
        cached = self._clients.get(endpoint_name)
        if cached is not None:
            return cached

        from openai import OpenAI

        host = (self.ws.config.host or "").rstrip("/")
        headers = self.ws.config.authenticate()
        token = headers.get("Authorization", "").removeprefix("Bearer ").strip()
        client = OpenAI(
            base_url=f"{host}/serving-endpoints/{endpoint_name}",
            api_key=token,
        )
        self._clients[endpoint_name] = client
        return client

    def _chat_client(self, model: str):
        return self._client_for(model)

    def _embedding_client(self):
        return self._client_for(EMBEDDING_MODEL)

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
            response = self._chat_client(model).chat.completions.create(**kwargs)
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

    def chat_stream(
        self,
        prompt: str,
        *,
        size: ModelSize | Literal["mini", "normal"] = ModelSize.MINI,
        system_prompt: str | None = None,
        max_tokens: int = 1000,
    ) -> Iterator[str]:
        """
        Stream a chat completion response token by token.

        Args:
            prompt: The user prompt
            size: Model size - "mini" for fast/cheap, "normal" for more capable
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens in response

        Yields:
            Tokens as they arrive from the model
        """
        # Normalize size to enum
        if isinstance(size, str):
            size = ModelSize(size)

        model = MODEL_NAMES[size]
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            response = self._chat_client(model).chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                stream=True,
            )
            for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            logger.error(f"Chat stream failed (model={model}): {e}")
            raise

    def chat_stream_lines(
        self,
        prompt: str,
        *,
        size: ModelSize | Literal["mini", "normal"] = ModelSize.MINI,
        system_prompt: str | None = None,
        max_tokens: int = 1000,
    ) -> Iterator[str]:
        """
        Stream chat completion and yield complete lines as they arrive.

        Useful for line-delimited JSON output where each line is a valid JSON object.

        Args:
            prompt: The user prompt
            size: Model size
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens in response

        Yields:
            Complete lines (without trailing newline)
        """
        buffer = ""
        for token in self.chat_stream(
            prompt, size=size, system_prompt=system_prompt, max_tokens=max_tokens
        ):
            buffer += token
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if line:
                    yield line
        # Yield any remaining content
        if buffer.strip():
            yield buffer.strip()

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
            response = self._embedding_client().embeddings.create(
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
            response = self._embedding_client().embeddings.create(
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
        Generate a concise project name, description, and schema name from a user prompt.

        Returns:
            dict with 'name' (display name, max 100 chars), 'description' (1-2 sentences),
            and 'schema_name' (SQL-safe, max 50 chars)
        """
        prompt = f"""Based on this demo/project description, generate:
1. A concise demo name (max 100 characters, human-readable title)
2. A short description (1-2 sentences summarizing the demo, max 200 characters)
3. A SQL schema name (lowercase, underscores only, no spaces, max 50 characters, start with letter)

Return JSON:
{{
    "name": "Short Demo Name Here",
    "description": "Brief summary of what this demo showcases.",
    "schema_name": "short_schema_name"
}}

User prompt:
{description[:4000]}
"""

        try:
            result = self.chat_json(prompt, size=ModelSize.MINI, max_tokens=300)

            # Validate and sanitize name
            name = result.get("name", "Untitled Demo")[:100]

            # Validate and sanitize description
            short_desc = result.get("description", "")[:200]

            # Validate and sanitize schema_name
            schema_name = result.get("schema_name", "demo")
            schema_name = re.sub(r"[^a-z0-9_]", "_", schema_name.lower())
            schema_name = re.sub(r"_+", "_", schema_name).strip("_")
            if not schema_name or not schema_name[0].isalpha():
                schema_name = "demo_" + schema_name
            schema_name = schema_name[:50]

            return {"name": name, "description": short_desc, "schema_name": schema_name}

        except Exception as e:
            logger.error(f"Failed to generate project metadata: {e}")
            # Fallback: extract first line as name
            first_line = description.split("\n")[0].strip()[:100]
            return {
                "name": first_line or "Untitled Demo",
                "description": "",
                "schema_name": "demo_project",
            }
