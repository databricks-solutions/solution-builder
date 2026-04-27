# App Generation — Databricks Apps from Template

Invoked as the **final stage** of demo generation, after all other resources (pipeline, dashboard, Genie, KA, MAS) are built and working.

## Template overview

Full-stack Node.js/React Databricks App. The assistant doesn't just answer — it **investigates via MAS, drafts actions, writes to Lakebase on approval**. Wiring + scripted demo chain live in `config/app.json`; home-page narrative copy (hero persona, headline, situation, goal, starter questions, featured action) is hardcoded at the top of `HomeView.tsx` so each demo can reshape the landing freely.

### Required resources

| Component | Required? | Notes |
|-----------|-----------|-------|
| **MAS endpoint** | Yes (or Genie) | Assistant delegates data/doc questions to MAS. Genie endpoint works as fallback, or pure open ai agent with custom tools. |
| **Lakebase** | Yes | OLTP mirror of Delta — the write-capable operations surface. |
| **SQL Warehouse** | Yes | Powers analytics page + Delta→Lakebase sync. |
| **Delta tables** | Yes | Source of truth, synced to Lakebase at boot. |
| **Dashboard** | Optional | Embedded iframe. Remove Dashboard route if none. |

### What the template provides (avoid rewrite, just tune when required)

Chat UI (dock + full-page), streaming with thinking panel, MLflow tracing per turn, feedback (thumbs → MLflow assessments), SSE infrastructure, auth (OBO), sidebar/header shell, Drizzle ORM migrations, Delta→Lakebase sync framework, admin reset endpoint.

### What gets customized per demo

| Area | What to change |
|------|---------------|
| **Config** | `config/app.json` — branding, scripted demo chain (`assistantScript`), data sources, resource IDs (agent endpoint, warehouse, MLflow, dashboard) |
| **Home narrative** | `client/src/home/HomeView.tsx` top-of-file constants — `HERO`, `STORY` (headline/situation/goal), `STARTER_QUESTIONS`, `FEATURED_ACTION`. Rewrite these to match the demo; the template values are an example, not a pattern to preserve |
| **Domain schema** | Lakebase entity tables (keep chat state as-is). Preserve the append-only JSONB audit columns pattern — powers the operations timeline |
| **Data sync** | Delta→Lakebase SELECTs for the domain's data subset |
| **Domain queries** | Lookup + bulk-update helpers for the operations entity |
| **Agent** | Tools + instructions. MAS/Genie passthrough typically stays; domain tools (find, batch-process, create) get rewritten |
| **Analytics SQL** | Warehouse queries for the domain's charts |
| **Frontend** | Home page journey cards, operations page (columns, drawer tabs, detail content), analytics charts if layout changes |
| **Theming** | `client/src/index.css` `:root` block — all colors are CSS custom properties. Change the palette there to rebrand (primary, accent, status tints, tier badges, charts). No hardcoded colors in components |

## How to generate

### Step 1: Copy template + install

The template folder may contain a local `node_modules/`, `.env`, `drizzle/`, or build artifacts from prior dev — use `rsync` (or equivalent) to exclude them. Never copy `.env` (may contain secrets) or `node_modules/` (broken symlinks after `cp -r`).

```bash
rsync -a \
  --exclude node_modules \
  --exclude .env \
  --exclude dist \
  --exclude .DS_Store \
  {DEMO_SKILL}/app/app_template/ ./app/
cd ./app && npm install
```

### Step 2: Read the demo's app specs + template map

1. Read `TEMPLATE_MAP.md` in the app root — comprehensive map of every file, schema, route, tool, and component. Tells you what to customize vs keep as-is. **Read this instead of scanning the codebase.**
2. Read the app specs from `specifications/app/` in the current project (written during stage 2). These describe the pages, assistant behavior, agent tools, data model, and narrative for **this specific demo**.
3. run sql exploration against the delta table to get the exact schema for the tables you want to use/query (output of the sdp pipeline) (when loading data from delta to PG, be careful with the data type to avoid conflict).
  - `databricks experimental aitools tools query --warehouse WH "SHOW TABLES IN catalog.schema"`
  - `databricks experimental aitools tools discover-schema catalog.schema.table1 catalog.schema.table2`
  - `databricks experimental aitools tools query --warehouse WH "SELECT..."`


### Step 3: Customize the template

This is a heavy edit — the initial files you have are from a template with a use case for luxe beauty. It's a skeleton, not a drop-in ready to use. 
Use the demo's app specs as your blueprint and rewrite all the customizable areas (see table above) to match the story. For each spec and area, read the existing template code, understand the pattern, then entirely rewrite for the new domain. Typically, the operational part needs to be fully updated
Remember - change the style / features so that it respects the user intent and matches with the story.

