# Genie Space Creation

## Task

Create a Genie Space for natural language queries against the customer data.

---

## Genie Space Configuration

| Setting | Value |
|---------|-------|
| **Space Name** | `StreamVue Customer Analytics` |
| **Description** | "Analyze churn rates, engagement metrics, app performance, and support trends." |

---

## Tables to Include

| Table | Purpose |
|-------|---------|
| gold_churn_summary | KPIs and trends |
| gold_engagement_by_version | Version-level analysis |
| gold_support_trends | Support ticket analysis |
| silver_subscriptions | Individual subscription records |
| silver_engagement | Engagement details |
| bronze_app_versions | Version information |

---

## Sample Questions

```
"Why is churn so high this month?"
"Which app versions have issues?"
"Show me engagement by platform"
"What are users complaining about?"
"Which segment is churning fastest?"
```

---

## Key Demo Query Logic

**"Why is churn high?"**:
1. Compare to baseline: gold_churn_summary → 4.8% vs 2.4% normal
2. Find affected segment: iOS users, mobile-first
3. Find affected version: v4.2.0
4. Check engagement: Offline plays dropped from 30% to 5%
5. Summarize: 2x churn → iOS → v4.2.0 → offline engagement dropped → suggest checking support tickets

---

## Validation

| Question | Expected Result |
|----------|-----------------|
| "Why is churn high?" | Identifies spike, iOS, v4.2.0, offline issue |
| "Which version has issues?" | v4.2.0 |
