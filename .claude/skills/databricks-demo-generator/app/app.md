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

```bash
cp -r {DEMO_SKILL}/app/app_template ./app
cd ./app && npm install
```

### Step 2: Read the demo's app specs + template map

1. Read `TEMPLATE_MAP.md` in the app root — comprehensive map of every file, schema, route, tool, and component. Tells you what to customize vs keep as-is. **Read this instead of scanning the codebase.**
2. Read the app specs from `specifications/app/` in the current project (written during SKILL.md Phase 4). These describe the pages, assistant behavior, agent tools, data model, and narrative for **this specific demo**.

### Step 3: Customize the template

This is a heavy edit — the template is a skeleton, not a drop-in. Use the demo's app specs as your blueprint and rewrite the customizable areas (see table above) to match the story. For each area, read the existing template code, understand the pattern, then rewrite for the new domain.

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

### Step 4: Configure environment

The app needs a `.env` file with Databricks + Lakebase connection details. `.env.template` has the full list with comments.

1. Copy `.env.template` to `.env` (or run `./start.sh` — it does this automatically on first run)
2. Fill in the values from the Lakebase project created during the build phase:
   - `DATABRICKS_HOST` — workspace URL
   - `LAKEBASE_ENDPOINT`, `PGHOST` — from `databricks lakebase projects describe <project-name>`
   - `DATABRICKS_WAREHOUSE_ID` — the SQL warehouse powering analytics + sync
   - `DATABRICKS_WORKSPACE_ID` — workspace ID (visible in workspace URL)
3. `./start.sh` validates required values and fails with a clear message if any are missing

### Step 5: Validate

- `./start.sh` starts without errors
- `npm run build` succeeds
- `config/app.json` resource IDs match `resources.json`
- `data.tables` names match pipeline's actual Delta table names
- Agent tools reference correct Lakebase schema columns
