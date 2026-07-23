# Documents - Financial Services Fraud

## Document Strategy

Generate PDF documents providing fraud intelligence context. The Knowledge Assistant searches these to identify the fraud pattern and compromised merchant.

## Documents to Generate

### Background Noise (5-7 documents)

Standard fraud operations documents:

1. **Fraud Detection Rules Catalog v4.2** (20 pages)
   - Current rule definitions
   - Thresholds and triggers
   - Rule performance metrics
   - Last updated: January 2024

2. **CNP Fraud Prevention Guidelines** (12 pages)
   - Best practices for e-commerce fraud
   - Device fingerprinting standards
   - Velocity checks
   - Address verification

3. **Merchant Risk Assessment Framework** (10 pages)
   - Risk scoring methodology
   - High-risk MCC codes
   - Monitoring requirements
   - Escalation procedures

4. **Synthetic Identity Fraud Primer** (8 pages)
   - What is synthetic identity fraud
   - Detection indicators
   - Industry trends
   - Prevention strategies

5. **Weekly Fraud Operations Report - March 3** (4 pages)
   - Previous week metrics (normal)
   - No anomalies detected
   - Rule performance on target

### The Smoking Gun Document

6. **Fraud Intelligence Alert - TechDealz Online** (3 pages)
   - Date: March 15, 2024
   - Classification: HIGH PRIORITY
   - **KEY CONTENT:**
     > "MERCHANT BREACH CONFIRMED: TechDealz Online (MID: M-847291)
     >
     > Timeline: Breach estimated March 8, 2024. Card data exfiltrated via compromised payment page.
     >
     > Impact: Estimated 3,000+ cards compromised. Cards appearing on dark web marketplace 'CardShop' as of March 9.
     >
     > Pattern: Fraud ring operating with synthetic identities. Same device fingerprints across multiple cards. High-value electronics purchases. Ship-to addresses are drop locations.
     >
     > Identified fingerprints: FP-8821, FP-8822, FP-8823... (12 total)
     >
     > Recommendation: Block all TechDealz transactions. Identify and reissue compromised cards. Update fraud rules for electronics velocity."

### Supporting Document

7. **Dark Web Monitoring Report - March 10** (2 pages)
   - Source: Threat Intelligence Team
   - **KEY QUOTE:**
     > "New batch of Pacific Coast Bank cards listed on CardShop marketplace. Seller claims 'fresh CVV dump from electronics merchant.' Pricing suggests premium quality data (full track with CVV). Estimated 2,500-3,000 cards in batch."

## Key Identifiers (Must Match Data)

| Document Reference | Data Match |
|-------------------|------------|
| TechDealz Online | merchants.merchant_name |
| MID: M-847291 | merchants.merchant_id |
| Breach date: March 8 | First fraud transactions ~March 10 |
| Device fingerprints FP-88XX | transactions.device_fingerprint |
| ~3,000 cards | Actual: 2,847 compromised cards in data |

## Document Retrieval Test

**Query:** "What do we know about TechDealz fraud?"

**Expected Result:** Fraud Intelligence Alert showing breach confirmation, timeline, fraud ring pattern.

**Query:** "Where are our cards appearing?"

**Expected Result:** Dark Web Monitoring Report showing cards listed on CardShop marketplace.
