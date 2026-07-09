# Authentication & Identity Model

This app runs in two fundamentally different identity contexts. The same
codebase serves both — but the auth model is not the same. Understand
which mode you're in before reading any auth code; the logic only makes
sense in context.

All auth/identity logic is centralized in `backend/core/auth.py`. Routes,
services, and spawn code call that module — they never duplicate the
detection or resolution logic.

## The two modes

### Local mode (Electron / dev server on a laptop)

- Single user per install. The person sitting at the laptop.
- No external identity system. The app cannot know who "you" are.
- First-run `/setup` flow: user picks a profile from `~/.databrickscfg`
  and the choice is stored in the `users` table. That row is "the user"
  forever (until `/setup` is redone).
- Token refresh for Databricks CLI / SDK is handled by the CLI itself
  via its OAuth cache at `~/.config/databricks/token-cache.json`. The
  app never sees, stores, or refreshes a token.

### Deployed mode (running as a Databricks App)

- Multi-user. Any number of concurrent users, each in their own identity
  context. Alice and Bob hit the same deployment at the same time.
- Identity arrives with every HTTP request. The Databricks Apps runtime
  proxy sets headers:
  - `x-forwarded-email`  → user's email
  - `x-forwarded-access-token` → user's PAT, short-lived (~1h)
- No `users` table involvement. No `/setup` route. No profile picker.
  The header IS the identity; the PAT IS the auth.
- Token refresh for subprocesses: handled by the app writing a
  per-project `.databrickscfg` on every request (the user keeps their
  tab open → token stays fresh). Stale token → next CLI call 401s and
  the current turn fails loudly; user re-opens tab and retries.

## Detecting mode

Single rule, centralized in one place:

    mode = "deployed" if x-forwarded-access-token in request headers
           else "local"

Never infer mode from anything else. Env vars like `DATABRICKS_CLIENT_ID`
are a hint, but the header is the contract. One helper function owns
this check (`core.auth.detect_mode`); everything else calls it.

Dev override: `DEMO_PROMPT_GENERATOR_FORCE_MODE=deployed` fakes the
header behavior for local testing. Never used in production.

## `whoami` — unified identity service

All identity goes through one endpoint:

    GET /api/me → {
      email:              string | null,
      databricks_profile: string | null,  # null in deployed mode
      mode:               "local" | "deployed",
      is_configured:      boolean,
    }

Resolution (implemented in `core.auth.whoami`):

  Deployed: email from `x-forwarded-email`, profile=null,
            is_configured=true (always — nothing to configure).

  Local:    SELECT FROM users LIMIT 1.
            If present: email & profile from the row, is_configured=true.
            If absent:  all nulls, is_configured=false → UI routes to
                        /setup.

UI components that need identity call `/api/me`. Nothing else. The
legacy `current_user` field on `GET /api/config/status` is deprecated
for identity purposes — kept for backwards compat of the profile-list
flow, will be removed.

## Subprocess auth — how Claude Code & the preview app authenticate

