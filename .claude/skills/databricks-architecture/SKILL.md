---
name: databricks-architecture
description: Create or edit a Databricks solution-architecture diagram — a Lucidchart-style platform diagram (sources → Lakeflow/Genie pipeline → lakehouse/lakebase → dashboards, Genie, apps → end user, on a governed platform). Use when someone wants to draw, generate, or edit an architecture diagram, visualize a Databricks solution's components and data flow, or produce an architecture image. Produces a self-contained HTML you render to a PNG and iterate on.
---

# Databricks Architecture Diagram

Build a **Databricks solution-architecture diagram** — the "Data + AI Platform" picture: source systems on the left flowing through a governed pipeline to compute, then to dashboards / Genie / apps, surfaced to an end user, all on one governed platform.

The diagram is a **flat list of the components you see** plus the **lines between them** — nothing else. A node is on the canvas iff it's in `nodes`; there is no visibility state, no bands, no catalog-diffing to reason about.

**Author STRUCTURE, not pixels.** You assign each node to a **column** (a left→right lane) and let the renderer compute coordinates; you draw **edges by node id** and the handle is inferred; you wrap a group of nodes in a **container box** that auto-sizes around them. You almost never write `x/y`. (You *may* pin a node with an explicit `at` — it overrides its column — for things like top banners.)

## Databricks capabilities — how components connect

Before drawing edges, read **`reference/platform_architecture.md`** to understand how the Databricks components fit together — what each product does, whether it's a buildable resource or a talking-point, and (most importantly) **which components feed which** (e.g. sources → Lakeflow/`sdp` → `sql-lakehouse` → `ai-bi-dashboard`/`genie`; `supervisor-agent` routes to `genie`/`knowledge-assistant`; `lakebase` syncs with `sdp` tables and powers apps). That relationship map is what makes your data-flow edges correct rather than plausible-looking.

---

<!-- BEGIN: local-render-workflow (stripped when the skill runs inside Solution Builder — the app renders architecture.md live in its own canvas) -->
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

Start from the example in **The format** below (copy its `nodes`/`edges` into the inline block and adapt), or from `reference/architecture-complete.jsonc` — the flagship end-to-end shape — when the demo needs the full platform story. **Strip the `//` comments** when you paste (the inline block is parsed as JSON).

## Feedback loop — render to an image and iterate (for the agent)

After writing/editing the JSON in a `*.html`, **render it to a PNG and look at it**:

```
# One-time: install the lightweight headless browser (~90MB shell, not full Chrome).
npx playwright install chromium-headless-shell

node renderer/render-arch.mjs my-arch.html        # → my-arch.png
```

Then **read `my-arch.png`**, check the diagram is right (components present, wired correctly, laid out cleanly), and edit the inline JSON to fix anything. Repeat until it looks right.

