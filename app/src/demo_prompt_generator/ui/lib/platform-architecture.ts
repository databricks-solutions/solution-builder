/**
 * Platform Architecture Schema + Catalog
 * =======================================
 *
 * The file format is a FLAT graph: `architecture.md` holds a ```json block with
 * just `nodes` (the components shown on the canvas) + `edges` (the lines between
 * them). A node is on the canvas iff it's listed in `nodes` — there is no
 * state / hidden / bands in the file.
 *
 *   { name, story, options?, nodes: [...], edges: [...] }
 *   node:  { id, type, at:[x,y], size?, rot?, scale?, z?, group?,
 *            label?, desc?, icon?, ingest?, style?:{border,shadow,radius,fill,…} }
 *   edge:  { id?, from:"<id>[@handle]", to:"<id>[@handle]", flow?, arrow?, … }
 *
 * `type` is a CATALOG component id (which folds in the composite "kind"), or one
 * of the special kinds source / box / text / logo / image. The CATALOG below is
 * a pure LOOKUP: given a `type` it supplies the default icon / label / desc /
 * size / ports and the band (used only for the tile's color). The library
 * palette renders the full catalog to drag from; the file lists only what's
 * placed.
 *
 * `parseArchitecture` reads the flat file → the internal resolved `PlatformSchema`
 * ({ bands, layout }) that flow-mapping + the canvas consume; `serializeArchitecture`
 * writes the live canvas back out to the flat format.
 */

import type { DatabricksIconName } from "@/components/databricks-icons";

/** An icon reference: a built-in DatabricksIconName, or a file-icon key like
 *  "file:vendor/kafka" / "file:cloud/aws/storage/s3". The `& {}` keeps
 *  autocomplete for the known built-ins while allowing any file-icon string. */
export type IconKey = DatabricksIconName | (string & {});
import { CAPABILITY_META } from "./capabilities";
import type { DeployedResourceLink } from "./custom-api";

// =============================================================================
// Types
// =============================================================================

/** Tri-state visibility/emphasis for a component. */
export type ComponentState = "active" | "mentioned" | "hidden";

export type BandId =
  | "agentic-apps"
  | "agentic-work"
  | "unified-governance"
  | "agentic-data"
  | "sources";

export interface PlatformComponent {
  /** Stable id — for capability-backed tiles this IS the capability slug
   *  (e.g. "genie", "databricks-apps") so resources.json maps 1:1. Source
   *  components get demo-authored ids (e.g. "src-shopify"). */
  id: string;
  label: string;
  icon: IconKey;
  /** Story-tied, per-demo blurb shown in the detail panel. Catalog ships a
   *  generic fallback; the agent overrides it with something demo-specific. */
  desc: string;
  state: ComponentState;
  /** Capability slug this tile is backed by, when different from `id`.
   *  Drives the deployed-resource deep-link lookup. Defaults to `id`. */
  capability?: string;
  /** Renders as a richer COMPOSITE block instead of a plain tile. The first is
   *  "lakeflow" — bundles Lakeflow Connect + Zerobus + direct ingest feeding a
   *  bronze→silver→gold pipeline, with 3 labelled input ports on the left. */
  kind?: CompositeKind;
  /** Small grey sub-line under the label (e.g. a one-line value prop). */
  sublabel?: string;
  /** A tiny colored pill next to the label (e.g. "RT" for real-time). */
  badge?: string;

  // -- Authoring metadata (catalog-only) — the SINGLE source of truth for the
  //    skill's component reference. `scripts/gen-architecture-skill.mjs` reads
  //    these + the default `desc` and writes the catalog section into the
  //    architecture skill doc. Not used at render time; only to guide the agent.
  /** One line for the agent: what it is / what's inside / when to pick it (vs
   *  alternatives). Omit for plain tiles whose `desc` already says it. */
  authoring?: string;
  /** Components with named anchors: handle id → what connects there. e.g.
   *  { "in-lakeflow-connect": "← databases / SaaS apps", "r": "→ compute" }.
   *  THE key metadata — tells the agent which port maps to what. */
  ports?: Record<string, string>;
  /** Optional toggleable PARAMS a component exposes. Each renders as a checkbox
   *  in the right edit panel; enabled values live on the NODE as `params`
   *  (NodePosition.params → the flat file's `params`). A composite reads
   *  `d.params?.<key>` to render conditionally (e.g. the medallion table shows a
   *  Feature Store / Metric Views fork when enabled). General — any component
   *  can declare options; the panel + round-trip are shared. */
  options?: ComponentOption[];
}

/** One toggleable component param. */
export interface ComponentOption {
  /** Stored under `node.params[key]`. */
  key: string;
  /** Checkbox label in the edit panel. */
  label: string;
  /** Default when the node has no explicit value (default false). */
  default?: boolean;
}

/** The animated-flow rendering style of an edge. `dot` = a single travelling
 *  dot; `particles` = a dense river of cubes/circles/triangles (realtime);
 *  `docs` = travelling document glyphs (file landing); `laser` = a comet with a
 *  fading tail (explicit-choice only — never auto-derived); `model` = a small ML
 *  model glyph travelling the line (auto-default for edges touching the UC Model
 *  Registry — a served/registered model flowing through). Canonical home for the
 *  union; the UI layer re-uses it so schema + renderer + menu never drift. */
export type FlowStyle = "dot" | "particles" | "docs" | "laser" | "model";

/** Composite block kinds (super-set components that draw an inner mini-diagram
 *  and expose multiple named ports). Extend this as we add more blocks. */
export type CompositeKind = "lakeflow" | "genie-code" | "governance" | "lakeflow-genie" | "agent-bricks" | "db-platform" | "genie-one" | "medallion-table";

/** The 3 left input ports a "lakeflow" composite exposes. Edge handle ids on
 *  the block are `in-${port}` (+ a single `r` output on the right). */
export const LAKEFLOW_PORTS = [
  { id: "lakeflow-connect", label: "Lakeflow Connect" },
  { id: "zerobus", label: "Zerobus" },
  { id: "direct", label: "Direct" },
] as const;
export type LakeflowPort = (typeof LAKEFLOW_PORTS)[number]["id"];

export interface PlatformBand {
  id: BandId;
  label: string;
  sublabel: string;
  components: PlatformComponent[];
}

export interface PlatformSchema {
  name: string;
  /** One-line framing shown under the title (optional, agent-authored). */
  story?: string;
  /** When true, third-party SaaS/vendor source logos render as their real
   *  (trademarked) brand marks. Default false → they render as a neutral
   *  text badge instead. Cloud (AWS/GCP/Azure) + Databricks marks are always
   *  shown regardless (they don't need this opt-in). */
  enableTrademarkLogos?: boolean;
  /** The declared left→right lane names (the file's top-level `columns`). Kept
   *  on the schema so it ROUND-TRIPS: symbolic `col` refs are meaningless without
   *  it, so serialize must re-emit it even after a node is dragged/pinned. */
  columns?: string[];
  bands: PlatformBand[];
  /** Canvas layout — node positions + edges. Persisted by the interactive
   *  editor; auto-seeded by band when absent. */
  layout: PlatformLayout;
  /** Inline custom SVG logos, keyed by id. A node references one via
   *  `icon: "custom:<id>"`. Threaded to the renderers via CustomLogosContext. */
  customLogos?: Record<string, string>;
}

// -- Interactive-canvas layout (positions + edges) ---------------------------

export interface NodePosition {
  x: number;
  y: number;
  /** Rotation in degrees (0/90/180/270). Optional; defaults to 0. */
  rot?: number;
  /** User-resized width/height (px). Optional; defaults to the node's natural size. */
  w?: number;
  h?: number;
  /** Manual content scale (0.5..1.5). Optional; defaults to 1. */
  scale?: number;
  /** Canvas-edited label (double-click to rename). Overrides the catalog/agent
   *  label for this node only. */
  label?: string;
  /** Canvas-picked icon — set when the node's TYPE was changed on the canvas.
   *  Overrides the component's default icon. */
  icon?: IconKey;
  /** Free-form annotation node (text / box / logo / image). Present only for
   *  annotation nodes (id starts with "anno-"); catalog nodes leave it unset. */
  annotation?: AnnotationData;
  /** Per-node style overrides (right-click menu) — apply to any node's box. */
  opacity?: number;        // 0..1, whole-node opacity
  fillColor?: string;      // box/background color (hex)
  fontColor?: string;      // text/label color (hex)
  iconColor?: string;      // logo SVG recolor (hex); unset → icon's own color
  /** Border styling. borderWidth 0 = no border. */
  borderWidth?: number;    // px
  borderStyle?: "solid" | "dashed";
  borderColor?: string;    // hex
  borderRadius?: number;   // px corner radius
  shadow?: number | boolean; // drop-shadow intensity 0–100 (legacy boolean ok)
  /** Stacking order (bring to front / send to back). Default 0. */
  z?: number;
  /** A canvas-added data source (from "+ more data sources"). Stores just the
   *  logo-catalog key + icon; label defaults come from the unified
   *  logo-catalog.json. Present only for such nodes. The Lakeflow ingest port a
   *  source feeds is carried on the EDGE handle (`@in-zerobus`, `@in-direct`,
   *  `@in-lakeflow-connect`), not here. */
  source?: { key: string; icon: IconKey };
  /** Source tiles only: label placement relative to the icon (right default |
   *  left | top | bottom). Persisted via the shared FileNode `caption`. */
  sourceCaption?: "right" | "left" | "top" | "bottom";
  /** Source tiles only: label font size (px). Persisted via FileNode `fontSize`. */
  fontSize?: number;
  /** Editable description line shown under the title. For catalog product tiles
   *  this OVERRIDES the CATALOG default `desc`; for sources/logos it's the only
   *  source. Distinguish `undefined` (use default) from `""` (deliberately
   *  cleared). */
  desc?: string;
  /** Whether the description line is shown. `undefined` → default resolution
   *  (product tile with a non-empty desc → shown; source/logo → shown only when
   *  a desc exists); explicit `true`/`false` = user toggled it. */
  showDesc?: boolean;
  /** Group membership — a shared id stamped on every member of a group
   *  (right-click → Group). Selecting one member selects the whole group so
   *  they move together. Cleared on Ungroup. No container node — just a tag. */
  groupId?: string;
  /** Author-time SYMBOLIC placement carried through from the file (`col`/`row`/
   *  relational fields, AND container/pin fields) so it can be RE-EMITTED on save
   *  for nodes the user never moved — instead of flattening to `at`. computeLayout
   *  already resolved it to `x`/`y` (+ derived `w`/`h` for a box); this is kept
   *  only for round-trip. Cleared (and `at`/`size` emitted instead) once `pinned`
   *  flips — see below. Container fields (`wraps`/`bounds`/`pin`) matter most: a
   *  box or pinned banner that flattened to `at` would freeze and stop reflowing
   *  (children escape the box, banners drift off the corner). */
  placement?: {
    col?: string; row?: number;
    alignX?: string; alignY?: string;
    below?: string; above?: string; leftOf?: string; rightOf?: string;
    gap?: number;
    /** Container box: auto-sizes to enclose these child ids (+ `pad`). */
    wraps?: string[]; pad?: number;
    /** Per-side box edge anchors. */
    bounds?: { left?: string; right?: string; top?: string; bottom?: string };
    /** Corner dock for a banner/persona inside a box. */
    pin?: {
      at: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
      to?: string; pad?: number; float?: boolean;
    };
  };
  /** True once the user has manually positioned this node (dragged it, or it was
   *  authored with an explicit `at`). A pinned node serializes as `at`; an
   *  un-pinned node with `placement` re-emits its symbolic fields. */
  pinned?: boolean;
  /** Enabled toggleable component options (round-trips to the file's `params`).
   *  See PlatformComponent.options. */
  params?: Record<string, boolean>;
  /** Render this node as a STACK of N cards (N-1 blank offset copies peeking out
   *  the bottom-right of the front card) to signal "many of these" — e.g. deploy
   *  N apps. 1 or absent = a single normal card. Works on any node kind. */
  stack?: number;
}

