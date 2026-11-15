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
- **Deployed mode itself splits in two by WHERE the demo deploys:**
  *same-workspace* (the default — acts as the viewing user via OBO) vs
  *cross-workspace / remote target* (acts as the deployer service principal via
  oauth-m2m, because the user's host-workspace token isn't valid in the target).
  See "Deployed mode — two sub-cases" under Subprocess auth below; that split is
  the trickiest part of this doc.

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

### Deployed mode — two sub-cases (same-workspace OBO vs cross-workspace SP)

Deployed mode splits by WHERE the demo deploys — the same workspace that
hosts this generator app, or a *different* target workspace. The split is
decided by one predicate: `target_deploy_active(config, target_workspace_host)`
(True iff the project has a `target_workspace_host` AND a deployer SP is
configured). It is the SAME predicate on both the WRITE side (which file we
write) and every READ side (subprocess env, proxy token-strip), so the whole
preview agrees on one identity.

**(a) Same-workspace (classic OBO) — the default.**

  env = {
    DATABRICKS_CONFIG_FILE:    <project_dir>/.databrickscfg,   # holds the user PAT
    DATABRICKS_CONFIG_PROFILE: DEFAULT,
    DATABRICKS_AUTH_TYPE:      "pat",
    DATABRICKS_CLIENT_ID:      "",    # scrub the app SP the Apps runtime injects
    DATABRICKS_CLIENT_SECRET:  "",    # (so the SDK picks the PAT, not the app SP)
  }

Before each subprocess call, middleware atomically rewrites the project's
`.databrickscfg` from the current request's `x-forwarded-access-token`.
Subprocess always reads the freshest token → acts as the VIEWING USER.

**(b) Cross-workspace (remote target) — the deployer SP, oauth-m2m.**

The user's `x-forwarded-access-token` is minted by the HOST workspace and is
**not valid for the target workspace** — so OBO is impossible cross-workspace.
The only identity that can act in the target is the **deployer service
principal** (workspace-admin on every target by design). The per-project
`.databrickscfg` therefore holds the SP's OAuth-M2M creds (see
`write_project_sp_auth_file`), and the subprocess env is:

  env = {
    DATABRICKS_CONFIG_FILE:    <project_dir>/.databrickscfg,
    DATABRICKS_CONFIG_PROFILE: DEFAULT,
    DATABRICKS_AUTH_TYPE:      "oauth-m2m",
    DATABRICKS_HOST:           <TARGET workspace host>,   # overwrites the app's host
    DATABRICKS_CLIENT_ID:      <deployer SP client id>,   # overwrites the app SP
    DATABRICKS_CLIENT_SECRET:  <deployer SP secret>,
    DATABRICKS_TOKEN:          UNSET_ENV,                 # REMOVE the key — see below
  }

Why the explicit creds + host: the Databricks Apps runtime injects the APP's
own SP (`DATABRICKS_CLIENT_ID/SECRET`) + host into the parent env, and those
inherited env vars win over anything in a `DATABRICKS_CONFIG_FILE`. Without
overwriting them, the subprocess authenticates as the APP SP against the HOST
workspace — the historical bug where demo resources landed in the host,
owned by the app SP. Fails CLOSED (config-file pointer only, no creds) if the
SP cfg is unreadable, rather than silently deploying to the host.

**⚠️ DATABRICKS_TOKEN is REMOVED, not blanked — and this is the single most
subtle thing in the whole auth model.** The child spawns as
`{**os.environ, **extra}`; a `""` entry leaves the key PRESENT-but-empty. The
**Python** SDK/CLI (the agent) tolerates that under `auth_type=oauth-m2m`, but
the **Node** SDK inside the GENERATED APP (its Lakebase pool, warehouse, Genie,
serving, MLflow — all resolve creds from the env via `new WorkspaceClient({})`)
treats a present-but-empty `DATABRICKS_TOKEN` as "use PAT" → empty bearer →
`400 Invalid Token`. So we map the key to the `UNSET_ENV` **removal sentinel**
and merge via `build_subprocess_env(base, extra)` (NOT `{**base, **extra}`),
which DELETES the key. With the key absent + `DATABRICKS_AUTH_TYPE=oauth-m2m`
present, the Node SDK's default credential chain deterministically picks
oauth-m2m (it skips every provider whose name ≠ the configured `authType` —
see `@databricks/sdk-experimental` `DefaultCredentials`), so EVERY path in the
generated app authenticates as the SP with ZERO app-side auth logic.

