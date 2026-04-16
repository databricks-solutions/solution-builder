---
name: Dashboards
category: ai-bi
disabled: false
buildable: true
---

# AI/BI Dashboards

**AI-assisted dashboards** on governed data — build and share interactive views without extra BI tooling or per-seat fees.

## Pain

Adding "one more cut" of a metric means a Jira ticket to BI team and 2-3 week wait. By the time the dashboard lands, the window to act is gone. BI licenses are rationed; many users only see screenshots.

## Key Features

- **No per-seat licensing** — everyone on Databricks can view/build
- **AI-assisted creation** — describe what you want, get a chart
- **Live on lakehouse** — always fresh, governed data
- **Embedded Genie** — drill down with natural language

## Position

Start with the 5-second test: show a dashboard where the anomaly is obvious at a glance. "We replaced separate BI licenses; everyone can see and build dashboards."

## Demo Tips

- **The visual anchor of Act 1** — the dashboard shows baseline and anomaly at a glance
- Apply the **5-second test**: can someone identify the problem within 5 seconds of looking?
- Use business metrics in $ (revenue, cost, margin) not technical counts
- The anomaly should be visually obvious (red, spike, drop) without explanation
- Dashboard is where the "investigation" starts before transitioning to Genie

## How It Works

- **Data tab + Canvas tab**: Write SQL queries (or reference tables) in the Data tab, then drag results onto the Canvas to build visuals
- **AI-assisted**: Describe what you want in natural language — get chart suggestions
- **Parameters**: Use `:parameter` syntax in queries for dynamic filtering
- **Embedded Genie**: Every dashboard has a Genie button — users can ask follow-up questions in natural language
- **No per-seat fees**: Anyone with Databricks access can view and create dashboards

## Design Principles

Organize widgets into four tiers on the 6-column grid (every row must fill exactly 6 columns):

1. **Filters** (top) — date range + 2-3 dimension filters. Orient the viewer.
2. **Counters** (row 2) — 3 KPI cards, w=2 each. Always show comparison vs. baseline — the delta catches the eye.
3. **Visualizations** (middle) — trend line + breakdown bar, w=3 each side-by-side. Spike in the rightmost 20% of the time axis. Bars sorted descending.
4. **Detail table** (bottom) — full-width (w=6). Drill-down rows with filter columns for cross-filtering.

## Anomaly Visibility

- Counters: show "vs baseline" or "vs prior period" — absolute numbers alone mean nothing
- Trend line: include 6-12 months of baseline so the spike has contrast
- Breakdown bar: sort descending so the dominant category sits at top
- Default filters: MUST show the anomalous period, not hide it

## URL

https://www.databricks.com/product/business-intelligence
