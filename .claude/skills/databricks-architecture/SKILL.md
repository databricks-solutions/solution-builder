---
name: databricks-architecture
description: Create or edit a Databricks solution-architecture diagram — a Lucidchart-style platform diagram (sources → Lakeflow/Genie pipeline → lakehouse/lakebase → dashboards, Genie, apps → end user, on a governed platform, process flow, network, cloud). Use when someone wants to draw, generate, or edit an architecture diagram, visualize a Databricks solution's components and data flow, or produce an architecture image. Produces the diagram as JSON tabs: a self-contained HTML file you render to a PNG and iterate on (standalone), or `architecture.md` inside Solution Builder.
---

# Databricks Architecture Diagram

A Databricks solution architecture, drawn to fit **what the request actually describes**. The reader must answer one question at a glance: **what flows where, who uses it, and what governs it.** One visual argument per tab; operating detail goes to a second tab or the accompanying document.

This file is the core. The long material lives in `reference/`. Each reference file says when to read it; the map is in section 6. Read only what the current diagram needs.

## 1. Pick the kind, then read its guide

The user may have picked a style on the home page. The opening prompt then says `Diagram style: …` and names the guide and example to read. Read those before you write. Without a style line, pick the kind yourself. Kinds use different building blocks, and mixing them is the usual failure.

| Kind (picker style) | When | Read first (the guide, then its example) |
|---|---|---|
| **Slide** (`marketing`, default) | a use-case, brief or pitch → a deck-ready Databricks story | `reference/style-marketing.md`, then `reference/architecture-complete.jsonc`; `reference/compose.md` |
| **Technical** (`technical`) | engineering detail: named jobs, tables, latencies, current vs proposed | `reference/style-technical.md`, then `reference/style-technical.jsonc` |
| **Lifecycle** (`lifecycle`) | stages in order: a lifecycle, a rollout, a roadmap | `reference/style-lifecycle.md`, then `reference/style-lifecycle.jsonc` |
| **Networking** (`networking`) | cloud / account topology: accounts, regions, VPCs, subnets, endpoints | `reference/style-networking.md`, then `reference/style-networking.jsonc` |
| **Match my image** (`match`) | the user supplied a diagram (image, screenshot, export) | `reference/redraw.md`; the image itself is the example |
| **Process flow** | steps, decisions, what happens in order | `reference/process-flows.md`; the example in that file |

Every tab declares `aspect` and `theme` explicitly (`"theme":"slide"` for slide-style kinds, `"technical"` for technical and networking). An omitted `theme` renders as `technical`. Use a style's guide only when the prompt's `Diagram style:` line names it; a user follow-up can override it. Any style can use an `html` block (`reference/containers-and-annotations.md`) for content no component covers, at the style's text size and inside its palette.

**Where Databricks objects live.** When the diagram places accounts, workspaces, the metastore, catalogs, storage, compute or the network around them, read `reference/platform-model.md` first, whatever the style: what holds what, where serverless runs, the network terms (NCC, PNG, Private Link), and the shapes that are wrong.

**Starting points by content** (borrow patterns, never copy a reference wholesale):

