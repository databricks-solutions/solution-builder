---
name: databricks-architecture
description: Create or edit a Databricks solution-architecture diagram — a Lucidchart-style platform diagram (sources → Lakeflow/Genie pipeline → lakehouse/lakebase → dashboards, Genie, apps → end user, on a governed platform). Use when someone wants to draw, generate, or edit an architecture diagram, visualize a Databricks solution's components and data flow, or produce an architecture image. Produces a self-contained HTML you render to a PNG and iterate on.
---

# Databricks Architecture Diagram

Build a **Databricks solution-architecture diagram** — the "Data + AI Platform" picture: source systems on the left flowing through a governed pipeline to compute, then to dashboards / Genie / apps, surfaced to an end user, all on one governed platform.

The diagram is a **flat list of the components you see** plus the **lines between them** — nothing else. A node is on the canvas iff it's in `nodes`; there is no visibility state, no bands, no catalog-diffing to reason about.

**Author STRUCTURE, not pixels.** You assign each node to a **column** (a left→right lane) and let the renderer compute coordinates; you draw **edges by node id** and the handle is inferred; you wrap a group of nodes in a **container box** that auto-sizes around them. You almost never write `x/y`. (You *may* pin a node with an explicit `at` — it overrides its column — for things like top banners.)

---

## Workflow — how to make a diagram

An architecture lives in **one self-contained HTML file** with its data in an inline JSON block. To create one:

1. **Copy a renderer template** to a new file, e.g. `cp renderer/architecture-viewer.html my-arch.html` (read-only viewer) — or `renderer/architecture-editor.html` if a human will edit it in a browser (Load / Download PNG·SVG·HTML buttons).
2. **Edit the inline JSON** near the top of the copied file:
   ```html
   <script type="application/json" id="architecture">
   { "name": "...", "columns": [...], "nodes": [...], "edges": [...] }
   </script>
   ```
   Put your `nodes`/`edges` (schema below) inside that block. Plain JSON — no `//` comments.
3. **View it**: the end user can open the HTML in any browser (double-click — no server). The editor variant can Download a PNG/SVG.

Start from the minimal example in **The format** below (copy its `nodes`/`edges` into the inline block and adapt), or from `reference/architecture-complete.jsonc` — the flagship end-to-end shape — when the demo needs the full platform story. **Strip the `//` comments** when you paste (the inline block is parsed as JSON).

## Feedback loop — render to an image and iterate (for the agent)

After writing/editing the JSON in a `*.html`, **render it to a PNG and look at it**:

```
node renderer/render-arch.mjs my-arch.html        # → my-arch.png
```

