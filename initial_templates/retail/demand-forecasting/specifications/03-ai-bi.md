# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `FreshMart Supply Chain Operations` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs | gold_daily_performance | date, region, category | stockout_losses, stockout_rate, fill_rate, sales_usd |
| Daily lost sales trend | gold_daily_performance | date, region, category | stockout_losses |
| Stockouts by category | gold_daily_performance | date, region, category | stockout_losses |
| Stockouts by region | gold_store_performance | date, region | stockout_losses |
| Forecast accuracy by region | gold_forecast_accuracy | date, region, category | error_pct |
| Store performance grid | gold_store_performance | date, region | store_id, stockout_count, stockout_losses, forecast_error_avg |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | Region | Category          │
├─────────────────────────────────────────────────────────────────┤
│ [Lost Sales $4.2M ⚠️] [vs Prev Month +425%] [Stockout 12.3%]  │
│ [Fill Rate 87.7% ⚠️]                                           │
├─────────────────────────────────────────────────────────────────┤
│ Daily Lost Sales (line, 30d)    │  Stockouts by Category (bar)  │
│ baseline ~$27K/day, spike $140K+│  Dairy dramatically highest    │
├─────────────────────────────────────────────────────────────────┤
│ Stockouts by Region (table)     │  Forecast Accuracy by Region  │
│ Metro East top: $2.8M           │  Metro East 75%+ vs 15% others│
├─────────────────────────────────────────────────────────────────┤
│ STORE PERFORMANCE GRID (full width)                             │
│ 23 Metro East stores highlighted, sortable by any metric        │
└─────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_daily_performance, gold_store_performance, gold_forecast_accuracy | Last 30 days |
| Region | region | all gold tables | All |
| Category | category | gold_daily_performance, gold_forecast_accuracy | All |

All filters affect ALL widgets.

### Validation

Spike visible ($4.2M vs $800K baseline). Filter to Metro East → 23 stores dominate. Drill into Dairy → demand spike vs forecast visible.

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `FreshMart Supply Chain Analytics` Genie Space.

### Tables

gold_daily_performance (KPIs/trends), gold_store_performance (store-level), gold_forecast_accuracy (forecast accuracy), silver_stockouts (individual records), silver_sales (sales details), bronze_stores (store info).

### Instructions

```
You analyze FreshMart supply chain data for inventory planners.

BASELINES: Normal weekly stockout losses ~$800K, normal stockout rate ~2%, anomaly threshold: 5x baseline.

INVESTIGATION FLOW for "Why are stockouts so high?":
1. gold_daily_performance → SUM(stockout_losses) by week → spot 5x spike (~$4.2M vs $800K)
2. gold_daily_performance → GROUP BY region → Metro East dominates
3. gold_daily_performance → GROUP BY category → Dairy most affected
4. gold_forecast_accuracy → WHERE region = 'Metro East' → 75%+ forecast error
5. Conclude: "The forecasting model missed a major demand event in Metro East. The forecast error of 75%+ suggests an external demand driver not captured in the model. Would you like me to check for event data?"
```

### Sample Questions

"Why are stockouts so high this week?" / "Which stores have the most stockouts?" / "Which categories are impacted?" / "Show me forecast accuracy for Metro East" / "What drove the demand spike?"

### Validation

"Why are stockouts high?" → identifies 5x spike, Metro East, Dairy, 75%+ forecast error. "Which stores have issues?" → 23 Metro East stores.

Add genie_space_id to `resources.json`.
