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
| **Domain schema** | Lakebase entity tables (keep chat state as-is). Preserve the append-only JSONB audit columns pattern — powers the operations timeline, delete the example-specific one |
| **Data sync** | Delta→Lakebase SELECTs for the domain's data subset |
| **Domain queries** | Lookup + bulk-update helpers for the operations entity |
| **Agent** | Tools + instructions. MAS/Genie passthrough typically stays; domain tools (find, batch-process, create, emails...) get rewritten to follow the story |
| **Analytics SQL** | Warehouse queries for the domain's charts |
| **Frontend** | Home page journey cards, operations page (columns, drawer tabs, detail content), analytics charts if layout changes |
| **Theming** | `client/src/index.css` `:root` block — all colors are CSS custom properties. Change the palette there to rebrand (primary, accent, status tints, tier badges, charts). No hardcoded colors in components |

## How to generate

### Step 1: Copy template

The template ships with `node_modules/` pre-installed, so you do **not** need to run `npm install` — skip straight to customization. Only exclude `.env` (may contain secrets) and build artifacts.

```bash
rsync -a \
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

#### Adapt the app's visual identity to the domain
If the user mentioned a specific customer, do a websearch on the customer website and extract the customer material / css / color and use the same. If it's a fake customer, pick a good one yourself.
The template ships with one look (editorial, neutral, light-mode-first — designed around a consumer-brand demo). Reusing it verbatim for every demo makes every generated app feel like the same product. **Adjust the visual identity to fit the domain's vibe.** The single source of truth for tokens is `client/src/index.css` (Tailwind v4 `@theme` + CSS variables: `--background`, `--foreground`, `--primary`, `--accent`, `--font-sans`, `--font-display`, `--radius`, etc.). Updating the tokens in one place re-skins the entire app via shadcn/ui + Tailwind.

What's worth tuning per demo:

- **Color palette.** Pick a primary + accent that match the domain's industry conventions. Industrial / operational tools tend dark with strong accent colors; financial / executive tools tend muted with sharper contrast; consumer-brand tools tend warm and editorial. **One bold accent color** that matches the demo's hero element (the anomaly's color, the brand color, the segment-of-interest color) makes the app feel intentional.
- **Light vs. dark default.** Some domains read better in dark mode (SCADA, security ops, traders) — flip the `:root` defaults if so.
- **Typography.** The template uses Geist + Fraunces. Swap for what fits — Inter + IBM Plex for a corporate / data-heavy app, JetBrains Mono accents for a technical / developer-facing one, a more humanist serif for a healthcare / education one. Use Google Fonts via `<link>` in `index.html` (the template already does this).
- **Radius + density.** Industrial / dense apps want smaller `--radius` and tighter padding; consumer / executive apps want larger radius and more breathing room.

Keep it tasteful: pick a coherent palette and stick to it. Don't restyle component-by-component — change the tokens. **Quick sanity check**: open the running app side-by-side with the luxebeauty template; if both look the same, the visual identity hasn't shifted enough.

read `resources.json` to get the available resource ids to use (ex: mas endpoint)

When this app step runs, add the following fields to `created_resources` in `resources.json` — the UI's Products card uses them to render the "Open" buttons for Lakebase and the App:

- `lakebase_project_id` — UUID (`databricks postgres get-project | jq -r .uid`). Powers the `lakebase/projects/<uuid>` link.
- `lakebase_project_slug` — human-readable slug. Used by CLI commands and DAB variable substitution.
- `lakebase_database` — DB name (`dbgen_<demo-short-name>`).
- `app.name` and `app.id` — recorded after the app deploy step.

**`config/app.json` — `agentModel` and `agentEndpointName`:** the assistant talks to TWO things, don't conflate them.

- `agentModel` — the Foundation Model endpoint backing the OpenAI Agents SDK loop. **Use `databricks-gpt-5-4`.** Why: the Agents SDK defaults to the OpenAI Responses API, and Databricks gates that route per-model. GPT-5-4 is the only Databricks-hosted model with `openai/v1/responses` enabled today — Anthropic models (Sonnet 4.6 etc.) return 400 BAD_REQUEST: *"Responses API passthrough is not supported for model …"*. Switching to chat-completions to support Claude would lose the live reasoning UI (Anthropic thinking blocks aren't surfaced as typed SDK events) — not wired up. Use `databricks-gpt-5-4` and don't abbreviate.
- `agentEndpointName` — only used when `mode='mas'` (raw MAS passthrough). For the agent loop it's a no-op label. If the demo has no MAS, leave it empty or set it to the Genie space description; routing happens in code.

### Step 4: Configure environment

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

```env
# Databricks workspace
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_WORKSPACE_ID=<workspace-id>
DATABRICKS_WAREHOUSE_ID=<warehouse-id>          # powers analytics + Delta→Lakebase sync

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

