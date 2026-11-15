# Ad Yield Copilot — ad yield & pricing optimization

**Customer (fictional):** Aurora Crest Media — the ACN broadcast network, the Crest+ ad-supported streaming service and a set of FAST channels · **Industry:** Media & Entertainment

## The story
It's upfront season at Aurora Crest. The yield desk sells inventory three ways: guaranteed audience deals (IOs with an
in-target impression guarantee, a make-good owed below 95% at flight end), programmatic PMP deals, then the open auction.
Two things went wrong at the same time, and nobody has connected them:

- **The yield leak.** In July an ad-server migration (rule **FR-117**, ticket ADOPS-5540) dropped the **Crest+ Live Sports**
  stream (rate card **$48**) from its PREMIUM-SPORTS floor group ($30) into **RON-DEFAULT** ($9). RON-DEFAULT is bought first
  by a fixed-price run-of-network PMP at **$10.50**, so ~63% of Live Sports avails now go at $10.50 while open-auction bids
  for the same impressions still clear at **~$33**. Programmatic eCPM fell from **$30.61 to ~$13.90**: ~**$499K** left on the
  table in 28 days, ~**$624K** since the rule changed.
- **The under-delivery.** *Harbor Lights* moved to Friday and ACN Prime Drama lost ~60% of its audience. Four fall upfronts
  bought that daypart. The biggest, **Summit Motors "Terra EV Launch"** (IO-2026-0417, 36M Auto Intenders A25-54, $1,388,000),
  is pacing **76%** and will end **8.8M** impressions short — **~$339K** of make-good liability. Its IO allows **no
  post-flight ADUs** (the launch window closes), so the fix has to run in the next 32 days.

The aha: **the two problems solve each other.** Crest+ Live Sports has the best Auto-Intender reach in the portfolio (30%) and
~10M spare in-target avails before Summit's flight ends. Moving the make-good there only displaces $10.50 PMP inventory, and
restoring its premium floor recovers the open-auction price on everything else.

**Personas**
- **Maya Chen**, Director of Yield & Pricing (app user)
- **Jordan Ellis**, SVP Ad Revenue (dashboard + Genie user)
- **Blue Harbor Agency** (Lena Ortiz), Summit Motors' buyer, who receives the delivery notice; **Sam Patel**, Ad Ops lead

## Demo script (≈10 minutes)
1. **Home** (`/`) — the yield desk: a CPM ticker (programmatic eCPM vs rate card per product), a sell-through heatmap (daypart × property, last 28 days), the pacing blotter of live IOs, and the yield-leak panel. Headline: *"Premium sports is selling at $10.50 — while a 36.0M auto launch runs 8.8M short."* Tiles:
   make-good liability **$627K** (4 of 42 live IOs below 95%), **$499K** left on the table in 28 days (1 product mis-priced),
   Live Sports programmatic eCPM **$13.90** (rate card $48.00 · open auction $33.47), **18.6M** in-target impressions owed.
2. **SVP question.** Click the first *Ask the Copilot* chip: **"Where are we leaving money on the table this month?"** (~10 s;
   tools `list_yield_opportunities` + `list_campaigns_at_risk`). Answer: **$499K in the last 28 days**, all on Crest+ Live
   Sports — $13.90 eCPM vs $48.00 rate card and $33.47 open-auction clearing, because rule **FR-117** (ad-server migration,
   2026-07-14) put it in RON-DEFAULT ($9) instead of PREMIUM-SPORTS ($30); ~$624K since the rule. Top at-risk IO: **Summit
   Motors IO-2026-0417**, 75.6% projected, **8.8M** short, **$339K** liability, on ACN Prime Drama. It offers to build the recovery plan.