/** A free-form canvas annotation — not a Databricks catalog component. One node
 *  kind with four variants; all props persist in the layout. */
export type AnnotationVariant = "text" | "box" | "logo" | "image";
export interface AnnotationData {
  variant: AnnotationVariant;
  /** text/box: the (editable) text. */
  text?: string;
  /** box: an optional title bar across the top of the box. Empty by default
   *  (invisible — but double-clicking where it would be lets you edit it). */
  title?: string;
  /** box: an icon key rendered before the title text (e.g. a small Databricks
   *  logo for the "Databricks Workspace" preset). */
  titleIcon?: string;
  /** text/box: font size in px (default 14). */
  fontSize?: number;
  /** text/box: bold text. */
  bold?: boolean;
  /** box: vertical × horizontal text placement (default "middle"/"center").
   *  text: horizontal placement (default "left"). */
  vAlign?: "top" | "middle" | "bottom";
  hAlign?: "left" | "center" | "right";
  /** text: overflow mode — the single source of truth for how the box behaves.
   *   • `auto` (default, or unset) → the box AUTO-FITS its content: it grows as
   *     you type. No fixed size.
   *   • `wrap` → FIXED box; text flows onto new lines within it.
   *   • `truncate` → FIXED box; single line, ellipsis.
   *  Dragging a resize handle switches an `auto` node to `wrap` (a fixed box). */
  textWrap?: "auto" | "wrap" | "truncate";
  /** @deprecated legacy "user resized it" flag — superseded by textWrap
   *  (wrap/truncate ⇒ fixed). Still read for back-compat with old files. */
  sized?: boolean;
  /** logo: the chosen icon key — a DatabricksIconName OR a file-icon key
   *  ("file:vendor/snowflake", "file:cloud/aws/storage/s3"). */
  icon?: string;
  /** logo: where the text caption sits relative to the icon —
   *  right | left | top | bottom. Legacy "side" == right, "below" == bottom.
   *  Default (unset) renders below (the original logo caption behavior). */
  caption?: "right" | "left" | "top" | "bottom" | "side" | "below";
  /** image: a URL, or a `data:` base64 string for pasted images. */
  src?: string;
  /** logo: an editable description line under the caption (opt-in via showDesc). */
  desc?: string;
  /** logo: whether the description line is shown. */
  showDesc?: boolean;
}

export interface PlatformEdge {
  id: string;
  source: string;
  target: string;
  /** Which handle each end attaches to — a composite port id ("in-zerobus")
   *  or a side ("l"/"r"/"t"/"b"). Preserved so the anchor survives a reload. */
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Red-dot "data flowing" animation along the edge. */
  animated?: boolean;
  /** Dashed/dotted stroke instead of solid. */
  dashed?: boolean;
  /** Routing shape. */
  shape?: "smooth" | "straight" | "step";
  /** Flowing-data animation style. Unset → auto-derived from the origin: any
   *  data SOURCE (a node with an `ingest`) defaults to `laser`; a non-source
   *  origin defaults to `dot`. An explicit value overrides that default. */
  flowStyle?: FlowStyle;
  /** Static arrowheads. Unset/"auto" → auto (arrow for user/Genie-One
   *  relationship edges, else flow). "none" | "end" | "start" | "both" force it.
   *  An arrow edge is a plain relationship line (no data-flow animation). */
  arrow?: "auto" | "none" | "end" | "start" | "both";
  /** Manual X of the vertical elbow segment (smooth/step edges). Unset → the
   *  auto-staggered position. Set by dragging the ↔ handle on the segment. */
  centerX?: number;
  /** Optional edge label. */
  label?: string;
}

export interface PlatformLayout {
  /** Saved node positions, keyed by component id. Missing → auto-laid out. */
  nodes: Record<string, NodePosition>;
  /** Edges drawn on the canvas. Empty → auto-seeded flow edges. */
  edges: PlatformEdge[];
  /** Component ids removed from the canvas (vs the catalog defaults). */
  hidden: string[];
}

// -- The FLAT file shape the agent + canvas read/write into architecture.md ---
// A node is in `nodes` iff it's on the canvas (no state / hidden / mentioned).
// Position is required; everything else is an override of the catalog default.

/** One placed node in the flat file. `type` is a catalog component id (which
 *  folds in the old `kind`) OR a special kind: "source" | "box" | "text" |
 *  "logo" | "image". */
export interface FileNode {
  id: string;
  type: string;
  /** Canvas position [x, y] (node CENTER). Optional: when omitted, computeLayout
   *  derives it from `col`/`row` (or wraps). An explicit `at` ALWAYS wins. */
  at?: [number, number];
  /** Symbolic layout: which declared `columns` lane this node sits in, and its
   *  order within that lane (else order = order of appearance). Ignored when
   *  `at` is set. */
  col?: string;
  row?: number;
  /** Enabled toggleable component options (see PlatformComponent.options), e.g.
   *  `{ "feature_store": true }`. Only keys the component declares are meaningful. */
  params?: Record<string, boolean>;
  /** Render as a STACK of N cards to signal "many of these" (e.g. N apps): N-1
   *  blank offset copies peek out the bottom-right of the front card. 1/absent =
   *  single card. Works on any node type. */
  stack?: number;
  /** Relational placement — position this node against ANOTHER node's resolved
   *  box, evaluated AFTER columns (so the anchor keeps its own col/row default).
   *  Use these instead of guessing `at` coordinates.
   *    alignX/alignY: "<id>" — copy that node's center X (or Y); keep your other
   *                            axis from col/row. `gap` does NOT apply.
   *    below/above/leftOf/rightOf: "<id>" — sit adjacent to that node on that
   *                            side, centered on its other axis; `gap` = px
   *                            between the boxes (default 40).
   *  Use at MOST ONE per node — if several are set only one applies (precedence
   *  alignX > alignY > leftOf > rightOf > above > below). `at` still wins over
   *  everything. Chains resolve in dependency order. */
  alignX?: string;
  alignY?: string;
  below?: string;
  above?: string;
  leftOf?: string;
  rightOf?: string;
  gap?: number;
  /** Container box: this node (type "box") auto-sizes to enclose these child
   *  node ids (+ `pad`). Recursive — a box may wrap other boxes. */
  wraps?: string[];
  pad?: number;
  /** Per-side edge anchors for a `type:"box"` — places each edge at a reference
   *  point instead of wrapping. Each side is `"<nodeId>:<anchor>"` (anchor =
   *  left|right|top|bottom|center of that node's box) or `"col:<name>:<anchor>"`
   *  (a column's edge/midpoint), or "wrap" to fall back to enclosing `wraps`.
   *  Lets the box cut HALFWAY through a node/column (the node straddles the
   *  border). Unspecified sides fall back to `wraps` (or 0). */
  bounds?: { left?: string; right?: string; top?: string; bottom?: string };
  /** Anchor placement inside a box (instead of `at`/`col`). For banners /
   *  personas sitting on a box corner.
   *    at:    one of the 9 anchors (top-left … center … bottom-right).
   *    to:    the box id to dock into (default: the largest box / overall bounds).
   *    pad:   inset px from the box edge (default 16).
   *    float: false/omitted → RESERVE a band (the box grows so this never
   *           overlaps content); true → overlay at the corner (may sit over it). */
  pin?: {
    at: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
    to?: string;
    pad?: number;
    float?: boolean;
  };
  /** Resized box [w, h]. */
  size?: [number, number];
  rot?: number;
  scale?: number;
  z?: number;
  group?: string;
  /** Copy overrides (only when they differ from the catalog default). */
  label?: string;
  desc?: string;
  /** Whether the description line is shown (undefined → default resolution). */
  showDesc?: boolean;
  icon?: IconKey;
  /** box/text/logo/image annotation props. */
  text?: string;
  /** box: title-bar text + leading icon. */
  title?: string;
  titleIcon?: IconKey;
  /** logo: caption placement (right|left|top|bottom; legacy side|below). */
  caption?: "right" | "left" | "top" | "bottom" | "side" | "below";
  fontSize?: number;
  bold?: boolean;
  vAlign?: "top" | "middle" | "bottom";
  hAlign?: "left" | "center" | "right";
  /** text: overflow mode — "auto" (default, grows) | "wrap" | "truncate". */
  textWrap?: "auto" | "wrap" | "truncate";
  /** @deprecated legacy "sized" flag, superseded by textWrap. */
  sized?: boolean;
  src?: string;
  /** Optional visual overrides. */
  style?: {
    border?: number;        // borderWidth
    borderStyle?: "solid" | "dashed";
    borderColor?: string;
    radius?: number;        // borderRadius
    shadow?: number | boolean;
    fill?: string;          // fillColor
    font?: string;          // fontColor
    icon?: string;          // iconColor (recolor a logo's SVG)
    opacity?: number;
  };
}

/** One edge in the flat file. `from`/`to` may carry an inline `@handle`
 *  (a composite port like `in-zerobus` or a side `l`/`r`/`t`/`b`). */
export interface FileEdge {
  id?: string;
  from: string;
  to: string;
  flow?: boolean;          // ↔ animated
  arrow?: "auto" | "none" | "end" | "start" | "both";
  dashed?: boolean;
  shape?: "smooth" | "straight" | "step";
  flowStyle?: FlowStyle;
  centerX?: number;
  label?: string;
}

/** The whole flat file. */
export interface ArchitectureFile {
  name?: string;
  story?: string;
  options?: { trademarkLogos?: boolean };
  /** Ordered left→right lane names. Nodes reference one via `col`. Optional —
   *  only needed when authoring with symbolic (col-based) placement. */
  columns?: string[];
  /** Inline custom SVG logos: `[{ id, svg }]`. Reference one from any node's
   *  `icon` as `"custom:<id>"` (works as a logo node OR a source tile). */
  custom_logos?: { id: string; svg: string }[];
  nodes?: FileNode[];
  edges?: FileEdge[];
}

const ANNOTATION_TYPES = new Set<AnnotationVariant>(["text", "box", "logo", "image"]);

/** "Databricks Architecture" palette presets — ready-made annotations for the
 *  physical Databricks layout: titled container boxes (Workspace / Metastore)
 *  and logo+label tiles (Catalog / Schema / Table). Each seeds an annotation of
 *  the given `variant` with the extra props merged on. */
export interface AnnotationPreset {
  id: string;
  label: string;
  /** Which annotation variant to place (default "box"). */
  variant?: AnnotationVariant;
  /** Extra AnnotationData merged onto the variant defaults when placed. */
  annotation: Partial<AnnotationData>;
}
export const DBX_ARCH_PRESETS: AnnotationPreset[] = [
  {
    id: "dbx-workspace",
    label: "Databricks Workspace",
    annotation: { title: "Databricks Workspace", titleIcon: "file:vendor/databricks" },
  },
  {
    id: "dbx-metastore",
    label: "Databricks Metastore",
    annotation: { title: "Databricks Metastore", titleIcon: "databricksMetastore" },
  },
  // Catalog / Schema / Table — a logo (nested database cylinder) + an editable
  // label to its side. Placed as `logo` annotations with caption:"side".
  {
    id: "dbx-catalog",
    label: "Catalog",
    variant: "logo",
    annotation: { icon: "dbCatalog", text: "Catalog", caption: "side" },
  },
  {
    id: "dbx-schema",
    label: "Schema",
    variant: "logo",
    annotation: { icon: "dbSchema", text: "Schema", caption: "side" },
  },
  {
    id: "dbx-table",
    label: "Table",
    variant: "logo",
    annotation: { icon: "dbTable", text: "Table", caption: "side" },
  },
];
export const DBX_ARCH_PRESET_BY_ID: Record<string, AnnotationPreset> = Object.fromEntries(
  DBX_ARCH_PRESETS.map((p) => [p.id, p]),
);

