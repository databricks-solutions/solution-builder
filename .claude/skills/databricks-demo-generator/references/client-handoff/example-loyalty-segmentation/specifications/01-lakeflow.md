# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Loyalty tiers** (deterministic):

| tier | share of base | order frequency vs base | AOV vs base |
|------|---------------|-------------------------|-------------|
| Bronze | 60% | 1.0× | 1.0× |
| Silver | 30% | 1.6× | 1.3× |
| Gold | 10% | 3.2× | 1.8× |

**Behavioral segments** (computed in Gold — these are the demo's punchline):

| segment | rule | size | revenue share | last campaign redemption |
|---------|------|------|---------------|--------------------------|
| **Champions** | recency ≤ 14d AND frequency_12m ≥ 12 | ~80K (10%) | ~38% | ~4.2% |
| **New Loyalists** | tenure < 180d AND frequency_12m BETWEEN 3 AND 5 | ~200K (25%) | ~18% | ~2.1% |
| **Cooling Off** | recency BETWEEN 30 AND 90 AND frequency_qoq_delta < 0 | ~280K (35%) | ~28% | ~1.1% |
| **Win-Back** | recency > 90 | ~240K (30%) | ~16% | ~0.4% |

**Q1 campaign (the post-mortem)**: a single mass-blast 15% off coupon sent to all ~750K active members. Total margin given: ~$4.2M. Total revenue lift on paper: ~$6.1M. Holdout-adjusted incremental: ~$1.8M (43% true ROI). Champions redemption was the highest (4.2%); they'd have bought anyway — that's where the margin leaked.

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 18 months, Q1_CAMPAIGN_DATE = NOW - 90 days.

> Numbers above are narrative targets. Generated data should land approximately in these ranges — exact equality is not required. Keep math simple and prefer the story over decimal precision.

---

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**.

## A. Synthetic Data Generation

**Skill to use**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` before implementing.

**Python runtime**: use the pre-provisioned databricks-connect venv (its path is in the system prompt under "Pre-provisioned databricks-connect venv"). Do NOT create a new venv or install databricks-connect.

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| customers.parquet | ~800K | Loyalty tier per table above. Region: US 70%, EU 20%, APAC 10%. Tenure spread: 0–18 months, slight skew newer |
| products.parquet | ~120 | 3 categories: Coffee ~40 ($14–32), Snacks ~50 ($6–18), Pantry ~30 ($8–24) |
| orders.parquet | ~3.6M | ~12 orders/yr per Gold customer, 5/yr Silver, 2/yr Bronze. Last-90-day distribution must produce the 4 segments per Shared Context |
| order_items.parquet | ~6M | ~1.7 items/order. 3-category distribution per region |
| campaigns.parquet | 1 row | Q1 campaign per Shared Context |
| campaign_sends.parquet | ~750K | One row per recipient, all on Q1_CAMPAIGN_DATE |
| campaign_redemptions.parquet | ~16K | Redemption per recipient who used the coupon. Redemption rate per segment per Shared Context |

### Data Variation

Order seasonality: Black Friday + Cyber Monday spike (3×), holiday Dec 15–31 (2×), summer dip (0.8×), ±15% daily noise.

Regional patterns: US → higher Snacks (45% vs 33%), EU → higher Coffee (45% vs 33%), APAC → balanced.

Customer behavior:
- **Gold tier** → recency mostly < 30 days, 12+ orders/yr, $145 AOV
- **Silver tier** → recency 14–60 days, 5–8 orders/yr, $95 AOV
- **Bronze tier** → bimodal: 40% one-shot buyers (recency > 180 days), 60% steady at 2–4 orders/yr, $65 AOV

The 4 behavioral segments fall out of these patterns when computed in Gold.

### The Event (Q1 campaign)

All ~750K active members got the same 15% coupon on Q1_CAMPAIGN_DATE. Redemptions follow segment-specific rates per Shared Context. Champions redeem most (4.2%), Win-Back redeems least (0.4%) — and that's exactly the wrong shape for incremental ROI: the people who'd have bought anyway used the coupon.

### Table Schemas

**customers**: `customer_id` (PK, CUST-NNNNNNN), `email`, `first_name`, `last_name`, `region`, `loyalty_tier` (Bronze/Silver/Gold), `joined_date`, `email_optin`

**products**: `product_id` (PK, SKU-NNNN), `product_name`, `category` (Coffee/Snacks/Pantry), `subcategory`, `price_usd`, `cost_usd`

**orders**: `order_id` (PK, ORD-YYYYMMDD-NNNNNN), `customer_id` (FK), `order_date`, `order_timestamp`, `region`, `subtotal_usd`, `discount_usd`, `total_usd`, `coupon_code` (nullable), `channel` (web/app)

**order_items**: `order_item_id` (PK), `order_id` (FK), `product_id` (FK), `quantity`, `unit_price_usd`, `line_total_usd`

**campaigns**: `campaign_id` (PK, CMP-NNNN), `name`, `send_date`, `coupon_code`, `discount_pct`, `description`

**campaign_sends**: `send_id` (PK), `campaign_id` (FK), `customer_id` (FK), `sent_timestamp`, `email_opened` (bool)

**campaign_redemptions**: `redemption_id` (PK), `campaign_id` (FK), `customer_id` (FK), `order_id` (FK), `redeemed_timestamp`, `discount_amount_usd`

---

## B. SDP Pipeline

**Skill to use**: `databricks-spark-declarative-pipelines` — read `SKILLS/databricks-spark-declarative-pipelines/SKILL.md` before implementing.

Create pipeline `harvestly_loyalty` transforming raw parquet → analytics tables.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | revenue, active members, Q1 incremental ROI, segment mix | gold_segment_summary + gold_campaign_performance |
| Dashboard concentration | revenue share by segment | gold_segment_summary |
| Dashboard redemption | redemption rate by segment (the wrong-shape story) | gold_campaign_performance |
| Genie investigation | Slice the base by RFM, name segments, compare against campaign performance | gold_customer_segments + gold_campaign_performance + silver_orders |

### Source → Bronze (1:1 ingestion)

customers/products/orders/order_items/campaigns/campaign_sends/campaign_redemptions.parquet → bronze_{table_name}

### Bronze → Silver (joins + RFM features)

**silver_orders**: orders JOIN customers (→ region, loyalty_tier, joined_date). Expectations: `order_id IS NOT NULL`, `customer_id IS NOT NULL`. Columns: order_id, customer_id, order_date, region, loyalty_tier, joined_date, total_usd, discount_usd, coupon_code.

**silver_customer_rfm**: per-customer aggregates over last 12 months from STORY_END_DATE. Columns: customer_id, region, loyalty_tier, joined_date, tenure_days, recency_days (NOW - max(order_date)), frequency_12m (COUNT orders), monetary_12m_usd (SUM total_usd), frequency_q_recent (orders in last 90d), frequency_q_prior (orders 91–180d ago), frequency_qoq_delta (frequency_q_recent - frequency_q_prior).

**silver_campaign_activity**: campaign_sends LEFT JOIN campaign_redemptions ON (campaign_id, customer_id) JOIN orders (where redemption→order). Columns: campaign_id, customer_id, sent_timestamp, redeemed (bool), redeemed_timestamp, discount_amount_usd, redemption_order_total_usd.

### Silver → Gold (segmentation + campaign ROI)

**⚠️ Segmentation rules must match the table in Shared Context exactly. The four labels are the demo's punchline.**

**gold_customer_segments** — one row per customer. Columns: customer_id, region, loyalty_tier, recency_days, frequency_12m, monetary_12m_usd, frequency_qoq_delta, segment (CASE WHEN: Champions / New Loyalists / Cooling Off / Win-Back per Shared Context rules).

**gold_segment_summary** — one row per segment. Columns: segment, member_count, revenue_12m_usd, avg_aov_usd, avg_recency_days, revenue_share_pct (revenue_12m_usd / SUM(revenue_12m_usd) OVER ()).

**gold_campaign_performance** — one row per (campaign_id, segment). Columns: campaign_id, campaign_name, segment, sent_count, redemption_count, redemption_rate, total_discount_given_usd, attributed_revenue_usd, holdout_baseline_revenue_usd (assume 70% of attributed revenue would have happened anyway — encoded as a constant for the demo), incremental_revenue_usd (attributed - holdout_baseline), true_roi_pct ((incremental - discount) / discount).

### Filter Coherence Matrix

| Filter | gold_segment_summary | gold_customer_segments | gold_campaign_performance |
|--------|----------------------|------------------------|---------------------------|
| region | ✅ (recompute aggregates) | ✅ | ✅ |
| segment | ✅ (single-segment view) | ✅ | ✅ |

`gold_segment_summary` and `gold_campaign_performance` are both pre-aggregated — region and segment must be present as dimensions on both so the dashboard's left-rail filters cross-apply.

### Column Reference (contract for 02-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|----------------|----------------|
| gold_segment_summary | region, segment | member_count, revenue_12m_usd, avg_aov_usd, revenue_share_pct |
| gold_customer_segments | region, segment, loyalty_tier | recency_days, frequency_12m, monetary_12m_usd |
| gold_campaign_performance | region, segment | sent_count, redemption_rate, total_discount_given_usd, incremental_revenue_usd, true_roi_pct |

---

## C. PDF Generation

**Skill to use**: `databricks-unstructured-pdf-generation` — read `SKILLS/databricks-unstructured-pdf-generation/SKILL.md` before implementing.

Generate ~8 PDFs in `{raw_data_volume}/marketing_playbook/`. Two contain the smoking gun.

**Background (~6 PDFs)**: Routine marketing docs (brand voice guide, email subject-line guide, holiday calendar, paid social budget primer, agency briefing template, GDPR consent guide). NO segment-specific tactics. NO mention of Q1 ROI shortfall.

**Key documents** (the KA must surface these):

1. **Customer Marketing Playbook v3.2** (~12 pages). Structured by segment with explicit tactics:
   - **Champions** — VIP early access, free shipping upgrades, no broad discounts. Margin lever is retention not conversion.
   - **New Loyalists** — cross-category bundle (Coffee + Pantry) at 10% off. Goal: basket diversity, second-order timing.
   - **Cooling Off** — personalized "your favorite category is back in stock" email. No discount in first 60 days; modest 10% if 60–90 days silent.
   - **Win-Back** — 25% off + free shipping, time-limited (72 hours), single touch. Higher cost is the price of reactivation; expect 0.5–1.5% redemption.
   - Closing note: *"Mass-blast discounts to the full active base are explicitly discouraged — they over-pay Champions and under-move Win-Back."*

2. **Q1 Campaign Post-Mortem Memo** (~3 pages, signed by Director of CRM). Covers the same campaign data the dashboard shows: $4.2M margin, $1.8M incremental, 43% true ROI vs holdout. Calls out that Champions over-redeemed and Win-Back barely redeemed. Recommends a segmented strategy per the Playbook for Q3 onward.

---

## D. Validation

Run before proceeding to 02-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Member count | `SELECT COUNT(*) FROM gold_customer_segments` | ~800K |
| Segment mix | `SELECT segment, COUNT(*), ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct FROM gold_customer_segments GROUP BY segment` | Champions ~10%, New Loyalists ~25%, Cooling Off ~35%, Win-Back ~30% |
| Revenue concentration | `SELECT segment, revenue_share_pct FROM gold_segment_summary ORDER BY revenue_share_pct DESC` | Champions ~38% on top |
| Campaign ROI | `SELECT segment, redemption_rate, true_roi_pct FROM gold_campaign_performance` | Champions redemption highest (~4.2%), Win-Back lowest (~0.4%); aggregate true_roi_pct negative or barely positive |
| Holdout-adjusted incremental | `SELECT SUM(incremental_revenue_usd), SUM(total_discount_given_usd) FROM gold_campaign_performance` | ~$1.8M incremental against ~$4.2M discount |
| Filter dims present | `DESCRIBE gold_segment_summary` / `DESCRIBE gold_campaign_performance` | Both have `region` and `segment` |

Add `pipeline_id` to `resources.json`.
