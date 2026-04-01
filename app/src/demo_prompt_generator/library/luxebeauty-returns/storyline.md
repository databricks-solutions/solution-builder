# Storyline

## Company Profile

- **Company**: LuxeBeauty Co. — Direct-to-consumer cosmetics e-commerce
- **Persona**: Claire Dubois, VP of Operations
- **Manufacturing**: Single facility in Lyon, France
- **Scale**: ~80 SKUs across Skincare, Makeup, and Haircare; ~900 orders/week baseline
- **Data sources**: Orders and customers from Salesforce (via Lakeflow Connect), production lots and inventory from NetSuite (via Lakeflow Connect). Implementation uses synthetic data.

## The Incident (Background — Not Shown in Demo)

| Date | Event |
|------|-------|
| **Feb 12, 2025** | Homogenizer Unit HMG-03 experiences pressure gauge fluctuations (2.1–2.8 bar vs normal 2.4–2.6 bar). Lot LOT-2025-0212 is produced across 3 SKUs (~800 units each, 2,400 total). QC notes "minor texture variations" but visual inspection passes — lot released for distribution. |
| **Feb 12 – Mar 15** | Products from the affected lot ship gradually (~2,400 units across SKU-1001, SKU-1002, SKU-1003) |
| **Feb 20 – Mar 25** | Returns accumulate as customers notice texture issues (grainy, separated, watery) |
| **Mar 24, 2025** | Claire sees the spike in her Monday dashboard — **DEMO STARTS HERE** |

## Key Numbers

| Metric | Value |
|--------|-------|
| Normal weekly returns | ~$60K |
| Spike week returns | ~$180K (3x normal) |
| Affected lot | LOT-2025-0212 |
| Affected products | SKU-1001 (Hydrating Serum 30ml, $68), SKU-1002 (Vitamin C Cream 50ml, $55), SKU-1003 (HA Moisture Boost 15ml, $42) |
| Units in lot | 2,400 (~800 per SKU) |
| Return rate for lot | ~30% (vs 8% normal) |
| Returns from lot | ~720 |
| Peak returns week | March 17–23, 2025 (~250 returns, ~$180K) |
| Revenue at risk | ~$500K (remaining unshipped + potential future returns) |

## Wow Moment

The wow moment is **Question 1**: Claire asks "Why do I have so many returns?" and the system — without any further prompting — automatically analyzes trends, identifies the 3 affected products, traces them to a shared production lot, extracts customer feedback patterns, and suggests checking incident documentation. One natural question triggers a complete investigation that would have taken a data team days.

## Domain Glossary

| Term | Meaning |
|------|---------|
| Lot | A production batch from a single manufacturing run, identified by date (LOT-YYYY-MMDD) |
| Emulsification | Process of mixing oil and water phases in cosmetics; requires precise pressure and temperature |
| Homogenizer | Equipment that creates uniform texture in cosmetics; pressure fluctuations cause inconsistency |
| QC (Quality Control) | Post-production inspection before release to market |
| Return rate | Percentage of sold units returned — 8% is normal for cosmetics, 30% is a red flag |
| PIR | Production Incident Report — internal document filed when equipment issues occur |

---

## Act 1: The Discovery (1 minute)

**Setting**: Monday morning. Claire opens her weekly operations dashboard with her coffee.

**What the audience sees**: A normal-looking operational dashboard where one metric (returns) clearly stands out.

**Talk Track**:
> "Meet Claire Dubois, VP of Operations at LuxeBeauty, a cosmetics company. Every Monday morning, she checks her weekly operations dashboard with her coffee — just like she does every week."
>
> "Let's see what Claire sees this Monday."
>
> "Revenue looks normal — about $3.8 million. Orders are steady. Items sold on track."
>
> "But wait — weekly returns: $180,000. That's triple the usual $60K. Look at this trend — returns have been steady for weeks, and then this week it tripled."
>
> "And these three Skincare products have 30% return rates when everything else is at 8%."
>
> "Claire's thinking: 'Why do I have so many returns?'"

**Key visual elements**:
- 4 KPI cards: Revenue (~$3.8M, normal), Orders (~924, normal), Items Sold (~1,450, normal), **Returns (~$180K, SPIKE)**
- Weekly trend chart: flat returns line with sharp uptick in most recent week
- Products table: 3 Skincare items with ~30% return rate vs 8% for everything else

