# Underwriting Copilot — commercial P&C submission triage, pricing and decisions

**Customer (fictional):** Tidewell Specialty Insurance (US middle-market commercial property & package carrier) ·
**Industry:** Financial Services — Insurance

## The story
Monday 28 September 2026. Tidewell's commercial property book runs a steady ~55-60% loss ratio — except one cell.
**Habitational risks in the hail belt** (TX, OK, KS, NE, CO) went from **60% to 110%** (2024-Q3 → 2026-Q2), and the
damage is concentrated in buildings with **roofs older than 15 years: 59% → 164%**, nearly nine dollars in ten of it hail
and wind, while newer roofs stayed at 60-70%. In June the Chief Underwriting Officer issued **Appetite Bulletin
TSI-UW-B-2026-07**: no hail-belt habitational location with a roof older than 15 years without a CUO exception.

The problem is that brokers summarise. **24 submissions** are in the queue this morning, each an email with three PDFs — an
ACORD-format application, a statement of values (SOV) and a prior-carrier loss run. The application is where the broker
writes "roofs updated 2019-2020, clean loss history". The facts are in the SOV and the loss run.

**The aha is one submission — SUB-26-0417, Lone Star Residential Partners LP**, four Dallas-Fort Worth apartment
communities, $38.6M TIV, from Tidewell's top broker (Halvorsen & Pike), effective in 17 days. On the application it is
perfect: joisted masonry, roofs 2019, fully sprinklered, one $18,400 water loss in five years. The risk model scores it
**Low (0.02)**. `ai_parse_document` read the SOV and the loss run: **Location 3, Cedar Hollow Apartments (Arlington)** is
**frame, built 1984, unsprinklered, roof replaced 2004 — 22 years old** — and the loss run shows **4 losses, $369,300**,
including **two hail/wind claims at Cedar Hollow ($212,600 in 2024, $96,300 open from 2025)**. Re-scored on the documents
the model says **High (0.64)**. The copilot excludes Cedar Hollow under the bulletin, prices the other three locations on
the rating plan (**$108,615** on $29.2M), cites the guideline, drafts the broker letter — and because $29.2M is above the
$25M senior-underwriter authority, the CUO approves before it is issued. The decision is written to Lakebase and back to
Delta, where the portfolio dashboard and Genie see it.

**Personas**
- **Dana Whitfield** — senior underwriter, middle-market property & package ($25M TIV authority) — primary app user.
- **Marcus Oyelaran** — Chief Underwriting Officer; approves referrals (CUO referrals page); owns the portfolio view.

Existing FSI demos in the workspace cover claims (smart-claims), an insurance agent with human-in-the-loop and actuarial
activation; *touchless-underwriting* is life / personal applications. This one is commercial P&C: document intake, portfolio
feedback into appetite, pricing and authority.

## Demo script (≈ 12 minutes)
Start clean: header → **Reset the demo** → confirm.

1. **Home.** "Hail-belt apartments with old roofs now run a 164% loss ratio. 24 submissions are waiting." Tiles: 24
   submissions / $306.1M TIV · 2 documents disagree · 1 low on paper, high verified · effective within 3 weeks. The chart
   shows old roofs (brick red) leaving the rest of the book.
2. **Chat (click the first starter chip):** *"Which segment's loss ratio deteriorated the most over the last four
   quarters, and is it the old roofs?"* → (~50 s, ask_data) **Habitational · Hail belt 63% → 92% (+29 pts)**; roofs > 15 yrs
   **67% → 129%**, roofs ≤ 15 yrs 60% → 65% — "it's the old roofs, which is why TSI-UW-B-2026-07 exists."
3. **Chat:** *"Which submission in today's queue should I underwrite first, and why?"* → (list_queue) **SUB-26-0417 Lone
   Star Residential Partners**, priority 91, $38.6M, documents disagree, risk Low → High.
4. **Submission queue.** Lone Star is on top: Premier broker, 17 days to effective, **4 disagree**, risk as submitted
   **Low 0.02**, verified **High 0.64**. Point at the lanes: Fast track 14, CUO authority referral 3, Documents disagree 2,
   Decline · out of appetite 1 (Gulf Breeze, beachfront Florida), Request information 1 (stale 3-year loss run).