3. **Yield board** (`/yield`). The red row: Crest+ Live Sports, **29% of card**, floor group *RON-DEFAULT (card: PREMIUM-SPORTS)*,
   **$499K** left on the table. Below: the weekly chart (programmatic eCPM drops at the FR-117 line while open-auction clearing
   *rises* with football season), 63% of avails going to the $10.50 PMP, and the rule details (changed by *adserver-migration
   (svc)*: "unmapped ad-unit paths default to RON-DEFAULT"). Point at the link: *best Auto-Intender reach — use it for the
   Summit make-good*. (Don't click *Restore* yet — the plan will include it.)
4. **Campaigns at risk** (`/campaigns`). Four fall upfronts below the 95% line, all on ACN Prime Drama: Summit ($339K),
   Harborview ($107K), Brightside ($100K), Pinecrest ($81K).
5. **The aha — the campaign workbench.** Open **Summit Terra EV Launch** (or *Open the Summit Motors IO* on Home). Header: pacing
   **76%**, projected **76%**, **8.8M** short, **$339K**. The line table: *ACN Prime Drama* runs **155K/day vs a 269K plan**
   (58% projected); the two other lines are on plan. Click **Build recovery plan** and narrate the streamed steps (~45 s):
   problem line (59% pacing) → **ai_forecast**: 9.2M avails to flight end vs 29.1M committed, 76% projected, 8.8M short →
   **3 eligible products, 15.1M in-target spare avails** (Crest+ Live Sports 10.2M at 30% reach, ACN Live Sports 4.0M, Crest+
   Prime Drama 1.0M) → **1 mis-priced product**: RON-DEFAULT $9 → PREMIUM-SPORTS $30 → IO + policy guidance (Knowledge
   Assistant) → **Plan: 9.1M moved, $339,243 liability avoided** (3.4M → ACN Live Sports, 5.7M → Crest+ Live Sports, displaced
   $69K, floor fix +$476K) → agency notice + ad-ops instructions drafted.
6. Scroll the result: the diagnosis, the evidence (*Confirmed*: the audience is gone, avails −40%; *Ruled out*: trafficking —
   the other lines run at 100%; *Evidence*: 3 other IOs hit, $288K more; *Confirmed*: the line can't catch up; *Confirmed*: Live
   Sports priced as run-of-network, $624K lost), the spare-avails table (RON / FAST / Kids / Late Night rejected with the reason),
   the priced plan, the tiles (**100%** of the shortfall covered, **$339K** avoided, **$69K** displaced, net **~$746K**), and the
   Genie agent's document answer: ADUs **only in Premium** (Live Sports pre-approved as equivalent-or-better, IO-2026-0417 §2.3),
   **inside the flight** (§2.2 — the IO overrides SLS-POL-11's 30 days), notice to Blue Harbor within 2 business days (§2.4),
   and Live Sports **must never be in RON-DEFAULT** (RC-2026-27 §3.2).
7. Review the **notice to Blue Harbor Agency** (it never mentions the internal pricing problem) and the ad-ops instructions,
   then click **Approve plan & send to ad ops**: *Plan **YP-2026-0207** approved … sent to ad ops · 3.4M → ACN Live Sports ·
   5.7M → Crest+ Live Sports · floor → PREMIUM-SPORTS · liability avoided $339,243*, written to Lakebase together with floor
   change **FC-2026-0318**. It shows under **Yield actions** (`/plans`), on the yield board (*Floor change FC-2026-0318 queued*)
   and in *Recent yield activity* on Home.
8. **Contract question in chat:** *"Where may make-goods for IO-2026-0417 run, and must they run inside the flight?"* (~15 s,
   ad-sales docs): **In-flight only**, only Premium inventory (ACN Prime Drama, ACN Prime Reality, Crest+ Prime Drama Originals,
   Crest+ Live Sports, ACN Live Sports); never RON, FAST, Daytime, Late Night or Kids; anything still owed after flight end is a
   cash credit; the IO is stricter than the general policy, so it wins.
9. Optional:
   - **Revenue & forecast** (`/analytics`): weekly revenue by channel, the Live Sports eCPM break, avails actual vs ai_forecast
     (Live Sports season vs the Prime Drama collapse), eCPM vs rate card.
   - **Ad revenue dashboard** (`/dashboard`), and Genie: *"How much have make-goods cost us over the last 12 months by advertiser
     category?"* → Automotive **$244K** (5 make-goods), Home $137K, CPG $120K, Financial Services $119K.
   - In chat: *"Build the recovery plan for the Summit Motors Terra EV campaign…"* → `build_recovery_plan` gives the same plan in ~15 s.
10. Close with **Reset the demo** (header): re-syncs campaigns + opportunities from Delta and clears plans, floor changes and chat.

Talking points:
- Pacing, forecasts, spare avails and every dollar are deterministic SQL on governed gold tables (and `ai_forecast`), never left
  to an LLM. The LLM writes the diagnosis, the agency notice and the ad-ops instructions from those facts.
- The Genie agent grounds every contractual constraint in the IO and the policies, with sections.
- The yield manager approves; nothing is sent until she does. Lakebase holds the transactional write-back; Unity Catalog governs it all.

*Numbers are computed against the run date (days elapsed in each flight, last 28 days), so they drift slightly day to day; the
figures below are from a reference run:
$496K left on the table in 28 days ($619K since FR-117; $13.87 eCPM vs $48 card / $33.28 open auction), 4 at-risk IOs with $610K of
liability, Summit 76% projected, 8.6M short, $330K; the plan found 15.0M in-target spare avails (Crest+ Live Sports 9.3M,
ACN Live Sports 4.2M, Crest+ Prime Drama 1.5M) and moved 8.8M (3.5M → ACN Live Sports, 5.3M → Crest+ Live Sports): **100% of
the shortfall covered, $329,899 avoided**, $64K displaced, floor fix +$480K.*

## Files
- Top level: `manifest.json` · `resources.json` · `architecture.md` · `databricks.yml` · `dab_instructions.md`
- Specs and data: `specifications/01-05` · `data_generation/generate_data.py`
- Pipeline code: `src/forecast/forecast_avails.py` · `src/gold/build_gold.py`
- Documents (Genie agent volume): `src/ad_sales_docs/*.md`
- Genie and deploy: `src/genie/genie_space.json` · `src/deploy/*.py`
- Dashboard: `dashboard/ad_yield.lvdash.json`
- App: `app/`
