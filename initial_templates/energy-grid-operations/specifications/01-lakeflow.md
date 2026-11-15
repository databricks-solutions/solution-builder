# 01 — Data, load forecast & gold tables

**Where:** `energy_utilities.grid_operations_copilot` (DAB variables `catalog` / `schema`).
**Built by:** `data_generation/generate_data.py` (DAB job `grid_ops_setup`, task `generate_data`, serverless, numpy + pandas).
Deterministic (seed `20260721`), idempotent (every table `overwrite`, `operator_actions` recreated empty).

## Time anchor
"Now" is pinned to **Tue 2026-07-21 14:00 local** (stored as naive timestamps — no TZ conversion anywhere).
History = 8,760 hourly points back from now; forecast = 48 h ahead. Heat wave: highs 91 → 96 → 98 (today) → **103** (tomorrow) → 99 °F (+1.4 °F at North Ridge).
A past heat wave (11-15 Aug 2025, high 101 °F) contains the T-104 over-temperature trip.

## Network (fictional MREC, Iowa-ish coordinates)
6 substations · 12 power transformers (22.4-33.6 MVA) · 40 feeders (12.47 kV) · 154,504 customers.

## Tables
| table | grain | notes |
|---|---|---|
| substations | 6 | lat/lon for the map |
| transformers | 12 | nameplate + 120 % emergency MVA, age, replacement cost / lead time |
| feeders | 40 | transformer, customers, class mix, 12-month peak MW |
| critical_facilities | 12 | hospitals, water, cooling centers, emergency services |
| dr_enrollments | 81 | C&I emergency DR + Smart-Thermostat Peak Savers, committed kW × expected performance |
| der_assets | 4 | batteries, smart-inverter solar, wind |
| tie_switches | 4 | normally-open ties (e.g. TS-417 NR-14 ↔ CF-03) |
| weather_hourly | 52,848 | per substation, observations + NWS forecast (`is_forecast`) |
| feeder_load_hourly | 350,400 | SCADA MW / MVAr / PF / voltage |
| transformer_telemetry_hourly | 105,120 | load MVA, loading %, ambient, top-oil, hot-spot, IEEE C57.91 aging factor |
| dga_readings | 288 | monthly dissolved-gas lab results, IEEE C57.104 condition |
| outage_events | 623 | cause, device, customers interrupted, CMI |
| reliability_monthly | 13 | SAIDI / SAIFI / CAIDI vs target (12-month = SUM of monthly) |
| transformer_load_forecast | 576 | 48 h × 12 — forecast MVA + P10/P90 + thermal forecast |
| transformer_health | 12 | GOLD: health index, forecast peak, risk tier, drivers, customers, critical facilities |
| relief_options | 3 | GOLD: costed options for every transformer forecast > 95 % |
| relief_option_hourly | 144 | baseline vs post-action curve per option |
| operator_actions | 0 at setup | WRITE-BACK from the app / agent |

## Load forecast model
Per transformer, weighted ridge regression (recent days weighted, 120-day e-folding) on
hour-of-day one-hot, weekend, cooling-degree terms (+ evening interaction), heating degrees, trend and the
scheduled Ridgeline Data Center MW. Trained on 12 months of SCADA, scored on the 48 h NWS forecast,
persistence-blended for the first hours, 80 % band from 60-day residuals (MAPE ≈ 2 %).
Thermal: IEEE C57.91 steady-state rises (Δθ_TO 55 °C, Δθ_H 25 °C, R 4.5, n = m = 0.8) with a 3 h top-oil
time constant; T-104 carries a 4.5 % cooling-degradation penalty.

## Planted signal (verified)
`transformer_health` ORDER BY forecast_peak_pct DESC → **T-104 107.2 %**, 26.79 MVA at Wed 17:00, 4 h over
nameplate, hot-spot 122.9 °C, aging 3.6×, health index 26 (Poor, DGA Condition 3: ethylene 177 ppm vs 46 six
months ago), 14,200 customers — CRITICAL. Decoy **T-109 92.1 %**, healthy (85) — WATCH. All others < 80 %.
Why T-104: Ridgeline Data Center energised +4 MW on NR-13 since Feb 2026 + EV / heat-pump growth.
`relief_options` (T-104): #1 demand response 5.32 MVA, $23k, 2,493 voluntary participants → 94.8 % / 109.6 °C;
#2 switching NR-14 → CF-03 via TS-417 $1.8k → 94.8 % but T-106 → 100.4 % and N-1 lost for 4,300 customers;
#3 battery + solar $4.2k → 101.9 % / 118.5 °C, does not clear. Reliability: SAIDI 139.1 min (target 125),
SAIFI 1.253 (target 1.10); the Aug-2025 T-104 trip alone = ~20 SAIDI minutes.

## Production mapping (talking track)
SCADA/historian via Zerobus or Lakeflow Connect (OSIsoft PI / ADMS), NWS gridded forecast API, asset
registry + DGA lab via Lakeflow Connect, DR/DERMS program data — into an SDP medallion; the forecast
would be an MLflow-registered model scored hourly by a Lakeflow Job.
