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

### Step 4: Configure environment

**lakebase: Use OAuth, not password.** The AppKit `lakebase()` plugin fetches and auto-refreshes 1-hour OAuth tokens (2-minute refresh buffer) and injects them into every `pg.Pool` connection. Code is just `createDb(appkit.lakebase.pool)`. **Do NOT create a password role, do NOT call `reveal_password`, do NOT set `PGPASSWORD`.**

Identity: local dev = your Databricks user (`databricks auth describe`). Deployed = the app's service principal, auto-granted `CONNECT_AND_CREATE` via the `databricks.yml` Postgres resource.

#### 4a. Create the Lakebase project

```bash
databricks postgres create-project <PROJECT_ID> \
    --json '{"spec": {"display_name": "<Display Name>", "pg_version": "17"}}'
```

- `PROJECT_ID`: lowercase + hyphens (e.g. `my-app`). Long-running — blocks until the default endpoint `primary` is `READY`.
- A fresh project comes with: branch `production`, endpoint `primary`, database `databricks_postgres`.
- **The creator is auto-granted `DATABRICKS_SUPERUSER` on `production`.** Skip 4b if you created the project.
- Save `PROJECT_ID`, `production`, `databricks_postgres` into `resources.json`.

#### 4b. Grant `DATABRICKS_SUPERUSER` to other local developers (skip if you're the creator)

Lakebase has two independent permission systems: workspace ACLs (who sees the project in the UI) and Postgres roles (what you can do once connected via OAuth). Every teammate who wants to run the app locally needs the Postgres role — without it their OAuth token connects but DDL fails with `permission denied`. In production this is unnecessary: the service principal gets `CONNECT_AND_CREATE` via `databricks.yml`.

**Case A — teammate has already connected at least once** (a role row exists):

```bash
# 1. Find the role name
databricks postgres list-roles projects/<PROJECT_ID>/branches/production
# Locate the entry where .status.postgres_role == "<teammate-email>"; copy .name
# (e.g. projects/<PROJECT_ID>/branches/production/roles/rol-abcd-1234)

# 2. Add DATABRICKS_SUPERUSER
databricks postgres update-role <ROLE_NAME> spec.membership_roles \
    --json '{"spec": {"membership_roles": ["DATABRICKS_SUPERUSER"]}}'
```

**Case B — teammate has never connected** (no role row yet). The native `postgres create-role` silently drops `attributes` and `membership_roles`, so use the raw API:

```bash
databricks api post \
    "/api/2.0/postgres/projects/<PROJECT_ID>/branches/production/roles?role_id=<role-id>" \
    --json '{"spec": {"attributes": {"createdb": true, "createrole": true, "bypassrls": true},
                      "identity_type": "USER",
                      "auth_method": "LAKEBASE_OAUTH_V1",
                      "postgres_role": "<teammate-email>",
                      "membership_roles": ["DATABRICKS_SUPERUSER"]}}'
```

`<role-id>` is a lowercase-hyphens resource name you pick (e.g. `user-bastian`). To revoke, run the Case A update with `"membership_roles": []`.

#### 4c. Fill `.env` (local dev only)

**Two Lakebase values, two roles — do not confuse them:**

| Variable | What it is | Format / example |
|----------|------------|------------------|
| `LAKEBASE_ENDPOINT` | **Resource name** (a path). Used by AppKit to refresh OAuth tokens. | `projects/<PROJECT_ID>/branches/production/endpoints/primary` |
| `PGHOST` | **DNS hostname**. Used by psycopg/node-postgres to open the TCP connection. | `ep-small-dawn-d13fr9rm.database.us-west-2.cloud.databricks.com` |

A common mistake is putting the hostname in both. If `LAKEBASE_ENDPOINT` has dots in it, it's wrong — it must start with `projects/`.

Both values come from the same command:

```bash
databricks postgres get-endpoint projects/<PROJECT_ID>/branches/production/endpoints/primary
# .name            → LAKEBASE_ENDPOINT  (e.g. "projects/<PROJECT_ID>/branches/production/endpoints/primary")
# .status.hosts.host → PGHOST            (e.g. "ep-small-dawn-d13fr9rm.database.us-west-2.cloud.databricks.com")
```

(`get-project` and `get-branch` don't return the host — you must use `get-endpoint`.)

```env
# Databricks workspace
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_WORKSPACE_ID=<workspace-id>
DATABRICKS_WAREHOUSE_ID=<warehouse-id>          # powers analytics + Delta→Lakebase sync

# Lakebase — OAuth, NO password. LAKEBASE_ENDPOINT is a resource path; PGHOST is a hostname.
LAKEBASE_ENDPOINT=projects/<PROJECT_ID>/branches/production/endpoints/primary
PGHOST=<host from .status.hosts.host — ends in .cloud.databricks.com>
PGPORT=5432
PGDATABASE=databricks_postgres                  # default on a fresh project
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

# ALWAYS stop — whether it booted, crashed, or we're still waiting.
kill "$APP_PID" 2>/dev/null
# Give it a moment, then SIGKILL if still alive.
sleep 2
kill -9 "$APP_PID" 2>/dev/null || true
```

Review `/tmp/app-smoke.log` for any errors. If the app crashed or logged fatal errors, fix them before reporting the build complete. Common issues: missing `DATABRICKS_HOST`, wrong catalog/schema, Lakebase endpoint not reachable, agent tool referencing a table column that doesn't exist yet.

> **Don't leave the app running.** From this point on, the **App** tab in the Demo Prompt Generator UI owns the process lifecycle — it spawns, supervises, proxies, and stops on idle / explicit Stop. A leftover smoke-test process would be untracked and could block the UI's own port. Verify with `lsof -iTCP:$PORT -sTCP:LISTEN` before reporting done.
>
> Tell the user the build is complete and point them at the **App** tab to start it.
