"""
LLM Service for AI operations.

Uses WorkspaceClient.serving_endpoints.get_open_ai_client() for auth —
handles PAT, OAuth, and App service principal automatically.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from enum import Enum
from typing import Any, Literal

from databricks.sdk import WorkspaceClient

from ..core._config import AppConfig

logger = logging.getLogger(__name__)


def _repair_json(text: str) -> dict[str, Any]:
    """Best-effort recovery of a JSON object truncated mid-generation (a mini model
    hitting max_tokens). Strategy: parse character-by-character tracking string +
    bracket state; then progressively trim the tail one char at a time, and at each
    step close any open string/brackets and try to parse. Returns the first dict
    that parses, else {} — callers treat {} as "no evidence" and never crash."""
    s = text.strip()
    if not s or s[0] not in "{[":
        return {}

    def close_and_parse(prefix: str) -> dict[str, Any] | None:
        stack: list[str] = []
        in_str = esc = False
        for ch in prefix:
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                stack.append("}")
            elif ch == "[":
                stack.append("]")
            elif ch in "}]" and stack:
                stack.pop()
        cand = prefix
        if in_str:
            cand += '"'
        cand = cand.rstrip().rstrip(",")
        cand += "".join(reversed(stack))
        try:
            v = json.loads(cand)
            return v if isinstance(v, dict) else None
        except Exception:
            return None

    # Try the full string first, then trim the last char and retry, walking back
    # until something parses (bounded — don't scan more than a few KB back).
    for cut in range(len(s), max(0, len(s) - 4000), -1):
        got = close_and_parse(s[:cut])
        if got is not None:
            logger.warning("chat_json: recovered a truncated JSON response "
                           "(%d chars, trimmed %d)", len(s), len(s) - cut)
            return got
    logger.warning("chat_json: could not repair truncated JSON — returning {}")
    return {}


class ModelSize(str, Enum):
    MINI = "mini"
    NORMAL = "normal"


EMBEDDING_DIMENSION = 1024


class LLMService:
    """LLM operations via Databricks serving endpoints. Model names from AppConfig."""

    def __init__(self, ws: WorkspaceClient, config: AppConfig | None = None):
        self.ws = ws
        self.config = config or AppConfig()
        self._client = None

    def _get_client(self):
        """Single OpenAI client — SDK handles auth automatically."""
        if self._client is None:
            self._client = self.ws.serving_endpoints.get_open_ai_client()
        return self._client

    def _model_for(self, size: ModelSize) -> str:
        return self.config.ai_gateway_mini if size == ModelSize.MINI else self.config.ai_gateway

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
        if isinstance(size, str):
            size = ModelSize(size)

        model = self._model_for(size)
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
            response = self._get_client().chat.completions.create(**kwargs)
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
        response = self.chat(
            prompt, size=size, system_prompt=system_prompt,
            json_output=True, max_tokens=max_tokens,
        )
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Mini models occasionally truncate at max_tokens mid-string, leaving
            # unterminated/dangling JSON. Try a best-effort repair before failing.
            return _repair_json(response)

    def chat_vision(
        self,
        content: list[dict[str, Any]],
        *,
        size: ModelSize | Literal["mini", "normal"] = ModelSize.MINI,
        json_output: bool = False,
        max_tokens: int = 1000,
    ) -> str:
        """Multimodal chat: `content` is an OpenAI content-parts list mixing
        {type:'text',...} and {type:'image_url', image_url:{url: 'data:...'}}.
        Model must be vision-capable (our gpt-5-mini is)."""
        if isinstance(size, str):
            size = ModelSize(size)
        model = self._model_for(size)
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens,
        }
        if json_output:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            response = self._get_client().chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Vision chat failed (model={model}): {e}")
            raise

    def chat_stream(
        self,
        prompt: str,
        *,
        size: ModelSize | Literal["mini", "normal"] = ModelSize.MINI,
        system_prompt: str | None = None,
        max_tokens: int = 1000,
    ) -> Iterator[str]:
        if isinstance(size, str):
            size = ModelSize(size)

        model = self._model_for(size)
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            response = self._get_client().chat.completions.create(
                model=model, messages=messages,
                max_tokens=max_tokens, stream=True,
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
        """Stream chat and yield complete lines (for line-delimited JSON)."""
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
        if buffer.strip():
            yield buffer.strip()

    def get_embedding(self, text: str) -> list[float]:
        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars]
        try:
            response = self._get_client().embeddings.create(
                model=self.config.ai_gateway_embedding,
                input=text,
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Failed to get embedding: {e}")
            return [0.0] * EMBEDDING_DIMENSION

    def get_embeddings_batch(self, texts: list[str]) -> list[list[float]]:
        max_chars = 8000
        truncated = [t[:max_chars] if len(t) > max_chars else t for t in texts]
        try:
            response = self._get_client().embeddings.create(
                model=self.config.ai_gateway_embedding,
                input=truncated,
            )
            return [item.embedding for item in response.data]
        except Exception as e:
            logger.error(f"Failed to get batch embeddings: {e}")
            return [[0.0] * EMBEDDING_DIMENSION for _ in texts]

