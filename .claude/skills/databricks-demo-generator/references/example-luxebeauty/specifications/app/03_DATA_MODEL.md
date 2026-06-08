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
| `customers` | `raw_customers` | id, email, firstName, lastName, region, **country**, **city**, **customerLat**, **customerLng** (DOUBLE PRECISION — city-anchor + ~5km jitter; drives the Operations bubble map), loyaltyTier, **premiumStatus** (`'premium'`/`'not_premium'`/`NULL` — CS hand-tags, pass-through; UI uses it to distinguish "CS-tagged" from "model-found" premiums), registrationDate |
| `orders` | `silver_orders` | id, customerId, orderDate, region, totalUsd, status (order-level aggregate of line items — raw_orders is per-line, not syncable row-for-row) |
| `returns` | `silver_returns` (already denormalized in silver — `customer_id` lives on the row, no join needed in sync) | id, orderId, customerId, refundAmountUsd, returnReason, returnReasonText, **angerScore** (0–1 from `ai_classify`, pass-through; UI sorts by it), productName, lotId, facility, region, status (`pending`/`approved`/`rejected`/`escalated`), **couponPctApplied** (int — recorded when the agent's bulk tool runs; null until then), **emails** (append-only JSONB array), **aiAuditTrail** (append-only JSONB array) |
| `customerPremium` | `gold_customer_premium_predictions` (written by the ML notebook in `03-ml-premium.md`) | customerId (PK), premiumProb (double), finalTier (`'premium'`/`'standard'`), premiumStatusLabeled (`'premium'`/`'not_premium'`/`NULL` — pass-through for UI), predictedAt (timestamp) |

The two append-only arrays on `returns` make each row a standalone timeline — agent bulk tool appends email + audit per row in one atomic UPDATE. Operations Activity tab renders from one row read.

The `customerPremium` table is **read-only from the app** — it's a copy of the model's predictions table, kept in Lakebase so the agent's lookups (`find_lot_premium_breakdown`, the JOIN inside `process_return_batch`) are sub-second. Refreshed on demo reset (re-pulled from Delta). The model itself lives in Unity Catalog (`{catalog}.{schema}.customer_premium_classifier`, `@prod` alias) — the app never calls the model directly. The `premiumStatusLabeled` pass-through lets the UI distinguish *"CS already tagged this customer"* from *"the model found this hidden premium"* without a second query.

## Delta → Lakebase sync

> **Talking-track vs build:** in production this is **Lakebase Synced Tables** — managed, continuous Delta→Lakebase replication with the same UC governance. That's what we sell ("the Gold tables your pipeline produces are synced into Lakebase"). For the demo build we keep it simple: a manual one-shot sync at boot, code we can show, no extra resource to provision. Same outcome on screen.

1. If mirror tables empty → pull via Databricks SQL Statements API (customers with returns + their `premium_status` + `country`, their orders, all returns denormalized including `anger_score` and `country`, **and `gold_customer_premium_predictions` for the same customer set**)
2. Chunked inserts (2000/batch), idempotent (skip on conflict)
3. "Reset demo" button → clean slate: truncate + re-sync (includes the predictions table). **All agent writes are wiped** — status flips back to `pending`, `emails[]` + `aiAuditTrail[]` + `coupon_pct_applied` are cleared. This is intentional: between presentations Claire wants the queue to look untouched.

Source tables from `config/app.json` `data.tables` (maps logical names → Delta table names, used by sync + analytics queries).

## Lakebase provisioning

1. Create Lakebase Postgres project + database in workspace
2. Wire into `app.yaml` → Lakebase plugin resolves host + credentials at runtime
3. Auth: SDK chain (CLI profile dev, OBO prod). `databricks apps run-local` injects env vars from bound resource
4. Schema: Drizzle ORM, migrations from `server/db/schema.ts`, auto-applied on boot