// =============================================================================
// Band metadata — the fixed marketing framing (top → bottom)
// =============================================================================

export const BAND_META: Record<BandId, { label: string; sublabel: string }> = {
  "agentic-apps": {
    label: "Agentic Apps",
    sublabel: "Deploy agents and apps at scale to transform work",
  },
  "agentic-work": {
    label: "Agentic Work",
    sublabel: "Data-smart coworkers for every employee",
  },
  "unified-governance": {
    label: "Unified Governance",
    sublabel: "One control plane for data + AI — security, lineage, cost",
  },
  "agentic-data": {
    label: "Agentic Data",
    sublabel: "Unified, real-time data foundation",
  },
  sources: {
    label: "Sources",
    sublabel: "The systems your business already runs on",
  },
};

/** The flow columns, left → right (data flows toward the user). Governance is
 *  NOT here — it renders as a full-width foundation bar UNDER these columns
 *  (it underpins every column, like Unity Catalog on the marketing slide). */
export const FLOW_ORDER: BandId[] = [
  "sources",
  "agentic-data",
  "agentic-work",
  "agentic-apps",
];

/** The band rendered as the foundation bar below the flow columns. */
export const FOUNDATION_BAND: BandId = "unified-governance";

/** All bands, for menus / lookups that need the complete set. */
export const BAND_ORDER: BandId[] = [...FLOW_ORDER, FOUNDATION_BAND];

/** Per-band accent — one cohesive navy→indigo family graded by depth, NOT a
 *  rainbow. Matches the reference Architecture Canvas. Used for the band rail
 *  + active-tile rim. Sources stays neutral slate (external estate). */
export const BAND_COLOR: Record<BandId, string> = {
  "agentic-apps": "#313F73",
  "agentic-work": "#41538F",
  "unified-governance": "#5266A6",
  "agentic-data": "#6577B4",
  sources: "#94A3B8",
};

// =============================================================================
// Default catalog — every platform component, in band order
// =============================================================================

/** A catalog entry is a component WITHOUT a state (state is computed). The
 *  id is the capability slug so `CAPABILITY_META` + resources.json line up. */
type CatalogComponent = Omit<PlatformComponent, "state">;

/** Generic, brand-level fallback blurbs. The agent overrides these per demo
 *  with story-tied copy. Kept short — one sentence, what it does for a user.
 *
 *  ID CONVENTION: when a component maps 1:1 to a capability in the demo-gen
 *  skill's `references/platform_architecture.md`, REUSE that capability's id
 *  here (e.g. `ai-bi-dashboard`, `sql-lakehouse`, `text-classification`) so the
 *  two stay cross-searchable — the architecture skill ships that file and the
 *  agent looks up "how components connect" by id. Renaming an id here is a
 *  breaking change for saved `architecture.md` files, but there's no migration:
 *  an unknown id renders a labeled placeholder tile (see flow-mapping.ts). */
export const CATALOG: Record<BandId, CatalogComponent[]> = {
  "agentic-apps": [
    { id: "databricks-apps", label: "Databricks Apps", icon: "databricksApps", desc: "Custom web app where the team does the work — queue, actions, all in one place." },
    { id: "ai-bi-dashboard", label: "AI/BI Dashboard", icon: "aibiBrand", sublabel: "Analyst consult & build insight", desc: "Governed dashboards on the same data — one set of numbers, one page.", capability: "aibi-dashboards" },
  ],
  "agentic-work": [
    { id: "databricks-apps-work", label: "Databricks Apps", icon: "databricksAppsBrand", sublabel: "Deploy business apps", desc: "Deploy business apps",
      authoring: "The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Room." },
    { id: "genie-one", label: "Genie One - Mobile app", icon: "genieOneBrand", kind: "genie-one", sublabel: "Databricks access for business user", desc: "Databricks access for business user",
      authoring: "The business-user / mobile entry point. It has a Business-users persona built IN (a small user icon docked above the Genie One mark) — so you do NOT need a separate file:persona/user node beside it. Wire Genie One --> dashboard / Genie Room / app (auto-arrows; leave `arrow` out)." },
    { id: "genie", label: "Genie Room", icon: "genieBrand", sublabel: "Ask anything about your data", desc: "ask anything about your data" },
    { id: "knowledge-assistant", label: "Knowledge Assistant", icon: "knowledgeAssistant", desc: "Chat with your documents — grounded, cited answers from unstructured content." },
    { id: "supervisor-agent", label: "Supervisor Agent", icon: "multiAgentSupervisor", desc: "Routes a question to the right specialist agent and composes the answer." },
    // Composite "Agent Bricks" block: the bundled agent building blocks
    // (supervisor + extraction + document parsing + classification).
    { id: "agent-bricks", label: "Agent Bricks", icon: "file:vendor/agent-bricks", kind: "agent-bricks",
      desc: "Databricks' managed agents — a multi-agent supervisor plus information extraction, document parsing, and classification, built and governed for you.",
      authoring: "Managed MULTI-agent system: a Supervisor orchestrating Knowledge Assistant / Genie / MCP / Functions (with extraction·parsing·classification chips). Use when the agent layer is a supervisor routing to specialists; if the demo uses only one agent capability, use that single tile instead." },
    { id: "ml-training-serving", label: "ML Models", icon: "mlModel", desc: "Train, register, and serve models on governed data." },
    { id: "ml-model", label: "Machine Learning Model", icon: "mlModelBrand", desc: "A trained model on governed data — classification, forecasting, recommendations, and more." },
    { id: "model-training", label: "Model Training", icon: "mlflowBrand", desc: "Train + track experiments with MLflow — parameters, metrics, and artifacts, all governed." },
    { id: "mlops", label: "MLOps", icon: "mlopsBrand", desc: "The full model lifecycle — train, evaluate, register, deploy, and monitor, governed end to end." },
    // Medallion layers (orange brand marks) — used inside the SDP/pipeline block.
    { id: "bronze-layer", label: "Bronze", icon: "bronzeLayer", desc: "Raw ingested data, landed as-is." },
    { id: "silver-layer", label: "Silver", icon: "silverLayer", desc: "Cleaned, conformed, deduplicated." },
    { id: "gold-layer", label: "Gold", icon: "goldLayer", desc: "Curated, business-ready aggregates." },
    { id: "medallion-table", label: "Medallion Table", icon: "goldLayer", kind: "medallion-table",
      desc: "Bronze → Silver → Gold in one block — the medallion refinement of a governed table.",
      authoring: "The whole medallion (bronze → silver → gold) as ONE block, with the metal-toned layer marks and an internal flow. Prefer this over three separate bronze/silver/gold tiles when you just want to show the layered data itself. OPTIONS (params): `feature_store` and `metric_views` — each adds a fork off the GOLD layer (Feature Store above, Metric Views below) shown inside the block, and exposes an extra right-side OUTPUT handle so you can wire it: `@out-gold` (always), `@out-fs` (when feature_store), `@out-mv` (when metric_views).",
      options: [
        { key: "feature_store", label: "Feature store" },
        { key: "metric_views", label: "Metric views" },
      ],
      ports: { "l": "← sources / ingest", "out-gold": "→ gold output", "out-fs": "→ feature store (when enabled)", "out-mv": "→ metric views (when enabled)" } },
    { id: "feature-store", label: "Feature Store", icon: "featureStoreBrand", desc: "Governed, reusable features for training and real-time serving — consistent offline and online." },
    { id: "uc-model-registry", label: "UC Model Registry", icon: "modelRegistryBrand", desc: "Version, stage, and govern models in Unity Catalog with full lineage." },
    { id: "model-serving", label: "Model Serving Endpoint", icon: "modelServing", desc: "Serve a custom model behind a governed, autoscaling REST endpoint for real-time inference.",
      authoring: "A deployed serving endpoint (real-time inference over a custom/registered model). Use when the demo calls a live endpoint; for the train→register→batch-score story use ml-training-serving instead." },
    { id: "hosted-mcps", label: "Hosted MCPs", icon: "mcp", desc: "Managed MCP servers that let agents call external tools — Genie, Atlassian, GitHub, Slack, SharePoint, Gmail, and more.",
      authoring: "The governed tool/connector layer for agents — hosted MCP servers (Genie / Atlassian / GitHub / Slack / SharePoint / Gmail …). Use when the demo's agent reaches OUT to external systems via MCP." },
    { id: "vector-search", label: "Vector Search", icon: "vectorSearchBrand", desc: "Embeddings" },
    { id: "information-extraction", label: "Information Extraction", icon: "unstructuredData", desc: "Pull specific data points, entities, and fields from unstructured text (ai_extract)." },
    // The Agent Bricks building blocks (also surfaced inside the composite).
    { id: "document-parsing", label: "Document Parsing", icon: "inputData", desc: "Extract structured content from documents — text, tables, and metadata (ai_parse_document)." },
    { id: "text-classification", label: "Text Classification", icon: "aiFunctions", desc: "Categorize text into predefined or dynamic labels (ai_classify)." },
    { id: "genie-code", label: "Built with Genie Code", icon: "genieCodeBrand", kind: "genie-code",
      desc: "A copilot for everyone — describe what you want and Genie Code builds the pipeline, dashboard or app for you, directly on Databricks.",
      authoring: "Standalone 'describe it → Genie Code builds it' beat. Use only when NOT already using lakeflow-genie-block (which has the Genie Code footer built in)." },
  ],
  "unified-governance": [
    // Composite "Unified Governance" bar: Unity Catalog + Unity AI Gateway (all
    // foundation models) + Genie Ontology, rendered as one horizontal strip.
    { id: "governance-block", label: "Unified Governance", icon: "unityCatalogBrand", kind: "governance",
      desc: "One control plane for data + AI: Unity Catalog governs access, lineage and quality; the Unity AI Gateway governs every foundation-model call (OpenAI, Anthropic, Gemini, …); Genie Ontology is the shared semantic layer.",
      authoring: "One governance bar: Unity Catalog + Unity AI Gateway (access any model) + a live Genie Ontology graph. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature)." },
    { id: "db-platform", label: "Databricks Platform", icon: "file:vendor/databricks-wordmark", kind: "db-platform",
      desc: "The Databricks Data + AI platform — one governed foundation for all data + AI.",
      authoring: "Title banner (the Databricks wordmark). Pin it top-left, usually paired with a big background box (z:-1) wrapping everything → reads as 'all of this is the platform'." },
    { id: "unity-catalog", label: "Unity Catalog", icon: "unityCatalogBrand", desc: "One governed catalog — access, lineage, and semantics across data + AI." },
    { id: "ai-gateway", label: "Unity AI Gateway", icon: "aiGatewayBrand", desc: "Security, cost, and rate limits." },
    { id: "data-quality", label: "Data Quality", icon: "unityCatalog", desc: "Expectations and monitors keep bad data out of the gold layer." },
    { id: "abac", label: "ABAC", icon: "unityCatalog", desc: "Attribute-based access control — fine-grained, policy-driven permissions." },
    { id: "data-classification", label: "Data Classification", icon: "unityCatalog", desc: "Automatically tag and govern sensitive data." },
  ],
  "agentic-data": [
    // Composite "Lakeflow" super-block: Lakeflow Connect + Zerobus + direct
    // ingest feeding a bronze→silver→gold pipeline, with 3 left input ports.
    { id: "lakeflow-block", label: "Lakeflow", icon: "lakeflowConnectBrand", kind: "lakeflow",
      desc: "One block: managed ingest (Lakeflow Connect), real-time streams (Zerobus) and direct file landing, all flowing into a declarative bronze → silver → gold pipeline.",
      authoring: "The whole ingest + bronze→silver→gold SDP in one block (no Genie Code framing). Contains SDP — never add a separate sdp tile beside it.",
      ports: { "in-lakeflow-connect": "← databases / SaaS apps", "in-zerobus": "← realtime streams / sensors", "in-direct": "← files: PDF / CSV / Parquet", "r": "→ the compute layer" } },
    // Combined box: the Lakeflow super-block stacked over the Genie Code block.
    { id: "lakeflow-genie-block", label: "Lakeflow + Genie", icon: "lakeflowConnectBrand", kind: "lakeflow-genie",
      desc: "Lakeflow ingest + declarative pipeline, with Genie Code building and maintaining it — one box, end to end.",
      authoring: "The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it.",
      ports: { "in-lakeflow-connect": "← databases / SaaS apps", "in-zerobus": "← realtime streams / sensors", "in-direct": "← files: PDF / CSV / Parquet", "r": "→ the compute layer" } },
    { id: "lakeflow-connect", label: "Lakeflow Connect", icon: "lakeflowConnectBrand", desc: "A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems." },
    { id: "zerobus-ingest", label: "Lakeflow Zerobus", icon: "zerobus", desc: "Real-time, direct ingest of streaming events into the lakehouse." },
    { id: "sdp", label: "Lakeflow SDP", icon: "sdpBrand", desc: "Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale." },
    { id: "uc-volume", label: "UC Volume", icon: "volume", desc: "Governed file storage in Unity Catalog — where raw documents (PDFs) land." },
    { id: "lakeflow-jobs", label: "Lakeflow Jobs", icon: "lakeflowJobsBrand", sublabel: "Orchestrate anything", desc: "Orchestrate the whole pipeline on a schedule or trigger." },
    { id: "notebooks-eda", label: "Notebooks", icon: "notebooks", desc: "Interactive exploration and analysis on governed data." },
    { id: "delta-sharing", label: "Delta Sharing", icon: "deltaSharing", desc: "Open, cross-org data sharing with no copies." },
    { id: "marketplace", label: "Marketplace", icon: "deltaSharing", desc: "Discover and consume third-party data and AI assets." },
    { id: "lakebase", label: "Lakebase", icon: "lakebaseBrand", sublabel: "Serverless Postgres — instant start, branch", desc: "Managed Postgres for app state — reads/writes the live queue." },
    { id: "sql-lakehouse", label: "Lakehouse", icon: "lakehouseBrand", badge: "RT", sublabel: "~100 ms charts, thousands of concurrent users", desc: "One copy of governed data for BI + AI — real-time queries at scale (SQL Warehouse; RT = Lakehouse Real Time)." },
  ],
  // Sources are demo-authored. The catalog ships the LuxeBeauty example set so
  // the diagram reads as a complete architecture out of the box; the agent
  // REPLACES these (via the `sources` band `add` + hiding these) with the
  // demo's real systems. Each declares its `ingest` path.
  // Sources are demo-authored. The catalog ships the LuxeBeauty example set so
  // the diagram reads as a complete architecture out of the box; the agent
  // REPLACES these per demo. Third-party logos render as a name badge until the
  // trademark toggle is enabled.
  sources: [
    // Default sources are license-safe (OSS logos) + generic feeds — a clean
    // starting estate. The agent swaps in the demo's real systems (Shopify,
    // Zendesk, …) per story; those vendor logos live in the icon bank / "+ more
    // data sources" picker and the palette search.
    { id: "src-kafka", label: "Kafka", icon: "file:vendor/kafka", desc: "Streaming events ingested in real time via Zerobus." },
    { id: "src-postgres", label: "Postgres", icon: "file:vendor/postgresql", desc: "Operational database ingested via Lakeflow Connect." },
    { id: "src-sensors", label: "Sensor data", icon: "sensorSource", desc: "Real-time sensor / IoT telemetry, streamed via Zerobus." },
    { id: "src-pdf", label: "PDF documents", icon: "pdfLogo", desc: "Documents (PDFs) — landed as files on a UC Volume." },
  ],
};

