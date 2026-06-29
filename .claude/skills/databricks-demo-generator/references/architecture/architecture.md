# Architecture Diagram — Schema & Authoring Reference

`architecture.md` (the **project file**, at the project root) drives an **interactive architecture canvas**: a Lucidchart-style ReactFlow editor. The file is a **flat list of the components you see** plus the **lines between them** — nothing else. A node is on the canvas iff it's in `nodes`; there is no visibility state, no bands, no catalog-diffing to reason about.

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
  "nodes": [
    { "id": "lakehouse", "type": "lakehouse", "at": [675, 3] },
    { "id": "genie", "type": "genie", "at": [979, 51], "label": "Genie Room", "desc": "Ask anything about your data" },
    { "id": "src-erp", "type": "source", "at": [-124, -84], "label": "ERP System", "icon": "file:vendor/sap", "ingest": "lakeflow-connect" },
    { "id": "governance-block", "type": "governance-block", "at": [1058, -170], "style": { "border": 0, "shadow": 0, "radius": 10 } },
    { "id": "platform-box", "type": "box", "at": [648, 8], "size": [1424, 496], "z": -1 },
    { "id": "user", "type": "logo", "at": [1312, 64], "icon": "file:persona/user" }
  ],
  "edges": [
    { "id": "e1", "from": "src-erp@r", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
    { "id": "e2", "from": "lakehouse@r", "to": "genie@l", "flow": true },
    { "id": "e3", "from": "genie-one@l", "to": "aibi-dashboards@r" }
  ]
}
```

### Top level
| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Toolbar title. Defaults to "Solution architecture". |
| `story` | No | One-line caption under the title. |
| `options.trademarkLogos` | No | `true` → render real third-party brand logos. Default `false` (neutral badges). |
| `nodes` | Yes | The components on the canvas (see below). |
| `edges` | Yes | The lines between them. |

### A node
| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique node id. For a 2nd placement of the same component use `genie#2` (the `#N` suffix). |
| `type` | Yes | A **catalog component id** (`genie`, `lakehouse`, `lakeflow-genie-block`, `governance-block`, `db-platform`, … — see the catalog below; this folds in the old composite "kind") OR a special kind: `source` · `box` · `text` · `logo` · `image`. |
| `at` | Yes | `[x, y]` canvas position. Copy/nudge from a reference — there is no auto-layout. |
| `size` | No | `[w, h]` if resized from the natural size. |
| `rot` · `scale` · `z` · `group` | No | Rotation°, content scale, stacking order, group tag. |
| `label` · `desc` · `icon` | No | Override the catalog default copy/icon (only when it differs). |
| `ingest` | source only | `lakeflow-connect` (default) · `zerobus` · `direct`. |
| `text`·`fontSize`·`bold`·`border`·`vAlign`·`hAlign`·`src` | box/text/logo/image | Annotation props. |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity }` — visual overrides; emit only what differs. (`border` = width px; `shadow` = 0–100; `radius` = px.) |

The **band** a component belongs to (which sets its tile color) is derived from its `type` — you never write it.

### An edge
`{ "id"?, "from": "<srcId>[@handle]", "to": "<tgtId>[@handle]", "flow"?, "arrow"?, "dashed"?, "shape"?, "flowStyle"?, "centerX"?, "label"? }`

- `from`/`to` carry an inline **`@handle`** — a composite port (`in-lakeflow-connect`, `in-zerobus`, `in-direct`, `r`) or a side (`l`/`r`/`t`/`b`).
- `flow: true` → animated "data flowing" line. Omit for a static line.
- `arrow`: omit/`"auto"` (default — auto-draws an arrowhead for edges touching the **user persona** or **Genie One**) · `"none"` · `"end"` · `"start"` · `"both"`. An explicit arrow is a static relationship line.
- `shape`: `smooth` (default) · `straight` · `step`. `flowStyle`: `dot`·`particles`·`docs`·`laser`.

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
4. **Every node needs `at`.** Copy a reference layout and nudge — don't invent coordinates from nothing.
5. **Descriptions are the point.** Make `desc`s demo-specific and human, not datasheet copy.
6. **Genie One / user edges are auto-arrows** (leave `arrow` out). Pipeline edges use `flow: true`.

---

## Complete example

See `architecture-complete.json` (full, known-good) and `architecture-complete.jsonc` (the same, commented) in this folder; `architecture-simple.json` for the minimal shape.
