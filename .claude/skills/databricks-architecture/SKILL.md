---
name: databricks-architecture
description: Create or edit a Databricks solution-architecture diagram — a Lucidchart-style platform diagram (sources → Lakeflow/Genie pipeline → lakehouse/lakebase → dashboards, Genie, apps → end user, on a governed platform). Use when someone wants to draw, generate, or edit an architecture diagram, visualize a Databricks solution's components and data flow, or produce an architecture image. Produces a self-contained HTML you render to a PNG and iterate on.
---

# Databricks Architecture Diagram

A left→right "Data + AI Platform" picture: sources → governed pipeline → compute → dashboards / Genie / apps → end user, on one governed platform.

The file is a **flat list of `nodes` + `edges`** — a node is on the canvas iff it's in `nodes` (no visibility/state/diffing). **Author STRUCTURE, not pixels:** put each node in a **`col`** (left→right lane, stacked by `row`); draw **edges by node id** (handle inferred); **`wraps`** a group in a box that auto-sizes. You almost never write `at` — reserve it for a node you hand-place (a user drag persists there too).

**Before wiring edges, read `reference/platform_architecture.md`** — it's the map of which component feeds which (sources → `lakeflow`/`sdp` → `sql-lakehouse` → `ai-bi-dashboard`/`genie`; `supervisor-agent` → `genie`/`knowledge-assistant`; `lakebase` syncs `sdp` tables + powers apps). That's what makes the data flow correct, not just plausible.

---

<!-- BEGIN: local-render-workflow (stripped when the skill runs inside Solution Builder — the app renders architecture.md live in its own canvas) -->
## Workflow — how to make a diagram

The diagram is **one self-contained HTML file** with its JSON in an inline block. Steps:

1. `cp renderer/architecture-viewer.html my-arch.html` (or `architecture-editor.html` for a browser-editable copy with Load/Download buttons).
2. Replace the JSON inside `<script type="application/json" id="architecture">…</script>` with your array (schema below; plain JSON, no `//`). Start from **The format** below, or `reference/architecture-complete.jsonc` for the full platform.
3. Open in any browser (no server), or render + read the PNG to iterate (below).

**Render loop (do this every edit):**

```
npx playwright install chromium-headless-shell   # one-time (~90MB)
node renderer/render-arch.mjs my-arch.html        # → my-arch.png
```

