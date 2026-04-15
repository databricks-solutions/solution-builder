---
name: Manufacturing & Industrial
slug: manufacturing
category: domain
tags: [manufacturing, iot, predictive-maintenance, quality, supply-chain, industry-4-0]
description: >
  Industry context for manufacturing and industrial demos covering predictive maintenance,
  quality control, supply chain optimization, and IoT sensor analytics. Provides domain
  terminology, OEE benchmarks, plant-floor personas, and regulatory frameworks for
  generating realistic Industry 4.0 Databricks demos.
related: [retail, healthcare]
suggested_patterns: [predictive-maintenance, anomaly-detection, real-time-monitoring, compliance-audit]
suggested_capabilities: [aibi-dashboards, genie-space, declarative-pipeline, notebooks, model-serving, streaming, knowledge-assistant]
---

## Terminology

- **OEE** — Overall Equipment Effectiveness; composite metric of Availability x Performance x Quality (world-class = 85%+)
- **MTBF** — Mean Time Between Failures; average operating time before a component fails
- **MTTR** — Mean Time To Repair; average duration to restore equipment after a failure
- **SPC** — Statistical Process Control; using control charts to monitor process stability (Cp, Cpk indices)
- **SCADA** — Supervisory Control and Data Acquisition; industrial control system collecting real-time sensor data
- **PLC** — Programmable Logic Controller; hardware controlling equipment on the factory floor
- **BOM** — Bill of Materials; hierarchical list of components and quantities needed to build a product
- **Takt time** — Available production time divided by customer demand; sets the pace of production
- **FMEA** — Failure Mode and Effects Analysis; systematic risk assessment ranking failures by severity, occurrence, and detection
- **Cpk** — Process capability index; measures how centered a process is within specification limits (target: >1.33)
- **Digital twin** — Virtual replica of a physical asset updated with real-time sensor data for simulation and prediction
- **MES** — Manufacturing Execution System; software layer between ERP and plant floor tracking production in real time

## KPIs and Baseline Metrics

| KPI | Healthy Baseline | Red Flag |
|-----|-----------------|----------|
| OEE | 75-85% | <65% |
| Unplanned downtime | 5-10% of scheduled time | >15% |
| MTBF (critical equipment) | 2,000-4,000 hours | <1,000 hours |
| MTTR | 1-4 hours | >8 hours |
| First pass yield | 95-99% | <90% |
| Scrap rate | 1-3% | >5% |
| On-time delivery (OTD) | 95-98% | <90% |
| Supplier lead time variance | +/- 2 days | +/- 7 days |
| Energy cost per unit | Varies by industry; track trend | >15% increase QoQ |
| Safety incident rate (TRIR) | 1.0-2.5 per 200K hours | >4.0 |

## Personas

- **Carlos Mendez, VP of Manufacturing Operations** — Owns plant-level OEE, throughput targets, and CapEx decisions. Needs visibility across 4-6 production lines to balance load and prioritize maintenance windows.
- **Angela Park, Director of Quality Engineering** — Responsible for first pass yield, SPC compliance, and customer complaint reduction. Drives root cause analysis on defect escapes using 8D methodology.
- **Tom Braddock, Reliability Engineering Manager** — Manages predictive maintenance programs, spare parts inventory, and maintenance crew scheduling. Trying to shift from time-based to condition-based maintenance.
- **Wei Zhang, Supply Chain Director** — Balances just-in-time inventory against supply disruption risk. Tracks supplier scorecards, lead time variability, and freight costs across a global network.

## Data Entities and Relationships

- **Equipment** (equipment_id, asset_class, manufacturer, model, install_date, location, line_id, criticality_rank)
- **Sensor Readings** (reading_id, equipment_id, sensor_type, timestamp, value, unit) — High volume: 1K-50K readings/sec per plant
- **Maintenance Work Orders** (wo_id, equipment_id, wo_type, priority, created_date, completed_date, technician_id, parts_used, root_cause_code)
- **Production Orders** (order_id, product_id, line_id, planned_qty, actual_qty, start_time, end_time, status)
- **Quality Inspections** (inspection_id, order_id, sample_size, defect_count, defect_type, disposition, inspector_id)
- **Products** (product_id, product_family, bom_id, cycle_time_sec, weight, customer_id)
- **Suppliers** (supplier_id, name, country, lead_time_days, quality_rating, tier)
- **Inventory** (part_id, warehouse_id, on_hand_qty, reorder_point, safety_stock, last_receipt_date)
- **Shipments** (shipment_id, order_id, carrier, ship_date, delivery_date, status, tracking_number)

Key relationships: Equipment -> Sensor Readings (time-series, high-cardinality); Equipment -> Work Orders; Production Orders -> Quality Inspections; Products -> BOM -> Inventory/Suppliers; Production Orders -> Shipments.

## Regulatory and Compliance

- **ISO 9001** — Quality management system standard; requires documented processes, corrective actions, and management reviews with full traceability
- **IATF 16949** — Automotive quality standard extending ISO 9001; mandates SPC, FMEA, PPAP, and defect containment within 24 hours
- **FDA 21 CFR 210/211** — Good Manufacturing Practice for pharmaceuticals; requires batch records, environmental monitoring, and validated data systems
- **OSHA** — Workplace safety standards; recordable incidents tracked via TRIR (Total Recordable Incident Rate)
- **EPA emissions reporting** — Manufacturing facilities must track and report criteria pollutants and greenhouse gases; Scope 1/2/3 emissions increasingly required
- **REACH / RoHS** — EU regulations restricting hazardous substances in products; supply chain traceability required for compliance

## Common Pain Points and Use Cases

1. **Predictive maintenance** — Unplanned downtime costs manufacturers $50B+ annually. Vibration, temperature, and current sensor data can predict bearing failures 2-4 weeks in advance, but models need plant-specific training data and integration with CMMS for work order generation.
2. **Quality defect prediction** — SPC catches drift after it happens. ML models on in-process sensor data (temperature profiles, pressure curves, torque values) can predict defects before parts leave the station, reducing scrap by 30-50%.
3. **Supply chain disruption detection** — Single-source dependencies and long lead times (8-16 weeks for semiconductors, specialty steel) make manufacturers vulnerable. Real-time monitoring of supplier signals, port congestion, and weather events enables proactive mitigation.
4. **Energy optimization** — Energy is 5-15% of manufacturing cost. Load-shifting production to off-peak hours and optimizing equipment operating parameters (motor speeds, furnace temperatures) can reduce consumption 10-20%.
5. **Digital twin and simulation** — Combining real-time sensor data with physics-based models to simulate "what-if" scenarios: line rebalancing, new product introduction, or maintenance window impact on throughput.
6. **Traceability and recall management** — Linking raw material lots through production steps to finished goods and shipments. A single contaminated batch can require tracing millions of units across global distribution in under 24 hours.