Use a random high port (`$RANDOM` gives 0-32767; shift into 40000-49999 to stay clear of both the default 8765 and whatever port the UI picks for its own preview). `start.sh` reads `DATABRICKS_APP_PORT` from the environment:

```bash
# From inside PROJECT/app, with .env filled:
PORT=$((40000 + RANDOM % 10000))
DATABRICKS_APP_PORT="$PORT" ./start.sh > /tmp/app-smoke.log 2>&1 &
APP_PID=$!

# Give it up to 60s to either serve traffic on its port or fail loudly.
for i in {1..60}; do
  if nc -z localhost "$PORT" 2>/dev/null; then
    echo "App booted on :$PORT"
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "App crashed during boot — dumping logs:"
    cat /tmp/app-smoke.log
    break
  fi
  sleep 1
done
```

- Review `/tmp/app-smoke.log` for any errors. If the app crashed or logged fatal errors, fix them before reporting the build complete. Common issues: missing `DATABRICKS_HOST`, wrong catalog/schema, Lakebase endpoint not reachable, agent tool referencing a table column that doesn't exist yet.
- Test the main endpoints (some get/create), make sure you test the chatbot / assistant endpoints as it's often having issue. 
If you see errors, check the logs and fix the errors accordingly, and restart the app until it's working. The app should be functional once you finish

Fix any error and loop until the app starts properly.

**Don't leave the app running.** From this point on, the **App** tab in the Demo Prompt Generator UI owns the process lifecycle — it spawns, supervises, proxies, and stops on idle / explicit Stop. A leftover smoke-test process would be untracked and could block the UI's own port. Verify with `lsof -iTCP:$PORT -sTCP:LISTEN` before reporting done.

ALWAYS stop — whether it booted, crashed, or we're still waiting.
`kill -9 "$APP_PID" 2>/dev/null || true`

Once the initial run is done, **Never run `./start.sh` casually.** Only during the one-shot smoke test described above, or when a user explicitly asks you to debug a boot issue — and always kill it immediately after. The UI is the single supervisor of the app process; any other `start.sh` run will collide with it.

Tell the user the build is complete and point them at the **App** tab to start it.

### Step 6: Deploy the app (only on explicit user request, don't do it by default)

**Trigger only on explicit ask** — "deploy the app" / "push the app" / "create the Databricks App". "Deploy resources" / "deploy the demo" means everything *except* the app.

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

> "The workspace is at its Databricks Apps quota — I can't create `<APP_NAME>` right now. For this demo session, you can use the **Preview** button in the UI's App tab to run the app locally without deploying. To enable a real deploy later, free a slot in `databricks apps list` and ask me to re-run the deploy step."

Record the quota failure in `resources.json` `created_resources.app.deployment_note` so the next session sees it.

Make sure `.env` has `APP_NAME` set to the resolved name and the Lakebase values from Step 4a are populated (LAKEBASE_PROJECT_ID, LAKEBASE_ENDPOINT, PGHOST, PGDATABASE). Then run the wrapper:

```bash
./scripts/deploy.sh
```

The script reads `.env` and does it all: uploads source to `/Workspace/Users/<me>/apps/<APP_NAME>`, creates the App if missing, deploys the source, waits for the App's Postgres SP role to appear in Lakebase, calls `lakebase_grant_app_credential.sh` to GRANT the SP CREATE+USAGE on schema `public`, starts the App so the container is warm, then prints URL + status + the `databricks apps logs` tail command. Idempotent on every step. Common failures (workspace Apps quota hit, name already taken, permission denied) surface as one-line actionable errors.

**`app.yaml` runtime note** (no action needed): the template's `valueFrom: sql-warehouse` and `valueFrom: postgres` references resolve only when deployed via DAB. With this interactive path, AppKit reads the same values from `.env` (which `deploy.sh` ships with the source), so no UI binding step is required.

**After deploying, record the app in `resources.json` `created_resources`:**

```json
"app": {
  "name": "<app-name>",
  "id": "<from `databricks apps get $APP --output json | jq -r .id`>",
  "deployment_note": "<free-form: deployed OK / quota hit / etc.>"
}
```

The UI's deployed-resources bar reads `app.name` to build the `/apps/<name>` link. `deployment_note` is where you record caveats (quota errors, partial deploys) for next session.

#### When the user wants to ship the demo as a bundle

Separate from the interactive deploy above: if the user asks for "a DAB / bundle" or "let me deploy this myself," the project's `databricks.yml` plus `scripts/lakebase_setup_db.sh` and `scripts/lakebase_grant_app_credential.sh` are already in place. Point them at those — the user runs them on their own machine. The skill does NOT run `databricks bundle deploy`. If not in place, instructions are in dab.md - but it's a bigger task