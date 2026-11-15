# PPAP Submission Summary — Hanlin Electronics Co. — MC-48 Hub-Motor Controller

**Document:** BWC-PPAP-HAN-MC48-2024 · **Supplier:** Hanlin Electronics Co., Dongguan, China (SUP-HAN)
**Part:** MC-48 48 V hub-motor controller, Brightwater P/N 30-4801 · **PPAP level:** 3 · **Status:** APPROVED 2024-09-20
**Brightwater SQE:** Lena Ortiz · **Supplier quality manager:** Wei Zhang

## 1. Scope
Full PPAP Level 3 for the MC-48 controller used on the Commuter C3, Cargo K2 and Fold F1 e-bikes (rear hub-motor
platform). The Trail T5 mid-drive uses the Kessler MC-60 controller and is out of scope.

## 2. Design record and critical characteristics
| # | Characteristic | Specification | Class |
|---|---|---|---|
| CC-1 | Conformal coating material | **AC-220 acrylic conformal coating** (IPC-CC-830 qualified) | Critical |
| CC-2 | Conformal coating thickness | **50–75 µm** dry film, measured on 5 coupons per lot | Critical |
| CC-3 | Housing ingress protection | IP65 (dust tight, water jets) with gasket G-48 | Critical |
| SC-1 | Phase MOSFET solder joint voiding | < 25 % (X-ray, 1 board / 200) | Significant |
| SC-2 | Hall-sensor header pull force | ≥ 18 N | Significant |

## 3. Validation results (DVP&R)
- **Damp heat, 85 °C / 85 % RH, 1,000 h:** 12/12 boards pass, no dendritic growth, insulation resistance > 100 MΩ.
- **Salt spray, ASTM B117, 96 h (housing + coated board):** 6/6 pass.
- **Water-jet IP65 + thermal shock (−20 °C ↔ 60 °C, 200 cycles):** 6/6 pass, no functional fault.
- **Vibration (ISO 4210-6 profile):** pass.

## 4. Process flow / control plan highlights
Coating is applied by selective spray robot, cured 30 min at 60 °C, and inspected under UV light (100 %).
Thickness is measured on witness coupons each shift. Any change to coating material, thickness, supplier of the
coating, or cure process is a **Class 1 change** under the Supplier Quality Agreement (SQA-HAN-2024-07 §5) and
**requires Brightwater's written approval and a new PPAP (Level 3, incl. damp-heat and salt-spray re-test) before
shipment**.

## 5. Part Submission Warrant
PSW signed by Hanlin 2024-09-12; approved by Brightwater SQE 2024-09-20 for serial production starting lot HX-2409.
