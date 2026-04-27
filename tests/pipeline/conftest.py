"""Pytest fixtures for the pipeline harness.

The harness deliberately avoids pytest-xdist and per-test backend isolation —
it runs all enabled scenarios inside one asyncio.gather() against one backend
on :9000. So we expose one session-scoped output_dir and a backend health
check, and that's it.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from .scenarios import SCENARIOS, get_scenarios


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = os.environ.get("PIPELINE_BASE_URL", "http://127.0.0.1:9000")
DEFAULT_TARGET = os.environ.get("PIPELINE_TARGET_STAGE", "BUILT")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--scenario",
        action="append",
        default=[],
        help="Run only this scenario slug (repeatable). Default: all.",
    )
    parser.addoption(
        "--target",
        default=None,
        help=(
            "Override every scenario's target_stage "
            "(SUMMARIZED|ARCHITECTED|SPECIFICATION|BUILT|BUNDLED). "
            "Defaults to each scenario's own target."
        ),
    )
    parser.addoption(
        "--scenario-timeout",
        type=int,
        default=None,
        help="Override per-scenario timeout in seconds (default: 3600).",
    )
    parser.addoption(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Backend base URL (default: %s)." % DEFAULT_BASE_URL,
    )


@pytest.fixture(scope="session")
def base_url(request: pytest.FixtureRequest) -> str:
    return request.config.getoption("--base-url")


@pytest.fixture(scope="session")
def selected_scenarios(request: pytest.FixtureRequest):
    slugs = request.config.getoption("--scenario") or None
    target_override = request.config.getoption("--target")
    timeout_override = request.config.getoption("--scenario-timeout")
    scenarios = get_scenarios(slugs)
    if target_override:
        for s in scenarios:
            s.target_stage = target_override
    if timeout_override:
        for s in scenarios:
            s.timeout_seconds = timeout_override
    return scenarios


@pytest.fixture(scope="session")
def output_dir() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    out = REPO_ROOT / "test-runs" / stamp
    out.mkdir(parents=True, exist_ok=True)
    return out


@pytest.fixture(scope="session", autouse=True)
def backend_must_be_up(base_url: str) -> None:
    """Fail fast with a clear message if :9000 isn't reachable."""
    deadline = time.monotonic() + 10.0
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            r = httpx.get(base_url, timeout=2.0, follow_redirects=True)
            if r.status_code < 500:
                return
        except httpx.HTTPError as e:
            last_err = e
        time.sleep(0.5)
    pytest.exit(
        f"backend not reachable at {base_url}. "
        f"start it with: `cd app && uv run uvicorn demo_prompt_generator.backend.app:app "
        f"--host 127.0.0.1 --port 9000` (last error: {last_err!r})",
        returncode=2,
    )


# Listing all SCENARIOS keeps `pytest --collect-only` informative without
# running anything.
KNOWN_SLUGS = [s.slug for s in SCENARIOS]