Key patterns to preserve:
- **3-phase action chain**: discover (read-only) → draft + confirm (STOP for approval) → execute. The mandatory approval stop is the demo's trust moment.
- **Append-only audit columns** on the primary entity — powers the Activity tab timeline.
- **`assistantScript`** in config with `triggerAfter` keywords — drives the scripted demo path.
- **KPI cards** that tick live when the agent writes — the real-time feedback loop.
- **Thinking panel** streaming MAS sub-agent activity — the transparency demo moment.
- **Reset demo** button (header) — truncates all Lakebase tables and re-syncs from Delta. The demo makes real writes (approvals, emails, audit trail), so a one-click reset to restart from the beginning of the story is essential. Keep this unless explicitly told otherwise.

Handle missing components during this step:
- **No MAS, has Genie**: Point `ask_data` to Genie endpoint. Streaming interface is compatible.
- **No MAS, no Genie**: Use a pure OpenAI Agents SDK agent with custom tools (no `ask_data` passthrough).
- **No dashboard**: Remove Dashboard route + sidebar entry.
- **No KA**: MAS routes everything to Genie — no code change needed.

Make sure you do an extensive review - no mention to the template specific use-case, everything is migrate to the new app story, rename/delete file to support the new specification, review the full implementation to make sure it's all up to date and we'll be able to start and make the app work.

read `resources.json` to get the available resource ids to use (ex: mas endpoint)

### Step 4: Configure environment

**Lakebase: use OAuth, not password.** The AppKit `lakebase()` plugin fetches and auto-refreshes 1-hour OAuth tokens (2-minute refresh buffer) and injects them into every `pg.Pool` connection. Code is just `createDb(appkit.lakebase.pool)`. Do not set `PGPASSWORD`.

Identity: local dev = your Databricks user (`databricks auth describe`). Deployed = the app's service principal, auto-granted `CONNECT_AND_CREATE` via the `databricks.yml` Postgres resource.

#### 4a. Provision your Lakebase database

Each app gets its own Postgres database on the shared project's `production` branch. If the shared project doesn't exist, fall back to creating your own.

**Step 1 — Find (or create) the project**

```bash
PROJECT=$(databricks postgres list-projects \
  | jq -r '.[] | select(.name | startswith("projects/dbdemos-asset-generator")) | .name')
```

If empty, create your own:

```bash
databricks postgres create-project <PROJECT_ID> \
    --json '{"spec": {"display_name": "<Display Name>", "pg_version": "17"}}'
PROJECT="projects/<PROJECT_ID>"
```

(`create-project` blocks until the `primary` endpoint is `READY` — ~minutes. Shared-project case is instant.)

**Step 2 — Resolve the Postgres host**

The branch's `primary` endpoint carries the DNS hostname. Only `get-endpoint` returns it.

```bash
PGHOST=$(databricks postgres get-endpoint "$PROJECT/branches/production/endpoints/primary" \
  | jq -r '.status.hosts.host')
```

**Step 3 — Create your app's database**

Name it `dbgen_<demo_short_name>` (e.g. `dbgen_luxebeauty`, `dbgen_windcore`). Keep it short, lowercase, underscores — same idea as the catalog name.

```python
import psycopg
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
host = "<PGHOST from Step 2>"
user = w.current_user.me().user_name
token = w.config.oauth_token().access_token

# Connect to the default `databricks_postgres` DB just to run CREATE DATABASE
# (Postgres requires you to be connected to *some* existing DB). After this,
# your app connects to dbgen_<demo_short_name> instead.
# autocommit=True is mandatory — CREATE DATABASE can't run in a transaction.
with psycopg.connect(
    host=host, user=user, password=token,
    dbname="databricks_postgres", sslmode="require", autocommit=True,
) as conn:
    conn.execute('CREATE DATABASE "dbgen_<demo_short_name>"')
```

Save into `resources.json`:

```json
"lakebase_project_id": "<project-id-from-PROJECT>",
"lakebase_database": "dbgen_<demo_short_name>"
```

**Gotchas:**
- `autocommit=True` is required for `CREATE DATABASE`.
- Connect as yourself — don't `SET ROLE databricks_superuser`.
- OAuth tokens have a 1h TTL; refresh before each new connection in long-running scripts.
- `sslmode="require"` is mandatory.

**Cleanup**

```sql
-- From psycopg, connected to databricks_postgres
DROP DATABASE "dbgen_<demo_short_name>";
```

#### 4b. Fill `.env` (local dev only)

The branch path is always `projects/<lakebase_project_id>/branches/production`.

**Two Lakebase values, two roles — do not confuse them:**

| Variable | What it is | Format / example |
|----------|------------|------------------|
| `LAKEBASE_ENDPOINT` | **Resource name** (a path). Used by AppKit to refresh OAuth tokens. | `projects/<lakebase_project_id>/branches/production/endpoints/primary` |
| `PGHOST` | **DNS hostname**. Used by psycopg/node-postgres to open the TCP connection. | `ep-small-dawn-d13fr9rm.database.us-west-2.cloud.databricks.com` |

If `LAKEBASE_ENDPOINT` has dots in it, it's wrong — it must start with `projects/`.

Both values come from the same command:

```bash
databricks postgres get-endpoint projects/<lakebase_project_id>/branches/production/endpoints/primary
# .name              → LAKEBASE_ENDPOINT
# .status.hosts.host → PGHOST
```

