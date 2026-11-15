# 02 — The underwriting review (app engine)

`app/server/services/underwrite.ts`, streamed by `POST /api/submissions/:id/review` (SSE) and callable by the chat agent
(`run_underwriting_review`). Money and eligibility are deterministic; the LLMs only answer the guideline question and write prose.

1. **Documents** — application vs SOV vs loss run; every discrepancy listed (TSI-DOC-04 §3.2: underwrite the documents).
2. **Risk** — `submission_risk_model@champion` as submitted vs verified, with drivers.
3. **Appetite + authority** (`appetite_rules`): AP-FL-COASTAL (decline), AP-HAB-HAIL-ROOF (exclude location > 15-yr roof
   in TX/OK/KS/NE/CO), AP-HAB-FRAME-OLD (refer; resolved if excluded), AP-PROTECTION (PC 9-10 refer), AP-DOCS-LOSSRUN
   (> 90 days or < 5 yrs → request info), AP-DOCS-MATCH (info), AUTH-TIV-SENIOR (TIV quoted > $25M → CUO).
   Then ONE question to the **Genie agent** over the Tidewell guideline documents (Agent mode), built from the rules hit → cited answer.
4. **Pricing** (`rating_factors`, TSI-RATE-03): per included location TIV/100 × base rate(construction) × occupancy ×
   territory × roof-age × sprinkler × experience(verified loss count) × risk-model band × 2% wind/hail credit (hail belt);
   minimum $7,500; GL = revenue/1000 × 0.62 (pro-rata to TIV quoted).
5. **Decision** — DECLINE / REQUEST_INFO / QUOTE_WITH_CONDITIONS (exclusions) / QUOTE; conditions; referral reasons.
6. **Memo** — `databricks-claude-sonnet-4-5` writes the file rationale and the broker letter from those facts only.

Issue: within authority → decided (Lakebase) + `INSERT INTO uw_decisions`; otherwise → `referred`, CUO approves in
Referrals → decided + write-back. Hero result: Loc 3 excluded, $29.2M quoted, **$108,615** ($103,081 property +
$5,534 GL), CUO referral (TIV > $25M).
