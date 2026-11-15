# Halcyon Wireless NOC Runbook — Chapter RB-3: Transport and backhaul failures

## RB-3.1 Optical levels (10G LR optics, SFP+)
| Rx power | State |
|---|---|
| -3 to -12 dBm | Healthy |
| -12 to -18 dBm | Watch |
| below -18 dBm | **Warning** ("Optical Rx power low") — open a P3 ticket within 24 hours and schedule inspection/cleaning |
| below -21 dBm | **Critical** — link is running on its margin; CRC errors expected under load; treat as a path that WILL fail on failover |
| -24 dBm | Receiver sensitivity |
| -40 dBm | No light (LOS) |

A repeated "Optical Rx power low" warning on a SECONDARY path must never be auto-acknowledged without a ticket: the secondary is only exercised when the primary fails, so its degradation is invisible until the day it is needed.

## RB-3.2 Fiber cut versus optic failure
- **LOS on BOTH ends of the same link at the same second = the fiber span is cut** (outside plant). Check 811 excavation notices (planned_activity) along the link route.
- LOS or low light on ONE end only = local optic, patch cord or connector at that end.
- CRC errors that start only when utilization jumps (after a failover) = marginal optic / dirty connector on that path.

## RB-3.3 Dual-path failure (primary cut AND secondary degraded)
When a router loses both paths, **restore the path with the shortest time to repair first**:
1. Dispatch a **transport technician** to the router's hut to inspect, clean and if needed replace the secondary-path optic and patch cord (action A-03). Typical time to restore: **45-75 minutes** including drive.
2. In parallel dispatch the **OSP fiber splicing crew** to the cut location (action A-02). Typical time to restore a buried span: **4-6 hours** (locate, excavate, splice 144-count cable).
3. Where sites have a microwave backup, confirm they are riding it (action A-04).
Restoring the secondary path first brings every site back while the splice proceeds.

## RB-3.4 Dispatch rules for transport
- Transport technician: skill `transport`, on shift, nearest by drive time; must carry an inspection scope and a spare SFP+ (10G LR).
- OSP splicing crew: skill `fiber_splicing`; always two technicians; bring OTDR to locate the break (distance from the hut).
- Notify the excavation contractor's 811 ticket holder of the damage (liability claim) — record the 811 ticket number on the trouble ticket.
