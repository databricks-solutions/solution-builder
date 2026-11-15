# Trial Site Copilot: clinical trial protocol design and site selection

**Customer (fictional):** Halcyra Therapeutics · **Industry:** Healthcare & Life Sciences (biopharma R&D / clinical operations)

## The story
Halcyra runs 5 active interventional trials. Four of them are within about 25% of plan. **CASCADE-CKD** (HAL-301) is the exception.
It is a Phase III, placebo-controlled study of velmeraptan (a non-steroidal MRA) in adults with type 2 diabetes and chronic
kidney disease, with a target of 1,200 randomized patients at 72 US sites over 24 months. Seventeen months in, it has
**397 randomized against 715 planned (56%)**. The screen-fail rate is **57%** against the 35% the feasibility assumed.
**11 activated sites have randomized nobody**, and the current run rate (~24/month) puts **last patient in at Jul 2029 instead of Apr 2027**.

The sites blame "hard patients", and the EDC says the reason is "OTHER". The data tells a different story:
- **Exclusion E4 (no SGLT2 inhibitor within 12 weeks) causes 39% of all screen failures (205 of 522).** The site-coded EDC
  report shows it at only 17%, because 117 of those failures were coded "OTHER" with a free-text note. AI Functions read those notes.
- E4 was written in 2023, when about **15%** of patients took an SGLT2 inhibitor. Today **47%** of the T2D+CKD catchment does. E4's share
  of failures rose from 18% (2025-Q2) to 45% (2026-Q3). **79%** of E4 failures were on a stable dose for 12 weeks or more.
- The protocol and SAP say **E4 is an efficacy-design criterion.** The SAP (Appendix C) keeps N = 1,200 and 368 events when stable
  SGLT2i patients are allowed, at the cost of about 3 extra months of follow-up and SGLT2i use added as a stratification factor.
  **E7 (potassium) is a safety criterion** that only the DSMB can relax, so it stays as written.
