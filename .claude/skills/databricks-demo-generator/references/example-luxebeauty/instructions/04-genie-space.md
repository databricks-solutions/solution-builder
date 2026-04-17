# Genie Space Creation

Create `LuxeBeauty Operations Analytics` Genie Space.

## Story

Claire sees $180K returns on dashboard (3x normal). She asks: "Why do I have so many returns?" Genie traces: spike → products → lot → customer feedback → suggests checking incidents.

## Tables (from 03-pipelines.md)

| Table | Purpose |
|-------|---------|
| gold_daily_summary | Trend analysis: returns_usd by date, region, category |
| gold_returns_by_product | Product-level: return_rate identifies SKU-1001/1002/1003 |
| gold_returns_by_lot | Lot tracing: lot_id grouping + feedback_samples |
| silver_returns | Raw feedback: return_reason_text for customer quotes |
| bronze_products | Product catalog lookup |
| bronze_production_lots | Lot details: facility, production_date |

## Instructions

```
You analyze LuxeBeauty operations data for Claire (VP Ops, non-technical).

BASELINES:
- Normal weekly returns: ~$60K
- Normal return rate: ~8%
- Anomaly: >20% return rate

INVESTIGATION FLOW for "Why so many returns?":
1. gold_daily_summary → SUM(returns_usd) by week → spot 3x spike (~$180K vs $60K)
2. gold_returns_by_product → WHERE return_rate > 0.2 → SKU-1001, SKU-1002, SKU-1003
3. gold_returns_by_lot → GROUP BY lot_id → one lot dominates
4. silver_returns → return_reason_text WHERE lot_id = affected → texture complaints
5. Conclude + suggest: "Would you like me to check for production incidents?"

CUSTOMER FEEDBACK (from affected lot):
- "grainy texture", "not smooth like usual"
- "product separated", "looks curdled"
- "consistency is watery", "texture feels off"
```

## Certified Q&A

### "Why do I have so many returns?"

```sql
-- Step 1: Identify spike
SELECT DATE_TRUNC('week', date) as week, SUM(returns_usd) as returns
FROM gold_daily_summary GROUP BY 1 ORDER BY 1 DESC LIMIT 8
-- Recent week: ~$180K vs baseline ~$60K

-- Step 2: Find problem products
SELECT product_id, product_name, return_rate
FROM gold_returns_by_product WHERE return_rate > 0.2
-- SKU-1001, SKU-1002, SKU-1003 at ~30%

-- Step 3: Trace to lot
SELECT lot_id, SUM(return_count) as returns, AVG(return_rate) as rate
FROM gold_returns_by_lot WHERE return_rate > 0.2 GROUP BY lot_id
-- One lot with ~1,500 returns

-- Step 4: Get feedback
SELECT return_reason_text FROM silver_returns WHERE lot_id = '<affected>'
-- "grainy texture", "separated", "watery"
```

**Expected answer**: "Returns are 3x normal ($180K vs $60K). Three Skincare products have ~30% return rates: SKU-1001, SKU-1002, SKU-1003. They all come from the same production lot. Customers mention texture issues: 'grainy', 'separated', 'watery'. Would you like me to check for production incidents?"

## Sample Questions

```
"Why do I have so many returns?"
"Which products have the highest return rate?"
"What are customers saying about returns?"
"Show me returns trend for the last 8 weeks"
"Which lot has the most returns?"
"Tell me about lot [LOT-ID]"
```

## Validation

| Question | Expected |
|----------|----------|
| "Why so many returns?" | 3x spike, SKU-1001/1002/1003, common lot, texture feedback |
| "What are customers saying?" | Surfaces "grainy", "separated", "watery" |
| "Which lot has most returns?" | Affected lot with ~1,500 returns |

Add genie_space_id to `resources.json`.
