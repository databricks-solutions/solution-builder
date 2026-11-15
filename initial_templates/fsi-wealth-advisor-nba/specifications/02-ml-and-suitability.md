# 02 — Next-best-action model + suitability guardrail

Script: `src/ml/train_nba_model.py` (DAB task `train_nba_model`, environment with xgboost + mlflow; or Databricks Connect).

## Propensity model
- Training set: `nba_history` (28.8K offers). Label `accepted`. Features: action one-hot, trigger one-hot, days since trigger,
  log trigger amount, segment, age, log AUM, risk score, experience, tenure, cash %.
- XGBoost (350 trees, depth 5). Holdout = offers from Jul 2026 on: **AUC 0.74, top-decile lift 2.5×**.
- Logged to the MLflow experiment `<workspace_folder>/nba_propensity_experiment`, registered as
  `financial_services.wealth_advisor_copilot.nba_propensity_model`, alias **@champion**.
- **Deliberately not suitability-aware**: it learned that structured notes "convert" for inheritance recipients.

## Scoring
Candidate actions per active signal (e.g. CD maturity → CD ladder / managed portfolio / structured note; idle cash → govt
MMF / managed / structured / private credit; death → estate review …) + the generic annual review. Per (household, action):
propensity, assets in scope (e.g. CD ladder = maturing CDs + 30% of idle cash), expected 12-month revenue = propensity ×
assets × revenue bps (estate review = relationship action: 0 revenue, protects AUM). `model_rank` orders by expected revenue.

## Suitability rules (deterministic, `suitability_rules`)
| Rule | Check | Outcome |
|---|---|---|
| S1 Risk tolerance | client risk score ≥ product minimum | FAIL |
| S2 Time horizon | horizon ≥ product minimum | FAIL |
| S3 Liquidity | illiquid products need a Low liquidity need | FAIL |
| S4 Knowledge & experience | Complex products need Extensive experience | FAIL |
| S5 Vulnerable client | bereavement < 12 months or 80+: Complex → FAIL, Moderate → REVIEW | FAIL / REVIEW |
| S6 Concentration | Complex ≤ 10% of liquid net worth; SBLOC with a > 30% position → REVIEW | FAIL / REVIEW |
| S7 Rollover best interest | 401(k) → IRA needs the PTE 2020-02 comparison first | REVIEW |

`rule_results` (JSON, verbatim in the app), `suitability_status`, `suitable_rank` (null when blocked).
`household_opportunities`: money in motion, lending opportunity, AUM at risk (40% of AUM after an un-called
bereavement/inheritance; sweep cash after a recent outflow, a flight-risk note or 90+ days without contact), model's top
action + status, best suitable action (PASS, or REVIEW except for vulnerable clients), priority score (suitable revenue +
0.4% of AUM at risk + urgency + flight-risk bonus) and `book_rank` per advisor. Margaret is #1 in Elena's book; 23.5% of
households have a blocked #1 pick.
