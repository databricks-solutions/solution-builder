# Lakeflow — Data Ingestion + Processing

## Shared Context (referenced by all other spec files)

**Brand**: FreshMart (grocery chain)

**Affected region**: Metro East — 23 stores within 10-mile radius of Metro East Stadium

**The Event**: Taylor Swift "Eras Tour" concert at Metro East Stadium. 3 consecutive nights, 75,000 per night (225,000 total). Drove dairy/grocery demand 4x at affected stores. Event NOT integrated into forecasting system — forecast missed it entirely.

**Impact**: $4.2M lost sales (vs $800K normal weekly), 15% stockout rate (vs 2% normal), 75%+ forecast error at affected stores. Dairy accounted for majority of losses.

**Time references**: STORY_END_DATE = NOW, STORY_START_DATE = NOW - 13 months, EVENT_DATE = NOW - 1 week, Stockout spike = NOW - 4 to 7 days.

---

## A. Synthetic Data Generation

Generate parquet files → `{raw_data_volume}/`

| File | Rows | Notes |
|------|------|-------|
| stores.parquet | ~85 | Regions: "Metro East", "Metro West", "Suburban", "Rural". Formats: "Supermarket", "Express", "Warehouse" |
| products.parquet | ~5,000 | Categories: "Dairy", "Produce", "Bakery", "Beverages", etc. |
| inventory.parquet | ~500K | Daily snapshots per store/product |
| sales.parquet | ~10M | Normal dairy: ~$15K/day per Metro East store. Event: 4x for 23 Metro East stores Thu-Sat (3 days) |
| stockouts.parquet | ~50K | Normal: ~$800K/week. Event week: $4.2M, concentrated in Dairy at Metro East |
| demand_forecasts.parquet | ~1M | Metro East event period: 75%+ error. Other stores: ~10% error |

### Table Schemas

**stores**: `store_id` (PK, STR-NNN), `store_name`, `region`, `format`, `square_feet`, `open_date`

**products**: `product_id` (PK, PRD-NNNNN), `product_name`, `category`, `subcategory`, `unit_cost` DECIMAL(8,2), `unit_price` DECIMAL(8,2), `shelf_life_days`

**inventory**: `inventory_id` (PK), `store_id` (FK), `product_id` (FK), `inventory_date`, `units_on_hand`, `units_on_order`, `reorder_point`

**sales**: `sale_id` (PK), `store_id` (FK), `product_id` (FK), `sale_date`, `sale_timestamp`, `units_sold`, `revenue_usd` DECIMAL(10,2), `transaction_id`

**stockouts**: `stockout_id` (PK), `store_id` (FK), `product_id` (FK), `stockout_date`, `hours_out_of_stock` DECIMAL(6,2), `estimated_lost_sales_usd` DECIMAL(10,2), `replenishment_date`

**demand_forecasts**: `forecast_id` (PK), `store_id` (FK), `product_id` (FK), `forecast_date`, `forecast_units`, `actual_units`, `forecast_error_pct` DECIMAL(6,2), `model_version`

---

## B. PDF Generation

Generate ~10 PDFs in `{raw_data_volume}/event_docs/`. Only ONE contains the smoking gun.

**Background (~9 PDFs)**: Weekly demand planning reports, promotional calendars, competitor analysis, market research summaries, store performance reviews, seasonal planning guides. NO mention of the concert event.

**Key document**: Event Intelligence Report — Metro East Region.

| Field | Value |
|-------|-------|
| Report ID | EIB-2025-0415 |
| Date | EVENT_DATE - 3 days (before event) |
| Region | Metro East |
| Source | Local Events Intelligence Feed |
| Event | Taylor Swift "Eras Tour" Concert |
| Venue | Metro East Stadium |
| Dates | EVENT_DATE (3 consecutive nights) |
| Attendance | 75,000/night (225,000 total) |

Demand impact assessment (HIGH): Historical similar events show grocery +250-400%, dairy +350-500%, beverages +400-600%, snacks +300-400%. 23 FreshMart stores affected.

Recommendation: "Recommend 4x inventory increase for Dairy, Beverages, Snacks at Metro East stores." Lead time: 5 days minimum. Note: "This report requires acknowledgment from Supply Chain Planning to trigger inventory adjustment."

