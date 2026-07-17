# App Generation — Databricks Apps from Template

Invoked as the **final stage** of demo generation, after all other resources (pipeline, dashboard, Genie, KA, MAS) are built and working.

## Template overview

Full-stack Node.js/React Databricks App. The assistant doesn't just answer — it **investigates via MAS, drafts actions, writes to Lakebase on approval**. Wiring + scripted demo chain live in `config/app.json`; home-page narrative copy (hero persona, headline, situation, goal, starter questions, featured action) is hardcoded at the top of `HomeView.tsx` so each demo can reshape the landing freely.

### Required resources

Genie, Dashboard, MAS are slow to create and during the initial build can be built in parallel. If they're in the spec and story, and you don't see the values in resources.json, use these placeholder in the conf file: __LATE_FILL_GENIE__, __LATE_FILL_DASHBOARD__, __LATE_FILL_MAS__

| Component | Required? | Notes |
|-----------|-----------|-------|
| **MAS or Genie endpoint** | Strongly recommended | Assistant delegates data/doc questions to MAS. Genie endpoint works as fallback, or pure open ai agent with custom tools. Use __LATE_FILL_MAS__ if the MAS is being built and is not yet in resources.json |
| **Lakebase** | Yes | OLTP mirror of Delta — the write-capable operations surface. |
| **SQL Warehouse** | Yes | Powers analytics page + Delta→Lakebase sync. |
| **Delta tables** | Yes | Source of truth, synced to Lakebase at boot. |
| **Dashboard** | Optional | Embedded iframe. Remove Dashboard route if none. Use __LATE_FILL_DASHBOARD__ dashboard is being built and not yet in the resource|

### What the template provides (avoid rewrite, just tune when required)

Chat UI (dock + full-page), streaming with thinking panel, MLflow tracing per turn, feedback (thumbs → MLflow assessments), SSE infrastructure, auth (OBO), sidebar/header shell, Drizzle ORM migrations, Delta→Lakebase sync framework, admin reset endpoint.

### What gets customized per demo

| Area | What to change |
|------|---------------|
| **Config** | `config/app.json` — branding, scripted demo chain (`assistantScript`), data sources, resource IDs (agent endpoint, warehouse, MLflow, dashboard) |
| **Home narrative** | `client/src/home/HomeView.tsx` top-of-file constants — `HERO`, `STORY` (headline/situation/goal), `STARTER_QUESTIONS`, `FEATURED_ACTION`. Rewrite these to match the demo; the template values are an example, not a pattern to preserve |
| **Domain schema** | `server/db/schema.ts` is the SINGLE source of truth for the Lakebase tables (keep chat state as-is). Preserve the append-only JSONB audit columns pattern — powers the operations timeline, delete the example-specific one. **You only edit `schema.ts`** — the SQL migration under `drizzle/` is a build artifact, regenerated from it by `npm run db:generate` (wired into `prebuild`/`predev`, so `npm run build` and `./start.sh` both regenerate automatically). Never hand-edit or commit a migration `.sql`, and never rely on the old one — a stale migration = the app boots the wrong tables and crashes (`relation "app.<table>" does not exist`). If you ever run drizzle-kit directly while debugging: `rm -rf drizzle/* && npm run db:generate`. |
| **Data sync** | Delta→Lakebase SELECTs for the domain's data subset |
| **Domain queries** | Lookup + bulk-update helpers for the operations entity |
| **Agent** | Tools + instructions. MAS/Genie passthrough typically stays; domain tools (find, batch-process, create, emails...) get rewritten to follow the story |
| **Analytics SQL** | Warehouse queries for the domain's charts |
| **Frontend** | Home page journey cards, operations page (columns, drawer tabs, detail content), analytics charts if layout changes |
| **Theming** | `client/src/index.css` `:root` block — all colors are CSS custom properties. Change the palette there to rebrand (primary, accent, status tints, tier badges, charts). No hardcoded colors in components |

## How to generate

### Step 1: Copy template

Copy the template source into the project's `app/`. **Don't** run `npm install` yourself — `start.sh` installs deps (`npm ci`) automatically on the first boot / smoke test (see Step 5). Exclude `node_modules` (large, and reinstalled fresh on first run anyway), `.env` (may contain secrets), and build artifacts.

