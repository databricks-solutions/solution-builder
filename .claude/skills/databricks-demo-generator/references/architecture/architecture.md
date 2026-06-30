# Architecture Diagram — Schema & Authoring Reference

`architecture.md` (the **project file**, at the project root) drives an **interactive architecture canvas**: a Lucidchart-style ReactFlow editor. The file is a **flat list of the components you see** plus the **lines between them** — nothing else. A node is on the canvas iff it's in `nodes`; there is no visibility state, no bands, no catalog-diffing to reason about.

**Author STRUCTURE, not pixels.** You assign each node to a **column** (a left→right lane) and let the renderer compute coordinates; you draw **edges by node id** and the handle is inferred; you wrap a group of nodes in a **container box** that auto-sizes around them. You almost never write `x/y`. (You *may* pin a node with an explicit `at` — it overrides its column — for things like top banners. And once the user drags a node on the canvas, that position is saved as `at`.)

This folder ships **reference architectures** you start from:

- `architecture-complete.json` — the **default flagship** end-to-end shape (sources → Lakeflow+Genie → lakehouse+lakebase → dashboard/Genie/app → Genie One → user, on one platform box, governance over the top). See *The canonical end-to-end flow*.
- `architecture-complete.jsonc` — the SAME layout, annotated with `//` comments explaining every node + edge. Read it to learn the wiring; it is for you, not the renderer.
- `architecture-simple.json` — the minimal shape: one source → Lakeflow+Genie → lakehouse → a dashboard + app, with Genie.

To start from one, copy its `nodes`/`edges` into the project's `architecture.md` (wrapped in a ```json fence — see *Project file format*) and adapt. **Emit plain JSON — never copy the `//` comments from the `.jsonc`** (the canvas `JSON.parse`s the file; comments break it).

---

## The format

```json
{
  "name": "My Demo Architecture",
  "story": "One line framing the demo (optional).",
  "options": { "trademarkLogos": false },
  "columns": ["sources", "pipeline", "compute", "work", "entry", "user"],
  "nodes": [
    { "id": "src-erp", "type": "source", "col": "sources", "label": "ERP System", "icon": "file:vendor/sap", "ingest": "lakeflow-connect" },
    { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline" },
    { "id": "lakehouse", "type": "lakehouse", "col": "compute" },
    { "id": "aibi-dashboards", "type": "aibi-dashboards", "col": "work", "row": 1 },
    { "id": "genie", "type": "genie", "col": "work", "row": 2, "label": "Genie Room", "desc": "Ask anything about your data" },
    { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },
    { "id": "user", "type": "logo", "col": "user", "icon": "file:persona/user" },
    { "id": "governance-block", "type": "governance-block", "at": [1058, -178] },
    { "id": "platform-box", "type": "box", "z": -1, "border": true, "wraps": ["src-erp", "lakeflow-genie-block", "lakehouse", "aibi-dashboards", "genie", "genie-one", "user"] }
  ],
  "edges": [
    { "id": "e1", "from": "src-erp", "to": "lakeflow-genie-block", "flow": true },
    { "id": "e2", "from": "lakehouse", "to": "genie", "flow": true },
    { "id": "e3", "from": "genie-one", "to": "aibi-dashboards" }
  ]
}
```

### Top level
| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Toolbar title. Defaults to "Solution architecture". |
| `story` | No | One-line caption under the title. |
| `options.trademarkLogos` | No | `true` → render real third-party brand logos. Default `false` (neutral badges). |
| `columns` | No | Ordered left→right **lane names**. Nodes reference one via `col`. Add/rename/insert lanes freely for a different shape — no fixed taxonomy. |
| `nodes` | Yes | The components on the canvas (see below). |
| `edges` | Yes | The lines between them. |

