# Walkthrough - Financial Services Fraud Demo

## Demo Script

**Duration:** 10-12 minutes
**Presenter:** Solution Architect
**Audience:** Banking executives, CISOs, Fraud leadership

---

## Setup

Before starting:
- Dashboard open to Fraud Command Center
- Genie Space ready
- KA ready
- Date context: "Today is March 17, 2024"

---

## Act 1: Business as Usual → Something's Wrong (2 min)

**[Open Dashboard]**

> "Meet Jennifer Walsh, VP of Fraud Operations at Pacific Coast Bank. They manage 2.3 million cardholders across the West Coast.
>
> This is her Fraud Command Center. Every morning she checks it to spot anomalies. Let's see what she finds today."

**[Point to fraud rate KPI]**

> "Immediately, a red flag. Fraud rate is at 0.24% - that's three times their normal baseline of 0.08%.
>
> In dollar terms, that's $1.8 million in losses this week alone. And it's only Monday - if this continues, they're looking at a catastrophic month."

**[Point to channel breakdown]**

> "The problem is concentrated in CNP - card-not-present transactions. That's e-commerce. Point of sale and ATM are normal. Something is happening online."

---

## Act 2: Ask Why (3 min)

**[Open Genie]**

> "Jennifer needs to understand the pattern fast. She asks:"

**[Type: "Why did CNP fraud spike this week?"]**

**[Show Genie response]**

> "Genie analyzes millions of transactions and immediately identifies the pattern.
>
> 67% of this week's fraud traces to a single merchant: TechDealz Online. They're an electronics retailer - high-value goods that are easy to resell.
>
> But here's the really interesting part. Genie detected fraud ring activity. Twelve device fingerprints are being used across 2,847 different cards. That's not random fraud - that's organized crime."

**[Point to device analysis table]**

> "Device FP-8821 alone has been used with 247 different cards for $892,000 in fraudulent transactions. Same device, different cards, same pattern. This is a professional operation."

---

## Act 3: Get the Full Picture (3 min)

**[Open Knowledge Assistant]**

> "The data shows us WHAT's happening. Jennifer needs to understand the bigger picture. Is this a known threat?"

**[Type: "What do we know about TechDealz fraud?"]**

**[Show KA response with intelligence alert]**

> "The Knowledge Assistant searches their fraud intelligence database and finds a critical alert from two days ago.
>
> TechDealz Online suffered a merchant breach around March 8th. Their payment page was compromised. Card data - full track with CVV - was stolen and started appearing on dark web marketplace 'CardShop' on March 9th.
>
> The intelligence team identified the device fingerprints - they match exactly what Genie found in the transaction data. FP-8821, FP-8822, FP-8823 - all flagged in the alert.
>
> This isn't random fraud. This is a coordinated attack using stolen cards from a known breach."

---

## Act 4: The Resolution (2 min)

> "In under ten minutes, Jennifer has the complete picture:
>
> - TechDealz was breached on March 8th
> - 2,847 Pacific Coast cards were compromised
> - A fraud ring bought the cards on the dark web
> - They're using 12 devices to burn through the cards at electronics merchants
> - $1.8 million in losses so far, and growing
>
> The transaction data told her WHAT. The intelligence told her WHY. Together, she knows exactly WHAT TO DO."

**[Value statement]**

> "This investigation would normally take days - pulling transaction reports, cross-referencing with threat feeds, coordinating between fraud ops and cyber security.
>
> With Databricks, Jennifer connected the dots in minutes. Transaction data and intelligence documents, unified on one platform, with AI that can see the patterns humans might miss."

---

## Act 5: What's Next - The Agent (2 min)

> "Now Jennifer can take immediate action. She can ask a Databricks agent to:
>
> - Generate the list of all 2,847 compromised cards for proactive reissue
> - Create block rules for the identified device fingerprints
> - Draft customer notifications for affected cardholders
> - Calculate the remaining exposure - which compromised cards are still active
>
> And critically - she can do this right now, not after another week of losses."

---

## Optional: Real-Time ML Extension (2 min)

**[Show ML model dashboard]**

> "But here's where we prevent this from happening again.
>
> This fraud scoring model runs on every transaction at authorization time - before the transaction even clears. It looks at velocity patterns, device fingerprints, merchant risk, and dozens of other signals.
>
> When FP-8821 started using its 5th card at TechDealz, the model would have flagged it. By the 10th card, it would have been automatically declining transactions.
>
> Instead of $1.8 million in losses, we might have stopped at $50,000. Real-time detection, real-time prevention."

---

## Closing

> "This is Databricks for fraud prevention:
>
> - **Unified data** - transactions, threat intel, all in one place
> - **Pattern detection** - AI that spots fraud rings humans would miss
> - **Speed** - answers in minutes, not days
> - **Real-time action** - models that stop fraud before it clears
>
> Questions?"

---

## Backup Questions

**"What about PCI compliance?"**
> "All card data stays tokenized and encrypted. Databricks supports PCI-DSS compliance. The actual card numbers never leave your secure environment."

**"How does this integrate with our existing fraud rules?"**
> "The ML model works alongside rules - it doesn't replace them. Think of it as hybrid decisioning: rules catch known patterns, ML catches emerging patterns. Most customers run both."

**"What's the false positive rate?"**
> "Typical models achieve 80%+ fraud detection at 2-3% false positive rates. The key is threshold tuning - you control the tradeoff between catching fraud and customer friction."

**"How quickly can we deploy?"**
> "Data integration 2-4 weeks. Model development and training 4-6 weeks. Real-time scoring requires integration with your authorization gateway - timeline depends on your stack."

**"What about real-time latency?"**
> "Databricks Model Serving supports sub-50ms latency for transaction scoring. We have customers running millions of scores per day at authorization time."
