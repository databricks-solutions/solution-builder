# Pipeline Creation

> **Before starting**: Check relevant skill (`databricks-spark-declarative-pipelines` should be present if ai-dev-kit is installed).

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

**Approach**:
1. Write the pipeline SQL file locally
2. Upload it to the Databricks workspace
3. Create the pipeline pointing to the uploaded SQL file
4. Run the pipeline to populate the tables

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `luxebeauty_operations` |
| **Catalog** | As defined in 00-demo-overview.md |
| **Target Schema** | As defined in 00-demo-overview.md |
| **Source Volume** | As defined in 00-demo-overview.md |

---

## Workspace Folder Structure

Create this folder structure in the workspace folder (path defined in 00-demo-overview.md):

```
{workspace_folder}/
├── transformations/
│   ├── 01_bronze_ingestion.sql       # Bronze layer: raw parquet ingestion
│   ├── 02_silver_transformation.sql  # Silver layer: joins and enrichment
│   └── 03_gold_aggregation.sql       # Gold layer: aggregations for analytics
└── exploration/
    └── exploration_notebook.py       # Notebook to verify raw data
```

---

## Exploration Notebook (exploration_notebook.py)

Before running the pipeline, create a simple exploration notebook to verify the raw parquet data loaded correctly. The notebook would be used by a human to review the raw data and understand its structure:

1. List the folder in SQL with `LIST '{volume_path}'`
2. Preview each parquet file (customers, products, orders, etc.) with a SELECT `parquet`.`{volume_path}/{folder}`
3. A small SQL query doing a join/aggregation to check the returns - just exploratory EDA with a small comment.

---

## Pipeline Tables

The pipeline should create tables in a medallion architecture (Bronze → Silver → Gold), with each layer in its own transformation file.

### Bronze Layer (01_bronze_ingestion.sql)

Ingest the parquet files as streaming tables:

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_customers | customers.parquet | Raw customer records |
| bronze_products | products.parquet | Raw product catalog |
| bronze_production_lots | production_lots.parquet | Raw lot records |
| bronze_orders | orders.parquet | Raw order headers |
| bronze_order_items | order_items.parquet | Raw line items |
| bronze_returns | returns.parquet | Raw return records |

### Silver Layer (02_silver_transformation.sql)

Create materialized views that join and enrich the data:

| Table | What It Contains | Why It Matters for Demo |
|-------|------------------|-------------------------|
| silver_orders | Orders joined with customer info (region, loyalty tier) | Enables regional analysis |
| silver_order_items | Order items joined with product info and lot info | Links items to lots and products - key for traceability |
| silver_returns | Returns joined with order item, product, and lot context | Enables "which lot caused these returns" analysis |

**Key relationships**:
- silver_order_items should include: order_id, order_date, customer region, product_id, product_name, category, lot_id, production_date, facility
- silver_returns should include: return_id, order_item_id, product info, lot_id, return_date, refund_amount, return_reason, return_reason_text, days_to_return

### Gold Layer (03_gold_aggregation.sql)

Create aggregated tables for dashboard and Genie.

**IMPORTANT**: Gold tables should stay at **daily granularity**. Do NOT pre-aggregate to weekly - let the dashboard queries handle any weekly aggregation needed. This keeps the data flexible and ensures spikes are clearly visible at the day level.

**Important**: Include region and category in all gold tables - dashboard filters require these dimensions.

| Table | Dimensions | Metrics | Why It Matters for Demo |
|-------|------------|---------|-------------------------|
| gold_daily_summary | date, **region**, **category** | orders, items, revenue, returns, return_rate | KPIs and returns trend - needs filtering by region/category |
| gold_daily_orders | date, **region**, **category** | order_count, items_sold, revenue, profit | Revenue charts - already has region/category |
| gold_returns_by_lot | lot_id, product, **region**, **category**, facility | return_count, refund_usd, avg_days_to_return | Products table - needs region/category for filtering |

**Key columns for gold_returns_by_lot**:
- lot_id, production_date, product_id, product_name, category, **region**
- return_count, total_refund_usd, avg_days_to_return
- customer_feedback_samples (collect the return_reason_text values)

---

## Resource Tracking

After creating the pipeline, **add the pipeline ID to `resources.json`**:
```json
{
  "pipeline_id": "<the-pipeline-id>"
}
```