### A node
| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique node id. For a 2nd placement of the same component use `genie#2` (the `#N` suffix). |
| `type` | Yes | A **catalog component id** (`genie`, `lakehouse`, `lakeflow-genie-block`, `governance-block`, `db-platform`, … — see the catalog below; this folds in the old composite "kind") OR a special kind: `source` · `box` · `text` · `logo` · `image`. |
| `col` | placement | The lane (from `columns`) this node sits in. Nodes in a lane stack vertically, centered. **Primary way to place a node.** |
| `row` | No | Order within the lane (else order of appearance). |
| `wraps` | container | On a `type:"box"`: the node ids this box ENCLOSES. The box auto-sizes around them (+ `pad`, default 24). Nesting works (a box may wrap boxes) — see *Containers*. |
| `at` | No | `[x, y]` **explicit** position (node center). **Overrides `col`.** Use only for off-flow elements (top banners) or to pin something. |
| `size` | No | `[w, h]` if resized from the natural size. |
| `rot` · `scale` · `z` · `group` · `pad` | No | Rotation°, content scale, stacking order, group tag, container padding. |
| `label` · `desc` · `icon` | No | Override the catalog default copy/icon (only when it differs). |
| `ingest` | source only | `lakeflow-connect` (default) · `zerobus` · `direct`. |
| `text`·`fontSize`·`bold`·`border`·`vAlign`·`hAlign`·`src` | box/text/logo/image | Annotation props. |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity }` — visual overrides; emit only what differs. (`border` = width px; `shadow` = 0–100; `radius` = px.) |

The **band** a component belongs to (which sets its tile color) is derived from its `type` — you never write it.

### An edge
`{ "id"?, "from": "<srcId>[@handle]", "to": "<tgtId>[@handle]", "flow"?, "arrow"?, "dashed"?, "shape"?, "flowStyle"?, "centerX"?, "label"? }`

- **Write `from`/`to` by node id; the `@handle` is INFERRED** from geometry: left→right ⇒ source `@r` → target `@l`; vertical ⇒ `@b`/`@t`. A **source** feeding the Lakeflow block routes to the right port from its `ingest` (`lakeflow-connect`→`in-lakeflow-connect`, `zerobus`→`in-zerobus`, `direct`→`in-direct`) automatically.
- Add an explicit **`@handle`** only to override the inference — a composite port (`in-lakeflow-connect`, `in-zerobus`, `in-direct`, `r`) or a side (`l`/`r`/`t`/`b`). E.g. force a vertical link with `@b`/`@t`.
- `flow: true` → animated "data flowing" line. Omit for a static line.
- `arrow`: omit/`"auto"` (default — auto-draws an arrowhead for edges touching the **user persona** or **Genie One**) · `"none"` · `"end"` · `"start"` · `"both"`. An explicit arrow is a static relationship line.
- `shape`: `smooth` (default) · `straight` · `step`. `flowStyle`: `dot`·`particles`·`docs`·`laser`.

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

---

## Generating an architecture — three entry points

You produce the same flat `nodes`/`edges` regardless of where the intent comes from:

1. **From a pasted conversation / free-text intent.** The user pastes a transcript or types "ingest ERP data into a business app." **Extract the main components** they imply (source systems, pipeline, serving layer, dashboard/app, agents), map each to a catalog `type`, and place them — start from `architecture-complete.json` (or `-simple.json`) and adapt positions + swap the sources. Don't invent a story.
2. **From an existing story + selected capabilities.** A demo has a `README.md`/`resources.json`. Place a node per chosen capability (use its slug as the `type`) plus the story's sources; give headline nodes story-tied `label`/`desc`.
3. **From a reference, then edited.** Start from a reference file and tweak.

Map the user's words to real catalog `type`s. For a source the catalog can't know, use `type:"source"` with a vendor `icon` + `ingest`.

---

## The canonical end-to-end flow (the "complete" shape)

`architecture-complete.json` is the flagship layout — copy it and adapt. Left → right:

```
sources (≈3 rows)  →  Lakeflow + Genie (one block)  →  lakehouse + lakebase
     →  dashboard + Genie Room + app  →  Genie One  →  the end user
