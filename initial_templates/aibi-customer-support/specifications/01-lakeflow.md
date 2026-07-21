# Lakeflow — Data Generation + Medallion Build

## Shared Context

**Demo:** AI/BI Customer Support — a travel company's support org gets dramatically
more efficient after an AI Support Copilot (built with Agent Bricks) reaches GA on
**2025-06-02**. Every downstream consumer (dashboard, Genie) reads the gold table
`support_cases_enriched` and the governed metric view `support_metrics`.

**Target:** `{{CATALOG}}.{{SCHEMA}}` (defaults `dbdemos_templates.aibi_customer_support`).

**Build shape (no SDP pipeline).** A single self-contained Spark script
(`data_generation/generate_data.py`) generates raw data *and* builds the full
medallion in four phases: RAW → SILVER (typed + constrained) → GOLD (enriched) →
METRICS (metric view). It runs unchanged in a Databricks notebook (ambient Spark,
catalog/schema from widgets) or locally via Databricks Connect serverless
(catalog/schema from env). No parquet round-trip, no Faker, no driver loops — pure
Spark expressions plus one `pandas_udf` for the fact rows, so it runs on serverless.

**Temporal anchors (load-bearing — every consumer depends on them):**
- Data window: **2023-01-02 → 2025-12-29** (starts Monday, ends on a clean week boundary).
- **AI Copilot GA: 2025-06-02** — the single step-change the whole story turns on.
- `ai_era` (BOOLEAN) = `opened_date >= 2025-06-02` — the before/after switch used everywhere.

---

## A. Data Generation Script

### Raw tables (dimensions + AI story + fact)

**Dimensions** (curated, realistic values):

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `regions` | region | `region_id`, `region_name`, `primary_timezone` | NA / EMEA / APAC / LATAM |
| `cities` | destination city | `city_id`, `city_name`, `country_name`, `region_id`, `latitude`, `longitude` | 40 real destinations w/ real-ish lat/long, for the map |
| `products` | travel bundle | `product_id`, `product_name`, `package_tier`, `market_focus` | 25 named bundles; tiers Standard/Plus/Premium |
| `customers` | agency | `customer_id`, `customer_name`, `customer_segment`, `industry`, `contract_value_band`, `region_id` | 800 agencies; names synthesized via hashed Spark expressions |
| `calendar` | date | `date`, `year`, `quarter`, `month`, `week`, `is_us_holiday`, `holiday_name`, `is_peak_season` | US holidays via `holidays`; peak = Jun/Jul/Dec + late Nov |

**AI story tables** (the "why" Genie reads):

| Table | Grain | Purpose |
|---|---|---|
| `ai_assistant_releases` | release | The Copilot release log. v0.9-beta (2025-05-05), **v1.0 GA (2025-06-02)**, v1.1 (2025-08-18). `release_notes` explicitly names the auto-resolved categories — this is the text Genie quotes when asked *why*. |
| `ai_assistant_usage` | day | Daily `ai_queries` / `ai_deflections` / `assist_queries` / `ai_compute_cost`. Deflections are **0 before GA** and jump at 2025-06-02, then climb — derived from the fact so it stays perfectly consistent. |

**Fact:**

| Table | Grain | Key columns |
|---|---|---|
| `support_cases` | one support case | `case_id`, `opened_at`, `closed_at`, `opened_date`, `category`, `channel`, `priority`, `support_tier`, `region_id`, `customer_id`, `product_id`, `destination_city_id`, `ai_handled`, `resolution_hours`, `satisfaction_score`, `reopened_flag`, `support_cost` |

**Fact generation rules (the mechanics that make the story true):**
- **~20,000 cases**, roughly flat volume with slight growth over the window.
- **Region personalities** — each region has its own volume share, category mix,
  resolution-speed multiplier, and satisfaction offset. **APAC is the slow region**
  (`res_mult` 1.45, negative satisfaction offset), so a regional filter shows a real,
  defensible difference.
- **Categories:** How-To, Access, Billing (AI-eligible) + Outage, Bug, Performance
  (always human).
- **AI step-change:** for AI-eligible categories opened on/after GA, `ai_handled`
  becomes true with a deflection probability that **ramps from ~35% to a ~72% cap**
  over ~120 days. AI-handled cases resolve in minutes (`resolution_hours` ~0.02–3)
  at trivial cost (`support_cost` = $0.30). Human cases post-GA also get faster
  (`base * 0.55`) as agents focus on fewer, harder tickets.
- **Satisfaction:** 2–5, higher when resolved fast; ~26% null (no survey returned).
- **`reopened_flag`:** lower for AI / fast cases (~4%) than slow human cases (~13%).
- **`support_cost`:** AI cases ≈ $0.30; human cases = `resolution_hours * hourly_cost`
  (~$75/h).

### Data-shaping rules (must hold end-to-end)
- **The before/after story must be visible without a filter** — the raw aggregate
  resolution-time trend already bends down at GA.
- **`ai_assistant_usage` is derived from the fact**, never independently random — the
  deflection count on any day equals the count of `ai_handled` cases that day.
- **Every FK resolves** — `customer_id`, `product_id`, `region_id`,
  `destination_city_id` are all drawn from valid dimension ranges (city is drawn from
  the region's own city pool, so region↔city stays coherent).

---

## B. Medallion Build (folded into the same script)

### Silver — typed + constrained
Each raw DataFrame is written with `saveAsTable` (overwrite), then PK/FK
**constraints (NOT ENFORCED, RELY)** are added so Catalog Explorer draws the ER
diagram and Genie understands the joins: PKs on every dimension + fact; FKs from
`support_cases` → customers / products / regions / cities. Constraint creation is
idempotent (wrapped so a re-run doesn't fail if they already exist).

### Gold — `support_cases_enriched`
One wide `CREATE OR REPLACE TABLE ... AS SELECT` that joins the fact to every
dimension plus the day's AI usage, and derives `ai_era`. This is the single table
the dashboard row-level widgets and Genie read. Columns of note: `ai_era`,
`region_name`, `destination_city` / `_country` / `_lat` / `_lon`, `is_peak_season`,
`ai_deflections_that_day`.

### Metrics — `support_metrics` (see also `04-ai-bi.md`)
A governed metric view (`WITH METRICS LANGUAGE YAML`) over `support_cases_enriched`.
Defined here because it's part of the data layer; its measures/dimensions are the
contract the dashboard KPI tiles and Genie both consume. Full definition in
`04-ai-bi.md` §Metric View.

---

## C. Validation

After the script runs, confirm:
1. **Row counts** — ~20k `support_cases`, 8 base tables + `support_cases_enriched` + `support_metrics`.
2. **The step-change is real** — `AVG(resolution_hours)` for `ai_era=false` is ~2×
   that for `ai_era=true`; `ai_deflections` is 0 before 2025-06-02 and >0 after.
3. **Constraints present** — Catalog Explorer shows the PK/FK relationships.
4. **Metric view queryable** — `SELECT MEASURE(\`Avg Resolution Hours\`) ... GROUP BY \`AI Era\`` returns two rows with the before > after gap.