/** Flat id → (catalog component + its band), built once from CATALOG. The new
 *  flat file format keys nodes by `type` = catalog id; this resolves the
 *  defaults (icon/label/desc/sublabel/badge/kind/ingest) + the band (tile
 *  color). */
const CATALOG_BY_ID: Map<string, { c: CatalogComponent; band: BandId }> = (() => {
  const m = new Map<string, { c: CatalogComponent; band: BandId }>();
  for (const band of BAND_ORDER) for (const c of CATALOG[band]) m.set(c.id, { c, band });
  return m;
})();

// =============================================================================
// Natural sizes — the canonical [w,h] each node type renders at (before any
// user resize). Single source of truth: shared.tsx `baseSize` delegates here,
// and `computeLayout` uses it to stack columns + size wrapper boxes.
// =============================================================================

/** Default annotation sizes (mirror of ANNOTATION_DEFAULT_SIZE in annotations.tsx —
 *  kept here to avoid a lib→component import cycle). */
const ANNOTATION_SIZE: Record<AnnotationVariant, { w: number; h: number }> = {
  text: { w: 160, h: 40 },
  box: { w: 180, h: 100 },
  logo: { w: 64, h: 64 },
  image: { w: 200, h: 140 },
};

/** Medallion-table footprint — grows when a fork option (`feature_store` /
 *  `metric_views`) is on: the last column becomes a vertical MV/Gold/FS stack,
 *  so it gets a bit WIDER (labels) and TALLER (one row per option). SINGLE
 *  source of truth for the medallion box — `naturalSize` (→ layout/`sizeOf`),
 *  `nodeFootprint` (the ReactFlow selection frame), and the composite render
 *  (`shared.tsx` re-exports this) all resolve through here, so symbolic layout,
 *  the resize frame, and the visual always agree. */
export function medallionSize(params?: Record<string, boolean>): { w: number; h: number } {
  const fs = !!params?.feature_store;
  const mv = !!params?.metric_views;
  if (!fs && !mv) return { w: 268, h: 96 }; // title + 3 layer marks + labels + connectors
  const forkRows = 1 + (fs ? 1 : 0) + (mv ? 1 : 0);
  return { w: 300, h: Math.max(96, 44 + forkRows * 38) };
}

/** Natural [w,h] for a file `type` (catalog id / composite kind / source /
 *  annotation variant). Mirrors shared.tsx `baseSize`. `params` is only read for
 *  a `medallion-table` (its fork options change the footprint); pass `n.params`
 *  so symbolic layout reserves the same box the node actually renders at. */
export function naturalSize(type: string, params?: Record<string, boolean>): { w: number; h: number } {
  if (ANNOTATION_TYPES.has(type as AnnotationVariant)) return ANNOTATION_SIZE[type as AnnotationVariant];
  const c = CATALOG_BY_ID.get(type)?.c;
  const kind = c?.kind;
  if (kind === "lakeflow") return { w: 224, h: 148 };
  if (kind === "lakeflow-genie") return { w: 360, h: 208 };
  if (kind === "agent-bricks") return { w: 230, h: 170 };
  if (kind === "genie-code") return { w: 360, h: 112 };
  if (kind === "governance") return { w: 580, h: 108 };
  if (kind === "db-platform") return { w: 380, h: 60 };
  if (kind === "genie-one") return { w: 230, h: 78 }; // tile; persona pill floats over the top edge
  if (kind === "medallion-table") return medallionSize(params);
  if (type === "sdp") return { w: 230, h: 112 };
  // Standard "compute / serving" tiles share ONE default footprint so they line
  // up in a column (Lakehouse, Lakebase, Model Serving, Hosted MCPs, …). 230 wide,
  // 54 tall (one grid gap shorter than the old 70). Tiles WITH a sublabel and the
  // named single-line tiles below both use it.
  if (c?.sublabel || STANDARD_TILE_TYPES.has(type)) return { w: 230, h: 54 };
  return { w: 200, h: 56 }; // plain tile + sources
}

/** Single-line catalog tiles that should default to the STANDARD compute-tile
 *  footprint (same as Lakehouse/Lakebase) so a column of them lines up, even
 *  though they carry no `sublabel`. */
const STANDARD_TILE_TYPES = new Set([
  "model-serving", "hosted-mcps",
  "ml-model", "model-training", "mlops", "feature-store", "uc-model-registry",
]);

// =============================================================================
// Build: catalog + resources.json defaults + agent override → final schema
// =============================================================================

/** The catalog as resolved bands (every component, state "active"). The render
 *  path uses `layout.nodes` for WHAT is shown; `bands` is only consulted via
 *  componentLookup (resolve a type → defaults) and for band color, so shipping
 *  the full catalog here is correct and keeps those lookups total. */
function catalogSchemaBands(): PlatformBand[] {
  return BAND_ORDER.map((bandId) => ({
    id: bandId,
    label: BAND_META[bandId].label,
    sublabel: BAND_META[bandId].sublabel,
    components: CATALOG[bandId].map((c) => ({ ...c, state: "active" as ComponentState })),
  }));
}

/** Split `"id@handle"` → `{ id, handle }`. */
function splitHandle(ref: string): { id: string; handle?: string } {
  const at = ref.indexOf("@");
  return at === -1 ? { id: ref } : { id: ref.slice(0, at), handle: ref.slice(at + 1) };
}

// =============================================================================
// computeLayout — resolve symbolic placement (columns + wraps) into pixel
// positions. Explicit `at` always wins; only nodes without `at` are placed.
// =============================================================================

const INTER_COL_GAP = 78; // x gap between the EDGES of adjacent lanes (tight — lanes hug their content)
const DEFAULT_COL_W = 200; // assumed width for a declared-but-empty lane
const ROW_GAP = 28;   // vertical gap between stacked tiles in a lane
const WRAP_PAD = 24;   // default container padding

export interface ResolvedBox { x: number; y: number; w: number; h: number }

/** Resolve every node's CENTER [x,y] (and, for wrapper boxes, its [w,h]) from
 *  the file's `columns`/`col`/`row` + `wraps`. A node with an explicit `at` is
 *  pinned there (and excluded from column stacking). Returns a map id→box.
 *
 *  Column widths are PROPORTIONAL to content: each lane is as wide as its
 *  widest node (rotation-aware), and lanes sit INTER_COL_GAP apart edge-to-
 *  edge — a narrow lane (a rotated Genie One, a persona logo) pulls its
 *  neighbours in instead of reserving a fixed-width slot. */
