"""
LLM Service for AI operations.

Uses WorkspaceClient.serving_endpoints.get_open_ai_client() for auth —
handles PAT, OAuth, and App service principal automatically.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from enum import Enum
from typing import Any, Literal

from databricks.sdk import WorkspaceClient

from ..core._config import AppConfig
from ..models import EventSeverity, EventType
from . import event_logger

logger = logging.getLogger(__name__)


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

        start = time.perf_counter()
        try:
            response = self._get_client().chat.completions.create(**kwargs)
            duration_ms = int((time.perf_counter() - start) * 1000)
            content = response.choices[0].message.content
            usage = getattr(response, "usage", None)
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.INFO,
                duration_ms=duration_ms,
                metadata={
                    "kind": "chat",
                    "model": model,
                    "size": size.value,
                    "json_output": json_output,
                    "max_tokens": max_tokens,
                    "prompt_chars": len(prompt),
                    "response_chars": len(content) if content else 0,
                    "prompt_tokens": getattr(usage, "prompt_tokens", None),
                    "completion_tokens": getattr(usage, "completion_tokens", None),
                },
            )
            return content
        except Exception as e:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.error(f"Chat completion failed (model={model}): {e}")
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.ERROR,
                duration_ms=duration_ms,
                error=e,
                metadata={"kind": "chat", "model": model, "size": size.value},
            )
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
        return json.loads(response)

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

        start = time.perf_counter()
        total_chars = 0
        try:
            response = self._get_client().chat.completions.create(
                model=model, messages=messages,
                max_tokens=max_tokens, stream=True,
            )
            for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    total_chars += len(delta)
                    yield delta
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.INFO,
                duration_ms=int((time.perf_counter() - start) * 1000),
                metadata={
                    "kind": "chat_stream",
                    "model": model,
                    "size": size.value,
                    "max_tokens": max_tokens,
                    "prompt_chars": len(prompt),
                    "response_chars": total_chars,
                },
            )
        except Exception as e:
            logger.error(f"Chat stream failed (model={model}): {e}")
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.ERROR,
                duration_ms=int((time.perf_counter() - start) * 1000),
                error=e,
                metadata={"kind": "chat_stream", "model": model, "size": size.value},
            )
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
        model = self.config.ai_gateway_embedding
        start = time.perf_counter()
        try:
            response = self._get_client().embeddings.create(
                model=model,
                input=text,
            )
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.INFO,
                duration_ms=int((time.perf_counter() - start) * 1000),
                metadata={"kind": "embedding", "model": model, "input_chars": len(text)},
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Failed to get embedding: {e}")
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.ERROR,
                duration_ms=int((time.perf_counter() - start) * 1000),
                error=e,
                metadata={"kind": "embedding", "model": model},
            )
            return [0.0] * EMBEDDING_DIMENSION

    def get_embeddings_batch(self, texts: list[str]) -> list[list[float]]:
        max_chars = 8000
        truncated = [t[:max_chars] if len(t) > max_chars else t for t in texts]
        model = self.config.ai_gateway_embedding
        start = time.perf_counter()
        try:
            response = self._get_client().embeddings.create(
                model=model,
                input=truncated,
            )
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.INFO,
                duration_ms=int((time.perf_counter() - start) * 1000),
                metadata={
                    "kind": "embedding_batch",
                    "model": model,
                    "batch_size": len(texts),
                    "total_chars": sum(len(t) for t in truncated),
                },
            )
            return [item.embedding for item in response.data]
        except Exception as e:
            logger.error(f"Failed to get batch embeddings: {e}")
            event_logger.log_event_sync(
                event_type=EventType.LLM_CALL,
                severity=EventSeverity.ERROR,
                duration_ms=int((time.perf_counter() - start) * 1000),
                error=e,
                metadata={"kind": "embedding_batch", "model": model, "batch_size": len(texts)},
            )
            return [[0.0] * EMBEDDING_DIMENSION for _ in texts]