Two subprocesses need to act as the user:
  - Claude Agent SDK (runs `databricks ...` CLI calls as part of the
    solution build)
  - The generated preview app (runs the user's generated Node server)

Both are spawned with environment variables that point at a Databricks
config source. Which source depends on mode — all of this is produced
by a single helper (`core.auth.subprocess_auth_env`).

### Local mode

  env = { DATABRICKS_CONFIG_PROFILE: <user.databricks_profile> }

Subprocess inherits the user's real `~/.databrickscfg`. Databricks CLI
reads the profile, uses its own OAuth cache, refreshes tokens on its
own. No file writes, no token handling in the app.

### Deployed mode

  env = {
    DATABRICKS_CONFIG_FILE:    <project_dir>/.databrickscfg,
    DATABRICKS_CONFIG_PROFILE: DEFAULT,
  }

Before each subprocess call, middleware atomically rewrites the
project's `.databrickscfg` from the current request's
`x-forwarded-access-token`. Subprocess always reads the freshest token.

One writer function (`core.auth.write_project_auth_file`), one middleware
hook, one contract. No tokens in environment variables — on-disk only,
mode 0600, atomic rename.

## The per-project `.databrickscfg` file (deployed mode only)

Lives at `<project_dir>/.databrickscfg`. Contains:

    [DEFAULT]
    host  = <workspace host>
    token = <user PAT from x-forwarded-access-token>

Rules:
  - Mode 0600. Written via tempfile+rename so readers never see a half-
    written file.
  - Rewritten via `make_project_auth_refresher(...)` — a FastAPI dependency
    attached to project-scoped routes:
      * Lifecycle hooks (preview start/restart, ping, invoke_agent) use
        the NON-debounced variant so the file is guaranteed fresh before
        any subprocess spawn or is refreshed at the client's natural ping
        cadence.
      * The preview iframe proxy uses the debounced variant (30s window),
        because the proxy fires on every static asset; without debouncing
        a single page load would write the file dozens of times.
  - Listed in the template's `.gitignore` and excluded from template
    publish. Never shipped with a shared artifact.
  - Deleted on project delete.
  - Never exists in local mode. If it's there in local mode, it's a bug —
    delete it.

### Identity guard — shared projects (viewers must NEVER write it)

A project has ONE owner (`Project.user_email`); others reach it through an
accepted `project_shares` row at role `viewer` (read-only) or `editor`. The
`.databrickscfg` holds whoever-wrote-it-last's PAT, and the agent's CLI runs
as that identity. So **only a caller with WRITE access (owner / admin / editor)
may write this file** — if a *viewer* wrote it, they'd stamp their PAT into the
owner's project dir and silently swap the CLI identity (the agent would then act
as the viewer). This is an identity-swap bug, and it's easy to introduce because
the write is tempting to do on read paths (opening a project, listing files).

Rules to keep it safe:
  - The write helper (`_ensure_project_databrickscfg`) takes `can_write` and
    **no-ops when false** — the guard lives at the source so every caller
    (current and future) is safe by default.
  - `list_project_files` resolves the caller's level via `_get_project_access`
    (non-raising) and passes `can_write = access != ACCESS_VIEWER`.
  - `invoke_agent` runs `_require_write_access` (403s viewers) BEFORE any disk
    mutation — including the auth-file write and the file-restore — so a viewer
    is rejected before their PAT can touch the project dir.
  - Any NEW route that writes the auth file must gate on write-access first.
    Read-level auth (`_get_authorized_project`, which allows viewers) is NOT
    sufficient to authorize a token write.
  - Concurrent editing is not supported: two writers racing on the same project
    thrash this file → the agent can switch identity mid-run. The share dialog
    warns on the `editor` role for this reason.

## Failure modes (deliberate)

- **No header, deployed mode**: should be impossible (Apps proxy always
  sets it). If it happens, log loud — someone bypassed the proxy. Treat
  request as unauthorized.

- **Stale PAT mid-turn, deployed mode**: next CLI call 401s. Turn fails
  with a clear error. User re-opens tab, token refreshes on next
  request, retries the turn. No silent retry, no catch-and-hide.

- **No user row, local mode**: `/api/me` returns `is_configured=false`.
  UI routes to `/setup`.

- **No profiles in `~/.databrickscfg`, local mode**: `/setup` shows an
  empty-list state with a hint: run `databricks auth login` first.

## The `/profile` page

Shown in both modes, contents differ:

Local:
  - User card: email + profile name (editable).
  - Databricks Connection card: profile dropdown (live from
    `~/.databrickscfg`), "Edit configuration" button opens picker.
  - Database status card.

Deployed:
  - User card: email (from header, read-only).
  - Databricks Connection card: profile field shown as
    `Managed by Databricks Apps` (muted, disabled). No edit button.
  - Database status card.

## Centralization contract

Anything auth/identity-related lives in `backend/core/auth.py`. If you
catch yourself writing one of these outside that module, stop and move
it:

- mode detection (header sniff, env override)
- whoami resolution
- subprocess env construction
- writing / deleting the per-project `.databrickscfg`
- reading the user PAT from request headers
- email extraction from request headers

Routes and services call thin helpers from `core.auth`. They never read
the headers or the DB for identity purposes themselves. This is the
rule that keeps the two-mode complexity from leaking everywhere.

## What to remove / deprecate

- `ConfigStatus.current_user` — replaced by `/api/me`. Keep for now to
  avoid breaking clients; delete after UI migration.
- The `UserMenu` fallback that renders `?` avatar when no user row
  exists — only needed in local mode pre-setup. In deployed mode the
  header guarantees we always have a name.
