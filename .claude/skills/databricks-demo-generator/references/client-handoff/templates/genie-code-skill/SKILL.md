---
name: {{demo-slug}}-adaptation
description: Configure and run the {{demo-name}} demo in the user's Databricks workspace. Use when the user is working in (or has imported) the {{demo-slug}} project AND says any of "run in my workspace", "set this up", "configure for my workspace", "configure for my catalog/schema", "deploy this demo", "make this work in my workspace", OR asks about adapting the demo's structure, data contract, swapping synthetic data for real data, or how to point it at their own customer tables.
---

# {{demo-name}} Adaptation

## What this project is
{{one-line-summary}}

## Key files
- `databricks.yml` — bundle config (toggle `run_with_synthetic_data` + customer-data variables here)
- `src/data_generation/`, `src/pipeline/`, `src/deploy/`, `dashboard/` — Faker generator, SDP pipeline, deployers, Lakeview JSON

## Global HARD SCOPE — files this skill MUST NOT edit

The following paths are off-limits to this skill for ANY intent (setup, rename, anything else). If you find yourself about to write to one of these, STOP — that is a defect in your reasoning, not a feature.

- `.assistant/**` — including this very skill file. The adaptation skill MUST NOT modify itself or any other skill.
- `HANDOFF_NOTES.md`, `README.md`, `CHANGELOG.md`, `specifications/**`, `raw_data/**`, `docs/**` — narrative/documentation files belong to the demo author, not the runtime.
- `src/data_generation/generate_data.py` during **setup** (only editable during Step R3 rename, never during Step 3 setup).

If any user request requires editing one of these, refuse: "That file is out of scope for this skill — surface to the demo author."

## How to adapt
Edit `targets.client.variables` in `databricks.yml`: keep `run_with_synthetic_data: "yes"` for first-run; set `client_catalog`, `client_schema`, `warehouse_id` to values that exist in their workspace. Then `databricks bundle deploy && databricks bundle run {{job-name}}`. Swap to real data later by flipping `run_with_synthetic_data: "no"`.

## Auto-detecting and writing workspace config — "run in my workspace"

When the user asks for help configuring `databricks.yml` (e.g., "run in my workspace", "set this up for my workspace", "configure for my catalog"), follow this pattern. **Default `run_with_synthetic_data: "yes"`** so the first run works end-to-end.

### Step 1 — Auto-detect what you can

Run this discovery snippet in a notebook in the client's workspace:

```python
workspace_url = spark.conf.get("spark.databricks.workspaceUrl")
current_user = spark.sql("SELECT current_user()").collect()[0][0]
current_catalog = spark.sql("SELECT current_catalog()").collect()[0][0]
current_schema = spark.sql("SELECT current_database()").collect()[0][0]
print({"workspace_url": workspace_url, "user": current_user, "current_catalog": current_catalog, "current_schema": current_schema})
```

For the warehouse, `SHOW WAREHOUSES` and pick the first **running** serverless warehouse — or any running warehouse if no serverless one is running.

### Step 2 — Decide which values to use vs ask about

| Value | Detection returns... | Action |
|---|---|---|
| `workspace_url` | non-empty string | Trust — confirmation only |
| `current_catalog` | `samples` / `hive_metastore` / `main` / empty | **Ask** which catalog to use |
| `current_catalog` | a user-owned catalog | Use, but **confirm** before writing |
| `current_schema` | `default` / empty | **Ask** what schema name; offer `<demo_slug>_demo` |
| `current_schema` | a user-specified schema | Confirm |
| `warehouse_id` | running warehouse found | Use; confirm |
| `warehouse_id` | none running | **Ask** which to use |

**Always confirm before writing.** Present proposed values in a table — ask "Apply these?" Don't auto-write.

### Step 3 — Ask about synth-vs-real data, then write the edit

Before writing, ask:

> "Do you want to start with **synthetic data** (recommended — runs end-to-end on Faker-generated data so you experience it immediately) or **your own customer data**?"

