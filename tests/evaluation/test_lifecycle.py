from __future__ import annotations

import asyncio

import pytest

from evaluation.lifecycle import run_with_lifecycle
from evaluation.live import LiveNamespace


@pytest.mark.parametrize("failure", [None, RuntimeError("boom")])
async def test_cleanup_runs_on_success_and_exception(failure: Exception | None) -> None:
    events: list[str] = []

    async def setup(context):
        events.append("setup")
        return {"ready": True}

    async def operation(context, setup_output):
        events.append("operation")
        if failure:
            raise failure
        return "ok"

    async def cleanup(context, setup_output):
        events.append("cleanup")

    if failure:
        with pytest.raises(RuntimeError, match="boom"):
            await run_with_lifecycle(
                context={}, setup=setup, operation=operation, cleanup=cleanup
            )
    else:
        assert (
            await run_with_lifecycle(
                context={}, setup=setup, operation=operation, cleanup=cleanup
            )
            == "ok"
        )
    assert events == ["setup", "operation", "cleanup"]


async def test_cleanup_runs_on_timeout() -> None:
    cleaned = asyncio.Event()

    async def operation(context, setup_output):
        await asyncio.sleep(10)

    async def cleanup(context, setup_output):
        cleaned.set()

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(
            run_with_lifecycle(
                context={}, setup=lambda _: None, operation=operation, cleanup=cleanup
            ),
            timeout=0.01,
        )
    assert cleaned.is_set()


async def test_cleanup_runs_on_cancellation() -> None:
    cleaned = asyncio.Event()

    async def operation(context, setup_output):
        await asyncio.sleep(10)

    async def cleanup(context, setup_output):
        cleaned.set()

    task = asyncio.create_task(
        run_with_lifecycle(
            context={}, setup=lambda _: None, operation=operation, cleanup=cleanup
        )
    )
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set()


def test_with_without_namespaces_are_distinct() -> None:
    with_side = LiveNamespace.allocate(
        run_id="run-1", case_id="case-1", side="with", evaluation_prefix="sb_eval_"
    )
    without_side = LiveNamespace.allocate(
        run_id="run-1", case_id="case-1", side="without", evaluation_prefix="sb_eval_"
    )
    assert with_side.catalog != without_side.catalog
    assert with_side.schema != without_side.schema
    assert with_side.resource_prefix != without_side.resource_prefix
