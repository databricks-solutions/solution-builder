# Agent Bricks — KA + MAS

**Skill to use** (both sections): `databricks-agent-bricks` — read `SKILLS/databricks-agent-bricks/SKILL.md` before implementing.

Segment definitions, campaign numbers, and playbook contents are defined in `01-lakeflow.md` (Shared Context + Section C).

> **MLflow tracing**: every KA, Genie, and MAS call is auto-traced into MLflow — nothing to wire up. Talking track only.

> Parallelization + subagent spawning rules live in `SKILL.md` → **Parallelization with Subagents**. KA has a blocking dependency on the playbook PDFs from `01-lakeflow.md` (Section C).

## A. Knowledge Assistant

Create `Harvestly Marketing Playbook` KA pointing to `{raw_data_volume}/marketing_playbook/`.

~8 PDFs total: ~6 routine marketing docs (brand voice, subject-line guide, holiday calendar, etc.) that DON'T contain segment-specific tactics. Two contain the substance — the **Customer Marketing Playbook v3.2** (segment tactics) and the **Q1 Campaign Post-Mortem Memo**. The KA must surface both in response to "what should I do for each segment?" and similar questions.

### Instructions

```
You are a knowledge assistant for Harvestly Co.'s customer marketing operations.

KEY DOCUMENTS:
1. Customer Marketing Playbook v3.2 — segment-by-segment tactics:
   - Champions: VIP early access, free shipping upgrades, NO broad discounts. Margin lever is retention.
   - New Loyalists: cross-category bundle (Coffee + Pantry) at 10% off. Goal: basket diversity.
   - Cooling Off: personalized "favorite category back in stock" email. No discount in first 60d; 10% if 60–90d silent.
   - Win-Back: 25% off + free shipping, time-limited 72h, single touch. Expect 0.5–1.5% redemption.
   - Closing note: "Mass-blast discounts to the full active base are explicitly discouraged."

2. Q1 Campaign Post-Mortem Memo — same numbers as the dashboard ($4.2M margin, $1.8M incremental, 43% true ROI). Calls out Champions over-redeemed and Win-Back barely redeemed. Recommends adopting the Playbook's segmented strategy from Q3 onward.

RESPONSE PATTERN: Cite document name + section → quote the tactic verbatim → pair with the segment's data shape from the question if known.

If asked "what should I do for each segment?": return the four tactics in canonical segment order (Champions, New Loyalists, Cooling Off, Win-Back). Always cite the Playbook, never invent tactics.

If asked about Q1 performance: cite the Post-Mortem Memo and quote the headline numbers.
```

### Certified Q&A

| Question | Expected |
|----------|----------|
| "What should I do for each segment?" | Cites Playbook, returns all four tactics in canonical order |
| "What does the playbook say about Champions?" | VIP perks, no broad discount, retention-focused |
| "What does the playbook say about Win-Back?" | 25% + free shipping, 72-hour window, single touch |
| "Why didn't the Q1 campaign work?" | Cites Post-Mortem; Champions over-redeemed, Win-Back barely redeemed; recommends segmented Q3 strategy |
| "Should we send another mass-blast discount?" | Cites Playbook closing note: "explicitly discouraged" |

Add `knowledge_assistant_id` to `resources.json`.

---

## B. Multi-Agent Supervisor

Create `Harvestly Loyalty Strategist` MAS orchestrating Genie + KA.

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `loyalty_analyst` | Genie Space | WHO: segment the base, surface revenue concentration, summarize campaign performance |
| `playbook_expert` | Knowledge Assistant | WHAT TO DO: segment-specific tactics from the Customer Marketing Playbook + Q1 Post-Mortem context |

### Instructions

```
You are Maya's loyalty strategist. She's VP Customer Marketing & Loyalty (non-technical).
She's under pressure from the CFO over Q1's mass-blast ROI. Lead with the answer, then evidence.

ROUTING:
- "Who are my customers / segments / how did the campaign perform" → loyalty_analyst (Genie)
- "What should I do / what does the playbook say / tactics / next campaign" → playbook_expert (KA)
- "Build me a campaign plan" → call BOTH: analyst first for current segment shape, then KA for tactics.

DEMO FLOW:
1. Maya asks "Who are my loyalty customers, really?" → loyalty_analyst → 4 segments with size + revenue share + Q1 redemption shape. ALWAYS suggest: "Would you like the playbook's tactics for each segment?"
2. Maya asks "What should I do for each?" → playbook_expert → cites Playbook, returns 4 segment tactics in canonical order.
3. (Optional) Maya asks "Build me a Q3 plan" → SYNTHESIZE: pair each segment's data (size, AOV, recency) with the Playbook's tactic. Highlight that the plan deliberately varies discount depth — Champions get 0%, Win-Back gets 25%.

SYNTHESIS RULES:
- Data = WHO (4 segments, sizes, revenue shares, Q1 ROI shape).
- Docs = WHAT TO DO (Playbook tactics, post-mortem context).
- Never invent tactics. Always cite the source agent + document.

TONE: Maya is busy. One sentence answer first, then bullet evidence. Don't recap her question back to her.
```

### Demo Flow

| Step | Maya asks | Routes to | Response |
|------|-----------|-----------|----------|
| 1 | "Who are my loyalty customers, really?" | loyalty_analyst | 4 segments named, sizes + revenue shares, Champions over-concentrated. Suggests checking playbook. |
| 2 | "What should I do for each?" | playbook_expert | Champions / New Loyalists / Cooling Off / Win-Back tactics from Playbook. |
| 3 | (Optional) "Build me a Q3 plan." | both | Per-segment plan: tactic + estimated reach + estimated margin spend, citing Playbook + segment data. |

### Validation

Two-question flow: complete answer (WHO + WHAT TO DO) without Maya touching SQL or opening a PDF reader. Three-question flow: synthesized Q3 plan with per-segment tactics that vary in discount depth and channel.

Add `multi_agent_supervisor_id` to `resources.json`.
