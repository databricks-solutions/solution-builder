# UC — Business semantics + governance (built live via Genie Code)

> **Workshop contract.** The "Business semantics" and "Governance" pages build these live with
> Genie Code on top of the gold tables from `01-lakeflow.md`.

---

## A. Metric view — `mv_returns` (Business semantics page)

Over `gold_daily_summary`.

- **Dimensions:** `date` (from `summary_date`), `region`, `category`, `source`
  (`CASE WHEN is_bad_lot THEN 'Affected lot' ELSE 'Everyday' END`).
- **Measures:** `total_revenue` = `SUM(revenue_usd)`, `total_refunds` = `SUM(returns_usd)`,
  `order_count` = `SUM(order_count)`, `return_count` = `SUM(return_count)`,
  `return_rate` = `SUM(return_count) / NULLIF(SUM(order_count), 0)`,
  `refund_rate` = `SUM(returns_usd) / NULLIF(SUM(revenue_usd), 0)`.
- Genie is then pointed at `mv_returns` and prefers its measures over re-deriving rates.

**Discover:** apply the governed tag `luxebeauty_operations` to `gold_returns`,
`gold_daily_summary` and `mv_returns`; the SA publishes the domain in the Discover UI.

## B. ABAC (Governance page, optional)

- **Tag:** key `pii`, value `true`, on `gold_returns.customer_id`, `gold_returns.customer_lat`,
  `gold_returns.customer_lng`.
- **Ops group:** `luxe_ops` (create it if missing) sees raw values; everyone else is the analyst
  persona the SA creates.
- **Policies** (schema-level, tag-driven): one column mask that redacts `pii`-tagged columns
  `TO` everyone `EXCEPT` the ops group, and one row filter so analysts only see their own
  `region`. A mask and a row filter can't target the same column — keep `region` unmasked.
  Pattern (check it against the current Databricks ABAC docs before running):
  ```sql
  CREATE POLICY mask_pii ON SCHEMA {catalog}.{schema}
    COLUMN MASK redact_pii TO `account users` EXCEPT `luxe_ops`
    FOR TABLES MATCH COLUMNS has_tag_value('pii','true') AS col ON COLUMN col;
  ```
- **Propagation demo:** tag `silver_returns.city` as `pii` to show the existing policy picks it
  up, then untag it. Never tag `silver_production_lots.facility` — `Lyon-France` must stay
  readable for every persona.

## C. Data classification (Governance page, optional)

Accept only proposals that describe the data. Reject `customer_lat` / `customer_lng` as an SSN
type, `customer_id` as an address, and `facility` as personal data.