| If the ask is… | Start from | Note |
|---|---|---|
| A data + AI demo on one use-case, or a broad "governed platform" | `reference/architecture-complete.jsonc` | Its four sources are illustrative: keep only the ones the ask names or implies. |
| Model-driven (predictive maintenance, churn, fraud, recommendations) | `reference/ml-platform.jsonc` + *Compose a flow* in `compose.md` | ML is its own row band: training → registry → serving, with batch and RAG branches. Add an app, Lakebase or write-back only if the text names one. A model ask does not need an analyst app. |
| An enterprise / layered ask, or Databricks alongside an existing stack | `compose.md` (Step 0 layers) | Layers as columns of the top-level row in the ask's order, an external boundary box with the integration seam, governance as a stretched bar across the platform box. |
| Documents + data Q&A (an assistant over PDFs, policies and tables) | `reference/genie-agent-documents.jsonc` + `compose.md` (*Documents for Q&A*) | One Genie Agent over the tables and a documents volume. Never a supervisor or routing tile. |
| A multi-phase relay (migration, dev → staging → prod, hand-offs across platforms) | `reference/phase-relay.jsonc` + `compose.md` (*chevron banners*) | Chevron phase banners over untitled phase boxes. |
| A customer’s Databricks estate or deployment (IdP, account, workspaces per environment, metastore, catalogs, storage) | `reference/platform-model.md`, then `reference/customer-estate.jsonc` | Workspaces and catalogs are siblings joined by bindings; the data sits in the customer’s storage, outside the Databricks boxes. |
| A physical / governance hierarchy (account, metastore, catalogs) | `reference/governance-layout.jsonc` + `containers-and-annotations.md` | Nested containment, not flow. |
| A decision / ownership view across environments | `reference/decision-view-grid.jsonc` | A grid: columns are platforms, rows are environments. |
| A view of the Databricks platform itself (a pitch or overview slide, "what is Databricks", the platform for an industry) | `reference/databricks-platform.jsonc` | Ingest | stacked layers | Serve, each layer feeding the one above. A hand-composed matrix slide: framed bands, logos with their own icon tile, one-line pill descriptions. |
| Which ingestion method for which source (an ingestion strategy, "how do we bring X, Y, Z in") | `reference/ingestion-methods.jsonc` | Sources grouped by how they can be read → one tile per method → one landing. Lakeflow Connect methods in their own box; query-in-place drawn dashed. |
| Modernising around a legacy core that stays (mainframe or ERP kept as the system of record) | `reference/system-of-record-stays.jsonc` | Existing extraction reused, one path per source, a vertical medallion, external BI through Databricks SQL. |
| Serverless reaching a private network or on-premises (Private Network Gateway, NCC private endpoint rule, Private Link / PrivateLink / Private Service Connect, hub VNet / VPC, ExpressRoute / Direct Connect / VPN), or a Databricks service using that path (Lakeflow Connect CDC, Genie One to an on-prem MCP server) | `reference/serverless-png-azure.jsonc`, then the matching row of **Private connectivity references** in `reference/style-networking.md` | One reference per cloud and mechanism; each header explains how that path works on Databricks and its limits. Pick by the cloud and the mechanism the user names; adapt the networks to theirs. |
| A minimal ingest → lakehouse → dashboard + Genie | the example in section 5 | Only when the ask really is that small. |

## 2. Design from the request

**Fidelity scales with how specific the ask is.**
- **Loose description** (a use-case, pasted notes, a rough vision): interpret. Honour the intent and emphasis, and fill the gaps the story cannot work without.
- **Specific instruction** ("connect X to Y", "drop the dashboard", "these three are one block"): obey it literally, even where you would draw it differently.
- **A supplied diagram**: transcribe it (`reference/redraw.md`).
- **A follow-up correction** is the strongest signal. Do exactly that. If it looks odd, keep it and record why in `ai_reasoning`.

**Draw what the source states, plus the connective tissue the story needs.** Users leave out the ingest, storage and serving pieces. If they name dashboards and agents but no data layer, add the ingest, storage and serving the story cannot work without. Add nothing else: no source, system, persona, product, team, owner, schedule, metric, VPC, CIDR or endpoint that the request neither names nor clearly implies. Aim for the smallest architecture that is complete and correct for this ask.

**Contradictions and named tools.** When the request contradicts itself, pick the reading that fits its intent, and state that reading in `story`. Never silently replace a tool the request names. Draw the named tool as the current or source state (a dashed "today" tile, or a source tile). Put the proposed replacement in `story` and `ai_reasoning`, and say so in the reply.

**Roles, owners, apps and networks.**
- **Owners:** add a role card per stage only when the request asks who owns something. If it asks but names no owner, add role cards (for example "Data steward"), mark each `ai_reasoning: "role inferred"`, and say in the reply they are placeholders. If the request does not ask about owners, draw none.
- **Apps, Lakebase, write-back, AI gateway:** draw one only when the text names it, or when the story cannot work without it (a served prediction needs a serving endpoint, not an app).
- **Networks:** no transit, hub or shared VPC unless the text names one. No CIDR unless the text gives it. Name what is out of scope in `story`.