- If **synthetic** (default): set `run_with_synthetic_data: "yes"`.
- If **real data**: set `"no"` AND ask "Which table holds your data? `<catalog>.<schema>.<table>`." Record as TODO comment near the variables block. If unknown, set `"no"` + TODO `# TODO: real-data swap not yet wired`. Don't block on uncertainty.

**HARD SCOPE for Step 3: edit ONLY `databricks.yml`.** All other paths are forbidden per the Global HARD SCOPE above. **NEVER hardcode catalog/schema/warehouse values into Python or SQL** — those flow from `databricks.yml` variables via DAB job-task parameters. Hardcoded constants in pipeline files are a Stage 5 packaging bug — surface to the user and stop.

**Apply the edit** using your file-editing capability — don't just print a diff. Update `targets.client.variables`: `client_catalog`, `client_schema`, `warehouse_id`, `run_with_synthetic_data`.

Present as Accept/Reject so the client can decline.

### Step 4 — Deploy from the web terminal (do NOT deploy from inside Genie Code)

**Do NOT run `databricks bundle ...` from Genie Code itself.** The CLI is sandboxed inside Genie Code's `executeCode` subprocess; `runDatabricksCli` can't `cd` to the bundle root. Output deploy instructions and stop. (Confirmed 2026-05-29.)

> ✅ `databricks.yml` has been updated. To deploy, open a **Web Terminal** (Compute panel → terminal icon, or ⌘+Shift+T) and paste:
>
> ```bash
> cd ~/{{demo-slug}}-client-handoff   # adjust to your unzipped folder
> databricks bundle validate --target client
> databricks bundle deploy --target client
> databricks bundle run {{job-name}} --target client
> ```

If a command fails, help triage. Common pitfalls:
- `validate` fails with "variable not found" → handoff missed `${var.catalog}` → `${var.client_catalog}` rename. Grep `src/`, `pipeline/`, `databricks.yml` and fix.
- `deploy` fails `permission denied` on catalog → user lacks `CREATE SCHEMA`; grant or pick another catalog.
- `run` task FAILED with SDK signature error in `src/deploy/*.py` → demo-generator templated against older SDK; update API call to match current signature.

Once all three succeed, provide workspace links to the created job/pipeline/dashboard.

### Step 5 — Re-runs and idempotency

If `databricks.yml` already matches the current workspace + chosen catalog/schema, say "no edits needed, ready to redeploy" and point at the deploy command.

## Adapting table names — "use my naming convention"

SEPARATE intent from initial setup. Trigger when the user has deployed the demo and now wants their own table identifiers. Phrases that match:

- "rename tables" / "use my naming convention" / "I want my tables called X, Y, Z"; pasted mappings like `equipment_batches → my_equipment_master`; "what if my tables are called …" (confirm intent first).

Assumes Steps 1–4 ran cleanly. If not, prompt the user to run "run in my workspace" first.

### Routing rule (MUST FOLLOW)

If during ANY conversation you detect drift between code table names and the user's materialized UC tables — STOP. Do NOT edit any file. Emit the R1.5 refusal template VERBATIM (below) and wait for the user's choice. No exceptions.

### Step R1 — Parse the rename batch

Normalize to a mapping `{old_name: new_name}` from any shape (one-by-one, arrow-batch, tabular). If parsing is ambiguous, ask — don't guess.

### Step R1.5 — UC scope refusal template (EMIT VERBATIM BEFORE ANY EDIT)

**If existing materialized tables exist in `<catalog>.<schema>` under the old names, you MUST emit the text below verbatim and HALT until the user replies with (a), (b), (c), or a mixed answer. Do NOT proceed to R2.** If no tables are materialized yet (e.g., first deploy, post-reset), skip R1.5 and proceed to R2.

```
<!-- r1.5-scope-question -->
Tables already exist in <catalog>.<schema>. Renaming code makes the next
deploy create new (empty) tables under the new names. What should happen
to the old tables?

  (a) Code-only rename       — safest; old tables orphaned; drop later manually
  (b) Code + ALTER TABLE      — preserves data + history; needs MODIFY privilege
  (c) Code + post-deploy DROP — clean schema; only run after pipeline succeeds

Mixed answers are fine — e.g., "(b) for bronze_machines and transformers,
(a) for everything else". I will not edit any files until you reply.
<!-- /r1.5-scope-question -->
```

