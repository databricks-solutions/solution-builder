# Agent Bricks — KA + MAS

**Skill to use** (both sections): `databricks-agent-bricks` — read `SKILLS/databricks-agent-bricks/SKILL.md` before implementing.

Affected products, lot, and texture complaints defined in 01-lakeflow.md (Shared Context).

> **MLflow tracing**: every KA, Genie, and MAS call is auto-traced into MLflow — nothing to wire up. The app links to those traces from the chat UI (see `specifications/app/00_OVERVIEW.md`). Talking track only; no extra resource to build.

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**. KA has a blocking dependency on the incident PDFs from `01-lakeflow.md` (Section C).

## A. Knowledge Assistant

Create `LuxeBeauty Incidents` KA pointing to `{raw_data_volume}/incident_pdf/`.

~10 PDFs total: ~9 routine facility docs (resolved incidents, QC summaries, maintenance logs) that DON'T mention the affected lot. Only 1 contains the smoking gun — the KA must find the needle, which makes the demo impressive.

### Instructions

```
You are a knowledge assistant for LuxeBeauty Co.'s production incident reports.

KEY DOCUMENT: Incident report for the affected lot contains:
- Equipment: Homogenizer Unit HMG-03 at Lyon
- Issue: Pressure fluctuations (2.1-2.8 bar vs normal 2.4-2.6 bar)
- Cause: Calibration drift in pressure regulation valve
- Products: SKU-1001, SKU-1002, SKU-1003 (~5,000 units)
- QC Note: "texture variations due to pressure fluctuations during emulsification"
- Disposition: RELEASED despite the issue

RESPONSE PATTERN: Cite document name + report number → quote QC assessment → mention lot was released → connect to customer complaints about "grainy texture" and "separated product".
```

### Certified Q&A (validate before publishing)

*"Was there any incident for this lot?"* → finds the report, quotes pressure fluctuations + QC note + release decision. *"What caused the texture problems?"* → homogenizer pressure during emulsification. *"Why was the lot released?"* → QC deemed it "cosmetic variation only".

Add `knowledge_assistant_id` to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `LuxeBeauty Operations Assistant` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `data_analyst` | Genie Space | WHAT: returns, products, lots, customer feedback, **`final_tier` from the premium classifier (gold_customer_premium_predictions)** |
| `incident_expert` | Knowledge Assistant | WHY: production incidents, equipment issues |

### Instructions

```
You are Claire's operations assistant. She's VP of Ops (non-technical), needs fast answers.

ROUTING:
- Returns/data questions → data_analyst first
- Incident/production questions → incident_expert
- Customer-action / "what should we do" questions → data_analyst (queries gold_customer_premium_predictions to tier the response)

DEMO FLOW:
1. Claire asks about returns → data_analyst → 3x spike, SKU-1001/1002/1003, common lot, texture complaints
2. ALWAYS suggest: "Would you like me to check for production incidents for this lot?"
3. Claire asks about incident → incident_expert → homogenizer pressure, lot released despite QC note
4. Claire asks "help me handle these 250 customers" → data_analyst joins the affected-customer set with `gold_customer_premium_predictions` → reports the tier split (~67 premium / ~183 standard, of which ~18 already-tagged + ~49 model-found hidden premiums) → drafts a TIERED retention offer.

TIERED OFFER (must be applied every time the retention action runs):
- Premium customers (final_tier = 'premium', whether CS-tagged OR model-predicted) → personal apology email + 20% coupon
- Standard customers (final_tier = 'standard')                                      → standard apology email + 5% goodwill coupon

ALWAYS report the per-country breakdown (`gold_customer_premium_predictions` joined with `bronze_customers.country`) for the premium cohort — Claire wants to know which markets are most exposed. ALWAYS call out the hidden-premium count (`premium_status_labeled IS NULL AND is_premium_predicted = true`) so the story lands: "CS had tagged 18; the model found 49 more."

SYNTHESIS: Data = WHAT (3x returns, 3 products, 1 lot, texture complaints). Docs = WHY (homogenizer pressure, released anyway). Model = WHO TO PRIORITIZE (~67 of 250 are premium — 18 already-tagged, 49 hidden premiums the model surfaced — mostly FR + IT). Action: tiered retention offer, contact customers, consider recall, fix equipment.

TONE: Claire is busy. Lead with the answer, then details.
```

### Demo Flow

| Step | Claire asks | Routes to | Response |
|---|---|---|---|
| 1 | "Why do I have so many returns?" | data_analyst | 3x spike, SKU-1001/1002/1003, texture complaints, suggests checking incidents |
| 2 | "Was there an incident for that lot?" | incident_expert | Homogenizer pressure, QC note, lot released anyway |
| 3 | "Help me handle the 250 affected customers" *(or featured action)* | data_analyst | Joins affected set with `gold_customer_premium_predictions` → "67 premium (18 already tagged + 49 the model found, mostly FR + IT), 183 standard. Drafting tiered offers: 20% + apology for the 67, 5% goodwill for the rest." |

### Validation

Steps 1–2: two questions reach full root cause (WHAT + WHY). Step 3: agent joins affected-customer set with `gold_customer_premium_predictions`, returns a tier split near ~67/~183 with the labeled-vs-predicted breakdown visible (~18 labeled + ~49 hidden). Numbers vary by training run — the *behavior* is what's validated: meaningful premium minority, model contributes most of them. MLflow trace shows the prediction lookup as a tool call.

Add `multi_agent_supervisor_id` to `resources.json`.
