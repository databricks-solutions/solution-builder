# Dashboard - Manufacturing Quality

## Dashboard Title
**TitanAuto Quality Operations Command Center**

## Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FILTERS: Date Range | Product Line | Building | Machine                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Defect Rate  │  │ Parts at     │  │ $ at Risk    │  │ Machines     │    │
│  │    3.2%      │  │ Risk: 847    │  │   $2.4M      │  │ Flagged: 1   │    │
│  │   ▲ 4x       │  │              │  │              │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  DEFECT RATE TREND (6 months)       │  │  DEFECTS BY PRODUCT LINE    │  │
│  │                                      │  │                             │  │
│  │  3.2% ─────────────────────── ●     │  │  Connecting Rod  ████████   │  │
│  │                                 │     │  │  Piston          ██        │  │
│  │  0.8% ═══════════════════════  │     │  │  Crankshaft      █         │  │
│  │       Sep Oct Nov Dec Jan Feb Mar    │  │                             │  │
│  │                            ↑ SPIKE   │  │                             │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  DEFECTS BY MACHINE                 │  │  DEFECT TYPE BREAKDOWN      │  │
│  │                                      │  │                             │  │
│  │  CNC-B-007  ██████████████████ 78%  │  │  Tolerance Drift  ████████  │  │
│  │  CNC-A-003  ██                  4%  │  │  Surface Finish   ██        │  │
│  │  CNC-B-002  ██                  3%  │  │  Dimensional      █         │  │
│  │  Other      ███                15%  │  │  Crack            █         │  │
│  │                                      │  │                             │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  MACHINE HEALTH STATUS                                               │   │
│  │                                                                       │   │
│  │  Machine    │ Vibration │ Maint Due  │ Status    │ Defect Rate       │   │
│  │  ─────────────────────────────────────────────────────────────────── │   │
│  │  CNC-B-007  │ 2.3 mm/s  │ OVERDUE    │ ⚠ WARNING │ 3.2%  ████████   │   │
│  │  CNC-A-003  │ 0.9 mm/s  │ Apr 15     │ ✓ OK      │ 0.7%  █          │   │
│  │  CNC-B-002  │ 1.1 mm/s  │ Mar 25     │ ✓ OK      │ 0.9%  █          │   │
│  │  ...                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## KPI Cards (Top Row)

| KPI | Value | Comparison | Source |
|-----|-------|------------|--------|
| Defect Rate | 3.2% | ▲ 4x vs baseline | gold_daily_quality_metrics |
| Parts at Risk | 847 | This week | gold_daily_quality_metrics |
| $ at Risk | $2.4M | Shipment value | Calculated: parts × unit cost |
| Machines Flagged | 1 | Maintenance overdue | gold_machine_maintenance_status |

## Charts

### 1. Defect Rate Trend (Line Chart)
- X-axis: Date (6 months)
- Y-axis: Defect rate %
- Reference line at 0.8% (baseline)
- **The spike is immediately visible** - rate jumps from 0.8% to 3.2% in week of March 11

### 2. Defects by Product Line (Bar Chart)
- Horizontal bars
- Shows connecting rod dominates (should be obvious at a glance)
- Enables drill-down question: "Why connecting rods?"

### 3. Defects by Machine (Bar Chart)
- Horizontal bars sorted by count
- CNC-B-007 should dominate (78% of defects)
- Enables next question: "What's wrong with CNC-B-007?"

### 4. Defect Type Breakdown (Bar Chart)
- Shows tolerance_drift as dominant type
- Supports root cause: precision issue, not material or operator

### 5. Machine Health Status (Table)
- Traffic light status column
- Shows CNC-B-007 with WARNING status
- Maintenance overdue clearly visible
- Vibration readings trending high

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7 days, 30 days, 90 days, Custom | Last 7 days |
| Product Line | All, Connecting Rod, Piston, Crankshaft | All |
| Building | All, A, B, C | All |
| Machine | All, individual machines | All |

## The 5-Second Test

When Maria opens this dashboard, within 5 seconds she should see:
1. **Defect rate is RED and 4x normal** - immediate alert
2. **Connecting rods are the problem** - product line bar chart
3. **CNC-B-007 is the culprit** - machine bar chart
4. **Maintenance is overdue on that machine** - health status table

No explanation needed. The visual tells the story.
