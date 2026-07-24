# LuxeBeauty Workshop — test / dogfood folder

Runnable copy of the **`example-luxebeauty-workshop`** reference (in the
solution-builder skill), used to dogfood the workshop end-to-end against a live
workspace — the same pattern as `app_template_test/` for the standard demo.

## What the workshop is

A set of clean Databricks notebooks whose cells are **prompts the SA pastes into
the Databricks Assistant (Genie Code)** to build the demo live, one step at a
time: raw data (in a Volume) → SDP silver/gold → dashboard → Genie space. The
answer-key SQL (`src/pipeline/*.sql`) is what the SA converges on.

## Layout

```
src/                 # copied from the reference (keep in sync)
  notebooks/         # the 3 workshop notebooks
  data_generation/   # generate_data.py — raw parquet → UC Volume
  pipeline/          # 02_silver.sql + 03_gold.sql (answer key)
  specifications/    # 01-lakeflow.md + 04-ai-bi.md (the Assistant's context)
  CONTEXT.md         # the primer the Assistant reads
  resources.json
deploy.sh            # data-gen → Volume + upload notebooks to the workspace
```

## Deploy

```bash
./deploy.sh                                   # WEST, retail_consumer_goods.luxebeauty_workshop
PROFILE=… CATALOG=… SCHEMA=… ./deploy.sh       # override target
```

`deploy.sh` only (1) generates raw parquet into the `raw_data` Volume and
(2) uploads the notebooks — the pipeline, dashboard, and Genie are built LIVE by
the SA via the notebooks' Genie Code prompts (that's the workshop).

## Sync back to the reference

Edit + verify here, then copy `src/` changes back to
`.claude/skills/databricks-solution-builder/references/example-luxebeauty-workshop/`.
