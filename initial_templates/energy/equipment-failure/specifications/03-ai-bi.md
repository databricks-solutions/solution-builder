# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `Pacific Grid Operations Center` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs | gold_outage_summary | date, region, cause_code | outage_count, total_duration_hours, customers_affected |
| Daily outage trend | gold_outage_summary | date, region, cause_code | outage_count |
| Outages by cause | gold_outage_summary | date, region | outage_count (grouped by cause_code) |
| Batch reliability table | gold_batch_reliability | — | batch_id, manufacturer, transformer_count, failure_count, failure_rate, avg_temperature |
| Equipment health table | silver_equipment_health | batch_id, region | transformer_id, avg_temperature, max_temperature, avg_oil_level |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | Region | Cause Code        │
├─────────────────────────────────────────────────────────────────┤
│ [Outages 47 ⚠️ 3x] [vs Prev Month +213%] [Customers 284K] [SAIDI 127 min ⚠️] │
├─────────────────────────────────────────────────────────────────┤
│ DAILY OUTAGE COUNT (line, 30d) ← THE SPIKE  │ OUTAGES BY CAUSE (bar)  │
│ Baseline ~0.5/day, spike 3 wks ago          │ Equipment >> Weather/Veg │
├─────────────────────────────────────────────────────────────────┤
│ BATCH RELIABILITY TABLE sorted by failure_rate DESC             │
│ TRF-2024-Q3-887 | GridTech | 234 | 47 | 20% ⚠️ | 88°C ⚠️     │
├─────────────────────────────────────────────────────────────────┤
│ EQUIPMENT HEALTH TABLE (filtered by batch)                      │
│ Color-coded: green (<75°C) / yellow (75-85°C) / red (>85°C)    │
├─────────────────────────────────────────────────────────────────┤
│ EMBEDDED GENIE SPACE                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_outage_summary | Last 30 days |
| Region | region | gold_outage_summary, silver_equipment_health | All |
| Cause Code | cause_code | gold_outage_summary | All |

All filters affect ALL widgets.

### Validation

Spike visible (47 vs 15 baseline). Batch table shows TRF-2024-Q3-887 at top. Equipment cause dominates bar chart. Region filter works (select "North" → all widgets update). Cause filter (select "equipment" → spike even more pronounced).

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `Pacific Grid Operations Analytics` Genie Space.

### Tables

gold_outage_summary (trends), gold_batch_reliability (batch-level analysis), gold_monthly_reliability (monthly trends), silver_outages (individual records), silver_equipment_health (sensor data), bronze_transformers (equipment details).

### Instructions

```
You analyze Pacific Grid Energy operations data for grid reliability engineers.

BASELINES: Normal monthly outages ~15, normal temperature range 45-75°C, anomaly threshold >85°C.

INVESTIGATION FLOW for "Why so many outages?":
1. gold_outage_summary → SUM(outage_count) by month → spot 3x spike (~47 vs ~15)
2. gold_outage_summary → GROUP BY cause_code → "equipment" dominates
3. gold_batch_reliability → WHERE failure_rate > 0.1 → batch TRF-2024-Q3-887
4. silver_equipment_health → WHERE batch_id = 'TRF-2024-Q3-887' → elevated temperatures (10-15°C above normal)
5. Conclude + suggest: "Would you like me to check supplier documentation for this batch?"

KEY IDENTIFIERS:
- Batch: TRF-2024-Q3-887
- Manufacturer: GridTech Industries (supplier notice from VoltPower Manufacturing)
- Failure mode: Transformer overheating → insulation breakdown
```

### Sample Questions

"Why are we having so many outages?" / "Which equipment batches are failing?" / "Show me outage trends for this month" / "What's the reliability rate by manufacturer?" / "Which transformers have elevated temperatures?" / "Tell me about batch TRF-2024-Q3-887"

### Validation

"Why so many outages?" → 3x spike, equipment cause, batch TRF-2024-Q3-887, elevated temps. "Which batch has issues?" → TRF-2024-Q3-887 with failure rate and temperature anomaly.

Add genie_space_id to `resources.json`.
