# Halcyon Wireless NOC Runbook — Chapter RB-1: Incident priority, SLAs and notification

Owner: Network Operations Center (NOC), Denver. Applies to every incident opened by the NOC shift.

## RB-1.1 Priority matrix
| Priority | Definition | Target restore | Bridge / escalation |
|---|---|---|---|
| **P1** | 20 or more cell sites down, OR any aggregation / core router isolated, OR a platinum enterprise site or 911 PSAP site down | 4 hours | Open a major-incident bridge within 15 minutes; page the Director of Network Operations |
| **P2** | 2-19 sites down, OR a single site with a platinum/gold enterprise account down, OR a site on battery with less than 50% capacity and no generator | 8 hours | NOC shift lead owns; transport or field manager on call notified |
| **P3** | Single site / sector degraded but in service (KPI degradation, one sector down, microwave fade that recovered with no customer impact) | 3 business days | Normal work queue |
| **P4** | Informational, cleared, explained by planned work | Close within 24 hours | None |

Priority is decided on **customer impact**, not on alarm count. An alarm storm of hundreds of alarms that shares one root cause is ONE incident (see RB-2).

## RB-1.2 Enterprise and critical-facility notification
- **Platinum** accounts (4-hour restore SLA, e.g. hospitals, emergency communications): notify the account's enterprise care desk **within 30 minutes** of confirmed impact, then every 60 minutes until restored. SLA credits start accruing at 4 hours.
- **Gold** accounts (8-hour SLA): notify within 60 minutes.
- **Silver** accounts (24-hour SLA): notify within 4 hours.
- A site serving a **911 PSAP** (primary or backup): notify the PSAP operations desk within 15 minutes and log it on the incident.
- Any P1: executive notification (VP Network Operations) within 30 minutes.

## RB-1.3 Customer-care advisory
For P1/P2 incidents with more than 5,000 subscribers impacted, publish a customer-care advisory (area, expected restore time) so care agents stop troubleshooting individual handsets.
