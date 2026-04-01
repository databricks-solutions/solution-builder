# Demo Walkthrough

## Execution Instructions

After building ALL demo resources and passing all acceptance criteria from the build order, write this demo walkthrough script to a **Google Doc** with title: "LuxeBeauty Returns Intelligence — Demo Script".

- Each step must include the **direct URL** to every Databricks resource referenced. Format links as clickable hyperlinks with descriptive text.
- Use headings for each section (Opening, Wow Moment, Walkthrough sections, Recap).
- Include presenter notes in italics for talking points and transitions.
- Include specific click paths, queries to run, and data to highlight — all derived from the actual built demo resources.
- The script is the presenter's single source of truth — if a resource exists, its URL must appear in the step where it is shown.
- The Google Doc MUST begin with a **Demo Assets Overview** — a complete inventory table of every resource created for the demo (resource name, type, direct clickable URL), grouped by category (Data, Compute/Pipelines, Applications/Dashboards), followed by a 2–3 sentence architecture summary.

---

## Pre-Demo Checklist

- [ ] Dashboard loads and shows returns spike ($180K vs normal $60K)
- [ ] Genie Space responds to "Why do I have so many returns?"
- [ ] Knowledge Assistant retrieves incident report for LOT-2025-0212
- [ ] Multi-Agent Supervisor correctly routes between agents
- [ ] All data shows expected patterns (3 products, 1 lot, texture complaints)
- [ ] Browser tabs pre-loaded: Dashboard, MAS (minimize switching during demo)

## Demo Assets

| Asset | Type | Purpose |
|-------|------|---------|
| LuxeBeauty Weekly Operations | AI/BI Dashboard | Shows the anomaly |
| LuxeBeauty Operations Analytics | Genie Space | Answers "what happened" |
| LuxeBeauty Incidents | Knowledge Assistant | Explains "why" |
| LuxeBeauty Operations Assistant | Multi-Agent Supervisor | Entry point for investigation |

---

## Opening (~30 seconds)

> "Every company has this problem: something goes wrong, and it takes days — sometimes weeks — to figure out why. Data lives in one system, documents in another, and the people who could connect the dots are in different meetings."
>
> "Today I'll show you how a VP of Operations at a cosmetics company goes from 'something's wrong' to the complete root cause in under two minutes — using Databricks."

---

## Act 1: The Discovery (~1 minute)

### Scene 1.1: Set the Stage (15 seconds)

> "Meet Claire Dubois, VP of Operations at LuxeBeauty, a cosmetics company. Every Monday morning, she checks her weekly operations dashboard with her coffee — just like she does every week."

### Scene 1.2: The Dashboard (45 seconds)

[Navigate to: LuxeBeauty Weekly Operations Dashboard]

> "Let's see what Claire sees this Monday."
>
> "Revenue looks normal — about $3.8 million. Orders are steady. Items sold on track."

[Show: Returns KPI card]

> "But wait — weekly returns: $180,000. That's... a lot. Usually it's around $60,000."

[Show: Weekly trend chart]

> "Look at this trend. Returns have been steady for weeks, and then this week — it tripled."

[Show: Top products table]

> "And look at these products — three Skincare items with 30% return rates. Everything else is normal at 8%."
>
> "Claire's thinking: 'Why do I have so many returns?'"

---

## Act 2: The Investigation (~3–4 minutes)

### Scene 2.1: Ask the Simple Question (~30 seconds)

[Navigate to: Multi-Agent Supervisor]

> "So Claire opens the Operations Assistant and asks the most natural question..."

[Type: "Why do I have so many returns?"]

> "Watch what happens. She didn't ask a technical question. She didn't say 'run a statistical analysis on return rates by product and lot ID.' She just asked... why."

### Scene 2.2: The Data Analysis (~90 seconds)

*Wait for Genie response to appear*

> "Look at this. The system automatically analyzed the data and found:"

[Show: Spike comparison]

> "Returns are 3x higher than normal — $180K versus the usual $60K."

[Show: Products breakdown]

> "Three Skincare products account for 78% of all returns this week — Hydrating Serum, Vitamin C Cream, and HA Moisture Boost. Each has about a 30% return rate."

[Show: Lot identification]

> "And here's the key — all three products trace to the same production lot: LOT-2025-0212, manufactured on February 12th at the Lyon facility."

[Show: Customer feedback]

> "And look at what customers are saying: 'grainy texture', 'product separated', 'watery consistency'. They're all describing the same problem."

[Show: Suggested next step]

> "The system even suggests: 'Check if there's an incident report for lot LOT-2025-0212.'"
>
> "Claire now knows WHAT happened. But WHY? Let's ask."

### Scene 2.3: Find the Root Cause (~60 seconds)

[Type: "Was there any incident reported for lot LOT-2025-0212?"]

*Wait for KA response*

> "Now watch — the system searches the incident documentation..."

[Show: Incident details]

> "There it is. On February 12th — the same day that lot was produced — the homogenizer equipment had irregular pressure readings. It fluctuated between 2.1 and 2.8 bar when it should stay at 2.4-2.6."

[Show: QC note — the smoking gun]

> "And here's the smoking gun — the QC inspector noted that 'some units may exhibit minor texture variations due to the pressure fluctuations during emulsification.'"