- A competing trial (Nephrexa Bio's **REDWOOD-CKD**, fictional) opened in January 2026 at 13 of our Southeast and Texas sites. Their
  randomization rate fell **0.55 → 0.24 per site-month**.
- Site start-up takes a median of **147 days on the central IRB vs 251 days on a local IRB**.

**Personas**
- **Dr. Elena Marsh**, Global Study Manager for CASCADE-CKD (app user; she approves the rescue plan).
- **Raj Patel**, VP Clinical Operations (portfolio dashboard and Genie).

## Demo script (≈12 minutes)
1. **Home** (`/`). Read the headline: *"CASCADE-CKD has randomized 397 of the 715 patients it planned by now."* Point out the tiles
   (56% of plan, 57% screen-fail vs 35% assumed, 11 sites with 0 randomized) and the portfolio bars. CASCADE-CKD is the only trial far
   behind; ORCHID-1 is at 77%.
2. **Ask the Copilot.** Click the starter chip **"Which of our trials is furthest behind its enrollment plan, and by how much?"**. The agent calls
   Genie and answers: *CASCADE-CKD, 397 randomized vs 715 planned (55.5% of plan), 318 patients behind.*
3. Click the suggested chip **"What is killing enrollment?"** (screen_fail_breakdown). Answer: *E4 accounts for 205 of 522 screen failures
   (39.3%). Sites coded only 88 of them as E4 and 117 were hidden in OTHER. 161/205 (79%) were on a stable SGLT2i dose. E4's share rose from 17.6%
   (2025-Q2) to 44.6% (2026-Q3).*
4. Click **"Can we amend E4?"** (the Genie agent reads the protocol documents). Answer: *Yes for E4, which is an efficacy-design criterion. The SAP keeps N=1,200 and 368
   events, adds ~3 months of follow-up, and adds SGLT2i use as a stratification factor. E7 stays: it is a safety criterion that the DSMB can relax to ≤ 5.0 only after its first
   unblinded review (600 participants × 6 months).* The answer cites protocol §5.3–5.4 / SAP §9.4 / SOP CLINOPS-014.
5. Click **"Where do we add sites?"** (rank_rescue_sites + simulate_amendment). The top sites are Los Angeles Academic Medical Center (1.12/mo),
   Buffalo Kidney & Hypertension (1.07), Oklahoma City Clinical Research Center (0.95), Great Lakes Nephrology Research… LPI: status quo
   **Jul 2029**, E4 only **Oct 2028**, E4 + 15 sites **Apr 2028**. Chat answers are phrased freshly each run; the numbers come from the tools.
6. **CASCADE-CKD workbench** (`/trials/CASCADE-CKD`). Show *Why patients fail screening*. **As coded in EDC**, OTHER is the top bar
   and E4 is 17%. Click **Real reason (AI)**: E4 jumps to 39%, with the light part of each bar being the share recovered by AI Functions. Walk the **eligible-pool
   funnel**: E4 cuts the pool around the 64 active sites to 21,105 patients, and the amended E4 raises it to 35,683 (1.69×). Point out 47% on an SGLT2i today vs 15% assumed.
   **Site health**: REDWOOD-CKD overlap (0.55 → 0.24), central vs local IRB start-up (~146 vs ~255 days).
7. Click **Run rescue analysis** and narrate the streamed steps (enrollment → 522 screen failures read → eligible pool 1.69× → 11 zero enrollers /
   13 REDWOOD sites → protocol assistant → 40 candidates ranked by `site_enrollment_model@champion` → projection → memo; ~60–90 s).
   Result: **Amend E4 → protocol v4.0** (the from/to wording), **Keep E7**, the cited protocol-assistant answer, and the projection:
   **Jul 2029 → Oct 2028 → Apr 2028** (+27 / +18 / +12 months vs the planned Apr 2027). Untick a few rescue sites and watch the green line
   and the LPI re-project instantly. This is deterministic, with no LLM involved.
8. Scroll through the 11 **sites to review for closure** (Magnolia Clinical Research, St. Brendan Health Houston… tagged REDWOOD-CKD) and the AI-drafted
   **rescue-plan memo**. Edit a line, then click **Approve rescue plan (15 sites)**. The banner reads *Rescue plan approved … 15 rescue sites sent to start-up ·
   11 sites under closure review · written to Lakebase*, and the audit trail shows the AI analysis, the memo edit and the decision.
9. **Site network** (`/sites`) → **Study-manager actions**: the 15 sites show *Activation requested* and the 11 show *Closure review*, and the map markers turn green (activation requested) or violet (closure review).
   Home → *Recent workbench activity* shows the approval.
10. Optional: **Portfolio analytics** (`/analytics`) and the **Portfolio dashboard** (`/dashboard`, embedded AI/BI) for Raj's view.
11. Close: **Reset the demo** (header) wipes the plans and re-syncs the site network from Delta for the next run.

Numbers above are from a reference build (2026-09-29). `generate_data.py` anchors the timeline on the day the setup job
runs, so exact figures move with the run day: a later build on 2026-09-30 shows CASCADE-CKD at 439 of 715 planned (61.4%), E4 = 203 of 490
screen failures (41.4%) vs 18.8% as coded by the sites, 149 failures recovered by AI Functions, and 10 zero-enrolling sites. The story
(CASCADE-CKD far behind, E4 the hidden #1 reason, E7 must stay, rescue sites + amendment pull LPI forward) is the same.

## Files
`manifest.json` · `resources.json` · `architecture.md` · `specifications/01-04` · `data_generation/generate_data.py` · `src/ai/classify_screen_fails.py` ·
`src/gold/build_gold.py` · `src/ml/train_site_model.py` · `src/protocol/*.md` · `src/genie/genie_space.json` ·
`src/deploy/*.py` · `dashboard/trial_enrollment_portfolio.lvdash.json` · `app/` · `databricks.yml` · `dab_instructions.md`
