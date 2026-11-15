# AGENTS.md — Industry Demo Prompt Generator

> **This file is your memory across sessions. Keep it accurate — updating it is part of the work, not an afterthought.**
> When a change lands that alters how the system is built, packaged, run, or deployed — a new top-level directory, a stack swap, a workflow shift, a renamed/moved key file, a new dev/build/deploy script, or a new *mode* of a subsystem (e.g. how a skill is packaged, how an artifact renders) — **update this file in the same change, before you consider the task done.** If you touched something described here and the description is now wrong, fix it. Better stale-in-one-place than spread-across-three-places. See "How to keep this file accurate" at the bottom for the exact triggers.

## What this project actually is

A **system that generates Databricks demos**. Not one app — **three**, plus a skill:

1. **Generator app** (`app/`) — the user-facing tool. FastAPI + React. A user opens it, picks an industry/capability, chats with a Claude Code agent (via `claude-agent-sdk`), and the agent assembles a personalized demo by reading **blocks** from the skill below. Generated artifacts (demo code, specs, app boilerplate, deployable Databricks assets) land in a per-project directory. The home page has **three entry modes** (a `mode` field on each project): *story* (describe it → agent builds every Databricks resource), *architecture* (draw the diagram first → generate from it), and *workshop* (agent writes a Genie Code workshop — one HTML page of prompts an attendee follows to build the solution live; the agent enters through SKILL.md flow B → `stages/genie-workshop.md` instead of the stages). The mode picks the agent's workflow; capability blocks carry a `genie_code_workshop` flag so the workshop tab hides what can't be built via Genie Code (apps, Lakebase, unstructured documents).

2. **Solution-builder skill** (`.claude/skills/databricks-solution-builder/`) — the agent's brain. SKILL.md + reference blocks + stage guides + the template app. The generator's agent reads from here. **The skill is the product; the generator is the UI.** (Formerly named `databricks-demo-generator` — renamed to `databricks-solution-builder`.)

3. **Template app** (`.claude/skills/databricks-solution-builder/app/app_template/`) — a complete Node.js + Express + React Databricks App that ships *as part of every generated demo*. The agent copies + customizes it. It is **NOT** a sub-component of the generator — it's an artifact the generator emits.

Plus: **Databricks Agent Skills (DAS)** — cloned into `app/databricks_agent_skill/` (dir name kept for path stability) from `github.com/databricks/databricks-agent-skills`, holding ~28 per-resource skills for creating individual Databricks resources (pipelines, dashboards, Genie agents, Lakebase, etc.). Skills live under `skills/*` (Genie = `skills/databricks-genie-agents`); the generator's agent uses these during the Build stage. `databricks-agent-bricks` (KA/MAS, deprecated) is excluded from projects via `skills_manager.EXCLUDE_SKILLS`. (Migrated from the retired `databricks-solutions/ai-dev-kit`.)

## Mental model

```
USER opens generator app (app/)
   ↓ chats with agent
AGENT reads .claude/skills/databricks-solution-builder/
   - SKILL.md → 4-stage workflow (Intent → Design → Spec → Build)
   - references/blocks/capabilities/*.md
   - stages/0X-*.md
   ↓
AGENT writes specs + scaffolds a Databricks App by copying app_template/
AGENT delegates resource creation to subagents using Databricks Agent Skills (DAS)
   ↓
ARTIFACTS land in:
   - per-project directory (specs, code)
   - the user's Databricks workspace (catalog, schema, pipeline, dashboard, app)
```

## Repository layout

```
solution-builder/
├── app/                                  # ★ Generator app (FastAPI + React)
│   ├── src/demo_prompt_generator/
│   │   ├── backend/                      # FastAPI
│   │   │   ├── app.py, router.py, models.py
│   │   │   ├── core/                     # app factory, config, DI, DB
│   │   │   ├── routes/                   # /api/* (agent, projects, messages, preview, …)
│   │   │   ├── services/
│   │   │   │   ├── agent.py              # ★ Wraps claude-agent-sdk + SSE streaming
│   │   │   │   └── skills_manager.py     # Copies skills into per-project .claude/
│   │   │   └── preview/                  # Subprocess runner that spawns generated app's start.sh
│   │   └── ui/                           # React 19 + TanStack Router + Tailwind v4
│   │       ├── routes/                   # project.$projectId.tsx is the workspace
│   │       ├── preview/                  # Preview iframe + log streaming UI
│   │       ├── lib/platform-architecture.ts  # ★ Arch-diagram CATALOG + flat-file parse/serialize + computeLayout (see below)
│   │       └── components/project/platform-diagram{.tsx,/}  # ★ ReactFlow arch-diagram editor (see below)
│   ├── databricks_agent_skill/                       # Cloned databricks-agent-skills repo (dir name kept; not a submodule)
│   │   └── skills/                       # ~30 per-resource skills (Genie lives in skills/databricks-genie-agents)
│   ├── databricks.yml                    # DAB config for the generator itself
│   ├── databricks.{prod,staging}.yml.example  # Deployment target templates: copy, fill in, deploy
│   ├── pyproject.toml                    # uv. claude-agent-sdk>=0.2.83
│   ├── package.json                      # bun. React 19, Vite, TanStack Router
│   └── scripts/{dev,build,release,build-electron}.sh + arch-skill build chain
│       # build-architecture-skill.sh, build-arch-standalone.sh, gen-architecture-skill.ts, render-arch*.mjs + browser-lifecycle.mjs
├── .claude/skills/databricks-solution-builder/   # ★ The skill (the brain)
│   ├── SKILL.md                          # 4-stage workflow
│   ├── stages/0X-*.md                    # Stage-specific guides
│   ├── references/
│   │   ├── blocks/capabilities/*.md   # Databricks capability know-how (one per feature)
│   │   ├── example-luxebeauty{,-simple}/  # Reference demos (full / simple) — example-luxebeauty-workshop/ is the workshop SOURCE (see below)
│   │   └── dab/                                  # DAB packaging guide
│   └── app/
│       ├── app.md                        # How to design+spec a demo app (read during Stage 2)
│       └── app_template/                 # ★ The template app emitted by the generator
├── .claude/skills/databricks-architecture/      # ★ The architecture-diagram skill (see "two modes" below)
│   ├── SKILL.md                          # lean core: kinds, design rules, fault table, format essentials, reference map
│   ├── reference/*.md                    # on-demand detail: styles, compose, format, containers, redraw, process flows, complex workflows, component-catalog (generated blocks)
│   ├── reference/*.jsonc                 # hand-authored example diagrams
│   └── renderer/                         # standalone viewer/editor HTML + render/check helpers (built from app code)
├── initial_templates/                    # Pre-built seed templates (27: AI/BI and full-stack demos). manifest.json + one dir each. See "Initial (seed) templates" below.
├── tests/                                # Playwright E2E for the generator (targets :9000)
├── install.sh                            # End-user installer — installs BOTH skills (solution-builder + architecture) + Databricks Agent Skills via the CLI
└── docs/                                 # Screenshots for README
```

★ = files you'll touch most.

## The agent loop (most important thing to know)

`app/src/demo_prompt_generator/backend/services/agent.py`:

- Wraps `claude-agent-sdk>=0.2.83` (Python). One `ClaudeSDKClient` per project, pooled.
- Streams via SSE: thinking blocks, text deltas, tool calls/results.
- Routes through Databricks Foundation Model API in prod (`ANTHROPIC_BASE_PATH`), direct Anthropic locally.
- The agent gets `CLAUDE_CONFIG_DIR=<project>/.claude` so it reads project-local skills (the solution-builder skill is copied into each project on creation by `skills_manager.py`).
- **The chat panel in the UI is the agent's mouth.** Reasoning/thinking blocks render there.
- **A turn does not end at the first `ResultMessage` if a background subagent is still running** (`_receive_with_background_tasks`): the stream keeps reading until each `task_started` (is_backgrounded, `local_agent`) has its `task_notification` and the CLI's follow-up turn ends (1 h cap). Stopping early let the idle reaper kill the subagent mid-build. Background Bash is not tracked (a dev server would hold the turn forever).

## Auth & identity — READ `backend/AUTH.md` FIRST

> **⚠️ Any time you touch auth, tokens, identity, `.databrickscfg`, subprocess
> env, OBO vs SP, or cross-workspace/remote-target deploys — read
> `app/src/demo_prompt_generator/backend/AUTH.md` before changing code.** It is
> the authoritative, detailed model; this is tricky and easy to break subtly.
> All auth logic is centralized in `backend/core/auth.py` — routes/services call
> thin helpers, never re-implement detection/resolution.

The 60-second mental model (full detail in AUTH.md):

