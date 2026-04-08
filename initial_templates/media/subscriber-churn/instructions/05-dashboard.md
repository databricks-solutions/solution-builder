# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the churn spike and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `StreamVue Customer Success Dashboard` |
| **Description** | "Subscriber health monitoring and churn analytics" |

---

## Layout

**5-Second Test**: Churn spike must be immediately obvious (red alert, 4.8% vs 2.4% baseline).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| Monthly Churn Rate | `4.8%` (red, gauge) | gold_churn_summary |
| Baseline | `2.4%` | Constant |
| Churned Subscribers | `142,000` | gold_churn_summary |
| Revenue at Risk | `$1.7M/mo` | gold_churn_summary |

### Row 2: Trend Analysis (2 Columns)

**Left: Weekly Churn Rate**
- Line chart showing last 12 weeks
- Baseline ~2.4%, spike to 4.8% starting 3 weeks ago
- Target line at 2.4%

**Right: Churn by Platform**
- Bar chart: iOS, Android, Web, Smart TV, Roku
- iOS dramatically higher than others

### Row 3: Investigation Details (2 Columns)

**Left: Churn by App Version**
- Table: Version, Platform, Churn Rate, Affected Users
- iOS v4.2.0 at top with 9.2% churn rate

**Right: Engagement Trends by Version**
- Multi-line chart showing engagement metrics
- v4.2.0 shows offline plays dropped from 30% to 5%

### Row 4: Segment Analysis (Full Width)

**Customer Segment Health**
- Table: Segment, Subscriber Count, Churn Rate, NPS, Engagement Score
- Mobile-first segment highlighted with highest churn
- Support ticket correlation visible

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7/30/90 days | Last 30 days |
| Platform | All, iOS, Android, Web, TV | All |
| Subscription Tier | All, Basic, Standard, Premium | All |
| Segment | All, Mobile-first, Family, etc. | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: 4.8% churn vs 2.4% baseline (2x spike)
2. **Platform**: iOS is the dominant source
3. **Version**: v4.2.0 has 9.2% churn rate
4. **Engagement**: Offline plays dropped 25 percentage points

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | Churn spike immediately visible |
| Filter to iOS | v4.2.0 dominates |
| Drill into engagement | Offline play drop visible |