Distribution: Regional Managers, Supply Chain Planning, Store Operations. Status: **UNACKNOWLEDGED** (no confirmation received).

---

## C. SDP Pipeline

Create pipeline `freshmart_supply_chain_analytics`, catalog `freshmart`, target schema `supply_chain`.

### Consumer Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | stockout losses, stockout rate, fill rate by date/region/category | gold_daily_performance |
| Dashboard drill-down | store-level stockouts, forecast error | gold_store_performance |
| Genie investigation | forecast accuracy by region/category, drill to store | gold_forecast_accuracy + silver layers |

### Source → Bronze (1:1 ingestion)

stores/products/inventory/sales/stockouts/demand_forecasts.parquet → bronze_{table_name}

### Bronze → Silver (joins)

**silver_sales**: sales JOIN stores (→ region) JOIN products (→ category) JOIN demand_forecasts (→ forecast comparison). Columns: sale_id, store_id, region, product_id, category, sale_date, units_sold, revenue_usd, forecast_units, forecast_error_pct.

**silver_stockouts**: stockouts JOIN stores (→ region, format) JOIN products (→ category). Columns: stockout_id, store_id, region, product_id, category, stockout_date, hours_out_of_stock, estimated_lost_sales_usd.

**silver_forecast_accuracy**: demand_forecasts JOIN stores (→ region) JOIN products (→ category). Columns: forecast_id, store_id, region, product_id, category, forecast_date, forecast_units, actual_units, forecast_error_pct, model_version.

### Silver → Gold (aggregations)

**⚠️ ALL gold tables MUST include `region` and `category` as dimensions for dashboard filtering.**

**gold_daily_performance** — dims: date, region, category. Metrics: sales_usd (SUM revenue_usd), stockout_losses (SUM estimated_lost_sales_usd), stockout_rate (stockout_hours / total_hours), fill_rate (1 - stockout_rate).

**gold_store_performance** — dims: store_id, region, date. Metrics: sales_usd, stockout_count, stockout_losses, forecast_error_avg.

**gold_forecast_accuracy** — dims: date, region, category. Metrics: forecast_units (SUM), actual_units (SUM), error_pct (AVG forecast_error_pct).

### Filter Coherence Matrix

| Filter | gold_daily_performance | gold_store_performance | gold_forecast_accuracy |
|--------|----------------------|----------------------|----------------------|
| date | ✅ | ✅ | ✅ |
| region | ✅ | ✅ | ✅ |
| category | ✅ | — | ✅ |

### Column Reference (contract for 03-ai-bi.md)

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_daily_performance | date, region, category | sales_usd, stockout_losses, stockout_rate, fill_rate |
| gold_store_performance | date, region | store_id, sales_usd, stockout_count, stockout_losses, forecast_error_avg |
| gold_forecast_accuracy | date, region, category | forecast_units, actual_units, error_pct |

---

## D. Validation

Run before proceeding to 03-ai-bi.md.

| Check | Query | Expected |
|-------|-------|----------|
| Metro East stores | `SELECT COUNT(*) FROM bronze_stores WHERE region = 'Metro East'` | 23 |
| Event sales spike | `SELECT SUM(sales_usd) FROM gold_daily_performance WHERE region = 'Metro East' AND date BETWEEN EVENT_DATE AND EVENT_DATE+2` | ~4x normal |
| Stockout losses event week | `SELECT SUM(stockout_losses) FROM gold_daily_performance WHERE date BETWEEN EVENT_DATE-1 AND EVENT_DATE+3` | ~$4.2M |
| Normal weekly stockouts | `SELECT SUM(stockout_losses) FROM gold_daily_performance WHERE date BETWEEN EVENT_DATE-14 AND EVENT_DATE-8` | ~$800K |
| Forecast error Metro East | `SELECT AVG(error_pct) FROM gold_forecast_accuracy WHERE region = 'Metro East' AND date BETWEEN EVENT_DATE AND EVENT_DATE+2` | 75%+ |
| Filter dims | `SELECT DISTINCT region FROM gold_daily_performance` | Metro East, Metro West, Suburban, Rural |
| Column names | `DESCRIBE gold_daily_performance` / `DESCRIBE gold_store_performance` | Match specs above |

Add pipeline_id to `resources.json`.
