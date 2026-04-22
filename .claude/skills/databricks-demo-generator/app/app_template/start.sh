#!/usr/bin/env bash
# Kill anything holding our dev ports / tsx / vite watchers, then `npm run dev`.
set -uo pipefail

cd "$(dirname "$0")"

APP_PORT="${DATABRICKS_APP_PORT:-8765}"
HMR_PORT=24678

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "${pids:-}" ]; then
    echo "[start.sh] killing pids on :$port → $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

kill_pattern() {
  local pattern="$1"
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [ -n "${pids:-}" ]; then
    echo "[start.sh] killing '$pattern' → $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

# Kill watchers first so they don't resurrect their children.
kill_pattern "tsx .*server/server.ts"
kill_pattern "node .*server/server.ts"
kill_pattern "vite"
kill_pattern "mas-chat-demo"

# Then free the ports (retry loop: watchers can exit noisily).
for _ in 1 2 3; do
  kill_port "$APP_PORT"
  kill_port "$HMR_PORT"
  sleep 0.4
  if ! lsof -ti:"$APP_PORT" >/dev/null 2>&1 && ! lsof -ti:"$HMR_PORT" >/dev/null 2>&1; then
    break
  fi
done

if lsof -ti:"$APP_PORT" >/dev/null 2>&1; then
  echo "[start.sh] ERROR: something still listening on :$APP_PORT:"
  lsof -i:"$APP_PORT" || true
  exit 1
fi

echo "[start.sh] ports clear — starting dev server"
exec npm run dev
