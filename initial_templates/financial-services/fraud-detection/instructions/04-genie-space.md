# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the fraud data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `Meridian Fraud Analytics` |
| **Description** | "Analyze fraud patterns, card activity, merchant performance, and terminal data." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_daily_fraud_summary | KPIs and trends |
| gold_fraud_by_terminal | Terminal-level fraud analysis |
| gold_fraud_by_merchant | Merchant-level analysis |
| silver_fraud_cases | Individual fraud cases |
| bronze_terminals | Terminal details |
| bronze_merchants | Merchant details |

---

## Sample Questions

```
"Why is fraud so high this week?"
"Which terminals have the most fraud?"
"Which merchant has the highest fraud rate?"
"Show me fraud trends for the last 8 weeks"
"What's the common factor in recent fraud cases?"
```

---

## Key Demo Query Logic

**"Why is fraud so high?"**:
1. Compare to baseline: gold_daily_fraud_summary → recent fraud vs ~$600K/week → show 4x spike
2. Find affected terminals: gold_fraud_by_terminal WHERE fraud_rate > 10%
3. Identify common merchant: All 3 terminals belong to QuickMart
4. Get card count: 847 unique cards affected
5. Summarize: 4x fraud → 3 terminals → QuickMart → suggest checking security reports

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why is fraud high?" | Identifies spike, terminals, QuickMart |
| "Which terminals have fraud?" | TRM-QM-0847, 0848, 0849 |
