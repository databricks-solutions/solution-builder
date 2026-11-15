# Compose: layout, grid and readability

Read this before laying out a slide-style or flow tab (before the first render). The rules are for slides; technical and redraw tabs keep only what helps legibility.

### Frame and aspect
Declare `aspect` on every tab: **16:9** for flows, layered platforms and most deck views; **1:1** for compact containment/governance. Add a `frame` (`{ "title": "…", "subtitle": "…" }`) to any deck-bound tab — it renders a title band inside the export. The aspect target is a **composition goal, not a gate**: the measured ratio is reported as advisory (only a missing `aspect` is a fault). A node ribbon is legitimately 2–4:1 under a title band. If the composition is far off target, change the nesting (a row becomes a column, a band is split off) or split the tab — never add an empty container, a spacer or a band just to change the shape. Legends default to the side panel (`"legend": {"show":"panel"}`).

### Fit to a slide
Text scales with the canvas, so a wide canvas shrinks every label. If the tiers would make a strip wider than about 2.5:1 (hub and spoke, a long chain, a tall network), split them into two bands of the same width, or split the tab. Never shrink text or add whitespace to recover the ratio. Sublabels are one short line (about 4 words) or dropped; CIDRs, config values and job names go in `story` or a second tab.

### Structure
- **16:9 horizontal flow:** a top-level row of about 3–5 columns, one per step. Each column is a `group` with `"layout": "column"` and 2–4 children. **Sequence advances left→right across the row; the children of a column are parallel alternatives or supporting resources — not successive steps stacked in one column.**
- **1:1:** 2–3 columns, or balanced nested containment.
- **Spacing:** the container `gap` sets the clearance (defaults: 100 at the top level, 48 in a box, 32 in a group). Raise it only to clear a measured collision; lower it (e.g. 30) to tighten a column of related boxes. A titled box keeps its title clear through `pad` (default 34); do not set `pad` below 34 on a titled box.
- A long walkthrough (15 lifecycle steps) is **multiple tabs or a step strip**, not side-by-side vertical mini-flows. Never shrink text to fit.
- **Balance:** a container holds its children and sizes to them, so give it no hand-set `size`. A half-empty box means it is too big: shrink it, never add a tile to fill it. Empty space in the frame is fine; a tile against the frame edge is not. A platform or governance strip is a banner row across its box (`align: "stretch"`), not a lone tile at the bottom centre. Don't pile 3+ arrows onto one side of a tile: give them separate ports or one shared ingest box.
- Failed compositions even with zero overlaps: a long one-row ribbon, a tall single-column stack, a prose box hanging under the diagram.

### Compose a flow (the common data + AI shape)
Order the top-level row by data flow, and put every consumer in the column **directly after** what it reads. Never put a stage between a producer and its consumers — the router then sends the consumer edges through that stage. When the story has an ML (or other side) branch, give it its **own row** below (or above) the consumption path, flowing left→right in parallel:

```json
{ "layout": "column", "gap": 90, "nodes": [
  { "id": "main", "type": "group", "layout": "row", "gap": 90, "children": [
    { "id": "sources", "type": "group", "layout": "column", "gap": 40, "equal": "w", "children": [
      { "id": "src-pg", "type": "source", "label": "Postgres", "icon": "file:vendor/postgresql" } ] },
    { "id": "lakeflow", "type": "lakeflow-genie-block" },
    { "id": "lake", "type": "group", "layout": "column", "gap": 50, "children": [
      { "id": "sql-lakehouse", "type": "sql-lakehouse" },
      { "id": "lakebase", "type": "lakebase" } ] },
    { "id": "serve", "type": "group", "layout": "column", "gap": 50, "children": [
      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard" },
      { "id": "genie", "type": "genie" },
      { "id": "app", "type": "databricks-apps-work" } ] } ] },
  { "id": "ml", "type": "group", "layout": "row", "gap": 90, "children": [
    { "id": "training", "type": "model-training", "track": "ml" },
    { "id": "registry", "type": "uc-model-registry" },
    { "id": "model", "type": "model-serving" } ] }
] }
```
Edges: lakeflow → lakehouse → dashboard and genie; app ↔ lakebase (two edges, one per direction); lakeflow → training → registry → model; app → model. Keep the ML branch in its own row, so its edges do not cross the consumption path.