```bash
rsync -a \
  --exclude node_modules \
  --exclude .env \
  --exclude dist \
  --exclude .DS_Store \
  {DEMO_SKILL}/app/app_template/ ./app/
```

### Step 2: Read the demo's app specs + template map

1. Read `TEMPLATE_MAP.md` in the app root — comprehensive map of every file, schema, route, tool, and component. Tells you what to customize vs keep as-is. **Read this instead of scanning the codebase.**
2. Make sure you know the overall demo story in README.md and specifications/lakeflow.md
3. Read the app specs from `specifications/app/` in the current project (written during stage 2). These describe the pages, assistant behavior, agent tools, data model, and narrative for **this specific demo**.
2. run sql exploration against the delta table to get the exact schema for the tables you want to use/query (output of the sdp pipeline) (when loading data from delta to PG, be careful with the data type to avoid conflict).
  - `databricks experimental aitools tools query --warehouse WH "SHOW TABLES IN catalog.schema"`
  - `databricks experimental aitools tools discover-schema catalog.schema.table1 catalog.schema.table2`
  - `databricks experimental aitools tools query --warehouse WH "SELECT..."`


### Step 3: Customize the template

**The template's component set is an EXAMPLE, not the contract. Your contract is the demo's spec (`specifications/app/` + README).** The template you copied is wired for the full LuxeBeauty stack — MAS + Genie + embedded dashboard + Knowledge Assistant + ML premium tiering + a returns-queue operations page + tiered-offer agent tools. **Your demo almost certainly has a different set.** Before customizing, diff the two:

