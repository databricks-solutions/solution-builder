# Warranty Copilot — warranty cost optimization & quality root cause

**Customer (fictional):** Brightwater Cycle Works, an e-bike maker (Reno, NV plant) · **Industry:** Manufacturing

## The story
Brightwater builds ~2,000 e-bikes a month: the Commuter C3, Cargo K2 and Fold F1 on a rear hub motor with the **Hanlin
Electronics MC-48 controller**, and the Trail T5 mid-drive with a **Kessler MC-60 controller**. Every bike has a
24-month warranty. This summer **claims per 1,000 bikes in service climbed from ~7.3 a month to ~9.8** (+34%), and the
warranty report can't say why: dealers pick one of nine generic labor codes, and every electrical failure is
*ELEC-GEN*, *MOTOR* or *OTHER*.

The truth is in the technician notes: *"motor cuts out in the rain… moisture under the conformal coating, green
corrosion on the MOSFET pads… E21"*. On 2026-04-02 Hanlin filed **PCN-0419**, a thinner silicone coating for lots
**HX-2605** and later. Brightwater's supplier-quality engineer asked for a new PPAP (humidity + salt spray). It never
arrived, and Hanlin shipped anyway. Those lots now fail at **~225 claims per 1,000 bike-years vs ~2.4** for every other
lot, mostly in wet regions. Connected bikes report fault **E21** weeks before the controller dies, and ~6,560 bikes
(5,350 in the field, 1,210 in dealer stock) carry an affected controller. If nothing is done, the remaining warranty
exposure is **~$977K**.

**Personas**
- **Priya Raman**, Warranty & Field Quality Engineer (app user)
- **Daniel Okafor**, VP Quality (dashboard + Genie user)
- **Hanlin Electronics**, the supplier who receives the 8D request and the chargeback

## Demo script (≈12 minutes)
1. **Home** (`/`). The Pareto of failure codes is the hero: the orange bar is the emerging controller failure that dealers coded as generic labor. Read the header tiles:
   claims per 1,000 bikes **9.8 / month, +34%** vs the prior 12 months (7.3); warranty cost **$875K** over 12 months
   (**$29 per bike**); supplier recovery **52.5%** (**$228K** not recovered); **2 emerging signals**, and ~300 claims in
   90 days that the dealer coded differently from what the notes say.
2. **VP-Quality question.** Click the first *Ask the Copilot* chip: **"Our claims per 1,000 bikes jumped this summer. What is
   driving it?"** (~30 s, Genie). Answer: **Hanlin motor-controller water ingress / corrosion: 192 claims in the last 90
   days vs an 11.6 prior-year 90-day average (+180), $93,790 of cost**. #2 is display freeze after firmware 3.2.0
   (120 vs 31, +89).
3. **Early warning** (`/signals`). Two flagged rows: *Motor controller water ingress, Hanlin*: **192 claims, 26.5 vs 2.5 per
   1,000 bike-years, 10.4×**; *Display freeze (firmware), Brightwater internal, not chargeable*: 2.4×. Point at "dealer code
   agrees": only half of the controller claims carry even the generic ELEC-GEN code.
4. **The aha, the signal workbench.** Click the Hanlin row (or *Investigate the Hanlin controller signal* on Home).
   - The header: 192 claims in 90 d, 10.4×, **6,561 bikes in scope**, **$977K projected**.
   - The cohort chart: lots **HX-2605 / 2606 / 2607** tower over every other lot (red). HX-2608/09 are amber: same PCN, but too young to fail yet.
   - The first claim, **WC-264207** from Cascade E-Bike Co. (Portland), coded **OTHER** by the dealer: *"motor cuts out
     without warning on wet days… moisture under the conformal coating… coating looks thinner… label HX-2606"*. The AI
     chips read *Motor controller water ingress · E21 · water · lot HX-2606*.
