# Lakeflow — Raw data (in a Volume) + the SDP the workshop builds live

> **Workshop contract.** The data-generation script lands **6 raw parquet
> datasets into a UC Volume** (`/Volumes/{catalog}/{schema}/raw_data/<dataset>/`)
> — the bronze landing zone. The SA then builds **silver → gold** live via Genie
> Code prompts (see `../notebooks/02_build_pipeline.py`), converging on the
> table/column contract in this spec + `../CONTEXT.md`. **No bronze
> pass-through** — silver reads the raw files directly with `read_files()`.
> **The SDP SQL is NOT shipped** — Genie Code writes it during the workshop; this
> spec is its context for *what* to build and *why*.

---

## Shared Context (the story anchors)

**Affected products** (verbatim):
- `SKU-1001` Hydrating Serum 30ml (Skincare/Serums)
- `SKU-1002` Vitamin C Cream 50ml (Skincare/Creams)
- `SKU-1003` HA Moisture Boost 15ml (Skincare/Serums)

**Affected lot**: `LOT-{YYYY}-{MMDD}` (Lyon facility, ~5,000 units, status `released`).
**One lot carries the incident text; every other lot is `NULL`.** This is the
drill-down anchor — the returns show the symptom, the lot holds the explanation.

**Incident text** (verbatim on the affected lot's `incident_summary`):
> *"Production Incident Report PIR-{YYYY}-{MMDD}. Equipment: Homogenizer Unit
> HMG-03 at Lyon. Issue: pressure fluctuations (2.1–2.8 bar vs normal 2.4–2.6
> bar) during emulsification. Cause: calibration drift in the pressure
> regulation valve. Affected SKUs: SKU-1001, SKU-1002, SKU-1003 (~5,000 units).
> QC assessment: 'Minor texture variations … cosmetic only; safety and efficacy
> unaffected.' Disposition: RELEASED."*

**Texture complaints** (substrings in `customer_comment` on affected-lot rows —
Genie + the dashboard search for these): *"grainy texture"*, *"product
separated"*, *"consistency is watery"*, *"texture feels off"*, *"feels gritty"*.

**Time anchors**: `NOW = datetime.now()` (rolling); lot produced ~8 weeks ago,
returns peak ~3 weeks ago (~$180K, 3x the ~$60K baseline), decaying since. Peak
sits in the past with a decay tail — never at the right edge.

**`is_bad_lot`** — carried on the raw returns; `TRUE` iff `lot_id = <AFFECTED>`.
The load-bearing split column for every "affected vs everyday" widget.

---

## A. Raw data (already generated — files in the Volume)

`../data_generation/generate_data.py` writes 6 parquet datasets to
`/Volumes/{catalog}/{schema}/raw_data/`. The SA runs it in the Setup notebook;
the SDP reads it via `read_files(..., format => 'parquet')`.

| Dataset (subdir) | ~Rows | Key columns |
|---|---|---|
| `products` | ~30 | `product_id` (SKU-NNNN), `product_name`, `category`, `subcategory`, `price_usd`, `cost_usd` |
| `customers` | ~50K | `customer_id`, `region`, `country`, `city`, `customer_lat`, `customer_lng`, `loyalty_tier` |
| `production_lots` | ~1.5K | `lot_id`, `product_id`, `production_date`, `facility`, `units_produced`, `status`, `incident_summary` (NULL except affected lot) |
| `orders` | ~200K | `order_id`, `customer_id`, `order_date`, `region`, `total_usd` |
| `order_items` | ~200K | `order_id`, `product_id`, `lot_id`, `facility`, `quantity`, `unit_price_usd`, `line_total_usd` |
| `returns` | ~25K | `return_id`, `order_id`, `customer_id`, `product_id`, `lot_id`, `return_date`, `refund_amount_usd`, `return_reason`, `customer_comment`, `status`, `is_bad_lot` |

---

## B. Silver (built live via Genie Code — target contract below)

Read the raw files from the Volume; no bronze. Materialized views:

- **`comment_anger_scores`** — DISTINCT `customer_comment` → `ai_classify(...)`
  anger score (1.0 very_angry … 0.1 satisfied), deduped so the LLM runs once per
  distinct comment.
- **`silver_production_lots`** — the lot master (incl. `incident_summary`) exposed
  as a governed table so Genie can hop to it. *This is the drill-down destination.*
- **`silver_order_items`** — one row per order line, denormalized (order_date /
  region / product / category / lot / facility / production_date).
- **`silver_returns`** — cleaned returns fact, every dimension denormalized
  in-row + `anger_score` + `is_bad_lot`.

---

## C. Gold (built live via Genie Code — target contract below)

V1 workshop = SDP + Dashboard + Genie. Build ONLY:

- **`gold_returns`** — the denormalized per-return fact (from `silver_returns`);
  **omits `incident_summary`** so Genie has to hop to `silver_production_lots`.
- **`gold_daily_summary`** — one row per `(date, region, category)`; KPIs + trend.

*(No `gold_customer_features` / `gold_customer_returns` — no ML or app here.)*

---

## D. Validation (the SA checks as they build)

- **Spike, peak in past** — weekly `SUM(refund_amount_usd)` from `gold_returns`:
  peak ~$180K ~3 weeks ago, decaying, baseline ~$60K. NOT the current week.
- **Affected lot is the common thread** — top `lot_id` for the 3 SKUs has ~1,500
  returns; the next lot is an order of magnitude smaller.
- **Incident text** — exactly 3 rows in `silver_production_lots` have non-null
  `incident_summary` (one per affected SKU, same `lot_id`), all containing
  *"homogenizer"*, *"pressure"*, *"Lyon"*, *"released"*.
- **Anger split** — affected-lot returns cluster high (`ai_classify` →
  very_angry) vs everyday returns.
