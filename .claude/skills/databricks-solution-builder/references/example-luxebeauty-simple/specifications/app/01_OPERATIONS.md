# Operations Page

OLTP write surface — Claire works the returns backlog, agent actions land in real time.

## Layout

**Header:** *"Work the returns backlog."* / *"Each return is a signal. Approve the refund, reject if invalid, or escalate to QA."*

**"Ask the assistant" banner:** Sparkle icon card — *"Something feels off — ask the assistant about this spike."* Opens the dock with the first scripted prompt.

**KPI cards (3 across):** Pending (neutral) | Approved (green) | Escalated to QA (amber). Count + dollar total each. Live update demo moment — counters tick when the agent bulk-approves the affected lot in chat.

**Country panel** (between KPIs and the table): horizontal bars per country showing affected-customer counts for the current filter scope. Width is proportional to count; right side shows `count · refund $`. Click a country to add a `Country: XX ✕` filter chip and narrow the queue. Reads `/api/returns/by-country?status=...&lot=...` so it always reflects the same scope as the table. Auto-refreshes on agent writes via `dataMutated`. Country names + flag emoji decorated client-side from ISO-2 codes — no map library, no extra dep. The bars surface *"where the affected customers are"* — France first, then Italy / GB / DE.

**Returns table:** Filterable, sortable queue.

- **Status tabs**: All / Pending / Approved / Rejected / Escalated (pill toggle).
- **Search**: free-text across customer name, SKU, product, reason.
- **Lot filter chip**: appears when filtered by lot (from Analytics drill-down or the country panel), dismissible ✕.
- **Sortable column headers** (clickable, with ↕ / ↓ indicator): **Value** ($), **Return date** (default DESC). All sort/filter state is URL-synced so deep links + back/forward work.
- **Columns**: Customer (name + loyalty-tier badge + region) | Product (name + category + SKU) | Lot (clickable → filters) | Reason | Value ($) | **Offer** (after approval: shows `coupon_pct_applied` as a colored primary-color badge — flat `10%` on each affected-lot row) | Status (colored badge).
- Click a row → detail drawer.

**Detail drawer (right slide-over, ~60% width).** Header: status badge, lot ID, facility, product, customer + email + loyalty tier. Two tabs:

- **Return tab** — Detail grid (reason, refund amount, dates, region). Notes textarea. Approve (green) / Reject (neutral) / Escalate (amber) buttons. Click commits to Lakebase → row updates, drawer closes, KPIs refresh.

- **Activity tab** — Merged timeline: emails sent + AI audit trail, sorted by timestamp. Icon + timestamp + description. Badge count updates live. Drawer auto-refreshes when the agent writes.

## LuxeBeauty data

~1,500 pending returns from the affected lot + ~23K already-processed historical returns. After the agent runs the bulk action, affected rows flip to *approved* with an email record + audit trail. **Per-row `coupon_pct_applied = 10`** is recorded so the queue still tells the story even after the conversation is closed (the `10%` badge stays on each row).
