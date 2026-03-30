# Dashboard Creation

## Task

Create an AI/BI dashboard that shows weekly operations metrics.

**Important**: This is a normal operational dashboard, not an "investigation" dashboard. The returns spike should appear naturally alongside other metrics - that's what triggers the persona's question.

---

## Dashboard Configuration

| Setting | Value |
|---------|-------|
| **Dashboard Name** | `LuxeBeauty Weekly Operations` |
| **Catalog/Schema** | As defined in 00-demo-overview.md |
| **Parent Path** | The workspace folder defined in 00-demo-overview.md |

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
│  HEADER: LuxeBeauty Weekly Operations                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  FILTERS: Region filter (US, EU, APAC) - low cardinality for quick slicing  │
├─────────────────────────────────────────────────────────────────────────────┤
│  KPI CARDS (4 counters)                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│  │ Revenue  │  │ Orders   │  │ Items    │  │ Returns  │ ← THE SPIKE        │
│  │ ~$3.8M   │  │ ~924     │  │ ~1,450   │  │ ~$180K   │                    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  WEEKLY TREND (full width) - Combo chart                                    │
│  Revenue bars + Returns line → spike visible in most recent week            │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐                        │
│  │ Revenue by Category  │  │ Daily Returns        │                        │
│  │ (Pie Chart)          │  │ (Bar Chart)          │                        │
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

---

## Date Handling

The data uses fixed dates (Feb-Mar 2025 per the story). Dashboard queries should:
- Reference the spike week directly (week of March 17, 2025) for KPIs
- Show ~8 weeks of history for trend charts
- NOT use `CURRENT_DATE()` - use fixed date ranges so the spike is always visible

---

## Components

### Filters

Add a Region filter to allow slicing the data by geography:
- **Field**: region (from the gold tables)
- **Values**: US, EU, APAC (3 values - good for filters)
- **Type**: Multi-select dropdown

The filter should apply to all dashboard components. The returns spike is visible across all regions, but filtering lets the persona drill in if needed.

---

### KPI Cards

Four counter widgets showing the spike week's metrics.

| KPI | Source | Expected Value | Notes |
|-----|--------|----------------|-------|
| Weekly Revenue | gold_weekly_summary | ~$3.8M | Normal - provides contrast |
| Weekly Orders | gold_weekly_summary or silver_orders | ~924 | Normal - provides contrast |
| Items Sold | gold_weekly_summary | ~1,450 | Normal - provides contrast |
| **Weekly Returns** | gold_weekly_summary | **~$180K** | **THE SPIKE - 3x normal** |

**Visual emphasis**: The Returns KPI should stand out. Consider:
- Red/warning color if the value exceeds a threshold
- Placing it last so the eye lands on it after seeing "normal" values

---

### Weekly Trend Chart (Combo)

A combo chart showing 8 weeks of data - this provides the historical context that makes the spike obvious.

| Element | Configuration |
|---------|---------------|
| **Chart type** | Combo (bar + line) |
| **X-Axis** | week_start (temporal) |
| **Bars (primary)** | total_revenue - shows steady business |
| **Line (secondary)** | total_returns_usd - shows the spike |
| **Source** | gold_weekly_summary |

**Why combo**: Revenue and returns have different scales. Bars for revenue show "business as usual". The line for returns shows the spike clearly against historical trend.

**Why it matters**: The spike in the returns line should be visually obvious in the most recent week - a clear uptick compared to the flat historical trend.

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

### Daily Returns This Week (Bar Chart)

A bar chart showing daily returns for the spike week.

| Element | Configuration |
|---------|---------------|
| **Chart type** | Bar |
| **X-Axis** | return_date (temporal, daily) |
| **Y-Axis** | return amount or count |
| **Source** | gold_daily_returns |
| **Time range** | Spike week only |

**Why it matters**: Shows returns are consistently high throughout the week - not a one-day anomaly.

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

## Validation

After creating the dashboard, verify the story is visually obvious:

| Check | What to Look For |
|-------|------------------|
| **Spike is obvious** | Can you immediately see something is wrong without studying the data? |
| **Returns KPI** | Shows ~$180K - significantly higher than expected ~$60K |
| **Trend chart** | Clear spike in returns line for most recent week vs flat history |
| **Products table** | SKU-1001, SKU-1002, SKU-1003 visibly have higher return rates (~30% vs ~8%) |
| **Contrast works** | Other metrics (revenue, orders) look normal, making returns stand out |

**The 5-second test**: Show the dashboard to someone for 5 seconds. They should be able to say "something is wrong with returns" without any explanation. If not, the visualization needs adjustment.
