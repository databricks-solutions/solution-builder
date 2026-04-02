# Dashboard - Financial Services Fraud

## Dashboard Title
**Pacific Coast Bank Fraud Command Center**

## Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FILTERS: Date Range | Channel | MCC Category | Merchant | Card Segment     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Fraud Rate   │  │ Fraud Losses │  │ Cards at     │  │ High-Risk    │    │
│  │   0.24%      │  │ This Week    │  │ Risk         │  │ Merchants    │    │
│  │   ▲ 3x       │  │   $1.8M      │  │   2,847      │  │      1       │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  FRAUD RATE TREND (6 months)        │  │  FRAUD BY CHANNEL           │  │
│  │                                      │  │                             │  │
│  │  0.24% ────────────────────── ●     │  │  CNP          ██████████    │  │
│  │                                 │     │  │  POS          ██           │  │
│  │  0.08% ════════════════════   │     │  │  ATM          █            │  │
│  │        Oct Nov Dec Jan Feb Mar │     │  │                             │  │
│  │                            ↑ SPIKE   │  │                             │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  TOP FRAUD MERCHANTS (This Week)    │  │  FRAUD BY MCC CATEGORY      │  │
│  │                                      │  │                             │  │
│  │  TechDealz Online  ████████████ 67% │  │  Electronics   ████████████ │  │
│  │  GameZone Store    ██            4% │  │  Travel        ███          │  │
│  │  ElectroBuy        ██            3% │  │  Retail        ██           │  │
│  │  Other             ████         26% │  │  Other         ██           │  │
│  │                                      │  │                             │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  FRAUD RING DETECTION - Suspicious Device Clusters                   │   │
│  │                                                                       │   │
│  │  Device ID    │ Cards Used │ Transactions │ Amount   │ Status        │   │
│  │  ─────────────────────────────────────────────────────────────────── │   │
│  │  FP-8821      │    247     │     512      │ $892K    │ ⚠ ACTIVE RING│   │
│  │  FP-8822      │    198     │     423      │ $712K    │ ⚠ ACTIVE RING│   │
│  │  FP-8823      │    156     │     298      │ $445K    │ ⚠ ACTIVE RING│   │
│  │  ...          │            │              │          │               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## KPI Cards (Top Row)

| KPI | Value | Comparison | Source |
|-----|-------|------------|--------|
| Fraud Rate | 0.24% | ▲ 3x vs baseline (0.08%) | gold_daily_fraud_metrics |
| Fraud Losses | $1.8M | This week | gold_daily_fraud_metrics |
| Cards at Risk | 2,847 | TechDealz exposure | gold_compromised_cards |
| High-Risk Merchants | 1 | Critical alert | gold_merchant_fraud_analysis |

## Charts

### 1. Fraud Rate Trend (Line Chart)
- X-axis: Date (6 months)
- Y-axis: Fraud rate %
- Reference line at 0.08% (baseline)
- **Spike visible** - rate jumps from 0.08% to 0.24% week of March 10

### 2. Fraud by Channel (Bar Chart)
- CNP dominates - clear signal that e-commerce is the problem
- POS and ATM remain at normal levels

### 3. Top Fraud Merchants (Bar Chart)
- TechDealz Online at 67% of week's fraud
- Enables drill-down: "What's happening at TechDealz?"

### 4. Fraud by MCC Category (Bar Chart)
- Electronics (5732) dominating
- Pattern: card data used to buy high-value, resellable goods

### 5. Fraud Ring Detection Table
- Device fingerprints with multiple cards = ring activity
- Shows FP-8821, FP-8822, FP-8823 as active rings
- Real-time alert capability

## Filters

| Filter | Options | Default |
|--------|---------|---------|
| Date Range | Last 7 days, 30 days, 90 days | Last 7 days |
| Channel | All, CNP, POS, ATM | All |
| MCC Category | All, Electronics, Travel, Retail | All |
| Merchant | All, specific merchants | All |
| Card Segment | All, Premium, Standard, Basic | All |

## The 5-Second Test

When Jennifer opens this dashboard:
1. **Fraud rate is RED at 0.24%** - 3x normal
2. **CNP channel is the problem** - channel breakdown
3. **TechDealz is the source** - merchant chart
4. **Device clusters show fraud ring** - detection table
