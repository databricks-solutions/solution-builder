# 01 — Data model & synthetic data (`data_generation/generate_data.py`)

Catalog / schema: `media_advertising.ad_yield_optimization` (parameters `--catalog` / `--schema`). 760 days of history
up to yesterday, generated relative to the run date (seed 20260929).

| Table | Grain | Notes |
|---|---|---|
| `ad_products` | 19 products | platform (Streaming = Crest+, FAST, Linear = ACN) x content x daypart x tier; rate-card CPM + rate-card floor group |
| `audience_segments` | 7 | A25-54, AUTO-INT (Auto Intenders A25-54), SPORTS-M18-49, FAMILY-HH, HIGH-INC, CORD-CUT, SENIORS-55P |
| `product_audience_mix` | product x segment | share of impressions reaching the segment |
| `advertisers` | 32 | category + agency |
| `campaigns` / `line_items` | ~680 IOs / ~770 lines | booked in-target impressions, CPM, flight, deal type; lines sized by an order-management rule (never book more than the avails forecast known at booking time allows) |
| `delivery_daily` | line x day | delivered in-target impressions + revenue (ad server simulation with a pacing controller, capped by the product's avails) |
| `inventory_daily` | product x day | avails, guaranteed / PMP / open-auction / unsold impressions, revenue, open-auction bid landscape, floor + inventory group in force |
| `floor_price_rules` | rule history | FR-117 = the ad-server migration rule |
| `programmatic_deals` | 4 PMPs | PMP-RON-STREAM buys RON-DEFAULT at a fixed $10.50 with priority over the open auction |
| `make_goods` | issued make-goods | completed IOs < 95% delivered |

## Planted signals
1. **Yield leak** — from today-77, FR-117 maps `STR-SPORTS-LIVE` (rate card $48, PREMIUM-SPORTS $30 floor) to RON-DEFAULT ($9);
   PMP-RON-STREAM takes ~75% of its unsold avails at $10.50 while open-auction bids still clear at ~$33. Programmatic
   eCPM drops from ~$30.6 to ~$13.9; ~$540K left on the table in 28 days.
2. **Under-delivery** — `LIN-PRIME-DRAMA` avails drop 60% from today-40 (Harbor Lights moves to Friday). Summit Motors IO-2026-0417
   (36M Auto Intenders A25-54, $1.388M, 21M on LIN-PRIME-DRAMA) paces ~76% → ~8.7M short → ~$337K make-good liability.
   Brightside, Harborview and Pinecrest upfronts on the same daypart are hit too.
3. **Spare avails** — the Live Sports stream has the best AUTO-INT reach (30%) and ~10M in-target spare avails before the
   Summit flight ends. Red herring: ACN Late Night sell-through is low, as every September/October.
