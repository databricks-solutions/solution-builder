# Lakeflow — Data Generation + Medallion Build

## Shared Context

**Demo:** AI/BI Sales Pipeline Review — a global beauty brand tracks sales against a
company-wide quarterly revenue target. The story turns on the new **Fragrance** line
launching in **EMEA on 2026-05-04**, which drives an EMEA sales spike that pushes the
quarter forecast above target. Every downstream consumer (dashboard, Genie) reads the
gold table `orders_enriched` and the governed metric view `metrics_sales`.

**Target:** `{{CATALOG}}.{{SCHEMA}}` (defaults `dbdemos_templates.aibi_sales_pipeline`).

**Build shape (no SDP pipeline).** A single self-contained Spark script
(`data_generation/generate_data.py`) generates raw data *and* builds the full
medallion in four phases: RAW → SILVER (typed + constrained) → GOLD (enriched) →
METRICS (metric view). It runs unchanged in a Databricks notebook (ambient Spark,
catalog/schema from args) or locally via Databricks Connect serverless
(catalog/schema from args or env). No parquet round-trip, no bronze bootstrap, no
driver loops — pure Spark expressions plus `pandas_udf`s for the account / order /
opportunity rows, so it runs on serverless.

**Temporal anchors (load-bearing — every consumer depends on them):**
- Data window: **2024-12-01 → 2026-06-08** (ends mid-quarter, leaving runway to forecast).
- **Fiscal quarter Q2 2026: 2026-04-01 → 2026-06-30** — the quarter we're reviewing.
- **EMEA Fragrance launch: 2026-05-04** — the single step-change the whole story turns on.
- Q2 target ~**$21.5M** (Finance, set conservatively); projected quarter-end ~**$33M** (~155%).

---

## A. Data Generation Script

### Raw tables (CRM + ERP + Finance + PIM)

**Dimensions / reference (curated, realistic values):**

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `products` (PIM) | product line | `product_line`, `category` | Skincare, Makeup, Fragrance, Haircare |
| `product_launches` (PIM) | launch | `launch_id`, `product_line`, `region`, `launch_date`, `launch_name`, `description` | **The root-cause table.** Core lines Global 2024-01-01; Fragrance launches AMER 2024-06, APAC 2024-09, **EMEA 2026-05-04**, LATAM 2026-06-15. |
| `sales_targets` (Finance) | quarter | `quarter_start`, `target_revenue` | Company-wide quarterly targets. Q2-2026 = **$21.5M** (being beaten). |
| `crm_reps` (Salesforce) | rep | `owner_id`, `rep_name`, `region`, `title` | 10 reps across the four regions. |
| `crm_accounts` (Salesforce) | account | `account_id`, `account_name`, `segment`, `region`, `country`, `country_code`, `latitude`, `longitude`, `owner_id` | 150 retailers w/ real-ish lat/long (for the map); segments Department Store / Specialty Retail / Pharmacy / E-commerce. |
| `crm_opportunities` (Salesforce) | opportunity | `opp_id`, `account_id`, `product_line`, `stage`, `expected_revenue`, `created_date`, `close_date` | 1,200 open-pipeline / expansion deals for coverage. |

**Fact:**

| Table | Grain | Key columns |
|---|---|---|
| `erp_orders` (ERP) | one order | `order_id`, `order_date`, `account_id`, `product_line`, `region`, `units`, `revenue` |

**Fact generation rules (the mechanics that make the story true):**
- **~180,000 orders**, daily small-ticket, across the four regions (EMEA/AMER larger).
- **Region volume mix** — EMEA 0.32, AMER 0.34, APAC 0.20, LATAM 0.14.
- **Product lines:** Skincare, Makeup, Fragrance, Haircare, with per-line average prices.
- **The event (EMEA Fragrance launch):** before `LAUNCH_DATE`, EMEA Fragrance orders
  are largely suppressed (reassigned to Skincare). On/after 2026-05-04, EMEA Fragrance
  order sizes get a growing **adoption ramp (up to ~5×)** over ~45 days — the spike.
- **Revenue** = units × per-line price × jitter.

### Data-shaping rules (must hold end-to-end)
- **The surge must be visible without a filter** — EMEA total revenue bends up after
  the launch; the quarter forecast beats target.
- **EMEA↔Fragrance↔date must be coherent** — the launch date in `product_launches`
  matches the date the fact ramps.
- **Every FK resolves** — `account_id`, `owner_id`, `product_line` are drawn from valid
  dimension ranges (account is drawn from the region's own account pool, so region↔account
  stays coherent).

---

## B. Medallion Build (folded into the same script)

### Silver — typed + constrained
Each raw DataFrame is written with `saveAsTable` (overwrite) with the correct types
(all keys cast to `bigint` at build time so FK child/parent types match — no in-place
`INT→BIGINT ALTER`), then PK/FK **constraints (NOT ENFORCED, RELY)** are added so
Catalog Explorer draws the ER diagram and Genie understands the joins. Constraints run
as a plain, readable list of full SQL — **NOT NULL** on key columns first, then
**PRIMARY KEY**s, then **FOREIGN KEY**s (after all referenced PKs exist), each wrapped
`try/except` so a re-run is idempotent:
- PKs: `products(product_line)`, `product_launches(launch_id)`, `sales_targets(quarter_start)`,
  `crm_reps(owner_id)`, `crm_accounts(account_id)`, `crm_opportunities(opp_id)`, `erp_orders(order_id)`.
- FKs: `crm_accounts → crm_reps`, `crm_opportunities → crm_accounts`,
  `erp_orders → crm_accounts`, `erp_orders → products`.

### Gold — `orders_enriched`
One wide `CREATE OR REPLACE TABLE ... AS SELECT` that joins the ERP fact to the account
(region, segment, geo, owner), the rep, and the product category. This is the single
table the dashboard row-level widgets and Genie read. Columns of note: `region`,
`product_line`, `category`, `segment`, `account_name`, `country` / `country_code` /
`latitude` / `longitude`, `rep_name`.

### Metrics — `metrics_sales` (see also `04-ai-bi.md`)
A governed metric view (`WITH METRICS LANGUAGE YAML`) over `orders_enriched`. Defined
here because it's part of the data layer; its measures/dimensions are the contract the
dashboard KPI tiles and Genie both consume. Full definition in `04-ai-bi.md` §Metric View.

---

## C. Validation

After the script runs, confirm:
1. **Row counts** — ~180k `erp_orders`, 7 base tables + `orders_enriched` + `metrics_sales`.
2. **The story is real** — Q2-2026 QTD revenue vs the $21.5M target trends to a beat;
   EMEA Fragrance revenue is near-zero before 2026-05-04 and ramps sharply after.
3. **Constraints present** — Catalog Explorer shows the PK/FK relationships.
4. **Metric view queryable** — `SELECT MEASURE(\`Revenue\`) ... GROUP BY \`Region\`, \`Product Line\``
   returns the EMEA Fragrance surge.
5. **AI forecast** — the `AI_FORECAST`-based `ds_target` / `ds_forecast` dashboard queries
   run on a **SQL warehouse** (not serverless-connect) and project quarter-end above target.