```env
# Databricks workspace
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_WORKSPACE_ID=<workspace-id>
DATABRICKS_WAREHOUSE_ID=<warehouse-id>          # powers analytics + Delta→Lakebase sync

# Lakebase — OAuth, NO password. LAKEBASE_ENDPOINT is a resource path; PGHOST is a hostname.
LAKEBASE_ENDPOINT=<BRANCH_PATH>/endpoints/primary
PGHOST=<host from .status.hosts.host — ends in .cloud.databricks.com>
PGPORT=5432
PGDATABASE=dbgen_<demo_short_name>                          # the database you created in 4a Step 4
PGUSER=<your Databricks email>                  # local dev only
PGSSLMODE=require
# No PGPASSWORD.
```

In production, every variable except `LAKEBASE_ENDPOINT` is auto-injected by the `databricks.yml` Postgres resource. The runtime injects `PGUSER` as the service principal's **application ID (UUID), not an email** — never hard-code `PGUSER` in anything that ships to prod.

The app's startup script validates required env vars and fails loudly if any are missing.

**Sanity check before moving on**: `grep LAKEBASE_ENDPOINT .env` should show a value starting with `projects/`; `grep PGHOST .env` should show a value ending with `.cloud.databricks.com`. If either looks wrong, you'll get the `Endpoint name expects 'projects/{project_id}/branches/{branch_id}/endpoints/{endpoint_id}' format` error at app boot.

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
If you see errors, check the logs and fix the errors accordingly, the app should be functional once you finish

**Don't leave the app running.** From this point on, the **App** tab in the Demo Prompt Generator UI owns the process lifecycle — it spawns, supervises, proxies, and stops on idle / explicit Stop. A leftover smoke-test process would be untracked and could block the UI's own port. Verify with `lsof -iTCP:$PORT -sTCP:LISTEN` before reporting done.

ALWAYS stop — whether it booted, crashed, or we're still waiting.
`kill -9 "$APP_PID" 2>/dev/null || true`

**Never run `./start.sh` casually.** Only during the one-shot smoke test described above, or when a user explicitly asks you to debug a boot issue — and always kill it immediately after. The UI is the single supervisor of the app process; any other `start.sh` run will collide with it.

Tell the user the build is complete and point them at the **App** tab to start it.

### Step 6: Deploy the app (only on explicit user request)

**Do NOT deploy the app by yourself.** When the user says "deploy resources" / "deploy the demo" / similar, that means everything *except* the app (pipeline, dashboard, Genie, KA, MAS, model, etc.). The app is deployed **only** when the user explicitly says something like "deploy the app" / "push the app to the workspace" / "create the Databricks App."

DO NOT OVERRIDE/DELETE another existing app. If you hit quota limits, just report to the user and save it in resource.json app.deployment_note.

When they do ask, the flow is:

```bash
# 1. Create the app (once — name must be unique in the workspace)
databricks apps create <app-name>

# 2. Upload source code to a Workspace path
databricks workspace mkdirs /Workspace/Users/<user>/apps/<app-name>
databricks workspace import-dir . /Workspace/Users/<user>/apps/<app-name> --overwrite

# 3. Deploy that source as a new app deployment
databricks apps deploy <app-name> \
  --source-code-path /Workspace/Users/<user>/apps/<app-name>

# 4. Attach resources via the workspace UI
#    (SQL warehouse, Lakebase, secrets — bind to the env vars referenced in app.yaml)

# 5. Check status + get the URL
databricks apps get <app-name>
```

**Redeploys** (after code changes):

```bash
# Clean the workspace path then re-upload. `--overwrite` on import alone
# doesn't prune removed/renamed files — delete first, re-import everything.
# The `|| true` tolerates the first-time case where the dir doesn't exist yet.
databricks workspace delete /Workspace/Users/<user>/apps/<app-name> --recursive 2>/dev/null || true
databricks workspace import-dir . /Workspace/Users/<user>/apps/<app-name>
databricks apps deploy <app-name> \
  --source-code-path /Workspace/Users/<user>/apps/<app-name>
```

**`app.yaml`** lives at the repo root and tells the runtime how to start. This template's `app.yaml` is Node-based (`command: ['npm', 'run', 'start']`) — don't change that unless you've also swapped the framework.

Environment variable bindings (`env:` block with `valueFrom: <resource-name>`) can be declared in `app.yaml` but are generally **attached via the UI after create** — that's cleaner for demos since resource IDs differ per workspace. The template's `app.yaml` ships with the reference shape commented out.

**After deploying, record the app in `resources.json`.** Under `created_resources`, add (or update) the nested `app` object:

```json
"app": {
  "name": "<app-name>",                   // the argument you passed to `databricks apps create`
  "id": "<id from `databricks apps get`>",// optional — the workspace-assigned app id, if needed for APIs
  "deployment_note": "<one-liner>"        // free-form: deployed successfully / quota hit / etc.
}
```

The `deployment_note` is where you record any caveat — quota errors, partial deploys, "reused existing app", whatever's worth knowing on the next run. The UI's deployed-resources bar reads `app.name` to build the `/apps/<name>` link.