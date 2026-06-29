# Stage 01 — Design the Story & Generate Top-Level Files

Run this after Stage 0 (Capture Intent) has settled on a story direction, and before the stage-1 user-review gate.

Produces three files at the project root: `resources.json`, `README.md`, `architecture.md`.

## Design the story

Nail down the specifics. The exact structure depends on the story pattern, but define (unless instructed otherwise):

1. **The Protagonist** — Company name, industry, persona name and role, what they care about.
2. **The Setup** — What's normal, what context the audience needs.
3. **The Catalyst** — What triggers the demo flow (a spike, a question, a prediction, an alert). Two non-negotiables you commit to here, because they shape every downstream spec:
   - **Signal must be visible to the eye.** When the demo's dashboards render the catalyst, anyone in the room should be able to point at it without squinting. Realistic noise + a subtle event = invisible chart and the wow moment evaporates. If you can't tell something happened at a glance, dial the event up, the noise down, or both. Make the trade-off explicit in the story (e.g. *"the four laggard vessels' fuel anomaly must dominate normal day-to-day variance from weather and speed"*).
   - **Temporal realism — prefer peak in the past, not at the chart edge.** The event must sit clearly in the past with a visible build-up → peak → decay back toward baseline. Place the peak ~2–4 weeks ago and anchor it explicitly (`SPIKE_PEAK = NOW − 3 weeks`, `DECAY_START = NOW − 2 weeks`). A spike at the rightmost edge of a chart looks like a cliff, not a story, avoid it unless asked about it.
4. **The Journey** — How the protagonist uses the platform to get from question to answer.
5. **The Resolution** — What they learn, the business impact (in $), what action they take.
6. **The Value** — One-sentence "so what" that lands with the audience.

**Match products to story moments** — each product should have a clear "when it shines" moment in the walkthrough. Drop any from the story that don't earn a moment; add any the user requests.

**Important**: keep `resources.json` up to date with *all* product capabilities the demo needs. Some technical-only products (e.g. data generation) live in `resources.json` because the implementation needs them, but don't appear in the README's story (they have no wow effect to narrate).

## Context load — one message, batched reads

Before writing any file, load all references in a single response. All reads in ONE turn.

- `DEMO_SKILL_DIR/references/architecture/architecture.md` — diagram schema
- **Style reference (pick one based on capabilities)** — read at most one for README format:
  - **Simple demo** (capabilities ⊆ {`synthetic-data-gen`, `aibi-dashboards`, `genie`, `databricks-apps`, `lakebase`} plus talking-track): `DEMO_SKILL_DIR/references/example-luxebeauty-simple/README.md`
  - **Full demo** (any of `sdp`, `metric-views`, `ml-training-serving`, `knowledge-assistant`, `supervisor-agent`): `DEMO_SKILL_DIR/references/example-luxebeauty/README.md`
- `DEMO_SKILL_DIR/references/platform_architecture.md` — if not already in context
- Any capability blocks you need for product positioning (skip if obvious from common knowledge; dashboard/KA blocks are often worth reading)

## Write the three files (single batched turn)

Emit `Write` calls for `resources.json`, `architecture.md`, and `README.md` **in one assistant message** — three `Write` tool uses, one after the other in your output, sent together. The harness runs them concurrently once your turn ends, so you save LLM round-trips (you still generate each file's content token-by-token). The files are independent; coherence comes from your plan, not from reading one file to write the next.

### `./resources.json`

`resources.json` is **already seeded** at the project root with the selected capabilities and an empty `created_resources: {}`. Your job is to **verify/adjust the capabilities** in the existing file and rewrite it — not to invent it from scratch. The user's message may include a capabilities list — follow it unless something is missing or incoherent (e.g. user wants an app but it's not listed, or data gen is missing). In that case, adjust and note the adjustment. Avoid adding capabilities just for the sake of it.

Structure (the matching example — `example-luxebeauty-simple/resources.json` for simple builds, `example-luxebeauty/resources.json` for full builds — is a **naming reference for the keys the build phase will add**, NOT a scaffold to copy; its `created_resources` is shown fully populated because it's a *finished* demo):

```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {}
}
```

- **buildable**: capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps).
- **talking_track**: capabilities mentioned in the demo narrative but not requiring resource creation.
- **created_resources**: **leave it `{}` now.** Do NOT copy the example's IDs or pre-seed placeholder/empty keys — the build phase adds each real ID only after it creates that resource. The UI renders a link for any key present here, so a placeholder becomes a dead link.

Capability IDs come from `DEMO_SKILL_DIR/references/platform_architecture.md`.

### `./architecture.md`

Capability-layer platform diagram following the schema in `DEMO_SKILL_DIR/references/architecture/architecture.md`. The full platform renders from a built-in catalog and component states auto-seed from `resources.json` (buildable → active, talking_track → mentioned) — so this file is **small**: mostly the demo's `sources` plus story-tied `desc` overrides on the headline components. The set of active/mentioned components must match the products in README and `resources.json`.

### `./README.md`

Same structure as the matching example README (see "Style reference" above — the Simple example shows the shorter walkthrough you want when capabilities are minimal; the Full example shows the deeper KA/MAS/ML beats):

- **The Story** — summary table (company, protagonist, challenge, journey, resolution, impact). Comes first, right under the H1.
- **Overview** — short paragraph.
- **Key Numbers** — metrics table.
- **Demo Walkthrough** — concise bullet points a presenter can glance at.
- **Products Showcased** — product + what it does in this demo (placed at the **end** of the README; must match `resources.json`).

> The Summary tab automatically renders a products card above the README using `resources.json` (buildable + talking_track) joined with the live deployed resources. **Do not write a glance block** — it is no longer rendered. The card replaces it and shows pending → live transitions as resources get built.

## Coherence contract (you own it) 

You're writing all files:

- **Products Showcased** in README ↔ **architecture components** ↔ **`resources.json` capabilities** must name the same set of products. Every product in the story earns a narrative beat AND an active/mentioned architecture component AND a capability entry.
- **The story** must be coherent with all the capabilities, for example: the data must serve the story, the dashboard / genie and the data must all work together, the app must use the same component / the data must be 

### If the demo includes an app AND (Genie or MAS)

Default app shape (override if the user asks for something different) — design the story so the loop below can play; a read-only dashboard inside the app is the weaker fallback.

**In-app assistant that takes action.** Small agent loop, ~4 tools: (1) `ask_data` → Genie (or MAS) to investigate; (2) Lakebase read(s) for operational context (e.g. "affected returns for lot X"); (3) optional mocked side-effect tools (`create_coupon`, `send_email`, `create_ticket`) returning realistic strings; (4) one write tool that bulk-mutates the Lakebase mirror in an atomic UPDATE (status flips, audit append, recorded fields) — typically the demo's "the agent did a thing" moment.

**Human-in-the-loop on the write.** Agent drafts → shows the plan → stops → waits. Write fires only after explicit "yes".

**The UI cascades after the write.** On commit the write tool emits `dataMutated`; the Operations page subscribes and refetches — KPI counters tick, queue rows flip, badges appear, country panel re-renders, open drawers re-fetch their timeline. The pulse is the visible payoff; walk the user to the page where they'll see it before the agent acts.

**Story arc — five beats:** catalyst → question → discovery → draft + approval → cascade. Missing one usually leaves the app spec without an anchor.

After writing, return to SKILL.md — the stage-1 user-review gate kicks in. Deliver the approval prompt to the user and wait for confirmation before touching any spec file.
