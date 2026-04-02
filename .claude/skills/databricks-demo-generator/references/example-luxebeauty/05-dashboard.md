# Dashboard Creation

> **Before starting**: Check if you have a relevant skill available and read it for best practices.

## Task

Create an AI/BI dashboard that shows daily operations metrics.

**Important**: This is a normal operational dashboard, not an "investigation" dashboard. The returns spike should appear naturally alongside other metrics - that's what triggers the persona's question.

---

## Local Dashboard File

Save the dashboard JSON spec locally as `dashboard.json` in the workspace folder. This makes it easier to edit and update the dashboard later.

```
{workspace_folder}/
└── dashboard.json    # Full dashboard JSON spec
```

After creating the dashboard via API, export the JSON and save it locally. When making updates, edit the local file and re-upload.

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

**Filter behavior**:
- When a user selects "EU" in the region filter, ALL widgets should update to show only EU data
- When a user selects "Skincare" in category, ALL widgets should show only Skincare products
- Filters combine: selecting "EU" + "Skincare" shows EU Skincare data across all widgets

---

### KPI Cards

Three counter widgets showing key metrics for the selected period.

**Display hint**: Add a description like "For the selected period" so users understand the KPIs respond to filters.

| KPI | Source | Format | Notes |
|-----|--------|--------|-------|
| Total Revenue | gold_daily_summary | **$ USD** | Normal - provides contrast |
| Total Orders | gold_daily_summary | Number | Normal - provides contrast |
| **Total Returns** | gold_daily_summary | **$ USD** | **Shows the spike when filtered to recent data** |

**Formatting**: Revenue and Returns KPIs MUST display with $ currency symbol (e.g., "$3.8M" not "3800000").

**Filter behavior**: KPIs respond to all filters (date, region, category). When a user filters to "This Year" and "Skincare", the KPIs show totals for Skincare products this year.

---

### Daily Returns Trend (THE KEY CHART)

A dedicated line/area chart showing **only returns** over time. This is the most important visualization - the spike must be immediately obvious.

| Element | Configuration |
|---------|---------------|
| **Chart type** | Line or Area (NOT combo with revenue) |
| **X-Axis** | date (temporal, daily) |
| **Y-Axis** | total_returns_usd |
| **Source** | gold_daily_returns (aggregated by date) |
| **Time range** | Controlled by global date filter |

**CRITICAL**: Do NOT combine returns with revenue in the same chart. Different scales make the spike less visible. Returns deserve their own dedicated chart.

**Why it matters**: When someone looks at this chart, they should immediately see "something went wrong around March 17" - a clear spike compared to the flat baseline before it.

---

### Revenue by Category (Pie Chart)

A pie chart showing revenue breakdown by product category.

| Element | Configuration |
|---------|---------------|
| **Chart type** | Pie |
| **Angle** | Revenue amount |
| **Color** | Category (3-5 categories max for readability) |
| **Source** | gold_daily_orders aggregated by category |
| **Time range** | Spike week |

**Why it matters**: Shows Skincare is a significant revenue contributor - context for why returns in that category matter.

---

### Daily Revenue Trend (Bar/Line Chart)

A chart showing daily revenue over time - provides context that business is "normal" while returns spike.

| Element | Configuration |
|---------|---------------|
| **Chart type** | Bar or Line |
| **X-Axis** | date (temporal, daily) |
| **Y-Axis** | total_revenue (format as $ USD) |
| **Source** | gold_daily_orders (aggregated by date) |
| **Time range** | Controlled by global date filter |

**Why it matters**: Shows revenue is steady while returns spike - this contrast reinforces that something is specifically wrong with returns, not overall business.

---

### Top Products Table

A table showing products with their return metrics. This is where the affected products become visible.

| Column | Source | Notes |
|--------|--------|-------|
| Product Name | products/order_items | Human-readable name |
| Category | products | Skincare, Makeup, etc. |
| Units Sold | order_items aggregated | Count |
| Revenue | order_items aggregated | Sum of line totals |
| Returns | returns aggregated | Sum of refund amounts |
| Return Rate | Calculated | returns / units as % |

**Cardinality**: Limit to top 10-15 products by revenue. Too many rows make it hard to spot the problem products.

**Why it matters**: The 3 affected products (SKU-1001, SKU-1002, SKU-1003) should show ~30% return rates, while others show ~8%. This contrast draws attention.

**Visual hint**: Consider conditional formatting to highlight return rates > 20% in red/warning color.

---

### Genie Space Integration

Embed the Genie Space (created in 04-genie-space.md) into the dashboard. This allows the persona to ask natural language questions directly from the dashboard when they see the spike.

**Why it matters**: When Claire sees the returns spike and asks "Why do I have so many returns?", she can type that question directly in the dashboard. The embedded Genie provides the analysis without leaving the dashboard context.

**Configuration**:
- Use the Genie Space ID from the previous step
- Position it prominently - either as a dedicated section or accessible via a chat interface

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

**The 5-second test**: Show the dashboard to someone for 5 seconds. They should be able to say "something is wrong with returns" without any explanation. If not, the visualization needs adjustment.

**Filter test**: Select a single region (e.g., "US") - verify ALL widgets update to show only US data. If some widgets don't change, the underlying data is missing the region column.
