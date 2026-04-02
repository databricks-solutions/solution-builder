# Knowledge Assistant - Financial Services Fraud

## Configuration

**Name:** Pacific Coast Fraud Intelligence Assistant

**Description:** AI assistant that searches fraud intelligence reports, threat assessments, and operational documents.

## Document Sources

| Document | Type | Pages | Purpose |
|----------|------|-------|---------|
| Fraud Detection Rules Catalog v4.2 | Reference | 20 | Current rules |
| CNP Fraud Prevention Guidelines | Guidelines | 12 | Best practices |
| Merchant Risk Assessment Framework | Policy | 10 | Risk methodology |
| Synthetic Identity Fraud Primer | Reference | 8 | Pattern context |
| Weekly Fraud Ops Report Mar 3 | Report | 4 | Baseline week |
| Fraud Intelligence Alert - TechDealz | Alert | 3 | **SMOKING GUN** |
| Dark Web Monitoring Report | Intel | 2 | Card listing evidence |

## Instructions for KA

```
You are a Fraud Intelligence Analyst for Pacific Coast Bank.

YOUR ROLE:
Search fraud intelligence reports, threat assessments, and operational documents to provide context for fraud investigations.

KEY KNOWLEDGE:
- Merchant breaches typically show 2-3 day lag before fraud appears (cards sold on dark web)
- Synthetic identity rings use same devices across multiple cards
- Electronics merchants are high-value targets (resellable goods)
- Dark web card prices indicate data quality

WHEN ANSWERING:
1. Search relevant intelligence reports
2. Quote directly from alerts and assessments
3. Identify breach timelines and threat actors
4. Connect intelligence to transaction patterns

IMPORTANT:
When asked about TechDealz or the current fraud spike, search for the March 15 Fraud Intelligence Alert - it contains confirmed breach information and fraud ring identification.
```

## Sample Questions

### Demo Flow Questions

1. **"What do we know about TechDealz fraud?"** (key demo question)
   → Should find: Intelligence Alert confirming breach, timeline, fraud ring pattern

2. **"Where are our cards appearing?"**
   → Should find: Dark Web Monitoring Report showing CardShop marketplace listing

3. **"What patterns indicate synthetic identity fraud?"**
   → Should find: Primer document with detection indicators

### Additional Questions

- "What are our current CNP fraud rules?"
- "How do we assess merchant risk?"
- "What's the typical breach timeline?"

## Expected KA Responses

**Question:** "What do we know about TechDealz fraud pattern?"

**Expected Response:**
```
I found critical intelligence on this merchant:

**From: Fraud Intelligence Alert - TechDealz Online (March 15, 2024)**
Classification: HIGH PRIORITY

> "MERCHANT BREACH CONFIRMED: TechDealz Online (MID: M-847291)
>
> Timeline: Breach estimated March 8, 2024. Card data exfiltrated via compromised payment page.
>
> Impact: Estimated 3,000+ cards compromised. Cards appearing on dark web marketplace 'CardShop' as of March 9.
>
> Pattern: Fraud ring operating with synthetic identities. Same device fingerprints across multiple cards. High-value electronics purchases. Ship-to addresses are drop locations.
>
> Identified fingerprints: FP-8821, FP-8822, FP-8823... (12 total)"

**From: Dark Web Monitoring Report (March 10, 2024)**

> "New batch of Pacific Coast Bank cards listed on CardShop marketplace. Seller claims 'fresh CVV dump from electronics merchant.' Pricing suggests premium quality data."

This confirms a merchant breach with organized fraud ring exploitation.
```

## Identifier Matching

| Document Reference | Must Match Data |
|-------------------|-----------------|
| TechDealz Online (M-847291) | merchants.merchant_id |
| Breach date: March 8 | First fraud ~March 10 |
| Device FP-8821, FP-8822... | transactions.device_fingerprint |
| ~3,000 cards | gold_compromised_cards: 2,847 |
