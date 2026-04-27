# Stage 01 — Design the Story & Generate Top-Level Files

Run this after Stage 0 (Capture Intent) has settled on a story direction, and before the stage-1 user-review gate.

Produces three files at the project root: `resources.json`, `README.md`, `architecture.md`.

## Design the story

Nail down the specifics. The exact structure depends on the story pattern, but define (unless instructed otherwise):

1. **The Protagonist** — Company name, industry, persona name and role, what they care about.
2. **The Setup** — What's normal, what context the audience needs.
3. **The Catalyst** — What triggers the demo flow (a spike, a question, a prediction, an alert).
4. **The Journey** — How the protagonist uses the platform to get from question to answer.
5. **The Resolution** — What they learn, the business impact (in $), what action they take.
6. **The Value** — One-sentence "so what" that lands with the audience.

**Match products to story moments** — each product should have a clear "when it shines" moment in the walkthrough. Drop any from the story that don't earn a moment; add any the user requests.

**Important**: keep `resources.json` up to date with *all* product capabilities the demo needs. Some technical-only products (e.g. data generation) live in `resources.json` because the implementation needs them, but don't appear in the README's story (they have no wow effect to narrate).

## Context load — one message, batched reads

Before writing any file, load all references in a single response. Emit all `Read` calls in one assistant message — the harness runs them concurrently, so you get every file back on the next turn instead of paying an LLM round-trip per read.

- `SKILL_DIR/references/architecture.md` — diagram schema
- `SKILL_DIR/references/example-luxebeauty/README.md` — style reference
- `SKILL_DIR/references/platform_architecture.md` — if not already in context
- Any capability blocks you need for product positioning (skip if obvious from common knowledge; dashboard/KA blocks are often worth reading)

All reads in ONE turn. If during the write step you realize you need another Read, go back and add it to this batch instead of interleaving reads and writes.

## Write the three files (single batched turn)

Emit `Write` calls for `resources.json`, `architecture.md`, and `README.md` **in one assistant message** — three `Write` tool uses, one after the other in your output, sent together. The harness runs them concurrently once your turn ends, so you save LLM round-trips (you still generate each file's content token-by-token). The files are independent; coherence comes from your plan, not from reading one file to write the next.

### `./resources.json`

The user's message may include a capabilities list — follow it unless something is missing or incoherent (e.g. user wants an app but it's not listed, or data gen is missing). In that case, adjust and note the adjustment. Avoid adding capabilities just for the sake of it.

Structure mirrors `SKILL_DIR/references/example-luxebeauty/resources.json`:

```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": { /* filled during build */ }
}
```

- **buildable**: capabilities that require actual Databricks resources (pipelines, dashboards, agents, apps).
- **talking_track**: capabilities mentioned in the demo narrative but not requiring resource creation.
- **created_resources**: left empty now; the build phase fills it in with IDs.

Capability IDs come from `SKILL_DIR/references/platform_architecture.md`.

### `./architecture.md`

JSON diagram following the schema in `SKILL_DIR/references/architecture.md`. Nodes and edges must match the products in README and `resources.json`.

### `./README.md`

Same structure as `SKILL_DIR/references/example-luxebeauty/README.md`:

- **Architecture at a glance** — a fenced ` ```glance ` block at the very top, immediately after the H1 title, before "The Story". This is the first thing the user sees in the Summary tab; it renders as a row of equal-width category columns with clickable products that link to Databricks docs.
- **The Story** — summary table (company, protagonist, problem, journey, resolution, impact).
- **Overview** — short paragraph.
- **Key Numbers** — metrics table.
- **Products Showcased** — product + what it does in this demo (must match `resources.json`).
- **Demo Walkthrough** — concise bullet points a presenter can glance at.

#### Authoring the `glance` block

Format — one line per group, `Label: item1, item2, ...`. A line starting with `Foundation:` becomes a cross-cutting bar.

````
```glance
Data Ingestion: Lakeflow Connect, Spark Declarative Pipelines
AI: Knowledge Assistant, Prediction Model
Data Analysis: Dashboard, Genie
Analyst Layer: Databricks App
Foundation: Unity Catalog
```
````

Rules:

- **Group order is fixed**: `Data Ingestion` → `AI` → `Data Analysis` → `Analyst Layer`. Use these exact labels (plain English, not the home-page picker categories).
- **Only include groups that earn a node** — if the demo has no AI agents/models, drop the AI line. If there's no app, drop Analyst Layer.
- **Item names should be the canonical product names** the renderer recognizes (so it can pick the right Databricks icon and docs link). See `SKILL_DIR/references/platform_architecture.md` "At-a-glance group mapping" for the canonical name per capability ID.
- **Foundation** is for cross-cutting concerns. Always include `Unity Catalog` here when `unity-catalog` is in the demo's capabilities (almost always).
- Keep each group to ~1-3 items. The block is a glance, not a checklist — leave the full list for **Products Showcased**.

## Coherence contract (you own it)

You're writing all three files from the same plan in context, so:

- **Products Showcased** in README ↔ **architecture nodes** ↔ **`resources.json` capabilities** ↔ **`glance` block items** must name the same set of products. The glance block is allowed to be a curated subset (one or two headliners per group) but must not introduce products that aren't in the other three.
- Every product in the story earns a narrative beat AND an architecture node AND a capability entry.
- Parallel writes work because coherence comes from *your plan* — not from reading one file to write the next.

After writing, return to SKILL.md — the stage-1 user-review gate kicks in. Deliver the approval prompt to the user and wait for confirmation before touching any spec file.
