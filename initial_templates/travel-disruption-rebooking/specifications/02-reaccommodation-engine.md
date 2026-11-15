# 02 — The re-accommodation plan (app `server/services/reaccom.ts`)

One cancelled flight at a time, streamed to the UI as steps:

1. **Manifest** — passengers from the Lakebase mirror (SSR, tier, onward connection, AI message insight, ML risk, AutoProtect hold).
2. **Inventory** — protected options with seats remaining (decremented by committed plans), hotel rooms left, guardrails.
3. **Policy** — one Agent-mode question to the Genie agent (policy documents) chosen from the flight (EU261/UK261 care for AE 97/99; "does EU261 apply" for
   AE 96/98; UMNR + hotel + refund rules otherwise).
4. **Allocate (deterministic — never an LLM)**
   - Group by PNR (never split). Priority: **P1** SSR (UMNR, WCHR/WCHS/WCHC, BLND, DEAF, MEDA, INFT) · **P2** onward long-haul ·
     **P3** urgent life event (AI urgency) · **P4** Gold+ or First/Business · **P5** away from home · **P6** local resident.
     Ties: ML `p_next_day − p_same_day` (who is hurt most by an overnight).
   - Feasibility: seats ≥ party; UMNR same day only, partner only if every child ≥ 8 and `accepts_umnr`; no nearby airport for UMNR /
     WCHC / onward connections; partner seat ≤ G1 cap (EU261/UK261 flights exempt); **no partner spend on local residents**.
   - Connectors: cheapest same-day option that makes the connection (arrival + 75 min ≤ onward departure). Others: own metal if within
     90 min of the earliest same-day option, else earliest; then next day, then day+2.
   - Overnight: hotel room from the block if entitled (G5: Gold+, SSR, lap infant, EU/UK261, away from home); paid voucher if the block is
     exhausted; UMNR → "return to guardian" exception.
   - Cost model (same for AutoProtect): partner seats + hotels (rooms × nights) + meals ($15 per 3 h, max 3/day) + $570 per misconnect +
     $100 goodwill (Gold+ overnight) + $100 per split-booking passenger.
   - Guardrails: G2 partner spend > $6,000 → **Duty Manager approval**; SSR overnight → approval; G6 exemption logged.
5. **Notify** — `NOTICE_MODEL` (Claude Sonnet 4.5) writes the Duty Manager summary + personalised notifications for up to 28 priority /
   escalated / non-English bookings (UMNR messages go to the guardian); everyone else gets the standard template.

AE 1418 result (live): **103/178 today** (AutoProtect 43), priority 37/37, SSR/UMNR overnight 0, misconnects 0/12, 60 Lumen Air seats
**$15,350** (needs approval), total **$24,260 vs $30,956** ($136 vs $174 per passenger), predicted detractors **29% vs 59%**.

**Commit** (`/submit` → `/approve`): passengers get `desk_*` fields, seats + rooms decrement, flight → committed, audit trail; Delta
write-back `INSERT INTO rebooking_plans` (1 row) + `rebooking_decisions` (1 row per passenger, `handling_method = 'DESK_AGENT'`).