5. Click **Assemble root-cause case** and narrate the streamed steps (~40 s):
   read 245 claims (dealer codes ELEC-GEN 51% / MOTOR 26% / OTHER 22%) →
   cohort isolated HX-2605…HX-2609 (**225 vs 2.4 per 1,000 bike-years**) →
   alternatives tested on the lakehouse. **Firmware 3.2.0 is ruled out** (outside the suspect lots, 1.9 on 3.2.0 vs 3.3 on 3.1.4).
   **Assembly is ruled out**: Trail T5 bikes with the potted Kessler controller, built on the same line in the same weeks,
   had 1 claim from 1,968 bikes. **Wet climate is confirmed**: 354 vs 102 per 1,000 bike-years →
   **468 bikes are signalling E21 now** (539 vs 121 per 1,000 connected bikes) →
   PPAP / PCN / SQA guidance from the Genie agent (supplier documents): *No, PCN-0419 was never approved (Class 1 change, SQA §5.2), and
   §8.1 + §8.2 recover parts, labor at $96/h, a $35 fee per claim and 100% of campaign costs* →
   exposure **$976,664** (2,001 projected claims) → 8D request + chargeback notice drafted.
6. Scroll the result. The root-cause statement. The evidence table (Confirmed / Ruled out). The lot table (coating
   *SC-15 silicone (PCN-0419)*, PPAP *re-submission required, NOT received*). The exposure tiles. The supplier-library answer with its
   sources. The **priced containment options**:
   - stop-ship and quarantine of **1,970 Hanlin controllers** at the plant plus **1,214 bikes** in dealer stock
   - pay claims as they come (**$977K**)
   - a targeted wet-region campaign (**$150K**)
   - the **full seal-kit campaign** (**$324K** for 6,381 bikes, avoiding ~$830K)
   - the **Hanlin chargeback of $418,354** ($87,899 of claims to date + $6,300 in fees + the $324K campaign)
7. Review the drafted **notice to Hanlin** (24 h containment, 8D with D4 in 10 business days, chargeback with SQA clauses).
   Edit a line if you like, then click **Open quality case & send to supplier**. You see *Quality case **QC-2026-0142** opened
   … chargeback $418,354 · lots HX-2605 … HX-2609*, written to Lakebase. It shows under **Quality cases** (`/cases`) and in
   *Recent quality activity* on Home.
8. **Contract question in chat:** *"Was Hanlin's coating change approved, and what can we recover under the supplier
   quality agreement?"* (~20 s, supplier docs): **No**. It was a Class 1 change under SQA-HAN-2024-07 §5.2, never approved, and
   lots HX-2605 onward are nonconforming. Recoverable: 100% of parts, labor at $96/h, a $35 fee per claim, 100% of field-campaign
   costs and 100% of the cost of sorting quarantined stock (PCN-0419, SQA §8).
9. Optional:
   - **Claims (AI-classified)** (`/claims`). Tick *Only claims the dealer coded differently*.
   - **Cost & recovery** (`/analytics`). The water-ingress line takes off in July/August. The lot bars. Hanlin's recovery is **6.9%** vs Ardent's 82.6%.
   - **VP Quality dashboard** (`/dashboard`).
   - Chat chip *"What is our supplier recovery rate by supplier over the last 4 quarters?"*
   - Ask the chat to *"Assemble the root-cause case for the Hanlin controller signal"*. It calls `get_root_cause_evidence` and gives the same findings in ~25 s.
10. Close with **Reset the demo** (header). It re-syncs signals + claims from Delta and clears the analysis, quality cases and chat.

Talking points:
- The statistics and the money are deterministic SQL on governed gold tables, never left to an LLM. The LLM writes the
  root-cause statement and the supplier notice from those facts.
- AI Functions turn free text into a signal that labor codes hide.
- The Genie agent grounds every contractual claim in the SQA / PCN documents.
- Every AI output is a draft the engineer approves before anything is sent.
- Unity Catalog governs it all; Lakebase holds the transactional write-back.

*Numbers are computed against today's date (claims windows, remaining warranty), so they drift slightly from day to day;
the ones above were verified on 2026-09-29.*

## Files
- Top level: `manifest.json` · `resources.json` · `architecture.md` · `databricks.yml` · `dab_instructions.md`
- Specs and data: `specifications/01-05` · `data_generation/generate_data.py`
- Pipeline code: `src/ai/classify_claims.py` · `src/gold/build_gold.py`
- Documents (Genie agent volume): `src/supplier_docs/*.md`
- Genie and deploy: `src/genie/genie_space.json` · `src/deploy/*.py`
- Dashboard: `dashboard/warranty_quality.lvdash.json`
- App: `app/`
