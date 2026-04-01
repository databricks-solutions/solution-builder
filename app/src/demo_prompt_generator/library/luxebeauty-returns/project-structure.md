# Project Structure

Create the following directory layout locally. Every file listed below must be created with the specified content. After local creation, upload data to Databricks volumes and code to the workspace folder.

## Local Development Layout

```
luxebeauty_demo/
├── data_generation/
│   └── generate_data.py              # Synthetic parquet files (Faker + Pandas/Polars)
├── documents/
│   └── generate_incident_pdf.py      # Incident report PDFs (FPDF or similar)
├── pipeline/
│   ├── transformations/
│   │   ├── 01_bronze_ingestion.py    # Bronze: raw parquet → streaming tables
│   │   ├── 02_silver_transformation.py  # Silver: joins and enrichment
│   │   └── 03_gold_aggregation.py    # Gold: aggregations for analytics
│   └── exploration/
│       └── exploration_notebook.py   # Verify raw data after upload
└── instructions/                     # These instruction files (reference only)
```

## Databricks Resources

| Resource | Name | Purpose |
|----------|------|---------|
| Catalog | `luxebeauty` | Unity Catalog namespace |
| Schema | `analytics` | All tables and views |
| Volume (raw data) | `/Volumes/luxebeauty/analytics/raw_data/` | Parquet files for pipeline |
| Volume (documents) | `/Volumes/luxebeauty/analytics/raw_data/incident_pdf/` | Incident report PDFs |
| Workspace Folder | `/Workspace/Users/{user}/ai_demos/luxebeauty_demo/` | Pipeline code |
| Pipeline | `luxebeauty_operations` | Spark Declarative Pipeline |
| Dashboard | `LuxeBeauty Weekly Operations` | AI/BI Dashboard |
| Genie Space | `LuxeBeauty Operations Analytics` | Natural language data queries |
| Knowledge Assistant | `LuxeBeauty Incidents` | Incident report retrieval |
| Multi-Agent Supervisor | `LuxeBeauty Operations Assistant` | Orchestrates Genie + KA |

## Pre-flight Checklist

Before starting, verify:

- [ ] Python 3.12 available (required for Databricks Connect). If not: `uv venv --python 3.12`
- [ ] Databricks CLI authenticated to target workspace
- [ ] Catalog `luxebeauty` exists (create if needed)
- [ ] Schema `analytics` exists (create if needed)
- [ ] Volume `raw_data` exists (create if needed)
- [ ] Workspace folder exists
- [ ] If any resources already contain data, confirm whether to overwrite or use a different name

## Build Order

| Step | Task | Details | Validate |
|------|------|---------|----------|
| 1 | **Create catalog and schema** | `luxebeauty.analytics` | `SHOW SCHEMAS IN luxebeauty` |
| 2 | **Create volume** | `raw_data` in `luxebeauty.analytics` | `LIST '/Volumes/luxebeauty/analytics/raw_data/'` |
| 3 | **Generate synthetic data** | Run `generate_data.py` → upload 6 parquet files to volume | Verify row counts match data-schema.md |
| 4 | **Generate incident PDFs** | Run `generate_incident_pdf.py` → upload ~10 PDFs to `incident_pdf/` | Verify files exist in volume |
| 5 | **Upload pipeline code** | Upload transformations/ to workspace folder | Verify files in workspace |
| 6 | **Create & run SDP pipeline** | Create `luxebeauty_operations` pipeline, run it | Verify all bronze/silver/gold tables created |
| 7 | **Validate pipeline data** | Run validation queries from data-schema.md | All checks pass (see Validation section) |
| 8 | **Create Genie Space** | Configure with tables and instructions from architecture.md | Ask "Why do I have so many returns?" |
| 9 | **Create AI/BI Dashboard** | Build layout from architecture.md, embed Genie | 5-second test: spike is obvious |
| 10 | **Create Knowledge Assistant** | Index incident PDFs, add instructions | Ask "Incident for lot LOT-2025-0212?" |
| 11 | **Create Multi-Agent Supervisor** | Connect Genie + KA as agents, add routing | Test both demo questions through MAS |

## Deployment Notes

- All code runs locally first, then uploads to Databricks
- Use Databricks Connect for data generation scripts (remote execution via Spark)
- Install Faker in the serverless environment at the start of the script
- Dashboard uses fixed dates (Feb–Mar 2025), not `CURRENT_DATE()`, so the spike is always visible
- Pipeline is idempotent — can be re-run without cleanup (use full refresh if re-running)
- Create Databricks resources via APIs, not DAB (for this demo)

## Skill References

When building each component, load the relevant skill for current best practices:

| Component | Skill |
|-----------|-------|
| Synthetic data | `databricks-synthetic-data-gen` or `databricks-data-generation` |
| Incident PDFs | `databricks-unstructured-pdf-generation` |
| SDP Pipeline | `databricks-spark-declarative-pipelines` |
| AI/BI Dashboard | `databricks-aibi-dashboards` |
| Genie Space | `databricks-genie` |
| Knowledge Assistant | `databricks-agent-bricks` |
| Multi-Agent Supervisor | `databricks-agent-bricks` |