export function computeLayout(file: ArchitectureFile): Map<string, ResolvedBox> {
  const out = new Map<string, ResolvedBox>();
  const nodes = file.nodes ?? [];
  // On-canvas footprint: explicit `size` (or natural), with w/h SWAPPED for a
  // 90°/270° rotation — a rotated tall node is a narrow one on the canvas.
  const sizeOf = (n: FileNode): { w: number; h: number } => {
    const s = n.size ? { w: n.size[0], h: n.size[1] } : naturalSize(n.type, n.params);
    const q = (((n.rot ?? 0) % 360) + 360) % 360;
    return q === 90 || q === 270 ? { w: s.h, h: s.w } : s;
  };

  // 1) Pinned nodes (explicit `at`) — use verbatim. Wrapper boxes are resolved
  //    later (their size/pos derive from children) unless they too were pinned.
  for (const n of nodes) {
    if (Array.isArray(n.at)) {
      const s = sizeOf(n);
      out.set(n.id, { x: n.at[0], y: n.at[1], w: s.w, h: s.h });
    }
  }

  // 2) Column stacking — only non-wrapper, un-pinned nodes that declare a `col`.
  //    A node whose position is set RELATIONALLY opts out of stacking so it never
  //    reserves a ghost slot in a lane it gets pulled out of:
  //      • `leftOf`/`rightOf` → horizontal satellite: leaves the lane entirely
  //        (no lane width / no stack row).
  //      • `alignY`/`below`/`above` → its Y is external, so it must NOT take a
  //        stack row (else the remaining lane nodes stack around a phantom).
  //        It still gets its lane's X later (step 3) so it sits IN the column,
  //        just at the relationally-chosen height.
  //    (`alignX` only overrides X, so it keeps its normal stack row.)
  const cols = file.columns ?? [];
  const colIndex = new Map(cols.map((c, i) => [c, i]));
  const yRelational = (n: FileNode) => !!(n.alignY || n.below || n.above);
  const laned = nodes.filter(
    (n) =>
      !out.has(n.id) && !n.wraps && !n.leftOf && !n.rightOf && !yRelational(n) &&
      n.col && colIndex.has(n.col),
  );
  const byCol = new Map<string, FileNode[]>();
  for (const n of laned) {
    const arr = byCol.get(n.col!) ?? [];
    arr.push(n);
    byCol.set(n.col!, arr);
  }
  // Lane width = the widest node it holds (rotation-aware); lane centers are
  // cumulative so a narrow lane takes only the room it needs. The FIRST lane
  // stays centered at x=0 (the historical origin).
  const colWidth = new Map<string, number>();
  for (const [col, list] of byCol) {
    colWidth.set(col, Math.max(...list.map((n) => sizeOf(n).w)));
  }
  const colX = new Map<string, number>();
  {
    let rightEdge = 0;
    cols.forEach((c, i) => {
      const w = colWidth.get(c) ?? DEFAULT_COL_W;
      const cx = i === 0 ? 0 : rightEdge + INTER_COL_GAP + w / 2;
      colX.set(c, cx);
      rightEdge = cx + w / 2;
    });
  }
  for (const [col, list] of byCol) {
    list.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)); // stable-ish; appearance order kept for ties
    const x = colX.get(col) ?? 0;
    const heights = list.map((n) => sizeOf(n).h);
    const total = heights.reduce((s, h) => s + h, 0) + ROW_GAP * (list.length - 1);
    let cy = -total / 2; // center the stack on y=0
    list.forEach((n, i) => {
      const s = sizeOf(n);
      out.set(n.id, { x, y: cy + heights[i] / 2, w: s.w, h: s.h });
      cy += heights[i] + ROW_GAP;
    });
  }

  // 3) Any node still unplaced (no `at`, no resolvable `col`, not a wrapper) →
  //    park at origin (shouldn't happen with well-formed files).
  for (const n of nodes) {
    if (!out.has(n.id) && !n.wraps) {
      const s = sizeOf(n);
      // A y-relational node that names a real `col` keeps that lane's X (so it
      // stays IN the column at its relational height); else park at origin.
      const x = n.col && colX.has(n.col) ? colX.get(n.col)! : 0;
      out.set(n.id, { x, y: 0, w: s.w, h: s.h });
    }
  }

  // 3.5) Relational placement — position a node against ANOTHER node's box.
  //   alignX/alignY: copy the anchor's center on that axis (keep the other axis).
  //   below/above/leftOf/rightOf: butt up against the anchor's edge (+`gap`),
  //     centered on the anchor's other axis. `at` is never overridden.
  //   Resolved in dependency order so a chain (A rightOf B, B rightOf C) settles.
  //   Then TWO de-overlap passes keep the default readable without an auto-layout
  //   engine: (a) FAN-OUT — several nodes bound to the same anchor+direction
  //   spread evenly along the perpendicular axis, centered on the anchor, instead
  //   of piling on one point; (b) NUDGE — a relational node still overlapping a
  //   FIXED node (lane / `at` / box) slides along its free axis until it clears.
  //   Only relational nodes ever move; anchors and authored lane nodes stay put.
  const SIB_GAP = 24; // spacing between sibling satellites of the same anchor
  {
    // A node's single relational directive (first set wins), + which axis it
    // pins (the anchor's edge/center it copies) vs. its FREE axis (fanned/nudged).
    type Dir = "alignX" | "alignY" | "leftOf" | "rightOf" | "above" | "below";
    const DIRS: Dir[] = ["alignX", "alignY", "leftOf", "rightOf", "above", "below"];
    const dirOf = (n: FileNode): Dir | undefined => DIRS.find((d) => n[d]);
    const isRel = (n: FileNode) =>
      !Array.isArray(n.at) && !n.wraps && dirOf(n) !== undefined;
    const rels = nodes.filter(isRel);
    // Free axis = the one the relation does NOT pin, so it's safe to fan/nudge on.
    //   leftOf/rightOf/alignX pin X  → free axis is Y.
    //   above/below/alignY   pin Y  → free axis is X.
    const freeAxisOf = (d: Dir): "x" | "y" =>
      d === "leftOf" || d === "rightOf" || d === "alignX" ? "y" : "x";

    // (0) Base placement — dependency-ordered so anchors resolve first.
    const done = new Set<string>();
    const place = (n: FileNode, seen: Set<string>): void => {
      if (done.has(n.id) || seen.has(n.id)) return;
      seen.add(n.id);
      for (const d of DIRS) {
        const ref = n[d] as string | undefined;
        const dep = ref && rels.find((r) => r.id === ref);
        if (dep) place(dep, seen);
      }
      const self = out.get(n.id);
      if (!self) return;
      const gap = n.gap ?? 40;
      const a = out.get((n[dirOf(n)!] as string) ?? "");
      if (!a) { done.add(n.id); return; }
      const d = dirOf(n)!;
      if (d === "alignX") self.x = a.x;
      else if (d === "alignY") self.y = a.y;
      else if (d === "leftOf") { self.x = a.x - a.w / 2 - gap - self.w / 2; self.y = a.y; }
      else if (d === "rightOf") { self.x = a.x + a.w / 2 + gap + self.w / 2; self.y = a.y; }
      else if (d === "above") { self.y = a.y - a.h / 2 - gap - self.h / 2; self.x = a.x; }
      else if (d === "below") { self.y = a.y + a.h / 2 + gap + self.h / 2; self.x = a.x; }
      done.add(n.id);
    };
    for (const n of rels) place(n, new Set());

    // Lane-anchored nodes (`alignX`/`alignY` WITH a resolvable `col`) are lane
    // members whose free axis is owned by the lane, not free to fan — they're
    // handled by reserve-a-slot (pass b), NOT by fan-out. Compute the set up front
    // so fan-out can skip them.
    const isLaneAligned = (n: FileNode) =>
      !!(n.col && colX.has(n.col) && (n.alignX || n.alignY) &&
        !n.below && !n.above && !n.leftOf && !n.rightOf);
    const laneAligned = rels.filter(isLaneAligned);

    // (a) FAN-OUT — group siblings by (anchor, direction). Distribute each group
    //     of >1 along its free axis, centered on the anchor's center on that axis.
    //     Lane-anchored nodes are excluded (reserve-a-slot owns them).
    const groups = new Map<string, FileNode[]>();
    for (const n of rels) {
      if (isLaneAligned(n)) continue;
      const d = dirOf(n)!;
      const key = `${n[d]}|${d}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
    }
    for (const [key, sibs] of groups) {
      if (sibs.length < 2) continue;
      const anchor = out.get(key.split("|")[0]);
      if (!anchor) continue;
      const axis = freeAxisOf(dirOf(sibs[0])!);
      const ext = (b: ResolvedBox) => (axis === "y" ? b.h : b.w);
      const center = axis === "y" ? anchor.y : anchor.x;
      const boxes = sibs.map((n) => out.get(n.id)!).filter(Boolean);
      const total = boxes.reduce((s, b) => s + ext(b), 0) + SIB_GAP * (boxes.length - 1);
      let cursor = center - total / 2;
      boxes.forEach((b) => {
        const c = cursor + ext(b) / 2;
        if (axis === "y") b.y = c; else b.x = c;
        cursor += ext(b) + SIB_GAP;
      });
    }

    const relIds = new Set(rels.map((r) => r.id));
    const overlaps = (a: ResolvedBox, b: ResolvedBox) =>
      Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

    // (b) RESERVE-A-SLOT — `alignX`/`alignY` nodes that live IN a lane (`col`) are
    //     lane members pinned to an external position: they keep their slots and
    //     the lane's PLAIN (row-stacked) mates flow into the gaps around them, in
    //     row order, so the lane stays contiguous with no overlap. Handled PER
    //     LANE so several aligned nodes in one column share the same reflow (one
    //     independent re-stack per aligned node would fight the others).
    const laneGroups = new Map<string, FileNode[]>();
    for (const n of laneAligned) {
      const laneAxis = n.alignY ? "y" : "x";
      const k = `${n.col}|${laneAxis}`;
      (laneGroups.get(k) ?? laneGroups.set(k, []).get(k)!).push(n);
    }
    for (const [key, aligned] of laneGroups) {
      const laneAxis = key.split("|")[1] as "x" | "y";
      const col = key.split("|")[0];
      const ext = (b: ResolvedBox) => (laneAxis === "y" ? b.h : b.w);
      const pos = (b: ResolvedBox) => (laneAxis === "y" ? b.y : b.x);
      const setPos = (b: ResolvedBox, v: number) => { if (laneAxis === "y") b.y = v; else b.x = v; };
      // Two+ aligned nodes pointing at the SAME target (or targets closer than
      // their combined size) would pin to the same spot — spread each such
      // cluster like siblings, centered on the cluster's mean, so they don't
      // stack. (A single aligned node keeps its exact target.)
      const alignedBoxes = aligned.map((n) => out.get(n.id)!).filter(Boolean).sort((a, b) => pos(a) - pos(b));
      let ci = 0;
      while (ci < alignedBoxes.length) {
        const cluster = [alignedBoxes[ci]];
        let cj = ci + 1;
        while (cj < alignedBoxes.length &&
               pos(alignedBoxes[cj]) - pos(cluster[cluster.length - 1]) < (ext(alignedBoxes[cj]) + ext(cluster[cluster.length - 1])) / 2 + SIB_GAP) {
          cluster.push(alignedBoxes[cj]); cj++;
        }
        if (cluster.length > 1) {
          const mean = cluster.reduce((s, b) => s + pos(b), 0) / cluster.length;
          const totalC = cluster.reduce((s, b) => s + ext(b), 0) + SIB_GAP * (cluster.length - 1);
          let cur = mean - totalC / 2;
          for (const b of cluster) { setPos(b, cur + ext(b) / 2); cur += ext(b) + SIB_GAP; }
        }
        ci = cj;
      }
      // Reserved intervals = each aligned node's footprint at its (now spread)
      // pinned position (+SIB_GAP margin), sorted along the lane axis.
      const reserved = alignedBoxes
        .map((b) => ({ lo: pos(b) - ext(b) / 2 - SIB_GAP, hi: pos(b) + ext(b) / 2 + SIB_GAP }))
        .sort((a, b) => a.lo - b.lo);
      // Plain (non-relational) lane-mates in row order flow around the reserved
      // slots: walk the lane, and whenever the next mate would land inside a
      // reserved interval, jump the cursor past it.
      const mates = nodes
        .filter((m) => !relIds.has(m.id) && !m.wraps && m.col === col && out.has(m.id))
        .sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
      if (!mates.length) continue;
      // Flow mates in row order, skipping reserved slots. Run it once as a DRY
      // pass to measure the block's extent, then re-run shifted so the whole lane
      // (mates + pinned slots) is CENTERED on the lane's natural center (0) — the
      // aligned nodes stay pinned; the mates balance around them, no side-drift.
      const runFrom = (start: number, commit: boolean): { min: number; max: number } => {
        let cursor = start, min = Infinity, max = -Infinity;
        for (const m of mates) {
          const b = out.get(m.id)!;
          const e = ext(b);
          for (const r of reserved) {
            if (cursor < r.hi && cursor + e > r.lo) cursor = r.hi;
          }
          if (commit) setPos(b, cursor + e / 2);
          min = Math.min(min, cursor);
          max = Math.max(max, cursor + e);
          cursor += e + SIB_GAP;
        }
        return { min, max };
      };
      const dry = runFrom(0, false);
      const extMin = Math.min(dry.min, ...reserved.map((r) => r.lo));
      const extMax = Math.max(dry.max, ...reserved.map((r) => r.hi));
      runFrom(-((extMin + extMax) / 2), true);
    }

    // (c) NUDGE — any OTHER relational node still overlapping something slides
    //     along its free axis (away from the overlap) until clear. It de-conflicts
    //     against FIXED nodes AND against other satellites already positioned
    //     earlier in the list — only `self` moves per hit, so processing in order
    //     is asymmetric (later satellites yield to earlier ones) → no oscillation.
    //     Anchors and authored lane nodes never move. A few passes settle chains.
    const nudgeable = rels.filter((n) => !laneAligned.includes(n));
    const fixed = nodes.filter((n) => !relIds.has(n.id) && !n.wraps && out.has(n.id));
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      nudgeable.forEach((n, i) => {
        const self = out.get(n.id);
        if (!self) return;
        const axis = freeAxisOf(dirOf(n)!);
        // Obstacles = every fixed node + every satellite placed BEFORE this one.
        const obstacles = [
          ...fixed.map((f) => f.id),
          ...nudgeable.slice(0, i).map((o) => o.id),
        ].filter((oid) => oid !== n.id);
        for (const oid of obstacles) {
          const ob = out.get(oid)!;
          if (!ob || !overlaps(self, ob)) continue;
          if (axis === "y") {
            const need = (self.h + ob.h) / 2 - Math.abs(self.y - ob.y) + SIB_GAP;
            self.y += (self.y <= ob.y ? -need : need);
          } else {
            const need = (self.w + ob.w) / 2 - Math.abs(self.x - ob.x) + SIB_GAP;
            self.x += (self.x <= ob.x ? -need : need);
          }
          moved = true;
        }
      });
      if (!moved) break;
    }
  }

  // 4) Box nodes (wrappers and/or explicit `bounds`) — innermost first.
  //    `wraps` → enclose children + pad. `bounds` → place each named side at a
  //    node/column anchor (can cut halfway through a node). A box may use both:
  //    `bounds` sides win, unspecified sides fall back to the wrap rect (or 0).
  const boxes = nodes.filter((n) => (n.wraps && n.wraps.length) || n.bounds);
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parent = boxes.find((w) => w.wraps?.includes(id));
    return parent ? 1 + depth(parent.id, seen) : 0;
  };
  boxes.sort((a, b) => depth(b.id) - depth(a.id)); // deepest children first

  // Resolve a `bounds` side string → an absolute coordinate on the given axis.
  //   "<nodeId>:<anchor>"  | "col:<name>:<anchor>"  | "wrap"
  // anchor ∈ left|right|center (x axis) / top|bottom|center (y axis).
  const sideCoord = (spec: string, axis: "x" | "y"): number | undefined => {
    if (spec === "wrap") return undefined;
    if (spec.startsWith("col:")) {
      const [, name, anchor = "center"] = spec.split(":");
      const cx = colX.get(name);
      if (cx === undefined || axis !== "x") return undefined;
      // The lane's real half-extent: half its content width + half the edge gap
      // (so col:left/right cut midway between adjacent lanes).
      const half = (colWidth.get(name) ?? DEFAULT_COL_W) / 2 + INTER_COL_GAP / 2;
      return cx + (anchor === "left" ? -half : anchor === "right" ? half : 0);
    }
    const [id, anchor = "center"] = spec.split(":");
    const b = out.get(id);
    if (!b) return undefined;
    if (axis === "x") return anchor === "left" ? b.x - b.w / 2 : anchor === "right" ? b.x + b.w / 2 : b.x;
    return anchor === "top" ? b.y - b.h / 2 : anchor === "bottom" ? b.y + b.h / 2 : b.y;
  };

  for (const w of boxes) {
    if (Array.isArray(w.at)) continue; // pinned box: leave as-is
    const pad = w.pad ?? WRAP_PAD;
    // Wrap rect from children (if any) — the fallback for unspecified sides.
    const kids = (w.wraps ?? []).map((cid) => out.get(cid)).filter(Boolean) as ResolvedBox[];
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const k of kids) {
      L = Math.min(L, k.x - k.w / 2); T = Math.min(T, k.y - k.h / 2);
      R = Math.max(R, k.x + k.w / 2); B = Math.max(B, k.y + k.h / 2);
    }
    if (kids.length) { L -= pad; T -= pad; R += pad; B += pad; }
    // Override sides from explicit `bounds`.
    const bn = w.bounds;
    const left = bn?.left ? sideCoord(bn.left, "x") ?? L : L;
    const right = bn?.right ? sideCoord(bn.right, "x") ?? R : R;
    const top = bn?.top ? sideCoord(bn.top, "y") ?? T : T;
    const bottom = bn?.bottom ? sideCoord(bn.bottom, "y") ?? B : B;
    if (![left, right, top, bottom].every(Number.isFinite)) {
      out.set(w.id, { x: 0, y: 0, w: 200, h: 100 });
      continue;
    }
    // RESERVE bands for NON-float pinned children docking into this box: a top
    // pin pushes the top edge up by its height (+pad); a bottom pin extends the
    // bottom edge down. Float pins overlay and reserve nothing.
    let top2 = top, bottom2 = bottom;
    const docked = nodes.filter((n) => n.pin && !n.pin.float && !Array.isArray(n.at) && n.pin.to === w.id);
    const bandH = (vside: "top" | "bottom") => {
      const hs = docked
        .filter((n) => (n.pin!.at.startsWith("top") ? "top" : n.pin!.at.startsWith("bottom") ? "bottom" : "") === vside)
        .map((n) => sizeOf(n).h);
      return hs.length ? Math.max(...hs) + 2 * (/* band pad */ 12) : 0;
    };
    top2 -= bandH("top");
    bottom2 += bandH("bottom");
    out.set(w.id, { x: (left + right) / 2, y: (top2 + bottom2) / 2, w: right - left, h: bottom2 - top2 });
  }

  // 5) Pinned-by-anchor nodes (`pin`) — resolved LAST, after boxes are sized.
  //    Anchor against `pinTo` (a box id) or, if absent, the largest box / the
  //    overall content bounds. NON-float pins sit in their reserved band at the
  //    box edge (left/center/right by the h anchor); float pins inset inward.
  const ANCHORS: Record<string, [number, number]> = {
    "top-left": [-1, -1], top: [0, -1], "top-right": [1, -1],
    left: [-1, 0], center: [0, 0], right: [1, 0],
    "bottom-left": [-1, 1], bottom: [0, 1], "bottom-right": [1, 1],
  };
  const pinned = nodes.filter((n) => n.pin && !Array.isArray(n.at));
  if (pinned.length) {
    // Default target = the biggest box, else the bounding box of everything.
    const allBoxes = boxes.map((w) => out.get(w.id)).filter(Boolean) as ResolvedBox[];
    const biggest = allBoxes.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    let fallback = biggest;
    if (!fallback) {
      let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
      for (const b of out.values()) { L = Math.min(L, b.x - b.w / 2); T = Math.min(T, b.y - b.h / 2); R = Math.max(R, b.x + b.w / 2); B = Math.max(B, b.y + b.h / 2); }
      fallback = Number.isFinite(L) ? { x: (L + R) / 2, y: (T + B) / 2, w: R - L, h: B - T } : { x: 0, y: 0, w: 0, h: 0 };
    }
    for (const n of pinned) {
      const target = (n.pin!.to ? out.get(n.pin!.to) : undefined) ?? fallback;
      const s = sizeOf(n);
      const pad = n.pin!.pad ?? 16;
      const [ax, ay] = ANCHORS[n.pin!.at] ?? [0, 0];
      if (!n.pin!.float) {
        // Docked into a reserved band: x = left/center/right edge of the box
        // (inset by half size + pad); y = the band centre at the box edge
        // (the box already grew to make room, so it sits BELOW/ABOVE content).
        const x = target.x + ax * (target.w / 2 - s.w / 2 - pad);
        const y = target.y + ay * (target.h / 2 - s.h / 2 - 12);
        out.set(n.id, { x, y, w: s.w, h: s.h });
        continue;
      }
      // Inset by half the node size + pad so the node sits INSIDE the corner.
      const x = target.x + ax * (target.w / 2 - s.w / 2 - pad);
      const y = target.y + ay * (target.h / 2 - s.h / 2 - pad);
      out.set(n.id, { x, y, w: s.w, h: s.h });
    }
  }

  return out;
}

/** Parse the flat ArchitectureFile into the internal PlatformSchema the canvas
 *  consumes. `bands` = the full catalog (for lookup/color); `layout.nodes` =
 *  exactly the placed nodes from the file; `layout.edges` = the file edges. */
/** Pull the symbolic placement fields off a file node, or undefined if it has
 *  none (→ the node is pinned to pixels). */
function pickPlacement(n: FileNode): NodePosition["placement"] | undefined {
  const p: NonNullable<NodePosition["placement"]> = {};
  if (n.col !== undefined) p.col = n.col;
  if (n.row !== undefined) p.row = n.row;
  if (n.alignX !== undefined) p.alignX = n.alignX;
  if (n.alignY !== undefined) p.alignY = n.alignY;
  if (n.below !== undefined) p.below = n.below;
  if (n.above !== undefined) p.above = n.above;
  if (n.leftOf !== undefined) p.leftOf = n.leftOf;
  if (n.rightOf !== undefined) p.rightOf = n.rightOf;
  if (n.gap !== undefined) p.gap = n.gap;
  // Container / pin fields — a box or pinned banner MUST keep these symbolic, or
  // it flattens to a frozen `at`+`size` (children escape the box, banners drift).
  if (n.wraps !== undefined) p.wraps = n.wraps;
  if (n.pad !== undefined) p.pad = n.pad;
  if (n.bounds !== undefined) p.bounds = n.bounds;
  if (n.pin !== undefined) p.pin = n.pin;
  return Object.keys(p).length ? p : undefined;
}

export function parseArchitecture(content: string): PlatformSchema {
  const file = parseArchitectureFile(content) ?? {};
  const nodes: Record<string, NodePosition> = {};

  // Resolve symbolic placement (columns + wraps) → pixel positions. Explicit
  // `at` wins; this fills in the rest + sizes wrapper boxes.
  const placed = computeLayout(file);
  // file node id → the canvas node id we store under (catalog nodes may be
  // re-keyed to `type`), and its resolved box — used for edge-handle inference.
  const fileToNode = new Map<string, string>();
  const boxOf = new Map<string, ResolvedBox>();

  for (const n of file?.nodes ?? []) {
    if (!n?.id || !n.type) continue;
    const box = placed.get(n.id) ?? { x: 0, y: 0, ...naturalSize(n.type) };
    const [x, y] = [box.x, box.y];
    const st = n.style ?? {};
    // A container box's size is derived by computeLayout (from `wraps` and/or
    // `bounds`); otherwise an explicit `size` wins (a plain node keeps its
    // natural size → no w/h stored).
    const derivedSize = (n.wraps || n.bounds) && !n.size ? [box.w, box.h] as [number, number] : n.size;
    // Preserve symbolic placement for round-trip. A node authored WITHOUT `at`
    // that carries symbolic fields (col/relational/wraps/bounds/pin) is un-`pinned`:
    // on save it re-emits those fields (not `at`) unless the user drags it. A node
    // authored WITH `at`, or with no symbolic fields at all, is pinned to pixels.
    const placement = pickPlacement(n);
    const pinned = Array.isArray(n.at) || !placement;
    const pos: NodePosition = {
      x: x ?? 0,
      y: y ?? 0,
      ...(placement ? { placement } : {}),
      ...(pinned ? { pinned: true } : {}),
      ...(n.params && Object.keys(n.params).length ? { params: n.params } : {}),
      ...(n.stack && n.stack > 1 ? { stack: n.stack } : {}),
      ...(n.rot !== undefined ? { rot: n.rot } : {}),
      ...(derivedSize ? { w: derivedSize[0], h: derivedSize[1] } : {}),
      ...(n.scale !== undefined ? { scale: n.scale } : {}),
      ...(n.z !== undefined ? { z: n.z } : {}),
      ...(n.group !== undefined ? { groupId: n.group } : {}),
      ...(n.label !== undefined ? { label: n.label } : {}),
      ...(n.desc !== undefined ? { desc: n.desc } : {}),
      ...(n.showDesc !== undefined ? { showDesc: n.showDesc } : {}),
      ...(n.icon !== undefined ? { icon: n.icon } : {}),
      ...(st.opacity !== undefined ? { opacity: st.opacity } : {}),
      ...(st.fill !== undefined ? { fillColor: st.fill } : {}),
      ...(st.font !== undefined ? { fontColor: st.font } : {}),
      ...(st.icon !== undefined ? { iconColor: st.icon } : {}),
      ...(st.border !== undefined ? { borderWidth: st.border } : {}),
      ...(st.borderStyle !== undefined ? { borderStyle: st.borderStyle } : {}),
      ...(st.borderColor !== undefined ? { borderColor: st.borderColor } : {}),
      ...(st.radius !== undefined ? { borderRadius: st.radius } : {}),
      ...(st.shadow !== undefined ? { shadow: st.shadow } : {}),
    };

    if (ANNOTATION_TYPES.has(n.type as AnnotationVariant)) {
      // Free-form annotation node (box/text/logo/image).
      pos.annotation = {
        variant: n.type as AnnotationVariant,
        ...(n.text !== undefined ? { text: n.text } : {}),
        ...(n.title !== undefined ? { title: n.title } : {}),
        ...(n.titleIcon !== undefined ? { titleIcon: n.titleIcon } : {}),
        ...(n.fontSize !== undefined ? { fontSize: n.fontSize } : {}),
        ...(n.bold !== undefined ? { bold: n.bold } : {}),
        ...(n.vAlign !== undefined ? { vAlign: n.vAlign } : {}),
        ...(n.hAlign !== undefined ? { hAlign: n.hAlign } : {}),
        ...(n.sized !== undefined ? { sized: n.sized } : {}),
        ...(n.textWrap !== undefined ? { textWrap: n.textWrap } : {}),
        ...(n.icon !== undefined ? { icon: n.icon } : {}),
        ...(n.caption !== undefined ? { caption: n.caption } : {}),
        ...(n.desc !== undefined ? { desc: n.desc } : {}),
        ...(n.showDesc !== undefined ? { showDesc: n.showDesc } : {}),
        ...(n.src !== undefined ? { src: n.src } : {}),
      };
    } else if (n.type === "source") {
      // A data source: carry its logo key + icon so flow-mapping renders it via
      // the canvas-added-source path. The Lakeflow ingest port it feeds is set
      // by the edge handle (`@in-zerobus` / `@in-direct` / `@in-lakeflow-connect`).
      const key = (n.icon ?? "").replace(/^file:.*\//, "").replace(/^file:/, "").toLowerCase() || baseId(n.id).replace(/^src-/, "");
      pos.source = { key, icon: (n.icon ?? "inputData") as IconKey };
      if (n.label !== undefined) pos.label = n.label;
      // Source label placement (right default | left | top | bottom). Reuse the
      // shared FileNode `caption`; ignore the legacy logo values (side/below).
      if (n.caption === "right" || n.caption === "left" || n.caption === "top" || n.caption === "bottom") {
        pos.sourceCaption = n.caption;
      }
      // Source label size (reuse the shared FileNode `fontSize`).
      if (n.fontSize !== undefined) pos.fontSize = n.fontSize;
    }
    // else: a catalog component. flow-mapping resolves it by baseId(node id), so
    // the node id MUST baseId-resolve to `type`. The file id usually IS the type
    // (or `type#2` for a duplicate); fall back to `type` if it doesn't resolve.
    let nodeId = n.id;
    if (!ANNOTATION_TYPES.has(n.type as AnnotationVariant) && n.type !== "source" && baseId(n.id) !== n.type) {
      nodeId = n.type;
    }
    nodes[nodeId] = pos;
    fileToNode.set(n.id, nodeId);
    boxOf.set(n.id, box);
  }

  // Edge-handle inference: when `from`/`to` carry no explicit `@handle`, derive
  // it from geometry. To target a specific Lakeflow ingest PORT, the edge must
  // name it explicitly (`@in-lakeflow-connect` / `@in-zerobus` / `@in-direct`) —
  // there is no source-ingest-based port inference.
  const inferHandles = (sId: string, tId: string): { sh?: string; th?: string } => {
    const sb = boxOf.get(sId), tb = boxOf.get(tId);
    if (!sb || !tb) return {};
    const dx = tb.x - sb.x, dy = tb.y - sb.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? { sh: "r", th: "l" } : { sh: "l", th: "r" };
    }
    return dy >= 0 ? { sh: "b", th: "t" } : { sh: "t", th: "b" };
  };

  const edges: PlatformEdge[] = (file?.edges ?? []).map((e, i) => {
    const s = splitHandle(e.from);
    const t = splitHandle(e.to);
    const inf = (!s.handle || !t.handle) ? inferHandles(s.id, t.id) : {};
    const sourceHandle = s.handle ?? inf.sh;
    const targetHandle = t.handle ?? inf.th;
    return {
      id: e.id ?? `e-${s.id}-${t.id}-${i}`,
      source: fileToNode.get(s.id) ?? s.id,
      target: fileToNode.get(t.id) ?? t.id,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
      animated: !!e.flow,
      ...(e.dashed ? { dashed: true } : {}),
      ...(e.shape ? { shape: e.shape } : {}),
      ...(e.flowStyle ? { flowStyle: e.flowStyle } : {}),
      ...(e.arrow && e.arrow !== "auto" ? { arrow: e.arrow } : {}),
      ...(typeof e.centerX === "number" ? { centerX: e.centerX } : {}),
      ...(e.label ? { label: e.label } : {}),
    };
  });

  const customLogos: Record<string, string> = {};
  for (const c of file?.custom_logos ?? []) {
    if (c?.id && typeof c.svg === "string") customLogos[c.id] = c.svg;
  }

  return {
    name: file?.name ?? "Solution architecture",
    story: file?.story,
    enableTrademarkLogos: file?.options?.trademarkLogos ?? false,
    ...(file?.columns?.length ? { columns: file.columns } : {}),
    bands: catalogSchemaBands(),
    layout: { nodes, edges, hidden: [] },
    ...(Object.keys(customLogos).length ? { customLogos } : {}),
  };
}

