# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the outage spike and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `Pacific Grid Operations Center` |
| **Description** | "Grid reliability monitoring and equipment health dashboard" |

---

## Layout

**5-Second Test**: Outage spike must be immediately obvious (red alert, large number showing 47 vs 15 baseline).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| Outages (MTD) | `47` (red, up arrow) | gold_outage_summary |
| vs Previous Month | `+213%` | gold_outage_summary |
| Customers Affected | `284,000` | gold_outage_summary |
| SAIDI Minutes | `127` (red) | gold_outage_summary |

### Row 2: Trend Analysis (2 Columns)

**Left: Daily Outage Count**
- Line chart showing last 30 days
- Baseline ~0.5/day, spike starting 3 weeks ago
- Multiple outages per day in recent period

**Right: Outages by Cause**
- Bar chart: Equipment Failure, Weather, Vegetation, Scheduled
- Equipment Failure dramatically higher than others

### Row 3: Investigation Details (2 Columns)

**Left: Outages by Equipment Batch**
- Table: Batch ID, Install Date, Outage Count, Failure Rate
- TRF-2024-Q3-887 at top with 23 failures

**Right: Geographic Distribution**
- Map showing outage locations
- Cluster in service territory where batch installed

### Row 4: Equipment Health (Full Width)

**Transformer Health Grid**
- Table: Asset ID, Batch, Last Reading, Temperature, Status
- TRF-2024-Q3-887 units showing elevated temperatures
- Color-coded by health status (green/yellow/red)

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7/30/90 days | Last 30 days |
| Cause | All, Equipment, Weather, Vegetation | All |
| Equipment Type | Transformer, Breaker, Line | All |
| Region | All service territories | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: 47 outages vs 15 baseline (3x spike)
2. **Cause**: Equipment failures dominate
3. **Batch**: TRF-2024-Q3-887 is the common factor
4. **Sensor**: Elevated temperatures before failures

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | Outage spike immediately visible |
| Filter to Equipment Failure | Batch TRF-2024-Q3-887 dominates |
| Drill into batch | Temperature anomalies visible |
