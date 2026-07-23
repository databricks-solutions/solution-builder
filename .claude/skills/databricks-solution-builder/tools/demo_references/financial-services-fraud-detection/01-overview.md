# Financial Services Fraud Detection Demo

## The Story

**Company:** Pacific Coast Bank - Regional bank with 2.3M cardholders

**Hero:** Jennifer Walsh, VP of Fraud Operations

**The Problem:** Card-not-present (CNP) fraud losses spiked 3x this week to $1.8M. Fraud rate jumped from 0.08% to 0.24% of transaction volume. Current rules aren't catching the new pattern.

**The Investigation:**
1. Dashboard shows fraud spike concentrated in CNP transactions, specific merchant categories
2. Jennifer asks Genie: "Why did CNP fraud spike this week?"
3. Genie traces to a cluster of transactions at online electronics merchants, linked to a compromised merchant (TechDealz Online)
4. Jennifer asks Knowledge Assistant: "What do we know about TechDealz fraud pattern?"
5. KA reveals: fraud intelligence report showing TechDealz was compromised, synthetic identity ring operating

**The Resolution:**
- Root cause: TechDealz Online merchant breach + synthetic identity ring using stolen cards
- Impact: $1.8M in losses, 2,847 compromised cards, ongoing exposure
- Action: Jennifer asks agent to identify remaining compromised cards for proactive reissue

**Key Numbers:**
- Baseline fraud rate: 0.08%
- Current fraud rate: 0.24% (3x spike)
- Fraud losses this week: $1.8M
- Compromised merchant: TechDealz Online (MCC 5732)
- Cards at risk: 2,847
- Transaction pattern: High-value electronics, multiple purchases in short window

## Timeline

- **Historical baseline:** 6 months of data (0.08% fraud rate)
- **Merchant breach date:** March 8, 2024 (estimated, based on first fraud)
- **Fraud spike start:** March 10, 2024
- **Current date:** March 17, 2024
- **Intelligence report date:** March 15, 2024

## Components

| Component | Purpose |
|-----------|---------|
| Data Generation | Transactions, fraud cases, merchants, cardholders |
| Pipeline | Bronze/Silver/Gold with fraud metrics |
| Dashboard | Fraud KPIs, trends, merchant breakdown |
| Genie Space | Query transaction and fraud data |
| Knowledge Assistant | Search fraud intel, merchant reports, regulations |
| Multi-Agent Supervisor | Route between data and document queries |
| ML Notebook | Real-time fraud scoring model |

## Build Order

1. Generate data (transactions, fraud flags, merchants, accounts)
2. Create pipeline (Bronze → Silver → Gold)
3. Build dashboard (fraud metrics, trends)
4. Configure Genie Space
5. Generate documents and configure KA
6. Set up Multi-Agent Supervisor
7. Train/deploy ML model for fraud detection