**The two spawn sites and the sentinel:**
  - **Preview (Node child)** — `preview/process.py` spawns via
    `build_subprocess_env(os.environ, extra)` → the sentinel is HONORED, the
    inherited token is removed. This is what fixes the Node app.
  - **Agent (Python child)** — `services/agent.py` builds the Claude Agent SDK
    options env, which the SDK merges as `{**os.environ, **options.env}` with NO
    key-removal hook. So we DROP any `UNSET_ENV` entry there instead of passing
    it (a literal sentinel would land in the child). Harmless: the Python
    SDK/CLI ignores an inherited token under oauth-m2m.
  - **Invariant:** NEVER hand-roll `{**os.environ, **auth_env}`. Always merge an
    auth env through `build_subprocess_env` (or, for the SDK-merged agent path,
    drop the sentinel). One choke point; the debug-CLI endpoint follows it too.

The token file is refreshed by the same middleware refresher; for a
cross-workspace project it writes the SP file (a resolvable user host is
optional context, not required — see `write_project_databrickscfg`).

### The proxy token-strip (preview only) — why authHeaders stays dumb

In a cross-workspace PREVIEW, there is a second, independent trap. The Apps
proxy attaches the viewing user's `x-forwarded-access-token` to the request
that reaches THIS generator, and our reverse proxy (`preview/proxy.py`) would
forward it on to the child. The generated app's `authHeaders` uses a forwarded
token if present — so it would send a HOST-workspace token to a TARGET-workspace
endpoint → 401. The M2M creds in the child's env would never be consulted.

Fix at the BOUNDARY, not in the app: for a remote-target preview the proxy
STRIPS `x-forwarded-access-token` before forwarding (`strip_user_token`,
computed by `_is_remote_target(project_id, session, config)` — the same
`target_deploy_active` predicate). The child then falls through to the SP creds
in its env. This keeps the generated app's `server/lib/auth.ts` DUMB — OBO token
if present, else the SDK default chain — with **no** service-principal / oauth-m2m
special-casing in the template (an earlier fix pinned M2M in the app; it was
reverted). Same-workspace previews are unaffected: the predicate is False, the
token is forwarded, and the child correctly acts as the viewing user.

One writer function (`core.auth.write_project_auth_file` /
`write_project_sp_auth_file`), one middleware hook, one merge helper
(`build_subprocess_env`), one proxy predicate. Tokens are on-disk only
(mode 0600, atomic rename) in same-workspace mode; in cross-workspace mode the
SP creds ride in the env (they're not a user secret — they're the deployer SP).

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
      * Lifecycle hooks (preview start/restart, invoke_agent) use the
        NON-debounced variant so the file is guaranteed fresh before any
        subprocess spawn.
      * The preview iframe proxy and the preview ping use the debounced
        variant (30s window): the proxy fires on every static asset, and
        without debouncing a single page load would write the file dozens
        of times. The debounce check runs BEFORE the DB access check, keyed
        on (project_id, caller email, token prefix), and a key is stamped
        only after the caller passed the access check, so a hit never lets
        an unauthorized caller or a different user through.
  - Deployer-SP credentials (a written cfg, a subprocess env, a
    WorkspaceClient) are only ever produced for a host that passes
    `remote_deploy.probe.validate_target_host` (a Databricks workspace
    domain). Any other host gets nothing: the SDK would send the client
    secret to it.
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
  - Concurrent editing is not truly simultaneous — see the conversation-driver
    model below, which makes the single-writer constraint explicit and safe.

### SP mode disables the driver model entirely

The whole conversation-driver machinery below exists **only to manage a per-user
OBO PAT** (one file, one identity, refreshed per request, expiring in ~60min). It
does not apply when a project authenticates as the **deployer service principal**
(oauth-m2m) instead of a user token — i.e. a cross-workspace/remote-target
project (`target_deploy_active` True). There is exactly one non-expiring machine
identity there and nothing to "take over".

One predicate gates the bypass: **`core.auth.project_runs_as_sp(config, project)`**
(a thin wrapper over `target_deploy_active(config, project.target_workspace_host)`).
When it's True:

- `invoke_agent`'s `_driver_gate_and_token` takes an **SP branch first**: it just
  (re)writes the SP `.databrickscfg` (via `write_project_databrickscfg`'s
  cross-workspace branch) and stamps `active_driver_email = SP_DRIVER_SENTINEL`
  (`"remote_sp"`) — **no** `claim_driver`, **no** token-freshness 409, **no**
  handoff-notice. It also clears any stale `driver_handoff_pending` from a prior
  OBO life.