**Naming-convention sanity check:** if a rename drops a layer prefix (e.g., `bronze_machines → equipment_master`), flag it in your reply: "This rename drops the `bronze_` layer prefix — confirm intentional." Then still wait for (a)/(b)/(c).

### Step R2 — Pre-edit confirmation table (EMIT VERBATIM BEFORE ANY WRITE)

Once R1.5 is answered, emit the confirmation table below verbatim — wrapped in the marker — and ask "Apply these?" **No file edits are permitted until the user replies "yes" (or equivalent).** Downstream tests grep for the marker to verify ordering.

```
<!-- pre-edit-confirmation -->
| Layer  | Old name              | New name              | Files affected            | R1.5 strategy |
|--------|-----------------------|-----------------------|---------------------------|---------------|
| bronze | equipment_batches     | my_equipment_master   | 01_bronze.py, generate... | (b)           |
| silver | (unchanged)           | —                     | —                         | —             |
| gold   | (unchanged)           | —                     | —                         | —             |
<!-- /pre-edit-confirmation -->
```

### Step R3 — Apply renames atomically (HARD SCOPE)

**HARD SCOPE: rename ONLY bare table identifier strings.** No SQL-logic refactors, no column renames, no catalog/schema edits, no edits to anything in the Global HARD SCOPE deny-list at the top of this file (including `.assistant/**`, `HANDOFF_NOTES.md`, `specifications/**`, `raw_data/**`, dashboard prose).

Files editable in R3 (ONLY these — if you find another file mentioning table names, STOP and ask):

| File | What to change |
|---|---|
| `src/data_generation/generate_data.py` | `.saveAsTable(...)` / `CREATE TABLE` identifiers |
| `src/pipeline/01_bronze.py` | `@dlt.table` table names |
| `src/pipeline/02_silver.sql` | `FROM <bronze>` references |
| `src/pipeline/03_gold.sql` | `FROM <silver>` references |
| `src/dashboards/dashboard.lvdash.json` | Query `FROM` clauses |
| `genie_space.json` (if present) | `tables[].name` / sample SQL — NOT NL questions |

Use exact string replacement bounded to the identifier (if old name is `outages`, don't touch `outage_count`).

After writing, show a per-file diff summary.

For each mapping marked **(b)** in R1.5: emit `ALTER TABLE <catalog>.<schema>.<old> RENAME TO <new>;` (run BEFORE redeploy).
For each marked **(c)**: emit a post-deploy script `DROP TABLE IF EXISTS <catalog>.<schema>.<old>;` with a warning to run ONLY after the pipeline succeeds.

### Step R4 — Output redeploy commands

Same shape as Step 4. Output the commands and stop:

> ✅ Renamed N tables across M files. To redeploy, paste in your web terminal:
> ```bash
> databricks bundle validate --target client
> databricks bundle deploy   --target client
> databricks bundle run <job-name> --target client
> ```

For each mapping by R1.5 strategy: **(a)** append "Old tables remain — clear via SQL Editor if desired." **(b)** append "Run the `ALTER TABLE` statements from R3 BEFORE `bundle deploy`." **(c)** append "Run `bundle run` first; once it succeeds, execute the `DROP TABLE` script."

### Step R5 — What this skill won't do

Decline if asked: migrate data old→new (separate `INSERT INTO ... SELECT FROM`); refactor SQL logic beyond identifier swap; rename columns (out of v2 scope); update Knowledge Assistant PDFs.

## Common gotchas
- Segment/grouping thresholds (SQL constants in pipeline `CASE WHEN`) need a separate edit.
- Dashboard `dataset_catalog` / `dataset_schema` resolve from DAB variables — no separate edit needed.
- KA PDFs in `raw_data/pdf/` are out-of-scope; flag any swap to the demo author.
