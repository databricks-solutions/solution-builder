# CLAUDE.md — Industry Demo Prompt Generator

> **This file is your memory across sessions. Keep it accurate.** When a major change happens (new top-level directory, stack swap, workflow shift, renamed/moved key file, new dev script), update this file in the same change. Better stale-in-one-place than spread-across-three-places.

## What this project actually is

A **system that generates Databricks demos**. Not one app — **three**, plus a skill:

1. **Generator app** (`app/`) — the user-facing tool. FastAPI + React. A user opens it, picks an industry/capability, chats with a Claude Code agent (via `claude-agent-sdk`), and the agent assembles a personalized demo by reading **blocks** from the skill below. Generated artifacts (demo code, specs, app boilerplate, deployable Databricks assets) land in a per-project directory.

2. **Demo-generator skill** (`.claude/skills/databricks-demo-generator/`) — the agent's brain. SKILL.md + reference blocks + stage guides + the template app. The generator's agent reads from here. **The skill is the product; the generator is the UI.**

3. **Template app** (`.claude/skills/databricks-demo-generator/app/app_template/`) — a complete Node.js + Express + React Databricks App that ships *as part of every generated demo*. The agent copies + customizes it. It is **NOT** a sub-component of the generator — it's an artifact the generator emits.

4. **Test app** (`app/test/app_template_test/app/`) — a working fork of the template above (`.claude/skills/databricks-demo-generator/app/app_template/`), used to dogfood + iterate on template changes. **The user's workflow is: fix bugs in the test app, sync to the template.** They must stay in lockstep.

Plus: **ai_dev_kit** (`app/ai_dev_kit/`) — a cloned external repo (`github.com/databricks-solutions/ai-dev-kit`) holding ~26 sub-skills for creating individual Databricks resources (pipelines, dashboards, Genie spaces, KAs, MAS, etc.). The generator's agent uses these during the Build stage.

Versioned **pipeline scenario contracts** live under `evaluation/`. They are
runner-neutral test data and are not imported by or packaged with the deployed
generator app, copied into projects, or exposed through application routes.

## Mental model

```
USER opens generator app (app/)
   ↓ chats with agent
AGENT reads .claude/skills/databricks-demo-generator/
   - SKILL.md → 4-stage workflow (Intent → Design → Spec → Build)
   - references/blocks/{domains,capabilities,patterns}/*.md
   - stages/0X-*.md
   ↓
AGENT writes specs + scaffolds a Databricks App by copying app_template/
AGENT delegates resource creation to subagents using ai_dev_kit skills
   ↓
ARTIFACTS land in:
   - per-project directory (specs, code)
   - the user's Databricks workspace (catalog, schema, pipeline, dashboard, app)
```

## Repository layout

```
industry-demo-prompts/
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
│   │       └── preview/                  # Preview iframe + log streaming UI
│   ├── test/app_template_test/
│   │   ├── app/                          # ★ Test fork of template (parallel-edit with template)
│   │   └── src/                          # ★ Source-of-truth for THIS demo's Databricks assets
│   │       ├── pipeline/                 # SDP SQL (bronze/silver/gold)
│   │       ├── dashboard/dashboard.json  # AI/BI dashboard JSON
│   │       ├── genie/genie_space.json
│   │       ├── knowledge_assistant/      # KA config
│   │       ├── supervisor_agent/         # MAS config
│   │       ├── metric_view/              # UC metric view YAML
│   │       ├── ml/                       # training + scoring script
│   │       ├── data_generation/
│   │       └── documents/                # RAG sources
│   ├── ai_dev_kit/                       # Cloned external repo (not submodule)
│   │   └── databricks-skills/            # 26 per-resource skills
│   ├── databricks.yml                    # DAB config for the generator itself
│   ├── databricks.{prod,staging}.yml     # Deployment overlays (admin emails live here)
│   ├── pyproject.toml                    # uv. claude-agent-sdk>=0.2.83
│   ├── package.json                      # bun. React 19, Vite, TanStack Router
│   └── scripts/{dev,build,release,build-electron}.sh
├── .claude/skills/databricks-demo-generator/   # ★ The skill (the brain)
│   ├── SKILL.md                          # 4-stage workflow
│   ├── stages/0X-*.md                    # Stage-specific guides
│   ├── references/
│   │   ├── blocks/{domains,capabilities,patterns}/*.md
│   │   ├── example-luxebeauty{,-simple}/         # Reference demos
│   │   └── dab/                                  # DAB packaging guide
│   └── app/
│       ├── app.md                        # How to design+spec a demo app (read during Stage 2)
│       └── app_template/                 # ★ The template app emitted by the generator
├── initial_templates/                    # Pre-built seed templates (retail/loyalty-segmentation)
├── evaluation/                           # Versioned pipeline scenario contracts + schema
├── tests/                                # Playwright E2E for the generator (targets :9000)
├── install.sh                            # End-user installer (downloads skill + ai-dev-kit)
└── docs/                                 # Screenshots for README
```

