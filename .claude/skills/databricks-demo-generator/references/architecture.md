# Architecture Diagram Schema Reference

`architecture.md` drives an **interactive architecture canvas** (a Lucidchart-style ReactFlow editor) framed like the Databricks "Data + AI Platform" slide. The full platform (capability bands + their components) is **always available from a built-in catalog**; your `architecture.md` declares what is *different for this demo* (sources, descriptions, which components are active).

**The canvas is user-editable.** Users drag nodes, add/remove components from a library palette, draw edges, and toggle "data flowing" animation. Those edits are saved back into a `layout` block in this file (positions + edges). You normally **don't author `layout`** — leave it out and the canvas auto-lays-out by band (Sources → Agentic Data → Agentic Work → Agentic Apps, with Unified Governance underneath) and seeds flow edges. Only the semantic parts below are yours to write.

## What the renderer already knows (you don't repeat it)

The diagram ships a fixed catalog of capability **bands**. Four of them render
as **columns flowing left → right** (data flows toward the user); `unified-governance`
renders as a **foundation bar spanning the full width underneath** them:

| Band id | Label | Renders as | Holds (capability slugs) |
|---------|-------|-----------|--------------------------|
| `sources` | Sources | column 1 (left) | `synthetic-data-gen` (+ your demo's source systems) |
| `agentic-data` | Agentic Data | column 2 | `lakeflow-connect`, `sdp`, `lakeflow-jobs`, `notebooks-eda`, `zerobus-ingest`, `delta-sharing`, `marketplace`, `lakebase`, `lakehouse` |
| `agentic-work` | Agentic Work | column 3 | `genie`, `knowledge-assistant`, `supervisor-agent`, `ml-training-serving`, `vector-search`, `information-extraction`, `genie-code` |
| `agentic-apps` | Agentic Apps | column 4 (right) | `databricks-apps`, `aibi-dashboards`, `databricks-one` |
| `unified-governance` | Unified Governance | foundation bar (below) | `unity-catalog`, `ai-gateway`, `data-quality`, `abac`, `data-classification` |

**Component ids ARE the capability slugs** from `resources.json` (and `references/platform_architecture.md`). They line up 1:1, so:

- Each component's **state is auto-seeded from `resources.json`**: `buildable` → **active** (highlighted, glowing deep-link dot once deployed), `talking_track` → **mentioned** (muted "talking track" tile), everything else → **hidden**.
- Each component has a generic fallback description. You override it with **story-tied copy**.

So a perfectly good `architecture.md` is *small*. You mostly add the demo's **sources** and rewrite a few **descriptions**.

---

## Schema

```json
{
  "name": "<Demo Name> Architecture",
  "story": "One line framing the demo (optional).",
  "bands": [
    {
      "id": "sources",
      "add": [ /* the demo's source systems — see below */ ],
      "set": [ /* per-component overrides keyed by id */ ]
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Title shown in the toolbar. Defaults to "Solution architecture". |
| `story` | No | One-line caption under the title. |
| `bands` | No | Array of band overrides. Omit a band entirely to accept all its defaults. |

### Band override

```json
{ "id": "agentic-work", "add": [...], "set": [...] }
```

- `id` — one of the band ids above.
- `add` — components NOT in the catalog. Used almost exclusively for **sources**.
- `set` — patches to catalog (or added) components, keyed by `id`.

### Component override (used in both `add` and `set`)

```json
{ "id": "genie", "label": "AI/BI Genie", "icon": "genie",
  "desc": "\"Why do I have so many returns?\" — ask in plain language.",
  "state": "active", "capability": "genie" }
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Capability slug (catalog component) or a new id (e.g. `src-shopify`). |
| `label` | for `add` | Display name. Catalog components keep their label unless you set it. |
| `icon` | for `add` | Icon key (see Available Icons). |
| `desc` | recommended | **Story-tied** one-liner shown in the detail panel. |
| `state` | No | `active` \| `mentioned` \| `hidden`. **Omit to use the resources.json default** — only set it to override. |
| `capability` | No | Backing capability slug for deep-links when `id` isn't itself a slug. Defaults to `id`. |
| `ingest` | sources only | `lakeflow-connect` (default) \| `zerobus` (realtime) \| `direct`. Draws the ingest rail between Sources and Agentic Data. Use `zerobus` for streaming/sensor sources. |

---

## Data sources (the left column)

Author the demo's **real** source systems under the `sources` band's `add` — use functional names + real vendor logos, NOT "synthetic data". Each source sets an `ingest` path so the diagram shows HOW it reaches the lakehouse:

```json
{ "id": "sources", "add": [
  { "id": "src-shopify", "label": "Shopify", "icon": "shopifyLogo", "ingest": "lakeflow-connect", "desc": "Orders & returns via Lakeflow Connect." },
  { "id": "src-sensors", "label": "Sensor data", "icon": "sensorSource", "ingest": "zerobus", "desc": "Realtime telemetry via Zerobus." }
],
  "set": [ { "id": "synthetic-data-gen", "state": "hidden" } ]
}
```

The catalog ships a default LuxeBeauty source set (Shopify/Zendesk/ERP/Line-Sensors). **Hide `synthetic-data-gen`** and add your demo's real sources. SDP automatically renders its bronze → silver → gold sub-strip — you don't author that.

**Vendor logos** (`icon` values that render the real brand mark): `shopifyLogo`, `zendeskLogo`, `sapLogo` (ERP), `sensorSource` (generic realtime sensor). For a source with no bundled logo, use the generic `inputData` (DB/API) or `unstructuredData` (files/PDFs).

---

## Available Icons

Sources / vendor logos: `shopifyLogo`, `zendeskLogo`, `sapLogo`, `sensorSource`, `inputData`, `unstructuredData`.

Products / platform: `lakeflowConnect`, `deltaTable`, `data`, `deltaLake`, `sdpPipeline`, `streaming`, `sqlWarehouse`, `notebooks`, `jobsPipelines`, `dashboard`, `metricViews`, `genie`, `knowledgeAssistant`, `multiAgentSupervisor`, `agents`, `mlModel`, `modelServing`, `aiGateway`, `aiFunctions`, `vectorSearch`, `unityCatalog`, `deltaSharing`, `lakebase`, `databricksApps`, `businessUser`.

Brand product glyphs (multi-color, used by catalog defaults — you rarely set these directly): `genieBrand`, `aibiBrand`, `unityCatalogBrand`, `lakehouseBrand`, `lakebaseBrand`, `lakeflowConnectBrand`, `lakeflowJobsBrand`, `sdpBrand`.

---

## Authoring rules

1. **Don't list catalog components you accept as-is.** State auto-seeds from `resources.json` — if a capability is `buildable`/`talking_track` it already appears with the right emphasis. Touch a catalog component only to (a) give it a story-tied `desc`, or (b) force a non-default `state`.
2. **Always add the demo's sources** under the `sources` band — these are the only components the catalog can't know. Give each a short `desc` (what it is + volume), e.g. `{ "id": "src-shopify", "label": "Shopify", "icon": "inputData", "desc": "400K orders / returns, 24 months", "state": "active" }`.
3. **Descriptions are the point.** Make them demo-specific and human — what the user *does* with it ("ask 'why so many returns?'"), not the product datasheet. This is what shows when someone clicks a tile.
4. **Coherence:** the set of `active` + `mentioned` components must match the **Products Showcased** in README and the capabilities in `resources.json`. Since states derive from `resources.json`, this is usually automatic — verify you haven't force-set a `state` that contradicts it.
5. **Keep it short.** A typical `architecture.md` is just `name` + `story` + a `sources` band with `add`, plus a handful of `desc` overrides on the key components.

---

## Complete Example (LuxeBeauty Returns)

Note how small it is: states come from `resources.json`; this file just adds sources and tells each headline component's story.

```json
{
  "name": "LuxeBeauty Returns Intelligence Architecture",
  "story": "From a $180K returns spike to root cause and action — on one governed platform.",
  "bands": [
    {
      "id": "sources",
      "add": [
        { "id": "src-shopify", "label": "Shopify", "icon": "inputData", "desc": "Orders & returns — 400K rows, 24 months", "state": "active" },
        { "id": "src-zendesk", "label": "Zendesk", "icon": "inputData", "desc": "Customer feedback & return reasons", "state": "active" },
        { "id": "src-erp", "label": "ERP", "icon": "inputData", "desc": "Production lots & QC", "state": "active" },
        { "id": "src-mfg", "label": "PDF documents", "icon": "unstructuredData", "desc": "Incident report PDFs → Knowledge Assistant", "state": "active" }
      ]
    },
    {
      "id": "agentic-work",
      "set": [
        { "id": "genie", "desc": "\"Which lots drove the spike?\" — lot-level tracing in plain language." },
        { "id": "knowledge-assistant", "desc": "Grounded answers from manufacturing incident reports." },
        { "id": "supervisor-agent", "desc": "Routes a question across Genie + Knowledge Assistant and composes the answer." },
        { "id": "ml-training-serving", "label": "Premium Classifier", "desc": "XGBoost flags premium-return risk; registered in UC." }
      ]
    },
    {
      "id": "agentic-apps",
      "set": [
        { "id": "databricks-apps", "label": "Returns Console", "desc": "Ops team triages the queue and fires refunds — agent in the loop." },
        { "id": "aibi-dashboards", "desc": "The $180K spike, by category and lot — same numbers, one page." }
      ]
    },
    {
      "id": "agentic-data",
      "set": [
        { "id": "sdp", "desc": "Bronze → silver → gold; ai_classify enriches return reasons in gold." },
        { "id": "lakebase", "desc": "Backs the Returns Console queue + audit log — branch on reset." }
      ]
    }
  ]
}
```
