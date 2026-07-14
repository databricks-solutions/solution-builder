# LuxeBeauty Workshop — build the demo live with Genie Code

> **What this is.** A **hands-on workshop** variant of the LuxeBeauty returns
> demo. Instead of shipping pre-built resources, it ships a set of **clean
> Databricks notebooks** whose cells are **prompts the SA pastes into the
> Databricks Assistant (Genie Code)** to build the demo live, one step at a
> time: raw data (in a Volume) → SDP silver/gold → AI/BI dashboard → Genie space.
> The full pre-built demo lives at `../example-luxebeauty/`.

## The story

Same universe as `../example-luxebeauty-simple/`: LuxeBeauty Co., VP Ops Claire
Dubois sees weekly refunds spike **3x to ~$180K** three weeks ago. Cause: three
Skincare SKUs on **one production lot** at Lyon, released despite a QC note about
a homogenizer pressure issue. The demo proves: **spot the spike on a dashboard →
ask Genie "why?" → Genie walks the data to the lot and quotes the incident note.**

## How the workshop runs

The SA opens the notebooks in order and, for each step, pastes the given prompt
into the Assistant (✨). The Assistant reads `CONTEXT.md` (the ground truth) and
writes the SQL/Python; the SA reviews + runs it.

| Notebook | What the SA builds (via Genie Code) |
|---|---|
| `notebooks/00_setup_and_explore.py` | prime the Assistant, generate raw data → Volume, explore it (Notebooks & EDA) |
| `notebooks/01_build_pipeline.py` | the SDP: silver (incl. `ai_classify` anger + AI functions + `silver_production_lots`) → gold, one table at a time |
| `notebooks/02_dashboard_and_genie.py` | the AI/BI dashboard + the Genie space that cracks the case |
| `notebooks/03_governance.py` | metric view (`mv_returns`) + ABAC tag-driven policies + data classification |
| `notebooks/04_ml.py` | the hidden-premium classifier: feature table → train (XGBoost/Optuna/MLflow) → batch-score |

Notebooks 00–02 are the core demo; 03–04 layer on governance + ML — the same
build-it-live-with-Genie-Code pattern. Run only the notebooks whose capabilities
the demo needs.

## What's in this package

```
CONTEXT.md                     # the primer the Assistant reads (story + exact table/column contracts)
resources.json                 # capabilities (SDP + Dashboard + Genie)
notebooks/                     # the 3 workshop notebooks (Databricks notebook-source .py)
data_generation/generate_data.py   # writes 6 raw parquet datasets → UC Volume /raw_data/
pipeline/{02_silver,03_gold}.sql    # the ANSWER KEY the SA converges on (reference, not run directly)
specifications/{01-lakeflow,04-ai-bi}.md   # the specs = the Assistant's context
```

## Key design points

- **Raw lands as parquet FILES in a UC Volume** (`/Volumes/{cat}/{schema}/raw_data/`)
  — the bronze landing zone. Silver reads it via `read_files()`; **no bronze
  pass-through** (keep it simple).
- **`silver_production_lots`** exposes the lot master (incl. `incident_summary`)
  as a governed table so Genie can hop to it — the drill-down destination.
- **The SA builds everything live** — the answer-key SQL is there to converge on,
  not to run blindly.