```

- **Top-left:** the `db-platform` wordmark. **Top-right:** `governance-block` (Unity Catalog) over everything. **Everything sits inside ONE big white `box`** (`z:-1`) — that box *is* "the Databricks Platform".
- **The `lakeflow-genie-block` has THREE left ports** — wire each source to the one matching HOW it's ingested:
  - `in-lakeflow-connect` ← **databases / SaaS apps**: Postgres, ERP/SAP, Salesforce, MySQL…
  - `in-zerobus` ← **realtime streams / sensors / IoT / events**: Kafka, sensor data…
  - `in-direct` ← **files NOT supported by Connect**: PDFs, CSV/Parquet dumps on a UC Volume.
  - Right port `@r` → the compute layer. **Inside the block = Genie Code + SDP** (all bronze→silver→gold) — do NOT add separate `sdp`/`genie-code` nodes.
- **Compute** (both fed by `lakeflow-genie-block@r`): `lakehouse` (BI+AI) and `lakebase` (live app state).
- **Consumption:** `lakehouse` → `aibi-dashboards` + `genie`. `lakebase` → the `databricks-apps-work` app; the **app also consumes the Genie Room + dashboard**.
- **End user:** a `file:persona/user` `logo` reaches the resources **through `genie-one`**. Those edges are **relationship arrows** — leave `arrow` out (auto): user ==> Genie One, Genie One --> dashboard / Genie Room / app.

---

## Component catalog (dense reference)

Use the `type` id; the renderer supplies the icon, label, default description, and size. Override `label`/`desc` only when story-specific.

### Data (pipeline / storage)
| type | label | notes |
|----|-------|-------|
| `lakeflow-block` | Lakeflow | composite — ingest rail (Connect/Zerobus/direct) + bronze→silver→gold. 224×148. Ports `in-lakeflow-connect`/`in-zerobus`/`in-direct` (left), `r` (right). |
| `lakeflow-genie-block` | Lakeflow + Genie | composite — Lakeflow + a "Built with Genie Code" footer. 360×208. Same ports. **Preferred** pipeline block. |
| `lakeflow-connect` | Lakeflow Connect | plain tile (managed connectors). |
| `zerobus-ingest` | Lakeflow Zerobus | plain tile (realtime ingest). |
| `sdp` | Lakeflow SDP | 230×112 — declarative bronze→silver→gold (when not using the composite). |
| `uc-volume` | UC Volume | governed file storage (where PDFs land). |
| `lakeflow-jobs` | Lakeflow Jobs | "Orchestrate anything". |
| `notebooks-eda` | Notebooks | interactive analysis. |
| `delta-sharing` · `marketplace` | — | open sharing / 3rd-party assets. |
| `lakebase` | Lakebase | serverless Postgres for app state. |
| `lakehouse` | Lakehouse | one governed copy for BI+AI. "RT" badge. |

### Work (agents / analytics)
| type | label | notes |
|----|-------|-------|
| `genie` | Genie Room | plain-language Q&A. |
| `genie-one` | Genie One - Mobile app | business-user access surface. |
| `knowledge-assistant` | Knowledge Assistant | grounded answers over documents. |
| `supervisor-agent` | Multi-Agent Supervisor | routes a question across agents. |
| `agent-bricks` | Agent Bricks | composite — Supervisor over KA/Genie/MCP/Functions + task chips. 230×170. |
| `ml-training-serving` | ML Models | train/register/serve. |
| `vector-search` | Vector Search | semantic retrieval. |
| `information-extraction` · `document-parsing` · `classification` | — | doc → structured. |
| `genie-code` | Built with Genie Code | composite — 360×112 "describe it, Genie Code builds it" strip. |

### Apps
| type | label | notes |
|----|-------|-------|
| `databricks-apps-work` | Databricks Apps | "Deploy business apps" — the custom app. **Preferred** over `databricks-apps`. |
| `aibi-dashboards` | AI/BI Dashboard | governed dashboards. |
| `databricks-apps` | Databricks Apps | legacy id. |

### Governance / platform
| type | label | notes |
|----|-------|-------|
| `governance-block` | Unified Governance | composite — Unity Catalog + AI Gateway + Genie Ontology bar. 580×108. **Preferred** over the loose tiles. |
| `db-platform` | Databricks Platform | composite — the Databricks wordmark + "The Data Intelligence Platform". 380×60. Title banner. |
| `unity-catalog` · `ai-gateway` · `data-quality` · `abac` · `data-classification` | — | individual governance tiles. |

> **Composites** carry their own internal layout (and Lakeflow's named ports). Treat each as ONE node — don't also add its sub-parts (e.g. no `sdp` next to `lakeflow-genie-block`).

### Custom / composite blocks — what's drawn inside & when to use

These are the rich, self-contained blocks. Each renders a small diagram *inside* the tile, so picking the right one tells a lot of the story on its own. **Use one composite instead of several loose tiles.**

- **`lakeflow-genie-block` (Lakeflow + Genie)** — *Inside:* a 3-port ingest rail (Lakeflow Connect / Zerobus / direct file landing) feeding a bronze→silver→gold SDP pipeline, with a "Built with Genie Code" footer. *Use when:* the demo has a real ingestion + transformation pipeline (almost always). It IS the data layer — every source connects into one of its three left ports, and it emits to the compute layer from `@r`. **This already contains SDP + Genie Code**, so never add `sdp` or `genie-code` beside it. Prefer over `lakeflow-block` unless you specifically don't want the Genie Code framing.

- **`lakeflow-block` (Lakeflow)** — *Inside:* the same ingest rail + medallion pipeline, **without** the Genie Code footer. *Use when:* you want the pipeline but the demo's narrative isn't "built with Genie Code." Same 3 ports.

- **`governance-block` (Unified Governance)** — *Inside:* a wide bar with Unity Catalog + Unity AI Gateway (showing OpenAI/Anthropic/Gemini — "access any model") + a live Genie Ontology graph. *Use when:* the demo wants to show governance/semantics as ONE foundation bar across the top or bottom (the normal case). Prefer over the loose `unity-catalog`/`ai-gateway`/`data-quality`/`abac`/`data-classification` tiles — use those only if you must call out one governance feature in isolation.

- **`agent-bricks` (Agent Bricks)** — *Inside:* a Supervisor agent at the root of a tree, orchestrating Knowledge Assistant / Genie room / MCP / Functions, with Classification·Extraction·Doc-parsing task chips. *Use when:* the demo's agent layer is a **managed multi-agent system** (a supervisor routing to specialists). If the demo only uses ONE agent capability (just Genie, or just a KA), use that single tile instead — don't over-state with Agent Bricks.

- **`genie-code` (Built with Genie Code)** — *Inside:* a terminal that "types" a request then animates building a mini pipeline + dashboard. *Use when:* you want a standalone "describe it → Genie Code builds it" beat and you're NOT already using `lakeflow-genie-block` (which has the Genie Code footer built in). Rarely needed alongside the combined block.

- **`db-platform` (Databricks Platform)** — *Inside:* the Databricks wordmark + "The Data Intelligence Platform". *Use as:* a title banner, typically top-left, to label the whole diagram as running on the platform. Pair it with a big background `box` (`wraps` the flow, `z:-1`) that everything sits inside. **`db-platform` and `governance-block` render with no border and no shadow by default** — don't add a `style` for that.

- **`genie-one` (Genie One – Mobile app)** — not a composite, but special: the **business-user / mobile entry point**. *Use when:* the demo has an end user who consumes the resources through one surface. Convention: a `file:persona/user` `logo` to its right (user ==> Genie One), and Genie One --> the dashboard / Genie Room / app. These edges auto-render as arrows (leave `arrow` out).

- **`source` + `file:vendor/custom-source`** — the animated "generic" source (red triangle/circle/square). *Use when:* the demo's source has no real vendor logo, or you want a placeholder the user renames. Otherwise prefer a real `file:vendor/<name>` logo.

### Sources
Use `type:"source"` with a vendor `icon` (`file:vendor/<name>` — e.g. `postgresql`, `kafka`, `sap`, `salesforce`, `shopify`) and an `ingest` path. Generic fallbacks: `pdfLogo`, `sensorSource`, `inputData`, `unstructuredData`. The `ingest` decides which Lakeflow port the source's edge targets (`lakeflow-connect`→`in-lakeflow-connect`, `zerobus`→`in-zerobus`, `direct`→`in-direct`). A custom shapes source: `file:vendor/custom-source`. A persona/user marker: `file:persona/user` (as a `logo` node).

---

## Project file format

The project file is `architecture.md` — **markdown with one fenced ```json block** holding the object above. The reference `.json` files are raw (unfenced); when you start from one, paste its content inside the fence:

