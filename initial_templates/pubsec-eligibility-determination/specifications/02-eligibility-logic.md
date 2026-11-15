# 02 — Eligibility check (the workbench AI step)

Implemented in `app/server/services/assess.ts`, exposed as `POST /api/cases/:id/assess` (SSE progress).

1. **Read documents** — the case's documents with the `ai_extract` fields (computed in Delta, mirrored to Lakebase).
2. **Check rules deterministically** (`evaluateCase`, pure function) — numbers and dates are never left to an LLM:
   - identity: photo ID present, not expired before filing, name matches head of household
   - residency: lease/utility bill with a Westbrook (WB) address
   - income verification: pay stubs dated ≤ 30 days before filing (else *stale* → NEEDS_INFO); a layoff letter
     with an end date before filing verifies **terminated income** (pre-layoff stubs are past income, 7 CFR 273.10(c));
     signed no-income statement accepted
   - gross income vs 130% FPL (SNAP) / 138% FPL (Medicaid) by household size (weekly ×4.3, biweekly ×2.15, semimonthly ×2)
   - SNAP resources ≤ $3,000 ($4,500 elderly/disabled), bank statement or self-attestation
   - SNAP expedited screening (income < $150 and resources ≤ $100 → 7-day deadline; flags how late)
   - Medicaid citizenship via SSA electronic match
   Each rule → PASS / FAIL / NEEDS_INFO / FLAG + finding + evidence document ids + CFR + manual section.
   Recommendation: any FAIL → DENY; any NEEDS_INFO → REQUEST_VERIFICATION; else APPROVE. SNAP benefit estimate =
   max allotment − 30% × (0.8 × income − standard deduction).
3. **Policy manual** — one targeted question (chosen from the case's key issue) to the Genie agent,
   which searches the WDHS policy manual (volume `policy_manual`, 6 chapters in `src/policy_manual/`, Agent mode); the cited
   answer + source files are shown.
4. **Notice draft** — `databricks-claude-sonnet-4-5` writes a caseworker summary + an 8th-grade plain-language notice
   (approval / denial with citation + 90-day fair hearing / request for verification listing every missing item,
   10-day due date) in the household's preferred language (Spanish for Spanish-preferring households).
5. **Human decision** — `POST /api/cases/:id/decision` (APPROVED / DENIED / RFI_SENT / ESCALATED) writes status,
   notice text, benefit, decider, timestamp and an append-only audit trail to Lakebase (`app.cases`).

Verified outputs: Dana → APPROVE, $0 countable income, $994/mo, expedited flag "31 days ago"; Maria → REQUEST
VERIFICATION with a Spanish notice; Robert → DENY ($3,285 > $2,292) with fair-hearing rights.