[Show: Disposition]

> "The lot was released anyway because visual inspection passed. They thought it was a minor cosmetic variation."

*[Pause for effect]*

> "In two questions, Claire went from 'Why do I have so many returns?' to the complete answer:"
> - Equipment calibration issue on February 12th
> - Caused texture problems in 2,400 units
> - Customers noticed and returned the products
> - $180K in returns this week
>
> "She knows exactly what happened, why it happened, and what to do about it."

---

## Act 3: The Value (~1 minute)

### Scene 3.1: The Summary (~30 seconds)

> "Let's recap what just happened:"
>
> "One dashboard view showed Claire something was wrong."
>
> "One question — 'Why do I have so many returns?' — triggered a complete investigation."
>
> "The system automatically:"
> - Analyzed trends and found the spike
> - Identified the affected products
> - Traced them to a single production lot
> - Analyzed customer feedback for patterns
> - Found the incident report that explains everything
>
> "Total time: about 2 minutes. No reports to pull. No meetings to schedule. No data team needed."

### Scene 3.2: The Platform Story (~30 seconds)

> "This is the power of unified intelligence."
>
> "The structured data — orders, returns, production lots — lives in Delta tables, processed through pipelines, surfaced by Genie."
>
> "The unstructured data — incident reports, documentation — is indexed by the Knowledge Assistant."
>
> "The Multi-Agent Supervisor knows when to ask which system, and synthesizes the answers."
>
> "Data tells you WHAT happened. Documents tell you WHY. Together, they tell you WHAT TO DO."

---

## Closing

> "Every company has data like this. Operational metrics in databases. Incident reports in documents. But usually they're siloed — you have to know exactly where to look."
>
> "What if your team could investigate like Claire just did? Ask a simple question, get a complete answer."
>
> "That's what Databricks makes possible."

---

## Executive Talk Track

### 60-Second Pitch

"Imagine your VP of Operations sees a spike in returns on their Monday dashboard. Instead of scheduling meetings, pulling reports, and waiting for the data team — they ask one question: 'Why do I have so many returns?' The system automatically analyzes a year of order data, identifies three products from one production lot, reads customer complaints for patterns, and finds the incident report that explains the root cause. Two questions, two minutes, complete answer. That's Databricks: structured data and unstructured documents working together through AI agents to turn a simple question into a comprehensive investigation."

### Expanded Summary (3 minutes)

"LuxeBeauty is a cosmetics company. Their VP of Operations, Claire, checks a weekly dashboard every Monday. This week, returns are $180K — triple the normal $60K. Three Skincare products show 30% return rates versus the usual 8%.

She opens the Operations Assistant — a Multi-Agent Supervisor on Databricks — and asks: 'Why do I have so many returns?' The system routes to a Genie Space connected to their structured data — orders, returns, production lots — all flowing through a medallion pipeline from their Salesforce and NetSuite systems via Lakeflow Connect.

Genie doesn't just answer the question. It performs a complete investigation: compares to baseline, identifies the three affected products, traces them to a single production lot manufactured on February 12th, and analyzes customer feedback. Every customer is saying the same thing: texture problems.

Claire follows up: 'Was there an incident for that lot?' The system routes to a Knowledge Assistant that indexes production incident reports. It finds the smoking gun: the homogenizer had pressure fluctuations that day, causing emulsification problems. QC noted 'minor texture variations' but released the lot because it passed visual inspection.

Two questions, two minutes. Claire now knows the what, the why, and the what-to-do. The structured data told her what happened. The unstructured documents told her why. Together, they told her what to do. That's the power of unified intelligence on Databricks."

---

## Audience Adaptations

### C-Suite

Focus on: ROI, time-to-insight, business impact.
- Lead with "$180K in returns discovered and root-caused in 2 minutes vs 2 days"
- Emphasize no data team involvement, no meetings scheduled
- Frame MAS as "your team's AI-powered analyst that works 24/7"
- Skip: pipeline details, medallion architecture, technical configuration

### Technical Leadership

Focus on: architecture, platform capabilities, integration.
- Show the medallion pipeline (Bronze → Silver → Gold) and data lineage
- Highlight Lakeflow Connect for ingestion, Unity Catalog for governance
- Explain Genie instructions and how domain knowledge is encoded
- Discuss MAS routing logic and how agents compose
- Skip: detailed talk tracks, focus on technical depth

### Individual Contributors

Focus on: implementation patterns, developer experience.
- Walk through data generation and pipeline code
- Show Genie Space configuration and instruction tuning
- Discuss how to create KA with custom retrieval
- Demonstrate MAS agent configuration
- Skip: executive framing, focus on "how would I build this?"

---

## Key Numbers Reference

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Spike week returns | ~$180K |
| Spike multiplier | 3x |
| Affected products | 3 SKUs (SKU-1001, SKU-1002, SKU-1003) |
| Affected lot | LOT-2025-0212 |
| Production date | February 12, 2025 |
| Return rate for lot | ~30% |
| Normal return rate | ~8% |
| Units in affected lot | 2,400 |
| Returns from lot | ~720 |
| Demo duration | 5–7 minutes |
| Time to root cause | ~2 minutes (in-demo) |
