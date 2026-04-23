# Preview module

Self-contained feature for running a project's generated app (`<project>/app/`) as a
subprocess and rendering it inside the project page via a reverse proxy.

This module is designed to be **isolated** — deleting it should not affect any other
feature in the codebase.

## To remove this feature

1. Delete this directory (`backend/preview/`).
2. Remove the registration line from `backend/router.py`:
   ```python
   from .preview import register_routes as _register_preview_routes
   _register_preview_routes(router, get_project_dir=...)
   ```
3. Delete `ui/preview/` and remove the `<AppPreviewTab />` usage from the project page.

No other code depends on this module.

## How it works

- **Backend owns lifecycle**: `POST /api/preview/{id}/start` spawns `./start.sh` as a
  subprocess (in its own process group). `stop`/`restart` routes kill it cleanly.
- **In-memory registry**: `project_id → PreviewState` (port, PID, status, log ring buffer).
  Not persisted — FastAPI restart clears it.
- **SSE log stream**: `/api/preview/{id}/events?since=N` pushes state + log lines as they
  arrive; clients resume from a cursor on reconnect.
- **HTTP+SSE proxy**: `/preview/{id}/{path}` forwards to `localhost:<port>` — the iframe
  in the UI points here.
- **Idle auto-stop**: if no proxied request or UI ping reaches the backend for 5 minutes
  the app is stopped. Concurrency cap: 10 apps simultaneously.

## Contract

The module requires the caller to provide `get_project_dir(project_id) → Path` at
registration time — it does not import the project schema directly, so it stays
decoupled from the rest of the app.

Each project is expected to have `./app/start.sh` at `<project_dir>/app/start.sh`.
If it's missing, the preview module returns a `not_ready` state and the UI shows an
overlay asking the user to generate the app first.

## Agent rule

The AI agent that generates demos **must never** run `./start.sh` itself. Only the UI
(via this module) owns the lifecycle. This is documented in `SKILL.md` and `app.md`.
