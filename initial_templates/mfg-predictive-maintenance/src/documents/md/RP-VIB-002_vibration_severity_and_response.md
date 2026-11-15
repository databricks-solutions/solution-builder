# RP-VIB-002 — Vibration Severity Zones and Response Procedure

TechRobotics Industries · Reliability Engineering Procedure · Rev. B
Basis: ISO 10816-style velocity severity zones adapted per asset class, measured as RMS velocity (mm/s) during RUNNING state.

## 1. Severity zones by asset class
| Asset class | Zone A good | Zone B acceptable | Zone C alert | Zone D danger |
|---|---|---|---|---|
| Industrial robot reducer (FANUC / ABB) | < 1.8 | 1.8 – 2.8 | 2.8 – 4.5 | > 4.5 |
| CNC spindle | < 2.3 | 2.3 – 3.5 | 3.5 – 5.5 | > 5.5 |
| Servo press crank | < 3.2 | 3.2 – 4.5 | 4.5 – 7.0 | > 7.0 |
| Air compressor | < 3.5 | 3.5 – 5.0 | 5.0 – 8.0 | > 8.0 |

Relative rule (overrides absolute zones for early warning): a sustained rise to **> 1.5x the asset's own 30-day baseline** is an alert even inside Zone B; **> 2x baseline** is treated as Zone C.

## 2. Response
- Zone C / > 2x baseline: raise a P2 work order within 24 h, schedule in the next planned window (≤ 7 days), pre-stage parts.
- Zone D / > 3x baseline or rising > 10% per day: P1 — reduce speed override to 70% and plan intervention within 48 h.
- Combine with temperature: a concurrent temperature rise > +8 °C points to lubrication breakdown (see ES-ROB-014).

## 3. The failure-risk model
The plant's ML model (failure_risk_model@champion) scores every asset daily with the probability of an unplanned failure within 7 days. Tiers: Critical ≥ 70%, High 40–70%, Watch 15–40%. A Critical score on a bottleneck asset requires the reliability engineer to book a work order the same day.
