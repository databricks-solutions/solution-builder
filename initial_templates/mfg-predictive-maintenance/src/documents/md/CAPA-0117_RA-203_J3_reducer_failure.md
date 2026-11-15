# CAPA-0117 — RA-203 J3 Reducer Seizure (Root Cause & Corrective Action Report)

TechRobotics Industries · Greenville Plant 2 · Line 2 Cell 3 (gearbox press-fit) · Status: CLOSED (actions verified)
Incident failure id: see failure_events (RA-203, reducer_bearing_wear, ~6 months ago)

## 1. What happened
RA-203 (FANUC M-20iD/25) stopped with a J3 overload alarm mid-shift. The J3 RV reducer had seized. Line 2 was starved for **14.2 hours** of unplanned downtime; 220 actuators were scrapped. Total cost including lost production, emergency repair and scrap: **≈ $116K**, plus an expedited reducer air freight.

## 2. Timeline
- Day −17: quarterly reducer grease PM performed by contractor Carolina Industrial Services. Vigo RE0 was short at stores; the crew substituted **Mobilgrease XHP 222** and purged about 75%.
- Days −14 to −2: J3 vibration rose from 1.6 to 4.8 mm/s and reducer temperature rose +14 °C. No alarm was configured on the relative trend; the absolute alarm (6.0 mm/s) never fired.
- Day 0: seizure.

## 3. Root cause
Grease sample: lithium-complex EP2 grease mixed with residual Vigo RE0 — incompatible thickeners, film breakdown in the crankshaft bearings under the high-duty press-fit cycle. Contributing: storeroom stock-out of RE0; contractor not aware of ES-ROB-014; no trend-based alerting.

## 4. Corrective actions
1. ES-ROB-014 Rev. D: Vigo RE0 ONLY, no substitutes; stock-outs escalate to Reliability Engineering.
2. Contractor scope of work amended (see SOW-CIS-2025): OEM lubricants mandatory, substitutions require written approval.
3. Deploy the ML failure-risk model with relative-drift features (baseline-normalised vibration and temperature).
4. Minimum stock of 4 pails Vigo RE0 at the MRO crib.

## 5. Lesson
The drift was visible **12 days before** the failure. A planned 3-hour grease purge would have cost about $1,500; the breakdown cost two orders of magnitude more.