### Documents for Q&A — one Genie Agent, no supervisor
When the story has PDFs, policies, procedures or incident reports that people ask questions about, the answer is **one `genie` tile** that reads both the governed tables and a documents volume. If the user asks for a knowledge assistant, a supervisor, or a multi-agent setup over documents and data, build this pattern instead; never draw a routing tile between data and documents.
- **Path:** `src-pdf` → `uc-volume` (edge label "Upload PDFs") → `genie` (edge label "content search"). The tables go `medallion-table@out-gold` → `genie` (label "Query tables"). The Genie Agent answers SQL questions from the tables and document questions from the volume, citing the file.
- **The volume is documents only.** Draw one dedicated `uc-volume` for the documents and keep it out of the medallion: the whole volume is indexed, so nothing else belongs in it.
- **Apps call the same agent:** a `databricks-apps-work` tile wired to `genie` ("asks Genie") covers any app that needs data or document answers. Genie One fronts `genie` as usual.
- Name the documents in the `story` (what the volume holds), not in a note.

### The data / ingest layer — three ways
Pick by what the story emphasizes:
1. **`lakeflow-genie-block` (or `lakeflow-block`)** — the whole ingest story in one block: Connect · Zerobus · file landing on the left rail, the SDP medallion, and (genie variant) a "Built with Genie Code" footer. Use when **ingestion is part of the story**. Optional `bronze_desc`/`silver_desc`/`gold_desc` params caption each layer.
   ```json
   { "id": "data", "type": "lakeflow-genie-block", "params": { "gold_desc": "Business marts + metrics" } }
   ```
2. **`medallion-table`** — just bronze→silver→gold, compact. Use when ingestion isn't the focus, especially with **Feature Store / Metric Views** forks off gold (`params:{feature_store,metric_views}`, wired via `@out-fs`/`@out-mv`/`@out-gold`).
   ```json
   { "id": "med", "type": "medallion-table", "params": { "feature_store": true, "metric_views": true } }
   ```
3. **DIY** — to list the actual tables: a `box` per layer (titled "Bronze"/"Silver"/"Gold") whose children are `type:"logo"` tiles (icon `bronzeLayer`/`silverLayer`/`goldLayer`, `text` = table name); optionally a parent box titled "Lakeflow Spark Declarative Pipelines" with `titleIcon:"sdpBrand"`. Layer boxes need no `pad` or `size`.
   ```json
   { "id": "sdp-box", "type": "box", "title": "Lakeflow Spark Declarative Pipelines", "titleIcon": "sdpBrand", "layout": "row", "gap": 60,
     "ai_reasoning": "hidden rationale goes inline as ai_reasoning — the JSON has no // comments",
     "children": [
       { "id": "bronze-box", "type": "box", "title": "Bronze", "layout": "column", "children": [
         { "id": "b1", "type": "logo", "icon": "bronzeLayer", "text": "orders_raw", "caption": "right" },
         { "id": "b2", "type": "logo", "icon": "bronzeLayer", "text": "events_raw", "caption": "right" } ] },
       { "id": "silver-box", "type": "box", "title": "Silver", "layout": "column", "children": [
         { "id": "s1", "type": "logo", "icon": "silverLayer", "text": "orders", "caption": "right" },
         { "id": "s2", "type": "logo", "icon": "silverLayer", "text": "events", "caption": "right" } ] },
       { "id": "gold-box", "type": "box", "title": "Gold", "layout": "column", "children": [
         { "id": "g1", "type": "logo", "icon": "goldLayer", "text": "customer_360", "caption": "right" } ] } ] }
   ```
   A note under the box (`"type": "note"`, "PII stays in the EU region") is the next child of the column that holds the box, with `gap` 32.
   Edges: `bronze-box@r → silver-box@l`, `silver-box@r → gold-box@l` (`flow: true`). Feed sources into the ingest ports for option 1, or into `@l` for options 2/3.

