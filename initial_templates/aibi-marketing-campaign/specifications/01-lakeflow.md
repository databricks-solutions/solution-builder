# Lakeflow — Data Generation + Medallion Build

## Shared Context

**Demo:** AI/BI Marketing Campaign — a multi-channel marketing team runs campaigns
across TikTok, Instagram, Google Ads and Email. Through mid-2025 every channel is
healthy; from **2025-09-01** revenue and conversions collapse even though spend stays
flat. Every downstream consumer (dashboard, Genie) reads the gold table
`campaign_performance_enriched` and the governed metric view `metrics_campaign`.

**Target:** `{{CATALOG}}.{{SCHEMA}}` (defaults `dbdemos_templates.aibi_marketing_campaign`).

**Build shape (no SDP pipeline).** A single self-contained Spark script
(`data_generation/generate_data.py`) generates raw data *and* builds the full
medallion in four phases: RAW → SILVER (typed + constrained) → GOLD (enriched) →
METRICS (metric view). It runs unchanged in a Databricks notebook (ambient Spark,
catalog/schema from CLI args) or locally via Databricks Connect serverless
(catalog/schema from env). No parquet round-trip, no Faker, no driver loops — pure
Spark expressions plus one `pandas_udf` for the fact rows, so it runs on serverless.

**Temporal anchors (load-bearing — every consumer depends on them):**
- Data window: **2024-01-01 → 2026-05-31**.
- **Bad-creative launch: 2025-09-01** — the single step-change the whole story turns on.
- The fact row is "post-event" iff `date >= 2025-09-01`; the collapse is scoped to
  **TikTok × {Germany, France}** via the underperforming creative.

---

## A. Data Generation Script

### Raw tables (dimensions + fact)

**Dimensions** (curated, realistic values):

| Table | Grain | Key columns | Notes |
|---|---|---|---|
| `channels` | channel | `channel_id`, `channel_name`, `channel_type` | TikTok / Instagram / Google Ads / Email |
| `campaigns` | campaign | `campaign_id`, `campaign_name`, `objective`, `start_date`, `end_date` | 11 campaigns; **Q4 Growth Push** (starts 2025-09-01) hosts the bad creative |
| `audiences` | segment | `audience_id`, `audience_name`, `age_band`, `interest` | Gen Z / Young Pros / Families / Established |
| `regions` | market | `region_id`, `country`, `country_code`, `latitude`, `longitude` | 20 countries w/ real-ish lat/long, for the map |
| `creatives` | ad creative | `creative_id`, `creative_name`, `channel`, `channel_id`, `message_theme`, `format`, `launch_date`, `target_market`, `status` | **root-cause table**: 8 healthy creatives + the flagged `Fall Sale - v2 (DE/FR)` (id 999, launched 2025-09-01, status `underperforming`) |

**Fact:**

| Table | Grain | Key columns |
|---|---|---|
| `campaign_performance` | one daily row (channel × platform × audience × market × creative) | `perf_id`, `date`, `campaign_id`, `channel_id`, `platform`, `audience_id`, `region_id`, `creative_id`, `impressions`, `clicks`, `spend`, `conversions`, `revenue` |

**Fact generation rules (the mechanics that make the story true):**
- **~60,000 rows**, spread uniformly across the 2024-01-01 → 2026-05-31 window.
- **Channel mix** — TikTok is the biggest channel (`chan_w` 0.42), the one the team
  leans on for growth. Social channels skew Mobile; Search/Owned skew Web.
- **Market weights** — Germany & France are top markets (alongside the US), so the
  collapse there is material to the global aggregate.
- **Healthy economics** — per-channel CPC and base conversion rate land every channel
  in a comparable ~3–5 revenue/spend band; AOV ~ N(80, 15).
- **The event:** for TikTok rows in Germany/France opened on/after 2025-09-01, the
  creative FK is swapped to the bad `Fall Sale - v2 (DE/FR)` (id 999), the campaign to
  `Q4 Growth Push` (id 8), and the conversion rate is multiplied by **0.12** (craters
  to ~0.35% vs ~3%). Spend is untouched — it keeps flowing at the same clicks × CPC —
  so **revenue and conversions collapse while spend stays flat**.

### Data-shaping rules (must hold end-to-end)
- **The before/after story must be visible without a filter** — the raw monthly
  revenue-per-dollar trend already bends down after 2025-09-01.
- **Every FK resolves** — `campaign_id`, `channel_id`, `audience_id`, `region_id`,
  `creative_id` are all drawn from valid dimension ranges (or set to the bad creative's
  own valid ids during the event).
- **The WHY is only in the dimension** — the fact carries `creative_id`; the human-
  readable `creative_name` / `creative_status` live in `creatives`, so the drill-down
  requires the join (which the gold table pre-computes).

---

## B. Medallion Build (folded into the same script)

### Silver — typed + constrained
Each raw DataFrame is written with `saveAsTable` (overwrite). **All dimension ids and
every fact key are cast to BIGINT** so FK child/parent types match exactly (Delta does
not support in-place INT→BIGINT ALTER, so the cast happens in the DataFrame select).
Then PK/FK **constraints (NOT ENFORCED, RELY)** are added so Catalog Explorer draws the
ER diagram and Genie understands the joins: PKs on every dimension + the fact; FKs from
`campaign_performance` → channels / campaigns / audiences / regions / creatives. A PK
column must be NOT NULL first, so the statements run in order: set key columns NOT NULL,
add PRIMARY KEYs, then add FOREIGN KEYs. Constraint creation is idempotent (each wrapped
so a re-run doesn't fail if it already exists).

### Gold — `campaign_performance_enriched`
One wide `CREATE OR REPLACE TABLE ... AS SELECT` that joins the fact to every dimension.
This is the single table the dashboard row-level widgets and Genie read. Columns of
note: `channel_name`, `campaign_name`, `country` / `latitude` / `longitude`,
`creative_name`, `creative_status`, `target_market`, plus the raw measures.

### Metrics — `metrics_campaign` (see also `04-ai-bi.md`)
A governed metric view (`WITH METRICS LANGUAGE YAML`) over `campaign_performance_enriched`.
Defined here because it's part of the data layer; its measures/dimensions are the
contract the dashboard KPI tiles and Genie both consume. Full definition in
`04-ai-bi.md` §Metric View.

---

## C. Validation

After the script runs, confirm:
1. **Row counts** — ~60k `campaign_performance`, 6 base tables +
   `campaign_performance_enriched` + `metrics_campaign`.
2. **The step-change is real** — revenue-per-dollar for TikTok × {Germany, France}
   after 2025-09-01 is far below the same slice before it, while spend is roughly flat;
   `Q4 Growth Push` has the lowest revenue-per-dollar of any campaign since Sept 2025.
3. **Constraints present** — Catalog Explorer shows the PK/FK relationships.
4. **Metric view queryable** — `SELECT MEASURE(\`Revenue per Dollar\`) ... GROUP BY \`Campaign\``
   returns the failing campaign at the bottom.
