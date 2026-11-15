# 01 — Data, planted signals and AI Functions

**Target:** `financial_services.wealth_advisor_copilot` (DAB variables `catalog` / `schema`). As-of date **2026-09-28**.
Generator: `data_generation/generate_data.py` (plain `.py`; DAB `spark_python_task` or Databricks Connect locally; seed 20260928).

## Tables
| Table | Rows | Grain / purpose |
|---|---:|---|
| `advisors` | 36 | advisor, office (Denver, Boston, New York, Chicago, Austin, San Francisco). Demo advisor `ADV-007` Elena Marsh |
| `households` | 5,400 | segment, AUM at the firm, sweep cash, risk profile + `risk_score` 1-5, horizon, liquidity need, experience, vulnerable flag/reason, concentrated position, held-away 401(k), last contact |
| `accounts` | 24,348 | brokerage / IRA / Roth / trust / bank CDs (`rate_pct`, `maturity_date`) / cash sweep 0.25% / held-away 401(k) (`custodian != 'Calder Pine'`) |
| `liabilities` | 2,019 | mortgages: lender, rate, origination. Refi window = rate ≥ 6.65% and balance ≥ $150K |
| `life_events` | 1,539 | Apr 2025–Sep 2026; `advisor_contacted_within_30d` |
| `cash_flows_monthly` | 64,800 | Oct 2025–Sep 2026: deposits, withdrawals, external transfers in/out (+ `outflow_reason`), market change, AUM + sweep at month end |
| `advisor_notes` | 31,147 | CRM free text per interaction |
| `market_rates` | 12 | Fed funds, CD renewal, T-bill, govt MMF, 30-yr mortgage, sweep, competitor HYSA |
| `nba_actions` | 12 | action catalog: category, complexity, min risk score/horizon, illiquid, revenue bps, disclosures |
| `suitability_rules` | 7 | S1–S7 with citations |
| `nba_history` | 28,758 | 18 months of offers: trigger, days since trigger, outcome, assets moved, revenue, `would_fail_suitability`, `complaint_filed` |
| `advisor_decisions` | 0 → n | **write-back** from the app (cleared by *Reset demo*) |
| `gold_household_signals` | 3,116 | active signals (CD ≤ 60 days, idle cash, recent life events, refi window, held-away 401(k), concentration, recent outflows) with `amount` and `days_to_act` |
| `gold_flows_monthly` | 1,284 | month × office × advisor × segment: AUM, sweep cash, NNA, outflows (after life event / to online banks) |
| `gold_nba_conversion` | 1,227 | month × action × trigger × response speed: offers, accepted, revenue, complaints |
| `gold_life_event_retention` | 150 | bereavement/inheritance events with 6-month follow-up: assets retained by contacted-within-30-days |
| `note_insights` | 3,723 | AI Functions output (see below) |
| `nba_recommendations`, `household_opportunities` | 7,164 / 2,159 | ML + suitability output (spec 02) |

## Planted signals (verified)
- Sweep cash **$326M (Oct 2025) → $650M (Sep 2026)**, jumping after the June cut.
- Investable money in motion **$920M** (idle cash $246M, held-away 401(k) $173M, CDs $119M, business sales $112M, inheritances $90M, …); refi window $378M (lending), concentrated positions $153M.
- Retention after a death/inheritance: **99.0%** (called within 30 days, 71 events) vs **75.7%** (nobody called, 79 events, $18.5M out).
- Conversion: targeted **30.2%** vs generic annual review **7.4%**; < 14 days 41.7%, 14–44 days 28.1%, 45+ days 15.6%.
- Complaints: **148**, of which **121** on complex products sold to clients who fail today's rules.
- Heroes: `HH-10042` Margaret Castellano (widowed 2026-05-22, $1.9M inherited, $812K sweep, $260K CD 5.10% maturing 2026-10-09, $150K to Brightline Direct in Aug, Sep 15 note), `HH-10077` Raj & Priya Mehta ($780K mortgage at 7.25%, $400K lake-house down payment, ARXT 38%), `HH-10113` Tom Whitaker (retired Aug 31, $640K 401(k) held away).

## AI Functions (`src/ai/note_insights.sql`, run on the SQL warehouse)
For notes of the last 60 days, each DISTINCT text is read once (CRM quick-note templates repeat): `ai_classify` into 12
categories (bereavement … intent to move assets, routine service), `ai_extract` of `dollar_amount`, `timeframe`,
`family_member`, `other_financial_institution_name`, and `ai_analyze_sentiment`. `flight_risk_mention` = the note names
another institution (not an employer plan) or has intent to move assets. Margaret's Sep 15 note → *other firm: Brightline Direct*.
