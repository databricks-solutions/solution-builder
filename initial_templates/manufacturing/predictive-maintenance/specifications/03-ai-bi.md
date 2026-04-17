# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `Precision Motors Quality Operations` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

**5-Second Test**: Defect rate spike must be immediately obvious (red alert, gauge showing 8.5% vs 2.8% target).

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPI: Defect Rate | gold_defect_rates | date, plant, machine_type | defect_rate (gauge, red, 8.5% vs 2.8% target) |
| KPI: Scrap Cost MTD | gold_daily_quality | date, plant | scrap_cost (~$1.2M) |
| KPI: OEE | gold_machine_health | date, plant | derived (67%, yellow) |
| Daily defect trend | gold_defect_rates | date, plant, machine_type | defect_rate (line, 30d, baseline + spike) |
| Defects by machine | gold_defect_rates | date, plant, machine_type | machine_id, defect_rate (bar, CNC-DTR-007 dominant at 12%) |
| Defect type dist | silver_quality | date, plant | defect_type (pie, dimensional 65%) |
| Sensor trend | silver_sensor_trends | machine_id=CNC-DTR-007 | avg_value by reading_date+sensor_type (multi-line, vibration trending up) |
| Machine status grid | gold_machine_health | plant, machine_type | machine_id, avg_vibration, defect_rate, maintenance_status (cards, CNC-DTR-007 red) |

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30d) | Plant | Machine Type | Shift │
├────────────────────────────────────────────────────────────────┤
│ [Defect Rate 8.5% ⚠️ gauge] [Scrap $1.2M] [OEE 67% ⚠️]     │
├──────────────────────────────┬─────────────────────────────────┤
│ Daily Defect Rate (line)     │ Defects by Machine (bar)        │
│ baseline 2.8%, spike 8.5%   │ CNC-DTR-007 at 12% dominant     │
├──────────────────────────────┬─────────────────────────────────┤
│ Defect Type Distribution     │ Sensor Trend CNC-DTR-007        │
│ (pie, dimensional 65%)       │ (vibration 1.8→4.5 mm/s)        │
├────────────────────────────────────────────────────────────────┤
│ MACHINE STATUS GRID (full width)                               │
│ CNC-DTR-007 RED │ others GREEN/YELLOW                          │
└────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_defect_rates, gold_daily_quality, gold_machine_health | Last 30 days |
| Plant | plant | all gold tables | All |
| Machine Type | machine_type | gold_defect_rates, gold_machine_health | All |
| Shift | shift | silver_quality (if available) | All |

All filters affect ALL widgets.

### Validation

Spike visible (defect rate 2.8% → 8.5%). CNC-DTR-007 dominates bar chart (12%). Filter to CNC → spike more pronounced. Sensor trend shows vibration anomaly. Machine grid shows CNC-DTR-007 red.

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `Precision Operations Analytics` Genie Space.

### Tables

gold_defect_rates (KPIs/trends), gold_machine_health (machine-level), gold_daily_quality (daily quality), silver_quality (individual inspections), silver_sensor_trends (sensor data), bronze_machines (machine details).

### Instructions

```
You analyze Precision Motors operations data for quality engineers.

BASELINES: Normal defect rate ~2.8%, warning >5%, critical >8%. Normal vibration 0.5-2.0 mm/s, warning >3.0, critical >5.0.

INVESTIGATION FLOW for "Why are defects so high?":
1. gold_defect_rates → defect_rate by date → spot spike to 8.5% (3x baseline)
2. gold_defect_rates → GROUP BY machine_id → CNC-DTR-007 at 12%
3. gold_machine_health → WHERE machine_id='CNC-DTR-007' → vibration 4.5 mm/s (critical)
4. silver_quality → WHERE machine_id='CNC-DTR-007' → dimensional tolerance failures dominate
5. Conclude: "CNC-DTR-007 vibration anomaly causing dimensional defects. Suggest checking maintenance logs for this machine."

KEY IDENTIFIERS:
- Machine: CNC-DTR-007, Detroit Plant
- Issue: Vibration trending 1.8→4.5 mm/s (spindle bearing wear)
- Impact: 12% defect rate, ~12,400 defective parts, dimensional tolerance failures
```

### Sample Questions

"Why are defects so high?" / "Which machines have quality issues?" / "Show me sensor data for CNC-DTR-007" / "What's the defect trend for Detroit plant?" / "Which parts have the highest reject rate?"

### Validation

"Why are defects high?" → identifies spike, CNC-DTR-007, vibration issue. "Which machine has issues?" → CNC-DTR-007. "Show sensor data" → vibration trend visible.

Add genie_space_id to `resources.json`.
