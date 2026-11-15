# IROPS Copilot — autonomous disruption response & rebooking

**Customer (fictional):** Aeralis Airways (US network carrier, hub Chicago O'Hare; partner **Lumen Air**, also fictional) ·
**Industry:** Retail & CPG — Travel & Hospitality
*Autonomous disruption response & rebooking* (+ *Multi-agent issue resolution*, *Sentiment analysis & escalation*)

## The story
Friday 13 February 2026, Presidents' Day weekend. **Winter Storm Harlan** puts Chicago O'Hare in a ground stop from 05:40
to 12:30 CT and Aeralis cancels **36 flights — 5,266 passengers**. At 05:10 the legacy auto-rebooker, **AutoProtect**, has
already "protected" everyone: first-booked, first-served, on Aeralis metal only. It cannot see SSR codes, onward
connections, loyalty tier, the Lumen Air seats Ops Control protected, nearby airports or families. The result:

| AutoProtect, Harlan | |
|---|---|
| Home the same day | **821 / 5,266 (15.6%)** — 2,229 pushed to Sunday |
| Special-assistance passengers overnight (UMNR, wheelchair, lap infant, medical…) | **248 of 283** |
| Unaccompanied minors overnight — against Aeralis policy | **14 of 17** |
| Onward long-haul connections missed | **55 of 66** |
| Bookings split across flights | 59 |

History says it doesn't have to be this way: from December the **DEN desk piloted priority re-accommodation**. Since
Dec 2025 the pilot got **66.3%** of disrupted passengers home the same day vs **43.9%**, at **$85** vs **$120** per disrupted
passenger, with NPS **+15.0** vs **−27.9**.

**The aha is one flight — AE 1418 ORD→SFO 09:55, 178 passengers.** Three unaccompanied minors (Maya Chen, 9, flying to her
dad), nine wheelchair passengers (Harold and June Whitaker, 81 and 78; Ruth Goldberg, 84), Sofia Ramirez travelling alone
with a baby (Spanish-speaking), twelve passengers connecting to Lumen Air's Tokyo and Sydney departures tonight (Kenji and
Aiko Watanabe, Diamond), and Daniel Okafor, whose message says his mother's funeral is tomorrow at 10:00. AutoProtect got
43 of them out today, left 13 special-assistance passengers and 2 minors overnight and broke all 12 connections. The IROPS
Copilot re-plans it: **103 home today, every priority passenger protected, 0 misconnects, $6.7K cheaper** — and because it
spends $15,350 on partner seats, the Duty Manager approves before anything is ticketed.

**Personas**
- **Marisol Vega** — IROPS desk re-accommodation lead, Operations Control (primary app user).
- **Tom Brennan** — IROPS Duty Manager; approves plans over the partner-spend limit (Approvals page).
- **Priya Shah** — VP Customer Experience (Recovery analytics, dashboard, Genie).

## Demo script (≈12 minutes)
Start clean: header **Reset the demo** → *Reset to the storm start*.

1. **Home** (`/`) is the ORD operations centre: a black-and-amber departures board (every cancelled flight, split-flap), a route map of the destinations, passenger priority lanes and rebooking progress. Read the headline: *"Winter Storm Harlan cancelled 36 flights. AutoProtect got 16% of passengers out today —
   and left the ones who most needed help overnight."* Board tiles: **5,266** disrupted, **2,229** pushed to Sunday, **248 / 283**
   special assistance overnight, **14 / 17** unaccompanied minors overnight. On the board, **AE 1418 → SFO** on
   top (13 SSR overnight + 12 misconnects = 25).
2. **Ask the Copilot** — click the chip **"How badly is Winter Storm Harlan hitting us, and who is AutoProtect leaving stranded
   overnight?"** (~45 s; tools `ask_genie` + `list_disrupted_flights`). Answer: **5,266 disrupted, 821 same day, 4,445
   overnight, 2,229 to Sunday, 248 special-assistance and 14 UMNR overnight, 55 misconnects** (Genie), and the worst flights from
   the live desk — AE 1418 ORD→SFO (13 SSR overnight, 3 UMNR, 12 misconnects), AE 98 ORD→LHR (23 SSR overnight), AE 99, AE 97.
   Follow with the suggested **"Did priority rebooking work before?"** → *DEN pilot 66.3% vs 43.9% same day, $85 vs $120,
   NPS 15.0 vs −27.9* (Genie). Wording varies per run; the numbers come from Genie SQL.
3. **Disrupted flights** (`/flights`): 36 cancellations, AE 1418 first; EU261 / UK261 badges on AE 97 / AE 99.
4. **The aha — AE 1418** (click it, or *Open AE 1418* on Home (or its departures-board row)). The strip: AutoProtect **43 / 178** home
   today, **58** to Sunday, **13** special assistance and **2** UMNR overnight, **12 / 12** connections missed. In *Needs
   protecting (50)*: Leo Martins (12) and Maya Chen (9) — UMNR — on tomorrow's flight; the Whitakers (WCHR, Gold) on **Sunday**;
   Kenji & Aiko Watanabe (Diamond, ➜ LU 881 to Tokyo 21:15) on Sunday — *misses connection*. Click **Maya Chen** to expand: her
   mother's message and the AI Functions reading (*special assistance · vulnerable passenger · negative*) plus the ML detractor
   risk. Click *Escalated messages (12)* → **Daniel Okafor**: *"my mother's funeral — it is tomorrow at 10:00 in Oakland… OAK is fine"*
   → *urgent life event*.
