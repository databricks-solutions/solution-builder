# Eligibility Copilot — AI-enabled SNAP & Medicaid eligibility determination

**Customer (fictional):** Westbrook Department of Human Services (WDHS) · **Industry:** Public Sector (State & Local)

## The story
Westbrook's DHS runs SNAP and Medicaid in 8 counties. Federal law says a SNAP application must be decided within
**30 days** (7 days for households in crisis — *expedited* service), Medicaid within 45. Statewide, Westbrook is on
time ~91% of the time. **Tamarack County is not:** its paper mill closed five months ago, applications jumped 60%,
and the county office lost 3 of its 7 eligibility workers. Over the last three complete months only **38% of Tamarack's
SNAP applications were decided on time** (29% if you include September), with **58 open cases per worker** (the rest of the state:
2–9) and **procedural denials** — eligible families denied because paperwork didn't come back in time — at **14.6%**
vs 4–8% elsewhere. Approval rates by race/ethnicity are flat (76–78%): the equity gap is *geographic*.

Half of every case is paperwork: reading pay stubs, spotting the missing lease, looking up the rule, writing the
letter. The Eligibility Copilot does that part so the caseworker can decide.

**Personas**
- **Keisha Jackson** — eligibility specialist on the State Surge Team, sent to clear Tamarack's backlog (app user).
- **Marcus Webb** — Director of Economic Assistance (dashboard + Genie user).
- Residents like **Dana Whitfield**, laid off from the mill, who receive the notices.

## Demo script (≈12 minutes)
1. **Home** (`/`). Read the headline: *"Tamarack's families wait 38 days for food assistance the law says they should get in
   30."* Point at the live tiles (232 open in Tamarack, ~77 past the deadline — the overdue count creeps up by the day) and the "Cases past the federal deadline, by
   county" bars — Tamarack dwarfs every other county.
2. **Director view.** Click a starter chip in *Ask the Copilot*: **"Which county is furthest behind the 30-day SNAP
   standard, and how bad is it?"** → the dock agent calls Genie: *Tamarack 37.9% on time vs 91.0% for the rest of the
   state (last 3 complete months).* Follow with the suggested **"Why Tamarack?"** (SNAP on-time 47.8% → 43.1% → 27.8% Jun–Aug
   vs ~91% elsewhere; 58 open cases per worker today vs ≤9) and **"Is it an equity problem?"** (race/ethnicity gaps are
   modest — approval within ~3 points; the gap is geographic: Tamarack's procedural denials 13% SNAP / 17% Medicaid vs ~5%
   elsewhere). Chat answers are phrased freshly each run; the numbers come from Genie SQL. Optionally open **Timeliness & equity** (`/analytics`) or **Director dashboard** (`/dashboard`) to show the
   Tamarack line collapsing after May.
3. **Caseload** (`/cases`, *My caseload*). Keisha's queue: each row shows a deadline meter (day N of 7/30/45) and three
   document dots (ID / residency / income). Point out missing-document dots — visible before anyone opens the case.
   Switch to *Tamarack backlog* (232 cases, oldest first).
4. **The aha — Dana Whitfield** (`/cases/APP-240117`, or *Start with Dana Whitfield's case* on Home). Filed by mail 38
   days ago, household of 4. Open the **Pay stub**: Tamarack Paper Company, $1,978 biweekly — about **$4,250/month, $770
   over the $3,483 limit**. Open the **Employer letter**: the mill's layoff notice. Click **Run eligibility check** and
   narrate the streamed steps (read 4 documents → checked 6 SNAP rules → policy manual → notice). Result:
   **Recommend: approve** — countable income **$0** (terminated income is not anticipated income, 7 CFR 273.10(c)), est.
   benefit **$994/month**, and a **FLAG: entitled to expedited service; the 7-day deadline was 31 days ago — issue
   benefits today.** Scroll to the **Policy manual (Genie agent)** card: the cited answer from WDHS Manual §4.3
   and §2.3. Hover a rule to highlight the document it relied on.
5. Scroll to the **Resident notice**: a plain-language approval letter ($994/month, EBT card, report changes, fair-hearing
   rights). Edit a line, click **Approve & send notice** → *Decision recorded: APPROVED … benefit $994/mo*; the audit
   trail shows the AI check and the human decision (written to Lakebase). Back on Home, *Recent workbench activity* shows it.
6. **Maria Delgado** (`/cases/APP-240233`, Medicaid, prefers Spanish). Run the check → **Recommend: request missing
   documents**: her only pay stub is 62 days old (stale) and there is no proof of residency. The notice is drafted **in
   Spanish**, lists every missing item with acceptable examples and a 10-day due date. Click **Send document request**.
7. Optional: **Robert Kowalski** (`APP-240358`) → **deny** ($3,285 > $2,292 for a household of 2) with citation and
   90-day fair-hearing rights; **Tyler Begay** (`APP-240519`) → expired ID + Idaho lease → request verification.
8. Close: **Reset the demo** (header) re-syncs the caseload from Delta for the next run.

Talking points: the rules engine is deterministic (numbers and dates are never left to an LLM); the LLM explains and
writes; the Genie agent grounds every policy statement in the manual; every AI output is a draft the caseworker approves; all
data governed in Unity Catalog; race/ethnicity is used only for monitoring, never in a determination.

## Files
`manifest.json` · `resources.json` · `architecture.md` · `specifications/01-05` · `data_generation/generate_data.py` ·
`src/ai/extract_documents.py` · `src/gold/build_gold.py` · `src/policy_manual/*.md` ·
`src/genie/genie_space.json` · `src/deploy/*.py` · `dashboard/eligibility_operations.lvdash.json` · `app/` · `databricks.yml` · `dab_instructions.md`
