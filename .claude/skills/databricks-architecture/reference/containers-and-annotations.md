# Containers, annotations, the html block, and logos

Read this when you draw nested boxes, the Databricks physical hierarchy, free-form annotations (text, note, callout, card, html), captions, or custom logos.

### Containers (wrapper boxes)
A `type:"box"` is a labelled container with a `title`. A `type:"group"` is an invisible container: it only places its children. Both hold their nodes in `children`, laid out by `layout` (see `reference/layout.md`). Nest them to model a cloud diagram:
```json
{ "id": "aws", "type": "box", "title": "AWS", "layout": "column", "children": [
  { "id": "vpc", "type": "box", "title": "VPC 10.0.0.0/16", "titleIcon": "file:cloud/aws/networking/vpc", "layout": "row", "children": [
    { "id": "subnet-a", "type": "box", "title": "Private subnet", "layout": "column", "children": [
      { "id": "app", "type": "databricks-apps-work" },
      { "id": "db", "type": "lakebase" } ] } ] } ] }
```
- **Order is meaning.** Children are placed in the order listed, along the container's `layout`. A box that holds one row of tiles needs nothing but `children`.
- **Span by nesting, not by offset.** A full-width bar under two side-by-side boxes is a `column` whose children are a `row` of the two boxes and the bar; the bar gets `align: "stretch"` so it spans the width.

### Databricks physical layout (account / workspace / metastore / catalog)
A governance/physical ask is **nested containment** of ordinary boxes and logos, not flow tiles:
- **Admin Account** → box, `titleIcon: "file:vendor/databricks-admin"`; the top of the hierarchy.
- **Metastore** → box (`titleIcon: "databricksMetastore"`) at account level; it **owns the catalogs** (its `children` are the catalogs).
- **Catalog** → a box (`titleIcon: "dbCatalog"`) whose children are its schemas; **Schema / Table** → `type:"logo"` marks (`dbSchema` / `dbTable`, or `bronzeLayer`/`silverLayer`/`goldLayer` for medallion schemas) with a side caption.
- **Workspaces** → `type:"logo"` nodes (`file:vendor/databricks`) outside the metastore, bound to the catalogs they may use with an edge ("binds") — never by nesting a catalog inside a workspace.
Lay the catalogs out as the columns of the metastore's row, so sibling schemas stack tidily. See `reference/governance-layout.jsonc`.

### Annotations (free-form)
| type | props | use |
|------|-------|-----|
| `text` | `text`, `fontSize`, `bold`, `vAlign`/`hAlign` | free-floating label |
| `note` | `text`, `fontSize` | the one ≤8-word constraint the reader would misread the architecture without ("EU-only data", "Human approval required") |
| `callout` | `text` (the number), `size`, `style.fill`/`style.font` | the big numbered circle keyed to a `legend` line; stays round |
| `box` | `text`, `fontSize`, `vAlign`/`hAlign`, `children`, `layout`, `gap`, `align`, `justify`, `pad`, `subtitle`, `badge` | container or titled rectangle; `subtitle` = grey header line(s) under the title (the box grows so members clear it), `badge` = corner pill, `style.headerFill` = a filled header band behind title + subtitle. `titlePos`: `border` (default — small title on the top border) · `top` / `top-left` (inside the top, e.g. a large centred stage title with `fontSize` 22–28) · `bottom` / `bottom-left` (inside the bottom, for a group labelled underneath). A box that also sets `size` is **at least** that big — give a row of stages one `size` or `equal` so they line up |
| `card` | `title`, `icon`, `body`, `badge`, `badgeColor`, `accent`, `titleColor`, `fill`, `textColor`, `fontSize`, `size` | a card: tinted header (icon + title, optional corner `badge`) and a free-form **`body` of HTML** for whatever the source shows — a bold lead line, grey description, key/value rows, tag pills, bullets, a small table. Sanitized on render with the same allow-list as the html block (see the html block below; no url(), links, images or scripts). Width 300 (or `size[0]`); height grows with the body — nothing truncates. **No `body`** → a plain labelled box, centred, auto-fit. `accent` colours border + header; `fill` + `textColor` make a solid card. (Old `summary`/`desc`/`chips`/`tags` still load but are converted to `body`.) |
| `shape` | `shape`, `text`, `fontSize`, `bold`, `vAlign`/`hAlign`, `size` | one step of a process flow (see `process-flows.md`) |
| `html` | `html`, `size`, `style` (`fill`/`border`/`radius`/`shadow`/`padding`), `rot`, `z` | a free-form HTML block for content no component covers (KPI strip, comparison table, timeline, rich legend). Transparent unless framed; its height is measured from the HTML (`size[1]` is a floor). See *Custom content — the html block*. |
| `logo` | `icon`, `text` (caption), `caption`, `fontSize`, `desc`/`showDesc`, `size`, `style` | a standalone mark, e.g. `file:persona/user`. **Icon tile:** `style.fill` (or `style.border`/`style.shadow`) paints a rounded tile behind the ICON only — `"style": { "fill": "#FFFFFF", "border": 1, "borderColor": "#E2E8F0", "radius": 8 }` with `size: [38, 38]` is the white app-icon tile. Never draw a separate `shape` behind a logo for this. |
| `image` | `src` (URL or base64) | a standalone image |

Borders come only from `style` (`style.border: 0` removes; `box` shows 1px by default, `text` none).