The renderer drives **`chromium-headless-shell`** (Playwright's minimal headless build) over the DevTools protocol — no puppeteer/playwright *package* needed at render time, just the shell binary + `node` 18+. It auto-discovers the shell in Playwright's browser cache; run the one-time install above if it reports "No Chrome/Chromium found", or set `CHROME_PATH=/path/to/chrome` to point at any Chrome/Chromium you already have.
<!-- END: local-render-workflow -->
<!-- BEGIN: in-app-workflow (injected only when the skill runs inside Solution Builder) -->
<!-- END: in-app-workflow -->

---

## The format

A complete end-to-end shape of ONE architecture (one tab) — **use this as your
starting point**, and wrap it in an array `[ … ]` when you emit (see *Tabs*
below). It's JSONC so you can read the comments; **strip the `//` comments**
when you emit into the inline block, which is parsed as plain JSON:

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
| `desc` | No | The node's **description line** — one line under the label. On a catalog tile it overrides the default blurb; on a `source`/`logo` it's the tile's only descriptive text. `""` (empty string) deliberately CLEARS it (renders nothing); omit to keep the catalog default. See *Node text: title · description · caption*. |
| `showDesc` | No | `true`/`false` to force the description line on/off. **Default:** a catalog tile shows its description when it has one; a `source`/`logo` shows it only when you set `desc`. |
| `caption` | source · logo | Where the label sits relative to the icon: `right` · `left` · `top` · `bottom`. **Default:** `right` for a source, below (`bottom`) for a logo. |
| `fontSize` | source · logo · text/box | Label font size in px. Applies to source/logo captions and to `text`/`box` annotations. |
| `text`·`bold`·`vAlign`·`hAlign`·`src` | box/text/logo/image | Annotation props — see *Annotations*. (`fontSize` and `caption` are in the rows above.) |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity }` — visual overrides; emit only what differs. `border` = width px (0 = none); `borderStyle` = `solid`/`dashed`; `borderColor`/`fill`/`font` = hex; `radius` = corner px; `shadow` = 0–100 intensity (0 = none); `opacity` = 0–1. |

The **band** a component belongs to (which sets its tile color) is derived from its `type` — you never write it.

### An edge
`{ "id"?, "from": "<srcId>[@handle]", "to": "<tgtId>[@handle]", "flow"?, "arrow"?, "dashed"?, "shape"?, "flowStyle"?, "centerX"?, "label"? }`

- **Write `from`/`to` by node id; the `@handle` is INFERRED** from geometry: left→right ⇒ source `@r` → target `@l`; vertical ⇒ `@b`/`@t`. A **source** feeding the Lakeflow block must name the target ingest port EXPLICITLY on the handle — `@in-lakeflow-connect` (databases/SaaS), `@in-zerobus` (realtime streams/sensors), or `@in-direct` (files: PDF/CSV/Parquet). That handle also picks the flow animation: `@in-zerobus` → particle stream, `@in-direct` → travelling docs, else → laser beam.
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

1. **From a pasted conversation / free-text intent.** The user pastes a transcript or types "ingest ERP data into a business app." **Extract the main components** they imply (source systems, pipeline, serving layer, dashboard/app, agents), map each to a catalog `type`, and place them — start from the example in **The format** (or `architecture-complete.jsonc` for the full shape) and adapt positions + swap the sources. Don't invent a story.
2. **From an existing story + selected capabilities.** A demo has a `README.md`/`resources.json`. Place a node per chosen capability (use its slug as the `type`) plus the story's sources; give headline nodes story-tied `label`/`desc`.
3. **From a reference, then edited.** Start from a reference file and tweak.

Map the user's words to real catalog `type`s. For a source the catalog can't know, use `type:"source"` with a vendor `icon`, and wire its edge to the Lakeflow block's ingest port with an explicit `@in-…` handle.

---

## The canonical end-to-end flow (the "complete" shape)

`reference/architecture-complete.jsonc` is the flagship layout — copy it and adapt. Left → right:

```
sources (≈3 rows)  →  Lakeflow + Genie (one block)  →  lakehouse + lakebase
     →  dashboard + Genie Room + app  →  Genie One  →  the end user
