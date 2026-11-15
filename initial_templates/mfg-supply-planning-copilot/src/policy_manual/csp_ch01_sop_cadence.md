# Corvane Supply Planning Policy — Chapter 1: S&OP Cadence, Roles and Decision Rights

Corvane Motion Systems policy CSP-01. Owner: VP Supply Chain. Applies to all plants (Dayton DAY, Monterrey MTY, Wroclaw WRO).

## 1.1 Monthly S&OP cycle
Corvane runs a monthly Sales & Operations Planning (S&OP) cycle: demand review (week 1), supply review (week 2), pre-S&OP reconciliation (week 3) and the executive S&OP meeting (week 4). Between cycles the plant supply planners run a weekly supply-exception review every Monday using the 13-week projected inventory.

## 1.2 Planning horizon and forecast
The planning horizon is 13 weeks, in weekly buckets starting Monday. The baseline demand forecast is the statistical forecast produced by AI_FORECAST on 104 weeks of weekly order history per SKU and plant. Demand planners may override it with documented market intelligence (for example a won program). Component requirements are derived by exploding the finished-goods forecast through the single-level bill of materials.

## 1.3 What counts as a supply exposure
A component at a plant is a **supply exposure** when its projected balance falls below its safety stock inside the 13-week horizon. It is a **stock-out exposure** when the projected balance goes negative. Stock-out exposures on A-class components must have a booked mitigation plan within 2 business days of detection.

## 1.4 Decision rights (who approves a mitigation plan)
| Plan cost (incremental, one-time) | Approver |
|---|---|
| up to USD 25,000 | Plant supply planner |
| USD 25,000 to 50,000 | Plant manager |
| above USD 50,000 | VP Supply Chain (plus Finance notification) |
Safety-stock policy changes on A-class components are approved by the plant manager and reported at the next executive S&OP meeting. Every booked plan is recorded in the planning system with its cost, the revenue it protects and the approver.

## 1.5 Revenue at risk
Revenue at risk for an exposure = peak projected units short x the revenue carried per component unit by the finished SKUs that consume it (list price weighted by forecast mix). It is the number used to prioritize exposures and to justify mitigation spend.