### Custom content — the `html` block
When no component, card or composite covers what the diagram needs, use an `html` block. It is a first-class node: put it in the `children` of the container that holds the content it describes. It takes edges (`@l`/`@r`/`@t`/`@b`), and it draws in the export.

**When.** A KPI strip, a comparison or configuration table, a timeline or step list, a rich legend, an annotated callout, a custom badge or banner. In a redraw, a bespoke element the source draws (a dashboard tile, a metric strip) becomes an `html` block at its drawn size and place.
**Prefer a component when one exists.** A catalog tile, a `card`, a `box` or a `shape` stays editable and gets its icon and ports; reach for `html` for the rest.

**How.**
- `size[0]` is the width (default 320). The height is measured from the HTML; `size[1]` is a floor. Content the estimate misses is clipped and inspect-arch reports it as `CLIPPED TEXT`, so check the render.
- Frame: transparent by default, so the HTML owns its look. `style.fill`, `style.border`, `style.borderColor`, `style.radius`, `style.shadow` and `style.padding` (px inside the frame) draw one.
- Keep the text at the diagram's size: body text is 13px, the same as a card body; a number in a KPI strip is 16–20px; a heading is 14–18px. Keep each block to about 40 words, the same text budget as a tile.
- Use the slide palette: ink `#0F172A`, muted `#64748B`, panel `#F1F5F9`, border `#CBD5E1`, accent `#FF3621`.
- Tags: `h1–h4` `p` `div` `span` `b` `strong` `i` `em` `u` `small` `sub` `sup` `code` `blockquote` `ul` `ol` `li` `table` `thead` `tbody` `tr` `th` `td` `br` `hr`.
- Style (`style` attribute only): colour, background (also `linear-gradient`), border*, border-radius, padding*, margin*, font-size/weight/style, text-align/decoration/transform, letter-spacing, `display` (block, inline, inline-block, flex, inline-flex, grid, inline-grid, none), `grid-template-columns`/`rows` (px, %, fr, auto, `repeat(N, …)`, `repeat(auto-fill, minmax(Npx, 1fr))`), `flex-wrap`, `flex-direction`, `justify-items`, `gap`/`row-gap`/`column-gap`, `flex-grow`, width/min-width/max-width, height/min-height, `box-shadow`, align-items, justify-content, line-height, white-space, opacity, vertical-align.
- Two-column comparisons: a `table` with `th`/`td` (give `td` a `padding`), or a `display:grid` of cells.
- Editing: the palette's **HTML** entry (drag it on, or double-click). Select the block to edit its HTML in the side panel; the preview is the same sanitized output.

**Safety.** The HTML goes through the same sanitizer as a card body. Anything outside the lists above is stripped (its text stays): scripts, styles, `iframe`, `svg`, images, forms, links, event handlers, `url()`, `position`, `overflow`, `z-index`. Don't rely on a link or an image; they never render.

**Examples** (single-quoted attributes, so the JSON needs no escaping; generic content):

KPI strip, framed:
```json
{ "id": "anno-kpi", "type": "html", "size": [340, 40],
  "style": { "fill": "#FFFFFF", "border": 1, "borderColor": "#CBD5E1", "radius": 10, "padding": 10 },
  "html": "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'><div style='background:#F1F5F9;border-radius:8px;padding:8px;text-align:center'><div style='font-size:18px;font-weight:700;color:#0F172A'>98%</div><small style='color:#64748B'>Uptime</small></div><div style='background:#F1F5F9;border-radius:8px;padding:8px;text-align:center'><div style='font-size:18px;font-weight:700;color:#0F172A'>1.2M</div><small style='color:#64748B'>Orders a day</small></div><div style='background:#F1F5F9;border-radius:8px;padding:8px;text-align:center'><div style='font-size:18px;font-weight:700;color:#0F172A'>240 ms</div><small style='color:#64748B'>p95 latency</small></div></div>" }
```

Rollout timeline, transparent:
```json
{ "id": "anno-rollout", "type": "html", "size": [300, 40],
  "html": "<h3 style='color:#0F172A'>Rollout</h3><div style='display:flex;flex-direction:column;gap:6px'><div><b>Week 1</b> Pilot with one team</div><div><b>Week 3</b> Add the second region</div><div><b>Week 6</b> General availability</div></div>" }
```

### Captions and default chrome
Sources and logos take `caption`:
```
right:  [icon] Label      left:  Label [icon]      top:  Label / [icon]      bottom:  [icon] / Label
```
| kind | border | shadow | fill |
|------|--------|--------|------|
| catalog tile / source | thin band-tinted | subtle | theme surface |
| logo | none | none | transparent (a `style.border`/`fill` turns it into a boxed tile) |
| box | 1px | none | transparent when wrapping; white as a plain rectangle |
| text | none | none | none |
| callout | 2px darker rim | subtle | Databricks red |
| composite | own internal chrome (`db-platform` no border, governance 1px) | varies | own |

### Custom logos & images
- **No logo for a source** → `"icon": "text"` (or omit `icon`): a brand-colored text badge. Prefer this over an unrelated logo.
- **Custom SVG** → top-level `custom_logos: [{ "id": "acme", "svg": "<svg xmlns='http://www.w3.org/2000/svg' …/>" }]`, then `"icon": "custom:acme"` on a source or logo. Never trademark-gated.
- **Images** → a `type:"image"` node with `src` (data URI or URL); standalone only, not usable as an `icon`.