````markdown
```json
{ "name": "...", "nodes": [ ... ], "edges": [ ... ] }
```
````

---

## Authoring rules

1. **Only list what's shown.** A node in `nodes` is on the canvas; anything else simply isn't there. No state, no hidden list.
2. **Map words → catalog `type`s.** Reuse catalog ids (so deep-links + `resources.json` line up). Use `type:"source"` for the demo's source systems.
3. **Prefer composites:** `lakeflow-genie-block` over `sdp`+`lakeflow-connect`; `governance-block` over the five governance tiles; `agent-bricks` for managed multi-agent.
4. **Place by `col`, not coordinates.** Declare `columns`, give each node a `col` (+ `row` to order within a lane). Let the renderer compute x/y. Use an explicit `at` only for off-flow banners (db-platform, governance) or to pin something. Don't invent pixel coordinates.
5. **Wrap groups in a `box` via `wraps`** — the platform box (the whole flow), or cloud/VPC/zone containers (nested). It auto-sizes; you never set its `at`/`size`.
6. **Edges by id; handles inferred.** Write `from`/`to` as plain ids — the `@handle` and source ingest port are inferred. Add `@handle` only to override (e.g. `@b`/`@t` for a vertical link).
7. **Descriptions are the point.** Make `desc`s demo-specific and human, not datasheet copy.
8. **Genie One / user edges are auto-arrows** (leave `arrow`/`flow` out). Pipeline edges use `flow: true`.

---

## Complete example

See `architecture-complete.json` (full, known-good) and `architecture-complete.jsonc` (the same, commented) in this folder; `architecture-simple.json` for the minimal shape.