5. Click **Re-accommodate AE 1418** (~50 s) and narrate the streamed steps: *Read 178 passengers on 108 bookings* → *103 same-day
   seats (60 Lumen Air), 185 hotel rooms left* → *Policy guidance retrieved* (Genie agent, policy documents) → **"103 of 178 re-accommodated
   today (AutoProtect: 43)"** → *27 personalised notifications drafted*. The plan card: **103 of 178 home today**, priority
   passengers **37 / 37**, Sunday **0**, SSR / UMNR overnight **0 / 0**, misconnects **0 / 12**, split bookings **0**, Lumen Air
   **$15,350**, hotel rooms **0** (vs 23), total **$24,260 vs $30,956** — **$136 vs $174** per passenger — predicted detractors
   **29% vs 59%**. The manifest now shows the plan column: the three minors and every wheelchair passenger on **AE 1420 14:20**
   (own metal — Lumen Air takes UMNR only 8+ on nonstops), the Tokyo/Sydney connectors and Daniel Okafor on **LU 2231 15:05**,
   locals on tomorrow's flights (no partner money spent on people who can go home).
6. Scroll the right column: **Guardrails** (G1 ok, **G2 needs the Duty Manager** — $15,350 > $6,000, G3 all 3 UMNR today, G4 no
   split, G5 hotels only where entitled), the **Duty Manager summary**, the **Policy & passenger rights** card (UMNR never
   overnight / Lumen Air 8+ nonstop, SSR-04; free hotel only for Gold+, SSR, lap infant, EU/UK261, CARE-02 §3.2; full refund to the
   original payment within 7 business days, REG-US-04 / 14 CFR 260) and the **notifications** — Maya's is addressed to her guardian
   (escort + both guardians called), Sofia Ramirez's is in **Spanish**, the Watanabes’ in **Japanese**.
7. Click **Submit to Duty Manager** → *Awaiting the IROPS Duty Manager*. Open **Approvals** (Tom Brennan): 103/178 home today,
   37/37 priority, 0 misconnects, $15,350 partner, **$6,696 less than AutoProtect**, detractors 29% vs 59%. Type a note and click
   **Approve & commit** → *Committed*: 178 rebookings ticketed in Lakebase (seats decremented) and written back to Delta
   (`rebooking_plans` + 178 rows in `rebooking_decisions`).
8. **Recovery analytics** (`/analytics`): the same-day line (AutoProtect ~44% every month, the pilot dots at ~66%), the scorecard,
   and *Winter Storm Harlan — plans committed by the desk*: **AE 1418 → SFO: 43 → 103 home today, 12 → 0 misconnects, $30,956 →
   $24,260**, read live from Delta. The **Ops dashboard** and Genie see the same write-back (e.g. Genie: *"How many passengers has the
   desk re-accommodated so far?"* → 178, 103 same day).
9. Optional: **AE 97 FRA→ORD** (EU261). Ask the Copilot **"AE 97 Frankfurt-Chicago was cancelled by the storm. Do we owe EU261
   compensation, and what care must we give those passengers?"** → *No compensation (extraordinary circumstances, Art. 5(3)), but
   meals, hotel, transport and rerouting at the earliest opportunity incl. other carriers (Art. 8, 9 — REG-EU-03)*. Re-accommodating
   AE 97 books the FRA hotel block and uses Lumen Air via Newark without the domestic cost caps (G6 exempt).
10. Close with **Reset the demo** for the next run.

Talking points: the allocation is deterministic (seats, money and rules are never left to an LLM); the LLM explains and writes;
the Genie agent grounds every policy statement in the policy documents; AI Functions turn free-text messages into escalations; the UC model decides
who is hurt most by an overnight; nothing is ticketed without a human; everything is governed in Unity Catalog and lands back in Delta.

### Genie sample questions
- *How many passengers did Winter Storm Harlan disrupt, and how many did AutoProtect get out the same day?* → 5,266; 821 (15.6%)
- *How many special-assistance passengers and unaccompanied minors did AutoProtect leave overnight?* → 248 of 283; 14 of 17
- *Which cancelled flights have the most special-assistance passengers left overnight by AutoProtect?* → AE 98 (23), AE 99 (15), AE 97 (14), AE 1418 (13), AE 1360 (13)
- *Compare AutoProtect with the desk-priority pilot since December: same-day re-accommodation, cost per disrupted passenger and NPS* → 43.9% vs 66.3%; $120 vs $85; −27.9 vs +15.0
- *Show the monthly misconnect rate for AutoProtect* → 70–80% every month, Jan 2025 – Feb 2026
- *What are Harlan passengers messaging about, and how many messages were escalated?* → rebooking, complaints, hotel/care, refunds…; 122 escalated

## Files
`manifest.json` · `resources.json` · `architecture.md` · `specifications/01-04` · `data_generation/generate_data.py` ·
`src/ai/message_insights.py` · `src/ml/train_detractor_model.py` · `src/gold/build_gold.py` · `src/policy_docs/*.md` ·
`src/deploy/*.py` · `genie/genie_space.json` ·
`dashboard/irops_disruption_recovery.lvdash.json` · `app/` · `databricks.yml` · `dab_instructions.md`
