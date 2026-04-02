# Demo Walkthrough Script

## Overview

This document provides the complete demo script for the LuxeBeauty Returns Intelligence demo. The demo showcases how one simple question triggers comprehensive AI-powered root cause analysis.

**Demo Duration**: 5-7 minutes
**Key Message**: Natural questions unlock deep insights by combining structured data analysis with unstructured document intelligence.

---

## Pre-Demo Checklist

Before starting, verify:

- [ ] Dashboard loads and shows returns spike ($180K vs normal $60K)
- [ ] Genie Space responds to "Why do I have so many returns?"
- [ ] KA retrieves incident report for LOT-2025-0212
- [ ] MAS correctly routes between agents
- [ ] All data shows the expected patterns (3 products, 1 lot, texture complaints)

---

## Demo Assets

| Asset | Type | Purpose |
|-------|------|---------|
| LuxeBeauty Weekly Operations | Dashboard | Shows the anomaly |
| LuxeBeauty Operations Analytics | Genie Space | Answers "what happened" |
| LuxeBeauty Incidents | Knowledge Assistant | Explains "why" |
| LuxeBeauty Operations Assistant | Multi-Agent Supervisor | Entry point for questions |

---

## Act 1: The Discovery (1 minute)

### Scene 1.1: Set the Stage (15 seconds)

**TALK TRACK**:
> "Meet Claire Dubois, VP of Operations at LuxeBeauty, a cosmetics company. Every Monday morning, she checks her weekly operations dashboard with her coffee - just like she does every week."

---

### Scene 1.2: The Dashboard (45 seconds)

**[OPEN: LuxeBeauty Weekly Operations Dashboard]**

**TALK TRACK**:
> "Let's see what Claire sees this Monday.
>
> Revenue looks normal - about $3.8 million. Orders are steady. Items sold on track.
>
> [POINT TO RETURNS KPI]
>
> But wait - weekly returns: $180,000. That's... a lot. Usually it's around $60,000.
>
> [POINT TO WEEKLY TREND]
>
> Look at this trend. Returns have been steady for weeks, and then this week - it tripled.
>
> [POINT TO PRODUCT TABLE]
>
> And look at these products - three Skincare items with 30% return rates. Everything else is normal at 8%.
>
> Claire's thinking: 'Why do I have so many returns?'"

---

## Act 2: The Investigation (3-4 minutes)

### Scene 2.1: Ask the Simple Question (30 seconds)

**[OPEN: Multi-Agent Supervisor]**

**TALK TRACK**:
> "So Claire opens the Operations Assistant and asks the most natural question..."

**[TYPE]**: "Why do I have so many returns?"

> "Watch what happens. She didn't ask a technical question. She didn't say 'run a statistical analysis on return rates by product and lot ID.' She just asked... why."

---

### Scene 2.2: The Data Analysis (90 seconds)

*Wait for Genie response*

**TALK TRACK** (as response appears):
> "Look at this. The system automatically analyzed the data and found:
>
> [POINT TO SPIKE]
> Returns are 3x higher than normal - $180K versus the usual $60K.
>
> [POINT TO PRODUCTS]
> Three Skincare products account for 78% of all returns this week - Hydrating Serum, Vitamin C Cream, and HA Moisture Boost. Each has about a 30% return rate.
>
> [POINT TO LOT]
> And here's the key - all three products trace to the same production lot: LOT-2025-0212, manufactured on February 12th at the Lyon facility.
>
> [POINT TO CUSTOMER FEEDBACK]
> And look at what customers are saying: 'grainy texture', 'product separated', 'watery consistency'. They're all describing the same problem - something's wrong with the texture.
>
> [POINT TO SUGGESTION]
> And the system even suggests: 'Check if there's an incident report for lot LOT-2025-0212.'
>
> Claire now knows WHAT happened. But WHY? Let's ask."

---

### Scene 2.3: Find the Root Cause (60 seconds)

**[TYPE]**: "Was there any incident reported for lot LOT-2025-0212?"

*Wait for KA response*

**TALK TRACK**:
> "Now watch - the system searches the incident documentation...
>
> [POINT TO INCIDENT DETAILS]
> There it is. On February 12th - the same day that lot was produced - the homogenizer equipment had irregular pressure readings. It fluctuated between 2.1 and 2.8 bar when it should stay at 2.4-2.6.
>
> [POINT TO KEY FINDING]
> And here's the smoking gun - the QC inspector noted that 'some units may exhibit minor texture variations due to the pressure fluctuations during emulsification.'
>
> [POINT TO DISPOSITION]
> The lot was released anyway because visual inspection passed. They thought it was a minor cosmetic variation.
>
> [PAUSE FOR EFFECT]
>
> In two questions, Claire went from 'Why do I have so many returns?' to the complete answer:
> - Equipment calibration issue on February 12th
> - Caused texture problems in 2,400 units
> - Customers noticed and returned the products
> - $180K in returns this week
>
> She knows exactly what happened, why it happened, and what to do about it."

---

## Act 3: The Value (1 minute)

### Scene 3.1: The Summary (30 seconds)

**TALK TRACK**:
> "Let's recap what just happened:
>
> One dashboard view showed Claire something was wrong.
>
> One question - 'Why do I have so many returns?' - triggered a complete investigation.
>
> The system automatically:
> - Analyzed trends and found the spike
> - Identified the affected products
> - Traced them to a single production lot
> - Analyzed customer feedback for patterns
> - Found the incident report that explains everything
>
> Total time: about 2 minutes. No reports to pull. No meetings to schedule. No data team needed."

---

### Scene 3.2: The Platform Story (30 seconds)

**TALK TRACK**:
> "This is the power of unified intelligence.
>
> The structured data - orders, returns, production lots - lives in Delta tables, processed through pipelines, surfaced by the Genie.
>
> The unstructured data - incident reports, documentation - is indexed by the Knowledge Assistant.
>
> The Multi-Agent Supervisor knows when to ask which system, and synthesizes the answers.
>
> Data tells you WHAT happened. Documents tell you WHY. Together, they tell you WHAT TO DO."

---

## Closing

**TALK TRACK**:
> "Every company has data like this. Operational metrics in databases. Incident reports in documents. But usually they're siloed - you have to know exactly where to look.
>
> What if your team could investigate like Claire just did? Ask a simple question, get a complete answer.
>
> That's what Databricks makes possible."

---

## Key Numbers to Remember

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Spike week returns | ~$180K |
| Spike multiplier | 3x |
| Affected products | 3 SKUs |
| Affected lot | LOT-2025-0212 |
| Production date | February 12, 2025 |
| Return rate for lot | ~30% |
| Normal return rate | ~8% |
| Units in affected lot | 2,400 |
| Returns from lot | ~720 |
