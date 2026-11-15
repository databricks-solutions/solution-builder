# Halcyon Wireless NOC Runbook — Chapter RB-7: Action catalog and dispatch

| Code | Action | When |
|---|---|---|
| A-01 | Open one parent trouble ticket and suppress the child alarms | Any alarm storm (RB-2) |
| A-02 | Dispatch the OSP fiber splicing crew to the cut location | Fiber span cut (RB-3.2) |
| A-03 | Dispatch a transport technician to the router hut (inspect / clean / replace optic) | Degraded optic, dual-path failure (RB-3.3) |
| A-04 | Verify / force traffic onto the microwave backup path | Sites with microwave backup during a fiber outage |
| A-05 | Notify enterprise accounts per SLA tier | Any outage touching an enterprise site (RB-1.2) |
| A-06 | Open the major-incident bridge and notify executives | Every P1 (RB-1.1) |
| A-07 | Dispatch a tower crew (2 climb-certified technicians, line sweep) | VSWR / jumper / antenna faults (RB-5.2) |
| A-08 | Dispatch a power technician with a portable generator | Battery < 50% without restoration in time (RB-4.2) |
| A-09 | Remote RF parameter check / interference hunt | Uplink interference (RB-5.3) |
| A-10 | Monitor and close as explained | Planned work, events, weather (RB-6) |

## Dispatch
- Pick the on-shift technician with the required skill and the shortest drive time to the market (field_technicians.eta_min_<market>).
- Every dispatch record carries: technician, destination (hut / site / cut location), task, and the parent trouble-ticket number.
- Tower work always needs two climb-certified technicians.
