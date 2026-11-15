# 02 — Planning engine (deterministic) + mitigation levers

`app/server/services/planner.ts`. Reads the gold tables once through the SQL warehouse (app service principal) and
caches them. Every number the UI and the agent show comes from here — the LLM never computes quantities or costs.

## Levers for an exposure (component C at plant P), in policy order (CSP-03 §3.1)
1. **Transfer** from another plant q: available = min over the 13 weeks of (q balance − q safety stock). Arrival =
   AS_OF + lane transit days. Cost = ⌈qty / units per shipment⌉ × shipment cost + qty × handling. E&O units moved release
   the E&O reserve (reported as "E&O put back to work").
2. **Alternate supplier** (qualified): arrival = AS_OF + lead time; qty between MOQ and monthly capacity;
   cost = qty × (alternate price − primary price) + first-order setup.
3. **Air expedite** (primary supplier's offer): arrival = AS_OF + air lead days; up to the offered max; cost = qty × air
   premium; the same qty is removed from the next un-shipped lot (CSP-03 §3.3).
4. **Safety stock +1 week**: raises the safety-stock line; annual carrying cost = 25% × standard cost × extra units.

Default quantity = the units needed from the arrival week on to stay ≥ safety stock, rounded up to 100, capped at the max.

## Simulation
balance_w = on_hand + Σ(receipts − requirement) with the selected actions applied → units short (peak negative
balance), weeks short, weeks below safety stock, revenue at risk = units short × revenue per component unit,
revenue protected = baseline risk − new risk, plan cost, approver (≤ $25K planner, ≤ $50K plant manager, else VP —
CSP-01 §1.4).

## HX-220 @ Dayton (reference numbers, AS_OF 2026-09-28)
| Lever (alone, default qty) | Arrives | Cost | Units short after | Approver |
|---|---|---|---|---|
| Transfer 2,400 from Monterrey (3 trucks) | Oct 3 | **$14,460** | **0** (never below SS) | Plant supply planner |
| Transfer 150 from Wroclaw (air) | Oct 3 | $4,665 | 904 | Plant supply planner |
| Ridgeline Foundry 1,200 | Oct 19 | $55,700 | 372 (arrives a week late) | VP Supply Chain |
| Nanhai air 1,000 | Oct 10 | $74,000 | 54 | VP Supply Chain |
| Safety stock +1 week | — | $0 (+$23.7K/yr carrying) | 1,054 | Plant supply planner |

Baseline: 1,054 units short, $2.04M at risk. Transfer from Monterrey alone protects the full $2.04M for 0.7% of it
and puts $341K of obsolete stock back to work.