### Readability
- **Short strings.** Slide tile titles wrap to two lines, then ellipsize; source labels are narrower. Shorten the label, or give the column `equal: "w"`: every tile then takes the width of the widest label, so one long label widens the whole column.
- **Tiles speak plain language;** job/schema/API names (`demo.*`, `run_now`, service principals) go in the legend or `story`.
- **A tile must earn its place.** Don't add a satellite a composite already implies; prefer one level of box nesting. The absence of an edge can be the claim — say so in `story`.
- **Composites are texture, tiles are the message:** anything the audience must read goes in a main tile label, an edge label or a detail tab — not in a composite's internal microtext.
- **Logos:** a recognizable mark only when `options.trademarkLogos:true` is permitted; otherwise the precise source name as a neutral text badge (`icon:"text"`) — never an unrelated pictogram. Databricks/cloud/built-in marks and `custom_logos` are always fine.
- **Sizing:** let tiles use their natural size. In a column of captioned logos, set `equal: "w"` on the column so they share one width. Set an explicit `size` only for a fixed comparison matrix or a tile whose label must stay long; it opts that node out of auto-sizing.
- **One pitch, one gutter:** reuse one `gap` per container and one `track` per centre line; give a new centre line a reason. When something won't sit cleanly in the structure, it is usually a second diagram.
- **A node placed with `at` does not reflow.** After any text edit on it, re-check the render. Nesting reflows by itself, so prefer it.
- `theme:"technical"` (compact, descriptions on) only when the user explicitly wants a dense engineering view.

### Nesting + wiring traps (each silently ruins a render)
1. **Box padding:** the default `pad` (34) clears a titled box's title strip — omit `pad`. If you set it on a titled box, keep it ≥ 34.
2. **Wire leaf→leaf, not box→box** — container-to-container arrows read as "the box calls the box".
3. **Vendor marks need the `file:` prefix** (`file:vendor/databricks`, `file:persona/user`). Bare names silently fall back to a generic cylinder; only built-ins (`dbTable`, `mlModelBrand`, `modelServing`, `unityCatalogBrand`, …) are unprefixed.
4. **Composite descriptions:** `showDesc:false` does not hide a composite's built-in description; override `desc` with a shorter string.
5. **Tall composites** (`medallion-table` ~126px, Lakeflow blocks) make their row taller. Give one its own column, or set `align` on the row so its neighbours stay on one line.
6. **`at` is layout space, not render space** — coordinates read off a rendered image or an inspect dump are offset. Use nesting instead.
7. **One direction per edge.** `flow:true` (or `arrow:"end"`) on every data hop; never `arrow:"both"` between neighbouring tiles. A round trip (app ↔ Lakebase) is two edges on different handles, each labelled with what it carries ("reads rows", "writes decisions"). A stub shorter than a tile gap is not an edge: widen the container's `gap` or merge the tiles.
8. **Edges and labels stay off container edges.** Never let a line cross a box's title strip: enter a box through its left or right side (`@l` / `@r`), and keep the channel between two containers free of other tiles. A label sits mid-run on a straight segment, never on a border or an arrowhead.
9. **Reading order is the child order.** A flow reads left→right within one row. When it is too long, put a second row under the first that starts again at the left. No sweep back across the diagram.

### Multi-phase asks — chevron banners
A pipeline of PHASES (author → hand off → execute → serve; migration; dev → staging → prod with a gate) is **a row of phase boxes, each starting with its banner** — read `reference/phase-relay.jsonc` first:
- One **untitled** `box` per phase (`"layout": "column"`). Its first child is one `type:"shape", shape:"chevron"` carrying name, number and platform ("3 · Execute + decide · Databricks"), with `size: [200, 64]` and `fontSize: 18`. Give every banner the same `track` (for example `"t1"`), so the banners sit on one line.
- **Level tops:** every phase starts with its banner, so the boxes and the banners align.
- **Hand-offs stay short.** The receiving tile shares a `track` with the sender, or takes the next one. Inside a phase, steps stack vertically in the column (FLOW ORIENTATION judges the edges that cross columns).
- **Never place a banner with `at`:** it drifts as soon as its box moves. Make it the first child of its phase box.
- Chevron text clears the point + notch: ~28 chars on a 336px banner at fontSize 18.
