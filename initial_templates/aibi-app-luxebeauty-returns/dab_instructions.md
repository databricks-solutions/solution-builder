# Deploying the LuxeBeauty Returns demo (DAB)

Everything is parameterized in `databricks.yml`: `catalog`, `schema`, `warehouse_id`, `workspace_folder`,
`genie_title` (the name the setup job looks the Genie Agent up by — must be unique in the workspace),
`app_name`, `lakebase_project_slug` / `lakebase_branch_id` / `lakebase_database_name` / `lakebase_database_id` /
`lakebase_owner_role`.

Targets:
- `dev` (default) / `prod` — NO pinned host: deploy to whatever workspace your CLI profile points at (forks, "Download DAB"). Pass `--var warehouse_id=<id>` plus `catalog` / `schema` / `lakebase_project_slug` / `lakebase_owner_role` (a Postgres role on your branch) / `genie_title` / `app_name` as needed. `prod` fails validation (pipeline `development: true` under `mode: production`) — pre-existing, unused.

```bash
databricks bundle deploy -p <profile> --var warehouse_id=<id> [--var catalog=<catalog> --var schema=<schema> --var lakebase_project_slug=<project> --var lakebase_owner_role=<role-id>]
databricks bundle run luxebeauty_setup -p <profile> [same --var's]
databricks bundle run luxebeauty_demo -p <profile> [same --var's]
```
Re-running the same commands is the upgrade path (idempotent).

## What gets built (nothing by hand, no ID copied by hand)

`bundle deploy` creates the schema, the `raw_data` + `manufacturing_reports` volumes, the SDP pipeline, the AI/BI dashboard
(embedded credentials, in the workspace folder), the Lakebase database, the agent-traces MLflow experiment, the app (stopped) and
the setup job. `bundle run luxebeauty_setup` (a few minutes on first run — the Genie documents index is ~6 min for 13 PDFs; faster on an upgrade run):

1. `generate_data` — raw parquet → `raw_data` volume. **Story time is pinned** (`pin_time=1` ≡ `LUXE_PIN_TIME=1`, NOW =
   2026-07-13): the bad lot is always **LOT-2026-0531** (Lyon, homogenizer HMG-03), which is exactly what the hand-authored
   incident PDF (`src/documents/pdf/pir_lot_2026_0531_homogenizer_lyon.pdf`), the Genie instructions and the dashboard text cite.
   Data, docs and dashboard therefore always agree, and every upgrade regenerates the same dataset. Every relative window
   (gold 90-day anger, tenure, days-since-last-order, dashboard 180-day forecast window, app 30-day trend, Genie "this month")
   is anchored on the data's as-of date (day after the latest return), never on the wall clock, so the demo never goes blank.
2. `run_pipeline` (full refresh) — SDP silver (ai_classify anger score) + gold.
3. `deploy_metric_view` (`mv_returns`) and `train_score_ml` (XGBoost premium classifier → UC `customer_premium_classifier@prod`
   + `gold_customer_premium_predictions`; training experiment in the workspace folder).
4. `upload_pdfs` → `deploy_genie` (Genie Agent in the workspace folder over the tables + the 13 PDFs in the `manufacturing_reports`
   volume; waits for the volume index to be SUCCEEDED).
5. `grant_app_uc` — app SP: USE CATALOG / USE SCHEMA + SELECT / READ VOLUME / EXECUTE on the model, CAN_RUN on the Genie Agent.
6. `export_resources` — writes every id to `<catalog>.<schema>.demo_resources`; the app reads the Genie id, its own URL
   and the Lakebase project uid from it at boot (`app/server/lib/demo-resources.ts`).

`bundle run luxebeauty_demo` deploys the app source and starts it. On first boot it runs the Drizzle migrations and mirrors the
returns queue from Delta into Lakebase.

## Notes
- The Genie Agent is looked up by name (`genie_title`), so re-running the job updates it in place.
- Dashboard datasets are schema-less; `dataset_catalog` / `dataset_schema` rebind them per target.
- Redeploying against an existing Lakebase database is safe: `app/drizzle/` is regenerated on build with a pinned baseline
  (`scripts/db-generate.js`, tag `0000_init`), so the migration identity never changes for an unchanged schema.
- After a setup-job re-run the Lakebase mirror is NOT re-synced automatically (sync skips when the tables have rows) — call
  `POST /api/admin/reset` (or the app's Reset button) to wipe the queue/conversations and re-mirror from Delta.
- Each job run registers a new model version and moves `@prod`.
- Document PDFs are pre-rendered (`python src/documents/html_to_pdf.py`, needs plutoprint) and shipped via `sync.include`; re-render
  only if you edit `src/documents/html/`.
