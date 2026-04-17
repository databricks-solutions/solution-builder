# Pipeline Creation

Create SDP pipeline `luxebeauty_operations` transforming raw parquet → analytics tables.

## Story Requirements

| Consumer | Needs | From Table |
|----------|-------|------------|
| Dashboard KPIs | Revenue $3.8M, Orders 15.2K, Items 24.3K, Returns $180K | gold_daily_summary |
| Dashboard trend | Returns $ by week showing 3x spike | gold_daily_summary |
| Dashboard products | SKU-1001/1002/1003 at 30% return rate | gold_returns_by_product |
| Dashboard filters | Date, Region, Category on ALL widgets | ALL gold tables must have region + category |
| Genie investigation | Trace returns → products → lot → feedback | gold_returns_by_lot + silver_returns |

## Source → Bronze (1:1 ingestion)

```
customers.parquet       → bronze_customers
products.parquet        → bronze_products
production_lots.parquet → bronze_production_lots
orders.parquet          → bronze_orders
order_items.parquet     → bronze_order_items
returns.parquet         → bronze_returns
```

## Bronze → Silver (joins)

### silver_order_items
```
order_items
  JOIN orders ON order_id          → order_date, region
  JOIN products ON product_id      → product_name, category
  JOIN production_lots ON lot_id   → facility, production_date
```
**Columns**: order_item_id, order_id, order_date, **region**, product_id, product_name, **category**, lot_id, facility, production_date, quantity, unit_price_usd, line_total_usd

### silver_returns
```
returns JOIN silver_order_items ON order_item_id
```
**Columns**: return_id, order_item_id, order_date, **region**, product_id, product_name, **category**, lot_id, facility, return_date, refund_amount_usd, return_reason, return_reason_text, days_to_return

## Silver → Gold (aggregations)

**⚠️ CRITICAL: ALL gold tables MUST include `region` and `category` as dimensions for dashboard filtering.**

### gold_daily_summary (KPIs + trends)

**Dimensions**: date, **region**, **category**

| Metric | Aggregation |
|--------|-------------|
| order_count | COUNT(DISTINCT order_id) |
| items_sold | SUM(quantity) |
| revenue_usd | SUM(line_total_usd) |
| return_count | COUNT(*) from returns |
| returns_usd | SUM(refund_amount_usd) |

### gold_returns_by_product (products table)

**Dimensions**: product_id, product_name, **category**, **region**

| Metric | Aggregation |
|--------|-------------|
| units_sold | SUM(quantity) |
| return_count | COUNT(*) |
| total_refund_usd | SUM(refund_amount_usd) |
| return_rate | return_count / units_sold |

**Why region?** When Claire filters to "EU only", products table shows EU-specific return rates.

### gold_returns_by_lot (Genie lot investigation)

**Dimensions**: lot_id, product_id, product_name, **category**, **region**, facility, production_date

| Metric | Aggregation |
|--------|-------------|
| units_sold | SUM(quantity) |
| return_count | COUNT(*) |
| total_refund_usd | SUM(refund_amount_usd) |
| return_rate | return_count / units_sold |
| feedback_samples | COLLECT_LIST(return_reason_text) |

## Filter Coherence Matrix

| Filter | gold_daily_summary | gold_returns_by_product | gold_returns_by_lot |
|--------|-------------------|------------------------|---------------------|
| date | ✅ | — (cumulative) | — (cumulative) |
| region | ✅ | ✅ | ✅ |
| category | ✅ | ✅ | ✅ |

## Workspace Structure

```
{workspace_folder}/
├── transformations/
│   ├── 01_bronze_ingestion.sql
│   ├── 02_silver_enrichment.sql
│   └── 03_gold_aggregation.sql
└── exploration/
    └── data_preview.py
```

## Column Reference

| Table | Filter Columns | Metric Columns |
|-------|---------------|----------------|
| gold_daily_summary | date, region, category | revenue_usd, order_count, items_sold, returns_usd |
| gold_returns_by_product | region, category | product_id, product_name, units_sold, total_refund_usd, return_rate |
| gold_returns_by_lot | region, category | lot_id, product_id, product_name, facility, feedback_samples, return_rate |

Add pipeline_id to `resources.json` after creation.
