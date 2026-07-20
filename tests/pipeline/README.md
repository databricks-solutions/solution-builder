# Pipeline E2E test harness

A pre-PR smoke gate. Spins up the backend, drives **N projects in parallel**
through the full agent pipeline (`DRAFTING → SUMMARIZED → ARCHITECTED →
SPECIFICATION → BUILT`), then writes per-scenario artifacts and a top-level
`summary.md` you can read after walking away for an hour.

The harness hits the **real** Databricks Foundation Model API. Mocking is
intentionally not provided — that would defeat the point of an E2E gate.
You'll spend FMAPI tokens. Plan for ~45–60 min per full run.

## Run

```bash
tests/pipeline/run.sh                              # all 4 scenarios, target=BUILT
tests/pipeline/run.sh --scenario healthcare       # single scenario
tests/pipeline/run.sh --target SPECIFICATION      # cheaper (~15 min)
tests/pipeline/run.sh --scenario-timeout 1800     # 30 min/scenario cap

# Pass extra flags through to pytest:
tests/pipeline/run.sh -- -s -v
```

If `:9000` isn't already up, `run.sh` boots a uvicorn server in the background
(logs to `test-runs/.last-backend.log`) and tears it down on exit.

## Output

```
test-runs/2026-04-27T14-23-00/
├── summary.md            <- read this first
├── summary.json
├── financial-services/
│   ├── README.md         <- per-scenario human summary
│   ├── result.json
│   ├── project.json
│   ├── files-index.json
│   ├── files/            <- full file tree dumped from the project
│   ├── messages.jsonl
│   └── execution-events.jsonl
├── healthcare/...
└── retail/...
```

`test-runs/` is gitignored. Each run creates a new timestamped directory; nothing
is overwritten.

## What "pass" means

A scenario passes iff:
- final stage ≥ target stage (default `BUILT`),
- no message has `is_error == true`,
- the artifacts the target stage requires are actually present
  (`README.md` for `SUMMARIZED`, `specifications/*.md` for `SPECIFICATION`,
  `.py`/`.sql` + `resources.json` for `BUILT`, `databricks.yml` for `BUNDLED`),
- no fatal exception escaped the runner.

Otherwise FAIL — the per-scenario `README.md` lists every issue.

## Add a scenario

Add and validate a canonical case under `evaluation/cases/`:

```bash
uv run sb-eval cases validate
```

Capability slugs must match the demo-generator capability blocks. The pipeline
harness loads this versioned YAML, so a new case runs in parallel without a
second hardcoded definition.

## Files

| File | Purpose |
|---|---|
| `run.sh` | Bootstrap: ensure backend, run pytest, surface summary path. |
| `test_pipeline.py` | Pytest entry. Fans out scenarios via `asyncio.gather`. |
| `runner.py` | `drive_project()`: create → invoke per turn → snapshot. |
| `scenarios.py` | Compatibility loader for canonical `evaluation/cases/*.yaml`. |
| `assertions.py` | Pure pass/fail helpers (stage, errors, artifacts). |
| `api_client.py` | `httpx.AsyncClient` wrapper + SSE consumer with reconnect. |
| `conftest.py` | Pytest fixtures: scenario selection, output dir, health check. |

## Why one process / one event loop

The backend's `ClientPool` (`backend/services/active_stream.py`) is keyed by
`project_id` — different projects do not contend. So fanning out via
`asyncio.gather()` inside one pytest process is the simplest correct setup.
Pytest-xdist would give us multiple processes against one backend — same end
result with worse debuggability.