/** The raw global catalog as bands — every component with its CATALOG label /
 *  icon / desc, with NO per-project overrides merged in. The library palette
 *  (left menu) renders from this so it always shows the canonical component
 *  set, not a demo's story-tied relabels (e.g. a demo renaming Genie Room must
 *  not change what the palette calls it). `state` is omitted — the palette only
 *  needs id/label/icon/desc. */
export function catalogBands(): { id: BandId; label: string; sublabel?: string; components: CatalogComponent[] }[] {
  return BAND_ORDER.map((bandId) => ({
    id: bandId,
    label: BAND_META[bandId].label,
    sublabel: BAND_META[bandId].sublabel,
    components: [...CATALOG[bandId]],
  }));
}

// =============================================================================
// Node id helper
// =============================================================================

/** A canvas node id is `<componentId>` or, for an extra placement of the same
 *  component, `<componentId>#2`, `#3`, … `baseId` recovers the catalog
 *  component id from any node/layout/edge id. */
export function baseId(nodeId: string): string {
  const h = nodeId.indexOf("#");
  return h === -1 ? nodeId : nodeId.slice(0, h);
}

/** Inline custom-logo icon keys: `custom:<id>` → renders `customLogos[id]`. */
export function isCustomIconKey(key: string | undefined): key is string {
  return typeof key === "string" && key.startsWith("custom:");
}
export function customLogoId(key: string): string {
  return key.slice("custom:".length);
}