- `take_over_project` is a **no-op** (returns the project unchanged) — there's no
  driver to take over.
- `driver-status` + every `ProjectOut` report **`is_sp_mode: true`**; `is_driver`
  is simply "am I a writer". The frontend hides the take-over banner and never
  gates sending on token freshness (any writer may always send).

`SP_DRIVER_SENTINEL` keeps `active_driver_email` meaningful/queryable (it's not a
human email, it's the SP) without ever gating anything. When the deployer SP is
not configured at all (`config.cross_workspace_deploy_enabled` False), no project
is ever SP-mode and the OBO driver model below is byte-identical to before.

### Conversation driver — the single-writer model (editable shares, OBO only)

> **OBO mode only.** In SP mode the entire section below is bypassed — see "SP
> mode disables the driver model" just above.

Because `.databrickscfg` is per-PROJECT (one file, one identity) but a project
can have multiple editors, we enforce **one active driver** per project —
`Project.active_driver_email`, the user whose PAT the file holds and whose
identity the agent's CLI uses.

- **Sticky:** starts NULL (unclaimed). The first sender (normally the owner)
  claims it on their first `invoke_agent`; it then stays that person even when
  idle, until an explicit take-over. Never cleared on completion.
- **Only the driver writes the token.** Helpers `is_driver` / `claim_driver` /
  `active_driver` (`routes/projects.py`) gate **every** `.databrickscfg` write:
  `invoke_agent`, `list_project_files` (`_ensure_project_databrickscfg`), and the
  preview refresher (`make_project_auth_refresher`). A non-driver — even a
  write-access editor — never refreshes the token, so they can't stomp the
  current driver's identity.
- **Atomicity:** in `invoke_agent` the is_driver-check → claim → token-write runs
  INSIDE the per-project `get_project_lock` (with the stream-dedupe), so two
  editors racing the first send on an unclaimed project can't both claim + both
  write. `take_over_project` takes the SAME lock and re-checks "run in progress"
  inside it, so a take-over can't swap the token out from under a starting run.
  (NOTE: the lock is a per-PROCESS `asyncio.Lock`; prod runs `--workers 1`, so
  it's sufficient. If workers ever increase, make the first claim an atomic
  conditional `UPDATE … WHERE active_driver_email IS NULL`.)
- **Token freshness — a non-driver CAN run while the driver's token is fresh.**
  The forwarded PAT lives ~60min; `Project.active_driver_token_refreshed_at`
  records when the driver last wrote it (stamped by `claim_driver`, called on
  every driver token write: invoke, file-open, preview). A NON-driver's
  `invoke_agent` is **allowed** while that token is < `DRIVER_TOKEN_MAX_AGE`
  (50min) old — it runs on the driver's existing token WITHOUT writing the
  non-driver's PAT or claiming (only the driver's browser can mint a new token).
  Once the token is **stale** (> 50min), the non-driver is **blocked** with a
  409 + saved message ("<x>'s token expired — ask them to refresh, or take
  over"), because nobody but the driver can refresh it and a run would 401
  mid-way. `GET /projects/{id}/driver-status` is a light poll the non-driver's
  chat uses to track the age live (the banner flips fresh→expired without a
  reload).
- **Take-over** (`POST /projects/{id}/take-over`): owner/admin/editor only
  (viewers 403); **409 while a run is in progress**; otherwise claims the driver,
  refreshes the token to the caller, and inserts a `role="system"` handoff
  message. Keeps the same conversation/session.
- **PREVIEW runs as the DRIVER, not the viewer.** Since the preview refresher is
  driver-gated too, a non-driver editor who opens the Preview tab does NOT
  refresh the token — the preview app runs against the driver's `.databrickscfg`.
  This is intentional: preview shares the project's single identity. A non-driver
  viewing a preview sees data as the driver; if they need their own identity they
  take over (or clone). Don't "fix" this by ungating the preview refresher — that
  reintroduces the token thrash.
- **Loose ends (deferred):** the driver is not auto-released when a share is
  revoked (owner must take over); there's no live push of driver changes to idle
  tabs (the 409-on-send is the safety net).

## Boot-time resume of interrupted conversations (SP mode only)

A hard crash (SIGKILL / OOM) can leave a project mid-turn:
`Project.active_execution_id` is still set and the last `Message` is the user's,
with no assistant reply. On boot the app scans for exactly that and re-kicks the
agent so the conversation continues on its own (`services/resume_agent`, launched
fire-and-forget from the lifespan after migrations).

A **graceful** SIGTERM redeploy usually does NOT leave this state: the eager-cancel
handler cancels the turn's task, `run_agent_turn` catches the `CancelledError` and
falls through to its completion step (`_persist_completion`), which clears
`active_execution_id`. That completion is NOT in a `finally`, though — if the
~15s SIGKILL deadline interrupts the cancel-then-persist, the flag can survive,
and the boot scan then correctly picks it up as interrupted. Either way the flag
is a reliable "needs attention" signal; the resume scan (below) is the backstop.

**Why SP-only — this is an auth constraint.** A boot resume runs with **no HTTP
request → no user identity → no OBO PAT**. A user's forwarded token is long dead
by boot, so an OBO project simply **cannot** be resumed unattended — it resumes
the normal way when the owner reopens the tab (their live token). But an SP-mode
project authenticates as the deployer SP, whose oauth-m2m creds are **always
present in the container env**, so the agent can run with no user present. Hence
resume is gated on `project_runs_as_sp` (and no-ops entirely unless
`config.cross_workspace_deploy_enabled`). This is the same reason the driver model
is bypassed in SP mode (above): SP identity is ambient and non-expiring.

**Auth setup on resume mirrors `invoke_agent` exactly.** Before running the turn,
the resume task writes the SP `.databrickscfg` (`write_project_databrickscfg` →
the cross-workspace branch, `user_pat=None`) **and** `ensure_fmapi_auth_files`, so
the agent's `databricks` CLI (oauth-m2m) and Claude (FMAPI via the project's
`.claude/settings.json`, kept fresh by the lifespan token refresher) both
authenticate — no request, no headers needed. It also `restore_project_from_db`s
first so files + the `.claude/projects/**` transcript are on disk for
`session_id` resume.