Then **read `my-arch.png`**, check the diagram is right (components present, wired correctly, laid out cleanly), and edit the inline JSON to fix anything. Repeat until it looks right. (Needs `node` + a Chrome/Chromium; set `CHROME_PATH=/path/to/chrome` if it isn't auto-found. No `npm install` required.)

---

## The format

The minimal end-to-end shape of ONE architecture (one tab) — **use this as your
starting point**, and wrap it in an array `[ … ]` when you emit (see *Tabs*
below). It's JSONC so you can read the comments; **strip the `//` comments**
when you emit into the inline block, which is parsed as plain JSON:

```jsonc
{
  "name": "Simple Solution Architecture",
  "story": "One source → governed Lakeflow + Genie pipeline → lakehouse → a dashboard and an app, with Genie for plain-language Q&A.",
  "columns": ["sources", "pipeline", "compute", "work", "entry"],
  "nodes": [
    // A real, named source. `ingest` decides which Lakeflow port it lands on.
    { "id": "src-postgres", "type": "source", "col": "sources", "row": 1, "label": "Postgres", "icon": "file:vendor/postgresql", "ingest": "lakeflow-connect" },
    // A source we have NO logo for → `icon:"text"` renders the label as a
    // brand-colored text badge (no icon file). Use this for niche/internal systems.
    { "id": "src-erp", "type": "source", "col": "sources", "row": 2, "label": "Acme ERP", "icon": "text", "ingest": "lakeflow-connect" },
    // The one data-layer block (ingest + bronze→silver→gold, built by Genie Code).
    { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline" },
    { "id": "lakehouse", "type": "lakehouse", "col": "compute" },
    // Consumption lane: dashboard + Genie + the business app, stacked.
    { "id": "aibi-dashboards", "type": "aibi-dashboards", "col": "work", "row": 1 },
    { "id": "genie", "type": "genie", "col": "work", "row": 2 },
    { "id": "databricks-apps-work", "type": "databricks-apps-work", "col": "work", "row": 3 },
    // Genie One = the business-user entry point (an INTERFACE onto everything to
    // its left). It's wide, so ROTATE it 90° to stand vertically — a slim lane
    // that saves horizontal space while still spanning the consumption tiles.
    { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },
    // Governance bar PINNED to the platform box (never absolute `at` — those
    // coordinates drift off-corner the moment the node set changes). The
    // non-float pin reserves a top band, so the box grows to enclose it.
    { "id": "governance-block", "type": "governance-block", "pin": { "at": "top", "to": "platform-box" } },
    // One white box wrapping the whole flow = "all of this is the platform".
    { "id": "platform-box", "type": "box", "z": -1,
      "wraps": ["src-postgres", "src-erp", "lakeflow-genie-block", "lakehouse", "aibi-dashboards", "genie", "databricks-apps-work", "genie-one"] }
  ],
  "edges": [
    { "id": "e1", "from": "src-postgres", "to": "lakeflow-genie-block", "flow": true },
    { "id": "e1b", "from": "src-erp", "to": "lakeflow-genie-block", "flow": true },
    { "id": "e2", "from": "lakeflow-genie-block", "to": "lakehouse", "flow": true },
    { "id": "e3", "from": "lakehouse", "to": "aibi-dashboards", "flow": true },
    { "id": "e4", "from": "lakehouse", "to": "genie", "flow": true },
    { "id": "e5", "from": "lakehouse", "to": "databricks-apps-work", "flow": true },
    // Genie One fronts the consumption tiles (auto-arrow — Genie One edges
    // point away from it toward the resource; no `flow`/`arrow` needed).
    { "id": "e6", "from": "genie-one", "to": "aibi-dashboards" },
    { "id": "e7", "from": "genie-one", "to": "genie" },
    { "id": "e8", "from": "genie-one", "to": "databricks-apps-work" }
  ]
}
```

Placement is SYMBOLIC: `columns` are left→right lanes; a node's `col` puts it
in a lane (stacked top→bottom by `row`). The renderer computes the pixels —
you almost never write `at`. Edges are by node id; the `@handle` is inferred.
`options.trademarkLogos` and `custom_logos` are covered in the tables +
sections below.

### Tabs — the file is an ARRAY of architectures

The top level is a JSON **array**, one element per **tab**. Each element is a
full architecture object (exactly the shape above); its `name` becomes the tab
label. This lets one diagram hold several views (e.g. "Ingestion", "Serving",
"Governance") the user switches between.

```jsonc
[
  { "name": "Ingestion", "columns": [...], "nodes": [...], "edges": [...] },
  { "name": "Serving",   "columns": [...], "nodes": [...], "edges": [...] }
]
```

- **Always emit an array**, even for a single architecture: `[ { … } ]`.
- A bare single object `{ … }` is still accepted (auto-wrapped as one tab), but
  the canonical, written-back form is the array.
- The user's `+` / `×` add and remove tabs; renaming a tab rewrites that
  element's `name`. You normally emit the whole array at once.

### Top level  *(each element of the tabs array)*
| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | The **tab label** for this architecture. Defaults to "Architecture N". |
| `story` | No | One-line description of this architecture. Metadata (kept in the file); not rendered on the canvas. |
| `options.trademarkLogos` | No | `true` → render real third-party brand logos. Default `false` (neutral badges). |
| `columns` | No | Ordered left→right **lane names**. Nodes reference one via `col`. Add/rename/insert lanes freely for a different shape — no fixed taxonomy. |
| `custom_logos` | No | `[{ id, svg }]` — inline SVG logos. Reference one from any node's `icon` as `"custom:<id>"`. See *Custom logos & images*. |
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
| `bounds` | container | On a `type:"box"`: per-side edge anchors `{ left?, right?, top?, bottom? }`. Each side = `"<nodeId>:<anchor>"` (anchor ∈ `left`/`right`/`center` for x, `top`/`bottom`/`center` for y), or `"col:<name>:<anchor>"` (a lane's edge/midpoint), or `"wrap"`. Lets the box edge cut HALFWAY through a node/column. Unspecified sides fall back to `wraps`. |
| `pin` | placement | Dock this node into a box corner (overrides `col`). An object `{ at, to?, pad?, float? }`: `at` = one of `top-left`·`top`·`top-right`·`left`·`center`·`right`·`bottom-left`·`bottom`·`bottom-right`; `to` = box id to dock into (default: the largest box); `pad` = inset px (default 16); `float` = `false`/omitted → **reserve a band** (the box GROWS so this never overlaps content — top pin pushes content down, bottom extends the box down), `true` → **overlay** at the corner (may sit over content). Use for banners / personas. |
| `at` | No | `[x, y]` **explicit** position (node center). **Overrides `col`/`pin`.** Use for fully manual placement. (A user drag also persists here.) |
| `size` | No | `[w, h]` if resized from the natural size. |
| `rot` · `scale` · `z` · `pad` | No | Rotation° (0/90/180/270), content scale, stacking order (negative = behind), container padding. |
| `group` | No | A shared string id stamped on several nodes → they form a GROUP: selecting one selects all, and they move together on the canvas. |
| `label` · `icon` | No | Override the catalog default label/icon (only when it differs). `icon` may be a built-in name, a `file:vendor/…`/`file:cloud/…` key, or a `custom:<id>` (see *Custom logos & images*). |
| `desc` | No | The node's **description line** — one line under the label. On a catalog tile it overrides the default blurb; on a `source`/`logo` it's the tile's only descriptive text. `""` (empty string) deliberately CLEARS it (renders nothing); omit to keep the catalog default. See *Node text: title · description · caption*. |
| `showDesc` | No | `true`/`false` to force the description line on/off. **Default:** a catalog tile shows its description when it has one; a `source`/`logo` shows it only when you set `desc`. |
| `caption` | source · logo | Where the label sits relative to the icon: `right` · `left` · `top` · `bottom`. **Default:** `right` for a source, below (`bottom`) for a logo. |
| `fontSize` | source · logo · text/box | Label font size in px. Applies to source/logo captions and to `text`/`box` annotations. |
| `ingest` | source only | `lakeflow-connect` (default) · `zerobus` · `direct`. |
| `text`·`bold`·`vAlign`·`hAlign`·`src` | box/text/logo/image | Annotation props — see *Annotations*. (`fontSize` and `caption` are in the rows above.) |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity }` — visual overrides; emit only what differs. `border` = width px (0 = none); `borderStyle` = `solid`/`dashed`; `borderColor`/`fill`/`font` = hex; `radius` = corner px; `shadow` = 0–100 intensity (0 = none); `opacity` = 0–1. |

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

### Annotations (free-form, not catalog components)

Four `type`s let you add labels and marks that aren't Databricks components:

| type | props | use |
|------|-------|-----|
| `text` | `text`, `fontSize`, `bold`, `vAlign`/`hAlign` | a free-floating text label. |
| `box` | `text`, `fontSize`, `vAlign`/`hAlign`, + `wraps`/`bounds`/`pad` | a labeled rectangle / container (the platform box, cloud/VPC boxes). |
| `logo` | `icon` (any icon key, incl. `file:…` or `custom:<id>`), `text` (the caption), `caption` (right/left/top/bottom — default below), `fontSize`, `desc`/`showDesc` | a standalone logo — e.g. the `file:persona/user` end-user marker. |
| `image` | `src` | a standalone image (URL or base64 — see below). |

> A `box` shows a 1px border by default; `text` shows none. The border is controlled ONLY by `style` — set `style.border` (px width, `0` = none), `style.borderColor`, `style.borderStyle` (`solid`/`dashed`). There is no separate border boolean.

### Node text: title · description · caption

Every icon-and-label node (catalog **tiles**, data **sources**, and **logo** annotations) share one anatomy: an **icon**, a **title** (the label), and an optional **description** line. Sources and logos add a **caption position** — where the title sits relative to the icon.

```
Catalog tile / source (caption "right", the default):
   ┌────────────────────────────┐
   │  [icon]  Title              │   ← label
   │          description line   │   ← desc (one line, truncates)
   └────────────────────────────┘

Source / logo caption positions (icon ↔ label):
   right:  [icon] Label      left:  Label [icon]
   top:      Label           bottom:   [icon]
            [icon]                     Label
```

- **title** = `label` (overrides the catalog default). A source/logo with an empty title renders no text.
- **description** = `desc`, one line under the title. Shown by default when present (a tile with a catalog blurb shows it; a source/logo shows it once you set `desc`). Force it with `showDesc: true`/`false`. `desc: ""` clears it.
- **caption** (source/logo) = `right`·`left`·`top`·`bottom`; **fontSize** sizes the label. A vertical caption (`top`/`bottom`) uses a taller box.

Example — a source tile with the label under the icon, sized, with a description:
```json
{ "id": "src-crm", "type": "source", "icon": "file:vendor/salesforce",
  "label": "Salesforce", "caption": "bottom", "fontSize": 12,
  "desc": "Nightly account + opportunity export", "showDesc": true }
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

So: a **data source** reads as a bordered tile out of the box, while a **logo** is a naked mark until you give it a border/fill — that's the intended contrast.

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

## Generating an architecture — three entry points

You produce the same flat `nodes`/`edges` regardless of where the intent comes from:

1. **From a pasted conversation / free-text intent.** The user pastes a transcript or types "ingest ERP data into a business app." **Extract the main components** they imply (source systems, pipeline, serving layer, dashboard/app, agents), map each to a catalog `type`, and place them — start from the minimal example in **The format** (or `architecture-complete.jsonc` for the full shape) and adapt positions + swap the sources. Don't invent a story.
2. **From an existing story + selected capabilities.** A demo has a `README.md`/`resources.json`. Place a node per chosen capability (use its slug as the `type`) plus the story's sources; give headline nodes story-tied `label`/`desc`.
3. **From a reference, then edited.** Start from a reference file and tweak.

Map the user's words to real catalog `type`s. For a source the catalog can't know, use `type:"source"` with a vendor `icon` + `ingest`.

---

## The canonical end-to-end flow (the "complete" shape)

`reference/architecture-complete.jsonc` is the flagship layout — copy it and adapt. Left → right:

```
sources (≈3 rows)  →  Lakeflow + Genie (one block)  →  lakehouse + lakebase
     →  dashboard + Genie Room + app  →  Genie One  →  the end user
```

- **Top-left:** the `db-platform` wordmark. **Top-right:** `governance-block` (Unity Catalog) over everything. **Both are `pin`ned to the platform box's corners** (`"pin": { "at": "top-left"|"top-right", "to": "platform-box" }`) — never absolute `at`, which drifts off-corner as soon as the node set changes. **Everything sits inside ONE big white `box`** (`z:-1`) — that box *is* "the Databricks Platform", and the non-float pins reserve a top band so it grows to enclose the banners too.
- **The `lakeflow-genie-block` has THREE left ports** — wire each source to the one matching HOW it's ingested:
  - `in-lakeflow-connect` ← **databases / SaaS apps**: Postgres, ERP/SAP, Salesforce, MySQL…
  - `in-zerobus` ← **realtime streams / sensors / IoT / events**: sensor data… (NOT Kafka — Zerobus replaces a Kafka-style broker).
  - `in-direct` ← **files NOT supported by Connect**: PDFs, CSV/Parquet dumps on a UC Volume.
  - Right port `@r` → the compute layer. **Inside the block = Genie Code + SDP** (all bronze→silver→gold) — do NOT add separate `sdp`/`genie-code` nodes.
- **Compute** (both fed by `lakeflow-genie-block@r`): `lakehouse` (BI+AI) and `lakebase` (live app state).
- **Consumption:** `lakehouse` → `aibi-dashboards` + `genie`. `lakebase` → the `databricks-apps-work` app; the **app also consumes the Genie Room + dashboard**.
- **End user:** a `file:persona/user` `logo` (give it `"text": "Business users"` as the caption by default, and a slightly taller `size` like `[88, 88]` so icon + caption fit) reaches the resources **through `genie-one`**. Those edges are **relationship arrows** — leave `arrow` out (auto): user ==> Genie One, Genie One --> dashboard / Genie Room / app.

---

## Component catalog (dense reference)

<!-- BEGIN: generated-catalog -->

<!-- AUTO-GENERATED from CATALOG in app/.../lib/platform-architecture.ts
     by `bun run scripts/gen-architecture-skill.ts` — DO NOT EDIT BY HAND. -->

Use the `type` id; the renderer supplies the icon, label, default description and size. Override `label`/`desc` only when story-specific. Composite blocks carry their own internal layout — treat each as ONE node (don't also add its sub-parts).

### Agentic Data `agentic-data`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `lakeflow-block` | Lakeflow | 224×148 | The whole ingest + bronze→silver→gold SDP in one block (no Genie Code framing). Contains SDP — never add a separate sdp tile beside it. |
| | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps (ingest: lakeflow-connect) · `in-zerobus` ← realtime streams / sensors (ingest: zerobus) · `in-direct` ← files: PDF / CSV / Parquet (ingest: direct) · `r` → the compute layer |
| `lakeflow-genie-block` | Lakeflow + Genie | 360×208 | The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it. |
| | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps (ingest: lakeflow-connect) · `in-zerobus` ← realtime streams / sensors (ingest: zerobus) · `in-direct` ← files: PDF / CSV / Parquet (ingest: direct) · `r` → the compute layer |
| `lakeflow-connect` | Lakeflow Connect | 200×56 | A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems. |
| `zerobus-ingest` | Lakeflow Zerobus | 200×56 | Real-time, direct ingest of streaming events into the lakehouse. |
| `sdp` | Lakeflow SDP | 230×112 | Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale. |
| `uc-volume` | UC Volume | 200×56 | Governed file storage in Unity Catalog — where raw documents (PDFs) land. |
| `lakeflow-jobs` | Lakeflow Jobs | 230×70 | Orchestrate the whole pipeline on a schedule or trigger. |
| `notebooks-eda` | Notebooks | 200×56 | Interactive exploration and analysis on governed data. |
| `delta-sharing` | Delta Sharing | 200×56 | Open, cross-org data sharing with no copies. |
| `marketplace` | Marketplace | 200×56 | Discover and consume third-party data and AI assets. |
| `lakebase` | Lakebase | 230×70 | Managed Postgres for app state — reads/writes the live queue. |
| `lakehouse` | Lakehouse | 230×70 | One copy of governed data for BI + AI — real-time queries at scale. |

### Agentic Work `agentic-work`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `databricks-apps-work` | Databricks Apps | 230×70 | The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Room. |
| `genie-one` | Genie One - Mobile app | 230×70 | The business-user / mobile entry point. Convention: a file:persona/user logo (caption 'Business users') to its right — user ==> Genie One, and Genie One --> dashboard / Genie Room / app. Those edges auto-render as arrows (leave `arrow` out). |
| `genie` | Genie Room | 230×70 | ask anything about your data |
| `knowledge-assistant` | Knowledge Assistant | 200×56 | Chat with your documents — grounded, cited answers from unstructured content. |
| `supervisor-agent` | Supervisor Agent | 200×56 | Routes a question to the right specialist agent and composes the answer. |
| `agent-bricks` | Agent Bricks | 230×170 | Managed MULTI-agent system: a Supervisor orchestrating Knowledge Assistant / Genie / MCP / Functions (with extraction·parsing·classification chips). Use when the agent layer is a supervisor routing to specialists; if the demo uses only one agent capability, use that single tile instead. |
| `ml-training-serving` | ML Models | 200×56 | Train, register, and serve models on governed data. |
| `vector-search` | Vector Search | 200×56 | Semantic search and retrieval that grounds agents in your data. |
| `information-extraction` | Information Extraction | 200×56 | Turn PDFs and documents into structured, queryable data. |
| `document-parsing` | Document Parsing | 200×56 | Parse PDFs and documents into clean, structured text + layout. |
| `classification` | Classification | 200×56 | Classify documents and records into governed categories. |
| `genie-code` | Built with Genie Code | 360×112 | Standalone 'describe it → Genie Code builds it' beat. Use only when NOT already using lakeflow-genie-block (which has the Genie Code footer built in). |

### Agentic Apps `agentic-apps`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `databricks-apps` | Databricks Apps | 200×56 | Custom web app where the team does the work — queue, actions, all in one place. |
| `aibi-dashboards` | AI/BI Dashboard | 230×70 | Governed dashboards on the same data — one set of numbers, one page. |

### Unified Governance `unified-governance`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `governance-block` | Unified Governance | 580×108 | One governance bar: Unity Catalog + Unity AI Gateway (access any model) + a live Genie Ontology graph. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature). |
| `db-platform` | Databricks Platform | 380×60 | Title banner (the Databricks wordmark). Pin it top-left, usually paired with a big background box (z:-1) wrapping everything → reads as 'all of this is the platform'. |
| `unity-catalog` | Unity Catalog | 200×56 | One governed catalog — access, lineage, and semantics across data + AI. |
| `ai-gateway` | Unity AI Gateway | 200×56 | Every model and agent call governed — security, cost, and rate limits. |
| `data-quality` | Data Quality | 200×56 | Expectations and monitors keep bad data out of the gold layer. |
| `abac` | ABAC | 200×56 | Attribute-based access control — fine-grained, policy-driven permissions. |
| `data-classification` | Data Classification | 200×56 | Automatically tag and govern sensitive data. |

> Sources are demo-authored (not in this catalog): use `type:"source"` with a vendor `icon` (`file:vendor/<name>`) + an `ingest` path (see the icon bank below).

<!-- END: generated-catalog -->

### Sources
Use `type:"source"` with a vendor `icon` (`file:vendor/<name>` — e.g. `postgresql`, `kafka`, `sap`, `salesforce`, `shopify`) and an `ingest` path. Generic fallbacks: `pdfLogo`, `sensorSource`, `inputData`, `unstructuredData`. The `ingest` decides which Lakeflow port the source's edge targets (`lakeflow-connect`→`in-lakeflow-connect`, `zerobus`→`in-zerobus`, `direct`→`in-direct`). A custom shapes source: `file:vendor/custom-source`. A persona/user marker: `file:persona/user` (as a `logo` node).

Show **real, NAMED source systems** — never a single "Synthetic Data" / "synthetic" placeholder (it reads as fake and tells no story).
- **Follow the user first:** if they named their sources (one or many), use exactly those.
- **Default when you have no signal:** add **~4** plausible real systems with real vendor logos, spanning the three ingest paths so the Lakeflow block's three ports are used — e.g. a database (`postgresql`/`mysql`, `lakeflow-connect`), a SaaS app (`salesforce`/`shopify`, `lakeflow-connect`), **sensor / IoT data** (`sensorSource`, `zerobus`), and documents (`pdfLogo`, `direct`). Fit the industry if one is implied; otherwise this generic mix is fine. This is just the fallback — a demo that clearly wants one source should show one.
- For the streaming/`zerobus` path lead with **sensor data**, NOT Kafka — Zerobus is Databricks' direct ingest that *replaces* a Kafka-style broker, so showing Kafka alongside it is contradictory.
- Only use `file:vendor/custom-source` for a source that genuinely has no real-world product behind it.

### Available logos (icon bank)

<!-- BEGIN: generated-icons -->

<!-- AUTO-GENERATED from the icon bank (icons/vendor + icons/cloud) — DO NOT EDIT BY HAND. -->

Logos you can set as a node `icon`. Keys are self-explanatory; use them verbatim.

**Vendor / product logos** — `file:vendor/<name>`:

`adyen`, `agent-bricks`, `airbyte`, `airtable`, `amplitude`, `anthropic`, `apache-airflow`, `apache-couchdb`, `apache-flink`, `apache-hbase`, `apache-nifi`, `apache-spark`, `atlassian`, `bigcommerce`, `box`, `braze`, `brevo`, `cassandra`, `clickhouse`, `cockroachdb`, `confluence`, `couchbase`, `custom-source`, `databricks`, `databricks-wordmark`, `dbt`, `dropbox`, `duckdb`, `elasticsearch`, `gemini`, `genie-ontology`, `github`, `gitlab`, `glean`, `google-ads`, `google-analytics`, `google-docs`, `google-drive`, `google-sheets`, `grafana`, `hootsuite`, `hubspot`, `ibm`, `influxdb`, `informatica`, `intercom`, `jira`, `kafka`, `klarna`, `looker`, `mailchimp`, `mariadb`, `marketo`, `mastercard`, `meta`, `metabase`, `microsoft`, `microsoft-sql-server`, `mixpanel`, `mongodb`, `mqtt`, `mysql`, `neo4j`, `node-red`, `notion`, `openai`, `oracle`, `paypal`, `planetscale`, `postgresql`, `power-bi`, `prestashop`, `presto`, `pulsar`, `qlik`, `quickbooks`, `rabbitmq`, `redis`, `salesforce`, `sap`, `scylladb`, `segment`, `sendgrid`, `shopify`, `shopware`, `siemens`, `singlestore`, `slack`, `snapchat`, `snowflake`, `sqlite`, `square`, `stripe`, `supabase`, `superset`, `tableau`, `talend`, `teradata`, `tiktok`, `trino`, `twilio`, `visa`, `woocommerce`, `xero`, `youtube`, `zapier`, `zendesk`, `zeroops`, `zoho`

**Cloud logos** — `file:cloud/<provider>/<category>/<name>` (e.g. `file:cloud/aws/storage/s3`):

- **aws**: `analytics/athena`, `analytics/glue`, `analytics/redshift`, `compute/ec2`, `compute/lambda`, `database/dynamodb`, `database/rds`, `ml/sagemaker`, `networking/route53`, `networking/vpc`, `storage/s3`, `streaming/kinesis`
- **azure**: `analytics/data-factory`, `analytics/synapse`, `compute/functions`, `compute/virtual-machines`, `database/cosmos-db`, `database/sql-database`, `ml/machine-learning`, `networking/virtual-network`, `storage/blob-storage`, `streaming/event-hubs`
- **gcp**: `analytics/bigquery`, `analytics/dataflow`, `analytics/dataproc`, `compute/cloud-functions`, `compute/compute-engine`, `database/bigtable`, `database/cloud-sql`, `ml/vertex-ai`, `networking/vpc`, `storage/cloud-storage`, `streaming/pubsub`

Also: `file:persona/user` (a person — use as a `logo` node, caption "Business users"), `file:vendor/custom-source` (generic animated shapes source when no real logo fits).

<!-- END: generated-icons -->

---

## Authoring rules

1. **Only list what's shown.** A node in `nodes` is on the canvas; anything else simply isn't there. No state, no hidden list.
2. **Map words → catalog `type`s.** Reuse catalog ids. Use `type:"source"` for the demo's source systems.
3. **Prefer composites:** `lakeflow-genie-block` over `sdp`+`lakeflow-connect`; `governance-block` over the five governance tiles; `agent-bricks` for managed multi-agent.
4. **Place by `col`, not coordinates.** Declare `columns`, give each node a `col` (+ `row` to order within a lane). Let the renderer compute x/y. Off-flow banners (db-platform, governance) use `pin` onto the platform box's corners — never an absolute `at` (tuned coordinates drift the moment the node set changes). Don't invent pixel coordinates.
5. **Wrap groups in a `box` via `wraps`** — the platform box (the whole flow), or cloud/VPC/zone containers (nested). It auto-sizes; you never set its `at`/`size`.
6. **Edges by id; handles inferred.** Write `from`/`to` as plain ids — the `@handle` and source ingest port are inferred. Add `@handle` only to override (e.g. `@b`/`@t` for a vertical link).
7. **Descriptions are the point.** Make `desc`s demo-specific and human, not datasheet copy.
8. **Genie One / user edges are auto-arrows** (leave `arrow`/`flow` out). Pipeline edges use `flow: true`.

---

## Reference files

- `reference/architecture-complete.jsonc` — the flagship end-to-end shape (commented). The minimal shape is inlined in **The format** above.
- `renderer/architecture-viewer.html` / `architecture-editor.html` — copy one, edit its inline JSON.
- `renderer/render-arch.mjs` — `node renderer/render-arch.mjs <file>.html` → a PNG to read.