// =============================================================================
// Parse — pull the flat ArchitectureFile JSON out of architecture.md
// =============================================================================

/** Extract the flat file JSON from architecture.md (fenced ```json block or a
 *  bare top-level object). Returns null if absent/unparseable — the caller
 *  then renders an empty canvas. (`parseArchitecture` wraps this into a
 *  PlatformSchema.) */
export function parseArchitectureFile(content: string): ArchitectureFile | null {
  try {
    const block = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const raw = block ? block[1].trim() : content.trim();
    if (!raw.startsWith("{")) return null;
    return JSON.parse(raw) as ArchitectureFile;
  } catch {
    return null;
  }
}

// =============================================================================
// Multi-tab — the top-level file is an ARRAY of architectures (one per tab).
// This layer sits ABOVE the single-architecture parse/serialize: it splits the
// array into per-tab bodies (each a bare JSON object the existing
// parseArchitecture consumes) and joins them back into one fenced array.
// =============================================================================

/** One tab: a display `name` + `body` — the single-architecture JSON string
 *  (fenced, exactly what serializeArchitecture emits) that the existing
 *  parse/serialize pipeline round-trips. */
export interface ArchitectureTab {
  name: string;
  body: string;
}

/** Extract the raw top-level value (array OR single object) from architecture.md
 *  — unwrapping the ```json fence when present. Returns the parsed JS value, or
 *  null if absent/unparseable. */
