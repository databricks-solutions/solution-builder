# Genie Space Creation

> **Before starting**: Check relevant skill (`databricks-genie` should be present if ai-dev-kit is installed).

## Task

Create a Genie Space for natural language queries against the structured data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `LuxeBeauty Operations Analytics` |
| **Description** | "Explore orders, returns, products, and production lots. Tables join on customer_id, order_id, product_id, and lot_id." |
| **Catalog/Schema** | As defined in 00-demo-overview.md |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_daily_summary | KPIs and trends |
| gold_daily_orders | Sales by date/region/category |
| gold_returns_by_lot | Lot-level return analysis |
| silver_returns | Returns with customer feedback |
| bronze_products | Product catalog |
| bronze_production_lots | Production lot records |

---

## Instructions for Query Logic

Add certified Q&A pairs to ensure reliable routing and safe demos without surprises.

### Investigate returns spike (THE KEY DEMO QUERY)

1. Compare to baseline: `gold_daily_summary` → recent returns vs ~$60K/week average → show 3x spike
2. Find affected products: `gold_returns_by_lot` GROUP BY product_id WHERE return_rate > 20%, JOIN `bronze_products` ON product_id for names/category
3. Trace to common lot: `gold_returns_by_lot` GROUP BY lot_id → LOT-2025-0212 is the common factor
4. Get feedback: `silver_returns.return_reason_text` WHERE lot_id = affected lot → texture complaints
5. Summarize: 3x returns → 3 Skincare products → LOT-2025-0212 → texture issues → suggest checking incidents

### Find products with high return rates

`gold_returns_by_lot` GROUP BY product_id, JOIN `bronze_products` ON product_id. Calculate return_rate = returns/units, ORDER BY return_rate DESC. SKU-1001/1002/1003 show ~30% vs ~8% normal.

### Get customer feedback themes

`silver_returns.return_reason_text`, GROUP BY common phrases, filter to affected lot. Surfaces texture complaints.

### Investigate specific lot

`gold_returns_by_lot` WHERE lot_id = 'LOT-2025-0212', JOIN `bronze_production_lots` ON lot_id for production_date/facility.

---

## Sample Questions

```
"Why do I have so many returns?"
"Which products have the highest return rate?"
"Tell me about lot LOT-2025-0212"
"What are customers saying about returns?"
"Show me weekly returns for the last 8 weeks"
```

---

## Resource Tracking

After creating, add the Genie Space ID to `created_resources` in `resources.json`.

---

## Validation

Test these queries work:

| Question | Expected Result |
|----------|-----------------|
| "Why do I have so many returns?" | Identifies spike, affected products, LOT-2025-0212 |
| "Which lot has the most returns?" | LOT-2025-0212 |