**Selection is conservative** (belt + suspenders against a false positive from the
rare case where `_persist_completion` itself failed): resume iff
`active_execution_id` set **AND** `project_runs_as_sp` **AND** the latest Message
is `role="user"` **AND** no live in-memory stream. A visible `role="system"`
notice is persisted so the interruption is transparent in the chat.

**Crash-loop guard.** `Project.resume_attempts` (migration `v20`) is incremented
per auto-resume and reset to 0 on a clean turn completion (`run_agent_turn`). Once
it hits `RESUME_MAX_ATTEMPTS` (3), the scan stops resuming that project and leaves
it interrupted for a human — a turn that reliably crashes the app can't
resume-crash-loop across deploys. **Escape hatch:** set
`DISABLE_CONVERSATION_RESUME=1` to bring the app up without resuming anything (for
a clean restart when a conversation is bugged).

Single replica (`--workers 1`) → no cross-replica double-fire. The runner itself
is the shared `routes/agent.run_agent_turn` (the same background turn `invoke_agent`
uses — one persistence path, no drift), invoked with `mode="deployed"` +
`target_deploy=True`.

## Failure modes (deliberate)

- **No header, deployed mode**: should be impossible (Apps proxy always
  sets it). If it happens, log loud — someone bypassed the proxy. Treat
  request as unauthorized.

- **Stale PAT mid-turn, deployed mode**: next CLI call 401s. Turn fails
  with a clear error. User re-opens tab, token refreshes on next
  request, retries the turn. No silent retry, no catch-and-hide.

- **No user row, local mode**: `/api/me` returns `is_configured=false`.
  UI routes to `/setup`.

- **`400 Invalid Token` in a cross-workspace preview** (regression tripwire):
  the generated app's Databricks calls 400 while the AGENT works against the
  same target. Root cause is always one of the two cross-workspace traps above:
  (1) a present-but-empty `DATABRICKS_TOKEN` reached the Node child (someone
  hand-rolled `{**os.environ, **env}` instead of `build_subprocess_env`, or
  re-blanked the token to `""` instead of `UNSET_ENV`), or (2) the proxy failed
  to strip `x-forwarded-access-token` for the remote target (so the app used a
  host-ws token against the target). Both are regression-locked in
  `tests_backend/test_cross_workspace_auth.py`.

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
- subprocess env construction (`subprocess_auth_env`) + the env MERGE
  (`build_subprocess_env` — the only place the `UNSET_ENV` removal sentinel is
  honored; never hand-roll `{**os.environ, **auth_env}`)
- the cross-workspace predicate (`target_deploy_active`) — the one rule that
  decides same-workspace-OBO vs remote-target-SP, read by BOTH the write side
  (which .databrickscfg) and the preview proxy's token-strip
- writing / deleting the per-project `.databrickscfg` (`write_project_auth_file`
  for OBO, `write_project_sp_auth_file` for the deployer SP)
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