**Read the request's own structure first.**
- **It lists layers or sections** ("Layer 1 — ingestion, Layer 2 — governance"): use a layered shape in the ask's order and names. Governance and cross-cutting layers span the others as a bar stretched across them (`align: "stretch"`), not a column. Never collapse a rich multi-layer ask into a five-tile funnel, the usual failure. With no dictated order, a sane spine is sources → data processing → domain and governance → compute → ML and agents → apps → Genie One.
- **It names external (non-Databricks) systems** ("keep X, add Databricks alongside"): the external side gets its own boundary box, Databricks another, and the gap between them is the integration seam. If the ask mentions callbacks, show the link both ways.
- **It carries context** (future state vs gaps, constraints, reference customers): route it per the next rule. Never make a fake component for it.

**Where extra context goes.** Route each piece to the lightest slot and keep every string short.
- **About a component:** a 2–5 word `desc`. On `theme:"slide"`, tiles and sources never render their description, so put the meaning in the label. Only a `logo` shows `desc` (with `showDesc:true`).
- **A constraint that changes interpretation** (residency, human approval): the tab `story`. A visible `note` only when the reader would decide wrongly without it: at most one per tab, at most eight words.
- **About a connection** (why A feeds B): a short edge `label`.
- **Your authoring rationale:** `ai_reasoning` on the node or edge. It is never rendered. Never put it in `story`, which is reader-facing.
- **The real resource behind a node** (a pipeline, job, table, dashboard, Genie space, app… whose link the request gives): `url` on that node, the full `https://` link. It is never drawn; the viewer opens it from the node. Only links the request gives; never build one.

**Infer by kind (flow tabs).** A broad use-case (predictive maintenance) gets the processing stages it cannot work without: a prediction story needs training, registry and serving. That licenses stages, not extra sources, vendors or products. Named components get assembled exactly, plus the connective tissue. No invented schedules, cron times, thresholds or metric names unless the request gives them.

**Wire every hop.** After placing tiles, walk each source to a consumer and draw every hop. A participating component connects to something. Exceptions are global things about the architecture: a `note` or `text`, the `db-platform` banner, a wrapping `box`, and platform governance (`governance-block`, `unity-catalog`). A governing tile that draws an edge attaches to what it governs.

**Name what you dropped.** If you leave detail out, name it in the tab `story` ("batch inference and per-environment networking out of scope; see the detail tab"). The test: a reviewer can tell from the diagram what it is NOT claiming.

**Self-check before the final render.** Take every node and edge label in turn and find where the source states it: the request's wording, the supplied image, or the README and specs in the solution-builder flow. Keep it if the source states it, or if it is connective tissue the story needs (name that in `story`). Delete the rest: extra sources, systems, personas, owners, products, badges, and any model, job, catalog or endpoint name the source does not give. Then check the reverse: everything the source names is drawn. **The story must agree with the nodes:** a component the story rules out is absent from `nodes`, and a component the nodes draw is not contradicted by the story. A count larger than the source is padding.

## 3. Workflow: make, render, check

<!-- BEGIN: local-render-workflow (stripped when the skill runs inside Solution Builder — the app renders architecture.md live in its own canvas) -->
Work in the user's folder, never inside the skill's. `R` below is this skill's `renderer/` folder (for example `.claude/skills/databricks-architecture/renderer`).
1. Write the diagram as **`my-arch.json`**: the array of tabs, plain JSON (no `//`).
2. Render and check that file, every edit:
```
npx playwright install chromium-headless-shell   # one-time
node $R/render-arch.mjs my-arch.json              # → my-arch.png (tight crop)
node $R/inspect-arch.mjs my-arch.json             # → layout check; non-zero exit on any fault
node $R/render-arch-tabs.mjs my-arch.json         # multi-tab: render + check EVERY tab
```
3. Hand over **one self-contained HTML**: `node $R/embed-arch.mjs my-arch.json` → `my-arch.html`, the editable canvas with the JSON inline (Load/Save/Download; `--viewer` only for an explicitly read-only page). Never open, grep or edit the HTML files: each carries the whole renderer (several MB). To change the diagram, edit the `.json` and embed again.
**Read the PNG and run the checker. The PNG alone is not enough.** Lines through tiles, captions crowding neighbours, a child sitting on its container's title: a glance forgives them, a reader does not. Edge labels place themselves clear of tiles and each other. A non-zero label count means the diagram is too dense for prose labels: switch to `reference/complex-workflows.md`, Option 2.

