# ES-ROB-014 — FANUC M-20iD/25 Reducer Lubrication Standard

TechRobotics Industries · Greenville Plant 2 · Engineering Standard · Rev. D (derived from the OEM maintenance manual)
Owner: Reliability Engineering (M. Chen) · Applies to: RA-201, RA-202, RA-203, RA-205, RA-206, RA-207, RA-209, RA-210, RA-211, RA-213, RA-214 and every FANUC M-20iD/25 on Line 2

## 1. Approved lubricant
The J1–J6 RV reducers of the FANUC M-20iD/25 are filled with **Vigo RE0 reducer grease (part A98L-0040-0174, 16 kg pail; A98L-0040-0174-S cartridge set)**. Vigo RE0 is the ONLY approved grease for these reducers.

**No substitutes.** General-purpose lithium-complex EP2 greases (for example Mobilgrease XHP 222, stocked in the plant for conveyors and pillow-block bearings) are NOT approved for FANUC reducers. EP2 thickeners are incompatible with the RE0 base; mixing the two breaks down the lubricating film in the reducer's crankshaft bearings.

## 2. Replacement interval and quantities
- Standard duty: every 3,850 h or 12 months. Line 2 weld/press-fit cells run high duty: **quarterly (every 91 days)**.
- Grease-out quantities: J1 1,300 g · J2 1,150 g · J3 750 g · J4 400 g · J5/J6 250 g.
- Purge rule: inject new grease until **only new grease exits the outlet (≥ 95% purge)**. A partial purge (< 90%) leaves old grease in the reducer.
- After replacement run the purge program (low-speed J1–J6 sweep, 20 min) with outlets open to release pressure.

## 3. Symptoms of wrong grease or incomplete purge
If a non-approved grease is applied, or old and new greases are mixed, expect within **2 to 4 weeks**:
1. Reducer temperature rise of **+8 to +15 °C** above the asset's normal operating temperature.
2. Vibration RMS on the affected axis rising progressively (typically 2x–3x baseline before failure).
3. Increased motor current (friction) of 5–10%.
4. If not corrected: crankshaft-bearing spalling and reducer seizure. Typical outcome: reducer replacement, 12–16 h unplanned downtime.

## 4. Corrective action when non-spec grease is suspected
1. Quarantine the substitute grease; confirm the lubricant used from the PM work order.
2. **Grease purge x2 with Vigo RE0** (two full purge cycles, ≥ 95% purge each) — 3 h per robot, 1 robotics technician.
3. Inspect J3 reducer: backlash check, magnetic-plug debris check, grease sample for metal particles.
4. If vibration > 2x baseline or debris found: **replace the J3 RV reducer assembly (A97L-0218-0412#J3) and the J3 oil-seal kit (A290-7221-X521)** — 8 h, 2 robotics technicians, FANUC-certified. Schedule in a planned line window.
5. Re-baseline vibration after 48 h of production.

## 5. Stock policy
Minimum stock at the Greenville MRO crib: 4 pails Vigo RE0. The Charlotte Regional DC can transfer within 1 day. Stock-outs must be escalated to Reliability Engineering, never solved by substitution.
