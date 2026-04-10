---
name: Dashboards
category: ai-bi
disabled: false
---

# AI/BI Dashboards

**AI-assisted dashboards** on governed data - build and share interactive views without extra BI tooling or per-seat fees.

## Pain

Adding "one more cut" of a metric means a Jira ticket to BI team and 2-3 week wait. By the time the dashboard lands, the window to act is gone. BI licenses are rationed; many users only see screenshots.

## Key Features

- **No per-seat licensing** - everyone on Databricks can view/build
- **AI-assisted creation** - describe what you want, get a chart
- **Live on lakehouse** - always fresh, governed data
- **Embedded Genie** - drill down with natural language

## Position

Start with 5-second test: show dashboard where anomaly is obvious at a glance. "We replaced separate BI licenses; everyone can see and build dashboards."

## Demo Tips

- **The visual anchor of Act 1** - dashboard shows the baseline and the anomaly at a glance
- Apply the **5-second test**: can someone see the problem within 5 seconds of looking?
- Use business metrics in $ (revenue, cost, margin) not technical counts
- Design the layout to tell a story: KPIs at top, trend in middle, detail at bottom
- The anomaly should be visually obvious (red, spike, drop) without explanation
- Filters should allow drilling down to the problem area
- Dashboard is where the "investigation" starts before moving to Genie

## Design Principles

1. **KPIs at the top** - the numbers that matter (revenue, customers, costs)
2. **Trend visualization** - time series showing the anomaly
3. **Drill-down capability** - filters to narrow to the problem
4. **Business language** - no technical jargon, $ amounts

## URL

https://www.databricks.com/product/business-intelligence
