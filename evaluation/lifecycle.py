"""Runner-neutral lifecycle primitive used by adapter and contract tests."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar


T = TypeVar("T")


async def _await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


async def run_with_lifecycle(
    *,
    context: dict[str, Any],
    setup: Callable[[dict[str, Any]], Any],
    operation: Callable[[dict[str, Any], Any], T | Awaitable[T]],
    cleanup: Callable[[dict[str, Any], Any], Any],
) -> T:
    """Run setup/operation/cleanup with cleanup guaranteed by ``finally``."""
    setup_output = await _await(setup(context))
    try:
        return await _await(operation(context, setup_output))
    finally:
        await _await(cleanup(context, setup_output))