5. **Open Lone Star** (or Home → *Start with Lone Star Residential Partners*). *Application vs documents*: construction
   joisted masonry vs **1 frame (Loc 3)**, roof **2019 vs oldest 2004 (22 yrs)**, sprinklered yes vs **1 not sprinklered**,
   losses **1 · $18,400 vs 4 · $369,300**. Click **Statement of values (4)** (Cedar Hollow in red) → **Loss run (4)** (two
   hail/wind rows at Loc 3) → **PDFs (3)** → open the SOV PDF: this is the raw document `ai_parse_document` read.
6. Click **Run underwriting review** (~25 s, steps stream): documents → risk *Low (0.02) → High (0.64)* → rules hit
   AP-HAB-HAIL-ROOF + AUTH-TIV-SENIOR → guideline question to the Genie agent → pricing → memo. Result: **Quote with conditions · $108,615**
   ($103,081 property + $5,534 GL) on **$29.2M of $38.6M** — Loc 3 excluded (TSI-UW-B-2026-07), Oak Terrace $45,520,
   Preston Crossing $41,115, Riverside Lofts $16,446; rules: coastal pass, **roof fail**, older frame **resolved** (excluded),
   authority **refer**. The Genie agent's guideline answer cites the bulletin §2.2 options (exclude / prove replacement / CUO exception with
   ACV roof + 5% wind/hail deductible) and TSI-AUTH-02 §2. Expand the letter to Rachel Okonkwo.
7. Click **Refer to CUO** → **CUO referrals** → Marcus sees recommendation, premium, TIV quoted, risk Low → High and the
   rationale → type a note → **Approve & issue**. "Quote with conditions issued … Written to Lakebase and back to Delta."
8. **Chat:** *"Lone Star Residential's SOV shows Cedar Hollow Apartments in Arlington with a 2004 roof. Is that location in
   appetite, and what are my options?"* → (get_submission + ask_data, ~20 s) **No — 22-year-old roof in the TX hail
   belt**; exclude, prove replacement before 10/15, or CUO exception with ACV + 5% wind/hail; notes the two wind/hail claims
   ($308.9K) and the $29.2M CUO approval.
9. **Contrast — Brazos Valley Cold Storage (SUB-26-0422, fast track):** open it → **Run underwriting review** → **Quote ·
   $27,726** ($21,898 property + $5,828 GL, $14.2M, risk Low 0.02, every rule pass, within authority) → **Issue quote**
   (no referral).
10. **Chat:** *"Run the underwriting review on Gulf Breeze Motor Lodge and tell me what to do."* → (run_underwriting_review)
    **Decline** — Panama City Beach is Florida Tier-1 coastal wind (AP-FL-COASTAL, TSI-CAT-05 §3.1); point the broker to surplus lines.
11. **Portfolio analytics** → hail-belt habitational 110% vs other cells 45-62%; roofs > 15 yrs 164%; *Today's queue by
    triage lane* now shows the **decisions issued** (Delta write-back). **Portfolio dashboard** — same story, embedded.
12. Close in Genie (workspace): *"Which queued submissions have documents that disagree with the application?"* →
    SUB-26-0417 (Low → High, roof / construction / sprinklers / losses) and SUB-26-0406 (losses $30,200 vs $37,800).

Numbers above were checked against SQL on the live tables (see `specifications/`). Reset between demos.

## Genie sample questions (all verified via the conversation API)
| Question | Answer |
|---|---|
| Which segment's loss ratio deteriorated the most over the last four quarters? | Habitational · Hail belt, 63% → 92% (+29 pts) |
| Hail-belt habitational LR by quarter, roofs > 15 yrs vs newer | 59% vs 61% (2024-Q3) → 164% vs 71% (2026-Q2) |
| Which perils drove hail-belt habitational losses in the last four quarters? | Hail 63% ($2.8M, 48 claims), wind 16% |
| Hit ratio by broker tier over the last 12 months | Premier 55%, Preferred 47%, Standard 34% |
| Queue by triage lane with TIV | Fast track 14 / $98.3M, CUO authority referral 3 / $89.1M, Documents disagree 2 / $55.0M, … |
| Which queued submissions have documents that disagree? | SUB-26-0417, SUB-26-0406 |
