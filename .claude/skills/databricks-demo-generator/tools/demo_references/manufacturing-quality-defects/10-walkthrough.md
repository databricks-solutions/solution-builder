# Walkthrough - Manufacturing Quality Demo

## Demo Script

**Duration:** 10-12 minutes
**Presenter:** Solution Architect
**Audience:** Manufacturing executives, IT leaders

---

## Setup

Before starting:
- Dashboard open to Quality Command Center
- Genie Space ready
- KA ready
- Date context: "Today is March 18, 2024"

---

## Act 1: Business as Usual → Something's Wrong (2 min)

**[Open Dashboard]**

> "Meet Maria Chen, VP of Quality at TitanAuto Parts. They make precision engine components for major automakers.
>
> This is her Quality Command Center. Let's look at what she sees when she logs in this Monday morning."

**[Point to defect rate KPI]**

> "Immediately, something jumps out. Defect rate is 3.2% - that's four times their normal baseline of 0.8%.
>
> That red number means trouble. They have a $2.4 million shipment due to their biggest customer on March 20th. That's two days away."

**[Point to product breakdown chart]**

> "Looking at the breakdown, the problem is concentrated in connecting rods. That's their highest-margin product."

---

## Act 2: Ask Why (3 min)

**[Open Genie]**

> "Maria needs answers fast. Instead of pulling reports and waiting for analysts, she just asks:"

**[Type: "Why are connecting rod defects so high this week?"]**

> "Genie analyzes the production data and immediately identifies the pattern."

**[Show Genie response]**

> "78% of defects trace to a single machine - CNC-B-007 in Building B. And they're all the same defect type: tolerance drift.
>
> That's not random quality variation. That's a systematic issue with one piece of equipment.
>
> 847 parts affected. $2.4 million at risk."

**[Point to machine health table on dashboard]**

> "And look at this - CNC-B-007 shows maintenance is overdue. That PM was due March 8th. It's now March 18th."

---

## Act 3: Get the Full Picture (3 min)

**[Open Knowledge Assistant or MAS]**

> "The data tells us WHAT happened - Machine 7, tolerance drift, maintenance overdue. But WHY was maintenance skipped? Maria needs context the data doesn't have."

**[Type: "What maintenance issues exist for CNC Machine 7?"]**

> "The Knowledge Assistant searches through maintenance records and finds something critical."

**[Show KA response with maintenance report]**

> "A maintenance inspection on March 5th - three days before the scheduled PM - found bearing wear at 78% of replacement threshold. Vibration was elevated. The technician recommended immediate bearing replacement.
>
> But look at this update from March 9th: 'Parts delayed from supplier. PM postponed. Machine returned to production.'
>
> They knew about the issue. They had to make a call."

**[Type: "Why was maintenance delayed?"]**

> "There it is - a Production Priority Memo from March 1st. 'All machines to remain in production through March 15 to meet customer shipment deadline.'
>
> In the pressure to meet Q1 delivery, they deferred what they knew was a critical maintenance issue. Now they're facing a much bigger problem."

---

## Act 4: The Resolution (2 min)

> "In ten minutes, Maria went from 'defects are high' to understanding exactly what happened:
>
> - CNC-B-007 has worn spindle bearings
> - It was flagged on March 5th
> - Maintenance was postponed due to delivery pressure
> - That decision is now costing them potentially $2.4 million
>
> She has everything she needs to act."

**[Value statement]**

> "This used to take days. Pulling reports, coordinating between quality, maintenance, and operations teams. Searching through paper records.
>
> With Databricks, Maria got the answer in minutes. Data and documents, unified on one platform, with AI that connects the dots."

---

## Act 5: What's Next - The Agent (2 min)

> "But here's where it gets really powerful. Maria doesn't just understand the problem - she can act on it immediately.
>
> She can ask a Databricks agent to:
> - Generate an emergency maintenance work order for CNC-B-007
> - Create a rework plan for the 847 affected parts
> - Draft a customer communication about potential shipment delay
> - Recommend which orders to prioritize for rework
>
> The agent has access to the same data and documents. It can take the insight and turn it into action."

---

## Optional: Predictive Extension (2 min)

**[Show ML model results]**

> "And here's the really exciting part - we can prevent this from happening again.
>
> This predictive maintenance model analyzes telemetry patterns - vibration, temperature, operating hours - and predicts which machines are at risk of quality issues.
>
> If this model had been running last week? CNC-B-007 would have been flagged on March 8th - three days before defects started spiking. The rising vibration combined with overdue maintenance would have triggered an alert.
>
> Reactive becomes proactive. Investigation becomes prevention."

---

## Closing

> "This is the Databricks Lakehouse for manufacturing:
>
> - **Data from anywhere** - MES, QMS, IoT sensors, all unified
> - **AI that understands context** - not just data, but documents too
> - **Insights in minutes, not days** - ask questions, get answers
> - **From insight to action** - agents that can execute
>
> Questions?"

---

## Backup Questions

**"What if they don't use Salesforce/NetSuite?"**
> "The data sources are examples. Lakeflow Connect supports 50+ sources, or we can ingest from any system via APIs or file drops."

**"How long to set this up?"**
> "The data pipeline typically takes 2-4 weeks. The AI components - Genie and Knowledge Assistant - can be configured in days once the data is ready."

**"Is the ML model production-ready?"**
> "This is a demo model. In production, you'd train on your specific equipment and validate with your maintenance team. But the approach is proven."
