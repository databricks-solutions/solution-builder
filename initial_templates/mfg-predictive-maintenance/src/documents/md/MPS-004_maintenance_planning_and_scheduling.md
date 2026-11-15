# MPS-004 — Maintenance Planning, Scheduling and Downtime Cost Standard

TechRobotics Industries · Greenville Plant 2 · Rev. C · Owner: Maintenance Planning

## 1. Priority matrix
| Priority | Definition | Response |
|---|---|---|
| P1 | Failure in progress or predicted within 72 h on a Criticality-A asset | Intervene in the next available window ≤ 48 h, emergency parts transfer |
| P2 | Predicted failure within 7 days, or Critical ML risk tier | Book the next planned line window, pre-stage parts |
| P3 | Scheduled preventive maintenance | Per PM calendar |
| P4 | Inspection / improvement | As capacity allows |

## 2. Planned maintenance windows
- Line 2 — Robotic Assembly: **Saturday 06:00–14:00** (8 h), line scheduled down, zero production impact.
- Line 1 — Precision Machining: Sunday 06:00–14:00.
- Line 3 — Press & Test: Wednesday 22:00–04:00.
Work booked inside a planned window has **no lost-production cost**; only labor + parts are charged.

## 3. Downtime cost accounting
- Lost contribution per hour of unplanned downtime is carried on each asset (assets.downtime_cost_per_hour). RA-207 is the Line 2 bottleneck: every hour it is down, the whole line stops — **$12,800 per hour**.
- **Cost avoided** by a planned intervention = (expected unplanned downtime hours x downtime cost per hour + emergency repair premium + scrap) − (planned labor + parts).
- Typical unplanned robot reducer failure: 12–16 h downtime, emergency repair ≈ $4,200 + $900/h, 150–250 scrapped parts at $38.

## 4. Parts
Critical spares are held at the Greenville MRO crib; the Charlotte Regional DC transfers in 1 day. Reserve parts on the work order at booking so the storeroom kits them before the window.
