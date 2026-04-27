#!/usr/bin/env bash
# Pre-PR end-to-end pipeline test runner.
#
# Boots a uvicorn backend on :9000 if one isn't already listening, runs the
# pytest harness under uv, and prints the path to the timestamped run output.
#
# Usage:
#   tests/pipeline/run.sh                              # all scenarios, target=BUILT
#   tests/pipeline/run.sh --scenario healthcare       # single scenario
#   tests/pipeline/run.sh --target SPECIFICATION      # cheaper run
#   tests/pipeline/run.sh --scenario-timeout 1800     # 30 min/scenario
#
# Forwards any other args directly to pytest after `--`:
#   tests/pipeline/run.sh -- -k healthcare -s

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$REPO_ROOT/app"
BASE_URL="${PIPELINE_BASE_URL:-http://127.0.0.1:9000}"

PYTEST_ARGS=()
HARNESS_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      PYTEST_ARGS+=("$@")
      break
      ;;
    --scenario|--target|--scenario-timeout|--base-url)
      HARNESS_ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      PYTEST_ARGS+=("$1")
      shift
      ;;
  esac
done

backend_up() {
  curl -sf -o /dev/null --max-time 2 "$BASE_URL/" 2>/dev/null
}

started_backend=0
backend_pid=""
if backend_up; then
  echo "[pipeline] reusing existing backend at $BASE_URL"
else
  echo "[pipeline] starting backend on $BASE_URL ..."
  cd "$APP_DIR"
  uv run uvicorn demo_prompt_generator.backend.app:app \
    --host 127.0.0.1 --port 9000 \
    > "$REPO_ROOT/test-runs/.last-backend.log" 2>&1 &
  backend_pid=$!
  started_backend=1
  cd "$REPO_ROOT"

  # Wait up to 60s for the server to come up.
  for _ in $(seq 1 60); do
    if backend_up; then break; fi
    sleep 1
  done
  if ! backend_up; then
    echo "[pipeline] backend failed to start; see test-runs/.last-backend.log" >&2
    [[ -n "$backend_pid" ]] && kill "$backend_pid" 2>/dev/null || true
    exit 2
  fi
fi

cleanup() {
  if [[ "$started_backend" -eq 1 && -n "$backend_pid" ]]; then
    echo "[pipeline] stopping backend (pid=$backend_pid)"
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$REPO_ROOT/test-runs"

echo "[pipeline] ensuring dev deps are synced ..."
cd "$APP_DIR"
uv sync --group dev --quiet

echo "[pipeline] running pytest ..."
set +e
uv run pytest "$REPO_ROOT/tests/pipeline/test_pipeline.py" \
    -v -s \
    ${HARNESS_ARGS[@]+"${HARNESS_ARGS[@]}"} \
    ${PYTEST_ARGS[@]+"${PYTEST_ARGS[@]}"}
status=$?
set -e

# Surface the latest run dir so the user can `open` it immediately.
latest="$(ls -1d "$REPO_ROOT"/test-runs/[0-9]* 2>/dev/null | sort | tail -1 || true)"
if [[ -n "$latest" ]]; then
  echo
  echo "[pipeline] summary: $latest/summary.md"
fi

exit $status
