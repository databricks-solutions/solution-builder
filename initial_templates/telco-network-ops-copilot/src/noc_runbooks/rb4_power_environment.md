# Halcyon Wireless NOC Runbook — Chapter RB-4: Power and environmental alarms

## RB-4.1 Commercial power failure
- "AC mains failure" + "Rectifier plant on battery" = the site is running on its battery string. Check the utility outage map / planned_activity for a utility-reported outage and its estimated restoration time.
- Battery runtime at typical load is 4-8 hours (cell_sites.battery_runtime_hours).
- If the site has a fixed generator (cell_sites.has_generator) confirm it started.

## RB-4.2 When to dispatch a portable generator (action A-08)
Dispatch a power technician with a portable generator when **either**:
- battery capacity falls below **50%** and utility restoration is not expected before the battery is exhausted, or
- the site serves a platinum enterprise account or a 911 PSAP.
A site at 48% battery with a utility ETA five hours away WILL go down: dispatch immediately and set the incident to P2. Estimated time to exhaustion = remaining % x rated runtime.

## RB-4.3 Environmental
Cabinet temperature high, door open and fan degraded alarms are P4 unless they persist for more than 4 hours or are combined with equipment alarms.
