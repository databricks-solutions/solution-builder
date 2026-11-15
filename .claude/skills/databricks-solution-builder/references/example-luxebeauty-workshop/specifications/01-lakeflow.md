# Lakeflow — Raw data (in a Volume) + the SDP the workshop builds live

> **Workshop contract.** `data_generation/generate_data.py` lands **6 raw parquet datasets
> into a UC Volume** (`/Volumes/{catalog}/{schema}/raw_data/<dataset>/`) — the bronze landing
> zone. The SA then builds **silver → gold** live with Genie Code (the "Build the pipeline" page
> of `workshop.html`), converging on the names below. **No bronze pass-through** — silver reads
> the raw files directly with `read_files()`. **No SDP SQL is shipped** — Genie Code writes it;
> this spec says *what* to build. Story and key numbers: `README.md`.

---

## Story anchors (the data rules)

**Affected products** (verbatim): `SKU-1001` Hydrating Serum 30ml (Skincare/Serums),
`SKU-1002` Vitamin C Cream 50ml (Skincare/Creams), `SKU-1003` HA Moisture Boost 15ml
(Skincare/Serums).

**Affected lot**: `LOT-{YYYY}-{MMDD}`, facility `Lyon-France`, status `released`,
`units_produced` 2,500 on each of its 3 SKU rows. The id follows the run date, so never
hard-code it — find it with `incident_summary IS NOT NULL`. **One lot carries the incident
text; every other lot is `NULL`.** The returns show the symptom, the lot holds the explanation.

