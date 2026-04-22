# Operations Page

OLTP write surface — Claire works the returns backlog, agent actions land in real time.

## Layout

**Header:** "Work the returns backlog." / "Each return is a signal. Approve the refund, reject if invalid, or escalate to QA."

**"Ask the assistant" banner:** Sparkle icon card — "Something feels off — Ask the assistant about this spike." Opens dock with first scripted prompt.

**KPI cards (3 across):** Pending (neutral) | Approved (green) | Escalated to QA (amber). Count + dollar total each. Live update demo moment — counters tick when agent bulk-approves in chat.

**Returns table:** Filterable, sortable queue.
- Status tabs: All / Pending / Approved / Rejected / Escalated (pill toggle)
- Search: free-text across customer name, SKU, product, reason
- Lot filter chip: appears when filtered by lot (from Analytics drill-down), dismissible ✕
- Columns: Customer (name + tier badge + region) | Product (name + category + SKU) | Lot (clickable → filters) | Reason | Value ($) | Status (colored badge)
- Click row → detail drawer

**Detail drawer (right slide-over, ~60% width).** Header: status badge, lot ID, facility, product, customer + email + tier. Three tabs:

- **Return tab** — Detail grid (reason, refund amount, dates, region). Notes textarea. Approve (green) / Reject (neutral) / Escalate (amber) buttons. Click commits to Lakebase → row updates, drawer closes, KPIs refresh.

- **Customer tab** — Name, email, region, tier, registration date, recent orders.

- **Activity tab** — Merged timeline: emails sent + AI audit trail, sorted by timestamp. Icon + timestamp + description. Badge count updates live. Drawer auto-refreshes when agent writes.

## LuxeBeauty data

~1,500 pending returns from affected lot + ~23K normal. After agent: affected flip to "approved" with email record + audit trail.