**Read `my-arch.png`** — check components present, wired right, laid out clean; fix the JSON; repeat. Uses `chromium-headless-shell` over CDP (just the shell + node 18+, auto-found in Playwright's cache). If it reports "No Chrome/Chromium found", run the install line or set `CHROME_PATH=/path/to/chrome`.
<!-- END: local-render-workflow -->
<!-- BEGIN: in-app-workflow (injected only when the skill runs inside Solution Builder) -->
<!-- END: in-app-workflow -->

---

## The format

One tab's shape — your starting point. Emit an array of these (`[ … ]`, see *Tabs*). Shown as JSONC for the comments; **strip `//` comments** on emit (parsed as plain JSON):

```jsonc
{
  "name": "Simple Solution Architecture",
  "story": "Sources → governed Lakeflow + Genie pipeline → lakehouse → a dashboard and Genie for plain-language Q&A. Business users reach it through Genie One, all on the governed Databricks Platform.",
  "columns": ["sources", "pipeline", "compute", "work", "entry"],
  "nodes": [
    // Sources, each stacked by `row`. The edge (below) names the Lakeflow ingest
    // PORT the source lands on — @in-lakeflow-connect (databases/SaaS),
    // @in-zerobus (realtime/sensors), @in-direct (files: PDF/CSV/Parquet).
    { "id": "src-postgres", "type": "source", "col": "sources", "row": 1, "label": "Postgres", "icon": "file:vendor/postgresql" },
    // A source with NO logo → `icon:"text"` renders the label as a brand-colored
    // text badge (no icon file). Use for niche / internal systems.
    { "id": "src-erp", "type": "source", "col": "sources", "row": 2, "label": "Acme ERP", "icon": "text" },
    // Realtime stream → @in-zerobus (its edge animates as a particle river).
    { "id": "src-sensors", "type": "source", "col": "sources", "row": 3, "label": "Sensor data", "icon": "sensorSource" },
    // Files → @in-direct (its edge animates as travelling document glyphs).
    { "id": "src-docs", "type": "source", "col": "sources", "row": 4, "label": "PDF documents", "icon": "pdfLogo" },
    // The one data-layer block (ingest + bronze→silver→gold, built by Genie Code).
    { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline" },
    { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "compute" },
    // Consumption lane: dashboard + Genie, stacked.
    { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1 },
    { "id": "genie", "type": "genie", "col": "work", "row": 2 },
    // Genie One = the business-user entry point (an INTERFACE onto everything to
    // its left). It has the "Business users" persona built IN (a pill above the
    // tile) — no separate user node needed. It's wide, so ROTATE it 90° to stand
    // vertically — a slim lane.
    { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },
    // Top-band banners PINNED to the platform box's corners (never absolute `at` —
    // those drift off-corner when the node set changes). A non-float pin RESERVES
    // a top band so the box grows to enclose them. Both render with no border/shadow.
    { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
    { "id": "governance-block", "type": "governance-block", "pin": { "at": "top-right", "to": "platform-box" } },
    // One white box wrapping the whole flow = "all of this is the platform".
    { "id": "platform-box", "type": "box", "z": -1,
      "wraps": ["src-postgres", "src-erp", "src-sensors", "src-docs", "lakeflow-genie-block", "sql-lakehouse", "ai-bi-dashboard", "genie", "genie-one"] }
  ],
  "edges": [
    // Source → Lakeflow: name the ingest PORT on the target handle. That handle
    // also drives the flow animation: @in-zerobus → particle stream, @in-direct →
    // travelling docs, @in-lakeflow-connect (or any other source edge) → laser beam.
    { "id": "e1", "from": "src-postgres", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
    { "id": "e1b", "from": "src-erp", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
    { "id": "e1c", "from": "src-sensors", "to": "lakeflow-genie-block@in-zerobus", "flow": true },
    { "id": "e1d", "from": "src-docs", "to": "lakeflow-genie-block@in-direct", "flow": true },
    { "id": "e2", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
    { "id": "e3", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
    { "id": "e4", "from": "sql-lakehouse", "to": "genie", "flow": true },
    // Genie One fronts the consumption tiles (auto-arrow — Genie One edges point
    // away from it toward the resource; no `flow`/`arrow` needed).
    { "id": "e6", "from": "genie-one", "to": "ai-bi-dashboard" },
    { "id": "e7", "from": "genie-one", "to": "genie" }
  ]
}
```

### Tabs — the file is an ARRAY of architectures

Top level is a JSON **array**, one element (the shape above) per **tab**; its `name` is the tab label. Multiple tabs = multiple views of one diagram (e.g. "Ingestion" / "Serving"). **Always emit the full array** `[ { … } ]`, even for one tab (a bare object is accepted but re-serialized as an array). Emit every tab each time.

### Top level  *(each element of the tabs array)*
| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | The **tab label** for this architecture. Defaults to "Architecture N". |
| `story` | No | One-line description of this architecture. Metadata (kept in the file); not rendered on the canvas. |
| `options.trademarkLogos` | No | `true` → render real third-party brand logos. Default `false` (neutral badges). |
| `columns` | No | Ordered left→right **lane names**. Nodes reference one via `col`. Add/rename/insert lanes freely for a different shape — no fixed taxonomy. |
| `rowGrid` | No | `true` → a node's `row` becomes a **shared grid row aligned across ALL columns** (row N = the same horizontal line in every lane), so columns register into rows even with different node counts. Each band's height = its tallest node. A node with **no `row`** falls back to stacking within its own column (so you can leave e.g. the data sources without a `row`). **Row numbers are grid coordinates — SKIPPING a number inserts an empty band of vertical space** (rows `0, 2, 4` are more spread out than `0, 1, 2`). Default (off) → `row` orders WITHIN a lane. Relational (`alignY`/`below`/…) + `at` still override per node. |
| `custom_logos` | No | `[{ id, svg }]` — inline SVG logos. Reference one from any node's `icon` as `"custom:<id>"`. See *Custom logos & images*. |
| `nodes` | Yes | The components on the canvas (see below). |
| `edges` | Yes | The lines between them. |

### A node
| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique node id. For a 2nd placement of the same component use `genie#2` (the `#N` suffix). |
| `type` | Yes | A **catalog component id** (`genie`, `sql-lakehouse`, `lakeflow-genie-block`, `governance-block`, `db-platform`, … — see the catalog below; this folds in the old composite "kind") OR a special kind: `source` · `box` · `text` · `logo` · `image`. |
| `col` | placement | The lane (from `columns`) this node sits in. Nodes in a lane stack vertically, centered. **Primary way to place a node.** |
| `row` | No | Order within the lane (else order of appearance). With top-level `rowGrid: true`, `row` instead aligns across ALL columns into a shared horizontal band (row N = same line in every lane). |
| `wraps` | container | On a `type:"box"`: the node ids this box ENCLOSES. The box auto-sizes around them (+ `pad`, default 24). Nesting works (a box may wrap boxes) — see *Containers*. |
| `bounds` | container | On a `type:"box"`: per-side edge anchors `{ left?, right?, top?, bottom? }`. Each side = `"<nodeId>:<anchor>"` (anchor ∈ `left`/`right`/`center` for x, `top`/`bottom`/`center` for y), or `"col:<name>:<anchor>"` (a lane's edge/midpoint), or `"wrap"`. Lets the box edge cut HALFWAY through a node/column. Unspecified sides fall back to `wraps`. |
| `pin` | placement | Dock this node into a box corner (overrides `col`). An object `{ at, to?, pad?, float? }`: `at` = one of `top-left`·`top`·`top-right`·`left`·`center`·`right`·`bottom-left`·`bottom`·`bottom-right`; `to` = box id to dock into (default: the largest box); `pad` = inset px (default 16); `float` = `false`/omitted → **reserve a band** (the box GROWS so this never overlaps content — top pin pushes content down, bottom extends the box down), `true` → **overlay** at the corner (may sit over content). Use for banners / personas. |
| `at` | No | `[x, y]` **explicit** position (node center). **Overrides `col`/`pin`.** Use for fully manual placement. (A user drag also persists here.) |
| `size` | No | `[w, h]` if resized from the natural size. |
| `rot` · `scale` · `z` · `pad` | No | Rotation° (0/90/180/270), content scale, stacking order (negative = behind), container padding. |
| `group` | No | A shared string id stamped on several nodes → they form a GROUP: selecting one selects all, and they move together on the canvas. |
| `label` · `icon` | No | Override the catalog default label/icon (only when it differs). `icon` may be a built-in name, a `file:vendor/…`/`file:cloud/…` key, or a `custom:<id>` (see *Custom logos & images*). |
| `note` | No | **Authoring note — NEVER rendered, never affects layout.** Free text explaining WHY this node is here or what a non-obvious choice means (a relabeled generic tile, why a `row`/`col` was picked, a param's effect). Round-trips verbatim (survives drags/saves). Distinct from `desc` (the visible line). Use it so an example stays self-documenting — see rule 10. |
| `desc` | No | The node's **description line** — one line under the label. On a catalog tile it overrides the default blurb; on a `source`/`logo` it's the tile's only descriptive text. `""` (empty string) deliberately CLEARS it (renders nothing); omit to keep the catalog default. See *Node text: title · description · caption*. |
| `showDesc` | No | `true`/`false` to force the description line on/off. **Default:** a catalog tile shows its description when it has one; a `source`/`logo` shows it only when you set `desc`. |
| `caption` | source · logo | Where the label sits relative to the icon: `right` · `left` · `top` · `bottom`. **Default:** `right` for a source, below (`bottom`) for a logo. |
| `fontSize` | source · logo · text/box | Label font size in px. Applies to source/logo captions and to `text`/`box` annotations. |
| `text`·`bold`·`vAlign`·`hAlign`·`src` | box/text/logo/image | Annotation props — see *Annotations*. (`fontSize` and `caption` are in the rows above.) |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity }` — visual overrides; emit only what differs. `border` = width px (0 = none); `borderStyle` = `solid`/`dashed`; `borderColor`/`fill`/`font` = hex; `radius` = corner px; `shadow` = 0–100 intensity (0 = none); `opacity` = 0–1. |

The **band** a component belongs to (which sets its tile color) is derived from its `type` — you never write it.

### An edge
`{ "id"?, "from": "<srcId>[@handle]", "to": "<tgtId>[@handle]", "flow"?, "arrow"?, "dashed"?, "shape"?, "flowStyle"?, "centerX"?, "label"?, "note"? }`

- **Write `from`/`to` by node id; the `@handle` is INFERRED** from geometry: left→right ⇒ source `@r` → target `@l`; vertical ⇒ `@b`/`@t`. A **source** feeding the Lakeflow block must name the target ingest port EXPLICITLY on the handle — `@in-lakeflow-connect` (databases/SaaS), `@in-zerobus` (realtime streams/sensors), or `@in-direct` (files: PDF/CSV/Parquet). That handle also picks the flow animation: `@in-zerobus` → particle stream, `@in-direct` → travelling docs, else → laser beam.
- Add an explicit **`@handle`** only to override the inference — a composite port (`in-lakeflow-connect`, `in-zerobus`, `in-direct`, `r`) or a side (`l`/`r`/`t`/`b`). E.g. force a vertical link with `@b`/`@t`.
- `flow: true` → animated "data flowing" line. Omit for a static line.
- `arrow`: omit/`"auto"` (default — auto-draws an arrowhead for edges touching the **user persona** or **Genie One**) · `"none"` · `"end"` · `"start"` · `"both"`. An explicit arrow is a static relationship line.
- `shape`: `smooth` (default) · `straight` · `step`. `flowStyle`: `dot`·`particles`·`docs`·`laser`.
- `label` = text drawn ON the edge (short — it's rendered). `note` = an authoring note that is **NEVER rendered** — the *reasoning* for the edge (why it exists, why a handle was chosen, a "don't add X" caution). It round-trips verbatim, so use it to make an example self-explanatory. See rule 10.

### Containers (wrapper boxes)
A `type:"box"` with `wraps: [ids]` becomes a **labeled container** that auto-sizes to enclose those nodes (+ `pad`). It's how the big white **platform box** works (`wraps` the whole flow, `z:-1`). Nesting is recursive — model a cloud diagram by wrapping wrappers:

```json
{ "id": "aws", "type": "box", "label": "AWS", "wraps": ["vpc"], "pad": 28 },
{ "id": "vpc", "type": "box", "label": "VPC 10.0.0.0/16", "wraps": ["subnet-a"], "pad": 22 },
{ "id": "subnet-a", "type": "box", "label": "Private subnet", "wraps": ["app", "db"], "pad": 16 },
{ "id": "app", "type": "databricks-apps-work", "col": "compute" },
{ "id": "db",  "type": "lakebase", "col": "compute" }
```

The inner nodes get placed (by `col` or `at`); each box sizes itself around its members, innermost first. You never compute a box's `at`/`size`.

### Annotations (free-form, not catalog components)

Four `type`s let you add labels and marks that aren't Databricks components:

| type | props | use |
|------|-------|-----|
| `text` | `text`, `fontSize`, `bold`, `vAlign`/`hAlign` | a free-floating text label. |
| `box` | `text`, `fontSize`, `vAlign`/`hAlign`, + `wraps`/`bounds`/`pad` | a labeled rectangle / container (the platform box, cloud/VPC boxes). |
| `logo` | `icon` (any icon key, incl. `file:…` or `custom:<id>`), `text` (the caption), `caption` (right/left/top/bottom — default below), `fontSize`, `desc`/`showDesc` | a standalone logo — e.g. the `file:persona/user` end-user marker. |
| `image` | `src` | a standalone image (URL or base64 — see below). |

> A `box` shows a 1px border by default; `text` shows none. The border is controlled ONLY by `style` — set `style.border` (px width, `0` = none), `style.borderColor`, `style.borderStyle` (`solid`/`dashed`). There is no separate border boolean.

### Node text: caption positions (source / logo)

Tiles/sources/logos = icon + `label` + optional `desc` line. Sources & logos also take a `caption` = where the label sits vs. the icon (`top`/`bottom` use a taller box):

```
right:  [icon] Label      left:  Label [icon]
top:      Label           bottom:   [icon]
         [icon]                     Label
```

```json
{ "id": "src-crm", "type": "source", "icon": "file:vendor/salesforce",
  "label": "Salesforce", "caption": "bottom", "fontSize": 12,
  "desc": "Nightly account + opportunity export" }
```

### Default look per node kind (what's actually drawn)

The renderer gives each kind a different **default** chrome, so the same `style` fields land differently. Set `style` only to deviate:

| kind | border | shadow | fill | notes |
|------|--------|--------|------|-------|
| catalog **tile** (product/source) | thin band-tinted border | subtle drop shadow | `bg-card` (theme surface) | the standard boxed tile; band color comes from its `type`. |
| **logo** annotation | **none** | **none** | **transparent** | just the mark + caption, no box. Add `style.border`/`style.fill` to turn it INTO a boxed tile (a border/fill auto-adds a default shadow). |
| **box** annotation | 1px | none | transparent (a `box` used as a plain rectangle is solid white; a `wraps` container is transparent) | labeled container. |
| **text** annotation | none | none | none | bare text. |
| composite (`lakeflow`, `governance`, `agent-bricks`, `db-platform`, …) | own internal chrome | varies | own | self-contained blocks; `db-platform`/`governance` default to no outer border. |

### Custom logos & images

- **Label-only source (no logo)** — for a source or partner you have no logo for, set `"icon": "text"` (or omit `icon`) on a `type:"source"` node. It renders the `label` as a brand-colored text badge (the same style as a trademark-gated logo) — no icon file needed. Prefer this over an unrelated logo when there's no real mark.
- **Custom SVG logos** — add inline SVGs in the top-level `custom_logos` array and reference them by id from ANY node's `icon`:
  ```json
  "custom_logos": [
    { "id": "acme", "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#7C3AED' d='M12 2l3 7 7 .5-5 4.5 1.5 7L12 17l-6 4 1.5-7-5-4.5 7-.5z'/></svg>" }
  ]
  ```
  Then `"icon": "custom:acme"` on a `type:"source"` tile (a named data source with a custom brand) OR a `type:"logo"` node (a standalone mark). Custom logos are never trademark-gated — always shown. (Escape the SVG quotes for JSON, or use single quotes inside the SVG as above.)
- **Images (base64)** — a `type:"image"` node with `"src": "data:image/png;base64,…"` (or an http URL). **Standalone only** — an image is its own node; you can't use it as a component/source `icon` (use a `custom_logos` SVG for that).

---

## The canonical end-to-end flow (the "complete" shape)

`reference/architecture-complete.jsonc` is the flagship layout — copy it and adapt. Left → right:

```
sources (≈3 rows)  →  Lakeflow + Genie (one block)  →  lakehouse + lakebase
     →  dashboard + Genie Room + app  →  Genie One  →  the end user
```

Per-component facts (title, `ports`/`@handle`s, composite internals, when-to-use) live in the generated **Component catalog** below — the single source of truth; read the row, don't restate it here. This section is only the whole-diagram layout:

- **Platform box:** one `box` `z:-1` `wraps` the whole flow (usually not the raw sources) = "the Databricks Platform".
- **Banners:** `db-platform` and `governance-block` `pin` to that box's `top-left`/`top-right` (never a raw `at` — it drifts when the node set changes; the non-float pin grows the box to fit).
- **Genie One** fronts the consumption tiles (dashboard / Genie Room / app) with auto-arrows.

---

## Component catalog (dense reference)

<!-- BEGIN: generated-catalog -->

<!-- AUTO-GENERATED from CATALOG in app/.../lib/platform-architecture.ts
     by `bun run scripts/gen-architecture-skill.ts` — DO NOT EDIT BY HAND. -->

Use the `type` id; the renderer supplies the icon, label, default description and size. Override `label`/`desc` only when story-specific. Composite blocks carry their own internal layout — treat each as ONE node (don't also add its sub-parts).

### Agentic Data `agentic-data`

*The data foundation — ingest + the medallion pipeline (bronze→silver→gold) + the lakehouse / Lakebase it lands in. Where the demo's data comes IN and is refined.*

| type | default title | default description (shown on the tile) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `lakeflow-block` | Lakeflow | One block: managed ingest (Lakeflow Connect), real-time streams (Zerobus) and direct file landing, all flowing into a declarative bronze → silver → gold pipeline. | 224×148 | The whole ingest + bronze→silver→gold SDP in one block (no Genie Code framing). Contains SDP — never add a separate sdp tile beside it. |
| | | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps · `in-zerobus` ← realtime streams / sensors · `in-direct` ← files: PDF / CSV / Parquet · `r` → the compute layer |
| `lakeflow-genie-block` | Lakeflow + Genie | Lakeflow ingest + declarative pipeline, with Genie Code building and maintaining it — one box, end to end. | 360×208 | The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it. |
| | | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps · `in-zerobus` ← realtime streams / sensors · `in-direct` ← files: PDF / CSV / Parquet · `r` → the compute layer |
| `lakeflow-connect` | Lakeflow Connect | A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems. | 200×56 |  |
| `zerobus-ingest` | Lakeflow Zerobus | Real-time, direct ingest of streaming events into the lakehouse. | 200×56 |  |
| `sdp` | Lakeflow SDP | Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale. | 230×112 |  |
| `uc-volume` | UC Volume | Governed file storage in Unity Catalog — where raw documents (PDFs) land. | 200×56 |  |
| `lakeflow-jobs` | Lakeflow Jobs | Orchestrate the whole pipeline on a schedule or trigger. | 230×54 |  |
| `notebooks-eda` | Notebooks | Interactive exploration and analysis on governed data. | 200×56 |  |
| `delta-sharing` | Delta Sharing | Open, cross-org data sharing with no copies. | 200×56 |  |
| `marketplace` | Marketplace | Discover and consume third-party data and AI assets. | 200×56 |  |
| `lakebase` | Lakebase | Managed Postgres for app state — reads/writes the live queue. | 230×54 |  |
| `sql-lakehouse` | Lakehouse | One copy of governed data for BI + AI — real-time queries at scale (SQL Warehouse; RT = Lakehouse Real Time). | 230×54 |  |

### Agentic Work `agentic-work`

*The intelligence layer — models, agents, RAG, ML lifecycle, and the entry points (Genie, Genie One) that answer questions and act on the governed data.*

| type | default title | default description (shown on the tile) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `databricks-apps-work` | Databricks Apps | Deploy business apps | 230×54 | The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Room. |
| `genie-one` | Genie One - Mobile app | Databricks access for business user | 230×78 | The business-user / mobile entry point. It has a Business-users persona built IN (a small user icon docked above the Genie One mark) — so you do NOT need a separate file:persona/user node beside it. Wire Genie One --> dashboard / Genie Room / app (auto-arrows; leave `arrow` out). |
| `genie` | Genie Room | ask anything about your data | 230×54 |  |
| `knowledge-assistant` | Knowledge Assistant | Chat with your documents — grounded, cited answers from unstructured content. | 200×56 |  |
| `supervisor-agent` | Supervisor Agent | Routes a question to the right specialist agent and composes the answer. | 200×56 |  |
| `agent-bricks` | Agent Bricks | Databricks' managed agents — a multi-agent supervisor plus information extraction, document parsing, and classification, built and governed for you. | 230×170 | Managed MULTI-agent system: a Supervisor orchestrating Knowledge Assistant / Genie / MCP / Functions (with extraction·parsing·classification chips). Use when the agent layer is a supervisor routing to specialists; if the demo uses only one agent capability, use that single tile instead. |
| `ml-training-serving` | ML Models | Train, register, and serve models on governed data. | 200×56 |  |
| `ml-model` | Machine Learning Model | A trained model on governed data — classification, forecasting, recommendations, and more. | 230×54 |  |
| `model-training` | Model Training | Train + track experiments with MLflow — parameters, metrics, and artifacts, all governed. | 230×54 |  |
| `mlops` | MLOps | The full model lifecycle — train, evaluate, register, deploy, and monitor, governed end to end. | 230×54 |  |
| `bronze-layer` | Bronze | Raw ingested data, landed as-is. | 200×56 |  |
| `silver-layer` | Silver | Cleaned, conformed, deduplicated. | 200×56 |  |
| `gold-layer` | Gold | Curated, business-ready aggregates. | 200×56 |  |
| `medallion-table` | Medallion Table | Bronze → Silver → Gold in one block — the medallion refinement of a governed table. | 268×96 | The whole medallion (bronze → silver → gold) as ONE block, with the metal-toned layer marks and an internal flow. Prefer this over three separate bronze/silver/gold tiles when you just want to show the layered data itself. OPTIONS (params): `feature_store` and `metric_views` — each adds a fork off the GOLD layer (Feature Store above, Metric Views below) shown inside the block, and exposes an extra right-side OUTPUT handle so you can wire it: `@out-gold` (always), `@out-fs` (when feature_store), `@out-mv` (when metric_views). |
| | | | | **ports:** `l` ← sources / ingest · `out-gold` → gold output · `out-fs` → feature store (when enabled) · `out-mv` → metric views (when enabled) |
| `feature-store` | Feature Store | Governed, reusable features for training and real-time serving — consistent offline and online. | 230×54 |  |
| `uc-model-registry` | UC Model Registry | Version, stage, and govern models in Unity Catalog with full lineage. | 230×54 |  |
| `model-serving` | Model Serving Endpoint | Serve a custom model behind a governed, autoscaling REST endpoint for real-time inference. | 230×54 | A deployed serving endpoint (real-time inference over a custom/registered model). Use when the demo calls a live endpoint; for the train→register→batch-score story use ml-training-serving instead. |
| `hosted-mcps` | Hosted MCPs | Managed MCP servers that let agents call external tools — Genie, Atlassian, GitHub, Slack, SharePoint, Gmail, and more. | 230×54 | The governed tool/connector layer for agents — hosted MCP servers (Genie / Atlassian / GitHub / Slack / SharePoint / Gmail …). Use when the demo's agent reaches OUT to external systems via MCP. |
| `vector-search` | Vector Search | Embeddings | 200×56 |  |
| `information-extraction` | Information Extraction | Pull specific data points, entities, and fields from unstructured text (ai_extract). | 200×56 |  |
| `document-parsing` | Document Parsing | Extract structured content from documents — text, tables, and metadata (ai_parse_document). | 200×56 |  |
| `text-classification` | Text Classification | Categorize text into predefined or dynamic labels (ai_classify). | 200×56 |  |
| `genie-code` | Built with Genie Code | A copilot for everyone — describe what you want and Genie Code builds the pipeline, dashboard or app for you, directly on Databricks. | 360×112 | Standalone 'describe it → Genie Code builds it' beat. Use only when NOT already using lakeflow-genie-block (which has the Genie Code footer built in). |

### Agentic Apps `agentic-apps`

*The delivery surface — dashboards and custom apps the business actually opens. Reach here for what a user SEES and clicks.*

| type | default title | default description (shown on the tile) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `databricks-apps` | Databricks Apps | Custom web app where the team does the work — queue, actions, all in one place. | 200×56 |  |
| `ai-bi-dashboard` | AI/BI Dashboard | Governed dashboards on the same data — one set of numbers, one page. | 230×54 |  |

### Unified Governance `unified-governance`

*The control plane over everything — Unity Catalog, the AI Gateway, and the Databricks-platform banner. Prefer the one `governance-block` bar over the loose tiles unless spotlighting a single feature.*

| type | default title | default description (shown on the tile) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `governance-block` | Unified Governance | One control plane for data + AI: Unity Catalog governs access, lineage and quality; the Unity AI Gateway governs every foundation-model call (OpenAI, Anthropic, Gemini, …); Genie Ontology is the shared semantic layer. | 580×108 | One governance bar: Unity Catalog + Unity AI Gateway (access any model) + a live Genie Ontology graph. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature). |
| `db-platform` | Databricks Platform | The Databricks Data + AI platform — one governed foundation for all data + AI. | 380×60 | Title banner (the Databricks wordmark). Pin it top-left, usually paired with a big background box (z:-1) wrapping everything → reads as 'all of this is the platform'. |
| `unity-catalog` | Unity Catalog | One governed catalog — access, lineage, and semantics across data + AI. | 200×56 |  |
| `ai-gateway` | Unity AI Gateway | Security, governance, cost and rate limits. | 240×104 | The Unity AI Gateway tile with a row of foundation-model logos (OpenAI · Anthropic · Gemini · Grok · Kimi) across the top — conveys 'govern + access ANY model' at a glance. Use standalone; the Unified Governance bar already embeds a compact gateway if you want the whole control plane. |
| `data-quality` | Data Quality | Expectations and monitors keep bad data out of the gold layer. | 200×56 |  |
| `abac` | ABAC | Attribute-based access control — fine-grained, policy-driven permissions. | 200×56 |  |
| `data-classification` | Data Classification | Automatically tag and govern sensitive data. | 200×56 |  |

> Sources are demo-authored (not in this catalog): use `type:"source"` with a vendor `icon` (`file:vendor/<name>`; see the icon bank below) and wire the edge to the Lakeflow block's ingest port via an explicit `@in-*` handle.

<!-- END: generated-catalog -->

### Sources
Use `type:"source"` with a vendor `icon` (`file:vendor/<name>` — e.g. `postgresql`, `kafka`, `sap`, `salesforce`, `shopify`). Generic fallbacks: `pdfLogo`, `csv`, `parquet`, `sensorSource`, `inputData`, `unstructuredData`. Wire the source's edge to the Lakeflow block's ingest port with an explicit handle — `@in-lakeflow-connect` (databases/SaaS), `@in-zerobus` (realtime/sensors), `@in-direct` (files: PDF/CSV/Parquet) — which sets both the port and the flow animation (zerobus→particles, direct→docs, else→laser). A custom shapes source: `file:vendor/custom-source`. A persona/user marker: `file:persona/user` (as a `logo` node).

Show **real, NAMED source systems** — never a single "Synthetic Data" / "synthetic" placeholder (it reads as fake and tells no story).
- **Follow the user first:** if they named their sources (one or many), use exactly those.
- **Default when you have no signal:** add **~4** plausible real systems with real vendor logos, spanning the three ingest ports so the Lakeflow block's three ports are used — e.g. a database (`postgresql`/`mysql`, edge `@in-lakeflow-connect`), a SaaS app (`salesforce`/`shopify`, `@in-lakeflow-connect`), **sensor / IoT data** (`sensorSource`, `@in-zerobus`), and documents (`pdfLogo`, `@in-direct`). Fit the industry if one is implied; otherwise this generic mix is fine. This is just the fallback — a demo that clearly wants one source should show one.
- For the streaming/`zerobus` path lead with **sensor data**, NOT Kafka — Zerobus is Databricks' direct ingest that *replaces* a Kafka-style broker, so showing Kafka alongside it is contradictory.
- Only use `file:vendor/custom-source` for a source that genuinely has no real-world product behind it.

### Available logos (icon bank)

<!-- BEGIN: generated-icons -->

<!-- AUTO-GENERATED from the icon bank (icons/vendor + icons/cloud) — DO NOT EDIT BY HAND. -->

Logos you can set as a node `icon`. Keys are self-explanatory; use them verbatim.

**Vendor / product logos** — `file:vendor/<name>`:

`adyen`, `agent-bricks`, `airbyte`, `airtable`, `amplitude`, `anthropic`, `apache-airflow`, `apache-couchdb`, `apache-flink`, `apache-hbase`, `apache-nifi`, `apache-spark`, `atlassian`, `aws-redshift`, `bigcommerce`, `box`, `braze`, `brevo`, `cassandra`, `chroma`, `clickhouse`, `cloudflare`, `cockroachdb`, `confluence`, `couchbase`, `csv`, `custom-source`, `databricks`, `databricks-wordmark`, `dbt`, `docker`, `dropbox`, `duckdb`, `elasticsearch`, `fastapi`, `gemini`, `genie-ontology`, `github`, `gitlab`, `glean`, `google-ads`, `google-analytics`, `google-docs`, `google-drive`, `google-sheets`, `gradio`, `grafana`, `grok`, `hootsuite`, `hubspot`, `hugging-face`, `ibm`, `influxdb`, `informatica`, `intercom`, `jira`, `kafka`, `kimi`, `klarna`, `kubernetes`, `looker`, `mailchimp`, `mariadb`, `marketo`, `mastercard`, `mcp`, `meta`, `metabase`, `microsoft`, `microsoft-sql-server`, `milvus`, `mistral`, `mixpanel`, `mongodb`, `mqtt`, `mysql`, `neo4j`, `netlify`, `nextjs`, `node-red`, `nodejs`, `notion`, `openai`, `oracle`, `parquet`, `paypal`, `perplexity`, `pinecone`, `planetscale`, `postgresql`, `power-bi`, `prestashop`, `presto`, `pulsar`, `python`, `qdrant`, `qlik`, `quickbooks`, `rabbitmq`, `react`, `redis`, `salesforce`, `sap`, `scylladb`, `segment`, `sendgrid`, `shopify`, `shopware`, `siemens`, `singlestore`, `slack`, `snapchat`, `snowflake`, `sqlite`, `square`, `streamlit`, `stripe`, `supabase`, `superset`, `tableau`, `talend`, `teradata`, `terraform`, `tiktok`, `trino`, `twilio`, `vercel`, `visa`, `woocommerce`, `xero`, `youtube`, `zapier`, `zendesk`, `zeroops`, `zoho`

**Cloud logos** — `file:cloud/<provider>/<category>/<name>` (e.g. `file:cloud/aws/storage/s3`):

- **aws**: `analytics/athena`, `analytics/glue`, `analytics/redshift`, `compute/ec2`, `compute/lambda`, `database/dynamodb`, `database/rds`, `ml/sagemaker`, `networking/route53`, `networking/vpc`, `storage/s3`, `streaming/kinesis`
- **azure**: `analytics/data-factory`, `analytics/synapse`, `compute/functions`, `compute/virtual-machines`, `database/cosmos-db`, `database/sql-database`, `ml/machine-learning`, `networking/virtual-network`, `storage/blob-storage`, `streaming/event-hubs`
- **gcp**: `analytics/bigquery`, `analytics/dataflow`, `analytics/dataproc`, `compute/cloud-functions`, `compute/compute-engine`, `database/bigtable`, `database/cloud-sql`, `ml/vertex-ai`, `networking/vpc`, `storage/cloud-storage`, `streaming/pubsub`

Also: `file:persona/user` (a person — normally the business-user persona is built into the `genie-one` component, but you can place it as a standalone `logo` node if needed), `file:vendor/custom-source` (generic animated shapes source when no real logo fits).

<!-- END: generated-icons -->

---

## Authoring rules

1. **Prefer composites** (fewer nodes, richer): `lakeflow-genie-block` over `sdp`+`lakeflow-connect`; `governance-block` over the five loose governance tiles; `agent-bricks` for managed multi-agent. Never add a composite's sub-parts beside it (see each catalog `authoring` note).
2. **Place by `col`/`row`, never invent pixels.** Banners (`db-platform`, `governance-block`) `pin` to the platform box's corners — an absolute `at` drifts off-corner the moment the node set changes.
3. **Source → Lakeflow edge MUST name the ingest port** (not inferred): `@in-lakeflow-connect` (DB/SaaS) · `@in-zerobus` (realtime/sensor) · `@in-direct` (files). All other handles infer from geometry. That handle also picks the flow animation.
4. **Genie One / user edges: auto-arrow** — leave `arrow`/`flow` out. Data-flow edges: `flow: true`.
5. **A repeated component needs `#N`** (`model-serving`, `model-serving#2`). A made-up id (`rag-endpoint`) re-keys to its type and silently collides.
6. **Crowded/unreadable edge labels → add vertical space.** Render, look: if labels between two rows collide, with `rowGrid` **skip a row number** (`0, 2` not `0, 1`) so an empty band opens for them; without it, bump the `below`/`above` `gap`. Prefer space over shrinking/dropping labels.
7. **Explain non-obvious choices with `note`** (never rendered, round-trips): a relabeled tile (`lakeflow-jobs`→"Batch Scoring Job"), a deliberate omission ("features only, no gold→training"), why a handle/row was chosen. The `story` covers the overall arc; `note` covers the per-node/edge WHY so the next edit isn't a guess.

---

## Reference files

Copy the closest one and adapt (strip `//`, emit plain JSON):

- `reference/architecture-complete.jsonc` — the flagship end-to-end platform (2 tabs). The minimal shape is inlined in **The format** above.
- `reference/agent-bricks.jsonc` — a multi-agent Supervisor over Knowledge Assistant · Genie · Hosted MCPs → Genie One + dashboard. Shows `alignY` + `below` relative placement.
- `reference/ml-platform.jsonc` — end-to-end ML: medallion SDP → Feature Store + Vector Search → MLflow training → UC Model Registry → real-time / RAG / batch serving, all inside a Unity Catalog box. Shows nested boxes (`sdp-box` inside `uc-box`), a pinned `unity-catalog` banner, and the `#N` instance-id rule for two `model-serving` tiles.
<!-- BEGIN: local-render-files (stripped inside Solution Builder — renderer/ isn't shipped into a project) -->
- `renderer/architecture-viewer.html` / `architecture-editor.html` — copy one, edit its inline JSON.
- `renderer/render-arch.mjs` — `node renderer/render-arch.mjs <file>.html` → a PNG to read.
<!-- END: local-render-files -->
