# CLAUDE.md — Industry Demo Prompt Generator

> **This file is your memory across sessions. Keep it accurate — updating it is part of the work, not an afterthought.**
> When a change lands that alters how the system is built, packaged, run, or deployed — a new top-level directory, a stack swap, a workflow shift, a renamed/moved key file, a new dev/build/deploy script, or a new *mode* of a subsystem (e.g. how a skill is packaged, how an artifact renders) — **update this file in the same change, before you consider the task done.** If you touched something described here and the description is now wrong, fix it. Better stale-in-one-place than spread-across-three-places. See "How to keep this file accurate" at the bottom for the exact triggers.

## What this project actually is

A **system that generates Databricks demos**. Not one app — **three**, plus a skill:

1. **Generator app** (`app/`) — the user-facing tool. FastAPI + React. A user opens it, picks an industry/capability, chats with a Claude Code agent (via `claude-agent-sdk`), and the agent assembles a personalized demo by reading **blocks** from the skill below. Generated artifacts (demo code, specs, app boilerplate, deployable Databricks assets) land in a per-project directory. The home page has **three entry modes** (a `mode` field on each project): *story* (describe it → agent builds every Databricks resource), *architecture* (draw the diagram first → generate from it), and *genie-code-workshop* (agent writes Genie-Code prompts → you build the resources live in notebooks). The mode picks the agent's Build fork; capability blocks carry a `genie_code_workshop` flag so the workshop tab hides what can't be built via Genie Code (apps, Lakebase, KA, MAS).

2. **Demo-generator skill** (`.claude/skills/databricks-demo-generator/`) — the agent's brain. SKILL.md + reference blocks + stage guides + the template app. The generator's agent reads from here. **The skill is the product; the generator is the UI.**

3. **Template app** (`.claude/skills/databricks-demo-generator/app/app_template/`) — a complete Node.js + Express + React Databricks App that ships *as part of every generated demo*. The agent copies + customizes it. It is **NOT** a sub-component of the generator — it's an artifact the generator emits.

