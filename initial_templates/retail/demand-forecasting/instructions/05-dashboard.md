# Dashboard Creation

## Task

Create an AI/BI Dashboard that shows the stockout spike and enables drill-down analysis.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `FreshMart Supply Chain Operations` |
| **Description** | "Real-time inventory monitoring and demand analytics dashboard" |

---

## Layout

**5-Second Test**: Stockout cost must be immediately obvious (red alert, $4.2M vs $800K baseline).

### Row 1: Executive KPIs (Full Width)

| Metric | Display | Source |
|--------|---------|--------|
| Lost Sales (MTD) | `$4.2M` (red, up arrow) | gold_daily_performance |
| vs Previous Month | `+425%` | gold_daily_performance |
| Stockout Rate | `12.3%` | gold_daily_performance |
| Fill Rate | `87.7%` (red) | gold_daily_performance |

### Row 2: Trend Analysis (2 Columns)

**Left: Daily Lost Sales**
- Line chart showing last 30 days
- Baseline ~$27K/day, spike to $140K+ starting Mar 1
- Anomaly period highlighted

**Right: Stockouts by Category**
- Bar chart: Dairy, Produce, Bakery, Frozen, Beverages
- Dairy dramatically higher than others

### Row 3: Investigation Details (2 Columns)

**Left: Stockouts by Region**
- Table: Region, Store Count, Stockout Rate, Lost Sales
- Metro East at top with $2.8M lost sales

**Right: Forecast Accuracy by Region**
- Bar chart showing MAPE by region
- Metro East showing 75%+ error vs 15% for others

### Row 4: Store Details (Full Width)

**Store Performance Grid**
- Table: Store ID, Region, Stockout Rate, Lost Sales, Fill Rate
- 23 Metro East stores highlighted in red
- Sortable by any metric

---

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7/30/90 days | Last 30 days |
| Region | All, Metro East, Metro West, Suburbs | All |
| Category | All, Dairy, Produce, Bakery, etc. | All |
| Store Type | All, Urban, Suburban, Rural | All |

---

## Key Visual Story

The dashboard must show:
1. **Anomaly**: $4.2M lost sales vs $800K baseline (5x spike)
2. **Region**: Metro East is the hotspot
3. **Category**: Dairy products most affected
4. **Forecast**: 75%+ error for affected stores

---

## Validation

| Test | Expected |
|------|----------|
| Open dashboard | Stockout spike immediately visible |
| Filter to Metro East | 23 stores dominate |
| Drill into Dairy | Demand spike vs forecast visible |
