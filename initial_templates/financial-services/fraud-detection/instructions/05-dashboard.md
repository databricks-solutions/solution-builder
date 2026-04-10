# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the fraud spike and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `Meridian Bank Fraud Operations` |
| **Description** | "Real-time fraud monitoring and investigation dashboard" |

---

## Layout

**5-Second Test**: Fraud spike must be immediately obvious (red alert, large number showing 3x increase).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| Total Fraud Losses (MTD) | `$2.4M` (red, up arrow) | gold_fraud_summary |
| vs Previous Month | `+180%` | gold_fraud_summary |
| Active Cases | `847` | gold_fraud_summary |
| Avg Resolution Time | `4.2 hrs` | gold_fraud_summary |

### Row 2: Trend Analysis (2 Columns)

**Left: Daily Fraud Losses**
- Line chart showing last 30 days
- Baseline ~$27K/day, spike to $80K+ starting Feb 15
- Anomaly period highlighted

**Right: Fraud by Channel**
- Bar chart: In-Store POS, E-commerce, ATM, Mobile
- In-Store POS dramatically higher than others

### Row 3: Investigation Details (2 Columns)

**Left: Top Merchants by Fraud**
- Table: Merchant, Location, Fraud Amount, Case Count
- QuickMart #4521 at top with $847K

**Right: Geographic Heat Map**
- Map showing fraud concentration
- Metro Phoenix area highlighted

### Row 4: Terminal Analysis (Full Width)

**Terminal Fraud Comparison**
- Scatter plot: Terminal ID vs Fraud Amount
- Cluster of 12 terminals from QuickMart clearly visible

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7/30/90 days | Last 30 days |
| Fraud Status | All, Confirmed, Investigating | All |
| Channel | All, POS, E-commerce, ATM, Mobile | All |
| Region | All regions | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: $2.4M fraud vs ~$800K baseline (3x spike)
2. **Channel**: In-Store POS is the dominant source
3. **Merchant**: QuickMart #4521 is the hotspot
4. **Terminals**: 12 specific terminals drive 70% of fraud

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | Fraud spike immediately visible |
| Filter to In-Store POS | QuickMart dominates |
| Drill into QuickMart | 12 terminals identified |