**Incident text** (verbatim shape of the affected lot's `incident_summary`):
> *"Production Incident Report PIR-{YYYY}-{MMDD}. Equipment: Homogenizer Unit HMG-03 at Lyon.
> Issue: pressure fluctuations (2.1–2.8 bar vs normal 2.4–2.6 bar) during emulsification.
> Cause: calibration drift in the pressure regulation valve. Affected SKUs: SKU-1001,
> SKU-1002, SKU-1003 (~7,500 units). QC assessment: 'Minor texture variations … cosmetic only;
> safety and efficacy unaffected.' Disposition: RELEASED."*

**Texture complaints** (substrings in `customer_comment` on affected-lot rows):
*"grainy texture"*, *"product separated"*, *"consistency is watery"*, *"texture feels off"*,
*"feels gritty"*.

**Time anchors**: rolling (`LUXE_PIN_TIME=1` pins it). The lot was produced ~6 weeks before the
data's end; the weekly refund series peaks ~3 weeks before the latest return date, then decays —
never at the right edge.

**`is_bad_lot`** — carried on the raw returns; `TRUE` iff `lot_id` = the affected lot. The
load-bearing split for every "affected vs everyday" widget, derived the same way on
`silver_order_items`.

---

## A. Raw data (already generated — files in the Volume)

Read with `read_files('/Volumes/{catalog}/{schema}/raw_data/<dataset>/', format => 'parquet')`.

| Dataset | ~Rows | Columns |
|---|---|---|
| `products` | 90 | `product_id` (SKU-NNNN), `product_name`, `category` (Skincare / Makeup / Haircare / Bodycare / Fragrance), `subcategory`, `price_usd`, `cost_usd`, `launch_date`, `is_active` |
| `customers` | 5,000 | `customer_id`, `first_name`, `last_name`, `email`, `country`, `city`, `customer_lat`, `customer_lng`, `region` (US / EU / APAC), `loyalty_tier` (gold / silver / standard), `registration_date`, `premium_status` (`premium` / `not_premium` / NULL — the ML label) |
| `production_lots` | ~1,600 | `lot_id`, `product_id`, `facility`, `production_date`, `units_produced`, `status` (released / on_hold / recalled), `incident_summary` (non-NULL on the 3 affected rows only) |
| `orders` | ~345,000 | `order_id`, `customer_id`, `country`, `region`, `order_date` (timestamp), `n_items`, `total_usd` |
| `order_items` | ~545,000 | `order_id`, `product_id`, `lot_id`, `facility`, `quantity`, `unit_price_usd`, `line_total_usd` |
| `returns` | ~32,000 | `return_id`, `order_id`, `customer_id`, `product_id`, `lot_id`, `facility`, `country`, `region`, `refund_amount_usd`, `return_reason`, `customer_comment`, `return_date` (timestamp), `status` (completed / approved / pending), `is_bad_lot` |

Notes the SA may hit:
- One return per order, for the order's first line item (by `product_id`); `refund_amount_usd`
  is that line's total.
- Every `(lot_id, product_id)` pair in `order_items` and `returns` exists in `production_lots`.
- About 7% of affected-lot returns are dated before their order (generator artifact). Don't drop
  them; the weekly story is unaffected.
- `returns` carries a generator-only `sentiment_seed` column. Ignore it.

---

## B. Silver (materialized views, built live in `./data_pipeline`)

| MV | What it is | Source |
|---|---|---|
| `comment_anger_scores` | DISTINCT `customer_comment` → `anger_score` via `ai_classify` (1.0 very angry … 0.1 satisfied). Dedup first so the LLM runs once per distinct comment. | `returns` |
| `silver_production_lots` | Lot master incl. `incident_summary`, same columns as raw. **The drill-down destination Genie hops to for the QC note.** | `production_lots` |
| `silver_order_items` | One row per order line: `order_id`, `order_date`, `region`, `product_id`, `product_name`, `category`, `lot_id`, `facility`, `production_date`, `quantity`, `line_total_usd`, `is_bad_lot`. | `order_items` + `orders` + `products` + `production_lots` |
| `silver_returns` | One row per return, every dimension denormalized: `product_name`, `category`, `lot_id`, `facility`, `country`, `city`, `customer_lat`, `customer_lng`, `region`, `return_reason`, `customer_comment`, `return_date`, `refund_amount_usd`, `status`, plus `anger_score` and `is_bad_lot`. | `returns` + `products` + `customers` + `orders` + `comment_anger_scores` |

**Expectations (warn only):** `silver_returns` — `refund_amount_usd > 0`, `return_id` /
`product_id` NOT NULL, `anger_score` between 0.1 and 1.0; `silver_order_items` —
`line_total_usd >= 0`, `order_id` NOT NULL.

## C. Gold (materialized views the dashboard, Genie, metric view and ML read)

| MV | Grain | Columns |
|---|---|---|
| `gold_returns` | one row per return (from `silver_returns`) | `return_id`, `order_id`, `customer_id`, `product_id`, `product_name`, `category`, `lot_id`, `facility`, `country`, `city`, `region`, `customer_lat`, `customer_lng`, `return_reason`, `customer_comment`, `anger_score`, `refund_amount_usd`, `return_date`, `status`, `is_bad_lot`. **No `incident_summary`** — Genie has to hop to `silver_production_lots`. |
| `gold_daily_summary` | one row per `(summary_date, region, category, is_bad_lot)` | `summary_date`, `region`, `category`, `is_bad_lot`, `order_count` (distinct orders by `order_date`), `revenue_usd` (sum of `line_total_usd`), `return_count` and `returns_usd` (by `return_date`, 0 where none). |

## D. Validation (the SA checks as they build)

- **Spike in the past** — weekly `SUM(refund_amount_usd)` from `gold_returns` peaks ~3 weeks
  before the latest return and decays; not the current week. Sizes: `README.md` → Key Numbers.
- **One lot is the common thread** — the top `lot_id` for the 3 SKUs has ~4,000 returns; the
  next-largest lot is an order of magnitude smaller.
- **The note** — exactly 3 rows in `silver_production_lots` have a non-NULL `incident_summary`
  (one per affected SKU, same `lot_id`), all mentioning *homogenizer*, *pressure*, *Lyon*,
  *released*.
- **Anger split** — affected-lot returns score clearly angrier than everyday returns.
