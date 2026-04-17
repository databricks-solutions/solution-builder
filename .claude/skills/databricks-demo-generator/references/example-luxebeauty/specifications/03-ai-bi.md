# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `LuxeBeauty Operations` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs | gold_daily_summary | date, region, category | revenue_usd, order_count, items_sold, returns_usd |
| Returns trend | gold_daily_summary | date, region, category | returns_usd |
| Revenue trend | gold_daily_summary | date, region, category | revenue_usd |
| Category pie | gold_daily_summary | region, category | revenue_usd |
| Products table | gold_returns_by_product | region, category | product_name, units_sold, total_refund_usd, return_rate |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | Region | Category          │
├─────────────────────────────────────────────────────────────────┤
│ [Revenue $3.8M ✓] [Orders 15.2K ✓] [Items 24.3K ✓] [Returns $180K ⚠️ 3x] │
├─────────────────────────────────────────────────────────────────┤
│ WEEKLY RETURNS TREND (full width) ← THE SPIKE                   │
├─────────────────────────────────────────────────────────────────┤
│ Weekly Revenue (steady)    │  Revenue by Category (pie)         │
├─────────────────────────────────────────────────────────────────┤
│ PRODUCTS TABLE sorted by return_rate DESC                       │
│ SKU-1001 Hydrating Serum | Skincare | 1,680 | $34K | 30% ⚠️    │
│ SKU-1002 Vitamin C Cream | Skincare | 1,650 | $27K | 30% ⚠️    │
│ SKU-1003 HA Moisture Boost | Skincare | 1,670 | $21K | 30% ⚠️  │
├─────────────────────────────────────────────────────────────────┤
│ EMBEDDED GENIE SPACE                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_daily_summary | Last 30 days |
| Region | region | gold_daily_summary, gold_returns_by_product | All |
| Category | category | gold_daily_summary, gold_returns_by_product | All |

All filters affect ALL widgets including products table.

### Validation

Spike visible (returns ~$60K→$180K). Products sorted (SKU-1001/1002/1003 at top ~30%). Region filter works (select "EU" → all widgets update). Category filter works (select "Skincare" → spike more pronounced).

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `LuxeBeauty Operations Analytics` Genie Space.

### Tables

gold_daily_summary (trends), gold_returns_by_product (product-level rates), gold_returns_by_lot (lot tracing + feedback_samples), silver_returns (raw return_reason_text), bronze_products (catalog), bronze_production_lots (lot details).

### Instructions

```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).

BASELINES: Normal weekly returns ~$60K, normal return rate ~8%, anomaly threshold >20%.

INVESTIGATION FLOW for "Why so many returns?":
1. gold_daily_summary → SUM(returns_usd) by week → spot 3x spike (~$180K vs $60K)
2. gold_returns_by_product → WHERE return_rate > 0.2 → SKU-1001, SKU-1002, SKU-1003
3. gold_returns_by_lot → GROUP BY lot_id → one lot dominates
4. silver_returns → return_reason_text WHERE lot_id = affected → texture complaints
5. Conclude + suggest: "Would you like me to check for production incidents?"

CUSTOMER FEEDBACK (from affected lot): "grainy texture" / "product separated" / "consistency is watery" / "texture feels off"
```

### Sample Questions

"Why do I have so many returns?" / "Which products have the highest return rate?" / "What are customers saying about returns?" / "Show me returns trend for the last 8 weeks" / "Which lot has the most returns?" / "Tell me about lot [LOT-ID]"

### Validation

"Why so many returns?" → 3x spike, SKU-1001/1002/1003, common lot, texture feedback. "What are customers saying?" → surfaces "grainy", "separated", "watery".

Add genie_space_id to `resources.json`.
