# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in 01-lakeflow.md (Section C).

---

## A. Dashboard

Create `Lakeside Health Quality Dashboard` dashboard. Save locally as `{workspace_folder}/dashboard.json`.

### Data Sources

| Widget | Table | Filter Columns | Metric Columns |
|--------|-------|----------------|----------------|
| KPIs (gauges) | gold_readmission_rates | date, drg | readmission_rate, target_rate |
| KPIs (counts) | gold_protocol_performance | drg | patient_count, penalty_exposure |
| Weekly trend | gold_readmission_rates | date, drg | readmission_rate |
| By DRG bar chart | gold_readmission_rates | drg | readmission_rate |
| Protocol table | gold_protocol_performance | drg, protocol_id | readmission_rate, patient_count, avg_los |
| Monthly trend | gold_monthly_quality | month, drg | readmission_rate, target, penalty_usd |

### Layout

**5-Second Test**: 18% readmission rate vs 9% target must be immediately obvious (red gauge, alert styling).

```
┌─────────────────────────────────────────────────────────────────┐
│ FILTERS: Date Range (Last 30 days) | DRG Category | Risk Level  │
├─────────────────────────────────────────────────────────────────┤
│ [Readmit Rate 18.2% ⚠️] [Target 9%] [At-Risk 312] [Penalty $3.2M ⚠️] │
├─────────────────────────────────────────────────────────────────┤
│ Weekly Readmission Trend (line)    │  Readmissions by DRG (bar)  │
│ Baseline ~9%, spike to 18%         │  HF dramatically higher     │
│ Target line at 9%                  │                              │
├─────────────────────────────────────────────────────────────────┤
│ Protocol Performance Table (sorted by readmission_rate DESC)    │
│ DISCH-HF-2025-03 | Heart Failure | 24% | 650 patients | $3.2M  │
├─────────────────────────────────────────────────────────────────┤
│ Monthly Quality Trend              │  High-Risk Patient List      │
│ readmission_rate vs target by month│  Filterable by protocol/DRG  │
├─────────────────────────────────────────────────────────────────┤
│ EMBEDDED GENIE SPACE                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Column | Source Tables | Default |
|--------|--------|---------------|---------|
| Date Range | date | gold_readmission_rates, gold_monthly_quality | Last 30 days |
| DRG Category | drg | gold_readmission_rates, gold_protocol_performance | All |
| Risk Level | risk_score ranges | silver_encounters | All |

All filters affect ALL widgets.

### Validation

Spike visible (18% vs 9% target). Protocol table shows DISCH-HF-2025-03 at top (~24%). DRG filter works (select Heart Failure → spike more pronounced). Timeline correlates with PROTOCOL_CHANGE_DATE.

Add dashboard_id to `resources.json`.

---

## B. Genie Space

Create `Lakeside Quality Analytics` Genie Space.

### Tables

gold_readmission_rates (KPIs/trends), gold_protocol_performance (protocol analysis), gold_monthly_quality (monthly trends), silver_readmissions (individual readmissions), bronze_discharge_protocols (protocol details).

### Instructions

```
You analyze Lakeside Health quality data for the Chief Quality Officer.

BASELINES: Normal 30-day readmission rate ~9%, CMS target 9%, anomaly threshold >15%.

INVESTIGATION FLOW for "Why are readmissions so high?":
1. gold_readmission_rates → readmission_rate by date → spot 18% vs 9% target
2. gold_readmission_rates → WHERE drg IN ('291','292','293') → Heart Failure dominant
3. gold_protocol_performance → WHERE readmission_rate > 0.15 → DISCH-HF-2025-03 at 24%
4. silver_readmissions → WHERE discharge_protocol_id = 'DISCH-HF-2025-03' → ~156 readmissions, medication-related reasons
5. Conclude: "Protocol DISCH-HF-2025-03 correlates with 2.7x readmission spike in heart failure patients. Would you like me to check clinical documents for protocol details?"
```

### Sample Questions

"Why are readmissions so high this month?" / "Which protocols have the worst outcomes?" / "What's the readmission rate for heart failure?" / "Show me readmission trends by DRG" / "What's driving our CMS penalty exposure?"

### Validation

"Why are readmissions high?" → 18% vs 9%, heart failure DRGs, DISCH-HF-2025-03, ~156 excess readmissions. "Which protocol has issues?" → DISCH-HF-2025-03 with 24% rate.

Add genie_space_id to `resources.json`.
