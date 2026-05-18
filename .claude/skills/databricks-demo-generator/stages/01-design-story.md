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

- `DEMO_SKILL_DIR/references/architecture.md` — diagram schema
- `DEMO_SKILL_DIR/references/example-luxebeauty/README.md` — style reference
- `DEMO_SKILL_DIR/references/platform_architecture.md` — if not already in context
- Any capability blocks you need for product positioning (skip if obvious from common knowledge; dashboard/KA blocks are often worth reading)

## Write the three files (single batched turn)

Emit `Write` calls for `resources.json`, `architecture.md`, and `README.md` **in one assistant message** — three `Write` tool uses, one after the other in your output, sent together. The harness runs them concurrently once your turn ends, so you save LLM round-trips (you still generate each file's content token-by-token). The files are independent; coherence comes from your plan, not from reading one file to write the next.

### `./resources.json`

The user's message may include a capabilities list — follow it unless something is missing or incoherent (e.g. user wants an app but it's not listed, or data gen is missing). In that case, adjust and note the adjustment. Avoid adding capabilities just for the sake of it.

Structure mirrors `DEMO_SKILL_DIR/references/example-luxebeauty/resources.json`:

```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": { /* filled during build */ }
}
```

- **buildable**: capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps).
- **talking_track**: capabilities mentioned in the demo narrative but not requiring resource creation.
- **created_resources**: left empty now; the build phase fills it in with IDs.

Capability IDs come from `DEMO_SKILL_DIR/references/platform_architecture.md`.

### `./architecture.md`

JSON diagram following the schema in `DEMO_SKILL_DIR/references/architecture.md`. Nodes and edges must match the products in README and `resources.json`.

### `./README.md`

Same structure as `DEMO_SKILL_DIR/references/example-luxebeauty/README.md`:

- **The Story** — summary table (company, protagonist, challenge, journey, resolution, impact). Comes first, right under the H1.
- **Overview** — short paragraph.
- **Key Numbers** — metrics table.
- **Demo Walkthrough** — concise bullet points a presenter can glance at.
- **Products Showcased** — product + what it does in this demo (placed at the **end** of the README; must match `resources.json`).

> The Summary tab automatically renders a products card above the README using `resources.json` (buildable + talking_track) joined with the live deployed resources. **Do not write a glance block** — it is no longer rendered. The card replaces it and shows pending → live transitions as resources get built.

## Coherence contract (you own it)

You're writing all three files from the same plan in context, so:

- **Products Showcased** in README ↔ **architecture nodes** ↔ **`resources.json` capabilities** must name the same set of products. Every product in the story earns a narrative beat AND an architecture node AND a capability entry.
- Parallel writes work because coherence comes from *your plan* — not from reading one file to write the next.

After writing, return to SKILL.md — the stage-1 user-review gate kicks in. Deliver the approval prompt to the user and wait for confirmation before touching any spec file.
