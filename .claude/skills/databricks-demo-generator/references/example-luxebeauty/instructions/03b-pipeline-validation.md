# Pipeline Validation

Verify data matches story before proceeding to dashboard.

## Validation Queries

### 1. Returns spike visible?
```sql
SELECT DATE_TRUNC('week', date) as week, SUM(returns_usd) as weekly_returns
FROM gold_daily_summary
GROUP BY 1 ORDER BY 1 DESC LIMIT 10
-- Expected: One week ~$180K, others ~$60K (3x spike)
```

### 2. Problem products identified?
```sql
SELECT product_id, product_name, category, return_rate, return_count
FROM gold_returns_by_product
WHERE return_rate > 0.2
ORDER BY return_rate DESC
-- Expected: SKU-1001, SKU-1002, SKU-1003 at ~30%
```

### 3. Common lot traceable?
```sql
SELECT lot_id, SUM(return_count) as returns, AVG(return_rate) as rate
FROM gold_returns_by_lot
WHERE return_rate > 0.2
GROUP BY lot_id
-- Expected: One lot with ~1,500 returns, ~30% rate
```

### 4. Texture complaints in feedback?
```sql
SELECT feedback_samples
FROM gold_returns_by_lot
WHERE return_rate > 0.25
LIMIT 1
-- Expected: Array containing "grainy", "separated", "texture"
```

### 5. Dashboard filters work?
```sql
SELECT DISTINCT region FROM gold_daily_summary   -- US, EU, APAC
SELECT DISTINCT category FROM gold_daily_summary -- Skincare, Makeup, Haircare
```

### 6. Column names match dashboard?
```sql
DESCRIBE gold_daily_summary
-- Must have: date, region, category, revenue_usd, order_count, items_sold, returns_usd

DESCRIBE gold_returns_by_product
-- Must have: product_id, product_name, category, units_sold, return_count, total_refund_usd, return_rate
```

## Checklist

| Check | Expected | Query |
|-------|----------|-------|
| Returns spike | ~$180K vs ~$60K (3x) | #1 |
| High return products | SKU-1001/1002/1003 at ~30% | #2 |
| Common lot | Single lot with ~1,500 returns | #3 |
| Texture feedback | "grainy", "separated" in feedback_samples | #4 |
| Filter dimensions | region + category in gold tables | #5 |
| Column names | Match dashboard/Genie specs | #6 |

**Only proceed to dashboard when all checks pass.**