The scripts launch `chrome-headless-shell` and always clean it up (180s cap, `ARCH_TIMEOUT_MS`). If one ever leaks: `pkill -f 'ms-playwright.*chrome-headless-shell'`. "No Chrome/Chromium found" → run the install line or set `CHROME_PATH`.
<!-- END: local-render-workflow -->
<!-- BEGIN: in-app-workflow (replaced with the in-app workflow when the skill runs inside Solution Builder) -->
<!-- END: in-app-workflow -->

## 4. Faults and fixes

The checker reports **gated faults** (each must be 0 before you finish) and **advisories** (reported, not gated). Fix each fault with a targeted edit to the one node, box or edge it names. Do not rewrite the file to clear a list.

| Fault | What it means | Fix |
|---|---|---|
| `NODE OVERLAPS` | two tiles sit on each other | only possible with `at`: drop the `at` and put the node in a container. |
| `BOX OVERLAPS` | two boxes overlap | only possible with `at`: put both boxes in one row or column container. |
| `BOX STRADDLE` | a tile crosses a box border | move the tile into the box's `children`, or out of them. |
| `ON BOX TITLE` | a node sits on a box's title strip | only possible with `at` inside the box: drop the `at`. |
| `LABEL OVERLAPS` | two edge labels collide | shorten one label, or move it with `labelPos`. |
| `LABEL OVER NODE/TITLE` | an edge label covers a tile or title | shorten the label, or move the fact into the tile label and drop the edge label. |
| `LABEL HIDES ARROW` | a label covers an arrowhead | move it with `labelPos` (`from`, `d`) or shorten it. |
| `EDGE GRAZES TILE` | a line runs alongside a tile's edge | re-handle the edge (another side: `@t`, `@b`, `@l`, `@r`), move the tile out of the channel, or re-place an endpoint. Never change a named port (`@in-*`, `@out-*`, `@acl-*`, `@bl`): it fixes the anchor and the flow animation. |
| `TEXT OVERLAPS` | two texts sit on each other | move one node, or shorten its text. |
| `CONTENT OUTSIDE TILE` | text or an icon sticks out of its tile | give the node a larger `size`, or shorten the text. |
| `EDGE CROSS` | two edges cross | swap the order of the two targets in their container, or give one edge another side. |
| `PARALLEL OVERLAP` | two edges run on top of each other | give one a different handle or `centerX`. |
| `EDGE UNDER LABEL` | a line passes beneath a label | move the label (`labelPos`) or re-route the edge. |
| `TITLE CROSSED BY EDGE` | a line crosses a box title | enter the box from its left or right side (`@l` / `@r`). |
| `CLIPPED TEXT` · `TRUNCATED TEXT` | text does not fit its box | shorten it, or give the node an explicit larger `size`. For an `html` block, raise `size[1]`. |
| `FLOW ORIENTATION` | most relationships run against `direction` | reorder the top-level row so the sequence moves left to right. |
| `PRESENTATION ASPECT` | no `aspect` declared on the tab | add `"aspect":"16:9"` or `"1:1"`. |
| `CONSOLE` | a page error | the JSON or a field value is invalid: fix that field. |

**Advisories** (reported, not gated):