---

## Act 2: The Investigation (3–4 minutes)

### Question 1: "Why do I have so many returns?"

Claire opens the Multi-Agent Supervisor and asks the most natural question. The system routes to Genie, which analyzes the structured data and finds:

- Returns are 3x higher than normal ($180K vs $60K)
- 3 Skincare products account for 78% of all returns this week
- All three products trace to the same production lot: LOT-2025-0212, manufactured Feb 12 at Lyon
- Customer feedback shows a pattern: "grainy texture", "product separated", "watery consistency"
- Suggested next step: "Check if there's an incident report for this lot"

**Talk Track**:
> "So Claire opens the Operations Assistant and asks the most natural question..."
>
> [Type: "Why do I have so many returns?"]
>
> "Watch what happens. She didn't ask a technical question. She didn't say 'run a statistical analysis on return rates by product and lot ID.' She just asked... why."
>
> "Look at this. The system automatically analyzed the data and found:"
>
> "Returns are 3x higher than normal. Three Skincare products account for 78% of all returns. And here's the key — all three trace to the same production lot: LOT-2025-0212, manufactured on February 12th."
>
> "And look at what customers are saying: 'grainy texture', 'product separated', 'watery consistency'. They're all describing the same problem."
>
> "The system even suggests: 'Check if there's an incident report for lot LOT-2025-0212.'"
>
> "Claire now knows WHAT happened. But WHY? Let's ask."

### Question 2: "Was there any incident reported for lot LOT-2025-0212?"

The system routes to the Knowledge Assistant, which searches incident documentation and finds:

- Incident report PIR-2025-0212 from February 12
- Homogenizer HMG-03 had pressure fluctuations during emulsification (2.1–2.8 bar vs normal 2.4–2.6 bar)
- QC noted "some units may exhibit minor texture variations due to the pressure fluctuations during emulsification"
- Lot was released because visual inspection passed
- Root cause: calibration drift in pressure regulation valve

**Talk Track**:
> [Type: "Was there any incident reported for lot LOT-2025-0212?"]
>
> "Now watch — the system searches the incident documentation..."
>
> "There it is. On February 12th — the same day that lot was produced — the homogenizer equipment had irregular pressure readings."
>
> "And here's the smoking gun — the QC inspector noted that 'some units may exhibit minor texture variations due to the pressure fluctuations during emulsification.'"
>
> "The lot was released anyway because visual inspection passed. They thought it was a minor cosmetic variation."
>
> "In two questions, Claire went from 'Why do I have so many returns?' to the complete answer:"
> - Equipment calibration issue on February 12th
> - Caused texture problems in 2,400 units
> - Customers noticed and returned the products
> - $180K in returns this week
>
> "She knows exactly what happened, why it happened, and what to do about it."

---

## Act 3: The Value (1 minute)

**Talk Track**:
> "Let's recap what just happened:"
>
> "One dashboard view showed Claire something was wrong."
>
> "One question — 'Why do I have so many returns?' — triggered a complete investigation."
>
> "The system automatically analyzed trends, identified the affected products, traced them to a single production lot, analyzed customer feedback for patterns, and found the incident report that explains everything."
>
> "Total time: about 2 minutes. No reports to pull. No meetings to schedule. No data team needed."

**Platform Story**:
> "This is the power of unified intelligence."
>
> "The structured data — orders, returns, production lots — lives in Delta tables, processed through pipelines, surfaced by Genie."
>
> "The unstructured data — incident reports, documentation — is indexed by the Knowledge Assistant."
>
> "The Multi-Agent Supervisor knows when to ask which system, and synthesizes the answers."
>
> "Data tells you WHAT happened. Documents tell you WHY. Together, they tell you WHAT TO DO."
>
> "That's what Databricks makes possible."

**Agent-powered next step** (narrative only):
> "And now Claire can go further. She asks a Databricks agent to generate personalized win-back offers for the ~720 affected customers — each one tailored to the customer's purchase history and loyalty tier. An agent that used to take her team two weeks of manual work, done in minutes."

---

## Closing

> "Every company has data like this. Operational metrics in databases. Incident reports in documents. But usually they're siloed — you have to know exactly where to look."
>
> "What if your team could investigate like Claire just did? Ask a simple question, get a complete answer."
>
> "That's what Databricks makes possible."
