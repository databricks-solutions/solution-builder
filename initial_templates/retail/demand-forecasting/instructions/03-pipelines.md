# Pipeline Creation

## Task

Create a Spark Declarative Pipeline (SDP) that transforms raw parquet data into analytics-ready tables.

---

## Pipeline Configuration

| Setting | Value |
|---------|-------|
| **Pipeline Name** | `freshmart_supply_chain_analytics` |
| **Catalog** | `freshmart` |
| **Target Schema** | `supply_chain` |

---

## Pipeline Tables

### Bronze Layer

| Table | Source | Purpose |
|-------|--------|---------|
| bronze_stores | stores.parquet | Raw store data |
| bronze_products | products.parquet | Raw product catalog |
| bronze_inventory | inventory.parquet | Raw inventory snapshots |
| bronze_sales | sales.parquet | Raw sales data |
| bronze_stockouts | stockouts.parquet | Raw stockout records |
| bronze_demand_forecasts | demand_forecasts.parquet | Raw forecast data |

### Silver Layer

| Table | What It Contains |
|-------|------------------|
| silver_sales | Sales with store region, product category, forecast comparison |
| silver_stockouts | Stockouts with store, product, lost sales context |
| silver_forecast_accuracy | Forecast vs actual by store, product, date |

**Key relationships**:
- silver_sales: sale + store region + product category
- silver_stockouts: stockout + store + product + lost sales

### Gold Layer

| Table | Dimensions | Metrics |
|-------|------------|---------|
| gold_daily_performance | date, region, category | sales_usd, stockout_losses, stockout_rate |
| gold_store_performance | store_id, region, date | sales, stockouts, forecast_error |
| gold_forecast_accuracy | date, region, category | forecast_units, actual_units, error_pct |

---

## Validation

After running pipeline:

| Check | Expected |
|-------|----------|
| Stockout losses event week | ~$4.2M |
| Normal weekly stockout losses | ~$800K |
| Forecast error for Metro East event week | 75%+ |
