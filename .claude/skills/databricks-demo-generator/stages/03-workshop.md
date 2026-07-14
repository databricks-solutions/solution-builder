# Stage 03′ — Build a Workshop (Genie Code)

Run this **instead of `03-build.md`** when the project is in **workshop mode**
(the home page's "Prepare a workshop" tab; the opening prompt says so). You do
NOT provision Databricks resources. You produce a **downloadable package of
clean Databricks notebooks** whose cells are Genie Code prompts the SA pastes
into the Databricks Assistant to build the demo **live, one step at a time**.

All files go in the project folder.

## The reference to pattern-match

`references/example-luxebeauty-workshop/` is the worked example — read it first.
Mirror its shape, adapting the story/data/columns to THIS project's specs:

```
notebooks/00_setup_and_explore.py    # prime the Assistant, run data-gen → Volume, explore
notebooks/01_build_pipeline.py       # silver → gold, one table at a time (Genie Code prompts)
notebooks/02_dashboard_and_genie.py  # the dashboard + Genie space (Genie Code prompts)
data_generation/generate_data.py     # writes raw_* parquet → UC Volume /raw_data/<dataset>/
pipeline/{02_silver,03_gold}.sql     # the ANSWER KEY the SA converges on (reference, not run)
CONTEXT.md                           # the primer the notebooks' first cell points the Assistant at
```

(`README.md` + `resources.json` + `specifications/` you already wrote in stages 1–2.)

## Behavior rules

- **Notebooks are Databricks notebook-source `.py`** — `# Databricks notebook source`
  header, `# COMMAND ----------` cell separators, `# MAGIC %md` markdown cells.
  They import into a workspace and render with the Assistant panel on the right.
- **The cells are PROMPTS, not code.** Each build step is a `%md` cell telling the
  SA what to paste into the Assistant (✨). The Assistant reads `CONTEXT.md` and
  writes the SQL/Python; the SA reviews + runs it. Keep prompts one-step-at-a-time.
- **Raw data lands as parquet FILES in a UC Volume** (`/Volumes/{cat}/{schema}/raw_data/<dataset>/`)
  — the bronze landing zone. Silver reads it via `read_files()`; **no bronze
  pass-through**. The data-gen script writes ONLY the raw datasets (it does NOT
  build silver/gold — the SA builds those live).
- **CONTEXT.md is the Assistant's ground truth** — the story, the exact table +
  column contracts, the medallion targets, the Genie config. The first notebook
  cell points the Assistant at it + the specs.
- **The answer-key SQL** (`pipeline/*.sql`) is what the SA converges on — clean,
  commented, correct. It is reference, not run by the deliverable.
- **No resource provisioning, no DAB.** The deliverable is the downloadable
  package. Leave `resources.json.created_resources` with `<built-live-in-the-workshop>`
  placeholders (see the reference's resources.json).

## The recipe

1. **Read the reference** (`references/example-luxebeauty-workshop/`) end to end —
   notebooks, CONTEXT.md, the answer-key SQL, the data-gen. That's the template.
2. **Adapt `data_generation/generate_data.py`** to this project's data spec
   (`specifications/01-lakeflow.md`): same volume-writing shape (`_save` → parquet
   to `/Volumes/{cat}/{schema}/raw_data/<dataset>/`, `CREATE VOLUME IF NOT EXISTS`),
   this demo's tables/columns/story.
3. **Write the answer-key `pipeline/02_silver.sql` + `03_gold.sql`** — silver reads
   the raw files via `read_files()`, gold reads silver. Only the gold tables the
   dashboard + Genie actually read.
4. **Write `CONTEXT.md`** — the story + the exact table/column contracts + the
   medallion targets + the Genie attach list, instruction text, and sample
   questions. This is the single most important file for making Genie Code effective.
5. **Write the three notebooks** — prompts that walk the SA from setup → explore →
   silver/gold (one table at a time) → dashboard + Genie. Reference `CONTEXT.md`
   and the specs in the prompts; name the real tables/columns.
6. **Tell the user** the package is ready to download (the notebooks + data-gen +
   context + answer-key SQL), and how the workshop runs (open notebook 0, paste
   prompts into the Assistant).

## Coherence checks

- Every table/column a notebook prompt names exists in the data-gen output or the
  answer-key SQL.
- The volume subdir names in the data-gen `_save` mapping match the `read_files()`
  paths in `02_silver.sql` (strip the `raw_` prefix: `raw_returns` → `returns`).
- The Genie punchline works: the lot's `incident_summary` is reachable as a
  queryable table (expose `silver_production_lots` if raw is volume-only).
- The story holds end-to-end (spike in the past, affected lot dominates, incident
  note on the lot) — same bar as a normal build.
