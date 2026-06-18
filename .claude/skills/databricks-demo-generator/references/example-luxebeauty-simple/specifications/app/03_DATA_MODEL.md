# Data Model

## Two stores

- **Delta tables** (`gold_*` written by the synth script in `01-lakeflow.md`) — lakehouse source of truth, read-only from the app. SQL Warehouse queries + the agent's Genie tool read here.
- **Lakebase Postgres** — OLTP write surface. Chat state + operational mirror of the Delta subset the operator needs.

## Lakebase schema (`app.*`)

### Chat state (reusable — keep as-is across demos)

| Table | Key fields |
|---|---|
| `conversations` | id, userEmail, title, kind (`demo_dock` / `default`), timestamps |
| `messages` | conversationId, role, content, position, traceId (MLflow), thinking (JSONB — tool calls + reasoning for reload-safe history), error |
| `feedback` | messageId, value (`up` / `down`), rationale, traceId, mlflowAssessmentId |

### Delta mirror (LuxeBeauty-specific — replace per demo)

| Table | Source | Key fields |
|---|---|---|
| `customers` | `raw_customers` | id, email, name, region, **country**, loyaltyTier (the simple demo has no `gold_customers` — it pulls customer attributes directly from `raw_customers`, scoped to customers who appear in the returns table) |
| `returns` | `gold_returns` | id, orderId, customerId, refundAmountUsd, returnReason, returnReasonText, productName, lotId, facility, region, status (`pending` / `approved` / `rejected` / `escalated`), **couponPctApplied** (int — recorded when the agent's bulk tool runs; null until then; always `10` for the affected-lot rows after approval), **emails** (append-only JSONB array), **aiAuditTrail** (append-only JSONB array) |

> The Operations country panel reads `country` via JOIN against `customers` at query time (`/api/returns/by-country`), so `country` doesn't need to live on the `returns` row.

The two append-only arrays on `returns` make each row a standalone timeline — the agent's bulk tool appends email + audit per row in one atomic UPDATE. The Operations Activity tab renders from one row read.

## Delta → Lakebase sync

> **Talking-track vs. build:** in production this is **Lakebase Synced Tables** — managed, continuous Delta → Lakebase replication with the same UC governance. That's what we sell. For the demo build we keep it simple: a manual one-shot sync at boot, code we can show, no extra resource to provision. Same outcome on screen.

1. If mirror tables empty → pull via Databricks SQL Statements API (customers with returns + their country; all returns denormalized including the joined country / product / lot / facility — exactly the shape the Operations queue + drawer need).
2. Chunked inserts (~2000/batch), idempotent (skip on conflict).
3. **"Reset demo" button** → clean slate: truncate + re-sync. **All agent writes are wiped** — status flips back to `pending`, `emails[]` + `aiAuditTrail[]` + `couponPctApplied` are cleared. Between presentations Claire wants the queue to look untouched.

Source tables come from `config/app.json` `data.tables` (maps logical names → Delta table names, used by the sync + analytics queries).

## Lakebase provisioning

1. Create a Lakebase Postgres project + database in the workspace.
2. Wire into `app.yaml` → the Lakebase plugin resolves host + credentials at runtime.
3. Auth: SDK chain (CLI profile dev, OBO prod). `databricks apps run-local` injects env vars from the bound resource.
4. Schema: Drizzle ORM, migrations from `server/db/schema.ts`, auto-applied on boot.