```

- **Top-left:** the `db-platform` wordmark. **Top-right:** `governance-block` (Unity Catalog) over everything. **Both are `pin`ned to the platform box's corners** (`"pin": { "at": "top-left"|"top-right", "to": "platform-box" }`) — never absolute `at`, which drifts off-corner as soon as the node set changes. **Everything sits inside ONE big white `box`** (`z:-1`) — that box *is* "the Databricks Platform", and the non-float pins reserve a top band so it grows to enclose the banners too.
- **The `lakeflow-genie-block` has THREE left ports** — target the one matching HOW each source is ingested by naming it on the edge's handle, e.g. `"to": "lakeflow-genie-block@in-zerobus"`:
  - `@in-lakeflow-connect` ← **databases / SaaS apps**: Postgres, ERP/SAP, Salesforce, MySQL…
  - `@in-zerobus` ← **realtime streams / sensors / IoT / events**: sensor data… (NOT Kafka — Zerobus replaces a Kafka-style broker). Renders a particle-stream flow.
  - `@in-direct` ← **files NOT supported by Connect**: PDFs, CSV/Parquet dumps on a UC Volume. Renders a travelling-docs flow.
  - Right port `@r` → the compute layer. **Inside the block = Genie Code + SDP** (all bronze→silver→gold) — do NOT add separate `sdp`/`genie-code` nodes.
- **Compute** (both fed by `lakeflow-genie-block@r`): `sql-lakehouse` (BI+AI) and `lakebase` (live app state).
- **Consumption:** `sql-lakehouse` → `ai-bi-dashboard` + `genie`. `lakebase` → the `databricks-apps-work` app; the **app also consumes the Genie Room + dashboard**.
- **End user:** the business user is built INTO `genie-one` (a "Business users" persona pill docked above the tile) — do NOT add a separate `file:persona/user` node. `genie-one` is the entry point that fronts the resources: wire it with **relationship arrows** — leave `arrow` out (auto): Genie One --> dashboard / Genie Room / app.

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
| | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps · `in-zerobus` ← realtime streams / sensors · `in-direct` ← files: PDF / CSV / Parquet · `r` → the compute layer |
| `lakeflow-genie-block` | Lakeflow + Genie | 360×208 | The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it. |
| | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps · `in-zerobus` ← realtime streams / sensors · `in-direct` ← files: PDF / CSV / Parquet · `r` → the compute layer |
| `lakeflow-connect` | Lakeflow Connect | 200×56 | A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems. |
| `zerobus-ingest` | Lakeflow Zerobus | 200×56 | Real-time, direct ingest of streaming events into the lakehouse. |
| `sdp` | Lakeflow SDP | 230×112 | Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale. |
| `uc-volume` | UC Volume | 200×56 | Governed file storage in Unity Catalog — where raw documents (PDFs) land. |
| `lakeflow-jobs` | Lakeflow Jobs | 230×54 | Orchestrate the whole pipeline on a schedule or trigger. |
| `notebooks-eda` | Notebooks | 200×56 | Interactive exploration and analysis on governed data. |
| `delta-sharing` | Delta Sharing | 200×56 | Open, cross-org data sharing with no copies. |
| `marketplace` | Marketplace | 200×56 | Discover and consume third-party data and AI assets. |
| `lakebase` | Lakebase | 230×54 | Managed Postgres for app state — reads/writes the live queue. |
| `sql-lakehouse` | Lakehouse | 230×54 | One copy of governed data for BI + AI — real-time queries at scale (SQL Warehouse; RT = Lakehouse Real Time). |

### Agentic Work `agentic-work`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `databricks-apps-work` | Databricks Apps | 230×54 | The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Room. |
| `genie-one` | Genie One - Mobile app | 230×78 | The business-user / mobile entry point. It has a Business-users persona built IN (a small user icon docked above the Genie One mark) — so you do NOT need a separate file:persona/user node beside it. Wire Genie One --> dashboard / Genie Room / app (auto-arrows; leave `arrow` out). |
| `genie` | Genie Room | 230×54 | ask anything about your data |
| `knowledge-assistant` | Knowledge Assistant | 200×56 | Chat with your documents — grounded, cited answers from unstructured content. |
| `supervisor-agent` | Supervisor Agent | 200×56 | Routes a question to the right specialist agent and composes the answer. |
| `agent-bricks` | Agent Bricks | 230×170 | Managed MULTI-agent system: a Supervisor orchestrating Knowledge Assistant / Genie / MCP / Functions (with extraction·parsing·classification chips). Use when the agent layer is a supervisor routing to specialists; if the demo uses only one agent capability, use that single tile instead. |
| `ml-training-serving` | ML Models | 200×56 | Train, register, and serve models on governed data. |
| `ml-model` | Machine Learning Model | 230×54 | A trained model on governed data — classification, forecasting, recommendations, and more. |
| `model-training` | Model Training | 230×54 | Train + track experiments with MLflow — parameters, metrics, and artifacts, all governed. |
| `mlops` | MLOps | 230×54 | The full model lifecycle — train, evaluate, register, deploy, and monitor, governed end to end. |
| `bronze-layer` | Bronze | 200×56 | Raw ingested data, landed as-is. |
| `silver-layer` | Silver | 200×56 | Cleaned, conformed, deduplicated. |
| `gold-layer` | Gold | 200×56 | Curated, business-ready aggregates. |
| `medallion-table` | Medallion Table | 268×96 | The whole medallion (bronze → silver → gold) as ONE block, with the metal-toned layer marks and an internal flow. Prefer this over three separate bronze/silver/gold tiles when you just want to show the layered data itself. OPTIONS (params): `feature_store` and `metric_views` — each adds a fork off the GOLD layer (Feature Store above, Metric Views below) shown inside the block, and exposes an extra right-side OUTPUT handle so you can wire it: `@out-gold` (always), `@out-fs` (when feature_store), `@out-mv` (when metric_views). |
| | | | **ports:** `l` ← sources / ingest · `out-gold` → gold output · `out-fs` → feature store (when enabled) · `out-mv` → metric views (when enabled) |
| `feature-store` | Feature Store | 230×54 | Governed, reusable features for training and real-time serving — consistent offline and online. |
| `uc-model-registry` | UC Model Registry | 230×54 | Version, stage, and govern models in Unity Catalog with full lineage. |
| `model-serving` | Model Serving Endpoint | 230×54 | A deployed serving endpoint (real-time inference over a custom/registered model). Use when the demo calls a live endpoint; for the train→register→batch-score story use ml-training-serving instead. |
| `hosted-mcps` | Hosted MCPs | 230×54 | The governed tool/connector layer for agents — hosted MCP servers (Genie / Atlassian / GitHub / Slack / SharePoint / Gmail …). Use when the demo's agent reaches OUT to external systems via MCP. |
| `vector-search` | Vector Search | 200×56 | Embeddings |
| `information-extraction` | Information Extraction | 200×56 | Pull specific data points, entities, and fields from unstructured text (ai_extract). |
| `document-parsing` | Document Parsing | 200×56 | Extract structured content from documents — text, tables, and metadata (ai_parse_document). |
| `text-classification` | Text Classification | 200×56 | Categorize text into predefined or dynamic labels (ai_classify). |
| `genie-code` | Built with Genie Code | 360×112 | Standalone 'describe it → Genie Code builds it' beat. Use only when NOT already using lakeflow-genie-block (which has the Genie Code footer built in). |

### Agentic Apps `agentic-apps`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `databricks-apps` | Databricks Apps | 200×56 | Custom web app where the team does the work — queue, actions, all in one place. |
| `ai-bi-dashboard` | AI/BI Dashboard | 230×54 | Governed dashboards on the same data — one set of numbers, one page. |

### Unified Governance `unified-governance`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `governance-block` | Unified Governance | 580×108 | One governance bar: Unity Catalog + Unity AI Gateway (access any model) + a live Genie Ontology graph. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature). |
| `db-platform` | Databricks Platform | 380×60 | Title banner (the Databricks wordmark). Pin it top-left, usually paired with a big background box (z:-1) wrapping everything → reads as 'all of this is the platform'. |
| `unity-catalog` | Unity Catalog | 200×56 | One governed catalog — access, lineage, and semantics across data + AI. |
| `ai-gateway` | Unity AI Gateway | 240×104 | The Unity AI Gateway tile with a row of foundation-model logos (OpenAI · Anthropic · Gemini · Grok · Kimi) across the top — conveys 'govern + access ANY model' at a glance. Use standalone; the Unified Governance bar already embeds a compact gateway if you want the whole control plane. |
| `data-quality` | Data Quality | 200×56 | Expectations and monitors keep bad data out of the gold layer. |
| `abac` | ABAC | 200×56 | Attribute-based access control — fine-grained, policy-driven permissions. |
| `data-classification` | Data Classification | 200×56 | Automatically tag and govern sensitive data. |

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

1. **Only list what's shown.** A node in `nodes` is on the canvas; anything else simply isn't there. No state, no hidden list.
2. **Map words → catalog `type`s.** Reuse catalog ids. Use `type:"source"` for the demo's source systems.
3. **Prefer composites:** `lakeflow-genie-block` over `sdp`+`lakeflow-connect`; `governance-block` over the five governance tiles; `agent-bricks` for managed multi-agent.
4. **Place by `col`, not coordinates.** Declare `columns`, give each node a `col` (+ `row` to order within a lane). Let the renderer compute x/y. Off-flow banners (db-platform, governance) use `pin` onto the platform box's corners — never an absolute `at` (tuned coordinates drift the moment the node set changes). Don't invent pixel coordinates.
5. **Wrap groups in a `box` via `wraps`** — the platform box (the whole flow), or cloud/VPC/zone containers (nested). It auto-sizes; you never set its `at`/`size`.
6. **Edges by id; geometric handles inferred.** Write `from`/`to` as plain ids — the geometric `@handle` (`@l`/`@r`/`@t`/`@b`) is inferred. EXCEPTION: a source → Lakeflow-block edge must name the ingest port explicitly (`@in-lakeflow-connect` / `@in-zerobus` / `@in-direct`); it isn't inferred. Add other `@handle`s only to override (e.g. `@b`/`@t` for a vertical link).
7. **Descriptions are the point.** Make `desc`s demo-specific and human, not datasheet copy.
8. **Genie One / user edges are auto-arrows** (leave `arrow`/`flow` out). Pipeline edges use `flow: true`.
9. **Crowded / unreadable edge labels? Add vertical space.** Render to a PNG and look — if edge labels between two rows overlap each other or their lines, spread the rows apart. With `rowGrid`, just **skip a row number** (put the two rows at `0` and `2` instead of `0` and `1`) — the empty row becomes a band of blank space the labels sit in. Without `rowGrid`, bump the `gap` on a `below`/`above` node. Prefer more space over shrinking or dropping labels.

---

## Reference files

Worked, commented `.jsonc` examples — copy the one closest to the user's intent and adapt (strip the `//` comments; emit plain JSON in the fence). More get added over time.

- `reference/architecture-complete.jsonc` — the flagship end-to-end platform (2 tabs). The minimal shape is inlined in **The format** above.
- `reference/agent-bricks.jsonc` — a multi-agent Supervisor over Knowledge Assistant · Genie · Hosted MCPs → Genie One + dashboard. Shows `alignY` + `below` relative placement.
- `reference/ml-platform.jsonc` — end-to-end ML: medallion SDP → Feature Store + Vector Search → MLflow training → UC Model Registry → real-time / RAG / batch serving, all inside a Unity Catalog box. Shows nested boxes (`sdp-box` inside `uc-box`), a pinned `unity-catalog` banner, and the `#N` instance-id rule for two `model-serving` tiles.
<!-- BEGIN: local-render-files (stripped inside Solution Builder — renderer/ isn't shipped into a project) -->
- `renderer/architecture-viewer.html` / `architecture-editor.html` — copy one, edit its inline JSON.
- `renderer/render-arch.mjs` — `node renderer/render-arch.mjs <file>.html` → a PNG to read.
<!-- END: local-render-files -->
