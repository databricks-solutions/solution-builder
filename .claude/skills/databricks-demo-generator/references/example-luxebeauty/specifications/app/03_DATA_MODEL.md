# Data Model

## Two stores

- **Delta tables** — lakehouse source of truth, read-only from app. SQL Warehouse queries + MAS read here.
- **Lakebase Postgres** — OLTP write surface. Chat state + operational mirror of the Delta subset the operator needs.

## Lakebase schema (`app.*`)

### Chat state (reusable — keep as-is across demos)

| Table | Key fields |
|-------|-----------|
| `conversations` | id, userEmail, title, kind (`demo_dock` / `default`), timestamps |
| `messages` | conversationId, role, content, position, traceId (MLflow), thinking (JSONB — tool calls + reasoning for reload-safe history), error |
| `feedback` | messageId, value (`up`/`down`), rationale, traceId, mlflowAssessmentId |

### Delta mirror (LuxeBeauty-specific — replace per demo)

| Table | Source | Key fields |
|-------|--------|-----------|
| `customers` | `bronze_customers` | id, email, name, region, loyaltyTier — subset with returns only |
| `orders` | `bronze_orders` | id, customerId, orderDate, totalUsd, status |
| `returns` | `silver_returns` (denormalized with product + lot joins) | id, orderId, customerId, refundAmountUsd, returnReason, productName, lotId, facility, status (`pending`/`approved`/`rejected`/`escalated`), **emails** (append-only JSONB array), **aiAuditTrail** (append-only JSONB array) |

The two append-only arrays on `returns` make each row a standalone timeline — agent bulk tool appends email + audit per row in one atomic UPDATE. Operations Activity tab renders from one row read.

## Delta → Lakebase sync

> **Talking-track vs build:** in production this is **Lakebase Synced Tables** — managed, continuous Delta→Lakebase replication with the same UC governance. That's what we sell ("the Gold tables your pipeline produces are synced into Lakebase"). For the demo build we keep it simple: a manual one-shot sync at boot, code we can show, no extra resource to provision. Same outcome on screen.

1. If mirror tables empty → pull via Databricks SQL Statements API (customers with returns, their orders, all returns denormalized)
2. Chunked inserts (2000/batch), idempotent (skip on conflict)
3. "Reset demo" button → truncate + re-sync

Source tables from `config/app.json` `data.tables` (maps logical names → Delta table names, used by sync + analytics queries).

## Lakebase provisioning

1. Create Lakebase Postgres project + database in workspace
2. Wire into `app.yaml` → Lakebase plugin resolves host + credentials at runtime
3. Auth: SDK chain (CLI profile dev, OBO prod). `databricks apps run-local` injects env vars from bound resource
4. Schema: Drizzle ORM, migrations from `server/db/schema.ts`, auto-applied on boot