4. **Test copies** (`app/test/{app_template_test,app_template_test_simple,luxebeauty_workshop}/`) — runnable, live-workspace-wired copies of the skill's template app + reference demos, used to dogfood + iterate. **The workflow is: debug in the test copy, then sync the working content back into the skill.** They must stay in lockstep. See "Test apps ↔ skill" below.

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
│   │       ├── preview/                  # Preview iframe + log streaming UI
│   │       ├── lib/platform-architecture.ts  # ★ Arch-diagram CATALOG + flat-file parse/serialize + computeLayout (see below)
│   │       └── components/project/platform-diagram{.tsx,/}  # ★ ReactFlow arch-diagram editor (see below)
│   ├── test/                             # ★ 3 runnable test copies — debug live, then sync to the skill (see below)
│   │   ├── app_template_test/            #   FULL demo: app/ (template fork) + src/ (all assets) + databricks.yml DAB
│   │   │   ├── app/                      #   ★ Test fork of app_template (parallel-edit with template)
│   │   │   └── src/                      #   ★ Source-of-truth for THIS demo's Databricks assets
│   │   │       ├── pipeline/             #   SDP SQL (bronze/silver/gold)
│   │   │       ├── dashboard/dashboard.json  # AI/BI dashboard JSON
│   │   │       ├── genie/genie_space.json
│   │   │       ├── knowledge_assistant/  #   KA config
│   │   │       ├── supervisor_agent/     #   MAS config
│   │   │       ├── metric_view/          #   UC metric view YAML
│   │   │       ├── ml/                   #   training + scoring script
│   │   │       ├── data_generation/
│   │   │       └── documents/            #   RAG sources
│   │   ├── app_template_test_simple/     #   SIMPLE demo variant (src/ only): synth data → dashboard + genie
│   │   ├── luxebeauty_workshop/          #   GENIE CODE WORKSHOP: src/ (notebooks + data_gen + answer-key SQL + CONTEXT.md) + deploy.sh
│   │   └── architecture/                 #   (NOT a test app) gitignored render-loop scratch dir for the architecture skill
│   ├── ai_dev_kit/                       # Cloned external repo (not submodule)
│   │   └── databricks-skills/            # 26 per-resource skills
│   ├── databricks.yml                    # DAB config for the generator itself
│   ├── databricks.{prod,staging}.yml     # Deployment overlays (admin emails live here)
│   ├── pyproject.toml                    # uv. claude-agent-sdk>=0.2.83
│   ├── package.json                      # bun. React 19, Vite, TanStack Router
│   └── scripts/{dev,build,release,build-electron}.sh + arch-skill build chain
│       # build-architecture-skill.sh, build-arch-standalone.sh, gen-architecture-skill.ts, render-arch.mjs
├── .claude/skills/databricks-demo-generator/   # ★ The skill (the brain)
│   ├── SKILL.md                          # 4-stage workflow
│   ├── stages/0X-*.md                    # Stage-specific guides
│   ├── references/
│   │   ├── blocks/{domains,capabilities,patterns}/*.md
│   │   ├── example-luxebeauty{,-simple,-workshop}/  # Reference demos (full / simple / genie-code-workshop) — synced from app/test/*
│   │   └── dab/                                  # DAB packaging guide
│   └── app/
│       ├── app.md                        # How to design+spec a demo app (read during Stage 2)
│       └── app_template/                 # ★ The template app emitted by the generator
├── .claude/skills/databricks-architecture/      # ★ The architecture-diagram skill (see "two modes" below)
│   ├── SKILL.md                          # catalog/icon-bank sections GENERATED from app CATALOG; rest hand-written
│   ├── reference/*.jsonc                 # hand-authored example diagrams
│   └── renderer/                         # standalone viewer/editor HTML + render-arch.mjs (built from app code)
├── initial_templates/                    # Pre-built seed templates (retail/loyalty-segmentation)
├── tests/                                # Playwright E2E for the generator (targets :9000)
├── install.sh                            # End-user installer — installs BOTH skills (demo-generator + architecture) + ai-dev-kit
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

## The architecture-diagram editor (`platform-diagram/`)

The "Architecture" tab is a Lucidchart-style ReactFlow (`@xyflow/react`) editor for the demo's Databricks architecture. It reads/writes the project's `architecture.md` and auto-saves (debounced) on every change. A module DAG under `ui/components/project/platform-diagram/`:

```
platform-diagram.tsx                 # thin shell: PlatformDiagram (default export) + SaveChip + parse/deeplink/persist
platform-diagram/
├── canvas.tsx                       # ★ the stateful orchestrator (ReactFlow, panels, menu, drag-to-add, keys)
├── shared.tsx                       # NodeData/EdgeData/StylePatch types, RotatableCard (resize/rotate shell),
│                                    #   cardStyle (border/shadow/fill helper), baseSize→naturalSize, EditModeContext
├── edge-routing.ts                  # pure edge geometry (sides, fan-out, EdgeOps context)
├── flow-mapping.ts                  # schema↔ReactFlow: schemaToFlow / flowToEdge / flowToLayout (the save round-trip)
├── node-types.ts                    # nodeTypes + edgeTypes registries
├── nodes/component-node.tsx         # the standard product/source tile
├── edges/{flow-edge,edge-flow}.tsx  # custom edge (arrows + inferred handles) + animated flow overlay
├── panels/{detail-panel,edit-panel,library-palette,style-controls}.tsx
├── menus/context-menu.tsx           # the EDGE edit panel (docked on click; flow/arrow/shape/label/delete)
├── composite-{lakeflow,lakeflow-genie,genie-code,governance,agent-bricks,db-platform,genie-one}.tsx  # rich composite kinds
├── annotations.tsx                  # free-form text/box/logo/image annotations + IconPicker
└── hooks/{use-diagram-history,use-node-mutations,use-edge-mutations,use-paste-image}.ts
```

Dependency direction is a strict leaf→root DAG (shared/edge-routing → edge-flow/composites → component-node/flow-edge → node-types/flow-mapping/panels/menus → canvas → platform-diagram). The custom Canvas hooks own the undo/redo burst machinery, the node/edge mutators, and paste. Selection comes from ReactFlow's `selected` NodeProp, edit mode from `EditModeContext`, draggability from `<ReactFlow nodesDraggable>` — node `data` identity stays stable so `React.memo` holds.

### Two layers: the FILE format vs the ReactFlow binding (keep separate)

- **`lib/platform-architecture.ts` — the file-format + catalog layer.** This is where most architecture logic lives. It owns:
  - The **flat `architecture.md` format**: `{ name, story, options, columns?, nodes[], edges[] }`. A node is on the canvas iff it's in `nodes`. **No bands / state / hidden / catalog-diffing in the file** — that model was cut over (no `buildSchema`/`seedEdges`/overrides anymore).
  - `parseArchitecture(content)` → the internal resolved `PlatformSchema` ({bands, layout}) the canvas consumes; `serializeArchitecture(schema, layout)` → writes the flat file back. (The internal `{bands, layout}` shape is kept ONLY so `flow-mapping.ts` + the node components didn't have to change.)
  - The **`CATALOG`** (single source of truth): every component with `id`/`label`/`icon`/`desc`/`kind`/`sublabel` + authoring metadata (`authoring` one-liner, `ports` map). `CATALOG_BY_ID` is the lookup; `naturalSize(type)` gives each kind's [w,h]. The file lists only what's placed; the library palette renders the full catalog.
  - **`computeLayout(file)`** — resolves SYMBOLIC placement → pixels. **Author structure, not coordinates:** `columns: [...]` + per-node `col`/`row` stack nodes in left→right lanes; **relational fields** `alignX`/`alignY` (copy another node's center on an axis — with a `col` the node stays in-lane and its lane-mates re-stack to open a slot), `below`/`above`/`leftOf`/`rightOf`(+`gap`) place a node beside another (siblings on the same anchor fan out; a still-overlapping satellite nudges clear) — computeLayout de-overlaps these automatically; `wraps: [ids]`+`pad` makes a `type:"box"` auto-size around children (recursive → cloud/VPC nesting); `bounds: {side:"<id>:<anchor>"}` cuts a box edge at a node/column midpoint; `pin: "bottom-left"`+`pinTo` docks banners into a box corner (non-`float` pins RESERVE a band so the box grows and they don't overlap content). **Explicit `at` always wins.** **PER-NODE round-trip (not all-or-nothing):** parse stashes each node's symbolic fields in `NodePosition.placement` + a `pinned` flag; on save `serializeArchitecture` re-emits the symbolic fields for any UNMOVED node and only writes pixel `at` for nodes the user actually dragged (canvas `handleNodesChange` sets `pinned` on the drop frame) or that were authored with `at`. So dragging one box no longer flattens the whole tab.
  - Edges: `from`/`to` by node id. The `@handle` is either **explicit** (`to: "lakeflow-genie-block@in-zerobus"`) or **inferred** (L→R `@r`/`@l`). **There is NO `ingest` field anymore** — a source→Lakeflow edge names the ingest PORT via its target `@in-*` handle (`@in-lakeflow-connect` / `@in-zerobus` / `@in-direct`), and that handle drives BOTH the port anchor AND the flow animation (zerobus→particles, direct→docs, else→laser). `arrow` (auto/none/end/start/both) — `auto` draws relationship arrows for Genie-One edges.
- **`flow-mapping.ts` — the ReactFlow-binding layer.** `schemaToFlow` / `flowToEdge` (resolved schema → `Node[]`/`Edge[]`) and `flowToLayout` (live graph → persisted layout). No file parsing here.

### Composite node kinds

Beyond the plain `component` tile, each composite is its own node type + `composite-*.tsx`. `CompositeKind` (in `platform-architecture.ts`) is: `lakeflow` / `lakeflow-genie` (3-port ingest rail + medallion; `lakeflow-genie` adds a Genie Code footer — the preferred data block), `governance` (UC + AI Gateway + Genie Ontology bar), `agent-bricks` (supervisor tree), `genie-code`, `db-platform` (wordmark banner), and **`genie-one`** (the business-user entry tile — the "Business users" persona pill is built INTO it, so no separate `file:persona/user` node is needed). A composite's `kind` lives on its catalog entry; `nodeTypeFor` maps kind→ReactFlow type; `cardStyle` lets border/shadow/fill controls apply uniformly (db-platform + governance default to no border/shadow).

### The skill catalog is GENERATED from the code catalog

`app/scripts/gen-architecture-skill.ts` (`bun run gen:arch-skill`) writes the component catalog + icon-bank sections **directly into `.claude/skills/databricks-architecture/SKILL.md`** (between `<!-- BEGIN/END: generated-catalog -->` and `<!-- BEGIN/END: generated-icons -->`), derived from `CATALOG`. It also runs a build-time **drift guard**: prose that references an `@in-*` port not in `CATALOG.ports` fails the build. After changing a component's label/desc/`authoring`/`ports`, re-run it so the skill can't drift. The rest of that SKILL.md (workflow, format, authoring rules, Sources) is hand-written. (NOTE: this is *generation into the skill*; how the skill is *packaged/shipped* — pure vs in-app — is a separate concern, covered next.)

**Merge/rebase conflicts in the generated artifacts** (the arch `SKILL.md` catalog/icon-bank blocks + the two renderer HTMLs) — **don't hand-merge them.** They're derived from `platform-architecture.ts` (+ `standalone.tsx`), which merges cleanly on its own. Resolve each conflicted artifact to *either* side (e.g. `git checkout --theirs`), finish the merge/rebase, then run `cd app && bun run build:arch-skill` to **regenerate them from the merged source** — that produces the correct combined result (e.g. one side's renamed ids + the other's node sizes). Commit the regen.

## The architecture skill: two modes + the render/feedback loop

The `databricks-architecture` skill (`.claude/skills/databricks-architecture/`) is **one source of truth, consumed two ways.** There is a single skill dir on disk — `SKILL.md` + `reference/*.jsonc` + `renderer/` (the standalone viewer/editor HTMLs + `render-arch.mjs`). Both the HTMLs and `render-arch.mjs` are BUILT from the app: `cd app && bun run build:arch-skill` (= `build-architecture-skill.sh`) does 3 steps — (1) `gen:arch-skill` regenerates SKILL.md's catalog/icon-bank, (2) `build:arch-standalone` builds the two HTMLs from `ui/standalone.tsx` via `vite.standalone.config.ts` (ARCH_MODE=viewer|editor), (3) copies the HTMLs + `scripts/render-arch.mjs` into the skill's `renderer/`. **This is a dev-time step you run before committing — it is NOT run at app start.** `render-arch.mjs`'s source of truth is `app/scripts/render-arch.mjs`; the skill copy is a build artifact — edit the source, not the copy.

### Mode 1 — Pure skill (standalone, outside the app)

`install.sh` (or a repo tarball) installs the skill dir **whole, including `renderer/`**, into `~/.claude/skills/` (or `./.claude/skills` with `--project`). `install.sh` installs BOTH `databricks-demo-generator` AND `databricks-architecture` (a `SKILLS=(…)` array it loops over). With no app around, the agent's feedback loop is **file + headless-browser**:

```
cp renderer/architecture-viewer.html my-arch.html   # edit the inline JSON
node renderer/render-arch.mjs my-arch.html           # → my-arch.png
# read my-arch.png, fix the JSON, repeat
```

`render-arch.mjs` drives **`chromium-headless-shell`** (Playwright's minimal headless build — `npx playwright install chromium-headless-shell`) over CDP and screenshots the rendered canvas to PNG. `findChrome()` auto-discovers the shell in the Playwright cache (falls back to full chromium, then system Chrome; `CHROME_PATH` overrides). SKILL.md ships this local render-loop workflow intact.

### Mode 2 — In-app (Solution Builder)

Two layers:
1. **Wheel/build:** `app/scripts/build.sh` packages the **full** skill dir (incl. `renderer/`) into the wheel — the backend also serves `architecture-editor.html` for its viewer feature.
2. **Per-project, at RUNTIME:** `skills_manager.copy_skills_to_project()` copies the skill into `<project>/.claude/skills/`, **excludes `renderer/`** (`ignore_patterns("renderer", …)`), and calls **`_localize_arch_skill_for_app(SKILL.md)`** — which strips the `local-render-workflow` / `local-render-files` marker blocks and injects the `in-app-workflow` block (the `_ARCH_SKILL_IN_APP_WORKFLOW` text). So the in-app flavor is **derived at project creation, not a second build** — no drift risk.

In-app there's no headless browser; **the user's live React canvas IS the renderer**, and the agent gets an image via a browser-screenshot loop:

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
| Ships `renderer/`? | yes | excluded per-project (in the wheel though) |
| SKILL.md | full (local render loop) | localized (in-app loop injected) |
| Render surface | headless-shell → PNG file | live React canvas |
| Feedback PNG | `my-arch.png` via `render-arch.mjs` | `architecture.png` via browser screenshot on chat-focus |
| Browser dependency | `chromium-headless-shell` | none (the user's own tab) |

### Legacy-format migration nudge

`isLegacyArchitectureFormat()` (`platform-architecture.ts`) detects the OLD pre-flat-file schema (`columns` as objects, no top-level `nodes`). When a project loads a legacy `architecture.md`, the frontend sends the agent `ARCHITECTURE_MIGRATION_PROMPT` **once per project** (guarded by a `localStorage` flag + `legacyMigrationSentRef`) asking it to migrate to the new schema grounded in the README story.

## Test apps ↔ skill: debug-live-then-sync workflow

The skill is the **shipped source of truth** — but its template app + reference demos are *blueprints* you can't run in place. So under `app/test/` we keep **runnable copies wired to a live workspace** (e2-demo-west). **The invariant: debug + visualize interactively in the test copy, then sync the working content back into the skill.** Test copy = debug surface; skill = product. Keep them in lockstep.

**The three test copies** (each mirrors one skill artifact):

| Test copy | Mirrors (skill source of truth) | What it is / how you run it |
|---|---|---|
| `app/test/app_template_test/` | template app → `…/app/app_template/`; demo assets → `references/example-luxebeauty/` | **FULL** demo. `app/` (runnable template fork, `./start.sh` → :8765) + `src/` (all Databricks assets) + `databricks.yml` DAB. LuxeBeauty resources wired in (Lakebase, MAS, dashboard, Genie…); IDs in `resources.json`. |
| `app/test/app_template_test_simple/` | `references/example-luxebeauty-simple/` | **SIMPLE** demo variant (`src/` only, no app/DAB): synth data → AI/BI dashboard + Genie (optional app). |
| `app/test/luxebeauty_workshop/` | `references/example-luxebeauty-workshop/` | **GENIE CODE WORKSHOP**. `src/` (notebooks whose cells are Genie-Code prompts + data_generation + pipeline answer-key SQL + CONTEXT.md + specs) + `deploy.sh` (generates raw data → a UC Volume, uploads notebooks to a workspace folder). |

(`app/test/architecture/` is **not** a test app — it's the gitignored render-loop scratch dir for the `databricks-architecture` skill.)

**Why the copies exist:** to **debug** against a live workspace without regenerating a demo from scratch, **test** changes end-to-end (boot, chat, agent loop, preview, deploy — or, for the workshop, the actual notebook prompts), and then **sync** the verified content into the skill.

**Workflow when fixing bugs or adding features:**

1. **Edit the test copy first.** Run it (`./start.sh` for the template app; `./deploy.sh` for the workshop) and verify against the live workspace / browser.
2. Once it works, **sync the changed files back into the matching skill artifact** with `cp`. Use `diff -rq` between the two trees to catch drift.
3. For the template app: `TEMPLATE_MAP.md` marks files structural (sync across demos) vs domain-specific (LuxeBeauty branding/schema/prompts — these intentionally diverge; don't sync). Assets/notebooks sync 1:1 into their `references/example-luxebeauty{,-simple,-workshop}/` counterpart.

**LuxeBeauty assets** (deployed by hand, source-controlled in each `src/`) include the SDP pipeline, AI/BI dashboard, Genie space, Knowledge Assistant, Multi-Agent Supervisor, metric view, ML model (full demo). IDs land in `resources.json`; source files under `src/<asset_type>/` let the demo be re-created from scratch (see `app/test/app_template_test/src/README.md`).

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
             #   architecture-snapshot PNG), messages, templates, resources,
             #   skills, config, constants, block_factory
services/    # agent (SDK+streaming), llm_service (FMAPI), file_sync, file_watcher,
             #   skills_manager, template_service, block_factory, system_prompt, active_stream
```

- **DI:** use the `Dependencies` class in handlers, never build clients manually — `Dependencies.{Session, Client (app SP), UserClient (OBO), Config, Headers}`.
- **New route:** file in `routes/`, `create_router()`, endpoints with **`response_model` + `operation_id` (both required** — drive client codegen), register in `router.py`.
- **Models — 3-model pattern** in `models.py`: `Entity` (SQLModel `table=True`) / `EntityCreate|In` (Pydantic input) / `EntityOut` (Pydantic output).

### Frontend (`src/demo_prompt_generator/ui/`)

```
main.tsx                 # entry (React Query + Router)
routeTree.gen.ts         # AUTO-GENERATED — never edit
routes/                  # file-based (TanStack): index, project.$projectId (the
                         #   workspace), projects, gallery, templates, profile, setup…
components/{ui,project,layout}/   # shadcn primitives / workspace / app shell
lib/custom-api.ts        # ★ hand-written API client (types + fetch + SSE) — the primary client
lib/{config,utils}.ts    # apiUrl() base resolution; cn() class merge
styles/globals.css       # Tailwind + oklch CSS custom properties
```

- **Routing:** file-based; `project.$projectId.tsx` → `/project/:projectId`. Don't edit `routeTree.gen.ts`.
- **API client:** `lib/custom-api.ts` (hand-written, fully typed). `invokeAgent()` returns an `execution_id`, then `streamAgentProgress(id, signal)` yields typed SSE events. `lib/api.ts` is an auto-generated OpenAPI backup.
- **State:** local `useState`/`useRef` (no global store; Zustand present but unused; React Query available but the workspace page fetches manually).
- **Workspace page** (`routes/project.$projectId.tsx`): two panels — left file-viewer (tabs: overview/story/architecture/files/app), right resizable ChatPanel (SSE streaming + reasoning). Owns the legacy-migration nudge + the architecture-snapshot capture (see arch section above).

- **shadcn/ui:** add primitives manually from the shadcn registry into `components/ui/`.
- **Testing:** Playwright E2E in `tests/` (repo root) targets `http://localhost:9000` (prod-mode server, not the split dev ports).

### Preview-gated features (`?preview=on`)

In-progress / not-yet-GA UI is hidden behind a **preview flag** so it can ship to
`main` without exposing it to everyone. The mechanism (in `ui/routes/index.tsx`):
`?preview=on` enables it and **persists to `localStorage["preview-features"]`**
(so it stays on across visits without the param); `?preview=off` disables it; with
no param the stored value wins (default **off**). Gate a feature by rendering it
only when the `previewEnabled` state is true. **Currently gates:** the "Genie Code
workshop" home tab. Add future preview features to the same flag (one shared
`preview-features` key — don't invent a per-feature param).

(Run/build commands live under **Quick commands** below.)

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
bun run build:arch-skill      # Rebuild the architecture skill (SKILL.md catalog + renderer/) from app code
uv run uvicorn demo_prompt_generator.backend.app:app --host 127.0.0.1 --port 9000  # prod-mode locally (needs bun run build)

# Generator deployment (NOT staging-then-prod by default — staging only unless user asks)
# One-time: cp databricks.prod.yml.example databricks.prod.yml + fill 3 sections (gitignored).
# `databricks bundle deploy` resolves it + invokes build.sh; build.sh --target prod reads
# targets.prod.env from `databricks bundle summary --output json` → .build/app.yml
# (no on-disk app.yml placeholder — databricks.prod.yml is the single source of truth).
databricks bundle deploy -t staging
```

### ⚠️ Dev database: `RESET_DB` is DESTRUCTIVE — know the mode first

The dev DB mode is chosen in `backend/core/lakebase.py` `_is_pglite_mode()`: PGLite iff `USE_PGLITE=1` **or** `LAKEBASE_DATABASE_PATH` is unset. **Local dev normally sets `LAKEBASE_DATABASE_PATH` in `app/.env` → it points at a real remote Lakebase branch** (a named branch under the shared Lakebase project, NOT prod). So:

- **`RESET_DB=1` does NOT mean "wipe a throwaway local DB."** In Lakebase mode it **DROPS ALL TABLES on the remote branch** your `.env` points at (`lakebase.py:375`); in PGLite mode it deletes `~/.pglite/`. **Never run `RESET_DB=1` — or any test that sets it — against a branch holding real projects.** Point a test at a temp branch/DB instead.
- **Recovery:** Lakebase branches are copy-on-write with point-in-time restore. If a branch is damaged, create a recovery branch from a past timestamp (`databricks postgres create-branch … --json '{"spec":{"source_branch":"…/branches/<b>","source_branch_time":"<ISO ts>","no_expiry":true}}'`), verify the data, then repoint `.env` at it. On-disk `app/projects/<id>/` files survive a DB drop regardless — only the DB rows (project metadata, message history) are lost.

For the **test copies** (separate from the generator — see "Test apps ↔ skill" above):

```bash
cd app/test/app_template_test/app && ./start.sh   # Boots the FULL LuxeBeauty test app on :8765
cd app/test/luxebeauty_workshop && ./deploy.sh     # Gen raw data → UC Volume + upload workshop notebooks (WEST)
# app_template_test_simple is src-only (no runner) — sync its assets to references/example-luxebeauty-simple/
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

- A **new mode / packaging path** of a subsystem appears (e.g. the architecture skill's pure-vs-in-app split, a new render/feedback loop, a new way an artifact is generated or shipped).
- A **destructive-operation footgun** is discovered (like `RESET_DB` against a remote branch) — document the danger, not just the command.

Don't update for: in-flight feature work, bug fixes, refactors that don't move files. Memory entries under `~/.claude/projects/.../memory/` cover transient feedback.

**One CLAUDE.md, at the repo root.** There is deliberately no nested `app/CLAUDE.md` — a nested file only loads when you're working under that subtree, so facts would silently go missing. Everything (whole-system picture, app-dev patterns, dangers) lives in this one root file. Keep it that way: don't create per-directory CLAUDE.md files; add to the relevant section here instead.

When in doubt, **read this file again from disk before relying on it** — code drifts faster than memory.
