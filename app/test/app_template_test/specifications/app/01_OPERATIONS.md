# Operations Page

OLTP write surface — Claire works the returns backlog, agent actions land in real time.

## Layout

**Header:** "Work the returns backlog." / "Each return is a signal. Approve the refund, reject if invalid, or escalate to QA."

**"Ask the assistant" banner:** Sparkle icon card — "Something feels off — Ask the assistant about this spike." Opens dock with first scripted prompt.

**KPI cards (3 across):** Pending (neutral) | Approved (green) | Escalated to QA (amber). Count + dollar total each. Live update demo moment — counters tick when agent bulk-approves in chat.

**Country panel** (between KPIs and the table): horizontal bars per country showing affected-customer counts. Width is proportional to count; right side shows `count · refund $`. Click a country to add a `Country: XX ✕` filter chip and narrow the queue. Reads `/api/returns/by-country?status=...&lot=...` so it always reflects the same scope as the table. Auto-refreshes on agent writes via `dataMutated`. Country names + flag emoji decorated client-side from ISO-2 codes — no map library, no extra dep. The map story is geographic only; the premium tiering lives in the chat (the agent surfaces the 18/49 split there).

**Returns table:** Filterable, sortable queue.
- Status tabs: All / Pending / Approved / Rejected / Escalated (pill toggle)
- Search: free-text across customer name, SKU, product, reason
- Lot filter chip: appears when filtered by lot (from Analytics drill-down), dismissible ✕
- Tier filter chip: appears when filtered by `final_tier=premium` or `=standard` (from agent's chat reply or activity feed link), dismissible ✕
- Sortable column headers (clickable, with ↕ / ↓ indicator): **Anger score** (`silver_returns.anger_score`, 0–1 — the `ai_classify` showcase moment), **Value** ($). Default sort is `recent` (return_date DESC). All sort/filter state is URL-synced so deep links + back/forward work.
- Columns: Customer (name + loyalty-tier badge + **premium-tier badge** + region) | Product (name + category + SKU) | Lot (clickable → filters) | Reason | **Anger** (mini 0–1 bar, color-graded red→grey) | Value ($) | **Offer** (after approval: shows the `coupon_pct_applied` as a colored badge — 20% in primary, 5% in muted) | Status (colored badge)
- Premium-tier badge variants: `premium · CS-tagged` (solid primary), `premium · model-found` (primary outline, "hidden" callout on hover), `standard` (muted)
- Click row → detail drawer

**Detail drawer (right slide-over, ~60% width).** Header: status badge, lot ID, facility, product, customer + email + tier. Three tabs:

- **Return tab** — Detail grid (reason, refund amount, dates, region, **anger score** as a small 0–1 indicator). Notes textarea. Approve (green) / Reject (neutral) / Escalate (amber) buttons. Click commits to Lakebase → row updates, drawer closes, KPIs refresh.

- **Customer tab** — Name, email, region, country, loyalty tier, registration date, recent orders, **Premium panel** (small card): `premium_prob` shown as a 0–100% horizontal bar + `final_tier` pill (`premium · CS-tagged` solid / `premium · hidden (model)` outlined / `standard` muted). Caption: *"Classified by `customer_premium_classifier@prod`, scored {predicted_at}."* If `premium_status_labeled = 'premium'`, show "CS tagged on {tag_date}" instead of model output. If the return has already been processed by the agent, also show the offer applied (`coupon_pct_applied` %).

- **Activity tab** — Merged timeline: emails sent + AI audit trail, sorted by timestamp. Icon + timestamp + description. Badge count updates live. Drawer auto-refreshes when agent writes.

## LuxeBeauty data

~1,500 pending returns from affected lot + ~23K normal. After agent: affected flip to "approved" with email record + audit trail. **Per-row `coupon_pct_applied`** records what the model-driven tier picked (20 for `final_tier='premium'`, 5 for `'standard'`), so the queue tells the story even after the chat conversation is closed. The Anger column makes the `ai_classify` work visible — affected-lot rows skew high (0.8+), benign returns sit near 0 — and sorting by anger lands the most upset customer at the top.