★ = files you'll touch most.

## The agent loop (most important thing to know)

`app/src/demo_prompt_generator/backend/services/agent.py`:

- Wraps `claude-agent-sdk>=0.2.83` (Python). One `ClaudeSDKClient` per project, pooled.
- Streams via SSE: thinking blocks, text deltas, tool calls/results.
- Routes through Databricks Foundation Model API in prod (`ANTHROPIC_BASE_PATH`), direct Anthropic locally.
- The agent gets `CLAUDE_CONFIG_DIR=<project>/.claude` so it reads project-local skills (the demo-generator skill is copied into each project on creation by `skills_manager.py`).
- **The chat panel in the UI is the agent's mouth.** Reasoning/thinking blocks render there.

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

## Template ↔ Test app parallel-edit workflow

The template at `.claude/skills/databricks-demo-generator/app/app_template/` is **duplicated** at `app/test/app_template_test/app/`. Same code, same stack, byte-for-byte (modulo intentional drift — domain-specific config, deployed IDs, etc.).

```
app/test/app_template_test/app/      ←→     .claude/skills/databricks-demo-generator/app/app_template/
        (test fork)                                       (template)
   user edits + tests here                          gets the same edit synced over
```

**Why the duplicate exists:**

The template lives inside the skill and is **shipped** to every generated demo. You can't run it directly — it's a blueprint. So we keep a **runnable, populated copy** at `app/test/app_template_test/app/` with the LuxeBeauty demo's real Databricks resources wired in (Lakebase, MAS endpoint, dashboard, Genie, etc.). That lets us:

1. **Debug** template bugs against a live workspace without spinning up a fresh demo from scratch each time.
2. **Test** template changes end-to-end (boot, chat, agent loop, preview, deploy) — `./start.sh` from inside the test app actually runs.
3. **Backport** fixes back into the template once they're verified.

**Workflow when fixing bugs or adding features:**

1. **Always edit the test app first** (`app/test/app_template_test/app/`). Run it via `./start.sh` and verify in a browser.
2. Once it works, **sync the changed files over to the template** with `cp`. Use `diff -rq` between the two trees to find anything that drifted.
3. The template's `TEMPLATE_MAP.md` lists which files are structural (keep across demos) vs domain-specific (rewrite per fork). Only sync the structural files — domain-specific files in the test app (LuxeBeauty branding, schema, agent prompts) intentionally diverge.

**LuxeBeauty assets** (deployed by hand for the test app, source-controlled in `app/test/app_template_test/src/`) include: SDP pipeline, AI/BI dashboard, Genie space, Knowledge Assistant, Multi-Agent Supervisor, metric view, ML model. IDs land in `app/test/app_template_test/resources.json`. Source files for each asset live under `src/<asset_type>/` so the whole demo can be re-created from scratch (see `app/test/app_template_test/src/README.md`).

## Key concepts

