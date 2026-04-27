"""Async HTTP client for the demo-prompt-generator backend.

Thin wrapper over httpx.AsyncClient. Only the endpoints the pipeline harness
needs. SSE consumption handles the server's 50-second reconnect cursor
(see backend/routes/agent.py — SSE_WINDOW_SECONDS).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator

import httpx

API_PREFIX = "/api"


@dataclass
class StreamOutcome:
    events: list[dict[str, Any]]
    is_error: bool
    is_cancelled: bool


class AppClient:
    def __init__(self, base_url: str, timeout: float = 30.0):
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base,
            timeout=httpx.Timeout(timeout, read=timeout),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AppClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def health_ok(self) -> bool:
        try:
            r = await self._client.get("/", timeout=5.0)
            return r.status_code < 500
        except httpx.HTTPError:
            return False

    async def create_project(
        self,
        description: str,
        capabilities: list[str],
        initial_prompt: str | None = None,
    ) -> dict[str, Any]:
        body = {
            "description": description,
            "capabilities": capabilities,
        }
        if initial_prompt is not None:
            body["initial_prompt"] = initial_prompt
        r = await self._client.post(f"{API_PREFIX}/projects", json=body, timeout=120.0)
        r.raise_for_status()
        return r.json()

    async def get_project(self, project_id: str) -> dict[str, Any]:
        r = await self._client.get(f"{API_PREFIX}/projects/{project_id}")
        r.raise_for_status()
        return r.json()

    async def list_files(self, project_id: str) -> list[dict[str, Any]]:
        r = await self._client.get(f"{API_PREFIX}/projects/{project_id}/files")
        r.raise_for_status()
        return r.json()

    async def get_file(self, project_id: str, file_path: str) -> dict[str, Any]:
        r = await self._client.get(
            f"{API_PREFIX}/projects/{project_id}/files/{file_path}"
        )
        r.raise_for_status()
        return r.json()

    async def list_messages(self, project_id: str, limit: int = 200) -> list[dict[str, Any]]:
        r = await self._client.get(
            f"{API_PREFIX}/projects/{project_id}/messages",
            params={"limit": limit},
        )
        r.raise_for_status()
        return r.json()

    async def invoke_agent(self, project_id: str, message: str) -> str:
        r = await self._client.post(
            f"{API_PREFIX}/invoke_agent",
            json={"project_id": project_id, "message": message},
            timeout=60.0,
        )
        r.raise_for_status()
        return r.json()["execution_id"]

    async def stop_stream(self, execution_id: str) -> None:
        try:
            await self._client.post(f"{API_PREFIX}/stop_stream/{execution_id}", timeout=10.0)
        except httpx.HTTPError:
            pass

    async def stream_until_done(
        self,
        execution_id: str,
        overall_timeout: float,
    ) -> StreamOutcome:
        """Consume the SSE stream until completion, transparently handling
        the server's periodic reconnect cursor."""
        events: list[dict[str, Any]] = []
        cursor = 0.0
        is_error = False
        is_cancelled = False

        # Use a longer timeout per-window than the server's 50s SSE_WINDOW_SECONDS
        # so we never time out mid-window.
        async with httpx.AsyncClient(
            base_url=self._base,
            timeout=httpx.Timeout(overall_timeout, read=70.0),
        ) as sse:
            while True:
                terminal, cursor, err, cancelled = await self._consume_one_window(
                    sse, execution_id, cursor, events
                )
                is_error = is_error or err
                is_cancelled = is_cancelled or cancelled
                if terminal:
                    break

        return StreamOutcome(events=events, is_error=is_error, is_cancelled=is_cancelled)

    async def _consume_one_window(
        self,
        sse: httpx.AsyncClient,
        execution_id: str,
        cursor: float,
        events: list[dict[str, Any]],
    ) -> tuple[bool, float, bool, bool]:
        """Consume one SSE window. Returns (terminal, new_cursor, is_error, is_cancelled).

        terminal=True means the stream is fully done (completed/cancelled/errored).
        terminal=False with new_cursor means the server requested reconnect.
        """
        async with sse.stream(
            "POST",
            f"{API_PREFIX}/stream_progress/{execution_id}",
            json={"last_timestamp": cursor},
        ) as resp:
            resp.raise_for_status()
            async for evt in _iter_sse_events(resp):
                if evt is None:  # [DONE] sentinel
                    return (True, cursor, False, False)

                etype = evt.get("type")
                if etype == "stream.reconnect":
                    new_cursor = float(evt.get("last_timestamp", cursor))
                    return (False, new_cursor, False, False)
                if etype == "stream.completed":
                    return (
                        True,
                        cursor,
                        bool(evt.get("is_error")),
                        bool(evt.get("is_cancelled")),
                    )

                events.append(evt)
                # Best-effort cursor advance — server keys events by float ts
                ts = evt.get("timestamp")
                if isinstance(ts, (int, float)):
                    cursor = max(cursor, float(ts))

        # Stream closed without [DONE] or completion event — treat as terminal error
        return (True, cursor, True, False)


async def _iter_sse_events(resp: httpx.Response) -> AsyncIterator[dict | None]:
    """Yield decoded JSON event payloads from an SSE response.

    Yields None to signal the [DONE] sentinel.
    """
    buf = ""
    async for chunk in resp.aiter_text():
        buf += chunk
        while "\n\n" in buf:
            raw, buf = buf.split("\n\n", 1)
            for line in raw.splitlines():
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if payload == "[DONE]":
                    yield None
                    return
                if not payload:
                    continue
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    continue
