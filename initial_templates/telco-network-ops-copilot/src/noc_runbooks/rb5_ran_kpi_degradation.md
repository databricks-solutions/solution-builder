# Halcyon Wireless NOC Runbook — Chapter RB-5: RAN KPI degradation (no alarm)

Many RF faults degrade service without ever crossing an equipment alarm threshold. The KPI anomaly model (cell_kpi_anomaly_model) flags cells whose KPIs deviate from their own baseline.

## RB-5.1 Service thresholds
| KPI | Target | Investigate | Customer-affecting |
|---|---|---|---|
| Dropped-call rate | < 0.8% | > 1.2% | > 2.0% |
| RRC setup success | > 99.0% | < 98.5% | < 97.0% |
| VSWR | < 1.5 | 1.5 - 2.0 | vendor alarm at 2.0 |

## RB-5.2 VSWR rising on ONE sector with a rising dropped-call rate
Signature of **water ingress or a loose connector in the jumper / feeder at the antenna** of that sector (typically after rain or freeze-thaw cycles). SINR falls, drops rise, the other sectors of the site stay normal. The vendor VSWR alarm (2.0) usually fires only when the jumper is close to failure.
Action: **dispatch a tower crew (action A-07)** — two climb-certified technicians (skill `rf_tower`), line sweep (VSWR / distance-to-fault) to locate the fault, replace the jumper, weatherproof the connectors. Typical time on site 3-4 hours. Priority **P3**, raised to **P2** when the dropped-call rate exceeds 2.0% on a sector serving more than 2,500 subscribers or an enterprise account.
Remote mitigation while waiting: none effective for VSWR — do not change tilt.

## RB-5.3 Rising uplink interference
Uplink interference above -100 dBm (vs a typical -105 to -110) with falling RRC success = external interference source (faulty signal booster, jammer, other operator). Action: remote RF parameter check (A-09) and an RF engineer interference hunt with a spectrum analyzer. Priority P3.

## RB-5.4 Congestion
High PRB utilization (> 90% at busy hour) with falling RRC success on all sectors = capacity, not a fault. Check planned_activity for a local event. If an event explains it, close as explained (RB-6).