- **Block** — Markdown file with YAML frontmatter under `references/blocks/{domains,capabilities,patterns}/`. The agent composes these to build a demo's context.
- **Project** — A user workspace under `app/projects/<id>/` containing generated files + a Claude conversation.
- **Template** (in the generator's sense) — A published project snapshot that other users can fork (NOT to be confused with the `app_template/` Databricks-App template).
- **resources.json** — Per-demo manifest of every Databricks resource that's been created (catalog, schema, pipeline_id, dashboard_id, KA id, MAS id, app name, …). The agent writes to it during Stage 3 Build.

## Quick commands

All from `app/`:

```bash
./scripts/dev.sh              # uvicorn:8000 + vite:5173 + auto-clone ai_dev_kit
npx tsc --noEmit              # Frontend types
uv run mypy src               # Backend types
bun run build                 # Frontend → src/demo_prompt_generator/ui/__dist__/
npx playwright test           # E2E (needs :9000)
RESET_DB=1 ./scripts/dev.sh   # Wipe local DB

# Generator deployment (NOT staging-then-prod by default — staging only unless user asks)
databricks bundle deploy -t staging
```

For the **test app** (separate from the generator):

```bash
cd app/test/app_template_test/app
./start.sh                    # Boots the LuxeBeauty test app on :8765
```

To validate the shared pipeline scenarios (from the repository root):

```bash
uv run sb-eval cases validate
uv run python -m evaluation.schema_generator --check
```

## Conventions

- **Python**: `uv` only, never `pip`. Use `claude-agent-sdk` (NOT the deprecated `Skill` tool name — pass `skills=` to the SDK).
- **Frontend**: `bun` (install/add). Path alias `@/` → `src/demo_prompt_generator/ui/`.
- **API routes** (generator): `response_model` + `operation_id` required (drives client codegen).
- **Models** (generator): 3-model pattern — `Entity` (SQLModel table) / `EntityIn` (Pydantic input) / `EntityOut` (Pydantic output).
- **Styling**: Tailwind v4, CSS custom properties (oklch). No CSS modules / styled-components.
- **Routing** (generator UI): TanStack Router file-based. Don't edit `routeTree.gen.ts`.
- **Template app stack**: Node + Express (`@databricks/appkit`) + React + Drizzle + OpenAI Agents SDK + mlflow-tracing. Different stack from the generator.
- **Logger** (template `server/lib/logger.ts`): `console.debug` is gated by `LOG_LEVEL` env (default INFO). Use it for per-request chatter; reserve `console.error` for actual failures.

## Operational rules (durable preferences)

- **Never deploy to prod without explicit ask.** Staging is fine.
- **Template Skeleton component**: use `<Skeleton className="… bg-muted" />` — appkit's default `bg-accent` reads as a brand teal in this theme, not a neutral placeholder.
- **Don't replicate the destination component's layout in a skeleton** — a few plain stacked bars read as a skeleton more clearly than column-matched scaffolding.
- **Show skeleton only on initial load.** Subsequent refetches (e.g. `dataMutated`) must swap data silently — flashing back to skeleton on every agent write is the bug, not the feature.

## How to keep this file accurate

This document is loaded into context at the start of every session. **It is your fastest path to being useful in the first 10 minutes.** Stale content makes you slower than no content. Update it when:

- A **top-level directory** is added or renamed (e.g. if `app/test/` is moved).
- A **stack swap** happens (e.g. dropping FastAPI for something else, swapping Tailwind, switching SDKs).
- A **workflow shift** happens (e.g. test-app ↔ template sync model changes).
- A **key file moves** (`agent.py`, `skills_manager.py`, `SKILL.md`).
- A **new dev/build/deploy script** is introduced or an existing one removed.
- A **durable preference** lands (those go under "Operational rules").

Don't update for: in-flight feature work, bug fixes, refactors that don't move files. Memory entries under `~/.claude/projects/.../memory/` cover transient feedback.

When in doubt, **read this file again from disk before relying on it** — code drifts faster than memory.