- **Fewer components than the template** → *remove* the wiring, don't relabel it. The demo has no dashboard? Delete the Dashboard route + sidebar entry, don't ship an empty iframe. No ML tiering? Strip the premium-tier logic (see the "no ML" example below), don't leave dead `final_tier` branches. No KA, no MAS? Collapse the agent down to what's actually there. A relabeled-but-still-present component reads as "they forgot to finish the template."

  **The canonical "fewer" case is the Simple demo** (the generator's default home-page tab): synthetic data → Unity Catalog → AI/BI Dashboard → **Genie**, with an optional App + Lakebase toggle — and **no SDP, no Knowledge Assistant, no MAS, no ML**. When a Simple demo ships an app, the agent's data tool is **Genie, used directly — not MAS** (the template defaults to MAS). Concretely: leave `masEndpointName` empty and set `genieSpaceId` in `config/app.json`, then in `server/agent/<name>.ts` `makeTools` swap the `ask_mas` tool for the `askGenieTool` (Genie-space) path — the comments in `config/app.json` next to those two fields point at exactly this swap. Then strip ML tiering (the "no ML" example below) and drop the KA/MAS-specific agent instructions. The result is a leaner app where the *only* data path is Genie — not a full-stack template with MAS quietly pointed at nothing.
- **More / different components than the template** → *add* them. The demo's spec calls for a second operations entity, an extra page, a map the template never had, an agent tool the template never had, a different primary surface? Build it. The template gives you the *patterns* (3-phase action chain, append-only audit columns, KPI cards that tick on write, the thinking panel, Delta→Lakebase sync) — apply those patterns to whatever the spec describes, even where the template has no matching file. Don't constrain the demo to the template's shape.

- **Entirely different app requirement?** That's fine — **you're due for a big template update.** The template is a starting point, not a cage. If the spec describes an app whose shape barely overlaps the LuxeBeauty returns console — different pages, a different navigation, a different primary interaction, no operations-queue at all — then **rewrite the pages and layout wholesale.** Replace `HomeView.tsx`, delete and recreate the operations page, restructure the sidebar/routes, change the whole information architecture. Keep only the genuinely-reusable plumbing (chat dock + streaming + thinking panel, MLflow tracing, OBO auth, the Delta→Lakebase sync framework, Drizzle migrations, the `${VAR}` config substitution) — everything above that layer is yours to redraw. Don't contort the demo to fit the template's screens; reshape the screens to fit the demo.

The litmus test: after Step 3, every component in the app traces to a line in the spec, and every component in the spec is present in the app. Nothing is in the app *only because the template had it*.

This is a heavy edit — the initial files you have are from a template with a use case for luxe beauty. It's a skeleton, not a drop-in ready to use.  You are free to re-org pages to respect the spec.
Use the demo's app specs as your blueprint and rewrite all the customizable areas (see table above) to match the story. For each spec and area, read the existing template code, understand the pattern, then entirely rewrite for the new domain. Typically, the operational part needs to be fully updated
Remember - change the style / features so that it respects the user intent and matches with the story.

Key patterns to preserve:
- **3-phase action chain**: discover (read-only) → draft + confirm (STOP for approval) → execute. The mandatory approval stop is the demo's trust moment.
- **Append-only audit columns** on the primary entity — powers the Activity tab timeline.
- **`assistantScript`** in config with `triggerAfter` keywords — drives the scripted demo path.
- **KPI cards** that tick live when the agent writes — the real-time feedback loop.
- **Thinking panel** streaming MAS sub-agent activity — the transparency demo moment.
- **Reset demo** button (header) — truncates all Lakebase tables and re-syncs from Delta. The demo makes real writes (approvals, emails, audit trail), so a one-click reset to restart from the beginning of the story is essential. Keep this unless explicitly told otherwise.

Handle missing components example during this step:
- **No MAS, has Genie**: Point `ask_data` to Genie endpoint. Streaming interface is compatible.
- **No MAS, no Genie**: Use a pure OpenAI Agents SDK agent with custom tools (no `ask_data` passthrough).
- **No dashboard**: Remove Dashboard route + sidebar entry.
- **No KA**: MAS routes everything to Genie — no code change needed.
- **No ML / no premium tiering** (e.g. Simple-tab demos): clear `data.tables.customerPremium` in `app.json` so `sync.ts` skips the predictions sync. Drop `find_lot_premium_breakdown` from the agent's `makeTools`, collapse `process_return_batch`'s `tier_offers` to a single `offer`, and rewrite the agent `instructions` to a flat-offer flow (one `create_coupon`, one email template). UI premium badges already render conditional on `final_tier != null`, so they auto-hide.

Make sure you do an extensive review - no mention to the template specific use-case, everything is migrate to the new app story, rename/delete file to support the new specification, review the full implementation to make sure it's all up to date and we'll be able to start and make the app work.

#### Design the operations page from the persona — don't ship a relabeled template

The template's operations page is a queue (rows + filters + KPI cards), built for the LuxeBeauty returns story where the primary object IS a ticket. **For most other domains, a queue is the wrong primary surface.** Before reusing the template's page shape:

- Ask: *what does this persona stare at all day?* The answer drives the page's primary visualization, not "what data do I have."
- The page must have **one visual signature** that immediately reads as belonging to this specific domain — a map, a grid, a chart, a schematic, a timeline. Without it, the app looks like the template no matter what columns and labels you change.
- **Screenshot test**: before writing the page spec, write one sentence describing what the demo recording will show on this page. If the sentence is *"a table with rows"*, redesign. The screenshot must say *"this is a {domain} app"* at a glance.
- The queue/backlog can still exist — but as a secondary panel (drawer, tab, side card) below the domain-specific hero, not the page itself.
- **Visual identity is fair game**: page colors, density, hero illustrations, and chrome should be adapted to fit the domain. Keep the chat dock and message bubbles similar (low impact / high effort to change); content pages are where you reinvent.

#### Adapt the app's visual identity (last polish step)

The template ships with one look (editorial, neutral, light-mode-first). Reused verbatim, every generated app feels like the same product — **re-skin it so it reads as this demo's own tool.** The single source of truth for tokens is `client/src/index.css` (Tailwind v4 `@theme` + CSS variables: `--background`, `--foreground`, `--card`, `--muted`, `--border`, `--primary`, `--accent`, `--chart-*`, `--font-sans`, `--font-display`, `--radius`). Change the tokens in one place — don't restyle component-by-component — and the whole app re-skins via shadcn/ui + Tailwind.

**Your source of truth for the look: `brand/brand.json` if it exists, otherwise the domain's vibe.** Check the project root for `brand/brand.json` (`{ company, palette, website, company_logo, company_official_website_screenshot }`; the two filename fields are bare, relative to `brand/`).

- **With `brand/brand.json`** — the demo is personalized to a **real company**; make it look like *that company's* internal tool:
  - Drive the **whole** token set from `palette` (background, surfaces, border, text, primary/accent, status, `--chart-*`) — not just the button. A palette is usually dark→light + one or two brand accents; map darkest/lightest to background/foreground, the brand color(s) to primary/accent, derive muted/border as tints; generate tints if the palette is short.
  - **Logo** (`company_logo`, e.g. `brand/company_logo.svg`): copy into the app assets and use it for the sidebar/header brand (replace the first-letter avatar in `AppSidebar.tsx`) + the favicon (`client/index.html`). SVG gotcha: a single-color SVG with a black `fill` vanishes on a dark nav — set `fill="currentColor"`.
  - **`company_official_website_screenshot`** (`brand/website.png`): open and look at it — echo the real site's layout, typography, and tone.
- **Without it** — pick a palette + type + density from the domain's conventions: industrial/ops → dark, strong accent, tight; financial/exec → muted, sharp contrast; consumer → warm, editorial, roomier. One bold accent tied to the hero element. Flip `:root` to dark if the domain reads better dark (SCADA, security ops, traders). Swap Geist/Fraunces for what fits (Google Fonts via `<link>` in `index.html`).

**Name it for the story** (both cases): set `config/app.json` `branding.appName` (the big in-app title) to fit the company + use-case — e.g. `"<Company> Returns Console"` — and fix the browser tab (`client/index.html` `<title>` still says `mas-chat-demo`) to match.

**Sanity check:** open the running app side-by-side with the LuxeBeauty template. If it just looks like the template with a new accent color, you've only done the button — keep going until it reads as this demo's (or this company's) real tool.

read `resources.json` to get the available resource ids to use (ex: mas endpoint)

When this app step runs, add the following fields to `created_resources` in `resources.json` — the UI's Products card uses them to render the "Open" buttons for Lakebase and the App:

- `lakebase_project_id` — UUID (`databricks postgres get-project | jq -r .uid`). Powers the `lakebase/projects/<uuid>` link.
- `lakebase_project_slug` — human-readable slug. Used by CLI commands and DAB variable substitution.
- `lakebase_database` — DB name (`dbgen_<demo-short-name>`).
- `app.name` — record as soon as the app's initial setup is done (scaffold + config), BEFORE deploy. `app.name` alone marks the app capability "built" in the UI (a preview-only app that never deploys still counts). `app.id`/`app.url` are added later, only after the deploy step.
- `agent_mlflow_experiment_path` — the MLflow experiment for AGENT traces (distinct from any ML-training `mlflow_experiment_path`). Convention: `/Shared/solution_builder/<app_name>-agent-traces`. **You usually don't need to set anything** — when `AGENT_MLFLOW_EXPERIMENT_PATH` is unset, the app self-derives exactly this path from the auto-injected `DATABRICKS_APP_NAME` at boot and get-or-creates the experiment. Persist this key (and/or set the env var) only to pin an explicit non-default path.

**`config/app.json` — `agentModel` and `agentEndpointName`:** the assistant talks to TWO things, don't conflate them.

- `agentModel` — the FM endpoint for the Agents SDK loop. **Use `databricks-gpt-5-4` or a newer GPT with `openai/v1/responses` enabled** (check the endpoint's `api_types`). The SDK uses the Responses API, which Databricks gates per-model — so the version isn't the constraint, Responses support is. Claude/non-Responses models 400 (`"Responses API passthrough is not supported…"`). Use the exact endpoint name; don't abbreviate.
- `agentEndpointName` — only used when `mode='mas'` (raw MAS passthrough). For the agent loop it's a no-op label. If the demo has no MAS, leave it empty or set it to the Genie space description; routing happens in code.

### Step 4: Configure environment

**How config works (read this first).** `config/app.json` is JSONC with `${VAR}`
/ `${VAR:default}` placeholders that `server.ts` substitutes from `process.env`
at boot. So catalog/schema + every resource ID live in **env vars — one source
of truth** — not as literals in the JSON. You fill those env vars differently
per run mode, but the SAME names everywhere:

| Run mode | Where env comes from |
|----------|----------------------|
| **Preview** (default — embedded in the generator) | `.env`, sourced by `start.sh` which the generator's preview runner spawns |
| **Local dev** (`./start.sh`) | `.env`, sourced by `start.sh` |
| **Deployed** (DAB) | bindings + `app.yaml` env, written by `scripts/finalize_app.sh` after the setup job |

The key env vars `config/app.json` reads: `DEMO_CATALOG`, `DEMO_SCHEMA` (the
demo's UC catalog/schema), `DASHBOARD_ID`, `PIPELINE_ID`, `WAREHOUSE_ID`,
`GENIE_SPACE_ID`, `KA_ENDPOINT_NAME`, `MAS_ENDPOINT_NAME`,
`AGENT_MLFLOW_EXPERIMENT_PATH`. Unset → that field degrades (inert tile /
skipped feature); the app still boots. So **the agent never edits resource IDs
into `config/app.json`** — it sets them in `.env` (preview/local) or lets the
DAB flow inject them (deployed). Only the domain bits in `config/app.json`
(branding, `assistantScript`, `data.tables` names) are hand-edited per demo.

**`AGENT_MLFLOW_EXPERIMENT_PATH` self-derives — you rarely set it.** When it's
empty, `server.ts` derives `/Shared/solution_builder/<DATABRICKS_APP_NAME>-agent-traces`
at boot (`DATABRICKS_APP_NAME` is auto-injected into the Apps container) and
get-or-creates the experiment, so tracing + the "Agent traces" header link work
on every path with no env plumbing. It only degrades if you run somewhere
`DATABRICKS_APP_NAME` is ALSO unset (e.g. bare local dev) — set the env var
there if you want traces. Set it explicitly (env or `resources.json`'s
`agent_mlflow_experiment_path`) only to override the derived path.

Note the **interactive `deploy.sh` uploads `app.yaml` verbatim and harvests
nothing** from `resources.json` — so the OTHER resource vars (`DEMO_CATALOG`,
`GENIE_SPACE_ID`, `MAS_ENDPOINT_NAME`, `DASHBOARD_ID`, …) still must be present
in `app.yaml`'s `env:` block when deploying interactively (only the DAB path's
`finalize_app.sh` injects them). The MLflow path is the one that no longer
needs it.

**Lakebase: use OAuth, not password.** The AppKit `lakebase()` plugin fetches and auto-refreshes 1-hour OAuth tokens (2-minute refresh buffer) and injects them into every `pg.Pool` connection. Code is just `createDb(appkit.lakebase.pool)`. Do not set `PGPASSWORD`.

Identity: local dev = your Databricks user (`databricks auth describe`). Deployed = the app's service principal, auto-granted `CONNECT_AND_CREATE` via the `databricks.yml` Postgres resource.

#### 4a. Provision your Lakebase database

Run `./scripts/lakebase_setup_db.sh` once to ensure the Lakebase project + branch + endpoint + database exist (idempotent: reuses what's already there).

```bash
./scripts/lakebase_setup_db.sh --db-name dbgen_<demo_short_name>
# or with project overrides: --project-id <id>  --branch-id <id>
```

`<demo-short-name>` is short, lowercase, - (e.g. `dbge-luxebeauty`). The script derives the resource slug as `db-` + name with `_` → `-`. Branch defaults to `production`.

Without `--project-id` the script uses the shared `dbdemos-asset-generator` project (auto-bumps to `-2`, `-3`, … up to `-9` if full). Pass `--project-id` for a dedicated databricks lakebase project (no fallback — fails loudly if full).

The script prints the connection values at the end — copy them straight into `.env` for local dev (see below).

Save **both** the project UUID and the slug into `resources.json`. They serve different jobs:

- **`lakebase_project_id`** — the UUID (`uid` field). Powers the workspace UI link (`{host}/lakebase/projects/<uuid>`). The slug alone **does not resolve** in the browser.
- **`lakebase_project_slug`** — the human-readable slug. Stays in CLI commands, DAB variable substitution, and any resource path that uses `projects/<slug>/branches/...`.

Fetch the UUID via the `uid` field of `get-project`:

```bash
databricks postgres get-project "projects/<slug>" -o json | jq -r '.uid'
# e.g. projects/my-app → <project-uuid>
```

Then write both:

```json
"lakebase_project_id": "<uid from get-project>",
"lakebase_project_slug": "<slug passed to lakebase_setup_db.sh>",
"lakebase_database": "dbgen_<demo_short_name>"
```

**Cleanup:**
when requested only:
```bash
databricks postgres delete-database \
    projects/<resolved project_id>/branches/production/databases/db-dbgen-<demo_short_name>
```

#### 4b. Fill `.env` (local dev only)

Copy the values printed by `lakebase_setup_db.sh` (Step 4a) into `.env`, plus the workspace + warehouse identifiers.

Use `.env.template` as the canonical list (copy it to `.env`, fill in). It
covers workspace + warehouse + the demo's catalog/schema + resource-deep-link
IDs + Lakebase:

```env
# Databricks workspace
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_WORKSPACE_ID=<workspace-id>
DATABRICKS_WAREHOUSE_ID=<warehouse-id>          # analytics + Delta→Lakebase sync
WAREHOUSE_ID=<warehouse-id>                     # same value; /platform deep-link tile

# Demo data (Unity Catalog) — drives config/app.json data.* + analytics SQL.
# Set these for working /analytics + data sync; unset → those degrade.
DEMO_CATALOG=<catalog>
DEMO_SCHEMA=<schema>

# Resource deep-links + agent wiring — empty = inert tile / disabled tool.
# Fill from resources.json once the resources are deployed.
DASHBOARD_ID=
PIPELINE_ID=
GENIE_SPACE_ID=
KA_ENDPOINT_NAME=
MAS_ENDPOINT_NAME=
# Agent-traces experiment. Leave EMPTY in most cases — the app self-derives
# /Shared/solution_builder/<DATABRICKS_APP_NAME>-agent-traces at boot when this
# is unset (and get-or-creates it). Set it only to pin a non-default path, or
# for local dev where DATABRICKS_APP_NAME isn't injected and you still want
# traces (e.g. /Shared/solution_builder/<app_name>-agent-traces).
AGENT_MLFLOW_EXPERIMENT_PATH=

# Lakebase — values come from lakebase_setup_db.sh. AppKit's lakebase plugin
# mints a short-lived OAuth token via the SDK auth chain (no PGUSER/PGPASSWORD).
# Resource PATHS (LAKEBASE_*) feed the AppKit plugin config; connection-string
# values (PG*) feed the pg.Pool. Don't swap them.
LAKEBASE_ENDPOINT=projects/<project_id>/branches/production/endpoints/primary
LAKEBASE_BRANCH=projects/<project_id>/branches/production
LAKEBASE_DATABASE=projects/<project_id>/branches/production/databases/db-dbgen-<demo_short_name>
PGHOST=ep-small-xxx-xxx.database.xxx.cloud.databricks.com
PGDATABASE=dbgen_<demo_short_name>
PGPORT=5432
PGSSLMODE=require
```

If the demo is later packaged as a DAB and deployed via `databricks bundle deploy`, every variable except `LAKEBASE_ENDPOINT` is auto-injected by the bundle's `postgres` resource binding. The runtime injects `PGUSER` as the service principal's application ID (UUID).

The app's startup script validates required env vars and fails loudly if any are missing.

### Step 5: Validate

Static checks first:

- `npm run build` succeeds
- `config/app.json` resource IDs match `resources.json`
- `data.tables` names match pipeline's actual Delta table names
- Agent tools reference correct Lakebase schema columns

Then run a **one-shot smoke test** — start the app once on a random debug port, let it boot, stop it. This catches runtime errors (missing env vars, Lakebase OAuth misconfig, Delta→PG type mismatches, schema drift) *before* handing back to the user. Do this only once at the very end of the initial build (or after a substantive change on request). **It is mandatory to stop it afterwards regardless of outcome** — the Demo Prompt Generator UI supervises the process lifecycle going forward (and may already have a preview running for this project on the default port), so a leftover smoke-test process would collide or orphan.

Run it yourself (you know how to background a process, poll a port, and tail a log). What matters:

- **Random high port** in 40000-49999 (clear of the default 8765 and the UI's own preview port); pass it as `DATABRICKS_APP_PORT` — `start.sh` reads it.
- **Redirect logs to a per-project path**, e.g. `/tmp/<project-id>/app-smoke.log` — NOT a shared `/tmp/app-smoke.log`, or two concurrent demo builds clobber each other.
- **Wait up to ~180s.** Cold boot does a lot before it listens: `npm ci`, `predev` (sync + typegen + `db:generate`), tsx compile, `runMigrations`, and the Delta→Lakebase sync. Don't kill early.
- **Watch the log while waiting** — surface a fatal error (uncaught exception, missing module, `relation … does not exist`, invalid token, `EADDRINUSE`, migration failure) as soon as it appears instead of sitting blind for 3 minutes.
- Success = the port accepts a connection. Crash = the process exited. A 180s no-listen with the process still alive is usually just a slow `npm ci`/sync — dump the log and investigate, don't assume failure.

Then:

- Review the log for any errors. If the app crashed or logged fatal errors, fix them before reporting the build complete. Common issues: missing `DATABRICKS_HOST`, wrong catalog/schema, Lakebase endpoint not reachable, agent tool referencing a table column that doesn't exist yet.
- Test the main endpoints (some get/create), make sure you test the chatbot / assistant endpoints as it's often having issue. 
If you see errors, check the logs and fix the errors accordingly, and restart the app until it's working. The app should be functional once you finish

Fix any error and loop until the app starts properly.

**Don't leave the app running.** From this point on, the **App** tab in the Demo Prompt Generator UI owns the process lifecycle — it spawns, supervises, proxies, and stops on idle / explicit Stop. A leftover smoke-test process would be untracked and could block the UI's own port. Verify with `lsof -iTCP:$PORT -sTCP:LISTEN` before reporting done.

ALWAYS stop the smoke-test process — whether it booted, crashed, or we're still waiting — before reporting done (kill the PID you backgrounded; `-9` if needed).

Once the initial run is done, **Never run `./start.sh` casually.** Only during the one-shot smoke test described above, or when a user explicitly asks you to debug a boot issue — and always kill it immediately after. The UI is the single supervisor of the app process; any other `start.sh` run will collide with it.

Tell the user the build is complete and point them at the **App** tab to start it.

**Record the app name in `resources.json` now** (before any deploy). The app's initial setup is done, so persist `created_resources.app.name` = the resolved app name (`dbgen-<demo_short_name>`). This alone marks the app capability "built" in the UI — a preview-only app that never deploys still counts as complete. (`app.id`/`app.url` come later, only if the user deploys — Step 6.)

```json
"app": { "name": "dbgen-<demo_short_name>" }
```

### Step 6: Deploy the app (only on explicit user request, don't do it by default)

**Ask for confirmation** — Only deploy if the user explicitly ask ("deploy the app" / "push the app" / "create the Databricks App")
Always make sure you ask them if they don't want to preview the app instead using the UI: "You can preview the app from the UI and have interactive debugging. Are you sure you want to deploy it now?"

Note: "Deploy resources" / "deploy the demo" means everything *except* the app.

This is the **interactive** deploy path. We do NOT run `databricks bundle deploy` here — the project's `databricks.yml` is shipped in the source so the user can run a bundle deploy themselves later; the skill's job is the live push.

**Pick the app name from `resources.json`:**
- If `created_resources.app.name` is set → reuse it (redeploy), BUT FIRST validate it against the rules below.
- If not set → first-time. Use `dbgen-<demo_short_name>` (e.g. `dbgen-luxebeauty`). Verify the name is free first — if `databricks apps get <name>` returns a result, **stop and ask the user**.

**Hard rule — protected names you must NEVER use:**
- `dbdemos-generator` is the **official production app that runs this skill itself**. Deploying onto it would overwrite the live tool every user is using.
- `dbdemos-generator-staging` is its staging twin — same rule.
- Any name matching `dbdemos-generator*` is reserved.

If the resolved `APP_NAME` matches any of these — whether from `resources.json`, `.env`, or any other source — STOP, do not deploy, tell the user the name is reserved and ask them to pick a `dbgen-<demo_short_name>` value. Update `resources.json` with the new name before retrying.

**Workspace Apps quota is hit (cannot create new app):**
If `databricks apps create` fails with a quota / "workspace apps limit" / "app limit exceeded" error, do **NOT** try to reuse some existing app name to bypass it. Stop the deploy entirely and tell the user:

> "The workspace is at its Databricks Apps quota — I can't create `<APP_NAME>` right now. For this demo session, you can use the **Preview** button in the UI's App tab to run the app locally without deploying. To enable a real deploy later, free a slot in `databricks apps list` and ask me to re-run the deploy step.

Instead, you can preview the app from the UI to avoid this issue."

Record the quota failure in `resources.json` `created_resources.app.deployment_note` so the next session sees it.

Make sure `.env` has `APP_NAME` set to the resolved name and the Lakebase values from Step 4a are populated (LAKEBASE_PROJECT_ID, LAKEBASE_ENDPOINT, PGHOST, PGDATABASE). Then run the wrapper:

```bash
./scripts/deploy.sh
```

The script reads `.env` and does it all: rebuilds `dist/` from source (never ships a stale build), uploads source, creates the App if missing, deploys (which applies the OBO scopes from `app.yaml`'s `user_authorization.scopes` — incl. `model-serving`, needed by the agent's `/serving-endpoints/responses` call), then runs `lakebase_grant_app_credential.sh` (creates/grants the SP's Postgres role + reassigns any stale prior-SP ownership), starts the App, and prints URL + status + the `databricks apps logs` tail command. Idempotent on every step. Common failures (quota, name taken, permission denied) surface as one-line actionable errors.

**⚠️ Scopes come from `app.yaml`, not from `apps create/update`.** The agent's OBO token gets its scopes from `app.yaml`'s `user_authorization.scopes` (applied at `apps deploy`). Do NOT set `user_api_scopes` via `databricks apps update --json` on this interactive path — it overrides app.yaml's scopes with a *different vocabulary* (`serving.serving-endpoints` ≠ `model-serving`) and the agent then 403s `Invalid scope, required scopes: model-serving`. If the agent 403s, the fix is in `app.yaml` (+ redeploy), not an out-of-band `apps update`.

**No resource binding on this path** (no action needed): the `valueFrom:` refs in `app.yaml` only resolve via DAB; interactively the app has `resources: []` and reads PG*/warehouse from `.env` + platform injection. `deploy.sh` runs `lakebase_grant_app_credential.sh` to create/grant the SP's Postgres role.

**Redeploy after a delete:** the recreated app gets a new SP, but the old SP still owns the Lakebase schemas → boot `28P01`/`must be owner`. `lakebase_grant_app_credential.sh` fixes this automatically (reassigns ownership via `postgres delete-role --reassign-owned-to`). If you ever hit it by hand, that's the one command (use the role's `name` path, not the SP UUID).

**After deploying, add the `id` to the app block in `resources.json` `created_resources`** (`name` was already recorded at the end of Step 5):

```json
"app": {
  "name": "<app-name>",
  "id": "<from `databricks apps get $APP --output json | jq -r .id`>",
  "deployment_note": "<free-form: deployed OK / quota hit / etc.>"
}
```

The UI's deployed-resources bar reads `app.name` to build the `/apps/<name>` link. `deployment_note` is where you record caveats (quota errors, partial deploys) for next session.

#### When the user wants to ship the demo as a bundle (DAB)

Separate from the interactive deploy above: when the user asks for "a DAB /
bundle" or "let me deploy this myself," you author a project-root
`databricks.yml` that provisions **everything** (schema, volumes, pipeline,
dashboard, app shell) + a setup job that fills them in. The full authoring
guide is in `references/dab/dab.md`; a complete, working reference DAB lives in
the test app at `app/test/app_template_test/databricks.yml` — copy its shape.

The deploy is **5 commands** (the user runs them; the skill does NOT run
`databricks bundle deploy` itself):

```bash
# 1. Lakebase DB (pre-deploy)
./app/scripts/lakebase_setup_db.sh --db-name dbgen_<demo>
# 2. Provision resource shells + setup job
databricks bundle deploy --var catalog=… --var schema=… --var warehouse_id=…
# 3. Run the setup job (data → pipeline → MV/ML → genie/ka/mas → export_resources)
databricks bundle run <demo>_setup --var …
# 4. Grant the app SP on Lakebase schemas (post-deploy)
./app/scripts/lakebase_grant_app_credential.sh --app-name … --project-id … --db-name …
# 5. Harvest resolved IDs → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

Why env is finalized OUTSIDE the bundle (steps 3+5): the Genie/KA/MAS endpoint
IDs only exist AFTER the setup job's SDK tasks run, so the bundle can't know
them at `deploy` time. The job's last task (`export_resources`) exits a JSON
manifest of every resolved ID; `finalize_app.sh` reads it back
(`get-run-output`) and writes `app.yaml`'s env. This keeps a bare
`bundle deploy` from ever shipping a half-configured app — env is assembled in
exactly one place.

⚠️ **Never run `databricks apps update --json` to tweak a deployed app's
scopes/config out of band** — `update` replaces the whole app spec and silently
drops the `resources` bindings (→ Lakebase SP role deprovisioned → Postgres
auth fails). Change app config only in `databricks.yml` + redeploy via the
bundle, or in `app.yaml` via `finalize_app.sh`.