| Advisory | What it means | What to do |
|---|---|---|
| `TEXT TOO SMALL` | text is under 10px at slide scale. The scale comes from the drawn width and height, so the widest part of the tab sets it. | Narrow the drawn content: fewer columns, shorter labels, or split the tab. Shorten edge labels rather than raising `edgeLabelSize` (see below). |
| `EDGE THROUGH TILE` | a line crosses a tile (reported, not gated) | Re-handle the edge or re-place an endpoint when that is a small move. Never change a named port. Otherwise name it in the reply. |
| `LABEL ON BOX BORDER` | an edge label straddles a box border | Move it with `labelPos` only if that is cheap and the label keeps its meaning. Otherwise leave it and name it in the reply. |
| aspect, alignment reuse, text budget, row gap | composition measures | Change only when a structural fix is obvious (a band, a split, a `track`). Never inflate a `gap` to move a number. |

**Edge label size.** Edge labels are 11px by default, and the label placer reserves room for that size. Do not raise `options.edgeLabelSize` to clear a `TEXT TOO SMALL` advisory on a slide tab: a bigger label collides more often with tiles and other labels. Shorten the label instead. Set `edgeLabelSize` (8–24, clamped) only on a technical or redraw tab whose labels must read at a distance, and then re-check the `LABEL` faults.

## 5. The format

The minimal use-case starting point — a funnel to BUILD ON for a plain use-case ask (add training → registry → serving for a prediction story, a Genie Agent over a documents volume for an assistant, streaming ingest for real time). Not this shape when the ask names layers or an external stack. Emit an **array of tabs**. Plain JSON; explanations go INLINE as `ai_reasoning`:

```json
{
  "name": "Customer 360",
  "story": "Ingest our Postgres, sensor, and PDF data into a governed lakehouse, then give the business a dashboard and a Genie Agent to ask questions in plain language — reached through Genie One, all on Databricks.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "frame": {
    "title": "Customer 360 on Databricks"
  },
  "options": {
    "trademarkLogos": false
  },
  "layout": "row",
  "gap": 90,
  "nodes": [
    {
      "id": "sources",
      "type": "group",
      "layout": "column",
      "gap": 40,
      "equal": "w",
      "track": "ingest",
      "ai_reasoning": "sources stay outside the platform box; the track centres the column on the Lakeflow block it feeds",
      "children": [
        {
          "id": "src-postgres",
          "type": "source",
          "label": "Postgres",
          "icon": "file:vendor/postgresql",
          "ai_reasoning": "each source's edge names the Lakeflow ingest PORT it lands on: that handle drives both the port anchor and the flow animation"
        },
        {
          "id": "src-sensors",
          "type": "source",
          "label": "Sensor data",
          "icon": "sensorSource"
        },
        {
          "id": "src-docs",
          "type": "source",
          "label": "PDF documents",
          "icon": "file:db/file-document"
        }
      ]
    },
    {
      "id": "platform-box",
      "type": "box",
      "layout": "column",
      "gap": 36,
      "pad": 40,
      "align": "stretch",
      "ai_reasoning": "only Databricks components inside; the raw sources stay outside",
      "children": [
        {
          "id": "platform-bar",
          "type": "group",
          "layout": "row",
          "gap": 40,
          "justify": "between",
          "ai_reasoning": "a banner row across the box: the box stretches it, justify spreads its two ends",
          "children": [
            {
              "id": "db-platform",
              "type": "db-platform"
            },
            {
              "id": "governance-block",
              "type": "governance-block"
            }
          ]
        },
        {
          "id": "flow",
          "type": "group",
          "layout": "row",
          "gap": 90,
          "children": [
            {
              "id": "data",
              "type": "group",
              "layout": "column",
              "gap": 50,
              "children": [
                {
                  "id": "sql-lakehouse",
                  "type": "sql-lakehouse"
                },
                {
                  "id": "lakeflow-genie-block",
                  "type": "lakeflow-genie-block",
                  "track": "ingest"
                }
              ]
            },
            {
              "id": "work",
              "type": "group",
              "layout": "column",
              "gap": 50,
              "children": [
                {
                  "id": "ai-bi-dashboard",
                  "type": "ai-bi-dashboard"
                },
                {
                  "id": "genie",
                  "type": "genie"
                }
              ]
            },
            {
              "id": "genie-one",
              "type": "genie-one",
              "ai_reasoning": "business-user entry point; the persona pill is built in, so no separate user node"
            }
          ]
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "src-postgres",
      "to": "lakeflow-genie-block@in-lakeflow-connect",
      "flow": true
    },
    {
      "id": "e1c",
      "from": "src-sensors",
      "to": "lakeflow-genie-block@in-zerobus",
      "flow": true
    },
    {
      "id": "e1d",
      "from": "src-docs",
      "to": "lakeflow-genie-block@in-direct",
      "flow": true
    },
    {
      "id": "e2",
      "from": "lakeflow-genie-block",
      "to": "sql-lakehouse",
      "flow": true
    },
    {
      "id": "e3",
      "from": "sql-lakehouse",
      "to": "ai-bi-dashboard",
      "flow": true
    },
    {
      "id": "e4",
      "from": "sql-lakehouse",
      "to": "genie",
      "flow": true
    },
    {
      "id": "e6",
      "from": "genie-one",
      "to": "ai-bi-dashboard"
    },
    {
      "id": "e7",
      "from": "genie-one",
      "to": "genie"
    }
  ]
}
```

