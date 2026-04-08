# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the supply chain data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `FreshMart Supply Chain Analytics` |
| **Description** | "Analyze stockouts, sales performance, demand forecasts, and inventory metrics." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_daily_performance | KPIs and trends |
| gold_store_performance | Store-level analysis |
| gold_forecast_accuracy | Forecast accuracy |
| silver_stockouts | Individual stockout records |
| silver_sales | Sales details |
| bronze_stores | Store information |

---

## Sample Questions

```
"Why are stockouts so high this week?"
"Which stores have the most stockouts?"
"Which categories are impacted?"
"Show me forecast accuracy for Metro East"
"What drove the demand spike?"
```

---

## Key Demo Query Logic

**"Why are stockouts high?"**:
1. Compare to baseline: gold_daily_performance → $4.2M vs $800K normal
2. Find affected region: Metro East stores
3. Find affected category: Dairy products
4. Check forecast: 75%+ forecast error for affected stores
5. Summarize: 5x stockouts → Metro East → Dairy → forecast missed demand → suggest checking event data

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why are stockouts high?" | Identifies spike, Metro East, Dairy |
| "Which stores have issues?" | 23 Metro East stores |
