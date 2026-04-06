# Dashboard Creation

> **Before starting**: Check if you have a relevant skill available and read it for best practices.

## Task

Create an AI/BI dashboard that shows daily operations metrics.

**Important**: This is a normal operational dashboard, not an "investigation" dashboard. The returns spike should appear naturally alongside other metrics - that's what triggers the persona's question.

---

## Local Dashboard File

Save as `{workspace_folder}/dashboard.json` for easier editing and updates.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `LuxeBeauty Operations` |
| **Catalog/Schema** | As defined in 00-demo-overview.md |
| **Parent Path** | The workspace folder defined in 00-demo-overview.md |

---

## Important Formatting Rules

**Currency formatting**: All revenue/monetary widgets MUST display values in **$ USD format** (e.g., "$3.8M", "$180K", not "3800000" or "180000"). Configure number formatting to show currency symbol.

---

## The Visual Story

The dashboard must tell a story at a glance:
- **Everything looks normal** (revenue steady, orders steady)
- **One thing stands out** (returns are way up)

This visual contrast is what makes the persona ask "Why do I have so many returns?"

**Critical**: The spike must be immediately obvious - not subtle. If someone has to study the dashboard to notice something is wrong, the demo fails.

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HEADER: LuxeBeauty Operations                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  GLOBAL FILTERS:                                                            │
│  • Date Range filter (applies to all temporal charts)                       │
│  • Region filter (US, EU, APAC)                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  KPI CARDS (4 counters) - FIXED time window (e.g., last 30 days)            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │Monthly Rev.  │  │Monthly Orders│  │Monthly Items │  │Monthly Returns│   │
│  │ ~$3.8M       │  │ ~924         │  │ ~1,450       │  │ ~$180K ← SPIKE│   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘│
├─────────────────────────────────────────────────────────────────────────────┤
│  DAILY RETURNS TREND (full width) - Line/Area chart - THE KEY CHART         │
│  Shows returns $ over time with clear spike in recent days                  │
│  *** SPIKE MUST BE IMMEDIATELY OBVIOUS - DO NOT MIX WITH REVENUE ***        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐                        │
│  │ Daily Revenue Trend  │  │ Revenue by Category  │                        │
│  │ (Bar/Line Chart)     │  │ (Pie Chart)          │                        │
│  └──────────────────────┘  └──────────────────────┘                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  TOP PRODUCTS TABLE (full width)                                            │
│  Product | Category | Units | Revenue | Returns | Return Rate               │
│  Shows 3 Skincare products with ~30% return rate standing out              │
├─────────────────────────────────────────────────────────────────────────────┤
│  GENIE SPACE (embedded) - "Ask a question about this data"                  │
│  Allows natural language queries like "Why do I have so many returns?"      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key design choice**: Returns trend is a **dedicated chart** - do NOT combine with revenue in a combo chart. Mixing different scales makes the spike less obvious.

---

## Date Handling

The data is generated with dynamic dates relative to NOW (see 01-data-generation.md), so the demo stays current. The spike is always ~5-6 weeks ago.

**Default date filter**: Set the default to "This Year" so the dashboard shows relevant, current data when first opened. Users can adjust the range to focus on specific periods.

---

## Components

### Filters

Add **global filters** for exploring the data. Filters let users drill down by time period, region, or product category.

**IMPORTANT**: For a filter to affect a widget, the widget's underlying data must include that filter column. This is why the gold layer tables include region and category dimensions (see 03-pipelines.md). If your KPIs don't respond to the region filter, check that the underlying table has a `region` column.

**1. Date Range Filter (REQUIRED)**
- **Field**: date (from gold_daily_* tables)
- **Type**: Date range picker
- **Default**: "This Year" - ensures the dashboard shows current, relevant data
- **Applies to**: All widgets that have a date column

**2. Region Filter**
- **Field**: region (from the gold tables)
- **Values**: US, EU, APAC (3 values - good for filters)
- **Type**: Multi-select dropdown
- **Applies to**: All widgets - KPIs, charts, and tables should all respond to this filter

**3. Category Filter**
- **Field**: category (from the gold tables)
- **Values**: Skincare, Makeup, Haircare
- **Type**: Multi-select dropdown
- **Applies to**: All widgets - lets users focus on a specific product line

**Filter behavior**: All filters should affect ALL widgets (KPIs, charts, table). Filters combine.

---

### KPI Cards

| KPI | Source | Format | Notes |
|-----|--------|--------|-------|
| Total Revenue | gold_daily_summary | **$ USD** | Normal - provides contrast |
| Total Orders | gold_daily_summary | Number | Normal - provides contrast |
| **Total Returns** | gold_daily_summary | **$ USD** | **Shows the spike** |

KPIs respond to all filters and MUST display $ currency symbol.

---

### Daily Returns Trend (THE KEY CHART)

| Element | Configuration |
|---------|---------------|
| **Chart type** | Line or Area (NOT combo with revenue) |
| **X-Axis** | date (temporal, daily) |
| **Y-Axis** | total_returns_usd |
| **Source** | gold_daily_summary |

**CRITICAL**: Dedicated returns chart only - do NOT mix with revenue. The spike must be immediately obvious.

---

### Revenue by Category (Pie Chart)

| Element | Configuration |
|---------|---------------|
| **Chart type** | Pie |
| **Angle** | Revenue amount |
| **Color** | Category (3-5 max) |
| **Source** | gold_daily_summary aggregated by category |

Shows Skincare is a significant revenue contributor.

---

### Daily Revenue Trend (Bar/Line Chart)

| Element | Configuration |
|---------|---------------|
| **Chart type** | Bar or Line |
| **X-Axis** | date (temporal, daily) |
| **Y-Axis** | total_revenue ($ USD) |
| **Source** | gold_daily_summary |

Shows revenue is steady while returns spike - reinforces the contrast.

---

### Top Products Table

| Column | Source |
|--------|--------|
| Product Name | gold_returns_by_lot |
| Category | gold_returns_by_lot |
| Units Sold | aggregated |
| Revenue | aggregated |
| Returns | aggregated |
| Return Rate | calculated (returns/units) |

Limit to top 10-15 products. Affected SKUs should show ~30% return rate vs ~8% normal. Consider conditional formatting for rates > 20%.

---

### Genie Space Integration

Embed the Genie Space (from 04-genie-space.md) into the dashboard. Use the Genie Space ID from `resources.json`. This lets the persona ask "Why do I have so many returns?" directly from the dashboard.

---

## Resource Tracking

After creating the dashboard, **add the dashboard ID to `resources.json`**:
```json
{
  "dashboard_id": "<the-dashboard-id>"
}
```

---

## Validation

After creating the dashboard, verify the story is visually obvious:

| Check | What to Look For |
|-------|------------------|
| **Spike is obvious** | Can you immediately see something is wrong without studying the data? |
| **Returns trend chart** | Clear spike ~5-6 weeks ago vs flat baseline before - dedicated chart, NOT mixed with revenue |
| **Currency formatting** | All monetary values display with $ symbol (e.g., "$3.8M", "$180K") |
| **Filters work everywhere** | Region filter affects ALL widgets (KPIs, charts, table). Same for Category filter. |
| **Default date works** | Dashboard opens with "This Year" selected, showing current relevant data |
| **Products table** | The affected lot shows high return rates (~30% vs ~8% for others) |
| **Contrast works** | Revenue chart shows steady business while returns chart shows spike |

**5-second test**: Someone should immediately say "something is wrong with returns" without explanation. If not, adjust the visualization.
