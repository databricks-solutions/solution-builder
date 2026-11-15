# Readmission Copilot: hospital care transitions and readmission reduction

**Customer (fictional):** Larkspur Health (3 hospitals) · **Industry:** Healthcare & Life Sciences (provider)

## The story
Larkspur Health runs Larkspur Regional Medical Center (LRMC, 412 beds), Millbrook Community Hospital and Castle Ridge Hospital.
Heart-failure 30-day readmissions on **LRMC's 4 West cardiac step-down unit rose from 16.6% to 26.3%** over the last 26 weeks
(+9.7 pts). Every other unit stayed within about 2 points. Heart failure is also the largest line (**$852K**) of Larkspur Regional's
estimated **$1.07M CMS HRRP penalty**, with an HF excess readmission ratio (ERR) of 1.16.

What the data shows:
- The rise is on **weekend discharges**. Since 4 West lost its weekend discharge navigator (2026-03-27) and the HF Transitions Clinic
  dropped its Saturday session (2026-04-03), only **21% of 4 West Friday-Sunday HF discharges leave with a booked 7-day follow-up**,
  against 72% on weekdays. The notes say "patient to call the HF clinic on Monday".
- HF patients without a 7-day follow-up readmit at **31.5% vs 17.2%** with one (trailing 12 months, all hospitals).
- **AI Functions** read every discharge note. Transportation barriers ("does not drive, no reliable ride") appear only in the free text,
  and HF patients with one readmit at **34.7% vs 21.3%**.
- If 4 West had booked a follow-up for 75% of its weekend HF discharges, Larkspur Regional would have avoided about **5 readmissions**
  in 12 months, moving its HF ERR from **1.16 to 1.12** and saving about **$185K** of penalty (deterministic what-if).

**Personas**
- **Maya Okafor, RN**, Director of Care Transitions (the app's main user; she approves the transition plans).
- Care-transitions coordinators and navigators (the outreach queue), and the Finance & Quality team (HRRP page, dashboard, Genie).

## Demo script (≈12 minutes)
1. **Command center** (`/`). Read the headline: *"Heart-failure readmissions on 4 West went from 17% to 26% in six months."* Point out the
   tiles: 26.3% (was 16.6%), **21%** of weekend HF discharges with a 7-day follow-up vs 72% on weekdays, **$1.07M** HRRP penalty ($852K from
   heart failure), **12** high-risk patients with no follow-up booked. Walk the charts: the 4 West line jumps after the marker, "What
   changed on 4 West" lists the two events, and the weekday chart shows Friday, Saturday and Sunday collapsing.
2. **Ask the Copilot**: click **"Why are our heart-failure readmissions going up, and where exactly?"** (readmission_signal, ~10 s).
   Answer: *LRMC 4 West 26.3% in the last 26 weeks vs 16.6% before (+9.7 pts); other units flat. Weekend follow-up booking fell to ~21%
   (Fri 20.5%, Sat 22.5%, Sun 20.8%); 17.2% vs 31.5% readmitted with vs without a follow-up; the weekend navigator resigned 2026-03-27 and
   the Saturday clinic was cut 2026-04-03.*
3. Click the suggested chip **"What does it cost us?"** (hrrp_exposure). Answer: *LRMC estimated penalty $1,065,078, of which HF $851,506;
   at 75% weekend follow-up, 5 readmissions avoided, HF ERR 1.158 → 1.124, penalty $880K, a saving of about $185K.*
4. Click **"Who needs a plan today?"** (get_worklist). Answer: *7 high-risk 4 West HF patients with no follow-up booked*, a table led by
   **Earl Whitfield** (69%, left last Friday) and **Harold Brennan** (52%, leaving Friday).
5. **Discharge worklist** (`/worklist`) → **Harold Brennan** (78, planned discharge Friday, no follow-up booked). Show the risk panel:
   **52% → 31% with a 7-day follow-up**, with the drivers (no follow-up +22 pts, Charlson 5, 1 admission in 12 months). Then *What the
   discharge note says* (AI Functions): lives alone, **transportation barrier**, furosemide 40 → 80 mg + new sacubitril/valsartan
   (high-risk), follow-up as written **"patient to call"**, BMP pending. Click **Show discharge note** to show the source text.
6. Click **Build transition plan** and narrate the streamed steps: risk → note → 4 West events → pathway guidance (the Genie agent over the pathway documents,
   cites the HF pathway, CT-201 and CT-305) → 6 tasks → what-if → summary and call script (~30-40 s). The tasks are: book the HF Transitions
   Clinic visit by Fri Oct 9, the 48-hour call, the pharmacist med-rec call, the BMP, the home-health referral and Ride Assist. Each
   one cites its pathway section. Untick one, then click **Approve plan & create N outreach tasks**. The patient shows *Plan approved* and
   the tasks are written to Lakebase.
7. **Outreach queue** (`/outreach`): the approved tasks with owners and due dates. Click **Done** on one.
8. Back in the chat, click **"Rescue Earl Whitfield"** (build_transition_plan + create_outreach_task ×3, ~40 s). Answer: *plan drafted,
   69% risk → 43% with a follow-up, transportation and cost barriers from the note; 3 outreach tasks created* (follow-up visit, Ride Assist,
   48-hour call). Refresh **Outreach queue**: the three tasks show source *Copilot*. This is the agent's write-back.
9. **HRRP exposure** (`/hrrp`): penalty by hospital, the ERR table (LRMC HF highlighted) and the **what-if slider**. At 75%: 5 readmissions
   avoided, ERR 1.16 → 1.12, $185K saved. Move the slider to 95% to show the upside. It is deterministic, with no LLM involved.
10. Optional: **Readmission analytics** (`/analytics`) and the **Readmissions dashboard** (`/dashboard`, embedded AI/BI). Genie questions
    such as *"What operational changes happened on 4 West?"*.
11. Close: **Reset the demo** (header) wipes plans, tasks and conversations and re-syncs the worklist from Delta.

Chat answers are phrased freshly each run; the numbers come from the tools. Numbers above are from a build on 2026-09-29 (a Tuesday).
The rolling windows are relative to the day the setup job runs, so exact figures move a little with the run day (a later build on
2026-09-30 shows 4 West HF 21.0% → 28.2%, LRMC penalty $838K with $646K from HF, ERR 1.12, Harold Brennan 35% → 21%); the story
(4 West only, weekend follow-up ~21% vs ~72%, 17.9% vs 31.6% with/without follow-up) is the same.

## Files
`manifest.json` · `resources.json` · `architecture.md` · `specifications/01-04` · `data_generation/generate_data.py` ·
`src/ai/extract_note_insights.py` · `src/gold/build_gold.py` · `src/ml/train_readmission_model.py` · `src/care_pathways/*.md` ·
`src/genie/genie_space.json` · `src/deploy/*.py` ·
`dashboard/readmissions_hrrp.lvdash.json` · `app/` · `databricks.yml` · `dab_instructions.md`
