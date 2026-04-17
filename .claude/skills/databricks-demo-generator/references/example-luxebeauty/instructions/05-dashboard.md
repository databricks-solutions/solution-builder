# Dashboard Creation

Create `LuxeBeauty Operations` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

## Story

Claire (VP Ops) opens her Monday dashboard. Revenue normal, orders steady... but returns: **$180K** (3x the usual $60K). Three Skincare products at 30% return rate. She asks: "Why do I have so many returns?"

## Data Sources (from 03-pipelines.md)

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs | gold_daily_summary | date, region, category | revenue_usd, order_count, items_sold, returns_usd |
| Returns trend | gold_daily_summary | date, region, category | returns_usd |
| Revenue trend | gold_daily_summary | date, region, category | revenue_usd |
| Category pie | gold_daily_summary | region, category | revenue_usd |
| Products table | gold_returns_by_product | **region**, **category** | product_name, units_sold, total_refund_usd, return_rate |

**⚠️ Products table MUST filter by region/category** — gold_returns_by_product has these columns.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | Region | Category          │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│ │ Revenue  │ │ Orders   │ │ Items    │ │ Returns           │   │
│ │ $3.8M ✓  │ │ 15.2K ✓  │ │ 24.3K ✓  │ │ $180K ⚠️ (3x)    │   │
│ └──────────┘ └──────────┘ └──────────┘ └───────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│ WEEKLY RETURNS TREND (full width) ← THE SPIKE                   │
├─────────────────────────────────────────────────────────────────┤
│ Weekly Revenue (steady)    │  Revenue by Category (pie)         │
├─────────────────────────────────────────────────────────────────┤
│ PRODUCTS TABLE sorted by return_rate DESC                       │
│ SKU-1001 Hydrating Serum   | Skincare | 1,680 | $34K | 30% ⚠️  │
│ SKU-1002 Vitamin C Cream   | Skincare | 1,650 | $27K | 30% ⚠️  │
│ SKU-1003 HA Moisture Boost | Skincare | 1,670 | $21K | 30% ⚠️  │
├─────────────────────────────────────────────────────────────────┤
│ EMBEDDED GENIE SPACE                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Filters (Critical)

| Filter | Column | Source Tables | Values | Default |
|--------|--------|---------------|--------|---------|
| Date Range | date | gold_daily_summary | Picker | Last 30 days |
| Region | region | gold_daily_summary, **gold_returns_by_product** | US, EU, APAC | All |
| Category | category | gold_daily_summary, **gold_returns_by_product** | Skincare, Makeup, Haircare | All |

**All filters affect ALL widgets including products table.**

## Validation

| Check | Action |
|-------|--------|
| Spike visible | Returns trend shows ~$60K → $180K (3x) |
| Products sorted | SKU-1001/1002/1003 at top with ~30% rate |
| Region filter works | Select "EU" → ALL widgets update including products table |
| Category filter works | Select "Skincare" → spike more pronounced, products filtered |
| Currency format | All $ values formatted correctly |

Add dashboard_id to `resources.json`.
