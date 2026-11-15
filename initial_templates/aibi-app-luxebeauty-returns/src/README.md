# Source files — every Databricks component for the LuxeBeauty test demo

Every Databricks asset deployed for this demo has its source under `src/`. If
the workspace is wiped, the demo can be re-created end-to-end from these files
+ `resources.json` (at the project root, which holds the deployed IDs).

| Folder | Component | File(s) | Recreate with |
|---|---|---|---|
| `data_generation/` | Synthetic data generation | `generate_data.py` | `python generate_data.py` — writes raw bronze tables |
| `pipeline/` | SDP (Spark Declarative Pipelines) | `01_bronze.sql`, `02_silver.sql`, `03_gold.sql` | `databricks pipelines create` with these as the libraries |
| `metric_view/` | Unity Catalog metric view | `mv_returns.yaml` | `databricks tables create` (metric_view type) — points at `gold_daily_summary` |
| `ml/` | ML training + scoring | `premium_train_score.py` | Run as a Databricks job; registers the model in UC |
| `genie/` | Genie Agent (tables + documents volume) | `genie_space.json` | Deployed by `deploy/deploy_genie.py` (create/update space, then waits for the volume index) |
| `dashboard/` | AI/BI Dashboard | `dashboard.json` | `databricks lakeview create` + `publish` |
| `documents/` | Document PDFs for the Genie Agent | `html/*.html` → `pdf/*.pdf` | `python src/documents/html_to_pdf.py` (local render), then `upload_pdfs` copies them to `documents_volume` (path in `resources.json`) |
| `../app/` | Databricks App (the chat UI) | full Node.js project | `databricks bundle deploy` after configuring `databricks.prod.yml` |
| `../app/drizzle/` | Lakebase schema | `0000_initial_schema.sql` | Auto-applied by the app's startup migration (Drizzle) |

The deployed IDs (pipeline_id, dashboard_id, genie_space_id, etc.) live in
`../resources.json` at the project root, alongside the catalog/schema/warehouse
references.
