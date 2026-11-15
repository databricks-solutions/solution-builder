# 01 — Data, AI Functions and ML

**Target:** `<catalog>.<schema>` (live: `retail_consumer_goods.travel_disruption_copilot`). Everything is produced by
`data_generation/generate_data.py` (seeded, deterministic) and the setup-job tasks in `databricks.yml`.

## Scenario
Aeralis Airways (fictional US network carrier, hub Chicago O'Hare) — **Winter Storm Harlan, Fri 13 Feb 2026**. ORD ground
stop 05:40–12:30 CT; Ops Control cancels **36 flights** (32 ORD departures, AE 96 ORD→FRA, AE 98 ORD→LHR, and inbound
AE 97 FRA→ORD / AE 99 LHR→ORD). **5,266 passengers** disrupted. At 05:10 the legacy auto-rebooker **AutoProtect** held
seats first-booked-first-served, own metal only.

## Tables (raw, from the generator)
| Table | Rows | Notes |
|---|---:|---|
| `airports` | 42 | `passenger_rights_regime` = EU261 (FRA) / UK261 (LHR) |
| `irops_events` | 19 | 18 past events + Harlan (`EVT-HARLAN-ORD`, `is_current`) |
| `irops_history` | 38,700 | past disrupted passengers: outcome, cost (rebooking + care + compensation), NPS survey (~31% respond) |
| `flights` | 225 | Harlan window: 36 cancelled + every alternate (own + Lumen Air partner) |
| `alternate_options` | 185 | per cancelled flight: OWN_SAME_DAY, PARTNER_SAME_DAY (interline $/seat), NEARBY_AIRPORT, OWN_NEXT_DAY, OWN_D2 (999 = open) |
| `passengers` | 5,266 | PNR, tier, cabin/fare, SSR codes (UMNR, WCHR/WCHS/WCHC, BLND, DEAF, MEDA, INFT, PETC), LOCAL / VISITOR / CONNECTING, onward long-haul connection, language |
| `autoprotect_rebookings` | 5,266 | AutoProtect hold: option, same day / nights, misconnect, party split |
| `passenger_messages` | 1,106 | SMS / app / web / social messages (English, Spanish, German) |
| `hotel_blocks` | 5 | ORD 185 rooms (3 hotels), FRA 120, LHR 90 |
| `guardrails` | 11 | G1 partner seat ≤ $350 (G1L long-haul $700), G2 auto-approve partner spend ≤ $6,000/flight, G3 UMNR never overnight, G4 parties together, G5 hotel entitlement, G6 EU261/UK261 exemption, G7 $15 meal / 3 h, G8 nearby airport rules, G9 hotel rate, G10 misconnect cost $570 |
| `rebooking_plans`, `rebooking_decisions` | 0 | write-back targets for the app (empty in a clean demo) |

## Planted signal
- AutoProtect: **821 / 5,266 (15.6%)** home the same day, **2,229** pushed to Sunday, **248 of 283** special-assistance
  passengers and **14 of 17** unaccompanied minors overnight, **55 of 66** onward long-haul connectors misconnect, 59
  bookings split.
- History: AutoProtect everywhere except the **DEN desk-priority pilot** (3 events, Dec 2025–Jan 2026). Since Dec 2025:
  pilot **66.3%** same day vs **43.9%**, **$85** vs **$120** per disrupted passenger, NPS **+15.0** vs **−27.9**.
- Hero flight **AE 1418 ORD→SFO 09:55** (178 pax, 108 bookings): 3 UMNR (Maya Chen 9, Leo Martins 12, Ava Brooks 13),
  9 wheelchair passengers (Whitakers 81/78, Ruth Goldberg 84, Robert Hale WCHC…), 2 lap-infant bookings (Sofia Ramirez,
  Spanish), 12 connectors to Lumen Air LU 881 SFO→NRT 21:15 / LU 861 SFO→SYD 20:50 (Kenji & Aiko Watanabe, Diamond; Priya
  Nair, Platinum), Daniel Okafor flying to his mother's funeral. AutoProtect: 43 today, 58 Sunday, 13 SSR + 2 UMNR overnight,
  12/12 misconnects. Protected same-day inventory: AE 1420 14:20 (24), LU 2231 15:05 (38 × $265), LU 2235 →OAK 16:30
  (22 × $240), AE 1424 18:45 (19).

## AI Functions — `src/ai/message_insights.py` → `message_insights`
`ai_translate` (→ English), `ai_classify` with label descriptions for **intent** (rebook / refund / hotel / connection /
special assistance / complaint / baggage / praise) and **urgency** (urgent life event / vulnerable passenger / missed onward
connection / routine), `ai_analyze_sentiment`, `ai_summarize`. `escalate` = non-routine urgency or a negative complaint from
Platinum/Diamond → **122** escalations (12 on AE 1418).

## ML — `src/ml/train_detractor_model.py`
HistGradientBoosting on `irops_history` survey respondents (label NPS 0–6), holdout AUC ≈ 0.80, registered in UC as
`<catalog>.<schema>.detractor_risk_model@champion`. Batch-scores every Harlan passenger under three scenarios →
`pax_detractor_risk` (`p_same_day`, `p_next_day`, `p_autoprotect`, `overnight_harm`). Used by the engine to order passengers
inside a priority tier and to report the plan's predicted detractor rate.

## Gold — `src/gold/build_gold.py`
`gold_harlan_flight_status` (one row per cancelled flight), `gold_irops_monthly`, views `v_harlan_pax_status` (passenger ×
AutoProtect × AI insight × ML × desk write-back, live) and `v_harlan_recovery`, metric view `mv_irops_outcomes`.

## Genie agent documents — `src/policy_docs/*.md` → `policy_docs` volume
"Aeralis IROPS Policy and Passenger Rights": OPS-IROPS-01 re-accommodation policy, CARE-02 care commitments, SSR-04 UMNR /
special assistance, FARE-11 fare rules + Harlan waiver, REG-EU-03 EU261/UK261 (scope, Art. 5(3), 7, 8, 9, McDonagh),
REG-US-04 DOT automatic refunds (14 CFR 260), ACAA.