### Tab fields (top level)

The top level is a JSON **array**, one element per tab. Always emit the full array, every tab, even for one tab.

| Field | Notes |
|-------|-------|
| `name` | Tab label. |
| `story` | Reader-facing: what the diagram shows, what is out of scope, and what the reader must not infer. Never drawing rationale (that goes in `ai_reasoning`). It must agree with `nodes`. |
| `aspect` | **Required.** `"16:9"` or `"1:1"`. |
| `theme` | `"slide"` (large type, flat cards, tile descriptions hidden) or `"technical"` (compact, descriptions shown). Write it explicitly. |
| `direction` | **Required.** `"horizontal"` (flows), `"matrix"` (comparison, containment), `"vertical"` (explicit request only). |
| `frame` | `{ "title", "subtitle"? }`: a title band inside the export. Use it on any deck-bound tab. |
| `options` | `trademarkLogos` (`true` real marks, `false` neutral badges; set it explicitly), `edgeLabelSize` (see section 4). |
| `layout` · `gap` · `align` · `justify` | **Required: `layout`.** How the top-level nodes are placed (`"row"` for a flow). See `reference/layout.md`. |
| `legend` | Numbered key: `{ title?, show?, items[] }`. Keep `show:"panel"` (the default) unless the user asks for a key in the image. See `reference/complex-workflows.md`. |
| `nodes` · `edges` | **Required.** |

Full field tables: `reference/format-reference.md`.

### Node essentials

- `id`: unique on the tab, a handle for edges and references. `type`: a catalog id (`genie`, `sql-lakehouse`, `lakeflow-genie-block`, …) or a special kind (`source`, `multi-source`, `box`, `text`, `logo`, `image`, `note`, `callout`, `shape`, `card`, `html`). The tile colour comes from `type`; never write it.
- **Placement is structure** (`reference/layout.md`): a `box` (frame + title) or `group` (invisible) holds `children` and places them in a `layout` (`row`, `column`, `grid`) with `gap`, `align`, `justify`, `equal`; `track` lines nodes up across containers. List children in reading order. `at` only for a redraw or coordinates the user gave.
- **Labels:** `label` (a `source` requires it), `icon`, a box's `title` + `titleIcon`, `text` (annotations), `caption`, `fontSize`.
- `size: [w, h]` opts a node out of auto-sizing (a minimum on a box). `desc` / `showDesc`: see section 2.
- `style`: only the differences (`border`, `borderStyle`, `borderColor`, `fill`, `radius`).
- `ai_reasoning`: hidden rationale. It round-trips and is never rendered.
- **Card** (`type:"card"`): `title`, `icon`, `badge`, `accent` and a `body` of HTML (a bold lead line, a grey line, key/value rows, tag pills). Write `body`; do not write the legacy `summary`, `chips` or `tags` fields.

### Edge essentials

