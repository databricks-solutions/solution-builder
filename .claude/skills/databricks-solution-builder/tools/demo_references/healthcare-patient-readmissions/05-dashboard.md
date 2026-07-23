# Dashboard - Healthcare Readmissions

## Dashboard Title
**Meridian Health Quality Command Center**

## Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FILTERS: Date Range | Service Line | Procedure | Insurance Type            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Readmit Rate │  │ Excess       │  │ Penalty      │  │ Discharge    │    │
│  │    18%       │  │ Readmits: 47 │  │ Risk: $840K  │  │ Quality: 72% │    │
│  │   ▲ 64%      │  │              │  │              │  │   ▼ 23%      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  READMISSION RATE TREND (12 mo)     │  │  BY SERVICE LINE            │  │
│  │                                      │  │                             │  │
│  │  18% ─────────────────────── ●      │  │  Cardiology    ██████████   │  │
│  │                                │      │  │  Orthopedics   ███         │  │
│  │  11% ═══════════════════════  │      │  │  Gen Medicine  ██          │  │
│  │       Apr May Jun Jul Aug Sep Oct    │  │                             │  │
│  │       Nov Dec Jan Feb Mar ↑ SPIKE    │  │                             │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  BY PROCEDURE (Cardiology)          │  │  READMIT REASONS            │  │
│  │                                      │  │                             │  │
│  │  TAVR         ████████████████ 24%  │  │  Heart Failure  ████████    │  │
│  │  CABG         ████             10%  │  │  Arrhythmia     ███         │  │
│  │  PCI          ███               8%  │  │  Infection      ██          │  │
│  │  Other        ███               9%  │  │  Other          █           │  │
│  │                                      │  │                             │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  DISCHARGE PROCESS QUALITY                                          │   │
│  │                                                                       │   │
│  │  Metric              │ Current │ Target │ Trend   │ Gap              │   │
│  │  ─────────────────────────────────────────────────────────────────── │   │
│  │  Education Complete  │   60%   │  95%   │ ▼       │ ⚠ CRITICAL      │   │
│  │  Follow-up Scheduled │   70%   │  98%   │ ▼       │ ⚠ WARNING       │   │
│  │  Med Reconciliation  │   92%   │  95%   │ →       │ ✓ OK            │   │
│  │  Has Coordinator     │   58%   │  100%  │ ▼       │ ⚠ CRITICAL      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## KPI Cards (Top Row)

| KPI | Value | Comparison | Source |
|-----|-------|------------|--------|
| Readmission Rate | 18% | ▲ 64% vs baseline (11%) | gold_readmission_metrics |
| Excess Readmissions | 47 | Above expected | Calculated vs baseline |
| Penalty Risk | $840K | CMS penalty exposure | Calculated |
| Discharge Quality | 72% | ▼ 23% vs baseline | gold_staffing_impact |

## Charts

### 1. Readmission Rate Trend (Line Chart)
- X-axis: Month (12 months)
- Y-axis: Readmission rate %
- Reference line at 11% (baseline/target)
- **Spike visible** - rate jumps from 11% to 18% in Feb-Mar

### 2. By Service Line (Bar Chart)
- Horizontal bars
- Cardiology dominates - obvious at a glance
- Color coding: red if >15%, yellow if >12%, green if <12%

### 3. By Procedure - Cardiology (Bar Chart)
- Shows TAVR at 24% (more than double other procedures)
- Enables drill-down: "Why TAVR specifically?"

### 4. Readmit Reasons (Bar Chart)
- Heart failure as top reason
- Supports root cause: patients not recognizing warning signs

### 5. Discharge Process Quality (Table)
- Traffic light indicators
- Shows education and coordinator gaps clearly
- Visual correlation: "These gaps align with readmission spike"

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 30 days, 90 days, 12 months | Last 90 days |
| Service Line | All, Cardiology, Orthopedics, General Medicine | All |
| Procedure | All, TAVR, CABG, PCI, etc. | All |
| Insurance | All, Medicare, Medicaid, Commercial | All |

## The 5-Second Test

When Dr. Patel opens this dashboard:
1. **Readmission rate is RED at 18%** - immediate concern
2. **Cardiology is the problem** - service line chart
3. **TAVR procedures specifically** - procedure chart
4. **Discharge process is broken** - quality table shows gaps