function parseTopLevel(content: string): unknown {
  try {
    const block = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const raw = (block ? block[1] : content).trim();
    if (!raw.startsWith("[") && !raw.startsWith("{")) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Detect the LEGACY architecture format (the pre-flat-file schema, replaced by
 *  the interactive editor). The old format nested nodes INSIDE column objects
 *  (`columns: [{ nodes: [...], bars: [...] }, …]`) and had no top-level `nodes`;
 *  the new flat format has `columns` as a list of lane-name STRINGS plus a
 *  top-level `nodes` array. So a file is legacy iff any tab's `columns` holds
 *  OBJECTS rather than strings (with a secondary tell: no top-level `nodes`).
 *  Returns false for empty/unparseable/new-format content — we only flag a file
 *  we're confident is the old shape. */
export function isLegacyArchitectureFormat(content: string): boolean {
  const top = parseTopLevel(content ?? "");
  if (top == null) return false;
  const objs: unknown[] = Array.isArray(top) ? top : [top];
  return objs.some((o) => {
    if (!o || typeof o !== "object") return false;
    const rec = o as { columns?: unknown; nodes?: unknown };
    // New format: columns is string[] AND nodes is a top-level array.
    const cols = rec.columns;
    const legacyColumns =
      Array.isArray(cols) && cols.length > 0 && typeof cols[0] === "object" && cols[0] !== null;
    const missingFlatNodes = !Array.isArray(rec.nodes);
    // Only OBJECT columns is a hard tell; missing flat nodes alone could be a
    // blank/partial file, so require the column shape.
    return legacyColumns && missingFlatNodes;
  });
}

/** Split architecture.md into tabs. A top-level ARRAY → one tab per element; a
 *  single OBJECT → one tab (auto-wrap, so existing single-architecture files
 *  keep working). Each tab's `body` is that element re-stringified as a fenced
 *  ```json object, so it feeds straight into parseArchitecture. Empty/absent →
 *  a single blank tab so there's always at least one. */
export function parseArchitectureTabs(content: string): ArchitectureTab[] {
  const top = parseTopLevel(content ?? "");
  const objs: ArchitectureFile[] = Array.isArray(top)
    ? (top as ArchitectureFile[])
    : top && typeof top === "object"
      ? [top as ArchitectureFile]
      : [];
  if (objs.length === 0) return [{ name: "Architecture", body: "" }];
  return objs.map((obj, i) => ({
    name: (typeof obj?.name === "string" && obj.name.trim()) || `Architecture ${i + 1}`,
    body: "```json\n" + JSON.stringify(obj, null, 2) + "\n```\n",
  }));
}

/** Join per-tab bodies (each the fenced ```json a tab's serializeArchitecture
 *  produced) into ONE fenced ```json ARRAY — the on-disk multi-tab format. */
export function serializeArchitectureTabs(bodies: string[]): string {
  const objs = bodies.map((b) => parseArchitectureFile(b) ?? {});
  return "```json\n" + JSON.stringify(objs, null, 2) + "\n```\n";
}

// =============================================================================
// Serialize — write the editor's live layout back into the flat file format
// =============================================================================

/** Map a NodePosition's optional visual overrides into the flat `style` object
 *  (only the keys that are actually set). */
function styleOf(pos: NodePosition): FileNode["style"] | undefined {
  const s: NonNullable<FileNode["style"]> = {};
  if (pos.borderWidth !== undefined) s.border = pos.borderWidth;
  if (pos.borderStyle !== undefined) s.borderStyle = pos.borderStyle;
  if (pos.borderColor !== undefined) s.borderColor = pos.borderColor;
  if (pos.borderRadius !== undefined) s.radius = pos.borderRadius;
  if (pos.shadow !== undefined) s.shadow = pos.shadow;
  if (pos.fillColor !== undefined) s.fill = pos.fillColor;
  if (pos.fontColor !== undefined) s.font = pos.fontColor;
  if (pos.iconColor !== undefined) s.icon = pos.iconColor;
  if (pos.opacity !== undefined) s.opacity = pos.opacity;
  return Object.keys(s).length ? s : undefined;
}

/** Build the architecture.md string from the live layout. Walks layout.nodes
 *  (the source of truth for what's placed) → flat `nodes`, and layout.edges →
 *  compact `from`/`to@handle` edges. Only emits overrides that differ from the
 *  catalog default. The `schema` carries name/story/trademark + the catalog. */
export function serializeArchitecture(
  schema: PlatformSchema,
  layout: PlatformLayout,
): string {
  const nodes: FileNode[] = [];
  for (const [id, pos] of Object.entries(layout.nodes)) {
    // Positional fragment: a node the user never moved (un-`pinned`) with symbolic
    // `placement` re-emits those authored fields so the file keeps its structure;
    // anything pinned (dragged, or authored with `at`) serializes as pixel `at`.
    const at: [number, number] = [Math.round(pos.x), Math.round(pos.y)];
    const pl = pos.placement;
    const symbolic = !pos.pinned && !!pl;
    // A symbolic container (box with `wraps`/`bounds`) is NOT `pinned`; it re-emits
    // its container fields and computeLayout re-derives its size — so we must NOT
    // also emit a frozen `size` for it (that would stop it reflowing).
    const isSymbolicBox = symbolic && !!(pl!.wraps?.length || pl!.bounds);
    const place: Partial<FileNode> =
      symbolic
        ? {
            ...(pl!.col !== undefined ? { col: pl!.col } : {}),
            ...(pl!.row !== undefined ? { row: pl!.row } : {}),
            ...(pl!.alignX !== undefined ? { alignX: pl!.alignX } : {}),
            ...(pl!.alignY !== undefined ? { alignY: pl!.alignY } : {}),
            ...(pl!.below !== undefined ? { below: pl!.below } : {}),
            ...(pl!.above !== undefined ? { above: pl!.above } : {}),
            ...(pl!.leftOf !== undefined ? { leftOf: pl!.leftOf } : {}),
            ...(pl!.rightOf !== undefined ? { rightOf: pl!.rightOf } : {}),
            ...(pl!.gap !== undefined ? { gap: pl!.gap } : {}),
            ...(pl!.wraps !== undefined ? { wraps: pl!.wraps } : {}),
            ...(pl!.pad !== undefined ? { pad: pl!.pad } : {}),
            ...(pl!.bounds !== undefined ? { bounds: pl!.bounds } : {}),
            ...(pl!.pin !== undefined ? { pin: pl!.pin } : {}),
          }
        : { at };
    const common: Partial<FileNode> = {
      ...(pos.w !== undefined && pos.h !== undefined && !isSymbolicBox ? { size: [pos.w, pos.h] as [number, number] } : {}),
      ...(pos.rot ? { rot: pos.rot } : {}),
      ...(pos.scale !== undefined && pos.scale !== 1 ? { scale: pos.scale } : {}),
      ...(pos.z ? { z: pos.z } : {}),
      ...(pos.groupId ? { group: pos.groupId } : {}),
      ...(pos.params && Object.keys(pos.params).length ? { params: pos.params } : {}),
      ...(pos.stack && pos.stack > 1 ? { stack: pos.stack } : {}),
    };
    const style = styleOf(pos);

    if (pos.annotation) {
      const a = pos.annotation;
      nodes.push({
        id, type: a.variant, ...place, ...common,
        ...(a.text !== undefined ? { text: a.text } : {}),
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.titleIcon !== undefined ? { titleIcon: a.titleIcon as IconKey } : {}),
        ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
        ...(a.bold !== undefined ? { bold: a.bold } : {}),
        ...(a.vAlign !== undefined ? { vAlign: a.vAlign } : {}),
        ...(a.hAlign !== undefined ? { hAlign: a.hAlign } : {}),
        ...(a.sized !== undefined ? { sized: a.sized } : {}),
        ...(a.textWrap !== undefined ? { textWrap: a.textWrap } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        ...(a.caption !== undefined ? { caption: a.caption } : {}),
        ...(a.desc !== undefined ? { desc: a.desc } : {}),
        ...(a.showDesc !== undefined ? { showDesc: a.showDesc } : {}),
        ...(a.src !== undefined ? { src: a.src } : {}),
        ...(style ? { style } : {}),
      });
      continue;
    }
    if (pos.source) {
      nodes.push({
        id, type: "source", ...place, ...common,
        // label: `undefined` → OMIT (stays auto-derived on reload); `""` →
        // EMIT (user deliberately cleared it → renders nothing).
        ...(pos.label !== undefined ? { label: pos.label } : {}),
        icon: (pos.icon ?? pos.source.icon) as IconKey,
        ...(pos.sourceCaption !== undefined ? { caption: pos.sourceCaption } : {}),
        ...(pos.fontSize !== undefined ? { fontSize: pos.fontSize } : {}),
        ...(pos.desc !== undefined ? { desc: pos.desc } : {}),
        ...(pos.showDesc !== undefined ? { showDesc: pos.showDesc } : {}),
        ...(style ? { style } : {}),
      });
      continue;
    }
    // Catalog component: type = its base id. Emit label/desc/icon only when
    // they differ from the catalog default.
    const type = baseId(id);
    const def = CATALOG_BY_ID.get(type)?.c;
    nodes.push({
      id, type, ...place, ...common,
      ...(pos.label !== undefined && pos.label !== def?.label ? { label: pos.label } : {}),
      ...(pos.desc !== undefined && pos.desc !== def?.desc ? { desc: pos.desc } : {}),
      ...(pos.showDesc !== undefined ? { showDesc: pos.showDesc } : {}),
      ...(pos.icon !== undefined && pos.icon !== def?.icon ? { icon: pos.icon } : {}),
      ...(style ? { style } : {}),
    });
  }

  const edges: FileEdge[] = layout.edges.map((e) => {
    const from = e.sourceHandle ? `${e.source}@${e.sourceHandle}` : e.source;
    const to = e.targetHandle ? `${e.target}@${e.targetHandle}` : e.target;
    return {
      id: e.id, from, to,
      ...(e.animated ? { flow: true } : {}),
      ...(e.arrow && e.arrow !== "auto" ? { arrow: e.arrow } : {}),
      ...(e.dashed ? { dashed: true } : {}),
      ...(e.shape && e.shape !== "smooth" ? { shape: e.shape } : {}),
      ...(e.flowStyle ? { flowStyle: e.flowStyle } : {}),
      ...(typeof e.centerX === "number" ? { centerX: e.centerX } : {}),
      ...(e.label ? { label: e.label } : {}),
    };
  });

  // Round-trip custom logos: keep every `custom:<id>` an emitted node references.
  const usedCustom = new Set<string>();
  for (const n of nodes) {
    if (isCustomIconKey(n.icon)) usedCustom.add(customLogoId(n.icon));
  }
  const custom_logos = [...usedCustom]
    .map((id) => ({ id, svg: schema.customLogos?.[id] }))
    .filter((c): c is { id: string; svg: string } => typeof c.svg === "string");

  const out: ArchitectureFile = {
    name: schema.name,
    ...(schema.story ? { story: schema.story } : {}),
    ...(schema.enableTrademarkLogos ? { options: { trademarkLogos: true } } : {}),
    // Re-emit the lane declaration: symbolic `col` refs on un-pinned nodes are
    // meaningless without it, so dropping it (as the old serializer did) made a
    // single drag collapse every remaining symbolic node to the origin.
    ...(schema.columns?.length ? { columns: schema.columns } : {}),
    ...(custom_logos.length ? { custom_logos } : {}),
    nodes,
    edges,
  };
  return "```json\n" + JSON.stringify(out, null, 2) + "\n```\n";
}

// =============================================================================
// Deployed-resource deep-link resolution
// =============================================================================

/** Resolve the live workspace URL for a component, if its backing resource
 *  has been deployed. Mirrors the Summary tab's capability→deployed_type join
 *  (CAPABILITY_META.deployed_type vs DeployedResourceLink.resource_type). */
export function resolveDeepLink(
  component: PlatformComponent,
  deployed: DeployedResourceLink[] | undefined,
): string | null {
  if (!deployed?.length) return null;
  const slug = component.capability ?? component.id;
  const meta = CAPABILITY_META[slug];
  if (!meta?.deployed_type) return null;
  const types = Array.isArray(meta.deployed_type) ? meta.deployed_type : [meta.deployed_type];
  for (const t of types) {
    const hit = deployed.find((d) => d.resource_type === t && d.url);
    if (hit?.url) return hit.url;
  }
  return null;
}
