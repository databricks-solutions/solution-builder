# Genie Space Creation

## Task

Create a Genie Space that enables natural language queries against the structured data.

**Important**: The Genie should have instructions that guide it to perform deep analysis when asked simple questions like "Why do I have so many returns?" - this creates the demo's wow moment.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `LuxeBeauty Operations Analytics` |
| **Description** | "Ask questions about customer orders, returns, product performance, and production lots. Great for investigating operational anomalies." |
| **Catalog/Schema** | As defined in 00-demo-overview.md |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| `gold_weekly_summary` | Weekly KPIs and trends |
| `gold_daily_orders` | Daily sales by date/region/category |
| `gold_daily_returns` | Daily returns with lot context |
| `gold_returns_by_lot` | Lot-level return analysis |
| `silver_orders` | Order details |
| `silver_order_items` | Item-level with lot traceability |
| `silver_returns` | Returns with customer feedback |
| `bronze_products` | Product catalog |
| `bronze_production_lots` | Production lot records |

---

## Genie Instructions

Add instructions like these to the Genie Space (adapt as needed):

```
You are an operations analyst for LuxeBeauty Co., a cosmetics company.

## AUTOMATIC DEEP ANALYSIS

When someone asks a general question like "Why do I have so many returns?" or "What's happening with returns?", you should AUTOMATICALLY:

1. COMPARE to baseline: Look at recent weeks vs historical average
   - Normal weekly returns: ~$60K
   - If current week is significantly higher, quantify the difference (e.g., "3x higher than normal")

2. IDENTIFY affected products: Query gold_daily_returns and gold_returns_by_lot
   - List the top products by return count/value
   - Calculate what % of total returns they represent

3. FIND the common factor: Look for patterns
   - Do affected products share a lot_id?
   - When was that lot produced?
   - What facility produced it?

4. ANALYZE customer feedback: Query silver_returns for return_reason_text
   - What are customers actually saying?
   - Are there common themes (texture, smell, consistency)?

5. PROVIDE a summary with:
   - The anomaly: "Returns are X times higher than normal"
   - The products: "3 Skincare products account for Y% of returns"
   - The lot: "All trace to lot LOT-XXXX produced on [date]"
   - The feedback: "Customers report [common themes]"
   - Suggested next step: "Check if there's an incident report for this lot"

## KEY DOMAIN KNOWLEDGE

- Normal return rate: ~8% across products
- Normal weekly returns: ~$60K
- A return rate above 20% for any product is unusual
- Multiple products sharing the same lot_id with high returns suggests a manufacturing issue
- Texture complaints (grainy, separated, lumpy) often indicate emulsification problems
- The lot_id format is LOT-YYYY-MMDD (e.g., LOT-2025-0212 = February 12, 2025)

## RESPONSE FORMAT

Always provide:
- Specific numbers (counts, percentages, dollar amounts)
- Reference specific lot IDs and product names
- Highlight anomalies compared to baseline
- Connect the dots (products → lot → production date)
- End with a clear summary and suggested action
```

---

## Demo Questions (Configure as Sample Questions)

These are the key questions for the demo:

### Primary Demo Question
```
"Why do I have so many returns?"
```
**Expected behavior**: Genie performs comprehensive analysis and identifies LOT-2025-0212 as the common factor.

### Secondary Questions
```
"What's happening with returns this week?"
"Which products have the highest returns?"
"Tell me about lot LOT-2025-0212"
"What are customers saying about returns?"
"Show me weekly returns for the last 8 weeks"
```

---

## Example Question/Guideline Pairs

Add these to help Genie route questions correctly:

| Question | Guideline |
|----------|-----------|
| "Why do I have so many returns?" | Perform comprehensive analysis: compare to baseline, identify top products, find common lot_id, analyze customer feedback, summarize and suggest checking incident reports |
| "Which products have issues?" | Query gold_returns_by_lot for products with return rate > 20%, list with lot_id |
| "What are customers complaining about?" | Query silver_returns.return_reason_text, group by common themes |
| "Tell me about lot LOT-2025-0212" | Query gold_returns_by_lot and silver_returns for this lot, show products, return count, customer feedback |

---

## Validation

After creating the Genie Space, test these queries:

| Question | Expected Key Results |
|----------|---------------------|
| "Why do I have so many returns?" | Returns 3x normal, 3 products, LOT-2025-0212, texture complaints |
| "Which lot has the most returns?" | LOT-2025-0212 |
| "What's the return rate for Hydrating Serum?" | ~30% (vs 8% normal) |
