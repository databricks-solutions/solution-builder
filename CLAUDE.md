# CLAUDE.md — Industry Demo Prompt Generator

> **This file is your memory across sessions. Keep it accurate.** When a major change happens (new top-level directory, stack swap, workflow shift, renamed/moved key file, new dev script), update this file in the same change. Better stale-in-one-place than spread-across-three-places.

## What this project actually is

A **system that generates Databricks demos**. Not one app — **three**, plus a skill:

1. **Generator app** (`app/`) — the user-facing tool. FastAPI + React. A user opens it, picks an industry/capability, chats with a Claude Code agent (via `claude-agent-sdk`), and the agent assembles a personalized demo by reading **blocks** from the skill below. Generated artifacts (demo code, specs, app boilerplate, deployable Databricks assets) land in a per-project directory.

2. **Demo-generator skill** (`.claude/skills/databricks-demo-generator/`) — the agent's brain. SKILL.md + reference blocks + stage guides + the template app. The generator's agent reads from here. **The skill is the product; the generator is the UI.**

3. **Template app** (`.claude/skills/databricks-demo-generator/app/app_template/`) — a complete Node.js + Express + React Databricks App that ships *as part of every generated demo*. The agent copies + customizes it. It is **NOT** a sub-component of the generator — it's an artifact the generator emits.

4. **Test app** (`app/test/app_template_test/app/`) — a working fork of the template, used to dogfood + iterate on template changes. **The user's workflow is: fix bugs in the test app, sync to the template.** They must stay in lockstep.

Plus: **ai_dev_kit** (`app/ai_dev_kit/`) — a cloned external repo (`github.com/databricks-solutions/ai-dev-kit`) holding ~26 sub-skills for creating individual Databricks resources (pipelines, dashboards, Genie spaces, KAs, MAS, etc.). The generator's agent uses these during the Build stage.

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

The generated demo includes a Databricks app (`app_template/`-derived). User clicks **Start Preview** in the UI:
- Backend (`backend/preview/`) spawns `<project>/app/start.sh` as a subprocess.
- HTTP proxy at `/preview/{id}/{path}` forwards into the subprocess port.
- iframe renders the app inside the generator UI.
- Auto-stops after 5min idle; max 10 concurrent.
- **The agent never runs `start.sh` itself** — only the UI owns lifecycle.

## Template ↔ Test app parallel-edit workflow

```
app/test/app_template_test/app/      ←→     .claude/skills/databricks-demo-generator/app/app_template/
        (test fork)                                       (template)
   user edits + tests here                          gets the same edit synced over
```

When fixing bugs or adding features:
1. **Always edit the test app first**, run it via `./start.sh` to verify.
2. **Sync to template** with `cp` once verified. Diff the two to find drift.
3. The template's `TEMPLATE_MAP.md` lists which files are structural (don't rewrite per-demo) vs domain-specific (rewrite per fork).

LuxeBeauty assets (deployed by hand for the test app, source-controlled in `app/test/app_template_test/src/`) include: SDP pipeline, AI/BI dashboard, Genie space, Knowledge Assistant, Multi-Agent Supervisor, metric view, ML model. IDs land in `app/test/app_template_test/resources.json`.

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