- **Three identity contexts:** *local* (user's `~/.databrickscfg` profile);
  *deployed same-workspace* → **OBO the viewing user** (`x-forwarded-access-token`);
  *deployed cross-workspace / remote target* → the **deployer service principal**
  via oauth-m2m (the user's host-ws token isn't valid in the target, so OBO is
  impossible there).
- **The split predicate:** `target_deploy_active(config, target_workspace_host)`
  — read by BOTH the write side (which `.databrickscfg`) and the preview proxy's
  token-strip, so the whole preview agrees on one identity.
- **The subtle trap (cross-workspace):** the child inherits the parent env, so
  the SP path (1) **removes** `DATABRICKS_TOKEN` (maps it to the `UNSET_ENV`
  sentinel — a present-but-empty `""` makes the Node SDK try an empty PAT → `400
  Invalid Token`) and (2) overwrites `DATABRICKS_HOST`/`CLIENT_ID`/`SECRET` with
  the deployer SP's. **Never hand-roll `{**os.environ, **auth_env}` — always
  merge via `build_subprocess_env` so the removal sentinel is honored.** And for
  a remote-target PREVIEW, the proxy strips `x-forwarded-access-token` so the
  child falls through to the SP creds — keeping the generated app's
  `server/lib/auth.ts` **dumb** (no SP special-casing in the template).

## Reapers / background sweeps (memory + disk reclamation)

Four periodic sweeps keep resource use bounded. The three that need the DB engine /
stream manager live in **`backend/core/reapers.py`** (the single home) and are
started/stopped by `start_reapers(app)` / `stop_reapers(app)` from the **Lakebase
lifespan** (where the engine + `file_sync` are up). The preview-apps idle sweep is
wired separately in `app.py` (needs no DB).

| Sweep | Where started | Cadence | What it reclaims |
|---|---|---|---|
| **Agent-session reaper** | `reapers.py` ← Lakebase lifespan | 5 min (`CLIENT_IDLE_TIMEOUT`) | Disconnects idle `ClaudeSDKClient` Node subprocesses (`ClientPool.reap_idle()`); also `sweep_expired()`s terminal `ActiveStream`s so `_streams` stays bounded. |
| **Project-file cleanup** | `reapers.py` ← Lakebase lifespan | 30 min, 12 h threshold | Deletes a project's **on-disk folder** (orphan = no DB row, OR untouched >12 h). |
| **Rogue-preview reaper** | `reapers.py` ← Lakebase lifespan | 5 min, 15 min threshold | Kills a `start.sh` preview the AGENT left running outside the registry (see below). |
| **Dead-demo-DB reaper** | `reapers.py` ← Lakebase lifespan (cross-workspace only) | 6 h, 14-day age gate | Drops shared-pool `db-dbgen-*` Lakebase dbs whose SB project is gone (frees ~2 zeroETL roles each). **DRY-RUN by default** (`LAKEBASE_DEAD_DB_REAP_ARMED`). Logic in `services/lakebase_reaper.py` — see below. |
| **Preview-apps sweep** | `preview/registry.py` ← `app.py` | 5 min | Stops idle registry-launched `start.sh` preview web-server subprocesses. |

**Invariants — do not break these:**
- **The DB is the durable store; the on-disk `projects/<id>/` folder is a disposable
  cache.** No reaper deletes DB rows (Project / Message / ProjectFile, incl. the
  `.claude/projects/**` Claude session transcript that powers resume). The project-file
  cleanup only rmtrees the folder; `restore_project_from_db` rebuilds it (and re-anchors
  the transcript so `resume=session_id` still works) on next open. Before removing a
  still-existing project's folder it `full_sync_project`s (delete-free) to flush any
  un-synced change to the DB first — atomic with the rmtree under the cleaning flag +
  restore lock.
- **⚠️ Folder deletion must never cascade to DB-row deletion.** The file watcher is a
  single recursive Observer over `projects/`; its flush (`sync_files_to_db`) deletes the
  `ProjectFile` row for any path missing on disk. `shutil.rmtree` unlinks children before
  the dir, so mid-rmtree the folder still `exists()` while files vanish. `sync_files_to_db`
  therefore **skips ALL delete-processing when the project is in the cleaning-set
  (`is_cleaning`) OR its folder is absent** — a vanished/mid-delete folder means "cache
  gone", never "user emptied the project". `remove_project_files_on_disk` sets that flag
  and holds the per-project **restore lock** across `full_sync`+`rmtree` (so a concurrent
  `restore_project_from_db` can't capture a half-deleted tree). Keep both.
- **Nothing is reaped/disconnected while a turn is in flight.** Authoritative signal =
  the **ActiveStream** (`get_stream_manager().get_project_stream`), NOT the pool's
  `is_busy`. A background run (tabs closed) stays alive because its stream is live.
  `reap_idle` **force-reaps a stuck `is_busy`+no-stream client** as a backstop; the
  historical leak was a cancelled/abandoned turn leaving `is_busy=True` forever (release
  was outside the try/finally, and `CancelledError`/`GeneratorExit` bypassed it), so
  `stream_agent_response` now clears `is_busy` in a `finally` on every exit. `register_client`/
  `remove_client` also refuse to disconnect a client whose project has a live stream
  (they drop the pool entry and let that turn's finally close it) — this prevents the
  Stop→re-send and clear-session-mid-turn use-after-disconnect. Idle timing uses
  `time.monotonic()` (clock-step safe).

**Dead-demo-database reaper (`services/lakebase_reaper.py`).** Every Lakebase-backed demo creates a `db-dbgen-<slug>[-<hex>]` database in the shared pool (`dbdemos-asset-generator`, `-2`…); each `CREATE DATABASE` auto-provisions ~2 zeroETL roles, and roles-per-branch is a HARD Lakebase limit — so a **deleted** demo's leftover db keeps costing roles until dropped. This reaper drains those dead dbs. **The classification is safety-critical:** a naive "no live project records this db in resources.json" rule would drop live demos' dbs (a db linked to a live project by an id-suffix the record doesn't spell out, or a recently built db whose resources.json does not record it yet). So a db is reaped ONLY when unreferenced by BOTH (a) the project-id-suffix (`<hex>` prefixing a live project id) AND (b) a full-text scan of every live project's root `resources.json`, AND older than a **14-day age gate** (short/unverifiable slugs are held for manual review). It runs as the app SP for the metadata read and the **deployer SP** for the drop (`w.postgres.delete_database`), and is **DRY-RUN by default** — logs candidates until `LAKEBASE_DEAD_DB_REAP_ARMED` is set (tunables: `LAKEBASE_DEAD_DB_{MIN_AGE_DAYS,MAX_PER_RUN,REAP_INTERVAL}`, `LAKEBASE_SHARED_PROJECT`).

**Rogue-preview reaper + the two preview paths.** There are TWO ways `start.sh` runs:
(1) the **UI Start-Preview** button → the `PreviewRegistry` spawns it and writes
`.preview.server.pid` (registry-owned); (2) the **agent's Bash tool** running `./start.sh`
for a smoke test and forgetting to kill it (rogue). `start.sh` itself writes `.preview.pgid`
(the Node process group) for **both**. So the discriminator is: **`.preview.pgid` present +
`.preview.server.pid` ABSENT = agent-spawned/untracked.** The rogue reaper kills such a
group only when it's >15 min old (grace for a legit smoke test), the project has no
in-flight stream, and the process validates as a node/start.sh tree; registry-owned
previews (both files) are left to the preview-apps sweep. The registry writes
`.preview.server.pid` right after spawn — before start.sh writes `.preview.pgid` — so a
starting UI preview never looks rogue.

**Preview kill = double `setsid`.** `start.sh` does `exec setsid npm run dev`, so Node
runs in a process group that ESCAPES start.sh's own group. Killing must target BOTH:
start.sh's group AND the Node group from `.preview.pgid`. `preview/process.py`'s shared
`kill_process_tree(ident, is_pgid=, validate=)` handles this, walks descendants via
`pgrep`→`ps` (works without `pgrep`, which prod containers may lack). `validate=True`
guards PID/PGID reuse by checking the command looks like a preview tree — for a GROUP,
iff ANY LIVE MEMBER matches (via `ps -g`), NOT the group leader: `setsid` makes the
leader's pid == pgid at creation, but that leader routinely exits while the group lives
on via node/tsx/esbuild children, so validating the (dead) leader would refuse to kill
exactly the orphans we're reaping. `psutil` is NOT a dependency — stdlib + `pgrep`/`ps`.

**Session teardown is by client OBJECT identity, not project_id.** A turn's finally
tears down the specific `PooledClient` it owns (`release_client(..., own=)` /
`remove_client(..., own=)`), guarded by `_clients[pid] is own`. A newer turn
(Stop→re-send) can replace `_clients[pid]` before the old turn's finally runs; looking
up by project_id would then orphan the old client's subprocess AND clear the new turn's
`is_busy`. When superseded, the old turn disconnects its OWN client (register_client
declined to, on that promise). External callers (clear-session/delete) pass no `own`
and act by project_id (delete uses `force=True` + `run_coroutine_threadsafe` onto the
app loop — the pool's `asyncio.Lock` is bound to that loop, so a fresh `asyncio.run()`
loop would mismatch).

### Graceful shutdown (SIGTERM) — every long-lived task must be cancellable

On redeploy the Apps platform sends SIGTERM and hard-kills after ~15s. Uvicorn's
graceful drain waits for in-flight requests to finish BEFORE the lifespan teardown
runs, so **any long-lived connection left open eats the whole grace window and the
(bounded) teardown then overruns 15s → force-kill + a 503 spike** — the historical
"app keeps going unavailable on every deploy" bug (prod: `Cancel N running task(s),
timeout graceful shutdown exceeded` → `App did not respect SIGTERM timeout of 15
seconds`, 503s on `/preview/{id}/{path}`). So the SIGTERM handler
(`_eager_cancel_on_signal` in `core/lakebase.py`) eagerly cancels every long-lived
task the instant the signal arrives, via `services/shutdown.py::cancel_all_on_shutdown()`,
which drives **three** shutdown mechanisms:
- **agent SSE streams** → `ActiveStreamManager` (their generators poll `is_cancelled`),
- **async preview/WS streams** → `LiveConnectionRegistry` (`services/shutdown.py`): the
  preview reverse-proxy streams (`preview/proxy.py`), the preview-events SSE
  (`preview/routes.py`), the collab WS (`routes/collab.py`), and the Vite-HMR WS proxy —
  each registers its `asyncio.Task` (via `track_live_connection()` or `register`/`unregister`
  at its try/finally) so `task.cancel()` unblocks a stream parked on I/O (a flag-poll can't
  wake an idle SSE/WS with no data arriving), and
- **sync-generator SSEs** → the `shutdown_requested()` flag. The capabilities-suggest
  (`routes/constants.py`) and grounding-scan (`routes/grounding.py`) SSEs are SYNC `def`
  generators Starlette runs via `iterate_in_threadpool`, so `task.cancel()` can't interrupt
  their blocking iteration — they poll `shutdown_requested()` between yielded chunks and
  return. `cancel_all_on_shutdown()` latches that flag first.

**⚠️ If you add a new streaming/SSE/WebSocket endpoint, make it shutdown-aware** — an
`async` handler registers via `track_live_connection()`; a SYNC-generator SSE polls
`shutdown_requested()` between chunks — or it reintroduces redeploy force-kills. `start.sh`'s
`--timeout-graceful-shutdown` (10s) is only a backstop for a missed one, not the mechanism.

**The whole stop has ~15s** (SIGTERM → SIGKILL): drain ≤10s, then a bounded teardown (reapers ≤3s,
client pool ≤8s, file watcher join ≤2s). Never add an unbounded `await`/`join` to the teardown, and
never do a blocking DB call directly in an `async def` handler or WS (wrap it in `asyncio.to_thread`):
with the pool busy it waits `pool_timeout` ON the event loop and freezes every stream, the drain
included. Clients reconnecting to a long-lived stream back off (preview events: 0.5s → 15s, jittered;
collab WS: 1–5s first retry, full jitter, cap 30s; the agent stream stops on 401/403/404 and resets its
retry count once data flows) so a restart isn't met by every open tab at once.

**Never `StreamingResponse(io.BytesIO(...))`.** Starlette iterates a sync file object line by line, so a
binary zip goes out in ~250-byte chunks, each a threadpool hop on the single event-loop core (30 MB =
13s of CPU). A big project download pinned prod at one core and stalled every request until the proxy
cut it. Return `Response(buf.getvalue())` (or a `FileResponse`). Walks over a project dir prune the
excluded dirs (`os.walk` + `dirs[:] = ...`) instead of `rglob`-then-filter: `node_modules` alone is ~40k files.

**When prod is slow but up** (CPU flat at ~1 core, static files slow): `GET /api/health/threads`
(admin-only) returns every thread's stack + CPU time, each asyncio task's await point, and the event-loop
lag. If even that doesn't answer, `kill -USR1 <uvicorn pid>` (run from a project agent's shell) writes all
thread stacks to the app logs via `faulthandler`.

**Finding WHERE the time goes (all admin-only, `services/stall_detector.py` + `services/profiler.py`):**
- `GET /api/health/stalls`: the always-on loop watchdog. Each event-loop block over `LOOP_STALL_MS`
  (500) is recorded with its duration, the loop-thread stack at detection, the most frequent stack
  during the block, and a `cause` (loop busy on its own CPU / starved by another thread's CPU / waiting
  on I/O). Last 50 kept. Use it when prod stalled and you weren't watching: the answer is already there.
  Also logs `[stall]` WARNINGs, rate-limited to 1/10 s. A stall over 2 s, or threadpool work queued for
  30 s, also writes one `[stall-capture]` thread dump (rate-limited to 1 per 5 min).
- `GET /api/health/profile?seconds=10&hz=100&thread=all|main&format=json|collapsed`: a bounded sampling
  profile (≤30 s, ≤200 Hz, one at a time, 409 otherwise). It answers "where is CPU going right now" over a
  window. `format=collapsed` gives folded stacks for flamegraph.pl / speedscope.
- `GET /api/health/threads` also reports saturation: threadpool total/borrowed/waiting, DB pool
  (size/checked-out/overflow/checked-in), in-flight HTTP requests, slow-request counts per handler, and
  the main process plus each child's CPU% and RSS (`kind` = claude / preview / browser / other). Use it to
  tell "our Python is at one core" from "the Node agents or previews are".
- Slow requests (TTFB over `SLOW_REQUEST_MS`, 2000) log a `[slow-request]` WARNING with the handler, status,
  and the loop lag and stall state at that moment. TTFB only, so SSE streams are not flagged.

Measured overhead, idle: the watchdog plus heartbeat add about 0.2% of one core; the middleware about
0.5 µs per request; the profiler at 100 Hz about 1% of one core while it runs.

**What kept prod "up but stale" (2026-11-13 audit) and the rules that came out of it:**
- **The file watcher must never walk ignored trees.** In the Apps container it polls (inotify misses the
  agent subprocess's writes there), and watchdog's polling snapshot stats every entry. Over all of
  `projects/`, `node_modules` included, that was ~119 s of CPU per 6 min, against ~1 s for the event
  loop, and it took the GIL from it. `file_watcher.make_pruned_listdir` feeds `PollingObserverVFS` a
  listing that drops a directory only when `should_ignore` would drop everything beneath it, and never
  prunes a project root or `.claude/projects` (synced transcripts). Per event, `should_ignore` runs
  before any `realpath`. Flush bookkeeping happens only on the loop, one task per project drains
  `_pending`, and a flush that has started syncing is never cancelled (two concurrent syncs used to
  race on the `(project_id, path)` unique index).
- **Every outbound call has a bound.** LLM: 240 s read / 10 s connect, `max_retries=1`
  (`llm_service.py`); embeddings 60 s. App SP SDK client: `make_app_sp_client()` (60 s retry budget,
  30 s per attempt, a 100-connection pool). Lakebase: `connect_timeout=10`, TCP keepalives, and
  `SET statement_timeout = 60000` on every new connection (a SET, not a startup `options` a proxy might
  reject). The token is refreshed 10 min before expiry with backoff and never minted under the lock.
- **The anyio threadpool is 100 tokens** (set in `_factory._composed_lifespan`). Sync handlers, sync
  dependencies, `to_thread` and static-file chunks all share it, so raising it only helps because the
  calls above are bounded. Blocking work in an `async def` goes through `asyncio.to_thread` (uploads
  extraction, brand handlers, take-over, MCP create, usage, preview start/restart env, analyze-logs).
- **Shutdown order:** the Lakebase teardown stops previews first, then the DB work. SIGTERM also arms a
  13 s `os._exit(0)` watchdog, so a stuck non-daemon thread can't run past the platform's 15 s kill.
- **One slow client can't stall the others.** Collab sends go out to all members concurrently, ordered
  per member by a lock and bounded at 10 s; a member that stalls is removed via `leave()` and closed.
  The agent `ClientPool` decides under its lock and disconnects outside it (bounded at 10 s).
- **CPU-heavy work runs outside the uvicorn process** (one process, one GIL: a thread doing Python CPU
  work still slows every request).
  - In the Apps container the watcher's polling scan runs in a spawned child process
    (`services/watcher_process.py`), which sends changed paths back over a pipe.
    - The parent supervises it and restarts it with backoff (1 s → 30 s).
    - After a restart the new child replays every file modified since the old one last spoke, minus
      5 s. Deletions made during the gap are NOT replayed: a stale row is safer than a lost write.
    - `FILE_WATCHER_IN_PROCESS=1` falls back to the in-process observer. Local dev keeps the native one.
  - Upload parsing (pypdf/openpyxl/docx) and the three download zips (project, workshop kit, template
    export) run in `services/cpu_pool.py`: a spawn-context process pool, `CPU_POOL_WORKERS`
    (default 2, ~27 MB each).
    - `CPU_POOL_DISABLED=1` falls back to threads. A broken pool is recreated once, then that call
      runs in a thread.
    - Worker code must import nothing from the app: `services/zip_builders.py` (exclusion predicates
      and zip builders) and `services/content_codec.py` (the zstd/zlib codec that `file_sync`
      re-exports) are dependency-free on purpose.
    - Never `fork` this process: it is multi-threaded, with an event loop, a DB pool and children.
- **Deployer-SP clients are built only for a Databricks workspace host.**
  `remote_deploy.probe.validate_target_host` accepts only `https://<label>.cloud.databricks.com |
  azuredatabricks.net | gcp.databricks.com`, with no port, userinfo, path or IP literal. The SDK sends
  the client secret to whatever host it is given (OIDC discovery, then the token endpoint), so a
  user-typed host used to receive it.

## The preview/review mode

Every generated demo ships with a Databricks App under `<project>/app/`. The user clicks **Start Preview** in the project workspace and the generator runs that app **inside the generator's own container**, then proxies it into an iframe. Live HTML + live agent, no deploy step.

### Lifecycle

A `PreviewRegistry` singleton (one per uvicorn process, lives for the app's lifespan) tracks one `PreviewState` per project. State machine: **stopped → starting → ready → (failed | stopped)**. The UI subscribes to `/api/preview/{id}/events` (SSE) and gets state transitions + log lines as they happen.

When the user clicks Start:
1. Registry asks the kernel for a free port via `bind(("127.0.0.1", 0))`, **excluding** the parent's `DATABRICKS_APP_PORT` and any port already promised to another preview.
2. Spawns `<project>/app/start.sh` with `DATABRICKS_APP_PORT=<picked>` **and `FLASK_RUN_HOST=127.0.0.1`** in env. Both are critical (see the prod-bind story below).
3. A readiness probe polls the port; first successful TCP connect flips the state to `ready` and the iframe is told to load.

`stop` kills the subprocess tree. An idle sweep stops previews after 5 min of inactivity and a global cap keeps total concurrent previews bounded (defaults defined in `backend/preview/registry.py`).

**Only the UI drives lifecycle — the agent never runs `start.sh`.** The agent's transcript wouldn't capture process state anyway, and concurrent agent-spawned processes would race the registry.

### Reverse proxy + HTML rewrite

`/preview/{id}/{path}` forwards every request to `http://127.0.0.1:<picked>/<path>`. The proxy is more than a pipe — it has to make the child app **think it lives at the iframe origin**, even though it actually lives under a `/preview/<id>/` prefix.

For that it does two things:

- **HTML rewrite on the way out**: absolute-path `href="/foo"` / `src="/foo"` get prefixed to `/preview/<id>/foo`. Inline `<script type="module">` import paths get the same treatment.
- **Runtime shim injected into the child's `<head>`**: patches `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` so the child's own runtime calls also get rewritten. Sets `window.__PREVIEW_BASENAME__ = "/preview/<id>"` so the child's router can use it as basename. **This is the most surprising piece** — if a preview loads but its data fetches 404, that's where to look.

The shim also installs an error catcher that POSTs uncaught JS errors and unhandled rejections to `/preview/<id>/api/log/client-error`. Those land in the parent's server logs alongside the child's stdout/stderr — useful for debugging a blank preview.

### Logs

Each `PreviewState` owns a bounded `LogBuffer`. The child's stdout + stderr stream into it line-by-line (tagged `stdout` / `stderr` / `system`). The SSE feed at `/api/preview/{id}/events` carries both **state events** and **log lines** with a cursor so reconnects can replay missed lines. The UI's "Preview logs" panel reads this feed.

When something breaks the order to look:
1. **The logs panel** — child startup errors usually scream here.
2. **Browser console** — the shim's error catcher echoes uncaught errors to the parent's server stderr, but they're also right there in the iframe's console.
3. **The parent's uvicorn stderr** — anything the shim catcher posts lands here.

### Why both `DATABRICKS_APP_PORT` *and* `FLASK_RUN_HOST=127.0.0.1`

AppKit's server plugin defaults to `host=0.0.0.0`. In the prod Databricks Apps container, the parent **must** bind `0.0.0.0:DATABRICKS_APP_PORT` (the platform proxy targets that). If the child binds `0.0.0.0:<picked_port>` and the kernel ever hands the parent's port back to `_pick_free_port` (rare, but possible in some ephemeral-range deployments), both processes end up listening on the parent's external port and the load balancer round-robins between them — users intermittently get the **child's HTML on the parent's URL**.

Forcing the child to `127.0.0.1` turns that race into a hard `EADDRINUSE` at child start (`127.0.0.1:N` conflicts with `0.0.0.0:N` on bind). The child fails loudly, registry picks a new port, no silent shadowing. See the commit / comment in `registry.py:_do_start` for the full story.

Same env in local dev — no behavior change there.

## The architecture-diagram editor (`platform-diagram/`)

The "Architecture" tab is a Lucidchart-style ReactFlow (`@xyflow/react`) editor for the demo's Databricks architecture. It reads/writes the project's `architecture.md` and auto-saves (debounced) on every change. A module DAG under `ui/components/project/platform-diagram/`:

```
platform-diagram.tsx                 # thin shell: PlatformDiagram (default export) + SaveChip + parse/deeplink/persist
platform-diagram/
├── canvas.tsx                       # ★ the stateful orchestrator (ReactFlow, panels, menu, drag-to-add, keys)
├── shared.tsx                       # NodeData/EdgeData/StylePatch types, RotatableCard (resize/rotate shell),
│                                    #   cardStyle (border/shadow/fill helper), baseSize→naturalSize, EditModeContext
├── edge-routing.ts                  # pure edge geometry (sides, fan-out, EdgeOps context)
├── edges/edge-geometry.ts           # ★ THE shared at-rest path (stub shrink + centerX guard + runAt)
├── edges/label-layout.ts            # ★ edge-LABEL de-confliction (cost-scored slots; see below)
├── edges/label-chip.ts              # ★ the label pill's geometry + word wrap (renderer + solver share it)
├── flow-mapping.ts                  # schema↔ReactFlow: schemaToFlow / flowToEdge / flowToLayout (the save round-trip)
├── node-types.ts                    # nodeTypes + edgeTypes registries
├── nodes/component-node.tsx         # the standard product/source tile
├── edges/{flow-edge,edge-flow}.tsx  # custom edge (arrows + inferred handles) + animated flow overlay
├── panels/{detail-panel,edit-panel,library-palette,style-controls}.tsx
├── panels/legend-panel.tsx          # ★ the READABLE legend (chrome → excluded from the image export)
├── menus/context-menu.tsx           # the EDGE edit panel (docked on click; flow/arrow/shape/label/delete)
├── composite-{lakeflow,lakeflow-genie,genie-code,governance,agent-bricks,db-platform,genie-one}.tsx  # rich composite kinds (agent-bricks.tsx = the DEPRECATED databricks-agent composite)
├── annotations.tsx                  # free-form text/box/logo/image/note/callout annotations + IconPicker
├── hooks/{use-diagram-history,use-node-mutations,use-edge-mutations,use-paste-image}.ts
└── collab/                          # ★ live multi-user editing (see "Live collaboration" below)
    ├── use-collab-yjs.ts             #   WS client (Yjs sync): room lifecycle, roster, cursors, reconnect
    ├── ydoc-model.ts                 #   the collab doc model: per-tab LWW, what the file means
    ├── collab-cursors.tsx            #   peer-cursor overlay + presence-avatar bar
    └── types.ts                      #   CanvasCollab (the slice Canvas needs)
```

Dependency direction is a strict leaf→root DAG (shared/edge-routing → edge-flow/composites → component-node/flow-edge → node-types/flow-mapping/panels/menus → canvas → platform-diagram). The custom Canvas hooks own the undo/redo burst machinery, the node/edge mutators, and paste. Selection comes from ReactFlow's `selected` NodeProp, edit mode from `EditModeContext`, draggability from `<ReactFlow nodesDraggable>` — node `data` identity stays stable so `React.memo` holds.

### Nested layout: the format (`lib/arch-layout.ts`, `lib/arch-migrate.ts`)

**A tab is a tree** (`{ name, story, aspect, theme, direction, layout, gap?, nodes[], edges[] }`): the tab lays out its top-level `nodes`; every container — a `box` (frame + title) or an invisible `group` — lays out its own `children` in a `layout` (`row` / `column` / `grid` + `cols`) with `gap`, `align` (`start|center|end|stretch`), `justify` (`start|center|end|between`), `equal`, `pad`; `track` lines nodes up across containers (on the cross axis of their lowest common container); `at` is an exception (an offset inside the parent, for redraws / hand-composed slides). Skill doc: `.claude/skills/databricks-architecture/reference/layout.md`. **The engine is `arch-layout.ts`**: sizes bottom-up (leaves via `nodeFootprint`, containers = content + pad + title bands — so nested boxes can't overlap or sit under a title), positions top-down, then (1) tracks — offsets grown until members meet; the track's common container is forced to start-alignment (centring made members chase each other), and an order that makes a track impossible is DETECTED (offsets stop shrinking) → offsets dropped, reported by `validateArchitecture` (`field:"track"`); (2) label gutters — the gap between two sibling subtrees an edge label must sit in is widened to `measureLabel` + margins.
- **The bridge to the flat pipeline (keep it exactly this way):** `parseArchitectureFile` is the RAW parse (the Yjs doc model stores authored objects with it — never solve there). `resolveArchitectureFile` / `resolveNested` = raw parse + `flattenTree`: every node gets its solved centre `at`, each box `size` + `wraps` (its non-group descendants), groups are dropped, and `_tree` (a `TreeMeta`: parent, index, tree-only props, computed rect per node) rides along → `PlatformSchema.tree`. `computeLayout` returns a `_tree` file VERBATIM (none of the old lane passes may adjust it — the vertical-caption lane-width pass widened a firewall logo past its subnet box). `serializeArchitecture` runs `nestTree(flat, tree)`: unmoved nodes keep parent + order; a node whose centre moved (a drag) is re-parented into the deepest container its centre falls in and re-ordered by position; a node carried by a moved container (same displacement as its nearest moved ancestor) is not moved; a resize keeps the new `size`; nothing is written as pixels. `platform-diagram.tsx` re-parses its own save when the saved tree lays out differently (`layoutChanged`), so a drop snaps into place. Locked by `scripts/test-nested-layout.ts` (part of `test:layout`) and verified in the real editor by a headless drag.
- **Old flat files are migrated on parse** (`arch-migrate.ts`, called from `resolveNested`): the geometry the OLD engine (`computeLayout`) resolves is decomposed by a recursive XY-cut (columns where a vertical gap runs through all items, else rows), every node goes into its smallest wrapping box (or the box it was pinned to), leaves that were level across different containers get a `track`, only the tracks the layout can satisfy are kept, and a region with no clean cut keeps `at` offsets (a hand-composed slide renders pixel-identical). The next save writes the file nested. `validateArchitecture` checks an old file AS AUTHORED (its own field checks) and a nested one in solved form. The old engine stays only as the migration's geometry source. The 28 skill references were converted this way (4 hand-rewritten for teaching) and gate at 0; the hostile corpus stays old on purpose so `eval:arch` keeps exercising the migration.
- Both orientation checks (`assessFlowOrientation`, the browser's `FLOW ORIENTATION`) count, for a nested file, only edges whose ends meet in a container running the declared way (a row for a horizontal tab) — the nested equivalent of "cross-lane".

### Two layers: the FILE format vs the ReactFlow binding (keep separate)

- **`lib/platform-architecture.ts` — the file-format + catalog layer.** This is where most architecture logic lives. It owns:
  - The canvas works on a **flat node list** (what `resolveNested` produces; also the OLD on-disk format, now migrated on parse): `{ name, story, options, columns?, nodes[], edges[] }`. A node is on the canvas iff it's in `nodes`. **No bands / state / hidden / catalog-diffing in the file** — that model was cut over (no `buildSchema`/`seedEdges`/overrides anymore).
  - `parseArchitecture(content)` → the internal resolved `PlatformSchema` ({bands, layout}) the canvas consumes; `serializeArchitecture(schema, layout)` → writes the flat file back. (The internal `{bands, layout}` shape is kept ONLY so `flow-mapping.ts` + the node components didn't have to change.)
  - The **`CATALOG`** (single source of truth): every component with `id`/`label`/`icon`/`desc`/`kind`/`sublabel` + authoring metadata (`authoring` one-liner, `ports` map). `CATALOG_BY_ID` is the lookup; `naturalSize(type)` gives each kind's [w,h]. The file lists only what's placed; the library palette renders the full catalog.
  - **`computeLayout(file)`** (the OLD engine, now only the migration's geometry source and the pass-through for solved nested files) — resolves SYMBOLIC placement → pixels. **Author structure, not coordinates:** `columns: [...]` + per-node `col`/`row` stack nodes in left→right lanes; **relational fields** `alignX`/`alignY` (copy another node's center on an axis — with a `col` the node stays in-lane and its lane-mates re-stack to open a slot), `below`/`above`/`leftOf`/`rightOf`(+`gap`) place a node beside another (siblings on the same anchor fan out; a still-overlapping satellite nudges clear) — computeLayout de-overlaps these automatically; `wraps: [ids]`+`pad` makes a `type:"box"` auto-size around children (recursive → cloud/VPC nesting); `bounds: {side:"<id>:<anchor>"}` cuts a box edge at a node/column midpoint; `pin: "bottom-left"`+`pinTo` docks banners into a box corner (non-`float` pins RESERVE a band so the box grows and they don't overlap content). **Explicit `at` always wins.** **PER-NODE round-trip (not all-or-nothing):** parse stashes each node's symbolic fields in `NodePosition.placement` + a `pinned` flag; on save `serializeArchitecture` re-emits the symbolic fields for any UNMOVED node and only writes pixel `at` for nodes the user actually dragged (canvas `handleNodesChange` sets `pinned` on the drop frame) or that were authored with `at`. So dragging one box no longer flattens the whole tab.
  - Edges: `from`/`to` by node id. The `@handle` is either **explicit** (`to: "lakeflow-genie-block@in-zerobus"`) or **inferred** (L→R `@r`/`@l`). **There is NO `ingest` field anymore** — a source→Lakeflow edge names the ingest PORT via its target `@in-*` handle (`@in-lakeflow-connect` / `@in-zerobus` / `@in-direct`), and that handle drives BOTH the port anchor AND the flow animation (zerobus→particles, direct→docs, else→laser). `arrow` (auto/none/end/start/both) — `auto` draws relationship arrows for Genie-One edges.
- **`flow-mapping.ts` — the ReactFlow-binding layer.** `schemaToFlow` / `flowToEdge` (resolved schema → `Node[]`/`Edge[]`) and `flowToLayout` (live graph → persisted layout). No file parsing here.

### Edge geometry: one shared path, and automatic label de-confliction

**`edges/edge-geometry.ts` is the single source of truth for "what path is actually
drawn"** at rest. Three consumers need identical geometry — `flow-edge` (renders it),
`crossings` (line-jumps on it), `label-layout` (places the label on it) — and
re-deriving it drifts from the render, because the smooth-step router turns toward the
ENTRY side and both the **stub shrink** (cap each exit stub at ~40% of the facing gap so
close tiles don't S-wiggle) and the **centerX guard** (keep a vertical elbow ≥ offset
beyond both ends or the path folds into a backward zigzag) change the path. Those two
rules live in `edge-geometry`; `crossings` + `label-layout` call `drawnPath()`, and
`flow-edge` keeps its own arg assembly (it must feed TRANSIENT drag state through) but
imports `stubOffset`/`guardCenterX` so the rules aren't duplicated. **Don't re-implement
either rule in a fourth place.**

**Captioned-logo edge anchoring (the ICON sub-rect, not the box).** A `logo` node's rect is
its icon UNION its caption(+desc) (`logoFootprint`), so an edge anchored on that box lands in
the caption whitespace, not on the icon it points at. So a captioned logo does NOT anchor on
its box: `logoIconRect(box, annotation)` gives the ICON square's sub-rect (matching the
render's `iconSq`), and `logoAnchorPoint(box, side, frac, annotation)` returns the exact
anchor per side — the **icon edge** on the three non-caption sides (a line meets the icon),
and the **box edge** on the caption side (a line exits past the caption/desc text, so a
bottom-captioned logo's downward line starts below the text, not through it). `anchorRectOf`
(the icon rect, for the router + tile-avoid + fan-order) and `sidePointForNode` (the drawn
anchor point, for `flow-edge`; `drawnPath` takes an optional `anchors` override) route every
captioned-logo end through this — router, tile-avoid, and render all agree. `isCaptionedLogo`
gates it and is folded into `computeFanLayout`'s cache signature (toggling a caption
re-anchors). **This REPLACED the old `joinDepth` inset hack, now fully removed** — the anchor
is correct on its own (no `sidePoint` depth param, no `resolveEndDepth`/`depthsFor`, no
`options.joinDepth`/per-edge `joinDepth`, no UI). `logoFootprint` reserves icon + gap +
caption + desc so nothing overflows; the icon stays its NATURAL size for an auto-sized box
(only a user resize scales it), and captioned logos drop their manual `size` to auto-fit.

⚠ **The anchor is NOT an alignment fix.** A column of logos captioned "Dev" / "Staging" /
"Production" measures different widths, so their box borders sit at different x. **Uniform lane
width (`computeLayout` step 2.5) is what puts the icons on one vertical** — the icon-rect
anchor then meets each icon's centre.

**Step 2.5 has TWO passes, and the difference between them is what may move.** The
horizontal (right/left caption) pass also shifts `box.x` to align icons to a lane edge, so
it skips pinned (`at`) nodes — moving a coordinate the author chose would be wrong. The
vertical (top/bottom caption) pass sets **width only**, because a vertical logo centres its
icon and equal width alone puts every icon on the lane centre; that makes it safe for pinned
nodes, which is where hand-composed slides live. It groups by **resolved centre x within
8px**, not by `col`, so a pinned slide with no lanes is still seen. An explicit `size` opts a
node out (it counts toward the group max but is never overwritten — the escape hatch has to
stay usable). Both are pinned by `test:layout`.

**Composition discipline is MEASURED but never gated (`inspect-arch.mjs`).** Every other
check in that script is a fault — something overlaps, is clipped, or crosses — and the answer
is always "fix it". Two numbers are different in kind and print under **COMPOSITION
(advisory, not gated)**:

- **alignment reuse** — tiles per distinct centre line, clustered at 6px. Measured on
  CENTRES, not edges: `at` is a centre, and two nodes of different widths sharing a centre
  are visually aligned while their left edges differ (measuring edges ranked the
  best-judged diagram in the sample mid-pack).
- **text budget** — mean rendered chars per tile. Past ~40 the reader is reading paragraphs
  inside boxes instead of scanning a structure.

Calibrated on 12 diagrams (4 upstream references + 8 tabs of a real customer file), all
measured through the script: alignment reuse ran 1.43-5.88 (median 1.86), and the diagram a
senior practitioner judged far better scored **4.75 on 8 centres against its sibling's 1.73
on 51** — same renderer, same source material, same file. That gap, not node count or
nesting, is what separated them. **Alignment reuse is now printed WITHOUT a verdict — a
scatter measure, not a target.** The 4.75-vs-1.73 diagnosis was on a Visio *transcription*
(accidental coordinate drift, where high reuse IS the fix); generalising it to "composed
diagrams have high reuse" does not hold — a deliberately asymmetric, relationally-composed
variant scored 1.50 while a rigid lane grid scored 3.00, and the rigid one is what a
reviewer called "too rigid… everything has to be in a line". Optimising the number pushes
toward regimentation, and SKILL.md's "decide your centre lines FIRST" guidance was toned
down accordingly. Only the text budget keeps a threshold (40). They stay out of the exit
code because a small sketch or a faithful transcription of someone else's drawing can
legitimately score low.

**`edges/label-layout.ts` places edge labels so they don't collide.** The router drops a
label at the path midpoint/elbow with no avoidance at all, so in a dense diagram labels
land on tiles and on each other — `inspect-arch.mjs` only ever REPORTED that
(`LABEL OVERLAPS`, `LABEL OVER NODE/TITLE`) and the fix was for the agent to shuffle rows
by hand through the render loop. Now it's correct by construction: for each labelled edge
score a small candidate set around the anchor and take the best —

- **slide ALONG the run first** (stays on its own line, so cheap: `W_ALONG = 8`/px),
  **step ACROSS second** (detaches the label, so `W_ACROSS = 40`/px and capped at ±34);
- covering a **tile** (`W_NODE = 1000`/px²) outweighs clipping a **neighbouring label**
  (`W_LABEL = 1`/px²) — hiding an icon destroys more meaning than a clipped label;
- **score, don't first-fit** — a congested diagram may have NO clean slot, and scoring
  picks the least-bad instead of falling back to candidate 0, the one known to collide;
- travel is bounded by the **whole collinear RUN** (`runAt`), not one segment: the router
  emits a run as stub+middle+stub (+ collapsed Q corners), so per-segment bounds
  under-report the room available and needlessly push labels off the line. Bounds are
  **asymmetric** — the anchor is rarely the centre of its run.
- a **container box** contributes only its ~34px **title strip** as an obstacle (a label
  inside the platform/cloud box is normal and must not be pushed out of it);
- a **manually parked elbow** (`data.centerX` — how you position a label by hand here) is
  honoured exactly and never second-guessed, but still blocks auto labels;
- past `LEADER_AT` of across-drift `flow-edge` draws a dashed **leader line** so the label
  still reads as attached.

Offsets are **derived, never persisted** — nothing new in `architecture.md`.

**Container BORDERS are obstacles for labels too.** A container's title strip (`titleStripOf`,
`TITLE_STRIP_H` = 34, in `edge-geometry.ts` — shared by the solver and `fan-layout`) was the only
part of a box the solver avoided. A pill that **straddles** a container's border (overlaps it and
sticks out, `encloses` tolerance 2px) now pays `W_BORDER` (1200) per border — fully inside or fully
outside is free. The near window is a RECT test, not a centre test (a big container's centre can be
far away while its border runs right past the anchor). Pills are placed against the same point the
edge is drawn at: **`resolveLabelAnchor` (`edge-geometry.ts`) is the one rule** FlowEdge renders and
`drawnPath` (so the solver) uses — the router's elbow label point is kept when it is within the
endpoints' span or for a **U-turn** (both ends leave the same side and the turn sits beyond both,
e.g. a bottom-to-bottom loop); otherwise it falls back to the endpoints' midpoint. Before this, the
renderer's fallback moved a U-loop's label ~75px off its run while the solver believed it was on it.
Limit: a short edge whose whole run crosses a border can have no free candidate along it, so the pill
stays on the least-bad slot (`inspect-arch`'s **LABEL ON BOX BORDER** counts those; it is advisory).
The fan avoidance pass (`avoidTiles`) also treats container TITLE STRIPS as obstacles (an endpoint's
own box is exempt, as in `inspect-arch`), so an edge is re-anchored off a title it would run through.

**Detached labels, arrow ends, and what the checker measures.** Three things made the label
collisions in the text→diagram benchmark (AUTO CDC clipped by a card, Land in UC on a frame, Delta
Sync on an arrowhead) survive the solver, and each is fixed at its root:

- **No clean slot on the line was the cause, not the search.** A chip wider than its corridor (a
  84px "Read/write" between two tiles 78px apart; a 75px "AUTO CDC" between a card and a frame 62px
  away) has no on-line position that is clear, and the ±26px across steps never reach past the
  neighbours. Pass 2 of the solver (only when pass 1 is not clean) therefore tries positions just
  clear of each nearby obstacle's edge, on BOTH axes (the cross product of sampled path points with
  obstacle edges, `SNAP_REACH` 160 across, `SNAP_ALONG` 80 sideways), priced per px of drift. A
  detached candidate is accepted only if it is clean of tiles, frame borders, arrow ends and other
  edges' lines — a leader line may lead to clean space, never trade a clipped tile for one.
  **Open:** a corridor narrower than its chip has no clean slot, so the least-bad off-line pill can still
  clip a card's margin (decision-view-grid, "Read/write", ~11px). The real fix is lane spacing for labelled
  edges, which is not built; the checker now sees the clip rather than hiding it.
- **Arrow ends are not free.** A pill over an edge END (`END_ZONE` 10px box around the endpoint,
  `W_ARROW` 300) hides the one mark that says which way the arrow goes.
- **`FREE_OVERLAP` is the checker's tolerance (30px², was 130).** At 130 a 12×17 clip of a tile
  scored as free, so the solver accepted a label the checker then reported as over the node.

The checker measured the GLYPH box of a label, not the drawn pill, so a pill clipped by a card by 12px
read as 0 faults. `arch-browser.js` now (a) tests labels on the PILL (`info.pills`, falling back to
the glyph box only when no pill exists); (b) reports a tile **covered** by a pill (`LABEL OVER
NODE/TITLE`) only when an element that PAINTS a background is on top of the pill at a grid of
hit-test points (`elementsFromPoint`) — a tile's transparent margin under a chip is not a visible
collision; (c) adds **CONTENT OUTSIDE TILE** (a tile's flow text paints past its own border — a badge
hung over a card corner; absolutely-positioned tabs such as the Genie One persona and the Lakeflow
header are deliberate overlays and exempt), **LABEL HIDES ARROW** (an edge's own pill covers its
end), and **TEXT OVERLAPS** (one node's painted text runs into another's). The title row of a node
card (`node-card.tsx`) now wraps its badge, so a badge that does not fit is pushed to a second line
instead of hanging over the corner.

**Same-side loops clear what they cross.** A bottom-to-bottom (or top-to-top) loop used to run at
`anchor + 20`, which lands INSIDE the padding of every box it passes under. `turnClearY`
(`edge-geometry.ts`) returns the y the run must clear (iterated, because clearing one box can land
the run inside the next); `computeFanLayout` stores it as `FanEntry.turnY`, `drawnPath` and
`FlowEdge` both pass it to `stubOffset`, which deepens the offset (the stub IS the run's depth). Only
same-side U-turns are affected; every side-to-side route keeps its stub.

**Sibling stage boxes in one row share a height** (`computeLayout` step 4.5). A LEAF box (wraps only
tiles, not pinned, not `bounds`-sized, not related to another box by below/above/alignY) whose top
lines up within 4px with a side-by-side sibling under the same parent is grown DOWNWARD to the
tallest of the group. No child moves, so this never shifts content. Automatic: the reference set and
corpus are unchanged by it (`eval:arch`), and a loop drawn under the row now clears the tallest stage.

**`edges/label-chip.ts` owns the pill's size and its word wrap, and BOTH the renderer
(`flow-edge`) and the solver (`label-layout`) import it — never inline a metric in either.**
If they drift, the solver reserves a box that isn't the one drawn and its collision
numbers become fiction. Wrapping is what makes placement work at all: the pill used to be
single-line and unbounded, so a 35-char label was a ~234px chip, and **no offset can fit a
chip wider than its corridor** — the solver would shuffle it and still land on a tile. Text
wraps at `MAX_TEXT_W` (180px) to `MAX_LINES` (3), then the last line is ellipsized with the
full text in a `<title>` tooltip, so nothing is lost. The line count is **exact** (we own the
wrap and count the lines) rather than estimated from a width ratio, which would have to
round up because wrapping breaks a line before it is full. Edge labels remain at the proven
11px / 13px-line-box metrics: increasing them caused material label-on-tile regressions in the
hostile eval corpus, so slide readability comes from shorter labels and larger primary nodes.

**`MAX_TEXT_W` is tuned, not arbitrary.** Short and 23/24-character labels remain one line;
the 35-character case wraps. Renderer/solver metrics must stay shared through `label-chip.ts`.

> ⚠ **Every "→0" label figure recorded before commit `304055a` was fiction, including the
> ones this section used to quote.** Wrapping turned the chip into `<text><tspan>…</tspan></text>`,
> and `inspect-arch`'s label selector filtered to LEAF elements — so from A2 onward it matched an
> **empty set** and reported 0 by construction. `304055a` fixed the selector (take the `<text>`
> root, never a tspan). The "before" numbers were real (single-line `<text>` leaves were matched);
> the "after" numbers were unmeasured. **If you change how the chip is rendered, re-check that
> `inspect-arch` still matches it** — `scripts/test-inspect-arch-labels.mjs` now guards this.

Honest A/B with the FIXED checker, in a clean worktree, wrapping on both sides so only
placement varies — total faults across the 7-diagram corpus **15 → 9**:

| diagram | no placement | placement |
|---|--:|--:|
| `dense-prose-labels` | 10 | **4** |
| `ml-platform` | 2 | **1** |
| `long-span-edges` | 2 | **3** ← *worse* |
| others (incl. `numbered-legend`) | 0 | 0 |

So placement is a **substantial net win** (−40% overall, −60% on the hardest case) but it does
**NOT** solve labels, and on `long-span-edges` it currently makes things worse — an open defect,
not an accepted cost. `NODE OVERLAPS` / `EDGE THROUGH TILE` unchanged either way.

### Edge/tile avoidance (`fan-layout`'s last pass)

The router has no node avoidance, so a line spanning more than about two columns used to
run straight through whatever tiles sat between its ends (`inspect-arch`'s
`EDGE THROUGH TILE`). We can't bend the path around an obstacle — smooth-step gives one
vertical elbow, not arbitrary waypoints — but we can pick **better anchors**, and a search
over those clears every case we have (reference diagrams **3→0**).

**It lives at the END of `computeFanLayout`, and that placement is load-bearing:**
`crossings` and `label-layout` both read fan entries and rebuild the path from them, so
adjusting the entry keeps the drawn line, its line-jumps and its label in agreement.
Re-routing anywhere else desynchronises the three.

The search is **graduated, smallest deviation first**, and only runs for edges that
*already* cross something (every clean edge costs one path build):

1. keep both sides, sweep the vertical elbow across the corridor;
2. also move ends whose side was **inferred** (no handle authored);
3. also move ends carrying a plain `t/r/b/l` **hint** — last resort, on an already-broken edge.

**A NAMED port (`in-*`/`out-*`/`acl-*`/`bl`) is NEVER moved** — it fixes the anchor *and*
drives the flow animation, so reassigning it would change the diagram's meaning. An edge
with no clean candidate is **left exactly as it was**: a worse-but-different route isn't an
improvement. (Measured: elbow-only fixes ~2 of 11 candidate cases, +inferred sides ~6,
+plain hints all of them — hence all three stages.)

**Two invariants that bit during implementation — keep them:**
- **Obstacles come from the whole `nodeLookup`, not the edge endpoints.** The tile a long
  line crosses usually has no edges of its own, so collecting obstacles from endpoints makes
  exactly the obstacles that matter invisible.
- **The memo signature folds EVERY node** (plus each edge's `shape`/`centerX`). Keying only
  on endpoints serves a stale route when the user drags an obstacle out from under a line.

**`END_MARGIN` (18px) must stay in step with `scripts/inspect-arch.mjs`.** A tile packed
against an endpoint is grazed by the exit stub no matter how the edge is routed; counting
that as a fault makes the app "fix" something the checker never reports — which silently
re-routed an edge in a real customer diagram until the two were aligned.

**`inspect-arch`'s crossing detection was also wrong** and is fixed here: it asked whether
two *consecutive sampled points* both fell inside a tile, which misses the common case (a
long straight run crossing a tile with no sample landing inside). It now does a proper
segment/rect intersection, mirroring `edge-geometry.segmentHitsRect`. Any
`EDGE THROUGH TILE` figure measured before this fix understates the true count.

**SKILL.md's guidance changed with this** ("Complex workflows: prose labels, or numbered edges +
a legend"). It used to *mandate* numbering the edges past ~10 labelled edges, because placement
fell over. It now presents three options — **(1) prose straight on the edge, the default;
(2) numbered edges + a panel-only legend for live walkthroughs, over-long sentences, or when
labels still collide (embedding the prose box in an export requires an explicit user ask);
(3) a step strip** — and the switch signal is *a measured collision*, not a label count decided
up front. Justified by relabelling all 35 edges
of the mlops-v2 diagram with prose: **22→0**. Note that high-label evidence is **one** diagram, so
treat Option 1 as well-supported but not exhaustively proven.

**The authoring limit to keep in mind: ~75 characters per edge label.** Wrapping caps at 3 lines ×
~25 chars, then ellipsizes with the full text in a `<title>` tooltip — which is invisible in an
exported PNG, so overflow is genuinely lost in a rendered image. `reference/complex-workflows.md` says this; don't raise
`MAX_LINES` to paper over it.

### Same-source fan-out nesting (the elbow order) — and what "cross" means

**The rule (`fan-layout.ts` → `assignFanOutElbows`).** One source side fanning out to several
targets on the far side of the same normal axis: every edge is a stub out of the side, a run
that turns (the elbow), and a stub into its target. Two such edges cross only if one edge's
run passes through the other's stub or run, so the elbows must **nest**. Right side (the other
sides are the same with the axes swapped): exits are already ordered by their targets, top to
bottom; then (a) two targets **below** their exits → the **higher** exit's elbow sits **nearer
its target**; (b) two targets **above** → the **lower** exit's elbow sits **nearer its target**;
(c) mixed → the below group takes the tracks nearest the target, the above group the tracks
nearer the source. Tracks are handed out in one order from the target side: `[below, highest
exit first] ++ [above, lowest exit first]`. The bundle is then centred in the **largest free
stretch of the corridor** that avoids the faces of tiles its runs would graze (containers are
not obstacles — a run is meant to cross a box's padding), spaced ≤24px apart.

- Scope: only the normal-axis elbow is set (`centerX` for l/r, `centerY` for t/b, the latter
  rendered through `drawnPath` and `flow-edge`'s args). Edges with an authored `data.centerX`
  or a fan-in track keep theirs. Runs before the de-overlap pass, which skips elbows already set.
- `laneSeparate` never moves a fan-owned elbow (nudging one re-orders the nest and the
  crossing term can't see the ordering); it may still move the fan's free exits.
- `laneSeparate`'s crossing term now counts for EVERY pair, including edges sharing a node (the
  old `!shares` exemption let a fan cross itself). Its parallel penalty grows as runs close
  (3px apart costs more than 12px), so the solver doesn't squeeze a fan into one line.
- `avoidTiles` re-anchors only where the candidate crosses no OTHER line (strict pass); the old
  tile-only search is the fallback, so no edge gets worse on tiles.
- Polylines for crossing/parallel decisions come from `flattenPath` (Q corners SAMPLED).
  `pathToPolyline` collapses each corner to its end point, which hides a line that brushes
  another's rounded corner — the browser draws that brush as a crossing.

**EDGE CROSS is strict (`arch-browser.js`).** The old check forgave any crossing within 60px of a
shared node as "fan convergence". That is exactly where a mis-nested fan crosses, so the
"lines cross beside the lakehouse" report read clean. Now: any proper X between two drawn curves
is a fault. Two edges that only MEET at a shared endpoint are not a proper crossing (the
orientation is zero there), so convergence at a node is still allowed.

**Tests.** `test-diagram-layout.ts` → "same-source fans nest": eleven authored-side arrangements
(right/left/top/bottom; below, above, mixed; with and without a same-row sibling) plus a seeded
150-case right-side sweep, all asserting zero proper crossings on sampled curves. Plus the rule
itself (elbow order) and the lakehouse→{Genie + three below} shape. The original routing fails 8
of the 11 arrangements. Corpus: `scripts/eval-arch/corpus/fan-nesting.json` (hostile).

**Two traps.** (1) Renders go through `dist-standalone/architecture-viewer.html`, a BUILD artifact:
after editing `fan-layout`/`edge-geometry`, run `bun run build:arch-standalone` or your PNG and
`inspect-arch` show the old routing. (2) Test fan sides with explicit `@r`/`@l` handles: geometry
alone sends a wide, flat tile's far targets out of its BOTTOM (the slope exceeds the tile's aspect),
which is a different fan.

**Known open (measured, not fixed).** Strict EDGE CROSS pairs still left in the corpus: most join
edges from DIFFERENT sources (outside the fan rule); `long-span-edges` e02×e14 is a same-source pair
where `avoidTiles` has no crossing-free candidate, so it keeps the tile-only fallback; `numbered-legend`
e3×e5: both
edges target the `medallion-table` `out-gold` port because `out-mv` is only provided when the
composite has metric views (`flow-mapping` falls back to `out-gold`), so it is a fixture-authoring
problem as much as a routing one. A 4-tile fan in a 54px tile also cannot keep 14px spacing
between exits; that shows as PARALLEL OVERLAP at 10px (`fan-nesting`).

### Diagram-quality eval (`bun run eval:arch`)

Every diagram-quality change used to be judged by eyeballing a PNG, and **three separate
times the measuring instrument turned out to be the broken thing** (a corpus of hand-tuned
diagrams that couldn't show a regression; a crossing check that missed the common case; an
offline harness whose geometry drifted from the browser). `app/scripts/eval-arch.ts` makes
the measurement a committed artifact. Needs `bun run build:arch-standalone` first — it scores
through the real viewer.

Per corpus diagram it counts **faults** (every metric is a fault count, so 0 is always the
target and "worse" is always "larger" — that's what lets the gate be a plain comparison):
- **content** — `validateArchitecture()`, the **already-existing** pure integrity check
  (dangling refs, unknown types, invalid `@handle`s, duplicate ids). Not reimplemented; the
  harness just holds it to a number. It immediately caught invalid ports in the corpus
  fixtures *I* wrote.
- **geometry** — `inspect-arch.mjs` in a headless browser. **The browser is the authority for
  geometry**; never an offline model of it. This includes `PRESENTATION ASPECT`: the actual
  visual node union must be within 12% of the tab's declared 16:9 or 1:1 target; tight export
  padding cannot manufacture a pass. `FLOW ORIENTATION` separately requires at least 60% of
  relationships to follow the declared direction — counted on **cross-lane edges only** when
  `columns` are declared (a phase lane's internal steps stack vertically under its banner by
  design; counting them failed every phase-lane diagram even with 100% horizontal hand-offs).
  Wide flows default horizontal; comparison/containment tabs explicitly use `direction:"matrix"`.
- **label quality** — the genuinely new measure: GENERIC labels ("data", "sync", "query" — a
  label carrying no information is as bad as none) and labels over the ~75-char wrap budget.

**`scripts/eval-arch/corpus/*.json` is deliberately hostile** — prose on every edge, edges
spanning several lanes. The 5 skill reference diagrams are scored too but **on their own they
prove nothing**: they were hand-tuned until clean, so they can only catch a regression, never
demonstrate an improvement. **Add hard cases, not tidy ones.**

`baseline.json` is committed and gates the run (fails on any increase; reports a decrease for
you to accept with `--update`). A non-zero baseline entry is a **known defect being tracked,
not an accepted standard**. The skill's reference diagrams are its teaching set and must gate at 0
(as of 2026-10-14 five of six did not — they are being fixed); non-zero entries are otherwise reserved
for the deliberately hostile corpus cases (`dense-prose-labels`, `long-span-edges`,
`process-flow-shapes`).

**Known gap, be honest about it:** this scores diagrams that already exist. It does NOT drive
the agent to generate one from a prompt, so it cannot measure required-component recall or
whether the agent picked sensible components. That needs generation plumbing (model calls,
cost, flakiness); the scoring side is written so it can be pointed at generated output.

### Presentation framing + numbered callouts / legends

The **/architecture-showcase** page has a source toggle: *Agent examples* (`public/architecture-showcase.json`, promoted runs) and *Skill references* (`public/architecture-references.json`, GENERATED from `reference/*.jsonc` by `scripts/gen-showcase-references.mjs` in `build:arch-skill`; `?source=references` opens it). Never edit the generated file.

PNG/SVG downloads, passive agent snapshots, and standalone `render-arch.mjs` outputs are **tight
crops of the actual rendered node bounds** — they never add whitespace to manufacture a ratio. Each
every non-trivial tab must declare top-level `aspect: "16:9" | "1:1"`, which round-trips through
`PlatformSchema`. Only a MISSING declaration is a fault. The measured ratio is **advisory**: the
app's pure `validateArchitecture` (`assessPresentationAspect()` over `computeLayout`) and the
browser-authoritative `inspect-arch.mjs` both report it (12% tolerance → "close") but never fail on it,
because gating rejected the 2–4:1 ribbon real deck slides use.

**⚠ The aspect target is measured on the COMPOSED FRAME when a tab sets `frame`, not on the node
union.** A real slide is a stack of full-width bands — title, node ribbon, optional legend/detail —
and the ribbon itself is legitimately **2-4:1** (a pure process spine far wider); the *other bands*
are what make the composition 16:9. Measured on 7 Databricks deck slides:
canvases ran 1.77-1.91 while their node bands occupied only **10-41% of canvas height**. Gating the
union therefore rejected the shape professional diagrams use, and the only lever it left authors was
injected whitespace — which is exactly the regression it caused .
`FrameSpec` (`frame: { title, subtitle?, … }`) renders a **derived** title band — `FRAME_TITLE_NODE_ID`,
synthesized in `parseArchitecture`, skipped by `flowToLayout` + `serializeArchitecture` via the shared
**`isDerivedNodeId()`** predicate (the same contract as `__legend`; break it and the band duplicates on
every autosave). Because it lives inside `.react-flow`, the tight-crop export and `inspect-arch`'s
`.react-flow__node` query pick it up with **no change to either** — that is why the band is a derived
node rather than an export-time composite. `assessPresentationAspect` also returns `framed` plus the
pre-band `ribbon` ratio, **advisory only**: a 3:1 ribbon inside a 16:9 frame must never fault.
When aspect misses, the fix is a band or a tab split — **never a wider `rowGap` or a skipped row**.

**Spacing signals are ADVISORY and belong in `inspect-arch`, not `validateArchitecture`.** The latter's
issues are *content faults* that `eval:arch` gates, so a spacing preference emitted there fails the
build — tried at `rowGap > 72` and it immediately failed `ml-platform.jsonc`, a zero-fault reference
that authors exactly 96 for intentional phase banding. `inspect-arch` instead reports the largest
**rendered** column-adjacent gap in tile-heights (advisory at ≤2.5×; `ml-platform` 6.00×,
`architecture-complete` 0.83×) plus a **LEGIBILITY** ratio of largest rendered font ÷ canvas width
(reference decks ~1.3% for node titles) and **TEXT TOO SMALL** (advisory, not gated): every visible
text element's font × `scale`, where `scale = min(1920 / contentW, 1080 / contentH)` is the scale that
fits the drawn content into a 1920×1080 slide (limited by the axis that runs out first); anything under
10px on that slide is listed, node text and edge labels alike. It is advisory because the fix is often a
layout decision (a 3600px-wide ribbon on a slide is illegible at any font the box sizes allow), and
gating it would fail the zero-fault reference set on a 6px "PDF" glyph. **Box sizes are theme-invariant,
so slide-theme text floors are raised only where the box has room:** rail labels (`IngestBox`, medallion
`DbTable`) 7.5→10px, node badges 8→10px, node subtitles 11→13px, all `theme:"slide"` only. Box subtitles
(`BOX_SUBTITLE_FONT` 12px) are NOT raised: their band height is reserved by `boxSubtitleH` in layout,
which is theme-blind, so raising them needs the reservation to take the theme first. Rendered geometry is the right signal because a skipped row
number — a *documented* banding lever, `platform-architecture.ts:~1541-1560` — creates a void without
changing `rowGap` at all. For calibration: the default 60 is 0.83× the 72px slide cell, mainstream
engines default to 0.28-1.00× (ELK 0.28, dagre/Mermaid 0.69, Graphviz 1.00), decks measure 0.38-0.75×.
**The `rowGap` clamp stays 20-96** — a 44px floor was tried and reverted: on the wrapper/lane paths
`rowGap` is a gap between *actual* node extents (20 is legitimately tight, and `governance-layout.jsonc`
authors it), while in the fixed-pitch `rowGrid` a tall node is already protected in-lane by `cellSpan`. The skill tells the agent to use roughly
4–6 columns × 2–4 rows for 16:9, or a balanced 2–3-column grid/containment for 1:1. In horizontal
flows, sequence advances across columns and rows are only parallel/supporting items; long vertical
mini-flows must be reorganized or split. `theme:"slide"` is the default visual preset: box sizes are
theme-invariant (slide changes only what's drawn inside a node), ~20px titles and 32px icons,
tile and source descriptions never rendered (only `logo` nodes show `desc`),
cards are flat, connector strokes are stronger, and the editor grid is hidden in the rendered
surface; `theme:"technical"` retains the older compact treatment. `rowGap` is the actual clearance
for row-grid and auto-seeded stacks (default 60, range 20–96); it is never used to manufacture aspect,
and slide flows use contiguous row numbers. Vertical-caption sources use one theme-invariant footprint
(132×96, both themes) across layout/ReactFlow/render, and pure aspect assessment includes any derived on-canvas
legend. Narrative is bounded too: short labels/descriptions and at most one ≤8-word critical note
inside the grid; richer context stays in `story` / source brief or a detail tab.

A numbered diagram ("1 → 2 → 3", the MLOps-lifecycle shape) has TWO first-class pieces, so
nobody hand-rolls them again:

- **`type:"callout"`** — a new *annotation variant*: the big white-on-red circle (84px, bold
  digit at `CALLOUT_FONT_RATIO` of the diameter, so it stays legible and stays ROUND when
  resized — the resize handler squares both axes). It exists because a mid-line edge number is
  a compact **11px** chip (`edges/label-chip.ts`): still smaller than a callout once the diagram
  is scaled to fit a slide. Palette: "Step number"; dropping one auto-picks the next free
  number off the canvas.
- **`legend`** — a **tab-level** field (`LegendSpec` in `platform-architecture.ts`), NOT a node:
  `{ title?, show?, items[], fontSize?, width?, at? }`. `items` are sentences (auto-numbered) or
  `{n, text}` pairs. **`show` = `"diagram"` | `"panel"` | `"both"` (default `panel`)** — prose
  stays out of exports unless the author explicitly opts into an embedded key:
  - explicit `diagram`/`both` → `parseArchitecture` **synthesizes a derived box node**
    (`LEGEND_NODE_ID` = `__legend`) under the content, auto-sized by `legendBoxMetrics` at a
    readable ~20px. It's inside `.react-flow`, so it ships in the PNG/SVG export. The skill uses
    this only when the user asks for an embedded numbered key; it is not the slide/document default.
  - `panel`/`both` → the **Legend panel** (`panels/legend-panel.tsx`) reads the same items as UI
    text. It's chrome OUTSIDE `.react-flow`, so it is **excluded from the export** — that's how a
    `show:"panel"` legend stays readable in the HTML without appearing in the image. Its toolbar
    button renders **even in hard read-only**, because the standalone viewer HTML hides every
    other control and the panel would otherwise be unreachable.

**Invariants — the derived node must stay derived.** `flowToLayout` **skips `__legend`** and
`serializeArchitecture` **`continue`s past it**, re-emitting `schema.legend` verbatim instead; it
is also `draggable:false, selectable:false` (there'd be nowhere to persist a drag). Breaking either
half duplicates the legend on every autosave. Locked by `bun run test:layout` (round-trip must be
byte-stable across two passes). **`legendBoxMetrics` errs TALL** (a wide ~0.56em glyph advance +
a slack line) because a box CLIPS its overflow — a roomy legend reads fine, a clipped one loses
content. The box's `title` now scales with its `fontSize` (only above the 14px default, so every
existing box is unchanged) — a 15px heading on a 20px legend was the other half of "unreadable".

### Composite node kinds

Beyond the plain `component` tile, each composite is its own node type + `composite-*.tsx`. `CompositeKind` (in `platform-architecture.ts`) is: `lakeflow` / `lakeflow-genie` (3-port ingest rail + medallion; `lakeflow-genie` adds a Genie Code footer — the preferred data block), `governance` (UC + AI Gateway + Genie Ontology bar), `databricks-agent` (supervisor tree; **deprecated**, legacy alias `agent-bricks`), `genie-code`, `db-platform` (wordmark banner), and **`genie-one`** (the business-user entry tile — the "Business users" persona pill is built INTO it, so no separate `file:persona/user` node is needed). A composite's `kind` lives on its catalog entry; `nodeTypeFor` maps kind→ReactFlow type; `cardStyle` lets border/shadow/fill controls apply uniformly (db-platform + governance default to no border/shadow).

### The skill catalog is GENERATED from the code catalog

`app/scripts/gen-architecture-skill.ts` (`bun run gen:arch-skill`) writes the component catalog + icon-bank sections **directly into `.claude/skills/databricks-architecture/reference/component-catalog.md`** (kept out of SKILL.md so the core stays lean) (between `<!-- BEGIN/END: generated-catalog -->` and `<!-- BEGIN/END: generated-icons -->`), derived from `CATALOG`. It also runs a build-time **drift guard**: prose that references an `@in-*` port not in `CATALOG.ports` fails the build. After changing a component's label/desc/`authoring`/`ports`, re-run it so the skill can't drift. The rest of that file (the Sources section) and every other skill file is hand-written. The drift guard checks SKILL.md and every `reference/*.md`. (NOTE: this is *generation into the skill*; how the skill is *packaged/shipped* — pure vs in-app — is a separate concern, covered next.)

**The skill's lean core.** SKILL.md (under 30 KB) is what every run reads. The long material is in `reference/*.md`, each opened on demand; SKILL.md section 6 is the map. The in-app workflow is `_ARCH_SKILL_IN_APP_WORKFLOW` in `backend/services/skills_manager.py`, spliced over the `in-app-workflow` marker.  Keep the `local-render-workflow`, `local-render-files` and `in-app-workflow` markers in SKILL.md.

**Merge/rebase conflicts in the generated artifacts** (the arch `reference/component-catalog.md` generated blocks + the two renderer HTMLs) — **don't hand-merge them.** They're derived from `platform-architecture.ts` (+ `standalone.tsx`), which merges cleanly on its own. Resolve each conflicted artifact to *either* side (e.g. `git checkout --theirs`), finish the merge/rebase, then run `cd app && bun run build:arch-skill` to **regenerate them from the merged source** — that produces the correct combined result (e.g. one side's renamed ids + the other's node sizes). Commit the regen.

## Live collaboration on the architecture canvas (WS)

The Architecture tab supports **N-user live editing**: shared cursors, live edits, and AI-agent takeover — all over ONE WebSocket per project. It's **in-app only** (never the standalone skill / read-only previews — the collab hook is gated `enableCollab && !onSave && !readOnly`, so the standalone canvas is byte-identical to before).

**Transport + hub (backend).** `services/collab.py` = an in-process `CollabHub` (singleton, like `ActiveStreamManager`), one `CollabRoom` per project. `routes/collab.py` = the `@router.websocket("/api/projects/{id}/collab")` endpoint (WS auth reuses `_get_project_access`; identity from the same `X-Forwarded-Email`/`-Preferred-Username` headers HTTP uses). Fan-out is plain asyncio — **single-replica only** (the hub is behind a tiny surface so a future multi-replica story could swap in Postgres `LISTEN/NOTIFY`, but that's not built). Frames (small JSON): `presence`/`writer` (roster + who persists), `cursor` (in FLOW coords, so a peer's cursor maps correctly at any zoom/pan), `op` (an edit — a whole serialized tab body, server-stamped `seq`), `snapshot` (full `architecture.md` for late-joiners + agent takeovers), `ping` (liveness).

**The collab doc must keep everything the file means** (`collab/ydoc-model.ts`). The top-level node ORDER is layout in the nested format, and the edge order is what the author wrote: both are stored per tab as one LWW value (`nodeOrder`/`edgeOrder`, never written to the file), and `META_KEYS` must list every tab-level field (incl. `layout`/`gap`/`align`/`justify`/`cols`/`equal`). Sorting nodes by id once moved every diagram's sources to the right on the first canvas save. `scripts/test-arch-roundtrip.ts` (in `test:layout`) runs all 28 skill references through every save path (canvas save, re-measure, multi-tab, collab join, collab edit) and fails on any change: run it after touching any of them.

**Consistency model — one elected WRITER + per-object LWW.** Exactly one room member (first editor in; re-elected on leave) PERSISTS `architecture.md`; everyone else applies ops and never saves (kills the multi-writer clobber). Client `isWriter` is TRUE only when the server confirmed our connId — a fresh joiner is NOT a writer until confirmed (closes the election-window double-persist race). Remote ops apply through the diagram's existing re-seed path in `platform-diagram.tsx` (the "Live collaboration" section there: `applyRemoteOp`/`applySnapshot`/writer-gated `writeTabs`), ordered by `seq` (stale/out-of-order ops dropped).

**AI-agent takeover (the unification).** The agent always writes `architecture.md` on disk → the file-watcher `sync_callback` in `lakebase.py` calls `hub.maybe_broadcast_external_write`, which broadcasts a `snapshot(source:"agent")` so every client hard-reseeds + shows a toast. A **content-hash echo-guard** (`note_saved` on the `saveProjectFile` route + `note_baseline` on join) tells the agent's write apart from the room writer's OWN save — so a human save never triggers a false takeover.

**Ghost reaping / dev gotchas.** The client heartbeats a `ping` every ~8s, hidden tabs included (stopping it would get them reaped and rejoin in a loop); the server reaps a socket silent for ~60s (`MAX_MISSED` idle windows) — this drains half-open ghosts that a `send` wouldn't error on. The `use-collab` effect cleanup closes an abandoned CONNECTING socket **on open** (React StrictMode dev double-mount would otherwise leave a ghost member → the "count doubles" bug). **DEV ONLY:** `vite.config.ts` must set `ws: true` on the `/api` proxy or the collab WS upgrade is dropped behind Vite (prod serves one origin, no proxy — unaffected).

**Sharing model + "Share live".** Two access paths (owner-managed, `share-dialog.tsx`): (1) **email invites** (`ProjectShare`, viewer/editor, accept-to-grant — the pre-existing path); (2) **"Anyone with the link"** — a new `Project.link_access` field (`none`/`viewer`/`editor`, migration `v16`) that `_get_project_access` honors so any signed-in app user who opens the URL gets that role WITHOUT an invite (set via owner-only `PATCH /projects/{id}/link-access`). The canvas floating toolbar has a **"Share live"** button (badge = live member count) that opens the dialog prefilled with `window.location.href` (the deep link incl. `?tab=architecture&archTab=…`). A URL carrying `?archTab=` implies the Architecture tab even without `?tab=`, so a shared link mounts the canvas (+ its collab room) on open.

## The architecture skill: two modes + the render/feedback loop

The `databricks-architecture` skill (`.claude/skills/databricks-architecture/`) is **one source of truth, consumed two ways.** There is a single skill dir on disk — `SKILL.md` + `reference/*.jsonc` + `renderer/` (the standalone viewer/editor HTMLs plus `render-arch.mjs`, `inspect-arch.mjs`, `render-arch-tabs.mjs`, and shared `browser-lifecycle.mjs`). The HTMLs and renderer helpers are BUILT from the app: `cd app && bun run build:arch-skill` (= `build-architecture-skill.sh`) does 3 steps — (1) `gen:arch-skill` regenerates SKILL.md's catalog/icon-bank, (2) `build:arch-standalone` builds the two HTMLs from `ui/standalone.tsx` via `vite.standalone.config.ts` (ARCH_MODE=viewer|editor), (3) copies the HTMLs plus every renderer helper from `app/scripts/` into the skill's `renderer/`. **This is a dev-time step you run before committing — it is NOT run at app start.** The renderer scripts' sources of truth are `app/scripts/`; the skill copies are build artifacts — edit the sources, not the copies.

### Mode 1 — Pure skill (standalone, outside the app)

`install.sh` (or a repo tarball) installs the skill dir **whole, including `renderer/`** (`arch-browser.js` must sit next to the `.mjs` scripts: they read the shared layout check from there), into `~/.claude/skills/` (or `./.claude/skills` with `--project`). `install.sh` installs BOTH `databricks-solution-builder` AND `databricks-architecture` (a `SKILLS=(…)` array it loops over). With no app around, the agent's feedback loop is **file + headless-browser**:

```
node renderer/render-arch.mjs my-arch.json           # → my-arch.png (the agent writes plain JSON)
node renderer/inspect-arch.mjs my-arch.json          # → layout check
# read my-arch.png, fix the JSON, repeat; use render-arch-tabs.mjs for every tab
node renderer/embed-arch.mjs my-arch.json            # → my-arch.html, the editor with the JSON inline (--viewer: read-only)
```

The agent never edits the HTML: the page templates are ~4 MB (the whole renderer). Until 2026-11-11 the skill said "copy the editor HTML and replace its inline JSON", and the eval showed every agent writing its own splice script (inline Python, `inject.py`, sometimes outside the project) and grepping the 4 MB file; the scripts already took `.json`/`.md`, so the workflow now authors a `.json` and embeds once (`embed-arch.mjs`, built from `app/scripts/`).

`render-arch.mjs` and `inspect-arch.mjs` drive **`chromium-headless-shell`** (Playwright's minimal headless build — `npx playwright install chromium-headless-shell`) over CDP. The renderer now kills the browser's whole process group on every exit path and uses a pipe-EOF watchdog for hard kills; `ARCH_TIMEOUT_MS` caps hung runs. `inspect-arch.mjs` checks visual node/text overlaps, **box∩box overlaps** (`BOX OVERLAPS` — a container is exempt from NODE OVERLAPS because it legitimately contains its children, so two phase boxes growing into each other scored a clean 0 before this check existed), tiles straddling a box border (`BOX STRADDLE`), box/title collisions, label collisions, edge-through-tile paths, clipped text, and console errors. `render-arch-tabs.mjs` renders and checks every tab sequentially. `findChrome()` auto-discovers the shell in the Playwright cache (falls back to full chromium, then system Chrome; `CHROME_PATH` overrides). SKILL.md ships this local render-loop workflow intact.

### Mode 2 — In-app (Solution Builder)

Two layers:
1. **Wheel/build:** `app/scripts/build.sh` packages the **full** skill dir (incl. `renderer/`) into the wheel — the backend also serves `architecture-editor.html` for its viewer feature.
2. **Per-project, at RUNTIME:** `skills_manager.copy_skills_to_project()` copies the skill into `<project>/.claude/skills/` **excluding `renderer/`** (no Node and no renderer copy inside the app; rendering is the app's own tool), and calls **`_localize_arch_skill_for_app(SKILL.md)`** — which strips the `local-render-workflow` / `local-render-files` marker blocks and injects the `in-app-workflow` block (the `_ARCH_SKILL_IN_APP_WORKFLOW` text). So the in-app flavor is **derived at project creation, not a second build** — no drift risk.

**The in-app agent renders its own work through a tool, inside its turn:** `mcp__arch__render_architecture` (`backend/services/arch_tools.py`, an in-process SDK MCP server built per pooled client in `agent.py` and bound to that project's directory). It renders `architecture.md` through the SAME `architecture-viewer.html` the Architecture tab uses (`arch_render.py`), runs the layout check, and returns a JSON fault summary plus the overview PNG as an image block. `tab` picks one tab (default: every tab); `crop` returns a zoomed view (a region name or `{x,y,w,h}` fractions). The overview's long edge is capped at 1568px; the PNGs land in `<project>/.claude/arch-renders/` (not synced). **Budget: 3 renders per agent turn** (`reset_turn()` at every turn start; a busy renderer refunds its attempt). No Node runs in the app.

- **One layout check, two hosts.** The checks live once, in `scripts/arch-browser.js` (copied into the skill's `renderer/` by `build-architecture-skill.sh`). `inspect-arch.mjs` and `render-arch.mjs` read it for the standalone CLI; `arch_render.py` evaluates the same file with Playwright. A rule change is one edit; `scripts/eval-arch.ts` and the in-app tool then agree by construction.
- **One browser pool.** `backend/services/headless_browser.py` owns the shared slots (`BROWSER_SLOTS_MAX = 2`) used by the render tool AND the brand service's screenshots (`brand_service.py` takes `browser_slot()` in place of its old lock). A render waits up to 20s for a slot, then answers "busy, retry". Each render runs in its own child process (own process group, 90s hard cap, SIGKILLed on every exit path). Nothing stays warm between calls. `services/shutdown.py` also SIGKILLs any in-flight browser group on SIGTERM.
- **Environment.** The browser is the headless shell `start.sh` installs for the brand service; the child gets `BROWSER_LD_LIBRARY_PATH` → `LD_LIBRARY_PATH` through `headless_browser.browser_env()` (never on the parent).
- **Fallback.** If the tool is busy or fails, the agent proceeds from the JSON. The canvas snapshot below still exists: it only refreshed when the user focused the chat, so it can lag the canvas and is not the agent's render.

The canvas snapshot loop (the fallback, and what `architecture.png` in the project root is):

```
agent writes architecture.md  →  ReactFlow canvas re-renders live
user focuses the chat input  +  diagram changed since last snapshot
   →  browser screenshots the .react-flow canvas (html-to-image; right-side panels are OUTSIDE it, so excluded)
   →  PUT /api/projects/{id}/architecture-snapshot  (base64 PNG; operation_id saveArchitectureSnapshot, project_files.py)
   →  backend writes <project>/architecture.png
agent reads architecture.png to SEE its work → iterates
```

The capture is **lazy + change-gated**: a dirty flag (`archDirtyRef` in `project.$projectId.tsx`) flips whenever `architectureContent` changes (agent rewrite or user edit); `captureArchitectureIfDirty()` fires on the chat input's `onInputFocus` (wired via ChatPanel's `onInputFocus` prop) — so it captures at most once per edit-session, not on every drag. Best-effort: if the Architecture tab isn't mounted, `captureDiagramPngDataUrl()` returns null and it skips. The localized SKILL.md + the Architecture-tab context hint both tell the agent to read `architecture.png`.

| | **Mode 1 — pure skill** | **Mode 2 — in-app** |
|---|---|---|
| Ships `renderer/`? | yes | no (per-project copy excludes it; the app serves the viewer from the wheel) |
| Node needed? | yes (`node renderer/*.mjs`) | no |
| SKILL.md | full (copy-an-HTML render loop) | localized (names `mcp__arch__render_architecture`, budget, stop rules) |
| Render surface | headless-shell → PNG file | `arch_render.py` in the backend, shared 2-browser pool, child process per render |
| Feedback | `my-arch.png` via `render-arch.mjs` + `inspect-arch.mjs` | the tool's image block + JSON `faults`; `architecture.png` is only the canvas snapshot fallback |
| Browser dependency | `chromium-headless-shell` | the shell `start.sh` installs (busy/err → proceed from JSON) |

### Diagram styles, redraw-from-image, icons

- **Showcase.** `/architecture-showcase` (`ui/routes/architecture-showcase.tsx`, linked as "Architectures" in the top nav and sidebar, and as "See what I can do" under the Architecture tab's CTA; rendered inside `AppLayout`) shows real one-shot prompts next to the unedited diagram, each rendered live by the read-only `PlatformDiagram`. Content = `ui/public/architecture-showcase.json` (`{id,title,style,prompt,renders,seconds,architecture}` per item), refreshed from in-app runs of the text benchmark; only add diagrams a reviewer rated clean.
- **Styles.** The home Architecture tab shows style cards — `marketing` (default), `technical`, `lifecycle`, `networking`, and `match` (preselected when an image is attached). The choice adds a `Diagram style:` line to the opening prompt via `buildArchitectureFirstPrompt(request, style)` in `ui/lib/auto-build-prompt.ts` (the ONE prompt builder — the eval harness imports it too). Per-style guidance + examples: `.claude/skills/databricks-architecture/reference/style-<kind>.md` (one file per style) and its example `reference/style-*.jsonc` (marketing: `architecture-complete.jsonc`); the card previews (`ui/public/arch-styles/*.png`) are rendered from those examples by `scripts/gen-arch-style-previews.mjs` — re-run it after changing an example or the renderer. Architecture-first sends **no** capability list (the tab has no product picker).
- **Redraw from an image.** `reference/redraw.md`: same representation (boxes, text, groups, connections, arrangement), not a pixel clone; building blocks are `type:"card"` (title + an HTML `body` — sanitized by `ui/lib/card-body.ts` before render, allow-listed tags/style only, grows with its text; legacy summary/desc/chips/tags fold into `body` on parse; title-only = auto-fit centred label), boxes with `titlePos`/`subtitle`/minimum `size`, coloured/dashed edges.
- **Icons.** One icon per concept; every other key is an alias (`ui/lib/icon-aliases.ts`, one resolver). Sets: `file:db/*` (the workspace's own UI icons, Dubois design system, 16px art capped at 32px; Unity Catalog names such as `volume`, `schema`, `materialized-view` are aliases), `file:databricks-line/*` (official Brandfolder pictograms, one file each, coloured per node with `style.icon`), `file:brand/*` (Databricks marks), `file:vendor/*` (partners only), `file:cloud/<provider>/…` (incl. official AWS architecture icons). The skill lists a short preferred-per-concept table; the full list is the generated, build-checked `reference/icons.tsv` (`gen-architecture-skill.ts` + `ui/icons/icon-concepts.json`) — the build fails on any key that doesn't resolve.
- **Tests:** `bun run test:layout` and `bun run test:inspect-labels` cover the pure geometry and the label checker; `bun run eval:arch` is the static gate (references + hostile corpus, 0-fault baseline). The agent-loop harness (`bun run eval:arch-agent`) reads a prompt collection that the public tree does not ship.

### Legacy-format migration nudge

`isLegacyArchitectureFormat()` (`platform-architecture.ts`) detects the OLD pre-flat-file schema (`columns` as objects, no top-level `nodes`). When a project loads a legacy `architecture.md`, the frontend sends the agent `ARCHITECTURE_MIGRATION_PROMPT` **once per project** (guarded by a `localStorage` flag + `legacyMigrationSentRef`) asking it to migrate to the new schema grounded in the README story.

## Skill source of truth and the Genie Code workshop

The skill (`.claude/skills/databricks-solution-builder/`) is the shipped source of truth. Its template app and reference demos (`references/example-luxebeauty{,-simple}/`) are blueprints for a generated demo; they are not runnable in place.

**Genie Code workshop = source folder + build (HTML only).** The workshop's source of truth is `references/example-luxebeauty-workshop/workshop/`: one free-form HTML file per page cell (`notebooks/NN_slug/NN_name.html` + `notebook.json`), all cell styles in `theme.css`, icons in `icons/<name>.svg` referenced as `<i data-icon="name"></i>`, and the page frame in `shell.html`/`shell.css`/`app.js`. `python3 workshop/build.py` (stdlib only; `--check` fails on a stale output) GENERATES `notebooks_html/workshop.html` — a single self-contained file that opens offline. Page title/brand/sub come from `workshop.json`; sidebar entries come from each `notebook.json` `nav`; `workshop.json` `forbid` makes the build fail on leftover story terms. The skill no longer ships Databricks `.py` notebooks. Never edit the generated HTML; `workshop/README.md` has the authoring rules. In workshop mode (`Mode: workshop` in the system prompt) the generator's agent reads SKILL.md and takes **flow B → `DEMO_SKILL_DIR/stages/genie-workshop.md`** (replaces stages 0–5, no gates, mode persists for the project; SKILL.md's shared rules still apply): story → specs + `CONTEXT.md` → rewrite `data_generation/` and run `generate_data.py` (then a few story-check queries) into the project's default catalog.schema from the system prompt (kept; throwaway test data; max 3 fix-and-rerun attempts) → copy `workshop/` into the project, rewrite the cells, build.

## App development (`app/`) — backend + frontend patterns

Full-stack: **FastAPI + SQLModel + Lakebase** backend, **React 19 + TanStack Router + Tailwind v4 + shadcn/ui** frontend. Frontend calls `/api/*`; in dev Vite proxies to uvicorn, in prod FastAPI serves the built frontend statically.

### Backend (`src/demo_prompt_generator/backend/`)

```
app.py       # create_app() + router
models.py    # ALL SQLModel tables + Pydantic schemas (single file)
router.py    # imports + registers all route modules
core/        # _factory (app+lifespan+static), _config (AppConfig), _headers,
             #   dependencies (DI aliases), lakebase (engine, migrations, session)
routes/      # one module per resource: agent, projects, project_files (incl
             #   architecture-snapshot PNG, workshop-kit zip), messages, templates, resources,
             #   skills, config, constants, block_factory,
             #   collab (WS /projects/{id}/collab — live arch editing)
             #   usage (GET /projects/{id}/usage — the chat header "$" chip)
services/    # agent (SDK+streaming), llm_service (FMAPI), file_sync, file_watcher,
             #   skills_manager, template_service, block_factory, system_prompt,
             #   active_stream (agent SSE), collab (live-edit WS hub — see below),
             #   agent_usage (tokens + list-price cost per model response),
             #   chat_images (⌘V images in the chat → context/uploads/ + image blocks)
```

**Agent cost (the chat "$" chip).** `agent_usage` (migration `v22`) holds one row per model response —
main agent AND subagents — parsed from the Claude Code transcripts (`<session>.jsonl` +
`<session>/subagents/agent-*.jsonl` + `.meta.json`). One response spans several transcript lines with
identical usage, so rows are keyed by API message id (upsert). Rows are written at every turn end
(`routes/agent.py`), and `GET /projects/{id}/usage` backfills older conversations from the DB copy of the
transcripts. Cost is priced at READ time from `services/agent_usage.py::PRICING` (copied from Claude Code's
baked-in model catalog — equal to Databricks pay-per-token list prices at $0.07/DBU, no discounts). A custom AI Gateway
endpoint name (no model in it) is priced as `ANTHROPIC_LLM_PRICE_AS` (default `claude-opus-4-7`); an unknown version is priced as the
closest older one of its family and flagged `estimated`. Clearing a chat keeps its usage; deleting the project
deletes it.

- **DI:** use the `Dependencies` class in handlers, never build clients manually — `Dependencies.{Session, Client (app SP), UserClient (OBO), Config, Headers}`.
- **New route:** file in `routes/`, `create_router()`, endpoints with **`response_model` + `operation_id` (both required** — drive client codegen), register in `router.py`.
- **Models — 3-model pattern** in `models.py`: `Entity` (SQLModel `table=True`) / `EntityCreate|In` (Pydantic input) / `EntityOut` (Pydantic output).

### Frontend (`src/demo_prompt_generator/ui/`)

```
main.tsx                 # entry (React Query + Router)
routeTree.gen.ts         # AUTO-GENERATED — never edit
routes/                  # file-based (TanStack): index, project.$projectId (the
                         #   workspace), templates, profile, setup, architecture-showcase… (`projects` is only a
                         #   redirect to `/`: the project list is the home page's "Your work")
components/{ui,project,layout}/   # shadcn primitives / workspace / app shell
lib/custom-api.ts        # ★ hand-written API client (types + fetch + SSE) — the primary client
lib/{config,utils}.ts    # apiUrl() base resolution; cn() class merge
styles/globals.css       # Tailwind + oklch CSS custom properties
```

- **Routing:** file-based; `project.$projectId.tsx` → `/project/:projectId`. Don't edit `routeTree.gen.ts`.
- **API client:** `lib/custom-api.ts` (hand-written, fully typed). `invokeAgent()` returns an `execution_id`, then `streamAgentProgress(id, signal)` yields typed SSE events. `lib/api.ts` is an auto-generated OpenAPI backup.
- **State:** local `useState`/`useRef` (no global store; Zustand present but unused; React Query available but the workspace page fetches manually).
- **Workspace page** (`routes/project.$projectId.tsx`): two panels — left file-viewer (tabs: overview/story/architecture/files/app; workshop projects get summary/story/architecture/workshop/files, no app), right resizable ChatPanel (SSE streaming + reasoning). Owns the legacy-migration nudge + the architecture-snapshot capture (see arch section above) + the workshop-page loader (refetches only on `notebooks_html/workshop.html` writes; while the agent streams it shows "Updated — reload" instead of swapping the iframe).

- **shadcn/ui:** add primitives manually from the shadcn registry into `components/ui/`.
- **Testing:** Playwright E2E in `tests/` (repo root) targets `http://localhost:9000` (prod-mode server, not the split dev ports).

### Home entry tabs + the Genie Code workshop mode

`ui/routes/index.tsx` renders three home entry tabs: **Describe your story**,
**Describe your architecture**, and **Genie Code workshop** (badged "Beta").
The workshop tab is a real working form like the story tab, with two
differences: the capability pool is the **backend allowlist**
(`WORKSHOP_CAPABILITIES` in `backend/core/constants.py`, served per capability as
`genie_code_workshop`; block frontmatter flags are ignored), and the stories are always
**3** (`WORKSHOP_IDEA_COUNT`; refine = 1, refresh keeps its count). Two tabs
(`ui/components/capabilities-panel.tsx`): **Simple workshop** hard-locks `WORKSHOP_SIMPLE`
(the reference workshop minus ML and Feature Store); **Custom workshop** starts from
`WORKSHOP_BASELINE` (everything but Feature Store), every id explicitly selected, so the suggest LLM keeps it and may only add the
open ones (Feature Store). `WORKSHOP_CORE_CAPABILITIES` always stay. A suggest stream applies its
capability pick only if the explicit choices are unchanged since it started (otherwise a
stream begun on Simple would overwrite a Custom selection made meanwhile). The create
prompt points the agent at SKILL.md flow B, `stages/genie-workshop.md` (no auto-build kickoff, no
resource provisioning); the agent system prompt gets a `Mode: workshop` line
(`get_system_prompt(mode=)`, threaded from `project.mode`).

A workshop project (`project.mode === "workshop"`) has tabs Summary / Story /
Architecture / **Workshop** / Files (no App). The Workshop tab renders
`notebooks_html/workshop.html` in a sandboxed iframe (`allow-scripts allow-popups allow-modals`,
no same-origin) and every kit button (the stepper's single workshop action, the tab header, the Summary card) opens the
shared download dialog (`dab-deploy-dialog.tsx` workshop view: 3 setup steps) → **Download the kit**:
`GET /api/projects/{id}/workshop-kit` (`downloadWorkshopKit`) → `<slug>-workshop-kit.zip` → `<slug>-workshop-kit/`:
`workshop.html` (opened in the browser) + a generated `IMPORT.md`, and `<slug>_workshop.zip` (imported into the workspace as-is — Import takes a zip, not a folder; it unpacks to `<slug>_workshop/`):
`README.md` (story + key numbers), `CONTEXT.md` (short primer pointing Genie Code at README + specs), `specifications/` (every name), `data_generation/`. One home per fact: numbers in README, names in the specs.
It is an allowlist (never `.claude/`, `context/`, or the generic project ZIP, which carries
transcripts), built by `build_workshop_kit_zip` in `routes/project_files.py`.
Progress: `README.md` → story, `CONTEXT.md` → spec, `data-check.md` (the data test's
result, written after the phase-3 checks, not in the kit) → data, `notebooks_html/workshop.html` →
workshop ready (`WORKSHOP_HTML_PATH` / `WORKSHOP_DATA_CHECK_PATH` in `build-stepper.tsx`). Each step
reads only its own file (`workshop/` may be copied early). The overview timer shows elapsed time only.
The server keeps a workshop to `WORKSHOP_CAPABILITIES` on create, and a fork of a GENIE_WORKSHOP
template opens in workshop mode (`template_service.fork_mode_for`).

(Run/build commands live under **Quick commands** below.)

## POV deck (not in this build)

The POV deck (a presentation built from the story) is not available in this build: `POV_DECK_AVAILABLE = false` in `ui/components/project/deck-view.tsx` hides its entry points. The deck code is still in the tree but gated off, and its kit is not shipped.

## Key concepts

- **Block** — Markdown file with YAML frontmatter under `references/blocks/capabilities/`. The agent composes these to build a demo's context. (Industry context comes from the generator's industry list + the story itself, not from blocks.)
- **Project** — A user workspace under `app/projects/<id>/` containing generated files + a Claude conversation.
- **Template** (in the generator's sense) — A published project snapshot that other users can fork (NOT to be confused with the `app_template/` Databricks-App template).
- **resources.json** — Per-demo manifest of every Databricks resource that's been created (catalog, schema, pipeline_id, dashboard_id, genie_space_id, documents_volume, app name, …). The agent writes to it during Stage 3 Build.
- **Skill copy refresh.** `copy_skills_to_project` writes `.claude/skills/.sb-skills-stamp`, a fingerprint of the bundled solution-builder and architecture skills. `ensure_project_skills` re-copies when the stamp differs and no turn is running, so a skill change (a new stage, an edited reference) reaches older projects on their next open.

## Documents (PDF) = Genie agent + UC volume — KA and MAS are deprecated

Document Q&A no longer uses Knowledge Assistant or Supervisor Agent (both **deprecated** —
never create them for a new demo). The capability is **`unstructured-documents`** (block
`references/blocks/capabilities/unstructured-documents.md`, requires `genie`, hidden in the
Genie Code workshop):
1. PDFs (generated as before) are uploaded to a **dedicated UC managed volume** — the WHOLE
   volume gets indexed, so nothing else goes there.
2. The volume is listed in the Genie agent's `serialized_space.data_sources.volumes[{path,
   description[]}]` + a text instruction routing numbers→tables, policies/procedures→documents.
   `create-space` / `update-space` **auto-enable content search** — there is no enable API.
3. Build waits on the private `GET /api/2.0/volume-indexes/{volume_id}` until `state ==
   "SUCCEEDED"` (`deploy_genie.py` does this). Asking before that fails with
   `volume_content_search_failed`.
4. Documents are answered **only in Agent mode** (`POST /api/2.0/genie/agents/{id}/responses`,
   SSE). Chat mode (`start-conversation`, `genie ask`) ignores volumes. The template app's
   `server/agent/tools/genie.ts` is the Agent-mode client (`ask_data`).
5. Askers + the app SP need `READ VOLUME` on the volume and `CAN RUN` on the agent. Resource key:
   `created_resources.documents_volume` = `/Volumes/<cat>/<sch>/<vol>`.

**The build recipe lives in the block's "How to build it" section** (`unstructured-documents.md`), and
`stages/03.1-build.md` + `02-write-specs.md` point there. The `databricks-genie-agents` DAS covers the rest of
the agent (tables, instructions, Agent-mode query loop) but does **not** document `data_sources.volumes`
or the volume index, so the block must stay self-sufficient for that part. **Home page:** in "Simple
solution" the documents capability is a "+ PDF documents" chip (`capabilities-panel.tsx`) and is NOT
hard-locked off like other extras: until the user flips it, the suggest LLM adds it when the brief
explicitly asks for answers from PDFs/policies (the suggest prompt's "an explicit ask wins" rule).

**All seed templates are migrated** (2026-10-24): every one runs a single Genie agent (tables +
its documents volume) — no seed template ships a KA or MAS any more. **Legacy:** code that reads /
shares / renders EXISTING KA/MAS in users' old projects (ownership reconcile, URL patterns, icons,
capability meta, arch catalog entries flagged `deprecated: true, replacedBy: "genie"` — hidden from
the palette + generated skill catalog, still rendered with an edit-mode "Deprecated" pill) stays.
**Stale volume index:** a `SUCCEEDED` index can report too few `success_files` and never refresh —
`deploy_genie` waits for `success_files >= <files in the volume>` and fails loudly otherwise; the
fix is a fresh volume (an index can't be deleted or re-enabled from outside). 

## Architecture from an existing project (the workspace-scan prompt)

The home page's architecture tab has **From an existing project…** (`ui/components/scan-prompt-dialog.tsx`):
the user gives a starting resource (pipeline, job, dashboard, app, table: URL or name), optionally the
workspace (else taken from the URL), and **High level / Detailed**, and copies a prompt for their OWN agent
(one that can run the Databricks CLI in that workspace). That agent explores the project **read-only**
(the starting point → the bundle's `databricks.yml` → `system.access.table_lineage` → `system.query.history`
by `query_source` ids → the resources next to it), writes a brief with every resource and its full URL, and creates
the architecture through the `solution_builder` MCP tool (`create`, mode architecture). **The prompt checks that
tool first and stops before exploring when it is missing** (the user asked: no silent paste fallback). One text,
`backend/services/workspace_scan_prompt.md`, filled by `services/workspace_scan.py::scan_prompt`, served by
`GET /api/architecture/scan-prompt` (the button) and `GET /api/mcp/scan-prompt` (the MCP; the architecture guide
points to it). **No structured MCP field**: the brief is plain text with URLs in `request`. Diagram nodes carry the
links as `url` (never drawn; the view-mode panel's "Open in workspace" uses it; only http(s) kept). Fix the prompt only with general CLI
facts and method, never with something that only holds for those demos.

## MCP routes: building for a user from an MCP server (`/api/mcp/*`)

An MCP server holds the connection and the user's identity. It calls Solution Builder **as its own service principal** and names the user in **`X-MCP-Caller-Email`** (any valid email). `routes/mcp.py::mcp_caller` honors that header
**only from `MCP_CALLER_SP_ID`** once deployed (SP id read from the proxy's `X-Forwarded-Email` /
`-Preferred-Username`, a UUID or the tail of `workspaces/…/apps/<uuid>`; the named user must be a valid email; any other caller is a 401, never ignored). Locally it's open (no header = the dev user).
"Deployed" = a proxy `X-Forwarded-Email` OR the Apps runtime (`DATABRICKS_APP_NAME`), fail closed.

The request then runs **as that user**: they own the project, and the build runs as the
**deployer SP** in the remote target (Model 3) with ownership reconciled to them, exactly like a
human's project. The MCP server's token is **dropped** (`token=None`, `delegated_by=<sp>`; `detect_mode`
treats `delegated_by` as deployed), so it can never become a build identity; `create` refuses
(409) when the deployment has no remote target. Routes: `GET guide` (Markdown for the agent: the
overview of the three kinds, or `?mode=story|architecture|workshop` = that kind's guide with its options —
capabilities + defaults, or diagram styles — read live from the home page's sources; no separate
values endpoint, as the other read routes do), `POST create {mode, request, capabilities?, style?}` (story | architecture | workshop;
calls `create_project` + `invoke_agent` itself, since no browser opens the page to auto-kick the
turn; answers the project link), `GET projects` (the user's own + accepted-shared projects, newest
first, `?query=` searches name/description/customer; `?id=` = one project: running, stage, last
message and `resources`, the deployed links, from the same `get_deployed_resources` as the UI's
resource grid — the list carries no resource links, as each needs the LLM extractor).
The opening prompt is the home page's, mirrored in `services/opening_prompt.py` (from
`index.tsx` handleCreateProject + `ui/lib/auto-build-prompt.ts`). Config: `MCP_CALLER_SP_ID` (bundle var `mcp_caller_sp_id`; empty = closed, every deployed call is refused).

## Grounding a demo in real UC tables — scan → grounded suggest → fit ranking

Story tab, **"Use synthetic data" OFF** → the `GroundingTablePicker` panel. The user picks
real UC tables and the demo is **built DIRECTLY on those exact tables, READ-ONLY** —
dashboards, Genie, metric views query them in place; **no synthetic data is generated, the
tables are not copied, and they are never written to or modified**. (This replaced the earlier
"schema blueprint → synthesize a matching replica" behavior; if you see prose about generating
matching synthetic data in the grounded flow, it's stale.) This is a **consultative
recommender, not a gate**: we scan the tables, suggest use-cases, and signal which ones the
data best supports. (NOTE: the older
`/api/grounding/analyze` + `discover`/`validate` + typed-`gaps`/`verdict` +
`data-gap-analysis.md` model was **removed** — `services/grounding_analysis.py`,
`ProjectCreateRequest.grounding_analysis`, and `grounding-fit-report.tsx` no longer exist.
Don't reintroduce those names.)

**The flow (frontend `index.tsx` `commitGrounding`):** pick tables → `POST
/api/grounding/scan` (`routes/grounding.py`) warms the process-level scan cache → run the
grounded capability-suggest stream (`POST /api/capabilities/suggest`, `routes/constants.py`)
→ ideas stream into the cards, **best-fit-first, each with a fit badge**.

**The picker only offers what the USER can SELECT.** The demo build queries the real tables
**as the user** (agent auth = the user's profile / OBO token), but the resource-listing
endpoints run as the app SP and `.list()` returns *visible* (BROWSE-able), not SELECT-able,
objects — so the picker used to offer catalogs the build then couldn't read. Fix:
`GroundingTablePicker` calls `listCatalogs/listSchemas/listTables` with **`selectable_only`**,
which makes `routes/resources.py` list + access-check **as the current user (OBO)** and keep
only objects the user *effectively* holds the right privilege on — **catalogs/schemas gate on
`USE_*`, tables gate on `SELECT`** (`_accessible` → `grants.get_effective(principal=<user>)`,
a control-plane call that works via OBO on Apps, unlike warehouse queries). Traverse-check
granularity (a catalog you can USE but SELECT nothing in still appears, with an empty table
list); **fail-closed per item** (unconfirmable → hidden), with a wholesale-failure fallback to
the unfiltered list so the picker is never empty. Per-securable decisions + per-user visible
lists are cached in `_resource_cache` (5 min, per-user keys). The param defaults off, so other
callers of these endpoints are unchanged.

**The scan** (`services/table_stats.py`, cached ~30 min, keyed by `(host, full_name)`): per
table, `SELECT * LIMIT 4` (schema + samples) + one wide APPROX aggregate (distinct / null% /
min-max / mean-quartiles) + a few low-card `GROUP BY` top-value queries. Bounds:
`MAX_TABLES=20`, `MAX_COLUMNS_PER_TABLE=40`, `MAX_TOP_VALUE_COLUMNS=8`. Best-effort — a
per-table failure is captured on `TableScan.error` and the others proceed.

**Fit ranking (the consultation layer).** `table_stats.derive_capability_signals(scans)` /
`render_capability_signals(scans)` compute **deterministic** signals over the
already-scanned columns (NO extra queries): time columns, numeric **measures** (id-ish names
demoted via `_looks_like_id`), low-card **dimensions** (+ their top values), and candidate
**join keys** (an id-ish column name shared across ≥2 tables). `_append_grounding_tables`
injects that summary into the grounded prompt, and `_build_grounded_system_prompt` makes the
LLM emit each idea with `fit = {tier: "Great"|"Good"|"Possible", reason: "<=12 words"}` ordered
**best-fit-first**, plus a `why` (2–4 conversational, value-first sentences shown on expand)
and `datasources` that span a **coherent multi-table subset** (a fact + the dimensions it
joins — the prompt pushes multi-table stories off the join-key signals, not one lonely table).
The grounded ideas are asked to vary in sophistication (descriptive / diagnostic /
forward-looking). `_normalize_fit` validates the tier server-side; the SSE `idea` event carries
`fit` + `why` (only in grounded mode — absent in synthetic mode). **UI:** the card shows just
the tier badge + hook + linked table chips; the **expanded modal** holds the `fit.reason`
(column/join detail), the "Why this use-case works with your data" panel (`why`), and a
**collapsible** table list. Table names deep-link to Catalog Explorer via
`ucExploreUrl`/`getWorkspaceInfo` (the `TableChip` component). **Fit is a signal, never a
blocker** — it rates how well the real data backs each idea; every idea is still buildable.
The grounded capability defaults DROP `synthetic-data-gen` + ingest (`lakeflow-connect`/`sdp`/
`zerobus`) — the data already exists and isn't generated — and avoid `databricks-apps`+
`lakebase` (their write-back can't run against read-only customer tables). **Unless the user
opts into data-write** (see the opt-in below), which re-enables those write-needing
capabilities.

**Model size.** Grounded suggest runs on **`ModelSize.NORMAL`** (multi-table schema→story
reasoning + fit rating is where `MINI` is weakest; grounded runs are low-volume);
non-grounded suggest stays `MINI`. See the `grounded` branch in `suggest_capabilities`.

**Durability / handoff to the build agent — TWO files carry the discovery analysis.**
`projects.py::_build_source_tables_md` writes `specifications/source-tables.md` — the record
of the real tables the demo is built on READ-ONLY, **schema only** (control-plane
`ws.tables.get()`: columns / types / nullability / comments; every column; capped at 40
tables via the shared `table_stats.MAX_TABLES`). It does **NOT** embed a per-column profile or
capability signals: the **build agent profiles the tables itself**, read-only, off a warehouse
at build time (skill `references/grounding-table-stats.md` + `stages/03.1r-build-on-real.md`
Step 1) — so profiling isn't duplicated server-side and stays fresh. Its header tells the
agent to point every component at these exact tables, NOT generate/copy/modify them, and to
profile them itself. (The home-page suggest/scan still profiles via `table_stats` to rate idea
fit — that path runs pre-project, where there's no agent to delegate to; see above.) **Second
file:** when the client sends a `discovery` payload
(`ProjectCreateRequest.discovery` = `DiscoveryAnalysis`: `chosen` idea + `alternatives[]` +
`reasoning`), `_build_data_discovery_md` writes `specifications/data-discovery.md` — the
chosen use-case (title/hook/why/**fit**), the alternatives set aside, and the capability
reasoning, framed as **AGREED SCOPE**. This is the "keep what the LLM learned during data
discovery" durability file (same pattern as `context/source-brief.md`): the frontend
`handleCreateProject` grounded branch builds `discovery` from the picked idea + the other
`ideas` + `capabilityReasoning`, and the initial prompt + the skill (SKILL.md flow A,
`stages/01-design-story.md`, `02-write-specs.md`, `03.1r-build-on-real.md`) tell the agent to
read it and build the chosen use-case rather than re-deriving/contradicting it. Written only
for a grounded project **and** only when a discovery payload is present (a grounded create
without discovery, or any non-grounded create, writes neither). The chosen idea's `fit.reason`
also still rides into the initial agent prompt next to the picked hook.

**The BUILD actually honors read-only via a dedicated skill fork.** The prompts above only
*ask* for read-only; the authoritative build guide is the **solution-builder skill**, which
was historically built for the OPPOSITE model ("real tables as a blueprint → synthesize a
replica") — so grounded projects still generated data (into an `ai_demo_gen` catalog) until
this fork landed. Now the skill **forks Build by the grounded signal** (presence of
`specifications/source-tables.md`): `SKILL.md` flow A → **`stages/03.1r-build-on-real.md`**
(NOT `03.1-build.md`), whose Step 1 **verifies the real tables are readable and builds
read-only components on them — no data-gen, no SDP**. `03.1-build.md` Step 1 carries a
wrong-fork guard; `stages/01`/`02` + the `synthetic-data-gen` capability block were flipped to
match. **Read-only REPLACED the blueprint-synthesis model** — no `discover`/`validate`, no
blueprint synthesis.

**Data-write opt-in (the hybrid).** A grounded demo is read-only analytics by default. The
`GroundingTablePicker` panel has an **opt-in checkbox** ("Let the demo add its own supporting
data", default OFF) → `ProjectCreateRequest.allow_data_write` /
`SuggestCapabilitiesRequest.allow_data_write`. When ON: the demo MAY create **auxiliary**
tables in its OWN catalog (so apps/ML/write-back work) — **the user's real tables stay
read-only either way.** Backend: `projects.py::_resolve_capabilities` drops the write-needing
set (`_GROUNDED_WRITE_CAPABILITIES`) from `resources.json` unless opted in;
`_build_source_tables_md`'s header records the opt-in state; `_build_grounded_system_prompt`
swaps its capability rules on the flag; the initial prompt + `groundingNote` (index.tsx) carry
a `dataWriteNote`. The skill's `03.1r` fork + flow A read that opt-in from the source-tables.md
header / opening message.

**The "Your data" overview card.** `project-overview.tsx` renders a read-only "Your data" card
under the hero for grounded projects — detected by the presence of
`specifications/source-tables.md` (parsed client-side for the table FQNs via
`parseGroundingTables`; opt-in state via a `Data-write opt-in: ENABLED` header match). It
deep-links the catalogs/schemas/tables to Catalog Explorer (`ucExploreUrl` + `getWorkspaceInfo`)
and flags that the demo runs read-only on the real data.

If you change the `fit`/`why` shape or the capability-signal fields, keep these in lockstep:
`table_stats.derive_capability_signals`/`render_capability_signals`, the grounded prompt +
`_normalize_fit` in `routes/constants.py`, the `IdeaFit`/`UseCaseIdea` types (incl. `why`) +
the card/modal rendering + the `TableChip` deep-links in the UI, and this section.

## Lossless intake of a big brief (`context/source-brief.md` + `context/uploads/`)

**The problem this solves:** when a user pastes a long, well-thought-out spec, the demo used to "dumb it down." The transport was never the culprit — the typed text reaches `client.query()` verbatim and is persisted as a `Message`. The losses were: (1) **uploaded files were hard-truncated** — `uploads.py::MAX_CHARS_PER_FILE` was 30 KB and `file_extraction.py::MAX_TABULAR_ROWS` was 10, so a multi-page spec doc / spreadsheet got cut before it ever hit disk; (2) **the skill funnelled every brief through a README rewrite** and the agent's *compressed* README became the on-disk source of truth, so across Stage 1→2→3 + context compaction the rich brief dropped out of context while the summary persisted, and the agent re-grounded on its own summary.

**The fix (three moving parts, keep them in lockstep):**
- **Caps raised so real bounds govern, not arbitrary content limits:** `MAX_CHARS_PER_FILE = 2_000_000` (per-file extracted-char cap) and `MAX_TABULAR_ROWS = 200_000` (CSV/XLSX row cap). The row cap is deliberately NOT the binding limit — a CSV can be a *data dictionary* where every row is a column definition (a 60-table schema ≈ 1,200 rows), so clipping it loses the schema. The true bounds are the route's **10 MB raw-byte cap** (bounds memory) + the char cap (bounds context); the row cap just backstops a pathologically tall file, set well above what 10 MB can hold so CSV survives intact like `.md`/`.txt`. The cheap home-page *suggest* LLM is protected separately by the frontend's `SUGGEST_CONTEXT_MAX` (~50 KB) re-cap, so raising these doesn't bloat that call. Don't lower a cap without re-checking that a large schema or CSV still survives intact.
- **Durable verbatim brief:** `ProjectCreateRequest.source_brief` carries the user's RAW typed text (frontend passes `topic.trim()`, stripped of the "Help me build…" wrapper / capability line / brand+kickoff appendix). When it's substantial (**≥ 280 chars**, in `routes/projects.py`) it's written verbatim to `context/source-brief.md`. The frontend also appends a note to `initial_prompt` (same ≥280 threshold) pointing the agent at that file. Below the threshold (a one-line topic) no file is written and no note added.
- **Skill honors it:** SKILL.md Stage 0 + `stages/01-design-story.md` + `stages/02-write-specs.md` tell the agent to read `context/source-brief.md` (and `context/uploads/`) FIRST, treat it as authoritative, and defer to it whenever it's richer than the derived README. The README is explicitly a *presenter summary*, never a replacement for the brief.

If you touch any one of these, keep the ≥280 threshold consistent across `routes/projects.py` and `index.tsx`, and keep the skill instructions pointing at the real filename.

**Supported upload types:** `file_extraction.SUPPORTED_EXTENSIONS` = text types (`.pdf .xlsx .csv .docx .md .txt .json .yaml .yml .html .xml .log`) **plus image types** (`.png .jpg .jpeg .webp .gif`, in the `IMAGE_EXTENSIONS` subset). Images extract to EMPTY text — `extract_text` short-circuits them (no parser runs); they ride along as the base64 `original` only, so the multimodal agent reads the screenshot directly (and `projects.py` skips the empty `.extracted.md` sibling for them). The home-page `<input accept=…>` lists both sets. **Known gap:** `.sql` is still NOT supported — a raw `.sql` DDL gets a 400; a schema uploaded as `.txt`/`.md`/`.csv` works, add `.sql` (plain-text decode) if it comes up.

**Verified end-to-end (live-app API tests, 2026-07-24):** a pasted 4.5 KB pharma-logistics spec and an uploaded warehouse schema (`.txt` DDL + 46-row CSV dictionary) both drove generation with **100% of specifics preserved into the generated specs** — exact `mfx_*` table/column/type names, enum values, and business rules (e.g. the agent correctly noted the rolling-30-day acceptance must be *derived from the tenders table*, not read from the static scorecard column). Large-schema intake (116 KB / 1,201-row CSV) survives with the tail intact.

## Initial (seed) templates — `initial_templates/`

The pre-built **official** templates seeded into the DB on startup (so a fresh workspace has a gallery to fork from). **Each template folder has its OWN `manifest.json`** (there is no top-level manifest — folders self-register by dropping one in; see `seed_templates.py`) with `id`/`name`/`customer`/`industry`/`narrative` ; **`id` == the folder-name slug** (stable, not a UUID). `industry` MUST be one of `backend/core/constants.py::INDUSTRIES`. The manifest is gallery metadata — it is NOT shipped into forks.

**`dbdemos_tracker` (manifest) = the usage-tracker app id.** Every template app ships `server/lib/tracker.ts`
(a JS port of the Python `dbdemos-tracker`: one APP-VIEW event per page load, `@databricks.com` users sent as
a sha256 hash only). Its id must be unique per demo: a seed template uses its template `id`
(`manifest.dbdemos_tracker.app_id` == `app/config/app.json` `dbdemosAppId`, or the `DBDEMOS_APP_ID` bundle env
for AML); a fork is rewritten to `<template-id>-<resource_suffix>` (`template_service._unique_tracker_app_id`);
the skill's app_template ships it empty (off) and app.md has the build agent set `<demo-slug>-<resource_suffix>`.

**`live_demo` (manifest) = where the demo is deployed, for the demo catalog.** Templates that are deployed live carry a `live_demo` block: `workspace`/`workspace_id`/`profile`, `data {catalog, schema, url}`, `workspace_folder {path, url}`, `app {name, url}`, `dashboard {id, url}`, `genie_space {id, url}`, `setup_job` and/or `pipeline {id, url}`, `documents {path, url}` (the Genie agent's documents volume), `ml_model`, `lakebase {project, database}`, `demo_questions[]`, `last_verified`. After changing any live resource, update the block — every link must resolve.

**"Try it live" in the gallery.** At startup the seeder passes `live_demo` through `services/live_demo.py::build_live_demo(block, app_workspace_host(ws))`, which keeps it **only if the manifest's `workspace` is the same workspace as this app** (`DATABRICKS_HOST`, or the SDK host locally). Everywhere else it's dropped, so a deployment never links users into someone else's workspace. The render-ready result — ordered `assets[{kind,label,url}]` (app, dashboard, genie, documents, pipeline, job, model, data, folder) plus `demo_questions` — is stored in `Template.live_demo` (JSON text, migration `v21_template_live_demo`). It's part of the seed signature, so moving the app to another workspace refreshes it. The API exposes it as `TemplateDetail.live_demo` + `TemplateListItem.has_live_demo`; the UI shows a "Try it live" band in the template modal header (`gallery/live-demo-panel.tsx`, architecture brand icons) and a "Live" pill on the tile. The public build's seed templates carry no `live_demo` block, so "Try it live" never shows; the code path stays.

**Deploying a seed template.** Each template is a Databricks Asset Bundle with one portable target (see the rules below). Deploy it with `databricks bundle deploy -t <target>`, then run its setup job and app with `databricks bundle run <key> -t <target>`; the template's `databricks.yml` names the keys.

DAB rules every template follows (keep them): (1) **one portable target with no pinned host** (`default`, or `dev`/`prod` on `aibi-*`) — forks and "Download DAB" deploy it into any workspace with `--var warehouse_id=…` (+ Lakebase project/role vars);  (2) **The app never has hand-copied IDs**: no `app/app.yaml`; env lives in the bundle `apps.<key>.config`, and the setup job writes the Genie agent id (+ documents volume) to `<catalog>.<schema>.demo_resources`, which the app reads at boot + per request (`server/services/resources.ts`). (3) The setup job grants the app SP UC access (incl. READ VOLUME on the documents volume) + CAN_RUN on the Genie agent (the app's `ask_data` falls back to the SP when the viewer's OBO token lacks the Genie scope). (4) **Genie reuse is scoped**: reuse only when the space's tables are under this catalog.schema (or its parent_path is the demo folder) (other users in the same workspace may have same-titled dbdemos spaces; a fork in that workspace must not repoint the canonical demo). (5) Dashboard JSON is schema-less (no catalog in it; metric-view `asset_name` datasets become `SELECT … MEASURE() … GROUP BY ALL` SQL datasets); no `/` in dashboard names. (6) Generators are seeded / as-of anchored so upgrades don't move the story. Hard-won gotchas: serverless has no `__file__` and rejects `.cache()`; bundle `volumes:` break a first deploy on an empty schema; target overrides APPEND app env lists.

**Seeding is a SMOOTH UPSERT keyed by folder-name id** (`seed_templates.py`), NOT insert-only, and runs **fire-and-forget in a background thread** (`lakebase.py` flips `db_ready=True` BEFORE launching it — the app never waits on seeding; the gallery is briefly empty on a cold first boot, then fills). Per template it computes a cheap **stat-based signature** (`_folder_signature` — hash of each eligible file's `(path, size, mtime)` + the screenshot + metadata, NO content reads) and: **skips** if it matches the stored `content_checksum` (fast path — a handful of `stat()`s, no file reads, no BLOB load), **inserts** if the id is new (`official=True`, `status=APPROVED`), or **diff-updates** if it changed — reading the files only then, via the shared `template_service.py::_upsert_template_content(session, id, files)` which touches only changed/added/removed `TemplateContent` rows (unchanged rows keep their ids). File add/remove/rename all change the signature; only a size-AND-mtime-preserving edit is missed (a `touch` re-triggers). Editing a template folder + restarting upgrades it in place, no delete-all churn. Seed reads the short blurb from `resources.json`'s **`short_description`** field → `Template.description`, and loads **`template_screenshot.png`** into the `Template.screenshot` binary column (that file is excluded from the shipped file-set). `update_template_from_project` uses the same `_upsert_template_content` helper. NOTE: seed never prunes — a renamed/removed slug leaves its old DB row (no orphan-delete yet).

**Template model additions** (`models.py`, migration `v13_template_official_screenshot`): `official: bool` (curated), `screenshot: bytes` (hero PNG), `content_checksum: str`. Endpoints: `GET /templates/{id}/screenshot` (image/png), `GET /templates/{id}/export` (streams the template files as a **zip = the deployable DAB bundle**), `PATCH /templates/{id}/official` (admin-only toggle), plus semantic search (`POST /templates/search`, pgvector over each template's embedded README, ILIKE fallback). `TemplateListItem`/`TemplateDetail` expose `official` + `has_screenshot` (list avoids loading the blob — one cheap `screenshot IS NOT NULL` query).

**Current set (27 seed templates):** 7 AI/BI dashboard+Genie demos (`aibi-customer-support`, `-marketing-campaign`, `-portfolio-assistant`, `-supply-chain`, `-sales-pipeline`, `-patient-genomics`, `-cfo-health-budget-variance`), `aibi-app-luxebeauty-returns` (the full-stack flagship — app + Lakebase + SDP pipeline + ML + Genie agent with a documents volume), and 19 full-stack demos (one or more per industry: app + agent + dashboard + Genie agent, most with a documents volume on that agent / Lakebase write-back / UC model), e.g. `fsi-aml-sar-copilot`, `hls-readmission-reduction`, `mfg-predictive-maintenance`, `telco-network-ops-copilot`, `pubsec-cyber-threat-hunting`, `cpg-trade-promotion-roi`.

**AI/BI demo shape** (each demo folder): `README.md`, `resources.json` (top-level `short_description` + `capabilities` + `created_resources` live IDs), `specifications/{01-lakeflow,04-ai-bi}.md` (full-PRD), `data_generation/generate_data.py` (**self-contained, plain `.py`** — folds the medallion SQL inline: raw via Spark → silver `saveAsTable`+NOT NULL+PK/FK RELY → gold enriched → metric view; reads `--catalog`/`--schema` args, ambient SparkSession on Databricks else Databricks Connect), `template_screenshot.png` (→ the `screenshot` column, not shipped as a file), `dashboard/dashboard.lvdash.json` (**datasets are schema-LESS bare table names** — the DAB `dataset_catalog`/`dataset_schema` or `lakeview create --dataset-catalog/--dataset-schema` inject the target, so ONE file works in any catalog/schema, dev or prod), `genie/genie_space.json` (**serialized-v2** format — `data_sources.tables` MUST be sorted by identifier), `src/deploy/deploy_genie.py`, `databricks.yml` (**`spark_python_task`** runs generate_data with `--catalog`/`--schema`; `notebook_task` for deploy_genie; `dashboards` resource with `dataset_catalog`/`dataset_schema` rebind), `dab_instructions.md`. The **luxebeauty** folder additionally has the full app (`app/`) + `src/{pipeline,ml,metric_view,documents,genie,deploy}` + a full multi-task setup-job DAB.

**What ships in a template (the seed/publish/fork payload).** `template_service.py::_should_include_in_template` is an **exclude-list** (was `.md`-only): it ships the whole deployable demo — narrative, specs, data-gen, dashboard/genie JSON, DAB, app source, **lockfiles** (deploy-required) — and rejects only junk (build outputs, `node_modules`/`.venv`/`.databricks`, `dist`/`build`, `.env*`, deploy-state markers, compiled/binary artifacts, **`template_screenshot.png`** — that goes to the `screenshot` column). The fork writer decompresses every stored `TemplateContent` back to the new project's disk verbatim, so a fork is deploy-ready. This gate covers all three paths: seed (`seed_templates.py`), user "publish project as template", and "update template". **Hidden files:** the seeder and the full-sync disk walk (`file_sync.py`) additionally skip every dot-path EXCEPT `file_sync.SHIPPABLE_DOTFILES` (today just `.npmrc` — the app's `ignore-scripts`/`omit=dev` for the Apps container's `npm install`; dropping it broke first deploys of forks). `.env*` stays excluded.

**The gallery** — `ui/components/template/gallery/` (tile + slide-over + `use-gallery-filter`) is the shared UI powering the **`/templates`** page (in-app, `AppLayout`, admin approve/reject/delete/edit overlays): hero screenshot via `templateScreenshotUrl(id)`, `official` "Featured" treatment, industry filter + **semantic search box** (`searchTemplates` → `/templates/search`). The slide-over shows description + capabilities + an architecture preview, a **"Download DAB"** button (`exportTemplate` → the zip), and **"Use this template"** which opens a dialog: *use as is* vs *tune for your use case* (a textarea). The fork calls `createProjectFromTemplate(id, name, adaptInstructions?)`: with instructions → the new project opens with a **user** message asking the agent to review the cloned demo + apply the changes (`_build_adapt_prompt`); without → a friendly assistant greeting (`_build_fork_greeting`).

**Gotchas learned building/porting these (baked into the templates — keep them):** run `generate_data.py` with a **Python 3.12** interpreter (`app/.venv`) — Spark Connect `pandas_udf` needs the client's minor Python == serverless (3.11 fails). Validate live queries via the **CLI on a SQL warehouse** (`databricks experimental aitools tools query`), NOT Databricks Connect serverless (which has `AI_FORECAST` + some preview functions disabled). PK columns must be `NOT NULL` **before** `ADD PRIMARY KEY`; FK child/parent column **types must match** (cast at DataFrame build time — Delta can't `ALTER` INT→BIGINT in place). Genie `create_space`: tables sorted by identifier, title **no `/`** (use hyphen — the space title becomes a workspace item), and only ever trash a space by the exact `space_id` you created (never a title substring). Dashboard `:param` guards need NULL-safety (`size(NULL) = -1`, not 0): `:x IS NULL OR size(:x)=0 OR array_contains(...)`; and dashboard datasets ship **schema-less** (the DAB/`lakeview create` inject catalog/schema). **SDP SQL can't read a hardcoded volume path across catalogs** — use `read_files('/Volumes/${catalog}/${schema}/raw_data/...')` + a pipeline `configuration: {catalog, schema}` block so it works on any target (this bit the luxebeauty pipeline). Deploy-test a DAB with `-t dev` into a throwaway `<slug>_dabtest` schema.

## Quick commands

All from `app/`:

```bash
./scripts/dev.sh              # uvicorn:8000 + vite:5173 + auto-clone databricks_agent_skill
npx tsc --noEmit              # Frontend types
uv run mypy src               # Backend types
bun run build                 # Frontend → src/demo_prompt_generator/ui/__dist__/
npx playwright test           # E2E (needs :9000)
bun run test:layout           # Unit tests for the pure diagram geometry (edge-geometry + label-layout)
bun run eval:arch             # Score diagram quality over the corpus; gates on scripts/eval-arch/baseline.json
bun run eval:arch -- --update  #   …accept the current scores as the new baseline
bun run build:arch-skill      # Rebuild the architecture skill (catalog reference + renderer/) from app code
uv run uvicorn demo_prompt_generator.backend.app:app --host 127.0.0.1 --port 9000  # prod-mode locally (needs bun run build)

# ── Testing the databricks-architecture skill (after ANY diagram-logic change) ──
# The renderer scripts' SOURCE is app/scripts/*.mjs; the skill's renderer/ copies
# are BUILD ARTIFACTS — edit the source, then rebuild. Full loop from app/:
cd app
bun run test:layout                       # 1. pure-geometry unit tests (edge-geometry + label-layout round-trip)
unset NODE_OPTIONS && npx tsc --noEmit     # 2. typecheck (ignore known pre-existing capabilities-panel/index.tsx/flow-edge.tsx errors)
bun run build:arch-skill                   # 3. regenerate reference/component-catalog.md + icons.tsv + BOTH renderer HTMLs from the code
bun run eval:arch                          # 4. score the corpus through the REAL headless-browser renderer; gates on baseline.json
python3 scripts/eval-arch/build-review-index.py   # 5. build a combined per-theme review page → scripts/eval-arch/results/index.html (open it)
# 6. For a specific diagram, render + audit one file through the SAME headless path the skill ships:
#    node scripts/render-arch.mjs <arch.html>     → a PNG to eyeball
#    node scripts/inspect-arch.mjs <arch.html>    → the layout/overlap/edge audit (exits non-zero on faults)
# Then in a browser: open scripts/eval-arch/results/<diagram>.slide.html to see the live ReactFlow render
# (the eval writes per-theme HTMLs). See "The architecture skill: two modes" for the pure-skill (Mode 1) loop.

# ── Generator deployment (Databricks Asset Bundle, defined in app/databricks.yml) ──
# Keep your workspace details in a gitignored overlay: copy the example for your target,
# fill in its profile and variables, then validate and deploy. Substitute `staging` for `prod`.
cd app
cp databricks.prod.yml.example databricks.prod.yml        # → databricks.staging.yml.example for staging
databricks auth login --host <your-workspace-url> --profile <your-profile>   # once, if you have no profile yet
databricks bundle validate -t prod                        # check the config; changes nothing
databricks bundle deploy -t prod                          # upload the bundle (runs scripts/build.sh)
databricks bundle run demo-prompt-generator-app -t prod   # start/restart the app (migrations run on boot)
```

### Headless Chromium in the Apps container (brand-service screenshots)

The brand service (`backend/services/brand_service.py`, `/brand` page) screenshots company
homepages with Playwright's `chromium-headless-shell`. The Apps image has no root and is missing
Chromium's shared libs, so **`app/start.sh` sets it up on every cold boot, before uvicorn**:
(1) downloads the shell straight from `storage.googleapis.com/chrome-for-testing-public`
(`cdn.playwright.dev` times out from the container; `playwright install` is the fallback);
(2) runs apt as the app user (lists/cache under `/tmp/apt`, with timeouts) to download only the
packages the image lacks and `dpkg -x` them into `/tmp/chrome-libs`. That path is exported as
**`BROWSER_LD_LIBRARY_PATH`, never `LD_LIBRARY_PATH`** — only the screenshot subprocess
(`headless_browser.browser_env()`, shared with the architecture render tool) puts it on its loader path, so uvicorn, previews and the agent never load
hand-unpacked libs. Everything goes to `/tmp/pw-install.log`; `GET /api/brands/diagnostics`
(Advanced → Server diagnostics on `/brand`) shows that log, the browsers on disk, the deployed
scraping-dep versions and any libs `ldd` still can't find. Best-effort: if it fails, the
screenshots are skipped and the rest of the app is unaffected.

**Every download in `start.sh` is time-bounded** (it all runs before uvicorn binds the port, and the
platform gives up on a deployment whose port isn't up within 10 minutes). Add a `--max-time`/`timeout`
to any new boot step.

**Old deployment snapshots.** Each app deployment copies the source into
`/Workspace/Users/<app SP>/src/<deployment-id>` and the platform never deletes them (prod had 110,
~57 MB each). `start.sh` prunes them in the background on every boot, as the app SP, keeping the
`SNAPSHOT_KEEP` newest (default 10, `0` = off). Deployment ids are time-ordered hex, so newest = last by
name. Log: `/tmp/snapshot-prune.log`.

### Observability (OpenTelemetry) — telemetry-gated, no-op when off

Enabling the Apps **Observability** option (UI + UC target tables) makes Databricks
inject the OTLP collector env (`OTEL_EXPORTER_OTLP_ENDPOINT` + protocol/headers/attrs)
at runtime. `app/start.sh` detects that var and launches uvicorn under
**`opentelemetry-instrument`** (auto-instruments FastAPI request spans + logs);
otherwise it execs plain uvicorn — **byte-identical to before when telemetry is off**
(local dev, telemetry-disabled deploys). CPU/memory/process metrics are NOT
auto-wired for FastAPI, so `backend/core/observability.py::init_system_metrics()`
(called from `app.py`'s `_build_app`) explicitly starts `SystemMetricsInstrumentor`
when the OTLP endpoint is present. Deps live in `pyproject.toml` (the
`opentelemetry-*` block, incl. `-system-metrics` → pulls `psutil`). Only `OTEL_SERVICE_NAME` is defaulted by `start.sh`; the endpoint/headers are Databricks-injected — never
hardcode them.

### ⚠️ `python3` inside `app/` is a `uv` shim — it rewrites `uv.lock`

`~/.local/bin/python3` is `exec uv run python3 "$@"`. Running **any** `python3` command with
`app/` as the cwd therefore syncs the project environment and can rewrite `app/uv.lock`
(observed: the lockfile `revision` was bumped and the package registry URLs were rewritten across ~950 packages). That looks exactly like an unrelated third-party
change and is easy to commit by accident. Use `node`/`bun` for throwaway scripting here, or
run `python3` from outside `app/`, and check `git status app/uv.lock` before committing.

### ⚠️ Dev database: `RESET_DB` is DESTRUCTIVE — know the mode first

The dev DB mode is chosen in `backend/core/lakebase.py` `_is_pglite_mode()`: PGLite iff `USE_PGLITE=1` **or** `LAKEBASE_DATABASE_PATH` is unset. **Local dev normally sets `LAKEBASE_DATABASE_PATH` in `app/.env` → it points at a real remote Lakebase branch** (a named branch under the shared Lakebase project, NOT prod). So:

- **`RESET_DB=1` does NOT mean "wipe a throwaway local DB."** In Lakebase mode it **DROPS ALL TABLES on the remote branch** your `.env` points at (`lakebase.py:375`); in PGLite mode it deletes `~/.pglite/`. **Never run `RESET_DB=1` — or any test that sets it — against a branch holding real projects.** Point a test at a temp branch/DB instead.
- **A second checkout (git worktree) on a branch with different migrations:** PGLite is one cluster in `~/.pglite/` shared by every checkout, so a branch that added a migration stamps it and other branches then fail at boot with `Can't locate revision`. Run with `USE_PGLITE=1 PGLITE_DB=<name>` to use a separate database in the same cluster (its own `alembic_version`). Never `RESET_DB` to get past this; it deletes everyone's local projects.
- **Recovery:** Lakebase branches are copy-on-write with point-in-time restore. If a branch is damaged, create a recovery branch from a past timestamp (`databricks postgres create-branch … --json '{"spec":{"source_branch":"…/branches/<b>","source_branch_time":"<ISO ts>","no_expiry":true}}'`), verify the data, then repoint `.env` at it. On-disk `app/projects/<id>/` files survive a DB drop regardless — only the DB rows (project metadata, message history) are lost.

### ⚠️ Alembic migrations: NEVER re-parent a released migration (multi-head-skip footgun)

Migrations live in `backend/migrations/versions/` and run on every boot via `initialize_models` → `command.upgrade(…, "head")` (single `alembic_version` row; a `pg_advisory_lock` serializes workers — taken and released on ONE held connection, with a 45s `lock_timeout`, so a process still shutting down can't hang a boot). The chain **must stay a single linear head.**

- **The footgun (this caused a prod outage):** when two feature branches each add migrations off the same parent, merging creates **two Alembic heads**. If you "fix" that by **rewriting the `down_revision` of an already-released migration** to splice the branches into one line, any DB that was **already stamped past the splice point on the *other* lineage** will treat the re-parented revisions as already-applied ancestors — `upgrade head` becomes a no-op and **their DDL never runs**, while `alembic_version` still says `head`. The app boots, then 500s on the missing columns/tables. (2026-08: prod reached `v18` up the template lineage and silently skipped the xws migrations `v13_target_ws_host`/`v14_user_settings`/`v15_ownership_hash`; a fresh DB was fine because its chain was linear from the start.)
- **The rule:** to resolve multiple heads, add an **`alembic merge`** revision (a new node with both heads as `down_revision`). **Do not** rewrite the `down_revision` of a migration that has already shipped to any long-lived DB (prod/staging). New migrations may only be *appended* after the current single head.
- **Boot-time safety net (defense-in-depth):** after `upgrade head`, `initialize_models` calls `_reconcile_schema_drift(engine)` (`core/schema_guard.py::detect_schema_drift`), which diffs `SQLModel.metadata` against the live DB. Missing **tables** are auto-created (`create_all` — safe, no drops); missing **columns** are logged as a loud `MANUAL ACTION REQUIRED` error (the type/nullable/default live in the owning migration, so they can't be synthesized generically — apply that migration's DDL by hand as the owner SP). This turns a silent broken-schema boot into a loud, often self-healed one. 

## CI

The public repository ships no CI workflows. Run the checks listed under Quick commands locally before opening a change.

## Conventions

- **Python**: `uv` only, never `pip`. Use `claude-agent-sdk` (NOT the deprecated `Skill` tool name — pass `skills=` to the SDK).
- **Frontend**: `bun` (install/add). Path alias `@/` → `src/demo_prompt_generator/ui/`.
- **API routes** (generator): `response_model` + `operation_id` required (drives client codegen).
- **Models** (generator): 3-model pattern — `Entity` (SQLModel table) / `EntityIn` (Pydantic input) / `EntityOut` (Pydantic output).
- **Styling**: Tailwind v4, CSS custom properties (oklch). No CSS modules / styled-components.
- **Routing** (generator UI): TanStack Router file-based. Don't edit `routeTree.gen.ts`.
- **Template app stack**: Node + Express (`@databricks/appkit`) + React + Drizzle + OpenAI Agents SDK + mlflow-tracing. Different stack from the generator.
- **Logger** (template `server/lib/logger.ts`): `console.debug` is gated by `LOG_LEVEL` env (default INFO). Use it for per-request chatter; reserve `console.error` for actual failures.
- **Skills are product, not logbooks.** A `SKILL.md` (and its references) is read by the agent that *uses* it, on every run. Write only instructions that change what that agent does: never measurement journals, "an earlier revision claimed…" corrections, pixel anecdotes, engine calibration stats, or notes for people maintaining the scripts. That reasoning belongs in a code comment next to the constant it justifies.

## Operational rules (durable preferences)

- **Confirm before a production deploy.** Validate first (`databricks bundle validate -t <target>`) and deploy a production target only on an explicit request.
- **Architecture HTML defaults to the EDITOR build.** When producing/refreshing a standalone architecture HTML (a customer doc, a shipped artifact, any file a human will open), embed into `renderer/architecture-editor.html`, NOT `architecture-viewer.html` — the viewer is only for an explicitly read-only/final-share page. SKILL.md already says this in the Mode-1 workflow; the failure mode is hand-rolled embed scripts defaulting to the viewer (which also silently drops the Load/Save/Download controls).
- **Template Skeleton component**: use `<Skeleton className="… bg-muted" />` — appkit's default `bg-accent` reads as a brand teal in this theme, not a neutral placeholder.
- **Don't replicate the destination component's layout in a skeleton** — a few plain stacked bars read as a skeleton more clearly than column-matched scaffolding.
- **Show skeleton only on initial load.** Subsequent refetches (e.g. `dataMutated`) must swap data silently — flashing back to skeleton on every agent write is the bug, not the feature.

## How to keep this file accurate

This document is loaded into context at the start of every session. **It is your fastest path to being useful in the first 10 minutes.** Stale content makes you slower than no content. Update it when:

- A **top-level directory** is added or renamed (e.g. if `app/` is renamed).
- A **stack swap** happens (e.g. dropping FastAPI for something else, swapping Tailwind, switching SDKs).
- A **workflow shift** happens (e.g. test-app ↔ template sync model changes).
- A **key file moves** (`agent.py`, `skills_manager.py`, `SKILL.md`).
- A **new dev/build/deploy script** is introduced or an existing one removed.
- A **durable preference** lands (those go under "Operational rules").

- A **new mode / packaging path** of a subsystem appears (e.g. the architecture skill's pure-vs-in-app split, a new render/feedback loop, a new way an artifact is generated or shipped).
- A **destructive-operation footgun** is discovered (like `RESET_DB` against a remote branch) — document the danger, not just the command.

Don't update for: in-flight feature work, bug fixes, refactors that don't move files. Transient, per-session feedback does not belong here.

**One AGENTS.md, at the repo root.** There is deliberately no nested `app/AGENTS.md` — a nested file only loads when you're working under that subtree, so facts would silently go missing. Everything (whole-system picture, app-dev patterns, dangers) lives in this one root file. Keep it that way: don't create per-directory AGENTS.md files; add to the relevant section here instead.

**Filename.** This file is `AGENTS.md` — the cross-agent convention, so Claude Code, Codex, Cursor and the rest read the same memory instead of one per tool. A root `CLAUDE.md` symlink points here for older Claude Code builds that only look for that name; keep the symlink if you rename anything. The **template app's** own `CLAUDE.md` files (`app_template/`, `initial_templates/*/app/`) are a **different thing** — they are product artifacts shipped inside a generated demo, and they stay named `CLAUDE.md`.

**Repo-root sentinel.** `backend/services/skills_manager.py::_find_repo_root()` locates the repo root by probing for this file **by name**. It accepts `AGENTS.md` or `CLAUDE.md`, but if you rename or move this file again, update that probe in the same change or skill resolution silently returns `None`.

When in doubt, **read this file again from disk before relying on it** — code drifts faster than memory.