- `from` / `to`: `"<id>[@handle]"`. Handles are inferred from geometry (left to right gives `@r` to `@l`). Override only with a side (`l`, `r`, `t`, `b`) or a composite port.
- **A source feeding a Lakeflow block names its ingest port:** `@in-lakeflow-connect` (databases, SaaS, Kafka), `@in-zerobus` (direct app or device events), `@in-direct` (files: PDF, CSV, Parquet). Never draw Kafka into `@in-zerobus`: Zerobus is an alternative to a broker, not a consumer of one.
- `flow: true` marks data flow (animated on the live canvas, arrowheads in static exports). Leave `arrow` out; set it only to override (`"none"`, `"start"`, `"both"`, `"end"`).
- `label` (short, drawn on the edge), `dashed`, `color` (only when the colour carries meaning), `flowStyle`.
- One direction per edge. Leaf to leaf, never box to box.
- `shape`: omit it. The handle is the routing decision. Use `straight` only for short adjacent links.
- `labelPos` and `centerX` are manual overrides, for when the placer's choice is wrong.
- `ai_reasoning`: the edge's rationale.

The `reference/*.jsonc` examples open with a comment block that says what they demonstrate. Read it. When you reuse a snippet, strip the `//` lines and emit plain JSON.

## 6. Reference map: read a file when you need it

| Read | When |
|------|------|
| `reference/style-<kind>.md` | First, for the kind's rules, building blocks and layout: `style-marketing`, `style-technical`, `style-lifecycle`, `style-networking`. Each names its example `.jsonc`. |
| `reference/compose.md` | Before composing a slide or flow tab: frame, aspect, flows, the data-layer options, readability, nesting and wiring traps, chevron phases. |
| `reference/layout.md` | **Before writing any tab**: containers, order, `track`, fixing a layout. |
| `reference/format-reference.md` | A field is not in section 5. Full top-level, node and edge tables. |
| `reference/containers-and-annotations.md` | Nested boxes, the Databricks physical layout, `card` / `note` / `callout` / `html`, captions, custom logos. |
| `reference/platform-model.md` | The diagram places Databricks objects: account, identity, workspaces, metastore, catalogs, storage, compute planes, network terms. Also icons for products with no tile. |
| `reference/component-catalog.md` | Choosing a component type, its ports and wiring. For an icon key, `grep -i <word> reference/icons.tsv`. |
| `reference/process-flows.md` | The diagram is a sequence of steps and decisions. |
| `reference/complex-workflows.md` | Edge labels collide, or the diagram is a numbered walkthrough. |
| `reference/redraw.md` | The user supplied a diagram. |
| `reference/*.jsonc` | A starting point from section 1. |

## 7. Authoring checklist

1. **Composites over parts.** `lakeflow-genie-block` over `sdp` + `lakeflow-connect`; `governance-block` over loose governance tiles; `genie` (with its documents volume) as the one agent tile. Never add a composite's sub-parts beside it.
2. **Place by structure.** Containers, order and `track` (`reference/layout.md`). A banner is a stretched row at the top of its box. An `at` drifts when the node set changes.
3. **Edge labels place themselves.** Switch to numbered edges and a legend on a measured collision or a sentence over about 75 characters.
4. **Keep long edges purposeful.** Fix `EDGE THROUGH TILE` structurally. Named ports never move.
5. **A one-row-long edge cannot carry a label.** Put the fact in the tile label.
6. **Record non-obvious choices in `ai_reasoning`:** a renamed tile, an unusual edge, a deliberate orphan, an inferred role.
7. **Render until every gated count is 0.** Then reply, and name every fault and advisory that remains. Never describe the diagram as clean while faults remain.


<!-- BEGIN: local-render-files (stripped inside Solution Builder — renderer/ isn't shipped into a project) -->
Local render helpers (each takes `my-arch.json`, an `architecture.md` or an HTML): `renderer/render-arch.mjs` (→ PNG) · `renderer/inspect-arch.mjs` (layout check; non-zero exit on any fault) · `renderer/render-arch-tabs.mjs` (every tab) · `renderer/embed-arch.mjs` (→ the self-contained editor HTML; the page templates `architecture-editor.html` / `architecture-viewer.html` are its inputs, never edited by hand).
<!-- END: local-render-files -->
