# Format reference: tabs, placement, and every field

Read this when a field in SKILL.md section 5 (The format) is not enough: the full top-level and node tables, the edge fields, and the nested placement fields.

### Tabs
The top level is a JSON **array**, one element per tab; `name` is the tab label. Always emit the full array, every tab, even for one tab.

### Placement
A tab is a tree. The top-level `nodes` are laid out by the tab's `layout`; every container lays out its own `children`. Read `reference/layout.md` before writing a tab. Placement is structure: never write coordinates for an ordinary node. `at` is the only fixed-coordinate field, and it is an exception.

### Nested placement fields
| Field | On | Description |
|---|---|---|
| `children` | `box`, `group` | The nodes this container places, in order. |
| `layout` | tab, `box`, `group` | `"row"` (left → right, the default), `"column"` (top → bottom) or `"grid"` (with `cols`). The tab's `layout` is required. |
| `cols` | `layout: "grid"` | Number of equal cells per row. |
| `gap` | tab, `box`, `group` | Space between children, px. Defaults: 100 at the top level, 48 in a box, 32 in a group. |
| `align` | any container | Cross-axis position: `"center"` (default), `"start"`, `"end"`, or `"stretch"` (a child spans the container's width or height, e.g. a banner row across its box). |
| `justify` | any container | Main-axis distribution: `"center"` (rows) or `"start"` (columns) by default, `"end"`, or `"between"` (first child at the start, last at the end, spare room shared). |
| `equal` | any container | `true`, `"w"` or `"h"`: children share the largest size. |
| `pad` | `box` | Inner padding, px (default 34). The title band and the subtitle are added on top, so nothing sits under a title. |
| `size` | `box` | `[w, h]`, a minimum size. On other nodes it fixes the size and opts out of auto-sizing. |
| `track` | any node or container | Shared name. Nodes with the same `track` line up across containers, on the cross axis of the container that holds them. |
| `at` | any child | `[x, y]`, the centre offset from the parent's content corner. Exception only: a supplied image or a hand-composed slide (`layout.md`, `redraw.md`). |

### Top level (each tab)
| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Tab label (default "Architecture N"). |
| `story` | No | One-line description; metadata, not rendered. Also where out-of-scope and reader-facing context go. |
| `aspect` | **Yes** | `"16:9"` or `"1:1"`. A composition target; the measured ratio is advisory. |
| `frame` | No | `{ title, subtitle?, titleFontSize?, subtitleFontSize?, show? }` — a title band rendered inside the export. Use for any deck-bound tab. |
| `theme` | No | `"slide"` (large type, flat cards, descriptions hidden on tiles/sources) or `"technical"` (compact, descriptions shown). **Omitted = `technical`** — always write `"slide"` on a deck tab. |
| `direction` | **Yes** | `"horizontal"` (flows), `"matrix"` (comparison/containment), `"vertical"` (explicit request only). `FLOW ORIENTATION` faults when < 60% of cross-column relationships follow it. |
| `layout` · `gap` · `align` · `justify` | **Yes** (`layout`) | How the top-level `nodes` are placed. See the nested placement table above. |
| `options.trademarkLogos` | No | `true` real third-party marks; `false` neutral badges; omitted = renderer default. Set it explicitly when portability matters. |
| `custom_logos` | No | `[{ id, svg }]` inline SVG logos, referenced as `"icon": "custom:<id>"`. |
| `legend` | No | `{ title?, show?, items[], fontSize?, width?, at? }`; `items` = sentences (auto-numbered) or `{n, text}`. `show`: `"panel"` (default, not in exports) · `"diagram"` · `"both"` — embed only on explicit request. |
| `nodes` · `edges` | Yes | The components and the lines between them. |

### A node
| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique per tab; free-form (need not match `type`). Every `edges` reference must resolve. |
| `type` | Yes | A catalog component id (`genie`, `sql-lakehouse`, `lakeflow-genie-block`, …) or a special kind: `source` · `multi-source` · `box` · `group` · `text` · `logo` · `image` · `note` · `callout` · `shape` · `card` · `html`. |
| `title` · `titleIcon` · `subtitle` | box | Container title + optional icon (any icon key) + grey header line under the title. Prefer over `label` for containers. |
| `label` · `icon` | No | Override the catalog default. A `type:"source"` **requires** `label`. `icon`: built-in name, `file:vendor/…`, `file:cloud/…`, or `custom:<id>`. |
| `desc` · `showDesc` | No | Description line. Catalog tiles: omit (catalog wording) unless story-specific. Slide: never rendered on tiles/sources; on a `logo` set `desc` + `showDesc:true`. Technical: shown by default on tiles; sources/logos need `showDesc:true`. `""` clears. |
| `caption` | source · logo | Label position vs icon: `right` (source default) · `left` · `top` · `bottom` (logo default). |
| `fontSize` | source · logo · text · box | Label size px. |
| `text` · `bold` · `vAlign` · `hAlign` · `src` | annotations | On `box`/`note`/`text`, `text` is markdown: `**bold**`, `*italic*`, `- ` bullets, `## ` title line, `` `code` ``; single newlines stay. No links/images/HTML. |
| `rot` · `scale` · `z` | No | Rotation (0/90/180/270), content scale, stacking (negative = behind; boxes are automatic). |
| `group` | No | Shared string → nodes select and move together. |
| `url` | No | `https://` link to the real resource the node stands for (pipeline, table, dashboard…). Not drawn; the viewer opens it from the node. Only a link the request gives. |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity, padding }` — only what differs (`padding` is the html block's frame inset). `border` px (0 none); `borderStyle` `solid`/`dashed`; colors hex; `shadow` 0–100. |
| `ai_reasoning` | No | Hidden authoring rationale; never rendered; round-trips verbatim. |

The tile color band comes from `type`; never write it.

### An edge
`{ "id"?, "from": "<id>[@handle]", "to": "<id>[@handle]", "flow"?, "arrow"?, "dashed"?, "color"?, "shape"?, "flowStyle"?, "centerX"?, "label"?, "labelPos"?, "ai_reasoning"? }`
- **Handles are inferred** from geometry (left→right ⇒ `@r` → `@l`; vertical ⇒ `@b`/`@t`). Add one only to override: a side (`l`/`r`/`t`/`b`) or a composite port.
- **A source feeding a Lakeflow block must name the ingest port:** `@in-lakeflow-connect` (databases, SaaS, Kafka), `@in-zerobus` (direct app/device events — sensors, IoT), `@in-direct` (files: PDF/CSV/Parquet). The port also picks the animation: zerobus → particles, direct → travelling docs, else → laser.
- `flow: true` → animated data-flow line (live canvas). Static exports (PNG/SVG, headless render) draw flow edges as clean lines.
- `arrow`: omit/`"auto"` · `"none"` · `"end"` · `"start"` · `"both"`. `auto` draws a target arrowhead on persona / Genie-One / UC-Model-Registry relationship edges and on process-flow edges (a `shape` end), and on every `flow:true` edge in static exports, so a PNG reads directionally. The live canvas shows flow direction by animation instead. Use `"start"`/`"both"` (often `dashed`) for a deliberate return edge; `"none"` to suppress.
- `shape`: omit by default (axis-aligned ends render identically in every mode, so setting it there is noise). `smooth` (default) and `step` are the same orthogonal route (round vs square elbows) — they honour handles and `centerX` (slides the vertical elbow). `step` is a per-diagram house style for engineering drawings (use it on every edge). `straight` ignores handles and draws a diagonal — only for short, adjacent relationships (a governance tie, a hub fan-out). The editor also offers Bezier and step-with-waypoints for hand-routing. **The handle is the routing decision;** if an edge routes badly, fix handles or `centerX`, not `shape`.
- `flowStyle`: `dot` · `particles` · `docs` · `laser`.
- `label` is drawn ON the edge (keep it short); `ai_reasoning` is never rendered.
- Edge labels are 11px by default; a dense technical or redrawn tab whose labels must read at a distance sets `options.edgeLabelSize` (px, 8–24) — the label placement uses the same size.
- `color` (hex) colours the line, its arrowhead and its label chip — for a diagram whose line colours carry meaning (e.g. current vs proposed paths).
- `labelPos: { d, from?, off? }` pins a label by hand: `d` px along the line from `from` (`"source"` default, or `"target"`), `off` perpendicular nudge (negative = above/left). It opts the edge out of automatic placement — use only when the solver's choice is wrong.
- A line passing a label goes beneath the opaque chip; it does not reroute.
