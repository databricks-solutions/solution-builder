# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the readmission spike and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `Lakeside Health Quality Dashboard` |
| **Description** | "30-day readmission monitoring and quality analytics" |

---

## Layout

**5-Second Test**: Readmission rate spike must be immediately obvious (red alert, gauge showing 18% vs 9% target).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| 30-Day Readmission Rate | `18.2%` (red, gauge) | gold_readmission_summary |
| Target | `9%` | Constant |
| At-Risk Patients | `312` | gold_readmission_summary |
| Estimated Penalty Exposure | `$2.8M` | gold_readmission_summary |

### Row 2: Trend Analysis (2 Columns)

**Left: Weekly Readmission Rate**
- Line chart showing last 12 weeks
- Baseline ~9%, spike to 18% starting 4 weeks ago
- Target line at 9%

**Right: Readmissions by DRG**
- Bar chart: Heart Failure, Pneumonia, COPD, AMI, Hip/Knee
- Heart Failure dramatically higher than others

### Row 3: Investigation Details (2 Columns)

**Left: Readmission by Discharge Protocol**
- Table: Protocol ID, Condition, Readmission Rate, Patient Count
- DISCH-HF-2025-03 at top with 31% rate

**Right: Readmission by Primary Diagnosis**
- Pie chart showing diagnosis distribution
- Heart Failure (CHF) is largest segment

### Row 4: Patient Details (Full Width)

**High-Risk Patient List**
- Table: Patient ID, Diagnosis, Discharge Date, Risk Score, Readmitted
- Filterable by protocol and diagnosis

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 30/60/90 days | Last 30 days |
| DRG Category | All, Heart Failure, Pneumonia, etc. | All |
| Risk Level | All, High, Medium, Low | All |
| Unit | All hospital units | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: 18% readmission rate vs 9% target (2x spike)
2. **Diagnosis**: Heart Failure is the dominant cause
3. **Protocol**: DISCH-HF-2025-03 has 31% readmission rate
4. **Timeline**: Spike correlates with protocol update 4 weeks ago

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | Readmission spike immediately visible |
| Filter to Heart Failure | DISCH-HF-2025-03 dominates |
| Drill into protocol | Missing medication reconciliation visible |
