/**
 * Platform Architecture Schema + Catalog
 * =======================================
 *
 * The file format is a FLAT graph: `architecture.md` holds a ```json block with
 * just `nodes` (the components shown on the canvas) + `edges` (the lines between
 * them). A node is on the canvas iff it's listed in `nodes` — there is no
 * state / hidden / bands in the file.
 *
 *   { name, story, aspect, theme?, direction?, rowGap?, options?, nodes: [...], edges: [...] }
 *   node:  { id, type, at:[x,y], size?, rot?, scale?, z?, group?,
 *            label?, desc?, icon?, style?:{border,shadow,radius,fill,…} }
 *   edge:  { id?, from:"<id>[@handle]", to:"<id>[@handle]", flow?, arrow?, … }
 *
 * `type` is a CATALOG component id (which folds in the composite "kind"), or one
 * of the special kinds source / box / text / logo / image / note / callout / shape.
 * A source→Lakeflow edge names its ingest PORT through the target handle
 * (`@in-zerobus` etc.); there is no separate `ingest` field. The CATALOG below is
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
import { flattenTree, isNestedFile, nestTree, nestedIssues, type TreeMeta } from "./arch-layout";
import { isFlatArchitectureFile, migrateToNested } from "./arch-migrate";

/** An icon reference: a built-in DatabricksIconName, a file-icon key like
 *  "file:vendor/kafka" / "file:cloud/aws/storage/s3", or a generic glyph
 *  `lucide:<name>` (see LUCIDE_GLYPH_NAMES). The `& {}` keeps autocomplete for
 *  the known built-ins while allowing any of the others. */
export type IconKey = DatabricksIconName | (string & {});

/** Generic line-icon glyphs, addressed as `lucide:<name>` wherever an icon key
 *  resolves (cards, logos, sources, box title icons). The renderer maps each name
 *  to a lucide-react component; this list is the source of truth the skill
 *  catalog prints, and the renderer's map is typed against it. */
export const LUCIDE_GLYPH_NAMES = [
  "sparkles", "list-checks", "database", "server", "cloud", "file", "file-text",
  "folder", "user", "users", "lock", "key", "shield", "bell", "mail", "globe",
  "cpu", "zap", "workflow", "git-branch", "table", "bar-chart-3", "line-chart",
  "pie-chart", "layers", "box", "package", "settings", "terminal", "code",
  "message-square", "bot", "brain", "search", "filter", "clock", "calendar",
  "alert-triangle", "check-circle", "webhook", "radio", "activity", "smartphone",
  "monitor", "building-2", "network", "hard-drive", "gauge", "scale", "rocket",
] as const;
export type LucideGlyphName = (typeof LUCIDE_GLYPH_NAMES)[number];

/** Where an official Databricks line pictogram (`file:databricks-line/<slug>`) is
 *  the better choice for a generic glyph's concept. The `lucide:` key keeps its
 *  rendering; the skill catalog tells the agent to prefer the official key. */
export const LUCIDE_OFFICIAL_PREFERENCE: Partial<Record<LucideGlyphName, string>> = {
  "message-square": "chat",
  "server": "server",
  "table": "delta-table",
  "webhook": "webhook",
  "users": "3-people",
  "calendar": "scheduled-jobs",
  "brain": "machine-learning",
  "gauge": "observable-metrics",
  "zap": "speed",
  "lock": "enterprise-security",
};
const LUCIDE_KEY_PREFIX = "lucide:";

/** True for a `lucide:<name>` key (any name — an unknown one renders a fallback). */
export function isLucideIconKey(key: string | undefined | null): key is string {
  return typeof key === "string" && key.startsWith(LUCIDE_KEY_PREFIX);
}

/** The glyph name of a `lucide:<name>` key, or null when it is not one of the
 *  curated LUCIDE_GLYPH_NAMES. */
export function lucideGlyphName(key: string | undefined | null): LucideGlyphName | null {
  if (!isLucideIconKey(key)) return null;
  const name = key.slice(LUCIDE_KEY_PREFIX.length);
  return (LUCIDE_GLYPH_NAMES as readonly string[]).includes(name) ? (name as LucideGlyphName) : null;
}

import { CAPABILITY_META } from "./capabilities";
import type { DeployedResourceLink } from "./custom-api";
import { cardBodySource, decodeBodyText, diagramHtmlMeta, parseDiagramHtml, pxOf, type BodyNode } from "./card-body";

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
  /** Catalog-only: this component is DEPRECATED. It still parses and renders
   *  (existing diagrams keep working), but it is hidden from the library palette,
   *  left out of the generated skill catalog, and shows a "Deprecated" marker on
   *  the canvas in edit mode. `replacedBy` names the catalog id to use instead. */
  deprecated?: boolean;
  replacedBy?: string;

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
  /** TYPICAL WIRING — what this component consumes/depends on, so the agent
   *  draws realistic edges (not invented ones). Each entry: the upstream `from`
   *  (a catalog id, or a plain-text concept like "streaming events" when the
   *  source is external), an `action` verb ("reads from" / "queried by" /
   *  "syncs with" / "routes to" …), and `optional` — omitted = the NORMAL /
   *  typical wiring (draw it when the component is present); `optional: true` =
   *  a clearly-optional edge the agent adds only when the story calls for it.
   *  (We DON'T mark edges "required/mandatory" — too strong; a plain entry is
   *  the sensible default, `optional` is the only annotation.) Emitted into the
   *  skill catalog. Catalog-only; not used at render time. */
  wiring?: { from: string; action?: string; optional?: boolean }[];
  /** Optional toggleable PARAMS a component exposes. Each renders as a checkbox
   *  in the right edit panel; enabled values live on the NODE as `params`
   *  (NodePosition.params → the flat file's `params`). A composite reads
   *  `d.params?.<key>` to render conditionally (e.g. the medallion table shows a
   *  Feature Store / Metric Views fork when enabled). General — any component
   *  can declare options; the panel + round-trip are shared. */
  options?: ComponentOption[];
}

/** One component param, rendered in the edit panel's "Options" section. A
 *  `boolean` option (default) is a checkbox; a `text` option is a text input.
 *  Both round-trip through `node.params[key]` — the panel + serialize are
 *  generic, so declaring an option here makes it appear + persist automatically
 *  (no per-component wiring). */
export interface ComponentOption {
  /** Stored under `node.params[key]`. */
  key: string;
  /** Label in the edit panel (checkbox label, or the text input's field label). */
  label: string;
  /** "boolean" (checkbox, default) or "text" (single-line input). */
  type?: "boolean" | "text";
  /** boolean options only: default when the node has no explicit value (false). */
  default?: boolean;
  /** text options only: input placeholder (hint the expected content). */
  placeholder?: string;
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
export type CompositeKind = "lakeflow" | "genie-code" | "governance" | "lakeflow-genie" | "databricks-agent" | "db-platform" | "genie-one" | "medallion-table" | "ai-gateway" | "multi-source";

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

export type PresentationAspect = "16:9" | "1:1";
export type ArchitectureTheme = "slide" | "technical";
export type DiagramDirection = "horizontal" | "vertical" | "matrix";

/** The theme a diagram gets when its JSON declares none. A diagram that sets
 *  `theme` in its file always wins (either value round-trips); this is only the
 *  fallback for an absent field. `resolveTheme` is the single place the fallback
 *  lives — parse, layout, and the grid path all go through it so the default
 *  can't drift between them. `serializeArchitecture` omits the field iff it
 *  equals this, so the on-disk file stays clean for default diagrams. */
export const DEFAULT_THEME: ArchitectureTheme = "technical";
export function resolveTheme(theme: string | undefined): ArchitectureTheme {
  return theme === "slide" || theme === "technical" ? theme : DEFAULT_THEME;
}

export interface PlatformSchema {
  name: string;
  /** One-line framing shown under the title (optional, agent-authored). */
  story?: string;
  /** The intended shape. Measured on the composed FRAME when `frame` is set,
   *  else on the node union. Never an export-padding request either way. */
  aspect?: PresentationAspect;
  /** Presentation frame (title/subtitle bands). Round-trips verbatim; the
   *  on-canvas band nodes are DERIVED from it (see FRAME_NODE_IDS). */
  frame?: FrameSpec;
  /** Visual preset. `slide` is the presentation-first default. */
  theme: ArchitectureTheme;
  /** Intended reading direction; wide solution flows default horizontal. */
  direction: DiagramDirection;
  /** When true, third-party SaaS/vendor source logos render as their real
   *  (trademarked) brand marks. Default false → they render as a neutral
   *  text badge instead. Cloud (AWS/GCP/Azure) + Databricks marks are always
   *  shown regardless (they don't need this opt-in). */
  enableTrademarkLogos?: boolean;
  /** Edge-label chip font size in px (`options.edgeLabelSize`). Unset → the
   *  EDGE_LABEL_FONT default. Scales the pill in the renderer AND the solver. */
  edgeLabelSize?: number;
  /** The declared left→right lane names (the file's top-level `columns`). Kept
   *  on the schema so it ROUND-TRIPS: symbolic `col` refs are meaningless without
   *  it, so serialize must re-emit it even after a node is dragged/pinned. */
  columns?: string[];
  /** Shared-row-grid opt-in (file-level `rowGrid`), kept on the schema so it
   *  round-trips like `columns`. See ArchitectureFile.rowGrid. */
  rowGrid?: boolean;
  /** Vertical gap between authored rows/stacks; presentation tuning escape hatch. */
  rowGap?: number;
  bands: PlatformBand[];
  /** Canvas layout — node positions + edges. Persisted by the interactive
   *  editor; auto-seeded by band when absent. */
  layout: PlatformLayout;
  /** Inline custom SVG logos, keyed by id. A node references one via
   *  `icon: "custom:<id>"`. Threaded to the renderers via CustomLogosContext. */
  customLogos?: Record<string, string>;
  /** The tab's numbered-callout legend, carried VERBATIM from the file so it
   *  round-trips. The on-canvas box (`LEGEND_NODE_ID`) is derived from it. */
  legend?: LegendSpec;
  /** A nested file's tree record (lib/arch-layout.ts): save re-nests the flat nodes
   *  with it, so the file keeps its structure through UI edits. */
  tree?: TreeMeta;
}

// -- Interactive-canvas layout (positions + edges) ---------------------------

export interface NodePosition {
  x: number;
  y: number;
  /** The node's catalog component id (`FileNode.type`) — the SOURCE OF TRUTH for
   *  which component this is (label/icon/desc/ports resolve from it). Carried
   *  verbatim from the file so `id` can be a free-form instance handle
   *  (`id` need NOT equal `type`). For annotation nodes it's the variant
   *  (`box`/`text`/`logo`/`image`) and for a data source it's `"source"`. */
  type: string;
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
  /** AI reasoning (never rendered) — see FileNode.ai_reasoning. Carried so it
   *  survives the RF round-trip on save. */
  ai_reasoning?: string;
  /** Link to the real resource — see FileNode.url. */
  url?: string;
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
  /** box: the title strip's fill (hex) — `style.headerFill` in the file. */
  headerFill?: string;
  iconColor?: string;      // logo SVG recolor (hex); unset → icon's own color
  /** Border styling. borderWidth 0 = no border. */
  borderWidth?: number;    // px
  borderStyle?: "solid" | "dashed";
  borderColor?: string;    // hex
  borderRadius?: number;   // px corner radius
  shadow?: number | boolean; // drop-shadow intensity 0–100 (legacy boolean ok)
  /** Stacking order (bring to front / send to back). Default 0. */
  z?: number;
  /** RENDER-ONLY default z for a wrapping box (behind its children), derived
   *  from nesting depth so a box never needs a hand-set `z`. Never serialized
   *  (explicit `z` is; this is recomputed on parse). `z` overrides it. */
  autoZ?: number;
  /** A canvas-added data source (from "+ more data sources"). Stores just the
   *  logo-catalog key + icon; label defaults come from the unified
   *  logo-catalog.json. Present only for such nodes. The Lakeflow ingest port a
   *  source feeds is carried on the EDGE handle (`@in-zerobus`, `@in-direct`,
   *  `@in-lakeflow-connect`), not here. */
  source?: { key: string; icon: IconKey };
  /** multi-source group: the listed source systems (see FileNode.sources).
   *  Round-trips verbatim so the block's rows survive save. */
  sources?: MultiSourceItem[];
  /** Source tiles only: label placement relative to the icon (right default |
   *  left | top | bottom). Persisted via the shared FileNode `caption`. */
  sourceCaption?: "right" | "left" | "top" | "bottom";
  /** DERIVED lane-uniform width (computeLayout step 2.5) for a captioned
   *  logo/source in a same-lane group — every member gets the widest member's
   *  width so the cards match + icons align. NOT serialized (recomputed on
   *  parse); flow-mapping + the render honor it over the label-fitted width. */
  laneW?: number;
  /** DERIVED title font for a title-only card in a same-size group (cardGroupFonts). Not persisted. */
  cardFont?: number;
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
  /** Whether the description WRAPS to multiple lines instead of truncating on one
   *  line. `true` = wrap (the box auto-grows taller to fit the wrapped lines);
   *  absent/false = the default single-line truncate. */
  wrapDesc?: boolean;
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
    /** Container box: the authored `size` as a MINIMUM [w, h] (the box is never
     *  smaller; it grows to fit its members). Re-emitted as `size` on save. */
    minSize?: [number, number];
    /** Per-side box edge anchors. */
    bounds?: { left?: string; right?: string; top?: string; bottom?: string };
    /** Corner dock for a banner/persona inside a box. */
    pin?: {
      at: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right" | "above" | "below";
      to?: string; pad?: number; float?: boolean; fill?: boolean;
    };
  };
  /** True once the user has manually positioned this node (dragged it, or it was
   *  authored with an explicit `at`). A pinned node serializes as `at`; an
   *  un-pinned node with `placement` re-emits its symbolic fields. */
  pinned?: boolean;
  /** Component options (round-trips to the file's `params`). Values are usually
   *  BOOLEAN toggles (e.g. the medallion's `feature_store`/`metric_views` forks),
   *  but a param may also be a STRING when an option carries text — e.g. the
   *  medallion's `bronze_desc`/`silver_desc`/`gold_desc` layer captions. See
   *  PlatformComponent.options. */
  params?: Record<string, boolean | string>;
  /** Render this node as a STACK of N cards (N-1 blank offset copies peeking out
   *  the bottom-right of the front card) to signal "many of these" — e.g. deploy
   *  N apps. 1 or absent = a single normal card. Works on any node kind. */
  stack?: number;
}

/** Where a `box`'s title sits. `border` (default) = the small title straddling the
 *  top border. The others put it INSIDE the box: `top`/`top-left` along the top
 *  edge, `bottom`/`bottom-left` along the bottom edge (centred or left-aligned).
 *  Inside placements reserve their band, so wrapped members never sit under it. */
export const BOX_TITLE_POSITIONS = ["border", "top", "top-left", "bottom", "bottom-left"] as const;
export type BoxTitlePos = (typeof BOX_TITLE_POSITIONS)[number];

/** A free-form canvas annotation — not a Databricks catalog component. One node
 *  kind with several variants; all props persist in the layout. */
export type AnnotationVariant = "text" | "box" | "logo" | "image" | "note" | "callout" | "shape" | "card" | "html";

/** A `card` chip: a full-width outlined row (`CK tenant_gid`). `key` renders bold
 *  in the chip colour; `value` is the rest. Both wrap, never truncate. */
export interface CardChip {
  key?: string;
  value: string;
  color?: string;
}

/** A `card` tag: a small pill. A bare string is a neutral pill. */
export type CardTag = string | { text: string; color?: string };

/** The flowchart shape vocabulary for `variant:"shape"`. Geometry lives in
 *  `platform-diagram/shape-geometry.ts` (pure, unit-tested); the union is mirrored
 *  here so the file-format types don't depend on the component module (this file's
 *  only component import is the type-only `DatabricksIconName`). */
export type ShapeKind =
  | "rectangle" | "rounded" | "ellipse" | "diamond" | "triangle"
  | "parallelogram" | "hexagon" | "cylinder" | "document" | "chevron";

export interface AnnotationData {
  variant: AnnotationVariant;
  /** shape: which flowchart symbol to draw (default "rounded" = a process step).
   *  Only meaningful when `variant === "shape"`. */
  shape?: ShapeKind;
  /** text/box/shape: the (editable) text. */
  text?: string;
  /** box: an optional title bar across the top of the box. Empty by default
   *  (invisible — but double-clicking where it would be lets you edit it). */
  title?: string;
  /** box: an icon key rendered before the title text (e.g. a small Databricks
   *  logo for the "Databricks Workspace" preset). */
  titleIcon?: string;
  /** text/box: font size in px (default 14). */
  fontSize?: number;
  /** box: a grey subtitle line under the title (`title` + `subtitle` = a group
   *  header; the title strip grows so members never sit under it). Also the
   *  frame band's second line under `text`, sized by `subtitleFontSize`. */
  subtitle?: string;
  subtitleFontSize?: number;
  /** box: where the title/subtitle sit (see BOX_TITLE_POSITIONS). Unset = `border`. */
  titlePos?: BoxTitlePos;
  /** card: the body — sanitized HTML (see lib/card-body). The ONLY body field written;
   *  `summary`/`desc`/`chips`/`tags` are read on parse and folded into it. */
  body?: string;
  /** @deprecated card: legacy fields, converted to `body` on parse. */
  summary?: string;
  chips?: CardChip[];
  tags?: CardTag[];
  /** card / box: small dark pill overlapping the top-right corner. */
  badge?: string;
  /** card / box: the badge fill. Default `CARD_BADGE_COLOR`. */
  badgeColor?: string;
  /** card: accent colour → border + header band tint. Default neutral. */
  accent?: string;
  /** card: title colour. Default `CARD_TITLE_COLOR`. */
  titleColor?: string;
  /** card: whole-card background (hex). Replaces the white body and the header
   *  tint, so a solid-coloured card reads as one block. */
  fill?: string;
  /** card: ink (hex) for the title, summary and description. `titleColor` still
   *  wins for the title. Chips and tags keep their own colours. */
  textColor?: string;
  /** html: the free-form HTML body (sanitized at render by sanitizeDiagramHtml). The
   *  block is transparent unless `style` frames it; its height is measured from this. */
  html?: string;
  /** html: inner padding (px) of the frame, when the frame is styled. */
  padding?: number;
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

// -- Numbered callouts + the step legend -------------------------------------

/** Default fill/ink for a `callout` (the big numbered circle). Databricks red
 *  with white ink; `style.fill` / `style.font` override per node. */
export const CALLOUT_FILL = "#FF3621";
export const CALLOUT_INK = "#FFFFFF";
/** A callout's number sits at this fraction of the circle's diameter, so the
 *  digit scales when the circle is resized (an explicit `fontSize` wins). */
export const CALLOUT_FONT_RATIO = 0.42;

/** Where a tab's legend is surfaced. `diagram` = an on-canvas box (exported
 *  with the PNG/SVG); `panel` = the readable Legend panel only (the canvas stays
 *  clean, and is the default); `both` = both surfaces. */
export type LegendShow = "diagram" | "panel" | "both";

export interface LegendItem {
  /** The marker that ties this line to its callout / edge number ("1", "D2").
   *  Omitted → auto-numbered by position (1, 2, 3 …). */
  n?: string;
  text: string;
}

/** The tab-level legend: the sentences behind the numbered callouts. ONE source
 *  of truth — the on-canvas box and the Legend panel both render from this, so
 *  toggling `show` never rewrites the diagram's nodes. */
export interface LegendSpec {
  /** Heading (rendered on the on-canvas box's top border + above the panel). */
  title?: string;
  /** Default "panel" so narrative prose never silently enlarges an export. */
  show?: LegendShow;
  /** On-canvas font size (px). Default LEGEND_DEFAULT_FONT — deliberately much
   *  larger than a tile label: this is the one block a reader reads as PROSE
   *  while looking at the whole diagram, so it has to survive being scaled to
   *  fit a slide. */
  fontSize?: number;
  /** On-canvas box width (px). Omitted → the diagram's own content width. */
  width?: number;
  /** Explicit on-canvas CENTER position. Omitted → centred under the content. */
  at?: [number, number];
  /** A plain string is auto-numbered; `{n, text}` sets the marker explicitly. */
  items: (string | LegendItem)[];
}

/** The synthesized on-canvas legend node's id. It is DERIVED from `legend` —
 *  never part of `nodes`, never serialized back as a node. */
export const LEGEND_NODE_ID = "__legend";
export const LEGEND_DEFAULT_FONT = 20;

// -- Presentation FRAME ------------------------------------------------------
//
// WHY THIS EXISTS. `aspect` was gated against the NODE UNION, which is the wrong
// rectangle. Measured on seven Databricks deck slides judged good, a slide is a STACK OF FULL-WIDTH BANDS and
// the node ribbon is only ONE of them: the exemplar node bands occupy just
// 10-41% of canvas height, the rest being title / legend / detail bands. Their
// node ribbons run 2.15-3.61:1 (a pure process spine hit 17.8:1) while the
// CANVAS sits at 1.77-1.91:1. So a union-based 16:9 gate rejects the exact shape
// professional diagrams use, and the only lever an author has to satisfy it is
// injected whitespace — which is precisely the regression this replaces.
//
// The frame is DERIVED like the legend (see LEGEND_NODE_ID): band nodes are
// synthesized in parseArchitecture, live inside `.react-flow` so the tight-crop
// export picks them up for free, and are skipped by flowToLayout +
// serializeArchitecture so they never round-trip as real nodes.
/** Ids of the synthesized frame band nodes. DERIVED from `frame` — never part of
 *  `nodes`, never serialized back. */
export const FRAME_TITLE_NODE_ID = "__frameTitle";
export const FRAME_NODE_IDS: readonly string[] = [FRAME_TITLE_NODE_ID];
/** Derived ids that must never persist. Extend this, not the call sites. */
export function isDerivedNodeId(id: string): boolean {
  return id === LEGEND_NODE_ID || FRAME_NODE_IDS.includes(id);
}
/** Exemplar canvas ratios were 1.77-1.91 (mean 1.862) — NOT 16:9 (1.778). We keep
 *  16:9/1:1 as the declared targets but measure the FRAME, and the 12% tolerance
 *  comfortably admits the observed band. If that tolerance ever tightens, centre
 *  it on ~1.86 rather than 1.78. */
export const FRAME_TITLE_FONT = 44;
export const FRAME_SUBTITLE_FONT = 28;
/** Gap between the title band and the content below it. */
const FRAME_TITLE_GAP = 48;
/** Exemplar title bands ran 14-25% of canvas height (n=2, hand-measured). */
const FRAME_TITLE_MIN_H = 96;

/** Tab-level presentation frame. When present, `assessPresentationAspect`
 *  measures the composed frame (title band + node ribbon + legend band) instead
 *  of the bare node union. Round-trips verbatim like `legend`. */
export interface FrameSpec {
  /** Deck-style heading rendered above the ribbon, inside the export. */
  title?: string;
  /** Optional second line under the title. */
  subtitle?: string;
  /** Title/subtitle font sizes (px). Default FRAME_TITLE_FONT / _SUBTITLE_FONT. */
  titleFontSize?: number;
  subtitleFontSize?: number;
  /** Set false to keep `frame` metadata while suppressing the rendered band
   *  (still switches the gate to frame measurement). Default true. */
  show?: boolean;
}

/** Rendered height of the title band, or 0 when there is nothing to draw. */
export function frameTitleMetrics(
  spec: FrameSpec | undefined,
): { h: number; titleFont: number; subtitleFont: number } | null {
  if (!spec || spec.show === false) return null;
  const hasTitle = !!spec.title?.trim();
  const hasSub = !!spec.subtitle?.trim();
  if (!hasTitle && !hasSub) return null;
  const titleFont = Math.max(12, Math.round(spec.titleFontSize ?? FRAME_TITLE_FONT));
  const subtitleFont = Math.max(10, Math.round(spec.subtitleFontSize ?? FRAME_SUBTITLE_FONT));
  // Line boxes at ~1.3em, plus breathing room, floored so a title band always
  // reads as a band rather than a stray label.
  const lines = (hasTitle ? Math.round(titleFont * 1.3) : 0) + (hasSub ? Math.round(subtitleFont * 1.35) : 0);
  return { h: Math.max(FRAME_TITLE_MIN_H, lines + 24), titleFont, subtitleFont };
}

/** Narrowest on-canvas legend box; also the fallback when there's no content. */
const LEGEND_MIN_WIDTH = 760;
/** Inner padding of the on-canvas legend box (must clear the box's own 8px). */
const LEGEND_PAD = 18;
/** Vertical gap between the diagram content and an auto-placed legend. */
const LEGEND_GAP = 120;

/** Normalize `items` → `{n, text}[]`, auto-numbering any entry without an `n`.
 *  Auto-numbering counts EVERY entry, so mixing explicit and implicit markers
 *  stays predictable (entry 3 is "3" unless it says otherwise). */
export function legendEntries(spec: LegendSpec | undefined): LegendItem[] {
  if (!spec?.items?.length) return [];
  return spec.items
    .map((it, i): LegendItem | null => {
      const item = typeof it === "string" ? { text: it } : it;
      const text = (item?.text ?? "").trim();
      if (!text) return null;
      return { n: item.n?.trim() || String(i + 1), text };
    })
    .filter((x): x is LegendItem => x !== null);
}

/** Is `where` an INTENDED home for this legend? `"diagram"` is the real gate (it
 *  decides whether the on-canvas box is synthesized). The Legend PANEL is offered
 *  for any legend that has entries — it's chrome, it costs nothing, and it's the
 *  only way to read a `show:"panel"` legend — so the canvas gates that button on
 *  `legendEntries().length`, not on this. */
export function legendShows(spec: LegendSpec | undefined, where: "diagram" | "panel"): boolean {
  if (!spec || !legendEntries(spec).length) return false;
  const show = spec.show ?? "panel";
  return show === "both" || show === where;
}

/** Geometry + text for the ON-CANVAS legend box. Pure (no DOM) so `computeLayout`
 *  and the tests can size the box the same way the render does.
 *
 *  The box CLIPS its overflow, so the line-count estimate errs TALL: the glyph
 *  advance is deliberately wider than a real average, and a slack row is added.
 *  A legend that's a little roomy reads fine; a clipped one loses content. */
export function legendBoxMetrics(
  spec: LegendSpec,
  contentWidth?: number,
): { w: number; h: number; fontSize: number; text: string } {
  const fontSize = Math.max(10, Math.round(spec.fontSize ?? LEGEND_DEFAULT_FONT));
  const w = Math.max(LEGEND_MIN_WIDTH, Math.round(spec.width ?? contentWidth ?? LEGEND_MIN_WIDTH));
  const entries = legendEntries(spec);
  // ~0.56em per glyph vs the ~0.5 real average → fewer chars per line → the line
  // count (and so the height) is over-estimated. See the docblock.
  const charW = fontSize * 0.56;
  const usable = Math.max(120, w - LEGEND_PAD * 2 - 16);
  const perLine = Math.max(12, Math.floor(usable / charW));
  const lineH = fontSize * 1.5;
  let lines = 0;
  for (const e of entries) lines += Math.max(1, Math.ceil(`${e.n}. ${e.text}`.length / perLine));
  const h = Math.round(LEGEND_PAD * 2 + (lines + 1) * lineH);
  const text = entries.map((e) => `${e.n}. ${e.text}`).join("\n");
  return { w, h, fontSize, text };
}

// -- Rich CARD + box subtitle (content-driven height) ------------------------
//
// A `card` is a catalog-style tile that carries its own text: a header band (icon
// + title), a bold summary, a grey description, outlined chips and pill tags. Its
// HEIGHT is not authored — it is measured from the text by `cardLayout`, which
// the layout (sizeOf / naturalSize) and the ReactFlow box both call, so stacking
// and wrapping always reserve the height the card draws.
//
// Nothing ellipsizes: every text block wraps. The wrap estimate uses a per-glyph
// advance calibrated just above the measured average (GLYPH_EM), so a card is
// close to its drawn height without under-counting lines. inspect-arch's CLIPPED
// TEXT check catches any real overrun (each text block is `overflow:hidden` at its
// measured height, so an underestimate shows up as scrollHeight > clientHeight).
//
// A card whose only text is a TITLE (no summary/desc/chips/tags) is a centred
// label: the icon + title sit in the middle of the whole card, with no header band
// or divider, so a plain labelled box ("Workspace assets") reads as one.

export const CARD_WIDTH = 300;
const CARD_MIN_W = 120;
/** Usable minimum height of an empty card (and the box height a title-only label
 *  fits into when the card sets no `h`). */
const CARD_MIN_H = 56;
export const CARD_TITLE_COLOR = "#0F172A";
export const CARD_BADGE_COLOR = "#1F7A6E";
/** Neutral border used when a card has no `accent`. */
export const CARD_NEUTRAL_BORDER = "#CBD5E1";

const CARD_PAD_X = 12;
/** Card border: 1px on each side of the box, and the 1.5px top + bottom in the
 *  content height (the border is part of the border-box). */
const CARD_BORDER_PX = 1;
const CARD_BORDER_ALLOWANCE = 3;
const CARD_HEADER_PAD_Y = 8;
const CARD_BODY_PAD_Y = 10;
/** Card header / pictogram square (px). Sized for slide distance (was 22). */
export const CARD_ICON = 26;
const CARD_ICON_GAP = 8;
/** Card typography defaults — tuned so a card reads at slide distance. */
export const CARD_TITLE_FONT = 16;
/** Title-only (centred label) auto-fit range, px, and the box height it fits
 *  into when the card sets no `h`. See `cardLabelFont`. */
export const CARD_LABEL_MIN_FONT = 13;
export const CARD_LABEL_MAX_FONT = 28;
const CARD_LABEL_MAX_LINES = 2;
const CARD_LABEL_FIT_FRAC = 0.85;
export const CARD_LABEL_DEFAULT_H = CARD_MIN_H;
/** Body (HTML) text: the default font the body draws at, and its line height. The
 *  estimate also takes an explicit `font-size` inside the body (the largest wins). */
export const CARD_BODY_FONT = 13;
const CARD_BODY_LINE = 1.35;
/** Line height of the title / label text (line-box = font × this). */
const CARD_TITLE_LINE = 1.25;
/** Indentation reserved per body line for ul/ol markers, so lists never under-count. */
const LIST_INDENT_PX = 16;
const CARD_BODY_BLOCK_GAP = 3;
const CARD_BADGE_FONT = 10;
/** Badge pill width estimate: glyph advance (em) for UPPERCASE text, the pill's
 *  horizontal padding, its hard cap, and the clearance the title-only label keeps
 *  from a badge. The header keeps a smaller gap (CARD_BADGE_HEADER_GAP). */
const CARD_BADGE_GLYPH_EM = 0.72;
const CARD_BADGE_PAD = 18;
const CARD_BADGE_MAX_W = 150;
const CARD_BADGE_CLEAR = 10;
const CARD_BADGE_HEADER_GAP = 6;
/** Glyph advance in em for wrapped text — regular and bold. Calibrated against
 *  real wrapped line counts in the headless viewer (DM Sans and the system stack,
 *  164 blocks at the card's sizes and widths): the measured mean is ~0.50 / ~0.53
 *  em, and these sit a few percent above it so a block is never UNDER-counted.
 *  The only block that under-counts is a pathological all-caps-W title; no
 *  uniform constant below 0.66 clears it either. */
const GLYPH_EM = { regular: 0.54, bold: 0.58 } as const;
/** Uppercase pill tags (MERGE / APPEND) are wider than running text, so they keep
 *  the conservative bold advance — tightening it would under-count tag rows. */
const TAG_GLYPH_EM = 0.66;

/** Greedy word-wrap LINE COUNT for `text` at `maxPx` (estimated glyph advance).
 *  Words longer than a line break by character. Newlines start a new paragraph.
 *  Pure, shared by the card + box-subtitle metrics. 0 for empty text. */
export function wrapLineCount(text: string, maxPx: number, fontPx: number, bold = false, softBreaks = false): number {
  const t = (text ?? "").trim();
  if (!t) return 0;
  const adv = fontPx * (bold ? GLYPH_EM.bold : GLYPH_EM.regular);
  const perLine = Math.max(1, Math.floor(maxPx / adv));
  let total = 0;
  for (const para of t.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { total += 1; continue; }
    let lines = 1;
    let cur = 0;
    // One breakable unit of text. `spaced` = a space separates it from the
    // previous unit (a word's first piece); the later pieces of a soft-broken word
    // join with no space, so a line can end right after `_` / `.` / `/`.
    const place = (len: number, spaced: boolean) => {
      const add = cur === 0 ? len : len + (spaced ? 1 : 0);
      if (cur > 0 && cur + add > perLine) { lines += 1; cur = 0; }
      if (len > perLine) {
        // Hard-break a unit longer than a whole line. An unbroken identifier (a table
        // name: underscores, digits) runs wider than prose, so it breaks at the
        // TAG_GLYPH_EM advance — fewer characters per line, never an under-count.
        const wordPerLine = Math.max(1, Math.floor(maxPx / (fontPx * TAG_GLYPH_EM)));
        const extra = Math.ceil(len / wordPerLine);
        lines += extra - 1;
        cur = len - (extra - 1) * wordPerLine;
        return;
      }
      cur = cur === 0 ? len : cur + (spaced ? 1 : 0) + len;
    };
    for (const word of words) {
      const pieces = softBreaks ? softBreakPieces(word) : [word];
      pieces.forEach((piece, i) => place(piece.length, i === 0));
    }
    total += lines;
  }
  return total;
}

/** Split an unbroken word at the points a long identifier can wrap: after a
 *  separator (`_ . / - :`) and at a lowercase→UPPERCASE camel boundary. The pieces
 *  rejoin to the original word exactly. A word with no such point is one piece.
 *  The card renderer inserts a `<wbr>` between pieces, and `wrapLineCount`'s
 *  soft mode measures the same pieces, so the drawn line count matches the
 *  reserved height. */
export function softBreakPieces(word: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const c = word[i];
    const n = word[i + 1];
    if ("_./-:".includes(c) || (/[a-z]/.test(c) && /[A-Z]/.test(n))) {
      out.push(word.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < word.length) out.push(word.slice(start));
  return out.length ? out : [word];
}

/** The text fields a card reads (a subset of AnnotationData / FileNode). `body` is the
 *  HTML body; the legacy fields are folded into it by cardBodySource. */
export interface CardContent {
  title?: string;
  /** Explicit title size (px). Unset → the card default (header) or the
   *  auto-fit label size (title-only card). */
  fontSize?: number;
  icon?: string;
  body?: string;
  summary?: string;
  desc?: string;
  chips?: CardChip[];
  tags?: CardTag[];
  badge?: string;
}

/** A card's measured geometry. Every section height is the EXACT height the
 *  renderer gives that block (it sets `height` + `overflow:hidden` from these),
 *  so the drawn card and the reserved box are the same by construction. */
export interface CardLayout {
  w: number;
  h: number;
  /** Header band height (0 when the card has neither a title nor an icon). */
  headerH: number;
  /** Title block height (lines × line-height) — inside the header. */
  titleH: number;
  /** Badge pill width (0 when none) — the header reserves it on the right. */
  badgeW: number;
  /** Body section height (padding included). 0 when the card has no body. */
  bodyH: number;
  /** Vertical padding of the body band (top and bottom). */
  bodyPadY: number;
  /** Inner width the body text wraps at. */
  innerW: number;
  /** True for a title-only card: the icon + title are centred in the whole card
   *  (no header band), and `titleH` is the only text block. */
  centered: boolean;
  /** Horizontal inset of the centred label (wider than CARD_PAD_X when a badge
   *  is reserved on both sides so the text stays centred). */
  padX: number;
  /** Title font (px) the renderer draws the title at. */
  titleFont: number;
}

/** Title-only auto-fit: the largest title size in [CARD_LABEL_MIN_FONT,
 *  CARD_LABEL_MAX_FONT] at which the title wraps to at most CARD_LABEL_MAX_LINES AND
 *  its block stays within CARD_LABEL_FIT_FRAC of the inner box height. Never wider than `contentW` (the
 *  wrap is measured at that width). Pure and shared by cardLayout and the renderer.
 *  Monotone: a larger box never gives a smaller size (feasibility only grows with
 *  width and height). Steps of 0.5px. */
export function cardLabelFont(title: string, contentW: number, innerH: number): number {
  for (let f = CARD_LABEL_MAX_FONT; f > CARD_LABEL_MIN_FONT; f -= 0.5) {
    const lines = wrapLineCount(title, contentW, f, true, true);
    // The bound uses the SAME line height cardLayout draws (CARD_TITLE_LINE), so the
    // drawn block never exceeds the fit. The 0.85 fraction (was 0.7) lets a 2-line
    // label use more of the box.
    if (lines <= CARD_LABEL_MAX_LINES && lines * f * CARD_TITLE_LINE <= CARD_LABEL_FIT_FRAC * innerH) return f;
  }
  return CARD_LABEL_MIN_FONT;
}

/** Tags that break a line of body text (block boundaries). Inline tags (span, b, …) flow. */
const BODY_BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p", "div", "li", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "hr", "br",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
]);
const FLEX_GRID_DISPLAY: ReadonlySet<string> = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
/** Default size of a heading (px) when the body sets none: it renders larger than text. */
const HEADING_FONT: Record<string, number> = { h1: 18, h2: 16, h3: 14, h4: 14 };
/** Table cell padding + border allowance per row (px), when the cell sets none. */
const TABLE_ROW_PAD = 2;

/** Height of a body's HTML at `innerW`, estimated from its parsed tree. ONE estimator for
 *  cards and html blocks. Errs TALL (wide glyph advance, block gaps): an underestimate
 *  would clip, an overestimate only leaves air. Each line is measured at ITS font (the
 *  element's inline font-size, a heading's default, else CARD_BODY_FONT); list items lose
 *  the list indent; tables lay their cells into columns; flex/grid containers lay their
 *  cells into tracks; a block with padding reserves its inset. Pure. */
export function cardBodyContentH(html: string, innerW: number): number {
  const meta = diagramHtmlMeta(html);
  return bodyNodesH(parseDiagramHtml(html), innerW, CARD_BODY_FONT, meta.bold);
}

/** One measured line of body text: its text, the font it is set at, and whether it is a list item. */
interface BodyLine { text: string; font: number; list: boolean; nowrap: boolean }

function bodyNodesH(nodes: BodyNode[], width: number, font: number, bold: boolean, list = false): number {
  const lines: BodyLine[] = [];
  let buf = "";
  let bufFont = 0;
  // `white-space:nowrap` (inherited) keeps the text on one line: the renderer never wraps
  // it, so counting wrapped rows would reserve a taller box than is drawn.
  let bufNowrap = false;
  let boxes = 0;
  const flush = (list: boolean) => {
    const t = buf.replace(/\s+/g, " ").trim();
    if (t) lines.push({ text: t, font: bufFont || font, list, nowrap: bufNowrap });
    buf = "";
    bufFont = 0;
    bufNowrap = false;
  };
  const walk = (ns: BodyNode[], f: number, inList: boolean, nowrap = false) => {
    for (const n of ns) {
      if (n.text !== undefined) {
        const t = decodeBodyText(n.text);
        if (t.trim()) { bufFont = Math.max(bufFont, f); if (nowrap) bufNowrap = true; }
        buf += t;
        continue;
      }
      const tag = n.tag ?? "";
      if (tag === "br") { flush(inList); continue; }
      const block = BODY_BLOCK_TAGS.has(tag);
      const ins = bodyInsets(n.style);
      // A table, a flex/grid container, or a BLOCK with padding is a box: its own height.
      if (tag === "table" || isFlexGrid(n.style) || (block && (ins.h > 0 || ins.v > 0))) {
        flush(inList);
        boxes += boxH(n, width, f, bold, inList);
        continue;
      }
      const own = pxOf(n.style["font-size"]) ?? HEADING_FONT[tag];
      const nf = own ?? f;
      const nl = inList || tag === "li";
      const ws = (n.style["white-space"] ?? "").toLowerCase();
      const nw = ws ? ws === "nowrap" || ws === "pre" : nowrap;
      if (block) flush(inList);
      walk(n.kids, nf, nl, nw);
      if (block) flush(inList);
    }
  };
  walk(nodes, font, list);
  flush(list);
  if (!lines.length) return boxes;
  let h = 0;
  for (const l of lines) {
    const rows = l.nowrap ? 1 : Math.max(1, wrapLineCount(l.text, width - (l.list ? LIST_INDENT_PX : 0), l.font, bold, true));
    h += rows * l.font * CARD_BODY_LINE;
  }
  return Math.ceil(h) + lines.length * CARD_BODY_BLOCK_GAP + boxes;
}

function boxH(n: BodyNode, width: number, font: number, bold: boolean, list: boolean): number {
  if (n.tag === "table") return tableH(n, width, font, bold);
  const ins = bodyInsets(n.style);
  const inner = Math.max(1, width - ins.h);
  const content = isFlexGrid(n.style)
    ? flexGridH(n, inner, font, bold)
    : bodyNodesH(n.kids, inner, font, bold, list);
  return content + ins.v;
}

/** Height of a table at `width`: rows of cells, the columns share the width equally, a row
 *  is as tall as its tallest cell. */
function tableH(n: BodyNode, width: number, font: number, bold: boolean): number {
  const sections = n.kids.flatMap((k) => (k.tag === "tr" ? [k] : k.tag === "thead" || k.tag === "tbody" || k.tag === "tfoot" ? k.kids.filter((r) => r.tag === "tr") : []));
  const rows = sections.map((r) => r.kids.filter((c) => c.tag === "td" || c.tag === "th"));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const colW = Math.max(1, width / cols);
  let total = 0;
  for (const cells of rows) {
    let rowH = 0;
    for (const c of cells) rowH = Math.max(rowH, bodyNodesH([c], colW, font, bold));
    total += rowH + TABLE_ROW_PAD;
  }
  return total;
}

function isFlexGrid(style: Record<string, string>): boolean {
  return FLEX_GRID_DISPLAY.has((style.display ?? "").toLowerCase());
}

/** Horizontal (h) and vertical (v) padding of a body element, px. Shorthand + longhands. */
function bodyInsets(style: Record<string, string>): { h: number; v: number } {
  const box = { top: 0, right: 0, bottom: 0, left: 0 };
  const p = style.padding?.trim().split(/\s+/).map((x) => pxOf(x) ?? 0);
  if (p?.length) {
    const [t, r = t, b = t, l = r] = p;
    Object.assign(box, { top: t, right: r, bottom: b, left: l });
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const v = pxOf(style[`padding-${side}`]);
    if (v !== undefined) box[side] = v;
  }
  return { h: box.left + box.right, v: box.top + box.bottom };
}

/** Height of a flex/grid container at `width`: cells laid into tracks (columns), a row
 *  is as tall as its tallest cell, rows separated by the row gap. */
function flexGridH(n: BodyNode, width: number, font: number, bold: boolean): number {
  const s = n.style;
  const cells = n.kids.filter((k) => k.tag !== undefined || (k.text ?? "").trim() !== "");
  if (!cells.length) return 0;
  const colGap = pxOf(s["column-gap"] ?? s.gap) ?? 0;
  const rowGap = pxOf(s["row-gap"] ?? s.gap) ?? 0;
  const isGrid = (s.display ?? "").toLowerCase().includes("grid");
  let tracks: number[];
  if (isGrid) tracks = gridTrackWidths(s["grid-template-columns"], width, colGap);
  else if ((s["flex-direction"] ?? "").toLowerCase().startsWith("column")) tracks = [width];
  else tracks = Array.from({ length: cells.length }, () => Math.max(1, (width - colGap * (cells.length - 1)) / cells.length));
  const cols = tracks.length;
  let total = 0;
  let rows = 0;
  for (let i = 0; i < cells.length; i += cols) {
    let rowH = 0;
    for (let c = 0; c < cols && i + c < cells.length; c++) {
      rowH = Math.max(rowH, bodyNodesH([cells[i + c]], tracks[c], font, bold));
    }
    total += rowH;
    rows++;
  }
  return total + rowGap * (rows - 1);
}

/** Track widths (px) for a `grid-template-columns` value at `width`. Supports px, %, fr,
 *  auto, `repeat(N, …)` and `repeat(auto-fill|auto-fit, minmax(Npx, …))`. Anything else
 *  counts as one fr. No template → one column. */
function gridTrackWidths(template: string | undefined, width: number, gap: number): number[] {
  const parts = expandTracks(template ?? "", width, gap);
  if (!parts.length) return [width];
  let fixed = 0;
  let weight = 0;
  // A track is either fixed px or a share (fr) of what is left after the fixed ones.
  const spec: Array<{ px: number } | { fr: number }> = parts.map((p) => {
    const fr = /^([\d.]+)fr$/.exec(p);
    if (fr) { weight += parseFloat(fr[1]); return { fr: parseFloat(fr[1]) }; }
    const pct = /^([\d.]+)%$/.exec(p);
    if (pct) { const px = (width * parseFloat(pct[1])) / 100; fixed += px; return { px }; }
    const px = pxOf(p);
    if (px !== undefined) { fixed += px; return { px }; }
    weight += 1;
    return { fr: 1 };
  });
  const free = Math.max(0, width - fixed - gap * (spec.length - 1));
  return spec.map((s) => ("px" in s ? s.px : weight > 0 ? (free * s.fr) / weight : 0));
}

/** Split a track list into its individual track tokens, expanding `repeat(...)`. */
function expandTracks(tpl: string, width: number, gap: number): string[] {
  const out: string[] = [];
  // Top-level (paren depth 0) whitespace split; `repeat(...)` stays one token here.
  const tokens: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of tpl) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) tokens.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) tokens.push(cur);
  for (const t of tokens) {
    const rep = /^repeat\(\s*(auto-fill|auto-fit|\d+)\s*,\s*([\s\S]*)\)$/.exec(t);
    if (!rep) { out.push(t); continue; }
    if (rep[1] === "auto-fill" || rep[1] === "auto-fit") {
      const min = /minmax\(\s*([\d.]+)px/.exec(rep[2]);
      const minPx = min ? parseFloat(min[1]) : 120;
      const count = Math.max(1, Math.floor((width + gap) / (minPx + gap)));
      for (let i = 0; i < count; i++) out.push("1fr");
    } else {
      for (let i = 0; i < parseInt(rep[1], 10); i++) out.push(...expandTracks(rep[2], width, gap));
    }
  }
  return out;
}

// -- Html block (free-form annotation) ---------------------------------------------

/** Default width of an html block (px). Its height is content-driven. */
export const HTML_BLOCK_DEFAULT_W = 320;
/** Smallest html block (px) — a floor on both axes so a stray size can't collapse it. */
export const HTML_BLOCK_MIN_W = 60;
export const HTML_BLOCK_MIN_H = 24;

/** Measure an html block. `size.w` sets the width (default HTML_BLOCK_DEFAULT_W); `size.h`
 *  is a FLOOR on the height; the content (plus frame `padding`) grows it, so it never clips
 *  by construction. Pure; the same call sizes the node, lays it out and draws it. */
export function htmlBlockLayout(html: string | undefined, size?: { w?: number; h?: number }, padding = 0): { w: number; h: number } {
  const w = Math.max(HTML_BLOCK_MIN_W, Math.round(size?.w ?? HTML_BLOCK_DEFAULT_W));
  const innerW = Math.max(1, w - padding * 2);
  const contentH = cardBodyContentH(html ?? "", innerW);
  const h = Math.max(HTML_BLOCK_MIN_H, Math.ceil(contentH + padding * 2), Math.round(size?.h ?? 0));
  return { w, h };
}

/** Measure a card. `size.w` sets the width (default CARD_WIDTH); `size.h` is a
 *  FLOOR on the height (the content still grows the card — it never clips). */
export function cardLayout(card: CardContent, size?: { w?: number; h?: number }): CardLayout {
  const w = Math.max(CARD_MIN_W, Math.round(size?.w ?? CARD_WIDTH));
  const innerW = w - CARD_PAD_X * 2 - CARD_BORDER_PX * 2;
  const hasIcon = !!card.icon;
  // Badges are often UPPERCASE (PROPOSED), so estimate at a wide 0.72em per glyph.
  const badgeW = card.badge?.trim()
    ? Math.min(CARD_BADGE_MAX_W, Math.ceil(card.badge.trim().length * CARD_BADGE_FONT * CARD_BADGE_GLYPH_EM + CARD_BADGE_PAD))
    : 0;
  const body = cardBodySource(card);
  const bodyContentH = cardBodyContentH(body, innerW);
  const hasBody = bodyContentH > 0;

  // Title-only → a centred label: no header band, no body. The title auto-fits the
  // box (cardLabelFont), so the box's height is the fit height — the content never
  // exceeds it (the 70% bound leaves room), so `h` is stable across layout + render.
  const titleOnly = !!card.title?.trim() && !hasBody;
  if (titleOnly) {
    const padX = badgeW ? badgeW + CARD_BADGE_CLEAR : CARD_PAD_X;
    const contentW = w - padX * 2 - CARD_BORDER_PX * 2;
    const titleW = contentW - (hasIcon ? CARD_ICON + CARD_ICON_GAP : 0);
    const fitH = Math.max(1, Math.round(size?.h ?? CARD_LABEL_DEFAULT_H));
    const innerH = fitH - CARD_BODY_PAD_Y * 2 - CARD_BORDER_ALLOWANCE;
    const titleFont = card.fontSize ?? cardLabelFont(card.title ?? "", titleW, innerH);
    const titleLines = wrapLineCount(card.title ?? "", titleW, titleFont, true, true);
    const titleH = Math.ceil(titleLines * titleFont * CARD_TITLE_LINE);
    const contentH = Math.max(hasIcon ? CARD_ICON : 0, titleH) + CARD_BODY_PAD_Y * 2 + CARD_BORDER_ALLOWANCE;
    const h = Math.max(contentH, fitH);
    return {
      w, h, headerH: 0, titleH, badgeW, bodyH: 0,
      bodyPadY: CARD_BODY_PAD_Y, innerW, centered: true, padX, titleFont,
    };
  }

  // Header: icon + title wrap in what remains after the icon and the badge.
  const titleFont = card.fontSize ?? CARD_TITLE_FONT;
  const titleW = innerW - (hasIcon ? CARD_ICON + CARD_ICON_GAP : 0) - (badgeW ? badgeW + CARD_BADGE_HEADER_GAP : 0);
  const titleLines = wrapLineCount(card.title ?? "", titleW, titleFont, true, true);
  const titleH = Math.ceil(titleLines * titleFont * CARD_TITLE_LINE);
  const headerContentH = Math.max(hasIcon ? CARD_ICON : 0, titleH);
  // +1 for the header's rule (border-bottom); the border is allowed for in `contentH`.
  const headerH = headerContentH > 0 ? headerContentH + CARD_HEADER_PAD_Y * 2 + 1 : 0;

  // Body: the HTML body, padded. 0 when there is none.
  const bodyH = hasBody ? bodyContentH + CARD_BODY_PAD_Y * 2 : 0;
  // The border allowance keeps the padding under the last section clear of the
  // border (the card is border-box).
  const contentH = headerH + bodyH + CARD_BORDER_ALLOWANCE;
  const h = Math.max(contentH > CARD_BORDER_ALLOWANCE ? contentH : CARD_MIN_H, Math.round(size?.h ?? 0));
  return {
    w, h, headerH, titleH, badgeW, bodyH,
    bodyPadY: CARD_BODY_PAD_Y, innerW, centered: false, padX: CARD_PAD_X, titleFont,
  };
}

/** Height tolerance (px) for a shared title font: cards whose requested heights are within
 *  this of a cluster start share one font. */
export const CARD_GROUP_H_TOL = 4;

/** Consistent pill text. Title-only cards in one tab whose requested HEIGHTS are within
 *  CARD_GROUP_H_TOL draw ONE title font (any width): the minimum of their own auto-fits.
 *  Feasibility is monotone in font size, so the min fits every member's box, and no
 *  member grows (the box height is the fit height either way). Explicit `fontSize`
 *  cards and groups of one are left out. Pure: layout (computeLayout) and the
 *  parse→render path (NodePosition.cardFont → NodeData.cardFont) both call it.
 *  Returns node id → derived font. */
export function cardGroupFonts(nodes: Array<CardContent & { id: string; type: string; size?: [number, number] }>): Map<string, number> {
  // Collect the title-only cards with their requested height and own fit.
  const items: { id: string; h: number; font: number }[] = [];
  for (const n of nodes) {
    if (n.type !== "card" || n.fontSize !== undefined) continue;
    const l = cardLayout(n, { w: n.size?.[0], h: n.size?.[1] });
    if (!l.centered) continue;
    items.push({ id: n.id, h: n.size?.[1] ?? CARD_LABEL_DEFAULT_H, font: l.titleFont });
  }
  // Cluster by HEIGHT (within CARD_GROUP_H_TOL px of the cluster start), any width:
  // the pills of one row share a height, and a narrow one wraps to 2 lines instead of
  // shrinking. Min over the cluster fits every member (fit is monotone in width and
  // height), so no member grows.
  items.sort((a, b) => a.h - b.h);
  const out = new Map<string, number>();
  for (let i = 0; i < items.length;) {
    let j = i;
    while (j < items.length && items[j].h - items[i].h <= CARD_GROUP_H_TOL) j++;
    const cluster = items.slice(i, j);
    if (cluster.length > 1) {
      const font = Math.min(...cluster.map((c) => c.font));
      for (const c of cluster) out.set(c.id, font);
    }
    i = j;
  }
  return out;
}

/** A card with its DERIVED group font applied (unless it sets its own fontSize). */
export function withCardFont<T extends CardContent>(card: T, font: number | undefined): T {
  return font === undefined || card.fontSize !== undefined ? card : { ...card, fontSize: font };
}

/** Height a box's SUBTITLE line adds above its members (the title strip grows so
 *  members never sit under it). `boxWidth` is the box's OWN width, which the subtitle
 *  wraps at. computeLayout (the reserved band) and the renderer (annotations.tsx) both
 *  pass the box's final width, so the reservation and the drawn text agree. Pure. */
export const BOX_SUBTITLE_FONT = 12;
const BOX_SUBTITLE_PAD_X = 16;
export function boxSubtitleH(subtitle: string | undefined, boxWidth: number): number {
  if (!subtitle?.trim()) return 0;
  const lines = wrapLineCount(subtitle, boxWidth - BOX_SUBTITLE_PAD_X, BOX_SUBTITLE_FONT);
  return Math.ceil(lines * BOX_SUBTITLE_FONT * 1.35) + 6;
}

/** Width a BORDER title needs: the legend inset (12 each side), its mask padding
 *  (6 each side), the 20px icon + gap, and the bold text. Mirrors the border legend in
 *  annotations.tsx (same font rule: the box font + 2, which defaults to 16 technical /
 *  18 slide). A wrapping box is at least this wide, so its title never ellipsizes. Pure. */
export function boxBorderTitleW(
  a: { title?: string; titleIcon?: string; fontSize?: number },
  theme: ArchitectureTheme,
): number {
  const title = a.title?.trim();
  if (!title) return 0;
  const fontSize = a.fontSize ?? (theme === "slide" ? 18 : 16);
  const font = fontSize > 14 ? fontSize + 2 : 15;
  return 24 + 12 + (a.titleIcon ? 26 : 0) + Math.ceil(title.length * font * GLYPH_EM.bold);
}

// -- Inside box titles (titlePos ≠ border) -----------------------------------
//
// An inside title is a block at the top (or bottom) edge of the box: an optional
// icon + the title (centred or left) and the subtitle under it. Its BAND is the
// vertical room the layout reserves so wrapped members never sit under it. The
// layout (computeLayout step 4) and the renderer (annotations.tsx) both call
// `insideTitleMetrics` with the SAME box width, so the reserved band and the drawn
// block agree by construction.

/** Inset of the inside title block from the box edge (also its horizontal pad). */
export const BOX_TITLE_INSET = 12;
/** Clear space between the title block and the members / body. */
export const BOX_TITLE_GAP = 10;
/** Inside-title size bounds (px) when a box sets no `fontSize`: the title scales
 *  with the box width (width / BOX_TITLE_WIDTH_DIVISOR), clamped to [MIN, MAX]. */
export const BOX_TITLE_MIN_FONT = 16;
export const BOX_TITLE_MAX_FONT = 28;
export const BOX_TITLE_WIDTH_DIVISOR = 12;
/** Inside-title font for a box `width` px wide. An explicit `fontSize` wins. Pure;
 *  monotone non-decreasing in width. */
export function insideTitleFont(fontSize: number | undefined, width: number): number {
  if (fontSize !== undefined) return fontSize;
  return Math.min(BOX_TITLE_MAX_FONT, Math.max(BOX_TITLE_MIN_FONT, Math.round(width / BOX_TITLE_WIDTH_DIVISOR)));
}
const BOX_TITLE_LINE = 1.2;

/** True for the placements that sit INSIDE the box (not on the border). */
export function isInsideTitlePos(p: string | undefined): boolean {
  return p === "top" || p === "top-left" || p === "bottom" || p === "bottom-left";
}

export interface InsideTitleMetrics {
  /** Title font size (px). Follows the box's `fontSize`. */
  font: number;
  /** Title icon square (px); 0 when the box has no titleIcon. */
  iconPx: number;
  /** Title block height: the wrapped title lines (or the icon, if no text). */
  titleH: number;
  /** Subtitle block height (0 when no subtitle). */
  subH: number;
  /** Total band reserved at the inside edge: inset + title + subtitle + gap. */
  band: number;
}

/** Measure an inside title for a box `width` px wide. Pure; 0 band when the box
 *  has no title, icon or subtitle. */
export function insideTitleMetrics(
  a: { title?: string; titleIcon?: string; subtitle?: string; fontSize?: number },
  width: number,
): InsideTitleMetrics {
  const font = insideTitleFont(a.fontSize, width);
  const hasTitle = !!a.title?.trim();
  const iconPx = a.titleIcon ? Math.round(font * 1.25) : 0;
  if (!hasTitle && !iconPx && !a.subtitle?.trim()) return { font, iconPx: 0, titleH: 0, subH: 0, band: 0 };
  const textW = Math.max(40, width - BOX_TITLE_INSET * 2 - (iconPx ? iconPx + 8 : 0));
  const lines = hasTitle ? wrapLineCount(a.title ?? "", textW, font, true) : 0;
  // The icon and the text share one row, so the row is as tall as the taller of the two.
  const titleH = Math.max(lines ? Math.ceil(lines * font * BOX_TITLE_LINE) : 0, iconPx);
  const subLines = a.subtitle?.trim() ? wrapLineCount(a.subtitle, width - BOX_TITLE_INSET * 2, BOX_SUBTITLE_FONT) : 0;
  const subH = subLines ? Math.ceil(subLines * BOX_SUBTITLE_FONT * 1.35) + 4 : 0;
  return { font, iconPx, titleH, subH, band: BOX_TITLE_INSET + titleH + subH + BOX_TITLE_GAP };
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
  /** Edge colour (hex) — stroke, arrowhead and label chip. See FileEdge.color. */
  color?: string;
  /** Routing shape. */
  shape?: "smooth" | "straight" | "step";
  /** Flowing-data animation style. Unset → auto-derived from the origin: any
   *  data SOURCE tile defaults to `laser`; a non-source origin defaults to `dot`. An explicit value overrides that default. */
  flowStyle?: FlowStyle;
  /** Static arrowheads. Unset/"auto" → auto (arrow for user/Genie-One
   *  relationship edges, else flow). "none" | "end" | "start" | "both" force it.
   *  An arrow edge is a plain relationship line (no data-flow animation). */
  arrow?: "auto" | "none" | "end" | "start" | "both";
  /** Manual X of the vertical elbow segment (smooth/step edges). Unset → the
   *  auto-staggered position. Set by dragging the ↔ handle on the segment. */
  centerX?: number;
  /** Custom cubic Bézier control points in flow coordinates. */
  controlPoints?: [{ x: number; y: number }, { x: number; y: number }];
  /** Whether the smooth edge uses its custom Bézier controls. */
  bezier?: boolean;
  /** Custom points for an orthogonal/step edge, in flow coordinates. */
  waypoints?: { x: number; y: number }[];
  /** Optional edge label. */
  label?: string;
  /** Manual label placement ALONG the edge, set by dragging the chip.
   *
   *  `d` is the arc distance in PX from the `from` end (default `"source"`), and
   *  `off` a PERPENDICULAR nudge in px (negative = left/above the direction of
   *  travel). A stored dx/dy would leave the label floating off the line when the
   *  route changes, so placement is always relative to the path — but measured as
   *  an absolute distance from the nearer END, not as a fraction of the total.
   *  A fraction slides the chip whenever the path's LENGTH changes, so moving one
   *  node dragged every manual label along its line.
   *
   *  `t` is the legacy fractional form (0..1), still honoured when `d` is absent so
   *  diagrams saved before the change keep working.
   *
   *  Setting this opts the edge out of automatic label placement — see
   *  `label-layout`'s MANUAL guard. */
  labelPos?: { d?: number; from?: "source" | "target"; off?: number; t?: number };
  /** AI reasoning (never rendered) — see FileEdge.ai_reasoning. */
  ai_reasoning?: string;
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
  /** Component options (see PlatformComponent.options), e.g. `{ "feature_store":
   *  true }`. Values are usually boolean toggles, but a param may be a STRING when
   *  the option carries text (e.g. the medallion's `bronze_desc`/`silver_desc`/
   *  `gold_desc` layer captions). Only keys the component declares are meaningful. */
  params?: Record<string, boolean | string>;
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
  // ── Nested layout (lib/arch-layout.ts) ──────────────────────────────────────
  /** A container lays out these nodes itself (a `box` draws a frame + title; a
   *  `group` is invisible). Nested to any depth. */
  children?: FileNode[];
  /** How a container places its children: in a row (left → right), a column (top →
   *  bottom) or a grid of `cols` columns. Default "row". */
  layout?: ContainerLayout;
  /** Grid containers: number of columns. */
  cols?: number;
  /** Cross-axis alignment of children (a row aligns tops/centres/bottoms); "stretch"
   *  makes a container child span the parent (a banner row across its box). */
  align?: ContainerAlign;
  /** Main-axis distribution: start, centre (rows) / start (columns), end, or "between"
   *  (first child at the start, last at the end). */
  justify?: ContainerJustify;
  /** Same-size children: "w", "h" or true (both). For a row of stages or subnets. */
  equal?: boolean | "w" | "h";
  /** Nodes sharing a track line up on their parent's cross axis, across containers
   *  (a row → same centre y): a traffic path, a row of stage headers. */
  track?: string;
  /** multi-source group: the source systems listed inside the block, each an
   *  `{icon, label, note?}`. A first-class array (like `wraps` / `legend.items`),
   *  NOT a scalar `param` — a source group is inherently a variable-length list.
   *  The block auto-sizes to the row count. */
  sources?: MultiSourceItem[];
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
   *           overlaps content); true → overlay at the corner (may sit over it).
   *    at "above"/"below": sit OUTSIDE the box, centred on it, `pad` px (default
   *           24) beyond its top/bottom edge — e.g. a chevron phase banner over
   *           its phase box. Reserves nothing; follows the box when it moves.
   *    fill:  true → the node's width = the box's width (height from `size` or
   *           the natural size). Use with above/below for a banner that spans its box. */
  pin?: {
    at: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right" | "above" | "below";
    to?: string;
    pad?: number;
    float?: boolean;
    fill?: boolean;
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
  /** Whether the description WRAPS to multiple lines (box auto-grows) vs the
   *  default single-line truncate. */
  wrapDesc?: boolean;
  /** AI reasoning — never rendered, never affects layout. Explains WHY this node
   *  is here / what a non-obvious choice means (e.g. that a `lakeflow-jobs` tile
   *  is relabeled as a batch scoring job, or why a `row` is what it is).
   *  Round-trips verbatim so a saved example stays self-documenting. Distinct
   *  from `desc` (the tile's visible description line) and `type:"note"` (the
   *  visible post-it). */
  ai_reasoning?: string;
  /** Link to the real resource this node stands for (a pipeline, dashboard, table…, in the
   *  workspace). Opens from the node's detail panel in view mode. Never drawn. */
  url?: string;
  icon?: IconKey;
  /** box/text/logo/image annotation props. */
  text?: string;
  /** box: title-bar text + leading icon. */
  title?: string;
  titleIcon?: IconKey;
  /** box: grey subtitle under the title (the title strip grows to hold it). */
  subtitle?: string;
  /** box: title placement — `border` (default) | `top` | `top-left` | `bottom` |
   *  `bottom-left`. The inside placements sit within the box (see BOX_TITLE_POSITIONS). */
  titlePos?: BoxTitlePos;
  /** card: the body HTML (sanitized at render; see lib/card-body). */
  body?: string;
  /** @deprecated card: folded into `body` on parse. */
  summary?: string;
  chips?: CardChip[];
  tags?: CardTag[];
  /** card / box: small corner pill (top-right, overlapping the border). */
  badge?: string;
  /** card / box: the badge fill (hex). Default CARD_BADGE_COLOR. */
  badgeColor?: string;
  /** card: accent (hex) → border + header band tint. */
  accent?: string;
  /** card: title colour (hex). Default CARD_TITLE_COLOR. */
  titleColor?: string;
  /** card: whole-card background (hex); replaces the body and header tint. */
  fill?: string;
  /** card: ink (hex) for title, summary and description; `titleColor` wins for the title. */
  textColor?: string;
  /** html: the free-form HTML body (sanitized at render; see lib/card-body). Its height is
   *  measured from this text, `size` is a floor. Renders transparent unless `style` frames it. */
  html?: string;
  /** shape: which flowchart symbol (`rounded` = process, `diamond` = decision,
   *  `ellipse` = start/end, `parallelogram` = input/output, `cylinder` = data
   *  store, `document`, `hexagon`, `triangle`, `rectangle`, `chevron` = a PHASE
   *  HEADER banner — a row of them reads as a sequence). Default `rounded`. */
  shape?: ShapeKind;
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
    /** box: the title strip's fill (hex) — the title + subtitle area, like a card header. */
    headerFill?: string;
    /** html: inner padding (px) of the frame (only when a frame is drawn). */
    padding?: number;
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
  /** Edge colour (hex): the stroke, the arrowhead and the label chip's border +
   *  text all take it. Unset → the neutral grey. Animated particle/laser flows keep
   *  their own palette; the colour applies to the line itself. */
  color?: string;
  shape?: "smooth" | "straight" | "step";
  flowStyle?: FlowStyle;
  centerX?: number;
  controlPoints?: [{ x: number; y: number }, { x: number; y: number }];
  bezier?: boolean;
  waypoints?: { x: number; y: number }[];
  label?: string;
  /** Manual label placement along the edge: `d` = arc px from the `from` end,
   *  `off` = perpendicular px. Measured from the nearer end so the chip stays put
   *  when the far end moves (`t`, a fraction, is the legacy form and slid whenever
   *  the path changed length). Presence disables auto label placement. */
  labelPos?: { d?: number; from?: "source" | "target"; off?: number; t?: number };
  /** AI reasoning — never rendered, never affects layout. Explains WHY this edge
   *  exists (the reasoning that isn't obvious from from/to). Kept verbatim
   *  through the save round-trip so an example stays self-documenting. Use
   *  `label` for text drawn ON the edge; use `ai_reasoning` for the reasoning. */
  ai_reasoning?: string;
}

/** The whole flat file. */
export interface ArchitectureFile {
  name?: string;
  story?: string;
  /** Presentation composition target, measured on the COMPOSED FRAME when
   *  `frame` is set (title band + ribbon + legend) and on the bare node union
   *  otherwise. The exporter tightly crops and never pads a poor layout into
   *  compliance either way — add/segment bands, don't inflate gaps. */
  aspect?: PresentationAspect;
  /** Deck-style title/subtitle band rendered above the ribbon and INCLUDED in the
   *  export. Setting this also switches `aspect` to frame measurement, which is
   *  what lets the node ribbon stay a healthy 2-4:1. */
  frame?: FrameSpec;
  /** Visual preset. Omitted resolves to `DEFAULT_THEME` (`technical` — the denser
   *  engineering look); `slide` is the deck-ready preset with larger tiles. A
   *  diagram that declares either value keeps it through the round-trip; the
   *  field is only omitted from disk when it equals the default. */
  theme?: ArchitectureTheme;
  /** Reading direction. Wide solution flows should be horizontal; matrix is for
   *  comparisons/containment, vertical only for an explicit user request. */
  direction?: DiagramDirection;
  options?: {
    trademarkLogos?: boolean;
    /** Edge-label chip font size in px (default EDGE_LABEL_FONT, 8–24). Applies to
     *  every labelled edge on the tab; the solver measures with the same size. */
    edgeLabelSize?: number;
  };
  /** Ordered left→right lane names. Nodes reference one via `col`. Optional —
   *  only needed when authoring with symbolic (col-based) placement. */
  columns?: string[];
  /** Opt-in SHARED ROW GRID. When true, a node's `row` is a GLOBAL grid row
   *  aligned across EVERY column (not just order within its own lane): all
   *  nodes with row:1 share the same top band, row:2 the band below it, etc.,
   *  so columns register into horizontal rows even when they hold different
   *  node counts. A column that skips a row simply leaves that slot empty. Rows
   *  sit on a FIXED PITCH (constant grid lines) — a tile at row N lands on the
   *  same Y line in every column, and a node TALLER than one cell overflows
   *  downward in its own column WITHOUT pushing other columns. The grid centers
   *  on y=0. Nodes without a `row` keep appearance order, packed after the
   *  numbered rows. Off (default) → `row` orders within-lane
   *  as before. Relational (`alignY`/`below`/…) and `at` still override. */
  rowGrid?: boolean;
  /** Vertical gap in px between row-grid lines / stacked lane nodes. Default 60;
   *  use only for modest local clearance, never to manufacture aspect. */
  rowGap?: number;
  /** Inline custom SVG logos: `[{ id, svg }]`. Reference one from any node's
   *  `icon` as `"custom:<id>"` (works as a logo node OR a source tile). */
  custom_logos?: { id: string; svg: string }[];
  /** The numbered-callout legend for this tab — the sentences behind the
   *  `type:"callout"` circles / numbered edge labels. `show` decides whether it
   *  is drawn on the canvas, kept to the readable Legend panel, or both. */
  legend?: LegendSpec;
  /** Nested layout: how the canvas places its top-level nodes (see FileNode.layout).
   *  Its presence marks a nested file (lib/arch-layout.ts). */
  layout?: ContainerLayout;
  justify?: ContainerJustify;
  /** Nested layout: space between the top-level nodes. */
  gap?: number;
  cols?: number;
  align?: ContainerAlign;
  equal?: boolean | "w" | "h";
  nodes?: FileNode[];
  edges?: FileEdge[];
  /** Set by parse for a nested file: the tree record that save uses to re-nest the flat
   *  node list (lib/arch-layout.ts). Never written to disk. */
  _tree?: TreeMeta;
}

export type ContainerLayout = "row" | "column" | "grid";
export type ContainerAlign = "start" | "center" | "end" | "stretch";
export type ContainerJustify = "start" | "center" | "end" | "between";

const ANNOTATION_TYPES = new Set<AnnotationVariant>(["text", "box", "logo", "image", "note", "callout", "shape", "card", "html"]);

/** Valid `shape` values, for validation + a safe parse fallback. Mirrors
 *  SHAPE_KINDS in shape-geometry.ts (kept in step by `test:layout`). */
const SHAPE_KIND_SET = new Set<ShapeKind>([
  "rectangle", "rounded", "ellipse", "diamond", "triangle",
  "parallelogram", "hexagon", "cylinder", "document", "chevron",
]);
export const isShapeKind = (v: unknown): v is ShapeKind => typeof v === "string" && SHAPE_KIND_SET.has(v as ShapeKind);

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
    id: "dbx-account",
    label: "Databricks Admin Account",
    annotation: { title: "Databricks Admin Account", titleIcon: "file:vendor/databricks-admin" },
  },
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
  // Cloud-boundary boxes — a titled container carrying a cloud provider's logo,
  // for drawing the "external (non-Databricks) side" of an integration diagram.
  // Drop it, then `wraps` the external systems (or drag them inside).
  {
    id: "cloud-aws",
    label: "AWS boundary",
    annotation: { title: "AWS", titleIcon: "file:cloud/aws/aws" },
  },
  {
    id: "cloud-azure",
    label: "Azure boundary",
    annotation: { title: "Azure", titleIcon: "file:cloud/azure/azure" },
  },
  {
    id: "cloud-gcp",
    label: "GCP boundary",
    annotation: { title: "Google Cloud", titleIcon: "file:cloud/gcp/gcp" },
  },
  // Note — a stylized post-it for a free-floating comment anywhere on the canvas.
  {
    id: "note",
    label: "Note",
    variant: "note",
    annotation: { text: "" },
  },
];
export const DBX_ARCH_PRESET_BY_ID: Record<string, AnnotationPreset> = Object.fromEntries(
  DBX_ARCH_PRESETS.map((p) => [p.id, p]),
);

// =============================================================================
// Band metadata — the fixed marketing framing (top → bottom)
// =============================================================================

// `sublabel` is the marketing tagline shown in the app's band rail. `blurb` is a
// FUNCTIONAL one-liner for the skill catalog — what the band IS and when to pull a
// component from it — emitted under each generated section header (falls back to
// `sublabel` if absent). Keep both in code so the skill can't drift from the app.
export const BAND_META: Record<BandId, { label: string; sublabel: string; blurb?: string }> = {
  "agentic-apps": {
    label: "Agentic Apps",
    sublabel: "Deploy agents and apps at scale to transform work",
    blurb: "The delivery surface — dashboards and custom apps the business actually opens. Reach here for what a user SEES and clicks.",
  },
  "agentic-work": {
    label: "Agentic Work",
    sublabel: "Data-smart coworkers for every employee",
    blurb: "The intelligence layer — models, agents, RAG, ML lifecycle, and the entry points (Genie, Genie One) that answer questions and act on the governed data.",
  },
  "unified-governance": {
    label: "Unified Governance",
    sublabel: "One control plane for data + AI — security, lineage, cost",
    blurb: "The control plane over everything — Unity Catalog, the AI Gateway, and the Databricks-platform banner. Prefer the one `governance-block` bar over the loose tiles unless spotlighting a single feature.",
  },
  "agentic-data": {
    label: "Agentic Data",
    sublabel: "Unified, real-time data foundation",
    blurb: "The data foundation — ingest + the medallion pipeline (bronze→silver→gold) + the lakehouse / Lakebase it lands in. Where the demo's data comes IN and is refined.",
  },
  sources: {
    label: "Sources",
    sublabel: "The systems your business already runs on",
    blurb: "The upstream systems feeding the platform — NOT catalog components; authored as `type:\"source\"` tiles (see the Sources section).",
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
/** The three optional per-layer caption inputs (bronze/silver/gold) shared by
 *  every block that draws a medallion — the standalone medallion + both Lakeflow
 *  blocks. Declaring them here (once) makes the text inputs appear in the edit
 *  panel + round-trip automatically for all of them. */
const LAYER_CAPTION_OPTIONS: ComponentOption[] = [
  { key: "bronze_desc", label: "Bronze caption", type: "text", placeholder: "e.g. Raw ingested data" },
  { key: "silver_desc", label: "Silver caption", type: "text", placeholder: "e.g. Cleaned & conformed" },
  { key: "gold_desc", label: "Gold caption", type: "text", placeholder: "e.g. Business marts + metrics" },
];

export const CATALOG: Record<BandId, CatalogComponent[]> = {
  "agentic-apps": [
    { id: "databricks-apps", label: "Databricks Apps", icon: "databricksApps", desc: "Custom web app where the team does the work — queue, actions, all in one place.",
      authoring: "LEGACY app tile — prefer `databricks-apps-work` for the custom business app. Kept for back-compat; use it only when an existing diagram already references it.",
      wiring: [{ from: "lakebase", action: "reads/writes app state from" }, { from: "genie", action: "calls (Genie Agent: data + documents)", optional: true }, { from: "model-serving", action: "calls", optional: true }, { from: "ai-gateway", action: "model calls governed by", optional: true }] },
    { id: "ai-bi-dashboard", label: "AI/BI Dashboard", icon: "aibiBrand", sublabel: "Analyst consult & build insight", desc: "Governed dashboards on the same data — one set of numbers, one page.", capability: "aibi-dashboards",
      wiring: [{ from: "sql-lakehouse", action: "queries (SQL Warehouse)", optional: true }] },
    { id: "lakewatch", label: "LakeWatch", icon: "lakeWatchBrand", sublabel: "Agentic SIEM", desc: "Agentic SIEM on the lakehouse — unify security logs + telemetry (OCSF), AI agents detect, investigate and respond at machine speed.",
      authoring: "The security app: an agentic SIEM built ON the lakehouse. Use for security / SOC / threat-detection stories. Consumes governed telemetry from the data layer; SOC analysts + threat hunters use it.",
      wiring: [{ from: "sdp", action: "reads security logs + telemetry (OCSF) from" }, { from: "genie-one", action: "opened by (SOC analysts)", optional: true }] },
    { id: "customerlake", label: "CustomerLake", icon: "customerLakeBrand", sublabel: "Agentic CDP", desc: "Agentic customer data platform embedded in Databricks — unify profiles into a Customer 360, run always-on campaigns, no data copies.",
      authoring: "The marketing app: an agentic CDP on the lakehouse. Use for customer-360 / marketing / personalization / campaign stories. Consumes customer data from the data layer; marketers + analytics teams use it.",
      wiring: [{ from: "sdp", action: "builds Customer 360 from governed data of" }, { from: "genie-one", action: "opened by (marketers)", optional: true }] },
  ],
  "agentic-work": [
    { id: "databricks-apps-work", label: "Databricks Apps", icon: "databricksAppsBrand", sublabel: "Deploy business apps", desc: "Deploy business apps",
      authoring: "The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Agent.",
      wiring: [{ from: "lakebase", action: "reads/writes app state from" }, { from: "genie", action: "calls (Genie Agent: data + documents)", optional: true }, { from: "model-serving", action: "calls", optional: true }, { from: "ai-gateway", action: "model calls governed by", optional: true }] },
    { id: "genie-one", label: "Genie One", icon: "genieOneBrand", kind: "genie-one", sublabel: "The business user's front door", desc: "The enterprise AI coworker — the simplified Databricks front door where business users reach dashboards, Genie, and apps without technical expertise (formerly Databricks One).",
      authoring: "The business-user entry point / front door. It has a Business-users persona built IN (a small user icon docked above the Genie One mark) — so you do NOT need a separate file:persona/user node beside it. Wire Genie One --> dashboard / Genie Agent / app (auto-arrows; leave `arrow` out).",
      wiring: [{ from: "databricks-apps-work", action: "fronts / opens" }, { from: "genie", action: "fronts / opens" }, { from: "ai-bi-dashboard", action: "fronts / opens" }, { from: "lakewatch", action: "fronts / opens", optional: true }, { from: "customerlake", action: "fronts / opens", optional: true }] },
    { id: "genie", label: "Genie Agent", icon: "genieBrand", sublabel: "Ask your data and your documents", desc: "ask anything about your data and your documents",
      authoring: "The ONE agent for questions over structured data AND documents. Attach the governed tables (SQL answers) and, for PDFs / DOCX / PPTX, a dedicated MANAGED UC volume (document answers, cited to the file). It replaces Knowledge Assistant and Supervisor Agent for document Q&A and for routing between data and documents. Draw `src-pdf` → `uc-volume` → `genie` (edge label 'content search') when documents are in the story; an app or Genie One sits in front of it.",
      wiring: [{ from: "sql-lakehouse", action: "runs governed SQL over" }, { from: "uc-volume", action: "answers document questions from (content search)", optional: true }, { from: "genie-ontology", action: "grounded in (semantics)", optional: true }] },
    { id: "knowledge-assistant", label: "Knowledge Assistant", icon: "knowledgeAssistant", desc: "Chat with your documents — grounded, cited answers from unstructured content.",
      deprecated: true, replacedBy: "genie",
      wiring: [{ from: "uc-volume", action: "reads documents from (RAG)" }, { from: "supervisor-agent", action: "routed to by" }] },
    { id: "supervisor-agent", label: "Supervisor Agent", icon: "multiAgentSupervisor", desc: "Routes a question to the right specialist agent and composes the answer.",
      deprecated: true, replacedBy: "genie",
      authoring: "The Multi-Agent Supervisor (MAS) — routes to specialist agents/tools + composes the answer. It can orchestrate MANY types (up to 50): Genie · Knowledge Assistant · Model Serving endpoints · Unity Catalog functions/tables/volumes · Vector/AI Search index · published dashboards · MCP servers (external / UC / custom / Hosted MCPs) · web search · custom agents (Databricks Apps) · nested supervisors. Wire in the ones the demo actually uses.",
      wiring: [
        { from: "genie", action: "routes to" },
        { from: "knowledge-assistant", action: "routes to" },
        { from: "model-serving", action: "routes to (custom model)" },
        { from: "hosted-mcps", action: "calls tools via (MCP)" },
        { from: "vector-search", action: "queries (AI Search index)" },
        { from: "ai-bi-dashboard", action: "queries (published dashboard)" },
        { from: "uc-volume", action: "reads files/tools from (UC function/table/volume)" },
        { from: "databricks-apps-work", action: "routes to (custom agent)" },
        { from: "lakebase", action: "reads/writes agent memory + task queue from", optional: true },
        { from: "genie-ontology", action: "grounded in (semantics)", optional: true },
      ] },
    // Composite "Databricks Agent" block: the bundled agent building blocks
    // (supervisor + extraction + document parsing + classification).
    { id: "databricks-agent", label: "Databricks Agent", icon: "file:vendor/agent-bricks", kind: "databricks-agent",
      desc: "Databricks' managed agents — a multi-agent supervisor plus information extraction, document parsing, and classification, built and governed for you.",
      authoring: "The whole managed agent layer in ONE tile: a Supervisor with all its sub-capabilities inside it (Knowledge Assistant · Genie agent · MCP · Functions · classification · extraction · doc parsing). Input comes directly from a data source or from the lakehouse/medallion; output goes to an app, a Genie Space, or Genie One. USE THIS SINGLE TILE when the diagram is NOT centered on the agent layer — it keeps the overview simple, one block standing in for the entire agentic layer. But if the architecture IS ABOUT the agent layer (it's the focus), DON'T collapse it — SPLIT it into a `supervisor-agent` tile plus one tile per specialist (`knowledge-assistant`, `genie`, `hosted-mcps`, functions…), each wired separately, so the sub-agents are visible.",
      deprecated: true, replacedBy: "genie",
      wiring: [{ from: "medallion-table", action: "reads governed data from" }, { from: "genie", action: "linked to (Genie Space)", optional: true }, { from: "databricks-apps-work", action: "answers surfaced in", optional: true }, { from: "genie-one", action: "serves business users via", optional: true }, { from: "lakebase", action: "agent memory in", optional: true }, { from: "genie-ontology", action: "grounded in", optional: true }] },
    { id: "ml-training-serving", label: "ML Models", icon: "mlModel", desc: "Train, register, and serve models on governed data.",
      authoring: "Two consumption patterns, same model: BATCH — score over Delta → a gold predictions table that dashboards/Genie/apps read (simplest, a good default); REAL-TIME endpoint when per-request scoring fits the story (fraud at auth, rec at page-load). Lean batch unless the demo needs live scoring.",
      wiring: [{ from: "sdp", action: "trains on gold features from" }, { from: "feature-store", action: "trains on features from" }, { from: "sdp", action: "batch predictions written back to a gold table of (default path)" }, { from: "databricks-apps-work", action: "real-time endpoint called by", optional: true }] },
    { id: "ml-model", label: "Machine Learning Model", icon: "mlModelBrand", desc: "A trained model on governed data — classification, forecasting, recommendations, and more.",
      wiring: [{ from: "sdp", action: "trains on gold features from" }] },
    { id: "model-training", label: "Model Training", icon: "mlflowBrand", desc: "Train + track experiments with MLflow — parameters, metrics, and artifacts, all governed.",
      wiring: [{ from: "sdp", action: "trains on gold features from" }, { from: "feature-store", action: "trains on features from" }, { from: "uc-model-registry", action: "registers trained model to" }, { from: "model-serving", action: "feedback loop from" }] },
    { id: "mlops", label: "MLOps", icon: "mlopsBrand", desc: "The full model lifecycle — train, evaluate, register, deploy, and monitor, governed end to end." },
    // Medallion layers (orange brand marks) — used inside the SDP/pipeline block.
    { id: "bronze-layer", label: "Bronze", icon: "bronzeLayer", desc: "Raw ingested data, landed as-is." },
    { id: "silver-layer", label: "Silver", icon: "silverLayer", desc: "Cleaned, conformed, deduplicated." },
    { id: "gold-layer", label: "Gold", icon: "goldLayer", desc: "Curated, business-ready aggregates." },
    { id: "medallion-table", label: "Medallion Table", icon: "goldLayer", kind: "medallion-table",
      desc: "Bronze → Silver → Gold in one block — the medallion refinement of a governed table.",
      authoring: "The whole medallion (bronze → silver → gold) as ONE block, with the metal-toned layer marks and an internal flow. Prefer this over three separate bronze/silver/gold tiles when you just want to show the layered data itself. OPTIONS (params): `feature_store` and `metric_views` (booleans) — each adds a fork off the GOLD layer (Feature Store above, Metric Views below) shown inside the block, and exposes an extra right-side OUTPUT handle so you can wire it: `@out-gold` (always), `@out-fs` (when feature_store), `@out-mv` (when metric_views). Also `bronze_desc` / `silver_desc` / `gold_desc` (optional strings) — a SHORT caption under each layer (e.g. `gold_desc:\"Business marts + metrics\"`); the block grows to fit. Keep each to a few words.",
      options: [
        { key: "feature_store", label: "Feature store" },
        { key: "metric_views", label: "Metric views" },
        ...LAYER_CAPTION_OPTIONS,
      ],
      ports: { "l": "← sources / ingest", "out-gold": "→ gold output", "out-fs": "→ feature store (when enabled)", "out-mv": "→ metric views (when enabled)" },
      wiring: [{ from: "sources / ingest (@l)", action: "reads raw data from" }, { from: "sql-lakehouse", action: "gold consumed by (@out-gold)" }, { from: "model-serving", action: "gold trains model (@out-gold / @out-fs)" }] },
    { id: "feature-store", label: "Feature Store", icon: "featureStoreBrand", desc: "Governed, reusable features for training and real-time serving — consistent offline and online.",
      wiring: [{ from: "sdp", action: "computes features from gold tables of" }] },
    { id: "uc-model-registry", label: "UC Model Registry", icon: "modelRegistryBrand", desc: "Version, stage, and govern models in Unity Catalog with full lineage.",
      wiring: [{ from: "model-training", action: "registers models from" }, { from: "model-serving", action: "loads model into" }, { from: "lakeflow-jobs", action: "loads model into (batch scoring)" }] },
    { id: "model-serving", label: "Model Serving Endpoint", icon: "modelServing", desc: "Serve a custom model behind a governed, autoscaling REST endpoint for real-time inference.",
      authoring: "A deployed serving endpoint (real-time inference over a custom/registered model). Best fit when the story needs per-request scoring (fraud at authorization, rec at page-load). For a plain train→register→batch-score story, batch is usually simpler — the model writes a gold predictions table (via ml-training-serving / the medallion) that dashboards/apps read; reach for a live endpoint when real-time matters.",
      wiring: [{ from: "uc-model-registry", action: "loads registered model from" }, { from: "databricks-apps-work", action: "called for real-time predictions by", optional: true }] },
    { id: "hosted-mcps", label: "Hosted MCPs", icon: "mcp", desc: "Managed MCP servers that let agents call external tools — Genie, Atlassian, GitHub, Slack, SharePoint, Gmail, and more.",
      authoring: "The governed tool/connector layer for agents — hosted MCP servers (Genie / Atlassian / GitHub / Slack / SharePoint / Gmail …). Use when the demo's agent reaches OUT to external systems via MCP.",
      wiring: [{ from: "external tools (Genie, GitHub, Slack, …)", action: "exposes as tools" }] },
    { id: "vector-search", label: "Vector Search", icon: "vectorSearchBrand", desc: "Embeddings",
      authoring: "Two build modes: (a) MANAGED — auto-sync an index FROM a Delta table (data must land in Delta first via sdp; easiest, higher latency); (b) STANDALONE — a direct index updated via a real-time API to add/remove entries (low latency). Pick the one the demo's freshness needs.",
      wiring: [
        { from: "sdp", action: "auto-syncs index from a Delta table of (managed mode)" },
        { from: "realtime API", action: "direct add/remove entries (standalone mode, low-latency)" },
              ] },
    { id: "information-extraction", label: "Information Extraction", icon: "unstructuredData", desc: "Pull specific data points, entities, and fields from unstructured text (ai_extract).",
      wiring: [{ from: "uc-volume", action: "reads unstructured text from" }] },
    // The Databricks Agent building blocks (also surfaced inside the composite).
    { id: "document-parsing", label: "Document Parsing", icon: "inputData", desc: "Extract structured content from documents — text, tables, and metadata (ai_parse_document).",
      wiring: [{ from: "uc-volume", action: "reads documents from" }] },
    { id: "text-classification", label: "Text Classification", icon: "aiFunctions", desc: "Categorize text into predefined or dynamic labels (ai_classify).",
      authoring: "Two typical shapes: (a) INLINE in the pipeline — a bi-directional arrow with `sdp` (enriches tables in place with ai_classify, usually drawn just below SDP); or (b) a STANDALONE job reading docs from a `uc-volume` and writing labels to a table. Pick per demo.",
      wiring: [{ from: "sdp", action: "enriches tables in-pipeline (bi-directional, ai_classify)" }, { from: "uc-volume", action: "standalone job reads docs from" }] },
    { id: "genie-code", label: "Built with Genie Code", icon: "genieCodeBrand", kind: "genie-code",
      desc: "Autonomous AI coding partner built into every Databricks surface (notebooks, pipelines, dashboards, MLflow) — Unity Catalog–aware, so it writes code against your real tables.",
      authoring: "The 'built/maintained by Genie Code' beat — an AI coding partner for developers/practitioners (business users get the simpler no-code experience via Genie One). No need to add it separately when you're already using lakeflow-genie-block (that block has the Genie Code footer built in)." },
  ],
  "unified-governance": [
    // Composite "Unified Governance" bar: Unity Catalog + Unity AI Gateway (all
    // foundation models) + Genie Ontology, rendered as one horizontal strip.
    { id: "governance-block", label: "Unified Governance", icon: "unityCatalogBrand", kind: "governance",
      desc: "One control plane for data + AI: Unity Catalog governs access/lineage/audit (ACL · ABAC); the Unity AI Gateway governs every foundation-model call (OpenAI, Anthropic, Gemini, …); Genie Ontology is the shared semantic layer.",
      authoring: "One governance bar with up to three surfaces: Access control (ACL · ABAC · Audit across Data + AI) + Unity AI Gateway (access any model) + Genie Ontology. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature). OPTIONS (params, booleans, all default TRUE — set false to HIDE that surface): `access_control` / `ai_gateway` / `genie_ontology`; the bar tightens to the surfaces shown. Governance SPANS everything (data, jobs, dashboards, apps, end-user access…), so show it STRUCTURALLY — `pin` it as a bar across the top or bottom of the platform box; its position implies it governs all tiles under it, so draw NO per-tile edges. DEFAULT: the one-line spanning bar with NO edges — keep it low-touch, don't map it to every component. If a surface DOES need wiring, each shown one has a top+bottom handle (`@acl` / `@ai-gateway` / `@ontology`, + `-b`) and typically connects to: `@acl` → the DATA layer (medallion/lakehouse; the compute layer too if needed); `@ontology` → Genie (Genie Space / Genie agents); `@ai-gateway` → apps or model-serving (the frontier-model callers). Wire only the one or two that the story calls for, not all three. Any edge touching this block renders as a plain DASHED line with NO flow animation (governance governs, it doesn't flow data) — automatic, don't set `flow`/`dashed`.",
      options: [
        { key: "access_control", label: "Access control (ACL · ABAC · Audit)", type: "boolean", default: true },
        { key: "ai_gateway", label: "Unity AI Gateway", type: "boolean", default: true },
        { key: "genie_ontology", label: "Genie Ontology", type: "boolean", default: true },
      ],
      ports: { "acl": "↑ access control (ACL · ABAC · Audit)", "acl-b": "↓ access control (bottom)", "ai-gateway": "↑ Unity AI Gateway", "ai-gateway-b": "↓ Unity AI Gateway (bottom)", "ontology": "↑ Genie Ontology", "ontology-b": "↓ Genie Ontology (bottom)" } },
    { id: "db-platform", label: "Databricks Platform", icon: "file:vendor/databricks-wordmark", kind: "db-platform",
      desc: "The Databricks Data + AI platform — one governed foundation for all data + AI.",
      authoring: "Title banner (the Databricks wordmark). The first child of the platform box, usually at the left of a banner row with the governance block at the right (`justify:\"between\"`) → reads as 'all of this is the platform'." },
    { id: "unity-catalog", label: "Unity Catalog", icon: "unityCatalogBrand", desc: "One governed catalog — access, lineage, and semantics across data + AI.",
      authoring: "Governs EVERYTHING — data, jobs, dashboards, apps, end-user access. So don't wire it to every tile (overkill/noise). Best default: the spanning governance bar (this tile or `governance-block`) pinned top/bottom of the platform box, NO edges — position implies it governs all. If you use the single tile with edges (to spotlight governance), link only the 1–2 MAIN anchors (e.g. the data layer, or end-user access), not everything. Follow the user if they ask to show it governing something specific." },
    { id: "ai-gateway", label: "Unity AI Gateway", icon: "aiGatewayBrand", kind: "ai-gateway", desc: "Security, governance, cost and rate limits.",
      wiring: [{ from: "databricks-apps-work", action: "governs model calls of" }, { from: "model-serving", action: "governs" }],
      authoring: "The Unity AI Gateway tile with a row of foundation-model logos (OpenAI · Anthropic · Gemini · Grok · Kimi) across the top — conveys 'govern + access ANY model' at a glance. Use standalone; the Unified Governance bar already embeds a compact gateway if you want the whole control plane. It governs the model calls that apps / model-serving endpoints make — wire it to whatever actually makes those calls (an app or model endpoint typically routes through it), labeled 'model calls governed by'. Keep that edge SHORT and adjacent to what it governs; don't drag the tile far away and route a long line across unrelated tiles (that reads as if the source 'calls the gateway' — the confusion to avoid)." },
    { id: "data-quality", label: "Data Quality", icon: "file:db/pass-fail-checklist", desc: "Expectations and monitors keep bad data out of the gold layer." },
    { id: "abac", label: "ABAC", icon: "file:db/lock-share", desc: "Attribute-based access control — fine-grained, policy-driven permissions." },
    { id: "data-classification", label: "Data Classification", icon: "file:db/tag", desc: "Automatically tag and govern sensitive data." },
  ],
  "agentic-data": [
    // Composite "Lakeflow" super-block: Lakeflow Connect + Zerobus + direct
    // ingest feeding a bronze→silver→gold pipeline, with 3 left input ports.
    { id: "lakeflow-block", label: "Lakeflow", icon: "lakeflowConnectBrand", kind: "lakeflow",
      desc: "One block: managed ingest (Lakeflow Connect), real-time streams (Zerobus) and direct file landing, all flowing into a declarative bronze → silver → gold pipeline.",
      authoring: "The whole ingest + bronze→silver→gold SDP in one block (no Genie Code framing). Contains SDP — never add a separate sdp tile beside it. OPTIONS (params, all optional strings): `bronze_desc` / `silver_desc` / `gold_desc` — a SHORT caption under that layer's cylinder (e.g. `gold_desc:\"Business marts + metrics\"`); the block grows to fit. Keep each to a few words.",
      options: LAYER_CAPTION_OPTIONS,
      ports: { "in-lakeflow-connect": "← databases / SaaS apps", "in-zerobus": "← realtime streams / sensors", "in-direct": "← files: PDF / CSV / Parquet", "r": "→ the compute layer" },
      wiring: [{ from: "sources (via @in-* ports)", action: "ingests from" }, { from: "sql-lakehouse", action: "feeds gold tables to" }, { from: "lakebase", action: "syncs gold tables to" }] },
    // Combined box: the Lakeflow super-block stacked over the Genie Code block.
    { id: "lakeflow-genie-block", label: "Lakeflow + Genie", icon: "lakeflowConnectBrand", kind: "lakeflow-genie",
      desc: "Lakeflow ingest + declarative pipeline, with Genie Code building and maintaining it — one box, end to end.",
      authoring: "The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it. OPTIONS (params, all optional strings): `bronze_desc` / `silver_desc` / `gold_desc` — a SHORT caption under that layer's cylinder; the block grows to fit. Keep each to a few words.",
      options: LAYER_CAPTION_OPTIONS,
      ports: { "in-lakeflow-connect": "← databases / SaaS apps", "in-zerobus": "← realtime streams / sensors", "in-direct": "← files: PDF / CSV / Parquet", "r": "→ the compute layer" },
      wiring: [{ from: "sources (via @in-* ports)", action: "ingests from" }, { from: "sql-lakehouse", action: "feeds gold tables to" }, { from: "lakebase", action: "syncs gold tables to" }] },
    { id: "lakeflow-connect", label: "Lakeflow Connect", icon: "lakeflowConnectBrand", desc: "A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems.",
      wiring: [{ from: "external connectors / SaaS / DBs", action: "ingests from" }, { from: "sdp", action: "lands raw tables into" }] },
    { id: "zerobus-ingest", label: "Lakeflow Zerobus", icon: "zerobus", desc: "Real-time, direct ingest of streaming events into the lakehouse.",
      wiring: [{ from: "streaming / live events (apps, devices)", action: "receives push from" }, { from: "sdp", action: "lands raw tables into" }] },
    { id: "sdp", label: "Lakeflow SDP", icon: "sdpBrand", desc: "Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale.",
      wiring: [{ from: "lakeflow-connect", action: "reads ingested data from" }, { from: "zerobus-ingest", action: "reads streams from" }, { from: "uc-volume", action: "reads files from (Auto Loader)" }, { from: "lakeflow-jobs", action: "orchestrated by", optional: true }] },
    { id: "uc-volume", label: "UC Volume", icon: "volume", desc: "Governed file storage in Unity Catalog — where raw documents (PDFs) land.",
      wiring: [{ from: "files / documents (PDF, CSV, images)", action: "stores" }] },
    { id: "lakeflow-jobs", label: "Lakeflow Jobs", icon: "lakeflowJobsBrand", sublabel: "Orchestrate anything", desc: "The orchestrator for any workflow — ingestion, SDP pipelines, notebooks, SQL queries, ML training/scoring, and deployment — on a schedule or trigger.",
      authoring: "The workspace orchestrator. It can run ANY component as a task: data ingestion (Lakeflow Connect, notebooks, SDP), SQL queries, ML training/scoring, and deployment steps — chained with dependencies, on a schedule or trigger. Wire an `orchestrates` edge from Lakeflow Jobs to every step it runs.",
      wiring: [{ from: "sdp", action: "orchestrates" }, { from: "ml-training-serving", action: "orchestrates" }, { from: "notebooks-eda", action: "orchestrates" }, { from: "lakeflow-connect", action: "orchestrates" }] },
    { id: "notebooks-eda", label: "Notebooks", icon: "notebooks", desc: "Interactive exploration and analysis on governed data.",
      wiring: [{ from: "sdp", action: "explores tables from" }] },
    { id: "delta-sharing", label: "Delta Sharing", icon: "deltaSharing", desc: "Open, cross-org data sharing with no copies." },
    { id: "marketplace", label: "Marketplace", icon: "file:db/marketplace", desc: "Discover and consume third-party data and AI assets." },
    { id: "lakebase", label: "Lakebase", icon: "lakebaseBrand", sublabel: "Serverless Postgres — instant start, branch", desc: "Managed Postgres for app state — reads/writes the live queue.",
      wiring: [{ from: "sdp", action: "syncs with Delta — EITHER reverse-ETL Delta→Postgres, OR live app writes Postgres→Delta for analysis" }, { from: "databricks-apps", action: "powers state + agent memory for" }] },
    { id: "sql-lakehouse", label: "Lakehouse", icon: "lakehouseBrand", badge: "RT", sublabel: "~100 ms charts, thousands of concurrent users", desc: "One copy of governed data for BI + AI — real-time queries at scale (SQL Warehouse; RT = Lakehouse Real Time).",
      wiring: [{ from: "sdp", action: "queries gold tables from" }, { from: "ai-bi-dashboard", action: "serves queries to" }, { from: "genie", action: "serves queries to" }] },
  ],
  // Sources are demo-authored. The catalog ships the LuxeBeauty example set so
  // the diagram reads as a complete architecture out of the box; the agent
  // REPLACES these (via the `sources` band `add` + hiding these) with the
  // demo's real systems.
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
    // A titled GROUP of source systems — several logos+names stacked under one
    // labelled box (the recurring "Operational databases / SaaS apps / …"
    // pattern in real customer source columns). One edge carries the whole group
    // into ingest. See composite-multi-source.tsx.
    { id: "multi-source", label: "Source group", icon: "data", kind: "multi-source",
      desc: "A titled box grouping several related source systems (logos + names) under one label — e.g. 'Operational databases', 'SaaS apps with a managed connector'.",
      authoring: "Use to group related source systems into ONE labelled block instead of scattering loose source tiles — the shape real customer source columns use. The node LABEL is the group title (e.g. 'Operational databases'). Set the systems on the node's first-class `sources` array: `[{icon, label, note?}, …]` (icon = a `file:vendor/*` logo key, a databricks-icon name, or `\"text\"` for a name-only badge; note = a short qualifier like 'student SOR'). An optional `note` param renders a one-line description under the title (shown in BOTH themes). Draw ONE edge from the group's right side into its ingest method (don't wire each system separately). Group by INGEST characteristics (databases vs managed-connector SaaS vs streams vs files) so each group maps cleanly to an ingestion method.",
      options: [
        { key: "note", label: "Description line (optional)", type: "text" },
      ] },
  ],
};

/** Flat id → (catalog component + its band), built once from CATALOG. The new
 *  flat file format keys nodes by `type` = catalog id; this resolves the
 *  defaults (icon/label/desc/sublabel/badge/kind) + the band (tile
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
  callout: { w: 84, h: 84 },
  // MUST equal ANNOTATION_DEFAULT_SIZE.logo in annotations.tsx: this copy MEASURES
  // a logo (footprint, lane width, de-overlap) while that one DRAWS it. They read
  // 64 here and 60 there for a long time — commit 7e79666 took the default 72→60
  // in the render and missed this copy — so every captioned logo reserved a box
  // 4px wider than it drew. `test:layout` now pins the two together.
  logo: { w: 60, h: 60 },
  image: { w: 200, h: 140 },
  note: { w: 180, h: 140 },
  // A process step: wide enough for two or three words on one line.
  shape: { w: 200, h: 90 },
  // A card's HEIGHT is content-driven (cardLayout); this is only the width-based
  // fallback when no content is given. MUST equal ANNOTATION_DEFAULT_SIZE.card.
  card: { w: CARD_WIDTH, h: 120 },
  // An html block's HEIGHT is content-driven (htmlBlockLayout); this is the width-based
  // fallback. MUST equal ANNOTATION_DEFAULT_SIZE.html in annotations.tsx (test:layout pins it).
  html: { w: HTML_BLOCK_DEFAULT_W, h: HTML_BLOCK_MIN_H },
};

/** Medallion-table footprint — grows when a fork option (`feature_store` /
 *  `metric_views`) is on: the last column becomes a vertical MV/Gold/FS stack,
 *  so it gets a bit WIDER (labels) and TALLER (one row per option). Also grows
 *  when a LAYER DESCRIPTION (`bronze_desc`/`silver_desc`/`gold_desc`) is set:
 *  each layer's mark+label gains a short caption line below it, so the block
 *  gets TALLER (room for the line) and WIDER (the layers spread out to fit the
 *  captions without crowding). SINGLE source of truth for the medallion box —
 *  `naturalSize` (→ layout/`sizeOf`), `nodeFootprint` (the ReactFlow selection
 *  frame), and the composite render (`shared.tsx` re-exports this) all resolve
 *  through here, so symbolic layout, the resize frame, and the visual agree. */
export function medallionSize(params?: Record<string, boolean | string>): { w: number; h: number } {
  const fs = !!params?.feature_store;
  const mv = !!params?.metric_views;
  // Any layer desc set → reserve a caption line under the marks + a wider box so
  // the bronze/silver/gold columns get more breathing room for the text.
  const hasLayerDesc = !!(layerDescOf(params, "bronze") || layerDescOf(params, "silver") || layerDescOf(params, "gold"));
  const descH = hasLayerDesc ? 30 : 0;   // ~2 lines at the small caption font
  const descW = hasLayerDesc ? 84 : 0;   // spread the 3 columns apart for captions
  if (!fs && !mv) return { w: 268 + descW, h: 96 + descH };
  const forkRows = 1 + (fs ? 1 : 0) + (mv ? 1 : 0);
  return { w: 300 + descW, h: Math.max(96, 44 + forkRows * 38) + descH };
}

/** Governance-bar footprint. Three governed surfaces (access-control, AI Gateway,
 *  Genie Ontology) shown side by side; each is an OPT-OUT `params` boolean
 *  (`access_control`/`ai_gateway`/`genie_ontology`) — ABSENT or true = shown,
 *  false = hidden. No params → all three (back-compat). Width scales with the
 *  count of shown surfaces so the bar tightens when some are off. */
export function governanceSize(params?: Record<string, boolean | string>): { w: number; h: number } {
  const shown = governanceSurfaces(params);
  // Every surface is the SAME width (ontology included); width scales with count.
  const n = shown.acl + shown.gateway + shown.ontology || 1;
  return { w: Math.round(96 + n * 158), h: 92 };
}

/** One source inside a "multi-source" group block. `icon` is any mark key the
 *  BrandMark renderer understands (a `file:vendor/*` logo, a databricks-icon
 *  name, `"text"` for a name-only badge); `label` is the system name; `note` is
 *  an optional short qualifier shown muted after the name (e.g. "student SOR").
 *  `wrap:true` moves the note BELOW the name and lets it wrap to multiple lines
 *  (a fuller description) — the box height auto-adapts to the extra lines. */
export interface MultiSourceItem {
  icon: string;
  label: string;
  note?: string;
  wrap?: boolean;
}

/** Sanitize a raw sources array (agent- or hand-authored) into clean items. */
function coerceSources(arr: unknown): MultiSourceItem[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is MultiSourceItem => !!x && typeof x === "object" && typeof (x as MultiSourceItem).label === "string")
    .map((x) => ({
      icon: typeof x.icon === "string" ? x.icon : "text",
      label: x.label,
      note: typeof x.note === "string" && x.note.trim() ? x.note : undefined,
      ...(x.wrap === true ? { wrap: true as const } : {}),
    }));
}

/** The source systems listed inside a multi-source group. First-class `sources`
 *  array (like `wraps`); falls back to a legacy JSON-string `params.items` for
 *  any block authored before the field existed. Empty → a couple of placeholder
 *  rows so a freshly dropped block reads as an editable group. */
export function multiSourceItems(
  sources?: MultiSourceItem[],
  params?: Record<string, boolean | string>,
): MultiSourceItem[] {
  const fromField = coerceSources(sources);
  if (fromField.length) return fromField;
  const raw = params?.items;
  if (typeof raw === "string" && raw.trim()) {
    try { const legacy = coerceSources(JSON.parse(raw)); if (legacy.length) return legacy; } catch { /* ignore */ }
  }
  return [
    { icon: "text", label: "Source 1" },
    { icon: "text", label: "Source 2" },
  ];
}

/** Multi-source group footprint. A titled box holding N source rows stacked
 *  vertically; height grows with the row count (+ header, + an optional
 *  description line). Width is generous so two-word system names + a short note
 *  fit on one row. Theme-invariant like every other box. */
// Box height HUGS the rendered content. Calibrated against the LIVE canvas DOM
// (measured, zoom-normalized): content = BASE + n·ROW_H, where ROW_H is the true
// per-row pitch and BASE covers the padding + title (+ note line). A note that
// WRAPS to a 2nd line adds one more. No fixed floor — a 1-row box is just
// BASE + ROW_H, so it hugs its single row instead of reserving slack.
export const MULTI_SOURCE_W = 288;           // fixed box width
export const MULTI_SOURCE_ROW_H = 22;        // per-source-row content growth (measured on the LIVE canvas, card+frame in sync)
export const MULTI_SOURCE_BASE_NOTE = 51;    // pad + title + one-line note + ~8px bottom margin
export const MULTI_SOURCE_BASE_PLAIN = 37;   // pad + title (no note) + ~8px bottom margin
export const MULTI_SOURCE_NOTE_WRAP_H = 15;  // extra height per wrapped note line beyond the first
/** Horizontal padding (px-3, both sides) and the icon column + gap a wrapped source
 *  row's note is measured against. */
const MULTI_SOURCE_PAD_X = 24;
const MULTI_SOURCE_ICON_COL = 24;
/** Average advance (px per char) of the ~9px italic note text. */
const MULTI_SOURCE_NOTE_CHAR_W = 4.7;
/** The note wraps (no truncate) — estimate its line count so the box reserves the right
 *  height. Usable width ≈ box − horizontal padding. Capped at 2 lines. */
function multiSourceNoteLines(note: string): number {
  const usable = MULTI_SOURCE_W - MULTI_SOURCE_PAD_X;
  return Math.min(2, Math.max(1, Math.ceil((note.trim().length * MULTI_SOURCE_NOTE_CHAR_W) / usable)));
}
/** A wrapped source row's note renders BELOW the name and wraps. Estimated from the note
 *  length against the usable width (minus the icon column). Capped at 3 lines so one
 *  verbose note can't balloon the box. */
const MULTI_SOURCE_ITEM_NOTE_LINE_H = 12;   // one wrapped item-note line below the name
function multiSourceItemNoteLines(note: string): number {
  const usable = MULTI_SOURCE_W - MULTI_SOURCE_PAD_X - MULTI_SOURCE_ICON_COL;
  return Math.min(3, Math.max(1, Math.ceil((note.trim().length * MULTI_SOURCE_NOTE_CHAR_W) / usable)));
}
export function multiSourceSize(
  sources?: MultiSourceItem[],
  params?: Record<string, boolean | string>,
): { w: number; h: number } {
  const items = multiSourceItems(sources, params);
  const note = typeof params?.note === "string" ? params.note.trim() : "";
  const base = note
    ? MULTI_SOURCE_BASE_NOTE + (multiSourceNoteLines(note) - 1) * MULTI_SOURCE_NOTE_WRAP_H
    : MULTI_SOURCE_BASE_PLAIN;
  // Each row is one ROW_H; a `wrap` row with a note grows by its extra note lines.
  const rows = items.reduce((h, it) => {
    const extra = it.wrap && it.note ? multiSourceItemNoteLines(it.note) * MULTI_SOURCE_ITEM_NOTE_LINE_H : 0;
    return h + MULTI_SOURCE_ROW_H + extra;
  }, 0);
  return { w: MULTI_SOURCE_W, h: base + rows };
}

/** Which governance surfaces are shown (opt-out: absent/true = shown). */
export function governanceSurfaces(params?: Record<string, boolean | string>): { acl: number; gateway: number; ontology: number } {
  const on = (k: string) => (params?.[k] === false ? 0 : 1);
  return { acl: on("access_control"), gateway: on("ai_gateway"), ontology: on("genie_ontology") };
}

/** Read a layer-caption param (`bronze_desc`/`silver_desc`/`gold_desc`) as a
 *  trimmed string, or undefined when absent/blank/non-string. Shared by the size
 *  helper and the composite render so both agree on when a caption exists. */
export function layerDescOf(
  params: Record<string, boolean | string> | undefined,
  layer: "bronze" | "silver" | "gold",
): string | undefined {
  const v = params?.[`${layer}_desc`];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Normalize a `stack` value from the file (agent- or hand-authored, so it may
 *  be a float, string, huge, or garbage) to a clean integer in [2, 5], or
 *  `undefined` when there's no meaningful stack (≤1, NaN, non-finite). The
 *  renderer caps at 5 anyway; coercing here keeps the file honest and avoids a
 *  fractional value silently floor-truncating the shadow-card count. */
export function sanitizeStack(v: unknown): number | undefined {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 1) return undefined;
  return Math.min(n, 5);
}

/** A source with caption above/below uses a taller, narrower card. Shared
 *  with the rendered node so symbolic layout and ReactFlow agree. */
export const VERTICAL_SOURCE_SIZE = { w: 132, h: 96 };
/** Footprint of a vertical-caption source. Theme-invariant (slide changes only the
 *  INSIDE of a node), so it takes no theme argument. */
export function verticalSourceSize(): { w: number; h: number } {
  return VERTICAL_SOURCE_SIZE;
}

/** Line-height (px) added per wrapped description line beyond the first. Measured
 *  from the live render: the 11px desc renders at a 14px line box (`leading-tight`).
 *  Using the true 14 (not a padded 17) keeps the grown box flush with the text —
 *  an over-value left an empty line's worth of gap at the tile bottom. */
export const DESC_WRAP_LINE_H = 14;
/** Average advance (px per char) of the 11px system-font desc. Calibrated against the
 *  real wrap: an 82-char desc in a 300px tile wraps to 2 lines, not 3. Over-estimating
 *  left an empty line at the box bottom; this tracks the actual line count. */
const DESC_CHAR_W = 5.3;
/** Desc text column: the usable width is the box minus the side pad and the icon
 *  column, never below DESC_MIN_USABLE_W. */
const DESC_SIDE_PAD = 24;
const DESC_ICON_COL = 40;
const DESC_MIN_USABLE_W = 80;
/** A pasted paragraph can't grow a tile past this many lines. */
const DESC_MAX_LINES = 12;
/** Estimate how many lines a description wraps to inside a tile of width `boxW`. The
 *  estimate errs toward MORE lines (an extra blank line reads fine; a clipped one loses
 *  text — it can't be exact without measuring the DOM). Content is TOP-aligned, so a
 *  borderline desc that lands one line short still wraps in the DOM and the box's
 *  small padding absorbs it. */
export function descWrapLines(desc: string, boxW: number): number {
  const usable = Math.max(DESC_MIN_USABLE_W, boxW - DESC_SIDE_PAD - DESC_ICON_COL);
  const est = Math.ceil((desc.trim().length * DESC_CHAR_W) / usable);
  return Math.min(DESC_MAX_LINES, Math.max(1, est));
}
/** Extra HEIGHT (px) a wrapped, shown description adds to a tile's base height.
 *  ONE source of truth so the symbolic layout (`computeLayout.sizeOf`), the RF
 *  node box (`nodeFootprint`), and the rendered card (component-node) all grow by
 *  the same amount. 0 when wrap is off, desc hidden/empty, or the caption is
 *  vertical.
 *
 *  SLIDE theme hides EVERY tile description, so a wrapped desc would render
 *  nothing — growing the box there just leaves an oversized empty tile. So in
 *  slide the extra is 0 and the tile keeps its base height. This means a
 *  wrap-desc tile DOES reflow on a technical↔slide toggle — intentional: the box
 *  tracks what's actually drawn, rather than reserving room for hidden text. */
export function wrapDescExtraH(
  opts: { desc?: string; showDesc?: boolean; wrapDesc?: boolean; vertical?: boolean; theme?: ArchitectureTheme },
  boxW: number,
): number {
  if (opts.theme === "slide") return 0; // slide hides descriptions
  const shown = !!opts.desc && (opts.showDesc ?? true);
  if (!opts.wrapDesc || !shown || opts.vertical) return 0;
  return (descWrapLines(opts.desc!, boxW) - 1) * DESC_WRAP_LINE_H;
}

/** Natural [w,h] for a file `type` (catalog id / composite kind / source /
 *  annotation variant). Mirrors shared.tsx `baseSize`. `params` is read for a
 *  `medallion-table` (fork options) and for the `lakeflow*` blocks (a medallion
 *  LAYER DESC grows them); pass `n.params` so symbolic layout reserves the same
 *  box the node actually renders at. The node BOX is THEME-INVARIANT: slide changes only
 *  what's drawn INSIDE a node (icon/title size, hidden descriptions, flat cards), never
 *  its width or height, for every node kind, so no theme argument exists here.
 *  `card` (optional) is the card's text content: a
 *  `card` measures from it (its height depends on the wrapped text). Callers that have
 *  the node pass it. */
export function naturalSize(type: string, params?: Record<string, boolean | string>, sources?: MultiSourceItem[], card?: CardContent & { html?: string; padding?: number; style?: { padding?: number } }): { w: number; h: number } {
  if (type === "card" && card) { const l = cardLayout(card); return { w: l.w, h: l.h }; }
  if (type === "html") return htmlBlockLayout(card?.html, undefined, card?.padding ?? card?.style?.padding ?? 0);
  if (ANNOTATION_TYPES.has(type as AnnotationVariant)) return ANNOTATION_SIZE[type as AnnotationVariant];
  const c = CATALOG_BY_ID.get(type)?.c;
  const kind = c?.kind;
  // Lakeflow blocks grow when any medallion layer desc is set (matches baseSize).
  const lfDesc = !!(layerDescOf(params, "bronze") || layerDescOf(params, "silver") || layerDescOf(params, "gold"));
  if (kind === "lakeflow") return lfDesc ? { w: 312, h: 176 } : { w: 268, h: 148 };
  if (kind === "lakeflow-genie") return lfDesc ? { w: 380, h: 232 } : { w: 360, h: 208 };
  if (kind === "databricks-agent") return { w: 230, h: 170 };
  if (kind === "genie-code") return { w: 360, h: 112 };
  if (kind === "governance") return governanceSize(params);
  if (kind === "db-platform") return { w: 380, h: 60 };
  if (kind === "genie-one") return { w: 230, h: 78 }; // tile; persona pill floats over the top edge
  if (kind === "ai-gateway") return { w: 240, h: 104 }; // model-logo row on top + gateway body below
  if (kind === "multi-source") return multiSourceSize(sources, params);
  if (kind === "medallion-table") return medallionSize(params);
  if (type === "sdp") return { w: 230, h: 112 };
  // EVERY plain single-line catalog tile shares ONE footprint (230×54) so any
  // column of them lines up — Lakehouse, Genie Agent, Knowledge Assistant,
  // Supervisor Agent, Model Serving, … all identical. (Previously the size keyed
  // on whether a tile happened to carry a `sublabel`, so sibling agent tiles came
  // out different sizes — the bug this fixes.)
  if (c) return { w: 230, h: 54 };
  // Non-catalog ids: a demo-authored data source (`type:"source"`) has no catalog
  // entry — its own narrower default (a vertical caption swaps to VERTICAL_SOURCE_SIZE
  // via nodeFootprint).
  return { w: 200, h: 56 };
}

/** The full footprint of a captioned LOGO annotation — the icon square PLUS the
 *  caption laid out beside/below it (with a gap + a little padding). The logo
 *  now renders as a CENTERED flex of [icon][gap][text] filling this box (see
 *  AnnotationNode + RotatableCard), so the icon+caption reads as ONE centered
 *  unit inside a wrapping box / column. SINGLE source of truth so the layout
 *  (`computeLayout.sizeOf`), the ReactFlow node box (`nodeFootprint`), and the
 *  render all agree — otherwise the reserved slot and the drawn unit drift and
 *  the caption spills off-center (the bug this fixes).
 *
 *  Text width is ESTIMATED here (the lib can't measureText — that's the UI-only
 *  `logoFitSize`); the estimate is a slight over-reserve, which is harmless: the
 *  centered flex splits any spare space evenly so the unit stays centered.
 *  A caption-less logo returns the bare icon square. */
export const LOGO_CAP_GAP = 8;  // gap between icon and caption (matches the render)
export const LOGO_CAP_PAD = 4;  // breathing room so the caption never kisses the edge
export function logoFootprint(
  iconW: number,
  iconH: number,
  a: { caption?: AnnotationData["caption"]; text?: string; fontSize?: number; showDesc?: boolean; desc?: string },
): { w: number; h: number } {
  if (!a.text) return { w: iconW, h: iconH };
  const fs = a.fontSize ?? 15;
  // A caption may carry EXPLICIT newlines, and the renderer honours every one of
  // them. Reserving a single line height for a multi-line caption under-measures
  // the node by (lines - 1) * lineH, so the layout packs the next row that much
  // too close and the caption overlaps its neighbour. This was latent for as long
  // as the default was 13px (a 17px shortfall the row gaps happened to absorb);
  // raising the default to 15px widened it to 20px and tipped it into visible
  // collisions — 15 on one diagram. Measure the lines we actually draw.
  const capLines = String(a.text).split("\n").length;
  // Width comes from the LONGEST line, not the whole string: measuring the joined
  // length made a wrapped caption reserve a box far wider than it draws, which
  // pushes lanes apart for no reason.
  const longest = String(a.text).split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  // Medium-weight caption ≈ 0.62em/char (matches sizeOf's prior estimate).
  const textW = Math.ceil(longest * fs * 0.62);
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : (a.caption ?? "bottom");
  const horiz = capNorm === "right" || capNorm === "left";
  const lineH = Math.ceil(fs * 1.3) * capLines;
  // A DESC (2nd caption line, top/bottom only) reserves ~2 lines at the smaller font.
  const descFs = Math.max(10, fs - 2);
  const hasDesc = !!(a.showDesc && a.desc && !horiz);
  const descH = hasDesc ? Math.ceil(descFs * 1.3) * 2 + 2 : 0;
  const descW = hasDesc ? Math.min(220, Math.ceil((a.desc ?? "").length * descFs * 0.30) + 24) : 0;
  // A SIDE caption sits beside the icon, so the box is as tall as whichever is
  // taller. A 3-line caption next to an 18px icon overflowed the reserved iconH
  // and lapped the row below; no corpus diagram hits this yet, but it is the same
  // defect as the vertical case fixed above.
  // A little horizontal breathing room beyond the pad so the caption/desc don't
  // run right to the box edge (the "add a few extra px of width" ask). Vertical
  // captions only — a side caption's width is already icon-driven.
  const LOGO_CAP_SIDE_MARGIN = 12;
  if (horiz) return { w: iconW + LOGO_CAP_GAP + textW + LOGO_CAP_PAD * 2, h: Math.max(iconH, lineH) };
  // top/bottom (vertical): stack icon over caption (+ optional desc lines).
  return { w: Math.max(iconW, textW, descW) + LOGO_CAP_PAD * 2 + LOGO_CAP_SIDE_MARGIN, h: iconH + LOGO_CAP_GAP + lineH + descH };
}

/** The ICON square's sub-rect inside a captioned logo's BOX (same coordinate space
 *  as the box — absolute canvas coords). The logo renders as a CENTERED
 *  [icon][gap][caption(+desc)] flex filling the box, so the icon does NOT sit at
 *  the box centre — for a bottom caption it's in the upper part, etc. EDGE ANCHORS
 *  use this rect (not the full box) so a line always meets the icon the logo points
 *  at: a side anchor lands on the icon's centre, a top/bottom anchor on the icon's
 *  face — instead of the box centre out in the caption whitespace.
 *
 *  Mirrors `logoFootprint`'s decomposition so the icon rect matches the render.
 *  Returns the full box for a caption-less logo (the box IS the icon). */
/** Icon square a USER-SIZED logo's pictogram fills (the slot): the box's short
 *  axis minus the pads, and for a top/bottom caption minus the caption (+ desc)
 *  block, so the caption is never pushed out of the box. Pure; shared by the
 *  renderer (annotations.tsx) and the anchor geometry (logoIconRect). */
/** How a logo's caption font is resolved. `sized` = the logo has an explicit w/h
 *  (the user sized it; its footprint is the box, not logoFootprint). `dflt` = the
 *  theme's default caption size (render: 18 slide, 15 technical). */
export interface LogoLook { sized?: boolean; dflt?: number }
/** A user-sized logo's caption grows with its pictogram slot: slot × 0.25 (the natural
 *  60px icon maps to the 15px default, so only LARGER slots change), clamped to
 *  [dflt, LOGO_CAPTION_MAX_FONT]. Auto-sized logos and explicit `fontSize` are
 *  unchanged. The slot estimate is taken at the default size, so there is no loop. */
export const LOGO_CAPTION_MAX_FONT = 24;
export function logoCaptionFont(
  box: { w: number; h: number },
  a: { caption?: AnnotationData["caption"]; text?: string; fontSize?: number; showDesc?: boolean; desc?: string },
  look: LogoLook = {},
): number {
  const dflt = look.dflt ?? 15;
  if (a.fontSize !== undefined) return a.fontSize;
  if (!look.sized) return dflt;
  const slot = logoIconSlot(box, { ...a, fontSize: dflt }, look);
  return Math.max(dflt, Math.min(LOGO_CAPTION_MAX_FONT, Math.round(slot * 0.25)));
}

export function logoIconSlot(
  box: { w: number; h: number },
  a: { caption?: AnnotationData["caption"]; text?: string; fontSize?: number; showDesc?: boolean; desc?: string },
  look: LogoLook = {},
): number {
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : (a.caption ?? "bottom");
  const horiz = capNorm === "right" || capNorm === "left";
  if (horiz) return box.h - LOGO_CAP_PAD * 2;
  // Caption block height under the icon (same measure logoFootprint reserves).
  let capBlock = 0;
  if (a.text) {
    const fs = logoCaptionFont(box, a, look);
    const capLines = String(a.text).split("\n").length;
    const hasDesc = !!(a.showDesc && a.desc);
    capBlock = Math.ceil(fs * 1.3) * capLines + (hasDesc ? Math.ceil(Math.max(10, fs - 2) * 1.3) * 2 + 2 : 0);
  }
  return Math.min(box.w - LOGO_CAP_PAD * 2, box.h - LOGO_CAP_GAP - capBlock);
}

export function logoIconRect(
  box: { x: number; y: number; w: number; h: number },
  a: { caption?: AnnotationData["caption"]; text?: string; fontSize?: number; showDesc?: boolean; desc?: string },
  look: LogoLook = {},
): { x: number; y: number; w: number; h: number } {
  if (!a.text) return box;
  const fs = logoCaptionFont(box, a, look);
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : (a.caption ?? "bottom");
  const horiz = capNorm === "right" || capNorm === "left";
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // Icon square — matches the render (AnnotationNode `iconSq`): the natural logo
  // icon size for an AUTO-SIZED box (the box height already reserves
  // icon+gap+caption+desc, so the icon stays natural and the caption/desc fit),
  // capped so it never exceeds the box. When a box is smaller than natural (a user
  // shrink) the box-derived short axis wins. `ANNOTATION_SIZE.logo` is the natural
  // icon square — the same value the render uses via ANNOTATION_DEFAULT_SIZE.logo.
  const natural = ANNOTATION_SIZE.logo.h;
  const boxShort = logoIconSlot(box, a, look);
  // A user-sized logo draws its icon at the full slot (annotations.tsx), so the anchor
  // must use the same square; an auto-sized logo keeps the natural cap.
  const iconSq = look.sized ? Math.max(12, boxShort) : Math.max(12, Math.min(natural, boxShort));
  // Icon square, positioned as the render places it (icon hugs the caption-opposite
  // end of the centred group). Side anchors on this square hit the icon; the
  // caption-side anchor is handled by `logoAnchorPoint` (which snaps it to the box
  // edge so a line there clears the text).
  if (horiz) {
    const longest = String(a.text).split("\n").reduce((m, l) => Math.max(m, l.length), 0);
    const textW = Math.ceil(longest * fs * 0.62);
    const groupW = Math.min(box.w - LOGO_CAP_PAD * 2, iconSq + LOGO_CAP_GAP + textW);
    const groupLeft = cx - groupW / 2;
    const iconX = capNorm === "right" ? groupLeft : groupLeft + groupW - iconSq;
    return { x: iconX, y: cy - iconSq / 2, w: iconSq, h: iconSq };
  }
  const capLines = String(a.text).split("\n").length;
  const lineH = Math.ceil(fs * 1.3) * capLines;
  const descFs = Math.max(10, fs - 2);
  const hasDesc = !!(a.showDesc && a.desc);
  const descH = hasDesc ? Math.ceil(descFs * 1.3) * 2 + 2 : 0;
  const groupH = Math.min(box.h - LOGO_CAP_PAD * 2, iconSq + LOGO_CAP_GAP + lineH + descH);
  const groupTop = cy - groupH / 2;
  const iconY = capNorm === "top" ? groupTop + groupH - iconSq : groupTop;
  return { x: cx - iconSq / 2, y: iconY, w: iconSq, h: iconSq };
}

/** The exact anchor POINT for an edge end on a captioned logo, per side. On the
 *  three NON-caption sides it's the icon square's edge (via `logoIconRect` + the
 *  usual `sidePoint`); on the CAPTION side it's snapped OUT to the box edge so the
 *  line exits past the caption/desc text instead of starting on the icon and
 *  cutting through the text (a bottom-captioned logo's DOWN line starts below the
 *  text, not the icon). `frac` positions along the side as usual. Returns null for
 *  a non-logo / caption-less node so the caller uses the plain `sidePoint`. */
export function logoAnchorPoint(
  box: { x: number; y: number; w: number; h: number },
  side: "t" | "r" | "b" | "l",
  frac: number,
  a: { caption?: AnnotationData["caption"]; text?: string; fontSize?: number; showDesc?: boolean; desc?: string },
  look: LogoLook = {},
): { x: number; y: number } | null {
  if (!a.text) return null;
  const icon = logoIconRect(box, a, look);
  const capNorm = a.caption === "side" ? "right" : a.caption === "below" ? "bottom" : (a.caption ?? "bottom");
  // The caption side as a side LETTER, so it compares to `side` ("t"/"r"/"b"/"l").
  const capSide = capNorm === "top" ? "t" : capNorm === "bottom" ? "b" : capNorm === "left" ? "l" : "r";
  // On the caption side, ride the BOX edge (past the text). The along-axis coord
  // stays centred on the icon so the line lines up with the icon it leaves.
  if (side === capSide) {
    switch (side) {
      case "b": return { x: icon.x + icon.w / 2, y: box.y + box.h };
      case "t": return { x: icon.x + icon.w / 2, y: box.y };
      case "r": return { x: box.x + box.w, y: icon.y + icon.h / 2 };
      case "l": return { x: box.x, y: icon.y + icon.h / 2 };
    }
  }
  // Non-caption side: the icon square's edge at `frac`.
  switch (side) {
    case "t": return { x: icon.x + icon.w * frac, y: icon.y };
    case "b": return { x: icon.x + icon.w * frac, y: icon.y + icon.h };
    case "l": return { x: icon.x, y: icon.y + icon.h * frac };
    default:  return { x: icon.x + icon.w, y: icon.y + icon.h * frac }; // "r"
  }
}

// A SOURCE tile's label-fitted width for a horizontal (right/left) caption —
// the analog of `logoFootprint` for the `type:"source"` card (component-node →
// NodeCard "tile"): a fixed 36px icon square + a 10px gap + the label, inside
// 12px horizontal padding each side. Text width is ESTIMATED the same way as
// logoFootprint (semibold ≈ 0.62em/char) since the lib can't measureText. Used
// ONLY to size a lane group to its widest source; the natural (unfitted) box
// stays 200 for a lone source. */
const SOURCE_ICON = 36;   // h-9 w-9
const SOURCE_GAP = 10;    // gap-2.5
const SOURCE_PAD = 12;    // px-3
/** Default font (px) of a captioned source's label. */
const SOURCE_CAPTION_FONT = 13;
export function sourceCaptionWidth(label: string | undefined, fontSize = SOURCE_CAPTION_FONT): number {
  const textW = Math.ceil((label ?? "").length * fontSize * 0.62);
  return SOURCE_PAD + SOURCE_ICON + SOURCE_GAP + textW + SOURCE_PAD;
}

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
const ROW_GAP = 60;   // compact-enough slide grid; composition comes from topology,
                      //   not manufacturing aspect with giant empty row gaps
/** Non-float pinned banners: inset from the box edge, and the gap kept between the
 *  banner and the content it sits above/below. */
const PIN_BAND_INSET = 12;
const PIN_BAND_GAP = 20;
export const WRAP_PAD = 34;   // default container padding (breathing room so wrapped
                       //   content / nested boxes never sit flush to the border)
/** Row-gap clamp: a gap below ROW_GAP_MIN lets stacked tiles touch; above ROW_GAP_MAX
 *  the grid stops reading as a composition. */
const ROW_GAP_MIN = 20;
const ROW_GAP_MAX = 96;
/** Grid cell height (the standard single-line tile). Theme-invariant: slide changes
 *  only the INSIDE of nodes. */
const GRID_CELL_H = 54;
/** Default gap between a node and the anchor it is placed beside (leftOf/rightOf/
 *  above/below) and the default inset of a `pin` from its box edge. */
const RELATIONAL_GAP = 40;
const PIN_DEFAULT_PAD = 24;
/** The effective row gap for a file: `rowGap` clamped to [ROW_GAP_MIN, ROW_GAP_MAX]. */
function effectiveRowGap(v: number | undefined): number {
  return Math.max(ROW_GAP_MIN, Math.min(ROW_GAP_MAX, Math.round(v ?? ROW_GAP)));
}
/** Rotation helpers: a node's rotation is normalised to [0, 360); a quarter turn
 *  (90 or 270) swaps its footprint. */
const FULL_TURN = 360;
const QUARTER_TURN = 90;
/** Footprint of an un-placeable box (non-finite bounds): a fixed 200×100 stub. */
const NON_FINITE_BOX = { w: 200, h: 100 };

export interface ResolvedBox {
  x: number; y: number; w: number; h: number;
  /** DERIVED lane-uniform width for a captioned logo/source that's part of a
   *  same-lane group (see step 2.5). When set, every member of the group carries
   *  the SAME value (= the widest member's footprint), so the rendered card
   *  boxes match. Not persisted — recomputed on every parse. */
  laneW?: number;
}

/** A node's on-canvas footprint: its explicit `size` (or natural size), grown to fit a
 *  logo caption, a card's wrapped text, an html block or a wrapped description, with w/h
 *  swapped for a 90°/270° rotation. Shared by both layout engines and the canvas, so the
 *  slot reserved and the unit drawn agree. Pure. */
// On-canvas footprint: explicit `size` (or natural), with w/h SWAPPED for a
// 90°/270° rotation — a rotated tall node is a narrow one on the canvas.
export function nodeFootprint(n: FileNode, theme: ArchitectureTheme, groupFonts: Map<string, number>): { w: number; h: number } {
  const verticalSource = n.type === "source" && (n.caption === "top" || n.caption === "bottom");
  let s = n.size
    ? { w: n.size[0], h: n.size[1] }
    : verticalSource
      ? verticalSourceSize()
      : naturalSize(n.type, n.params, n.sources);
  // A captioned LOGO's full footprint = icon square + caption beside/below it
  // (the logo renders as a CENTERED icon+caption flex filling this box). Its
  // bare 60×60 icon size UNDER-reports the real footprint, so a `wraps` box or
  // column built from it would be too small for the label. Reserve the caption
  // room via the shared `logoFootprint` (same math the ReactFlow node box +
  // render use), so the reserved slot and the drawn unit agree. Explicit `size`
  // always wins.
  if (n.type === "logo" && !n.size && n.text) {
    s = logoFootprint(s.w, s.h, n); // theme-invariant footprint (slide changes only the INSIDE)
  }
  // A CARD's height is measured from its wrapped text (the same cardLayout the
  // render draws from). An explicit `size` sets the width and is a height floor.
  if (n.type === "card") {
    const l = cardLayout(withCardFont(n, groupFonts.get(n.id)), { w: n.size?.[0], h: n.size?.[1] });
    s = { w: l.w, h: l.h };
  }
  // An html block is measured from its HTML the same way (htmlBlockLayout); an explicit
  // `size` sets the width and is a height floor. Its frame padding is `style.padding`.
  if (n.type === "html") {
    const l = htmlBlockLayout(n.html, { w: n.size?.[0], h: n.size?.[1] }, n.style?.padding ?? 0);
    s = { w: l.w, h: l.h };
  }
  // Wrap-description grows a tile taller (same helper the RF node box + render
  // use) so lane stacking (cellSpan) reserves the real height and the tile below
  // doesn't overlap it. The wrapped-content height is a FLOOR even over an
  // explicit `size` height, so an authored `size:[300,56]` still reserves room
  // for its wrapped desc instead of clipping (matches nodeFootprint's floor).
  if (!verticalSource) {
    const descText = n.desc ?? CATALOG_BY_ID.get(n.type)?.c.desc;
    const extra = wrapDescExtraH({ desc: descText, showDesc: n.showDesc, wrapDesc: n.wrapDesc, vertical: false, theme }, s.w);
    if (extra > 0) {
      const base = n.size ? naturalSize(n.type, n.params, n.sources).h : s.h;
      s = { w: s.w, h: Math.max(s.h, base + extra) };
    }
  }
  const q = (((n.rot ?? 0) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return q === QUARTER_TURN || q === FULL_TURN - QUARTER_TURN ? { w: s.h, h: s.w } : s;
}

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
  // Same-size title-only cards share one derived title font (cardGroupFonts).
  const groupFonts = cardGroupFonts(nodes);
  // Clamp UNCHANGED (20..96). A blanket 44px floor was tried and reverted: on the
  // wrapper/lane paths `rowGap` is a gap between ACTUAL node extents, so 20 is
  // legitimately tight (governance-layout.jsonc's `rowGap:20` tab is exactly this
  // — `rowGrid:false`, no vertical sources), and a floor there loosens correct
  // diagrams. MEASURED: raising it broke the wrapper contract that `rowGap` is
  // honoured 1:1 across its whole range (test:layout asserts separation(96) -
  // separation(20) == 76).
  //
  // ⚠ But `cellSpan` below does NOT make the fixed-pitch grid safe at every gap —
  // it only advances the auto-assign cursor. MEASURED with two `type:"source"`
  // vertical-caption cards (h=116) in one lane on the slide theme:
  //   EXPLICIT rows 1,2 → rowGap 20 OVERLAPS 24px, 36 overlaps 8px, 44 is exactly
  //                       flush, 60 clears by 16px
  //   AUTO rows        → clear at every gap (cellSpan reserved a second cell)
  // So an author who writes adjacent rows AND a tight gap gets a real overlap.
  // That is caught downstream as a browser NODE OVERLAPS fault and, since v-next,
  // as a pure content fault in validateArchitecture (see the row-pitch check
  // there) — it is an AUTHORING conflict to report, not a gap to silently widen.
  const rowGap = effectiveRowGap(file.rowGap);
  const theme: ArchitectureTheme = resolveTheme(file.theme);
  const sizeOf = (n: FileNode) => nodeFootprint(n, theme, groupFonts);
  // A nested file arrives already solved (lib/arch-layout.ts): every node at its centre,
  // every box sized. Take it verbatim — none of the lane passes below may adjust it.
  if (file._tree) {
    for (const n of nodes) if (Array.isArray(n.at)) { const s = sizeOf(n); out.set(n.id, { x: n.at[0], y: n.at[1], w: s.w, h: s.h }); }
    return out;
  }

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
    // A captioned SOURCE's natural size is a fixed 200 that truncates its label;
    // its real (label-fitted) width is what step 2.5 imposes on the lane group, so
    // reserve THAT here too — otherwise a wide source column would overlap its
    // neighbour (inter-column spacing keys off colWidth).
    const laneCapW = (n: FileNode) =>
      n.type === "source" && !n.size && n.label && !Array.isArray(n.at)
        ? sourceCaptionWidth(n.label, n.fontSize ?? SOURCE_CAPTION_FONT) // theme-invariant caption width
        : 0;
    colWidth.set(col, Math.max(...list.map((n) => Math.max(sizeOf(n).w, laneCapW(n)))));
  }
  // How much a column's content is INSET by the boxes wrapping it: each ancestor
  // box adds its `pad` to every side, so the box's outer edge sits `Σpad` beyond
  // the lane content. Two adjacent lanes wrapped in nested boxes would otherwise
  // have their OUTER boxes overlap (INTER_COL_GAP is a lane-content gap, but the
  // boxes bulge into it). We widen the lane separation by the facing insets so
  // the gap survives BETWEEN the boxes, at whatever nesting depth. A node belongs
  // to a column iff it's laned there; a box wraps the column iff it (transitively)
  // wraps any of that column's laned nodes.
  const colNodeIds = new Map<string, Set<string>>();
  for (const [col, list] of byCol) colNodeIds.set(col, new Set(list.map((n) => n.id)));
  // The boxes (with their pad) that transitively wrap a given column's content.
  // Used to space adjacent lanes: a box wrapping BOTH lanes is a common ancestor
  // and does NOT separate them (it just contains the pair); only boxes wrapping
  // exactly ONE side push its edge toward the neighbour, so only those count as
  // "facing" overhang. This keeps the visible gap between adjacent boxes equal to
  // INTER_COL_GAP at any nesting depth (unboxed lanes → no boxes → plain gap).
  const boxesForCol = (col: string): Map<string, number> => {
    const ids = colNodeIds.get(col);
    const res = new Map<string, number>();
    if (!ids || !ids.size) return res;
    const wrapsCol = (boxId: string, seen = new Set<string>()): boolean => {
      if (seen.has(boxId)) return false;
      seen.add(boxId);
      const b = nodes.find((n) => n.id === boxId);
      for (const cid of b?.wraps ?? []) {
        if (ids.has(cid) || wrapsCol(cid, seen)) return true;
      }
      return false;
    };
    for (const n of nodes) {
      if (n.wraps && n.wraps.length && !Array.isArray(n.at) && wrapsCol(n.id)) {
        res.set(n.id, n.pad ?? WRAP_PAD);
      }
    }
    return res;
  };
  const colBoxes = new Map(cols.map((c) => [c, boxesForCol(c)]));
  // Facing overhang from a lane toward its right neighbour = Σpad of boxes that
  // wrap THIS lane but not the neighbour (common ancestors excluded).
  const facingInset = (col: string, other: string): number => {
    const mine = colBoxes.get(col) ?? new Map();
    const theirs = colBoxes.get(other) ?? new Map();
    let s = 0;
    for (const [id, pad] of mine) if (!theirs.has(id)) s += pad;
    return s;
  };
  const colX = new Map<string, number>();
  {
    let prevRightFacing = 0; // right-facing overhang of the previous lane's boxes
    let contentRight = 0;    // running right edge of the previous lane's CONTENT
    cols.forEach((c, i) => {
      const w = colWidth.get(c) ?? DEFAULT_COL_W;
      const leftFacing = i === 0 ? 0 : facingInset(c, cols[i - 1]);
      // gap between CONTENT edges = INTER_COL_GAP + both facing overhangs, so the
      // BOX edges end up exactly INTER_COL_GAP apart.
      const cx = i === 0 ? 0 : contentRight + prevRightFacing + INTER_COL_GAP + leftFacing + w / 2;
      colX.set(c, cx);
      contentRight = cx + w / 2;
      prevRightFacing = i + 1 < cols.length ? facingInset(c, cols[i + 1]) : 0;
    });
  }
  if (file.rowGrid) {
    // SHARED ROW GRID: `row` aligns across ALL columns. Every laned node with the
    // same `row` shares one horizontal band; the band's height is the tallest
    // node in it; bands stack top→bottom (`rowGap` apart) centered on y=0. X still
    // comes from the node's own column lane.
    //
    // A node WITHOUT a `row` falls back to stacking within its OWN column, exactly
    // like non-grid mode: it takes the next free band DOWN from that column's last
    // numbered node (so two unnumbered nodes in a lane stack, they don't each grab
    // a separate band). So `rowGrid` works with or without `row` set — set it to
    // align across columns, omit it to just stack in the lane.
    const rowOf = new Map<string, number>();
    const nextFree = new Map<string, number>(); // per-column running row for unnumbered nodes
    // Cells a node occupies (≥1) — a node taller than one pitch spans extra rows.
    const cellSpan = (n: FileNode) => Math.max(1, Math.ceil(sizeOf(n).h / (GRID_CELL_H + rowGap)));
    // TWO PASSES, so the result is INDEPENDENT of node order in the file: every
    // NUMBERED node reserves its rows first, then the unnumbered ones stack below
    // the column's last numbered row in file order. (One pass was order-dependent:
    // an unnumbered node listed BEFORE its column's numbered ones grabbed row 1 on
    // top of them — and the save path re-emits nodes sorted by id, so a tab that
    // rendered fine from its authored order broke on its first autosave.)
    const numbered = (n: FileNode) => typeof n.row === "number" && Number.isFinite(n.row) && Number.isInteger(n.row);
    for (const n of laned) {
      if (!numbered(n)) continue;
      rowOf.set(n.id, n.row!);
      // an unnumbered node in this lane resumes stacking BELOW this row's span
      nextFree.set(n.col!, Math.max(nextFree.get(n.col!) ?? 1, n.row! + cellSpan(n)));
    }
    for (const n of laned) {
      if (numbered(n)) continue;
      const r = nextFree.get(n.col!) ?? 1;
      rowOf.set(n.id, r);
      nextFree.set(n.col!, r + cellSpan(n)); // advance by this node's span
    }
    // FIXED-PITCH GRID. Every row sits on a CONSTANT grid line (row r at
    // r × ROW_PITCH), so a tile at row 3 in one column ALWAYS lands on the same
    // Y line regardless of a taller node at row 3 in another column. A node
    // TALLER than one cell simply OVERFLOWS downward past its line (into the
    // next cell's space) — it does NOT push other columns or inflate the row.
    // Nodes are TOP-ALIGNED to their row line, so a short tool and a tall
    // medallion sharing a row both start at the same top edge (no gap). The
    // per-column `cellSpan` above keeps a tall node from getting another node
    // stacked on top of it WITHIN its own lane, but the shared grid lines are
    // fixed and independent of node heights.
    const CELL_H = GRID_CELL_H;    // ordinary tile height for the active theme
    const ROW_PITCH = CELL_H + rowGap; // one grid cell = a standard tile + requested gap
    const present = [...new Set([...rowOf.values()])];
    const minR = Math.min(...present);
    const maxR = Math.max(...present);
    // Fixed line (TOP of the cell) for each integer row; walking min→max means a
    // SKIPPED row number still consumes one pitch (the 0,2,4 spacing lever).
    const rowTopY = new Map<number, number>();
    for (let r = minR; r <= maxR; r++) rowTopY.set(r, (r - minR) * ROW_PITCH);
    const totalH = (maxR - minR) * ROW_PITCH + CELL_H; // last cell's tile height
    const shift = totalH / 2; // recenter the whole grid on y=0
    for (const n of laned) {
      const s = sizeOf(n);
      const r = rowOf.get(n.id)!;
      // Top-align the node to its row line (its center = line-top + own h/2), so
      // tiles on the same row share a top edge and a tall node overflows down.
      const y = rowTopY.get(r)! + s.h / 2 - shift;
      out.set(n.id, { x: colX.get(n.col!) ?? 0, y, w: s.w, h: s.h });
    }
  } else {
    for (const [col, list] of byCol) {
      const rowNumber = (n: FileNode) => typeof n.row === "number" && Number.isFinite(n.row) ? n.row : 0;
      list.sort((a, b) => rowNumber(a) - rowNumber(b)); // stable-ish; appearance order kept for ties
      const x = colX.get(col) ?? 0;
      const heights = list.map((n) => sizeOf(n).h);
      const total = heights.reduce((s, h) => s + h, 0) + rowGap * (list.length - 1);
      let cy = -total / 2; // center the stack on y=0
      list.forEach((n, i) => {
        const s = sizeOf(n);
        out.set(n.id, { x, y: cy + heights[i] / 2, w: s.w, h: s.h });
        cy += heights[i] + rowGap;
      });
    }
  }

  // 2.5) UNIFORM-WIDTH + ICON-ALIGN a lane's captioned tiles. A frequent pattern
  //   is a column of right-caption LOGOS (a domain / table list) OR captioned
  //   SOURCE tiles (Salesforce / Kafka streams / PDF contracts) with DIFFERENT-
  //   length labels. Each tile's box hugs its own icon+text, so the boxes come out
  //   different widths and — since every box is centered on the lane X — the ICONS
  //   zigzag. Instead, size the whole GROUP to the WIDEST member and give every
  //   member that SAME width, then align each tile's ICON to the lane's caption-
  //   side content edge: the boxes read as one clean column of equal cards and the
  //   icons form a single vertical line. Only runs for a GROUP (2+ such tiles on
  //   one caption side in a lane); a lone tile keeps its natural width + centering.
  //
  //   The uniform width is stashed on the resolved box as `laneW` (DERIVED — never
  //   serialized) so the ReactFlow node box + the card render honor it instead of
  //   re-deriving from the label. Sources also get `box.w`/`box.h` set to the
  //   fitted footprint (their natural size is a fixed 200 that truncates the label).
  {
    // A captioned LOGO or SOURCE with a horizontal (right/left) caption + label.
    // "side" is the legacy alias for right. Pinned (`at`) tiles are left alone
    // HERE because this branch also moves `box.x`; the vertical pass below does
    // not move anything and so can include them.
    const horizCapTile = (n: FileNode): "left" | "right" | null => {
      if (Array.isArray(n.at)) return null;
      const label = n.type === "logo" ? n.text : n.type === "source" ? n.label : undefined;
      if (!label) return null;
      // A SOURCE with no explicit caption renders "right" by default (matches
      // component-node's `d.sourceCaption ?? "right"`); a LOGO with no caption
      // renders "bottom" (vertical), so it's NOT part of a horizontal group.
      const raw = n.caption ?? (n.type === "source" ? "right" : undefined);
      const c = raw === "side" ? "right" : raw;
      return c === "right" ? "right" : c === "left" ? "left" : null;
    };
    // A captioned LOGO with a VERTICAL (top/bottom) caption — the other half of the
    // same problem, and the more common one: bottom is the default for a logo, so
    // a column of environment/workspace marks hits this and not the branch above.
    //
    // `logoFootprint` makes a vertical logo's width `max(icon, caption, desc) + pad`
    // and the render CENTRES the icon in it, so caption length sets the tile width
    // and every edge terminating on that border lands at a different distance from
    // the icon. Captions "Dev" / "Staging" / "Production" measured 139 / 176 / 204px
    // and produced three different join positions in one lane — it reads as a
    // routing bug and it is the text length.
    //
    // Unlike the horizontal case this needs NO x shift: equal width + a centred icon
    // already puts every icon on the lane centre. That is what makes it safe for
    // PINNED nodes too, and pinned is exactly where hand-composed slides live.
    const vertCapLogo = (n: FileNode): boolean => {
      if (n.type !== "logo" || !n.text) return false;
      const raw = n.caption ?? "bottom";           // a logo defaults to bottom
      const c = raw === "below" ? "bottom" : raw;
      return c === "bottom" || c === "top";
    };
    // Fitted horizontal footprint width for a group member (label-dependent):
    // logos via logoFootprint, sources via the source-card estimate. Explicit
    // `size` wins (the tile isn't reflowed).
    const fittedW = (n: FileNode): number => {
      if (n.size) return sizeOf(n).w;
      if (n.type === "logo") return sizeOf(n).w; // sizeOf already applies logoFootprint
      return Math.max(sourceCaptionWidth(n.label, n.fontSize ?? SOURCE_CAPTION_FONT), naturalSize(n.type, n.params, n.sources).w); // theme-invariant caption width
    };
    for (const [col, list] of byCol) {
      const tiles = list.filter((n) => horizCapTile(n));
      if (tiles.length < 2) continue;
      const laneCx = colX.get(col) ?? 0;
      // Group by caption side (a lane could mix, though rare) so each side aligns
      // to its own edge: right-caption icons hug the lane's LEFT edge; left-caption
      // icons (text-then-icon) hug the lane's RIGHT edge.
      for (const side of ["right", "left"] as const) {
        const group = tiles.filter((n) => horizCapTile(n) === side);
        if (group.length < 2) continue;
        // The GROUP's uniform width = the widest member's fitted footprint. Every
        // member is sized to this so the cards match; the icons then line up
        // because equal box widths + equal inner pad ⇒ equal icon edges.
        const maxW = Math.max(...group.map(fittedW));
        for (const n of group) {
          const box = out.get(n.id);
          if (!box) continue;
          box.w = maxW;
          box.laneW = maxW; // DERIVED signal to flow-mapping + the render
          // The icon sits at the box's caption-side edge (right-caption → icon at
          // box LEFT; left-caption → icon at box RIGHT). Shift the center so that
          // edge aligns to the lane's matching content edge — shared across the
          // group (all boxes now share `maxW`, so this yields ONE x for all).
          box.x = side === "right"
            ? laneCx - maxW / 2 + box.w / 2   // icon (box left) → lane left edge
            : laneCx + maxW / 2 - box.w / 2;  // icon (box right) → lane right edge
        }
      }
    }

    // ---- VERTICAL (top/bottom) captions, INCLUDING pinned nodes --------------
    // Same defect, different geometry, and it needs its own grouping key: a pinned
    // slide has no `col`, so `byCol` cannot see it. Group instead by the COLUMN THE
    // NODES ACTUALLY SHARE — their resolved centre x, rounded to a tolerance — which
    // works for symbolic and pinned alike and needs no new authoring field.
    //
    // Width only. Nothing moves, so a pinned composition keeps every coordinate the
    // author chose; the tiles just stop being different widths for no reason.
    {
      const CENTRE_TOL = 8;   // px; two logos this close in x are one visual column
      const MIN_GROUP = 2;    // a lone logo keeps its natural width
      const candidates = nodes.filter(vertCapLogo);
      // Bucket by rounded centre x of the RESOLVED box (post-placement), so this
      // works the same whether x came from `col`, `at`, or a relational hint.
      const buckets = new Map<number, FileNode[]>();
      for (const n of candidates) {
        const box = out.get(n.id);
        if (!box) continue;
        const key = Math.round(box.x / CENTRE_TOL) * CENTRE_TOL;
        const list = buckets.get(key) ?? [];
        list.push(n);
        buckets.set(key, list);
      }
      for (const group of buckets.values()) {
        if (group.length < MIN_GROUP) continue;
        // Widest FITTED footprint in the group. An explicit `size` participates in
        // the max (the author asked for that width) but is NOT overwritten below:
        // an explicit size is a decision, and silently widening it would make the
        // escape hatch unusable.
        const maxW = Math.max(...group.map((n) => sizeOf(n).w));
        for (const n of group) {
          if (n.size) continue;               // respect an explicit author size
          const box = out.get(n.id);
          if (!box) continue;
          box.w = maxW;
          box.laneW = maxW;                   // DERIVED — never serialized
        }
      }
    }
  }

  // 3) Any node still unplaced (no `at`, no resolvable `col`, not a wrapper) →
  //    park at origin (shouldn't happen with well-formed files).
  //    EXCEPTION: a node whose ONLY placement is "inside a wrapping box" (no
  //    col/at/relational, but named in some box's `wraps`) is AUTO-SEEDED: it
  //    stacks vertically inside its box starting at row 0, in wraps-order. This
  //    lets you author `wraps:[a,b]` + `below:x` with NO position on a/b at all
  //    — step 4 sizes the box around the seeds, then recenters them inside it
  //    (see `autoSeeded` below). Mixed boxes work too: explicit col/row children
  //    keep their lane; bare children fill the box body underneath.
  const autoSeeded = new Set<string>();
  // Provisional Y per wrapped-only child, cumulative by actual height + rowGap,
  // so the box that wraps them sizes to the SAME tight stack the recenter uses
  // (a fixed step would size the box wrong for >1 seed). In a MIXED box (some
  // children placed by col/at/relational, some bare) the bare ones stack BELOW
  // the placed ones — we start `cy` at the bottom of the already-resolved
  // wrapped children (they were placed in steps 1–2) so seeds don't overlap them.
  const isBare = (c: FileNode | undefined): c is FileNode =>
    !!c && !Array.isArray(c.at) && !c.wraps && !c.col && !c.leftOf && !c.rightOf &&
    !c.alignX && !c.alignY && !c.below && !c.above;
  const seedY = new Map<string, number>();
  for (const b of nodes) {
    // Bottom of this box's placed (non-bare) wrapped children, if any — bare
    // children begin their stack a rowGap below that; else at 0 (pure box).
    let placedBottom = -Infinity;
    for (const cid of b.wraps ?? []) {
      const r = out.get(cid);
      if (r) placedBottom = Math.max(placedBottom, r.y + r.h / 2);
    }
    let cy = placedBottom > -Infinity ? placedBottom + rowGap : 0;
    for (const cid of b.wraps ?? []) {
      if (seedY.has(cid)) continue; // first wrapping box wins
      const c = nodes.find((x) => x.id === cid);
      if (!isBare(c)) continue; // only bare children are auto-seeded
      const h = sizeOf(c).h;
      seedY.set(cid, cy + h / 2);
      cy += h + rowGap;
    }
  }
  for (const n of nodes) {
    if (out.has(n.id) || n.wraps) continue;
    const s = sizeOf(n);
    // A y-relational node that names a real `col` keeps that lane's X (so it
    // stays IN the column at its relational height).
    if (n.col && colX.has(n.col)) {
      out.set(n.id, { x: colX.get(n.col)!, y: 0, w: s.w, h: s.h });
      continue;
    }
    // Wrapped-only node with no position → auto-seed, stacked by wraps-order.
    if (seedY.has(n.id)) {
      autoSeeded.add(n.id);
      out.set(n.id, { x: 0, y: seedY.get(n.id)!, w: s.w, h: s.h });
      continue;
    }
    // True orphan → park at origin.
    out.set(n.id, { x: 0, y: 0, w: s.w, h: s.h });
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
      const gap = n.gap ?? RELATIONAL_GAP;
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
    // Relational children of each node (whatever hangs off it, any direction).
    // Base placement resolved them against the anchor's PRE-fan position, so when
    // fan-out moves a sibling its whole subtree must move with it — else a 2×2
    // grid (two siblings below X, one card below each) leaves the second row
    // behind at the old spot, where it overlaps itself and gets nudged off-grid.
    const children = new Map<string, string[]>();
    for (const n of rels) {
      const ref = n[dirOf(n)!] as string;
      (children.get(ref) ?? children.set(ref, []).get(ref)!).push(n.id);
    }
    const shiftSubtree = (id: string, axis: "x" | "y", delta: number, seen = new Set<string>([id])) => {
      if (!delta) return;
      for (const cid of children.get(id) ?? []) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        const cb = out.get(cid);
        if (!cb) continue;
        if (axis === "y") cb.y += delta; else cb.x += delta;
        shiftSubtree(cid, axis, delta, seen);
      }
    };
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
      const placed = sibs.map((n) => ({ id: n.id, b: out.get(n.id)! })).filter((p) => p.b);
      const total = placed.reduce((s, p) => s + ext(p.b), 0) + SIB_GAP * (placed.length - 1);
      let cursor = center - total / 2;
      placed.forEach(({ id, b }) => {
        const c = cursor + ext(b) / 2;
        const was = axis === "y" ? b.y : b.x;
        if (axis === "y") b.y = c; else b.x = c;
        shiftSubtree(id, axis, c - was);
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
  // Deepest children first (a box sizes around already-placed children); at equal
  // depth, a box positioned relative to ANOTHER box (below/above/alignY) resolves
  // AFTER its anchor so the anchor's rect exists when we shift.
  const relRef = (n: FileNode) => (n.alignY ?? n.above ?? n.below) as string | undefined;
  boxes.sort((a, b) => {
    const d = depth(b.id) - depth(a.id);
    if (d) return d;
    if (relRef(a) === b.id) return 1;  // a depends on b → a after b
    if (relRef(b) === a.id) return -1;
    return 0;
  });

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
    // An INSIDE title (titlePos top/bottom) reserves its band at that edge instead
    // of the border title's subtitle strip below. Border titles keep the old path.
    const inside = kids.length && isInsideTitlePos(w.titlePos) ? w.titlePos : undefined;
    // Override sides from explicit `bounds`.
    const bn = w.bounds;
    let left = bn?.left ? sideCoord(bn.left, "x") ?? L : L;
    let right = bn?.right ? sideCoord(bn.right, "x") ?? R : R;
    // `size` is a MINIMUM for a wrapping box: widen it symmetrically about the
    // members so they stay centred horizontally (height is handled after the bands).
    const minSize = kids.length && w.size ? w.size : undefined;
    if (minSize && right - left < minSize[0]) {
      const cx = (left + right) / 2;
      left = cx - minSize[0] / 2;
      right = cx + minSize[0] / 2;
    }
    // A border title wider than the members widens the box the same way.
    const titleW = kids.length && !inside ? boxBorderTitleW(w, theme) : 0;
    if (right - left < titleW) {
      const cx = (left + right) / 2;
      left = cx - titleW / 2;
      right = cx + titleW / 2;
    }
    // A subtitle sits under the title, above the members: grow the box upward by its
    // height, measured at the box's FINAL width (the same width the renderer wraps at).
    if (kids.length && w.subtitle && !inside) T -= boxSubtitleH(w.subtitle, right - left);
    // The inside band depends on the box width (the title wraps inside it).
    const band = inside ? insideTitleMetrics(w, right - left).band : 0;
    const topBand = inside === "top" || inside === "top-left" ? band : 0;
    const bottomBand = inside === "bottom" || inside === "bottom-left" ? band : 0;
    const topFromBounds = bn?.top ? sideCoord(bn.top, "y") : undefined;
    const bottomFromBounds = bn?.bottom ? sideCoord(bn.bottom, "y") : undefined;
    const top = topFromBounds ?? T - topBand;
    const bottom = bottomFromBounds ?? B + bottomBand;
    if (![left, right, top, bottom].every(Number.isFinite)) {
      out.set(w.id, { x: 0, y: 0, ...NON_FINITE_BOX });
      continue;
    }
    // RESERVE bands for NON-float pinned children docking into this box. The
    // band is what the banner needs — its height + the inset it sits at from the
    // box edge + a modest gap before the content — and the box's own `pad` is
    // PART of that zone, not added on top of it. (Adding both left a ~52-unit
    // empty strip between banner and first row.) Float pins reserve nothing.
    let top2 = top, bottom2 = bottom;
    const docked = nodes.filter((n) => n.pin && !n.pin.float && !Array.isArray(n.at) && n.pin.to === w.id);
    // Top band: the ORIGINAL reservation (banner + 12 + 12, on top of the pad). The
    // tightened form moved edge routing into new crossings on the reference
    // `databricks-agent` (eval gate), so only the bottom band is tightened for now.
    const bandOldTop = () => {
      const hs = docked.filter((n) => n.pin!.at.startsWith("top")).map((n) => sizeOf(n).h);
      return hs.length ? Math.max(...hs) + 2 * PIN_BAND_INSET : 0;
    };
    const bandNeed = (vside: "top" | "bottom") => {
      const hs = docked
        .filter((n) => (n.pin!.at.startsWith("top") ? "top" : n.pin!.at.startsWith("bottom") ? "bottom" : "") === vside)
        .map((n) => sizeOf(n).h);
      return hs.length ? Math.max(...hs) + PIN_BAND_INSET + PIN_BAND_GAP : 0;
    };
    // `top`/`bottom` already include `pad`, so only the excess over it grows the box.
    top2 -= bandOldTop();
    bottom2 += Math.max(0, bandNeed("bottom") - pad);
    // `size` minimum, vertical: the box is top-aligned under its title band and
    // grows DOWNWARD to the authored height, so a row of same-height boxes lines up.
    if (minSize && bottom2 - top2 < minSize[1]) bottom2 = top2 + minSize[1];
    out.set(w.id, { x: (left + right) / 2, y: (top2 + bottom2) / 2, w: right - left, h: bottom2 - top2 });

    // A wrapping box may ALSO be positioned relative to another node/box via
    // `below`/`above`/`alignY` (a box's position is otherwise 100% wrap-derived,
    // so there was no way to say "metastore BELOW the workspaces"). We do it HERE,
    // after the box is sized, and SHIFT the box + its whole wrapped subtree by the
    // delta — so its contents move with it. Boxes resolve deepest-first, so an
    // ANCESTOR box (resolved later) re-sizes around the moved box automatically.
    // (leftOf/rightOf intentionally not supported for boxes yet — below/above/
    // alignY cover the "stack a container under/over another" case.)
    const bdir = w.alignY ? "alignY" : w.above ? "above" : w.below ? "below" : undefined;
    if (bdir) {
      const self = out.get(w.id)!;
      const a = out.get((w[bdir] as string) ?? "");
      if (a) {
        const gap = w.gap ?? RELATIONAL_GAP;
        const targetY =
          bdir === "alignY" ? a.y
          : bdir === "below" ? a.y + a.h / 2 + gap + self.h / 2
          : a.y - a.h / 2 - gap - self.h / 2; // above
        const dy = targetY - self.y;
        if (dy) {
          // Shift this box + every descendant it (transitively) wraps.
          const subtree = new Set<string>([w.id]);
          const collect = (id: string) => {
            const bx = boxes.find((b) => b.id === id);
            for (const cid of bx?.wraps ?? []) if (!subtree.has(cid)) { subtree.add(cid); collect(cid); }
          };
          collect(w.id);
          for (const id of subtree) { const r = out.get(id); if (r) r.y += dy; }
        }
      }
    }

    // Recenter this box's AUTO-SEEDED children into its interior: center them on
    // the box's X and stack them in wraps order. Placed (col/at/relational)
    // children are untouched — so a MIXED box keeps its explicit children in
    // place and stacks the bare ones BELOW them (starting a rowGap under the
    // lowest placed child, or from the top pad if the box is pure auto-seed).
    // Done last so it uses the box's FINAL rect (after any below/above shift).
    const self = out.get(w.id);
    const seeds = (w.wraps ?? []).filter((cid) => autoSeeded.has(cid));
    if (self && seeds.length) {
      // Bottom of the placed (non-seed) wrapped children within this box.
      let placedBottom = -Infinity;
      for (const cid of w.wraps ?? []) {
        if (autoSeeded.has(cid)) continue;
        const r = out.get(cid);
        if (r) placedBottom = Math.max(placedBottom, r.y + r.h / 2);
      }
      // An inside-top title's band sits above the seeds, so they start below it.
      let cy = placedBottom > -Infinity ? placedBottom + rowGap : self.y - self.h / 2 + pad + topBand;
      seeds.forEach((cid, i) => {
        const r = out.get(cid);
        if (!r) return;
        r.x = self.x;
        r.y = cy + r.h / 2;
        cy += r.h + (i < seeds.length - 1 ? rowGap : 0); // tight in-box stack
      });
    }
  }

  // 4.5) SIBLING BOXES IN ONE ROW share a height. A row of stage/column boxes (each wraps its
  //      own stack) would otherwise end at its own last card: a 2-card stage beside a 3-card one leaves
  //      an empty tail that reads as unfinished. A LEAF box (wraps only tiles) whose top lines up with
  //      a side-by-side sibling under the same parent is grown DOWNWARD to the tallest of the group —
  //      no child moves, so this never shifts content. Pinned, `bounds`-sized, relationally placed
  //      (below/above/alignY), or relationally referenced boxes are left alone.
  {
    const related = new Set<string>();
    for (const n of nodes) for (const k of [n.below, n.above, n.alignY]) if (typeof k === "string") related.add(k);
    const parentOf = (id: string) => boxes.find((b) => b.wraps?.includes(id))?.id ?? "";
    const isLeaf = (w: FileNode) =>
      !Array.isArray(w.at) && !w.bounds && !w.pin && !w.below && !w.above && !w.alignY &&
      !related.has(w.id) && out.has(w.id) &&
      !(w.wraps ?? []).some((c) => boxes.some((b) => b.id === c));
    const leaves = boxes.filter(isLeaf);
    const taken = new Set<string>();
    for (const w of leaves) {
      if (taken.has(w.id)) continue;
      const me = out.get(w.id)!;
      const group = leaves.filter((o) => {
        if (taken.has(o.id) || parentOf(o.id) !== parentOf(w.id)) return false;
        const b = out.get(o.id)!;
        return Math.abs(b.y - b.h / 2 - (me.y - me.h / 2)) <= 4;
      });
      // Side by side only: horizontal extents must not overlap (a stacked pair is not a row).
      const disjoint = group.every((a, i) => group.every((b, j) => i >= j || (() => {
        const A = out.get(a.id)!, B = out.get(b.id)!;
        return A.x + A.w / 2 <= B.x - B.w / 2 + 1 || B.x + B.w / 2 <= A.x - A.w / 2 + 1;
      })()));
      if (group.length < 2 || !disjoint) continue;
      const top = me.y - me.h / 2;
      const H = Math.max(...group.map((g) => out.get(g.id)!.h));
      for (const g of group) {
        const b = out.get(g.id)!;
        if (b.h === H) continue;
        b.h = H;
        b.y = top + H / 2;
      }
      for (const g of group) taken.add(g.id);
    }
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
      if (n.pin!.at === "above" || n.pin!.at === "below") {
        // Outside the box: centred on it, `pad` (default 24) beyond its edge.
        const gap = n.pin!.pad ?? PIN_DEFAULT_PAD;
        const w = n.pin!.fill ? target.w : s.w;
        const dir = n.pin!.at === "above" ? -1 : 1;
        out.set(n.id, { x: target.x, y: target.y + dir * (target.h / 2 + gap + s.h / 2), w, h: s.h });
        continue;
      }
      const pad = n.pin!.pad ?? 16;
      const [ax, ay] = ANCHORS[n.pin!.at] ?? [0, 0];
      if (!n.pin!.float) {
        // Docked into a reserved band: x = left/center/right edge of the box
        // (inset by half size + pad); y = the band centre at the box edge
        // (the box already grew to make room, so it sits BELOW/ABOVE content).
        const x = target.x + ax * (target.w / 2 - s.w / 2 - pad);
        const y = target.y + ay * (target.h / 2 - s.h / 2 - PIN_BAND_INSET);
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
  if (n.wraps?.length && n.size) p.minSize = [n.size[0], n.size[1]];
  return Object.keys(p).length ? p : undefined;
}

/** Parse a single-architecture body into the resolved schema.
 *  `defaultLogosOn` sets the vendor-logo toggle's initial state ONLY when the
 *  file hasn't explicitly set `options.trademarkLogos` — so an env-driven /
 *  build-time default (public off, internal on) applies to un-toggled diagrams
 *  while an explicit per-diagram choice always wins. Defaults to `false` (the
 *  public default) so existing callers are unchanged. */
/** Automatic z-index for wrapping boxes so they render BEHIND their children
 *  without the author having to set `z` by hand. A box that `wraps` sits at a
 *  NEGATIVE z; nesting goes one level deeper (children above parents): a box
 *  whose deepest wrap-chain (counting itself) is D boxes gets z = -D. So a leaf
 *  wrapper (wraps only tiles) = -1, a box wrapping that = -2, etc. Tiles/edges
 *  stay at their defaults (≥0), always above every box. An EXPLICIT `z` on a box
 *  still wins (the author can override). Returns a map of box id → auto z. */
function autoBoxZ(file: ArchitectureFile): Map<string, number> {
  const nodes = file.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isBox = (id: string) => !!byId.get(id)?.wraps?.length;
  const depthMemo = new Map<string, number>();
  // Longest chain of NESTED boxes starting at this box (counting itself).
  const boxDepth = (id: string, seen = new Set<string>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 1; // cycle guard
    seen.add(id);
    let deepestChild = 0;
    for (const cid of byId.get(id)?.wraps ?? []) {
      if (isBox(cid)) deepestChild = Math.max(deepestChild, boxDepth(cid, seen));
    }
    seen.delete(id);
    const d = 1 + deepestChild;
    depthMemo.set(id, d);
    return d;
  };
  const out = new Map<string, number>();
  for (const n of nodes) {
    if (n.wraps?.length && n.z === undefined) out.set(n.id, -boxDepth(n.id));
  }
  return out;
}

/** Bounds for `options.edgeLabelSize` (px). Outside them the chip gets unreadable
 *  or swallows the diagram, so an out-of-range value is clamped, not rejected. */
export const EDGE_LABEL_SIZE_MIN = 8;
export const EDGE_LABEL_SIZE_MAX = 24;
/** A finite number clamped to the edge-label size bounds; undefined otherwise. */
export function clampEdgeLabelSize(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(EDGE_LABEL_SIZE_MAX, Math.max(EDGE_LABEL_SIZE_MIN, v));
}

export function parseArchitecture(content: string, defaultLogosOn = false): PlatformSchema {
  const file = resolveArchitectureFile(content) ?? {};
  const nodes: Record<string, NodePosition> = {};
  // Default z for wrapping boxes (behind their children) — see autoBoxZ.
  const boxZ = autoBoxZ(file);

  // Resolve symbolic placement (columns + wraps) → pixel positions. Explicit
  // `at` wins; this fills in the rest + sizes wrapper boxes.
  const placed = computeLayout(file);
  const cardFonts = cardGroupFonts(file?.nodes ?? []);
  // file node id → the canvas node id we store under (catalog nodes may be
  // re-keyed to `type`), and its resolved box — used for edge-handle inference.
  const fileToNode = new Map<string, string>();
  const boxOf = new Map<string, ResolvedBox>();

  for (const n of file?.nodes ?? []) {
    if (!n?.id || !n.type) continue;
    const box = placed.get(n.id) ?? { x: 0, y: 0, ...naturalSize(n.type, n.params, n.sources, n) };
    const [x, y] = [box.x, box.y];
    const st = n.style ?? {};
    // A container box's size is derived by computeLayout (from `wraps` and/or
    // `bounds`); otherwise an explicit `size` wins (a plain node keeps its
    // natural size → no w/h stored).
    // A wrapping box with a `size` is a MINIMUM (computeLayout grows it to fit its
    // members), so its drawn size is the resolved box, not the authored floor.
    const derivedSize = ((n.wraps || n.bounds) && (!n.size || n.wraps?.length)) || n.pin?.fill ? [box.w, box.h] as [number, number] : n.size;
    // Preserve symbolic placement for round-trip. A node authored WITHOUT `at`
    // that carries symbolic fields (col/relational/wraps/bounds/pin) is un-`pinned`:
    // on save it re-emits those fields (not `at`) unless the user drags it. A node
    // authored WITH `at`, or with no symbolic fields at all, is pinned to pixels.
    const placement = pickPlacement(n);
    const pinned = Array.isArray(n.at) || !placement;
    const pos: NodePosition = {
      x: x ?? 0,
      y: y ?? 0,
      type: n.type,
      ...(placement ? { placement } : {}),
      ...(pinned ? { pinned: true } : {}),
      ...(n.params && Object.keys(n.params).length ? { params: n.params } : {}),
      ...(Array.isArray(n.sources) && n.sources.length ? { sources: n.sources } : {}),
      ...(sanitizeStack(n.stack) ? { stack: sanitizeStack(n.stack)! } : {}),
      ...(n.rot !== undefined ? { rot: n.rot } : {}),
      ...(derivedSize ? { w: derivedSize[0], h: derivedSize[1] } : {}),
      // DERIVED lane-uniform width (step 2.5) for a captioned logo/source group —
      // never persisted, but the RF node box + render honor it (flow-mapping).
      ...(box.laneW && !n.size ? { laneW: box.laneW } : {}),
      ...(cardFonts.get(n.id) !== undefined ? { cardFont: cardFonts.get(n.id) } : {}),
      ...(n.scale !== undefined ? { scale: n.scale } : {}),
      ...(n.z !== undefined ? { z: n.z } : {}),
      // Auto z for a wrapping box (behind its children) — a RENDER default only,
      // kept OFF `z` so it never serializes back as an explicit z. Explicit `z`
      // above still wins at render time (see flow-mapping zIndex resolution).
      ...(n.z === undefined && boxZ.has(n.id) ? { autoZ: boxZ.get(n.id)! } : {}),
      ...(n.group !== undefined ? { groupId: n.group } : {}),
      ...(n.label !== undefined ? { label: n.label } : {}),
      ...(n.ai_reasoning !== undefined ? { ai_reasoning: n.ai_reasoning } : {}),
      ...(typeof n.url === "string" && /^https?:\/\//.test(n.url) ? { url: n.url } : {}),
      ...(n.desc !== undefined ? { desc: n.desc } : {}),
      ...(n.showDesc !== undefined ? { showDesc: n.showDesc } : {}),
      ...(n.wrapDesc !== undefined ? { wrapDesc: n.wrapDesc } : {}),
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
      ...(st.headerFill !== undefined ? { headerFill: st.headerFill } : {}),
    };

    if (ANNOTATION_TYPES.has(n.type as AnnotationVariant)) {
      // Free-form annotation node (box/text/logo/image).
      pos.annotation = {
        variant: n.type as AnnotationVariant,
        // An unknown/missing kind falls back to the default rather than failing
        // the parse — a diagram with one bad shape still opens (validation
        // reports it separately).
        ...(n.type === "shape" ? { shape: isShapeKind(n.shape) ? n.shape : "rounded" } : {}),
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
        ...(n.wrapDesc !== undefined ? { wrapDesc: n.wrapDesc } : {}),
        ...(n.src !== undefined ? { src: n.src } : {}),
        ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
        ...(n.titlePos !== undefined && (BOX_TITLE_POSITIONS as readonly string[]).includes(n.titlePos) ? { titlePos: n.titlePos } : {}),
        // A card's body: `body` as authored, or the legacy summary/desc/chips/tags folded
        // into equivalent HTML. Written back as `body` only (see serialize).
        ...(n.type === "card" && (n.body !== undefined || n.summary !== undefined || n.chips !== undefined || n.tags !== undefined)
          ? { body: cardBodySource(n) } : {}),
        ...(n.badge !== undefined ? { badge: n.badge } : {}),
        ...(n.badgeColor !== undefined ? { badgeColor: n.badgeColor } : {}),
        ...(n.accent !== undefined ? { accent: n.accent } : {}),
        ...(n.titleColor !== undefined ? { titleColor: n.titleColor } : {}),
        ...(n.fill !== undefined ? { fill: n.fill } : {}),
        ...(n.textColor !== undefined ? { textColor: n.textColor } : {}),
      };
      // Card style aliases: `style.fill` / `style.borderColor` stand in for the
      // top-level `fill` / `accent` when those are unset (top-level wins).
      // `style.border` / `style.borderStyle` / `style.radius` already flow through
      // the shared NodePosition border fields the card reads.
      if (n.type === "card") {
        const fill = n.fill ?? st.fill;
        const accent = n.accent ?? st.borderColor;
        if (fill !== undefined) pos.annotation.fill = fill;
        if (accent !== undefined) pos.annotation.accent = accent;
      }
      // An html block: its HTML verbatim (sanitized at render) and its frame padding,
      // kept on the annotation so it round-trips through the canvas (see serialize).
      if (n.type === "html") {
        if (n.html !== undefined) pos.annotation.html = n.html;
        if (typeof st.padding === "number") pos.annotation.padding = st.padding;
      }
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
    // The id is kept VERBATIM — a node's component identity comes from `pos.type`
    // (flow-mapping resolves the catalog by `type`), so `id` is a free-form
    // instance handle and need NOT equal `type`. Duplicate ids are the only thing
    // we fix up: a genuine collision (two nodes sharing an id) would clobber the
    // earlier node and re-target its edges to the survivor, so disambiguate with a
    // `#N` suffix. `fileToNode` records any such rename so edges + placement refs
    // follow it; for the common case it's an identity mapping.
    let nodeId = n.id;
    if (nodes[nodeId]) {
      const base = baseId(nodeId);
      let k = 2;
      while (nodes[`${base}#${k}`]) k++;
      nodeId = `${base}#${k}`;
    }
    nodes[nodeId] = pos;
    fileToNode.set(n.id, nodeId);
    boxOf.set(n.id, box);
  }

  // Remap placement references through `fileToNode`, so a node whose id got
  // disambiguated on a collision has its CONTAINER + RELATIONAL refs follow the
  // rename (identity in the common case). Without this, a `wraps`/`below`/`pin.to`
  // that named the pre-rename id would dangle — the exact bug that broke boxes
  // when ids were re-keyed. Runs after the node loop so `fileToNode` is complete.
  const remapRef = (r: string | undefined) => (r === undefined ? r : (fileToNode.get(r) ?? r));
  for (const pos of Object.values(nodes)) {
    const p = pos.placement;
    if (!p) continue;
    if (p.wraps) p.wraps = p.wraps.map((w) => remapRef(w)!);
    for (const k of ["below", "above", "leftOf", "rightOf", "alignX", "alignY"] as const) {
      if (p[k] !== undefined) p[k] = remapRef(p[k]);
    }
    if (p.pin?.to !== undefined) p.pin = { ...p.pin, to: remapRef(p.pin.to) };
    if (p.bounds) {
      // Each side is "<id>:<anchor>" | "col:<name>:<anchor>" | "wrap" — only the
      // "<id>:<anchor>" form carries a node id to remap (col:/wrap have no id).
      const remapSide = (v: string | undefined) => {
        if (v === undefined || v === "wrap" || v.startsWith("col:")) return v;
        const i = v.indexOf(":");
        if (i === -1) return remapRef(v);
        return `${remapRef(v.slice(0, i))}:${v.slice(i + 1)}`;
      };
      p.bounds = {
        ...(p.bounds.left !== undefined ? { left: remapSide(p.bounds.left) } : {}),
        ...(p.bounds.right !== undefined ? { right: remapSide(p.bounds.right) } : {}),
        ...(p.bounds.top !== undefined ? { top: remapSide(p.bounds.top) } : {}),
        ...(p.bounds.bottom !== undefined ? { bottom: remapSide(p.bounds.bottom) } : {}),
      };
    }
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

  // A GOVERNANCE tile (Unity Catalog / the governance bar) governs — it doesn't
  // exchange data — so an edge touching one defaults to a plain DASHED line with
  // NO flow animation, unless the author set `flow`/`dashed` explicitly.
  const GOVERNS_TYPES = new Set(["governance-block", "unity-catalog"]);
  const isGovEndpoint = (fileId: string) => {
    const nid = fileToNode.get(fileId) ?? fileId;
    return GOVERNS_TYPES.has(nodes[nid]?.type ?? "");
  };
  const edges: PlatformEdge[] = (file?.edges ?? []).map((e, i) => {
    const s = splitHandle(e.from);
    const t = splitHandle(e.to);
    const inf = (!s.handle || !t.handle) ? inferHandles(s.id, t.id) : {};
    const sourceHandle = s.handle ?? inf.sh;
    const targetHandle = t.handle ?? inf.th;
    const touchesGov = isGovEndpoint(s.id) || isGovEndpoint(t.id);
    // A GOVERNANCE line governs — it doesn't flow data — so it's a plain DASHED
    // line with NO flow animation + an arrowHEAD at the end (governs → the thing).
    // Force dashed/no-flow for any edge touching a governance tile (an explicit
    // `dashed:false` can still un-dash it, but flow stays off); default the arrow
    // to "end" unless the author set one explicitly.
    const animated = touchesGov ? false : !!e.flow;
    const dashed = e.dashed !== undefined ? !!e.dashed : touchesGov;
    const arrow = e.arrow && e.arrow !== "auto" ? e.arrow : (touchesGov ? "end" : undefined);
    return {
      id: e.id ?? `e-${s.id}-${t.id}-${i}`,
      source: fileToNode.get(s.id) ?? s.id,
      target: fileToNode.get(t.id) ?? t.id,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
      animated,
      ...(dashed ? { dashed: true } : {}),
      ...(e.color ? { color: e.color } : {}),
      ...(e.shape ? { shape: e.shape } : {}),
      ...(e.flowStyle ? { flowStyle: e.flowStyle } : {}),
      ...(arrow ? { arrow } : {}),
      ...(typeof e.centerX === "number" ? { centerX: e.centerX } : {}),
      ...(e.bezier ? { bezier: true } : {}),
      ...(e.controlPoints ? { controlPoints: e.controlPoints } : {}),
      ...(e.waypoints ? { waypoints: e.waypoints } : {}),
      ...(e.labelPos ? { labelPos: e.labelPos } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.ai_reasoning ? { ai_reasoning: e.ai_reasoning } : {}),
    };
  });

  const customLogos: Record<string, string> = {};
  for (const c of file?.custom_logos ?? []) {
    if (c?.id && typeof c.svg === "string") customLogos[c.id] = c.svg;
  }

  // The on-canvas legend is DERIVED from the tab-level `legend`, not authored as
  // a node: `show` can be flipped without touching `nodes`, the box can't drift
  // out of sync with the panel, and it auto-sizes to its own text (the old
  // hand-authored `size` + tiny `fontSize` box is what made legends unreadable).
  // flowToLayout drops this id again, so it never serializes back as a node.
  const legend = file?.legend;
  if (legend && legendShows(legend, "diagram")) {
    // Content bounds (node CENTERS + their footprints) → width to match and a
    // baseline to sit under. Falls back to the origin for an empty tab.
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of Object.values(nodes)) {
      const nat = naturalSize(pos.type, pos.params, pos.sources, pos.annotation);
      const w = pos.w ?? nat.w;
      const h = pos.h ?? nat.h;
      minX = Math.min(minX, pos.x - w / 2);
      maxX = Math.max(maxX, pos.x + w / 2);
      maxY = Math.max(maxY, pos.y + h / 2);
    }
    const hasContent = Number.isFinite(minX);
    const contentW = hasContent ? Math.round(maxX - minX) : undefined;
    const m = legendBoxMetrics(legend, contentW);
    const cx = legend.at ? legend.at[0] : hasContent ? Math.round((minX + maxX) / 2) : 0;
    const cy = legend.at ? legend.at[1] : hasContent ? Math.round(maxY + LEGEND_GAP + m.h / 2) : 0;
    nodes[LEGEND_NODE_ID] = {
      x: cx,
      y: cy,
      type: "box",
      w: m.w,
      h: m.h,
      pinned: true,
      // Behind everything else, like any background container.
      z: -1,
      fillColor: "#FBFAF8",
      borderWidth: 1,
      borderColor: "#C9D1D3",
      borderRadius: 12,
      shadow: 0,
      annotation: {
        variant: "box",
        text: m.text,
        ...(legend.title ? { title: legend.title } : {}),
        fontSize: m.fontSize,
        vAlign: "top",
        hAlign: "left",
      },
    };
  }

  // The frame's TITLE BAND is derived exactly like the legend above: synthesized
  // here, inside `.react-flow` so the tight-crop export includes it, and dropped
  // again by flowToLayout / serializeArchitecture. It sits ABOVE the content and
  // spans it, so the composed frame reads title → ribbon → legend top-to-bottom.
  const frameMetrics = frameTitleMetrics(file?.frame);
  if (frameMetrics && file?.frame) {
    let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity;
    for (const pos of Object.values(nodes)) {
      const nat = naturalSize(pos.type, pos.params, pos.sources, pos.annotation);
      const w = pos.w ?? nat.w;
      const h = pos.h ?? nat.h;
      fMinX = Math.min(fMinX, pos.x - w / 2);
      fMaxX = Math.max(fMaxX, pos.x + w / 2);
      fMinY = Math.min(fMinY, pos.y - h / 2);
    }
    const hasContent = Number.isFinite(fMinX);
    const bandW = hasContent ? Math.round(fMaxX - fMinX) : LEGEND_MIN_WIDTH;
    const cx = hasContent ? Math.round((fMinX + fMaxX) / 2) : 0;
    const cy = hasContent
      ? Math.round(fMinY - FRAME_TITLE_GAP - frameMetrics.h / 2)
      : 0;
    nodes[FRAME_TITLE_NODE_ID] = {
      x: cx,
      y: cy,
      type: "box",
      w: bandW,
      h: frameMetrics.h,
      pinned: true,
      z: -1,
      // Chrome-free: the band is type + whitespace, like every exemplar deck
      // title. A border/fill here would read as a container, not a heading.
      borderWidth: 0,
      shadow: 0,
      // Rendered by the frame-band branch in annotations.tsx: title + subtitle
      // as a typographic pair (not one text run), left-aligned, no chrome.
      annotation: {
        variant: "box",
        text: file.frame.title?.trim() ?? "",
        subtitle: file.frame.subtitle?.trim() || undefined,
        fontSize: frameMetrics.titleFont,
        subtitleFontSize: frameMetrics.subtitleFont,
        vAlign: "bottom",
        hAlign: "left",
      },
    };
  }

  return {
    name: file?.name ?? "Solution architecture",
    story: file?.story,
    ...(file?.aspect === "16:9" || file?.aspect === "1:1" ? { aspect: file.aspect } : {}),
    ...(file?.frame ? { frame: file.frame } : {}),
    theme: resolveTheme(file?.theme),
    direction:
      file?.direction === "vertical" || file?.direction === "matrix"
        ? file.direction
        : file?.aspect === "1:1" ? "matrix" : "horizontal",
    enableTrademarkLogos: file?.options?.trademarkLogos ?? defaultLogosOn,
    ...(clampEdgeLabelSize(file?.options?.edgeLabelSize) !== undefined
      ? { edgeLabelSize: clampEdgeLabelSize(file?.options?.edgeLabelSize) } : {}),
    ...(file?.columns?.length ? { columns: file.columns } : {}),
    ...(file?.rowGrid ? { rowGrid: true } : {}),
    ...(typeof file?.rowGap === "number" ? { rowGap: file.rowGap } : {}),
    bands: catalogSchemaBands(),
    layout: { nodes, edges, hidden: [] },
    ...(Object.keys(customLogos).length ? { customLogos } : {}),
    ...(legend?.items?.length ? { legend } : {}),
    ...(file?._tree ? { tree: file._tree } : {}),
  };
}

/** The raw global catalog as bands — every component with its CATALOG label /
 *  icon / desc, with NO per-project overrides merged in. The library palette
 *  (left menu) renders from this so it always shows the canonical component
 *  set, not a demo's story-tied relabels (e.g. a demo renaming Genie Agent must
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
/** Back-compat aliases for renamed component ids: an old `type` in a saved
 *  architecture.md (or an older reference diagram) is mapped to its current id on
 *  READ, so it still resolves against CATALOG. Serialize always writes the new id.
 *  Applied once at the parse boundary so every consumer (layout, capabilities,
 *  validate, the canvas) sees the normalized id. */
const TYPE_ALIASES: Record<string, string> = {
  "agent-bricks": "databricks-agent",
};
export const normalizeTypeId = (type: string): string => TYPE_ALIASES[type] ?? type;

/** The file as the RENDER pipeline needs it: parsed, and a nested file solved and handed
 *  on FLAT (every node at its centre, boxes sized and wrapping their content) with the
 *  tree record save uses to re-nest it. parseArchitectureFile stays the raw parse (the
 *  collab doc stores the authored objects). */
export function resolveArchitectureFile(content: string): ArchitectureFile | null {
  return resolveNested(parseArchitectureFile(content));
}

/** Solve a nested file object into its flat form. A file in the OLD flat format (lanes,
 *  wraps, pins) is first converted to the nested format (lib/arch-migrate.ts), so every
 *  diagram renders and edits through one engine, and its next save writes it nested. */
export function resolveNested(file: ArchitectureFile | null): ArchitectureFile | null {
  if (file && isFlatArchitectureFile(file)) file = migrateToNested(file);
  if (!file || !isNestedFile(file)) return file;
  const { file: flat, tree } = flattenTree(file);
  return { ...flat, _tree: tree };
}

export function parseArchitectureFile(content: string): ArchitectureFile | null {
  try {
    const block = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const raw = block ? block[1].trim() : content.trim();
    if (!raw.startsWith("{")) return null;
    const file = JSON.parse(raw) as ArchitectureFile;
    // Normalize renamed component ids in place so the whole pipeline sees the
    // current id (an old file keeps resolving; save re-emits the new id).
    const norm = (ns: FileNode[] | undefined) => { for (const n of ns ?? []) { if (n?.type) n.type = normalizeTypeId(n.type); norm(n?.children); } };
    norm(file?.nodes);
    return file;
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

// =============================================================================
// Validate — a pure integrity check over the flat file. Catches the class of
// SILENT-WRONG mistakes computeLayout tolerates (it just skips a bad ref rather
// than erroring): dangling id references, unknown component types, bad edge
// endpoints/handles, duplicate ids. The UI surfaces the results and can hand a
// formatted report to the chat agent to fix. NEVER throws — returns [] on an
// unparseable/empty file (that's the parser's problem, not a diagram error).
// =============================================================================

/** One diagnostic from validateArchitecture. `tab` is the tab NAME (for the
 *  agent report + jump-to); `nodeId`/`edgeId` locate the offending element;
 *  `field` names the offending property; `message` is human-readable. */
export interface ArchitectureIssue {
  tab: string;
  /** The node the problem is ON (for jump-to). Absent for edge-only issues. */
  nodeId?: string;
  edgeId?: string;
  /** The property at fault, e.g. "wraps", "from", "type", "col". */
  field?: string;
  message: string;
}

/** Canonical geometric edge-handle sides (any node exposes these). Port handles
 *  beyond these must be declared in the target component's catalog `ports`. */
const SIDE_HANDLES = new Set(["l", "r", "t", "b"]);

/** Is `type` a thing we can actually render? A catalog id, an annotation variant
 *  (text/box/logo/image/note), or the built-in "source" tile. */
function isKnownNodeType(type: string): boolean {
  return (
    CATALOG_BY_ID.has(type) ||
    ANNOTATION_TYPES.has(type as AnnotationVariant) ||
    type === "source"
  );
}

export interface PresentationAspectAssessment {
  actual: number;
  target: PresentationAspect;
  targetRatio: number;
  /** Symmetric proportional miss: 0.2 means one axis is 20% too long. */
  miss: number;
  ok: boolean;
  /** True when `frame` was set, so `actual` is the composed frame rather than the
   *  bare node union. Lets a checker phrase the fix correctly. */
  framed?: boolean;
  /** The node/legend ribbon's own ratio. ADVISORY — a 2-4:1 ribbon (or far more
   *  for a process spine) is correct inside a 16:9 frame and must never fault. */
  ribbon?: number;
}

export interface FlowOrientationAssessment {
  direction: Exclude<DiagramDirection, "matrix">;
  aligned: number;
  total: number;
  share: number;
  ok: boolean;
  /** True when declared lanes scoped the count to cross-lane edges (so the
   *  fault message can say "cross-lane" only when it means it). */
  scoped: boolean;
}

/** A wide solution diagram must READ in its declared direction, not merely have
 *  an outer bbox with that aspect. Matrix/containment views intentionally opt out.
 *
 *  WHAT COUNTS: with declared `columns`, only CROSS-LANE edges speak for the
 *  reading direction. The phase-lane idiom stacks a phase's 2-3 steps vertically
 *  under its banner — that is sub-structure, not a vertical flow — and counting
 *  it failed every phase-lane diagram even when 100% of its cross-lane hand-offs
 *  read horizontal (the reference decks' banner pattern). In-lane edges are
 *  skipped when BOTH endpoints declare the same `col`; an endpoint with no `col`
 *  (pinned note, box, persona) keeps its edge counted, since it crosses the
 *  lane structure by nature. With no lanes declared, every edge counts (the old
 *  behaviour). Trade-off, accepted and documented: a column-major mini-flow
 *  (15 steps as 5 columns x 3) now passes if its few hand-offs are horizontal —
 *  the mini-flow failure mode is a GUIDANCE matter (SKILL.md's walkthrough rule),
 *  not something an axis share can separate from the phase idiom honestly. */
export function assessFlowOrientation(file: ArchitectureFile): FlowOrientationAssessment | null {
  const direction: DiagramDirection =
    file.direction === "vertical" || file.direction === "matrix"
      ? file.direction
      : file.aspect === "1:1" ? "matrix" : "horizontal";
  if (direction === "matrix") return null;
  const boxes = computeLayout(file);
  const nodeType = new Map((file.nodes ?? []).map((n) => [n.id, n.type]));
  const nodeCol = new Map((file.nodes ?? []).map((n) => [n.id, n.col]));
  const hasLanes = (file.nodes ?? []).some((n) => n.col !== undefined);
  // Nested file: an edge speaks for the reading direction only when its two ends meet in
  // a container that runs that way (a row for a horizontal tab). Ends that meet in a
  // column are stacked by construction (a phase's own steps), like same-lane edges.
  const tree = file._tree;
  const meetLayout = (a: string, b: string): string | undefined => {
    if (!tree) return undefined;
    const chain = (id: string) => { const c: (string | null)[] = []; for (let p: string | null | undefined = id; p != null; p = tree.entries[p]?.parent) c.unshift(p); return [null, ...c]; };
    const ca = chain(a), cb = chain(b);
    let lca: string | null = null;
    for (let i = 0; i < ca.length && i < cb.length && ca[i] === cb[i]; i++) lca = ca[i];
    return lca ? tree.entries[lca]?.layout : tree.root.layout ?? "row";
  };
  let aligned = 0, total = 0;
  for (const e of file.edges ?? []) {
    if (!e?.from || !e?.to || e.dashed) continue;
    const from = splitHandle(e.from).id, to = splitHandle(e.to).id;
    // Cross-cutting governance placement should not decide the flow direction.
    const global = new Set(["governance-block", "unity-catalog", "db-platform"]);
    if (global.has(nodeType.get(from) ?? "") || global.has(nodeType.get(to) ?? "")) continue;
    // With declared lanes, only cross-lane edges speak for the reading direction.
    if (hasLanes) {
      const fc = nodeCol.get(from), tc = nodeCol.get(to);
      if (fc !== undefined && tc !== undefined && fc === tc) continue;
    }
    if (tree && meetLayout(from, to) !== (direction === "horizontal" ? "row" : "column")) continue;
    const a = boxes.get(from), b = boxes.get(to);
    if (!a || !b) continue;
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (Math.max(dx, dy) < 20) continue;
    total++;
    if (direction === "horizontal" ? dx >= dy : dy >= dx) aligned++;
  }
  if (total < 4) return null;
  const share = aligned / total;
  return { direction, aligned, total, share, ok: share >= 0.6, scoped: hasLanes || !!tree };
}

/** Assess the COMPOSED FRAME when `frame` is set, else the bare node bounds.
 *  Export deliberately does not repair either with whitespace. Twelve percent
 *  allows natural text/box variation while keeping wide outputs genuinely close
 *  to 16:9 and compact outputs near square.
 *
 *  The frame is the correct rectangle: a node ribbon is legitimately 2-4:1 (a
 *  process spine far more), and it is the title/legend/detail bands that make the
 *  COMPOSITION 16:9. Measuring the union instead forced authors to inflate gaps.
 *  Framed tabs therefore also report `ribbon` — the ribbon's own ratio, ADVISORY
 *  only, so a healthy ribbon is never a fault. */
export function assessPresentationAspect(file: ArchitectureFile): PresentationAspectAssessment | null {
  const boxes = [...computeLayout(file).values()];
  const hasVisibleLegend = !!(file.legend && legendShows(file.legend, "diagram"));
  if (boxes.length + (hasVisibleLegend ? 1 : 0) < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - b.w / 2);
    minY = Math.min(minY, b.y - b.h / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    maxY = Math.max(maxY, b.y + b.h / 2);
  }
  // Match parseArchitecture's DERIVED on-canvas legend: it is not a file node,
  // but it is visible and exported, so presentation validation must include it.
  if (hasVisibleLegend && file.legend) {
    const contentW = maxX - minX;
    const m = legendBoxMetrics(file.legend, contentW);
    const cx = file.legend.at?.[0] ?? (minX + maxX) / 2;
    const cy = file.legend.at?.[1] ?? maxY + LEGEND_GAP + m.h / 2;
    minX = Math.min(minX, cx - m.w / 2);
    minY = Math.min(minY, cy - m.h / 2);
    maxX = Math.max(maxX, cx + m.w / 2);
    maxY = Math.max(maxY, cy + m.h / 2);
  }
  // RIBBON = the node/legend union measured above, before frame bands. Recorded
  // for reporting so a 3:1 ribbon inside a 16:9 frame reads as correct, not as a
  // near-200% "miss".
  const ribbonW = maxX - minX, ribbonH = maxY - minY;
  const ribbon = ribbonW > 0 && ribbonH > 0 ? ribbonW / ribbonH : undefined;

  // Match parseArchitecture's DERIVED title band — same reason as the legend: not
  // a file node, but visible and exported, so it belongs in the measured frame.
  const fm = frameTitleMetrics(file.frame);
  if (fm) {
    const bandCy = minY - FRAME_TITLE_GAP - fm.h / 2;
    minY = Math.min(minY, bandCy - fm.h / 2);
  }

  const width = maxX - minX, height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;
  const actual = width / height;
  const nearest: PresentationAspect =
    Math.abs(Math.log(actual / (16 / 9))) < Math.abs(Math.log(actual)) ? "16:9" : "1:1";
  const target = file.aspect === "16:9" || file.aspect === "1:1" ? file.aspect : nearest;
  const targetRatio = target === "16:9" ? 16 / 9 : 1;
  const miss = Math.max(actual / targetRatio, targetRatio / actual) - 1;
  return {
    actual, target, targetRatio, miss, ok: miss <= 0.12,
    framed: !!fm,
    ...(ribbon !== undefined ? { ribbon } : {}),
  };
}

/** Validate ONE tab's flat file. Pushes issues (tagged with `tabName`) into
 *  `out`. Pure — reads only the file + the static catalog. */
function validateArchitectureFileInto(
  file: ArchitectureFile,
  tabName: string,
  out: ArchitectureIssue[],
): void {
  const nodes = Array.isArray(file.nodes) ? file.nodes : [];
  const edges = Array.isArray(file.edges) ? file.edges : [];
  const columns = Array.isArray(file.columns) ? file.columns : [];
  const columnSet = new Set(columns);

  const visibleCount = nodes.length + (file.legend && legendShows(file.legend, "diagram") ? 1 : 0);
  // NO row-gap check here on purpose. `validateArchitecture` issues are CONTENT
  // faults and eval-arch GATES on them, so a spacing PREFERENCE emitted here
  // fails the build. It was tried at >72px (1.0x the slide cell) and immediately
  // failed `ml-platform.jsonc` — a hand-tuned zero-fault reference that authors
  // exactly 96 for intentional phase banding. A legal, documented value used by
  // our best reference is not a content error. The spacing signal is an ADVISORY
  // in inspect-arch instead, measured on the RENDERED gap rather than the
  // authored number (see "largest vertical gap" there).
  // Fixed-pitch row collision. This IS a content fault (a geometric contradiction
  // in the authored file, like a dangling ref), NOT a spacing preference: a node
  // taller than one row pitch, placed on an EXPLICIT row whose neighbour is also
  // explicitly occupied, overlaps it. `cellSpan` only advances the auto-assign
  // cursor, so it cannot save this case. Reported with the two concrete fixes.
  if (file.rowGrid) {
    const pitch = GRID_CELL_H + effectiveRowGap(file.rowGap);
    const laneRows = new Map<string, { row: number; id: string; h: number }[]>();
    for (const n of nodes) {
      if (!n.col || typeof n.row !== "number" || !Number.isInteger(n.row)) continue;
      const verticalSource = n.type === "source" && (n.caption === "top" || n.caption === "bottom");
      const h = n.size ? n.size[1]
        : verticalSource ? verticalSourceSize().h
        : naturalSize(n.type, n.params, n.sources, n).h;
      if (!laneRows.has(n.col)) laneRows.set(n.col, []);
      laneRows.get(n.col)!.push({ row: n.row, id: n.id, h });
    }
    for (const [col, list] of laneRows) {
      list.sort((a, b) => a.row - b.row);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1], cur = list[i];
        const span = (cur.row - prev.row) * pitch;
        if (prev.h > span) {
          out.push({ tab: tabName, nodeId: prev.id, field: "row", message: `\`${prev.id}\` is ${prev.h}px tall in lane \`${col}\` but only ${span}px of grid separates row ${prev.row} from \`${cur.id}\` at row ${cur.row} (pitch ${pitch} = ${GRID_CELL_H}px cell + ${pitch - GRID_CELL_H}px rowGap) — they overlap by ${prev.h - span}px. Either skip a row number (${prev.row} → ${cur.row + 1}) or raise \`rowGap\` to ≥ ${Math.max(ROW_GAP_MIN, prev.h - GRID_CELL_H)}.` });
        }
      }
    }
  }

  if (file.aspect === undefined && visibleCount >= 2) {
    out.push({ tab: tabName, field: "aspect", message: `Missing required presentation \`aspect\` — choose \`"16:9"\` or \`"1:1"\`. With a \`frame\` set this is measured on the COMPOSED FRAME (title band + ribbon + legend), so the node ribbon itself can stay a healthy 2-4:1; without one it is measured on the bare node union.` });
  } else if (file.aspect !== undefined && file.aspect !== "16:9" && file.aspect !== "1:1") {
    out.push({ tab: tabName, field: "aspect", message: `Invalid aspect \`${String(file.aspect)}\` — expected \`"16:9"\` or \`"1:1"\`.` });
  }
  if (file.theme !== undefined && file.theme !== "slide" && file.theme !== "technical") {
    out.push({ tab: tabName, field: "theme", message: `Invalid theme \`${String(file.theme)}\` — expected \`"slide"\` or \`"technical"\`.` });
  }
  if (file.direction === undefined && visibleCount >= 2) {
    out.push({ tab: tabName, field: "direction", message: `Missing required \`direction\` — use \`"horizontal"\` for solution flows, \`"matrix"\` for comparison/containment, or \`"vertical"\` only when explicitly requested.` });
  } else if (file.direction !== undefined && file.direction !== "horizontal" && file.direction !== "vertical" && file.direction !== "matrix") {
    out.push({ tab: tabName, field: "direction", message: `Invalid direction \`${String(file.direction)}\` — expected \`"horizontal"\`, \`"vertical"\`, or \`"matrix"\`.` });
  }
  if (file.rowGap !== undefined && (!Number.isFinite(file.rowGap) || file.rowGap < 20 || file.rowGap > 96)) {
    out.push({ tab: tabName, field: "rowGap", message: `Invalid rowGap \`${String(file.rowGap)}\` — expected 20–96px; reorganize the topology instead of stretching the canvas.` });
  }

  // Every id that names a placeable element on THIS tab.
  const ids = new Set<string>();
  const nodeById = new Map<string, FileNode>();
  for (const n of nodes) {
    if (!n || typeof n.id !== "string" || !n.id) {
      out.push({ tab: tabName, field: "id", message: `A node is missing an \`id\`.` });
      continue;
    }
    if (ids.has(n.id)) {
      out.push({ tab: tabName, nodeId: n.id, field: "id", message: `Duplicate node id \`${n.id}\` — ids must be unique within a tab.` });
    }
    ids.add(n.id);
    nodeById.set(n.id, n);
  }

  // A ref may carry a `#instance` suffix (a 2nd copy of a catalog tile) or an
  // `@handle` (edges). Resolve to the base node id present on the tab.
  const refExists = (ref: string): boolean => {
    if (ids.has(ref)) return true;
    const base = baseId(ref);
    return ids.has(base);
  };

  // ---- per-node checks -----------------------------------------------------
  for (const n of nodes) {
    if (!n?.id) continue;
    const type = n.type ?? baseId(n.id);

    // Unknown component type — computeLayout would render an "Unknown component"
    // placeholder (the exact symptom we've hit with a typo'd type).
    if (type && type !== "box" && !isKnownNodeType(type)) {
      out.push({ tab: tabName, nodeId: n.id, field: "type", message: `Node \`${n.id}\` has unknown type \`${type}\` — not a catalog component, annotation, or "source".` });
    }

    // A `shape` node's kind must be one we can draw (a typo'd kind would
    // silently fall back to `rounded` at parse time, so say so here).
    if (n.shape !== undefined && !isShapeKind(n.shape)) {
      out.push({ tab: tabName, nodeId: n.id, field: "shape", message: `Node \`${n.id}\` has unknown shape \`${String(n.shape)}\` — expected one of ${[...SHAPE_KIND_SET].join(", ")}.` });
    }
    if (n.shape !== undefined && type !== "shape") {
      out.push({ tab: tabName, nodeId: n.id, field: "shape", message: `Node \`${n.id}\` sets \`shape\` but is type \`${type}\` — only \`type:"shape"\` nodes draw a flowchart symbol.` });
    }

    // A box's title placement must be one we draw (an unknown value silently
    // falls back to the border title at parse time, so say so here).
    if (n.titlePos !== undefined && !(BOX_TITLE_POSITIONS as readonly string[]).includes(String(n.titlePos))) {
      out.push({ tab: tabName, nodeId: n.id, field: "titlePos", message: `Node \`${n.id}\` has unknown titlePos \`${String(n.titlePos)}\` — expected one of ${BOX_TITLE_POSITIONS.map((p) => `"${p}"`).join(", ")}.` });
    }

    if (n.row !== undefined && (typeof n.row !== "number" || !Number.isFinite(n.row) || !Number.isInteger(n.row))) {
      out.push({ tab: tabName, nodeId: n.id, field: "row", message: `Node \`${n.id}\` has invalid row \`${String(n.row)}\` — expected a finite integer.` });
    }

    // Column reference must be a declared lane.
    if (n.col && columns.length && !columnSet.has(n.col)) {
      out.push({ tab: tabName, nodeId: n.id, field: "col", message: `Node \`${n.id}\` references column \`${n.col}\` which isn't in \`columns\` [${columns.join(", ")}].` });
    }

    // Relational anchors + box refs — each must point at an existing node.
    const REL: (keyof FileNode)[] = ["alignX", "alignY", "below", "above", "leftOf", "rightOf"];
    for (const f of REL) {
      const ref = n[f];
      if (typeof ref === "string" && ref && !refExists(ref)) {
        out.push({ tab: tabName, nodeId: n.id, field: f as string, message: `Node \`${n.id}\` \`${f}\` points at \`${ref}\`, which is not a node on this tab.` });
      }
    }

    // wraps: every child must exist (this is the bug that started all this).
    if (Array.isArray(n.wraps)) {
      for (const w of n.wraps) {
        if (typeof w !== "string" || !refExists(w)) {
          out.push({ tab: tabName, nodeId: n.id, field: "wraps", message: `Box \`${n.id}\` wraps \`${w}\`, which is not a node on this tab.` });
        }
      }
      if (type !== "box") {
        out.push({ tab: tabName, nodeId: n.id, field: "wraps", message: `Node \`${n.id}\` has \`wraps\` but is type \`${type}\` — only \`type:"box"\` nodes wrap children.` });
      }
    }

    // pin.to / bounds.<side> reference a box/node/column midpoint.
    if (n.pin?.to && !refExists(n.pin.to)) {
      out.push({ tab: tabName, nodeId: n.id, field: "pin.to", message: `Node \`${n.id}\` pins to \`${n.pin.to}\`, which is not a node on this tab.` });
    }
    if (n.bounds) {
      for (const [side, spec] of Object.entries(n.bounds)) {
        if (typeof spec !== "string" || !spec) continue;
        if (spec === "wrap") continue;
        // "<nodeId>:<anchor>" or "col:<name>:<anchor>".
        const parts = spec.split(":");
        const target = parts[0] === "col" ? null : parts[0];
        const colName = parts[0] === "col" ? parts[1] : null;
        if (target && !refExists(target)) {
          out.push({ tab: tabName, nodeId: n.id, field: `bounds.${side}`, message: `Box \`${n.id}\` bounds.${side} references node \`${target}\`, which is not on this tab.` });
        }
        if (colName && columns.length && !columnSet.has(colName)) {
          out.push({ tab: tabName, nodeId: n.id, field: `bounds.${side}`, message: `Box \`${n.id}\` bounds.${side} references column \`${colName}\`, not in \`columns\`.` });
        }
      }
    }
  }

  // ---- per-edge checks -----------------------------------------------------
  edges.forEach((e, i) => {
    const eid = e?.id ?? `edge #${i + 1}`;
    if (!e || typeof e.from !== "string" || typeof e.to !== "string" || !e.from || !e.to) {
      out.push({ tab: tabName, edgeId: eid, field: "from/to", message: `Edge \`${eid}\` is missing a \`from\` or \`to\`.` });
      return;
    }
    for (const end of ["from", "to"] as const) {
      const { id, handle } = splitHandle(e[end]);
      if (!refExists(id)) {
        out.push({ tab: tabName, edgeId: eid, field: end, message: `Edge \`${eid}\` \`${end}\` targets \`${id}\`, which is not a node on this tab.` });
        continue;
      }
      // Handle: a geometric side (l/r/t/b) or a port the node's catalog declares.
      if (handle && !SIDE_HANDLES.has(handle)) {
        const target = nodeById.get(id) ?? nodeById.get(baseId(id));
        const type = target ? (target.type ?? baseId(target.id)) : undefined;
        const ports = type ? CATALOG_BY_ID.get(type)?.c.ports : undefined;
        if (!ports || !(handle in ports)) {
          const known = ports ? Object.keys(ports).join(", ") : "(none)";
          out.push({ tab: tabName, edgeId: eid, field: end, message: `Edge \`${eid}\` ${end} handle \`@${handle}\` isn't a valid side (l/r/t/b) or a port of \`${id}\` (ports: ${known}).` });
        }
      }
    }
  });

  // NO aspect-MISS fault here — deliberately removed, and do not reinstate it.
  //
  // `ArchitectureIssue` has no severity field, so anything pushed here is a GATED
  // content fault (eval-arch sums `contentIssues`). A shape ratio does not belong
  // in that class, for two measured reasons:
  //
  //  1. It was the ENTIRE content fault of 3 of our 4 hostile corpus diagrams —
  //     and one of them, `long-span-edges`, was flagged at 2.15:1, which is EXACTLY
  //     the node-band ratio of the reference deck slide we are trying to imitate
  //     (ref-01). The gate was penalising the shape we want.
  //  2. The 16:9 target itself was reverse-engineered from the outer dimensions of
  //     seven SCREENSHOTS of good diagrams. Six of the seven are shorter than a
  //     true 16:9 at their own width (-24 to -228px) because the capture cropped
  //     the slide, and the diagrams may carry internal padding of their own. So
  //     the canvas ratio of a screenshot is not evidence of an authoring target.
  //
  // `aspect` still round-trips and still declares INTENT (it drives the default
  // reading direction). The real harms it was proxying for — unreadable text and
  // giant voids — are measured directly, and crop-immune, as WITHIN-image
  // proportions in inspect-arch's advisory block: font ÷ canvas width and largest
  // rendered gap ÷ tile height. Those cannot be satisfied by adding whitespace,
  // which is exactly why the old gate backfired.
  const orientation = assessFlowOrientation(file);
  if (orientation && !orientation.ok) {
    out.push({
      tab: tabName,
      field: "direction",
      message: `Only ${Math.round(orientation.share * 100)}% of ${orientation.scoped ? "cross-lane " : ""}relationships read ${orientation.direction}. Sequential steps must advance ${orientation.direction === "horizontal" ? "left-to-right across columns" : "top-to-bottom across rows"}; use \`direction:"matrix"\` only for a true comparison/containment view.`,
    });
  }
}

/** Validate architecture.md (any number of tabs). Returns every integrity issue
 *  across all tabs, or [] when the file is clean / empty / unparseable. Pure. */
export function validateArchitecture(content: string): ArchitectureIssue[] {
  const top = parseTopLevel(content ?? "");
  if (top == null) return [];
  const objs: ArchitectureFile[] = Array.isArray(top)
    ? (top as ArchitectureFile[])
    : typeof top === "object"
      ? [top as ArchitectureFile]
      : [];
  const out: ArchitectureIssue[] = [];
  objs.forEach((obj, i) => {
    if (!obj || typeof obj !== "object") return;
    // Normalize renamed component ids so a saved file on an OLD id validates
    // clean (it resolves at parse via the same alias) — mirrors parseArchitectureFile.
    for (const n of obj.nodes ?? []) {
      if (n?.type) n.type = normalizeTypeId(n.type);
    }
    const name = (typeof obj.name === "string" && obj.name.trim()) || `Architecture ${i + 1}`;
    for (const msg of nestedIssues(obj)) out.push({ tab: name, field: "track", message: msg } as ArchitectureIssue);
    // A nested file is checked in its solved form; an old flat file as authored (its own
    // field checks), even though it renders through the migration.
    validateArchitectureFileInto(isNestedFile(obj) ? (resolveNested(obj) ?? obj) : obj, name, out);
  });
  return out;
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
  if (pos.headerFill !== undefined) s.headerFill = pos.headerFill;
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
    // DERIVED nodes (the legend box, the frame title band) come from
    // `schema.legend` / `schema.frame`, re-emitted verbatim below. They must never
    // be written back as nodes or they would double up on every reload/autosave.
    if (isDerivedNodeId(id)) continue;
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
            // A symbolic box's `size` is its MINIMUM, not a frozen size (see minSize).
            ...(pl!.minSize !== undefined ? { size: pl!.minSize } : {}),
          }
        : { at };
    const common: Partial<FileNode> = {
      ...(pos.w !== undefined && pos.h !== undefined && !isSymbolicBox ? { size: [pos.w, pos.h] as [number, number] } : {}),
      ...(pos.rot ? { rot: pos.rot } : {}),
      ...(pos.scale !== undefined && pos.scale !== 1 ? { scale: pos.scale } : {}),
      ...(pos.z ? { z: pos.z } : {}),
      ...(pos.groupId ? { group: pos.groupId } : {}),
      ...(pos.params && Object.keys(pos.params).length ? { params: pos.params } : {}),
      ...(Array.isArray(pos.sources) && pos.sources.length ? { sources: pos.sources } : {}),
      ...(sanitizeStack(pos.stack) ? { stack: sanitizeStack(pos.stack)! } : {}),
      ...(pos.ai_reasoning ? { ai_reasoning: pos.ai_reasoning } : {}),
      ...(pos.url ? { url: pos.url } : {}),
    };
    const style = styleOf(pos);

    if (pos.annotation) {
      const a = pos.annotation;
      const annoStyle = a.variant === "html" && a.padding !== undefined ? { ...style, padding: a.padding } : style;
      nodes.push({
        id, type: a.variant, ...place, ...common,
        ...(a.variant === "shape" && a.shape ? { shape: a.shape } : {}),
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
        ...(a.subtitle !== undefined ? { subtitle: a.subtitle } : {}),
        ...(a.titlePos !== undefined && a.titlePos !== "border" ? { titlePos: a.titlePos } : {}),
        ...(a.body !== undefined ? { body: a.body } : {}),
        ...(a.badge !== undefined ? { badge: a.badge } : {}),
        ...(a.badgeColor !== undefined ? { badgeColor: a.badgeColor } : {}),
        ...(a.accent !== undefined ? { accent: a.accent } : {}),
        ...(a.titleColor !== undefined ? { titleColor: a.titleColor } : {}),
        ...(a.fill !== undefined ? { fill: a.fill } : {}),
        ...(a.textColor !== undefined ? { textColor: a.textColor } : {}),
        ...(a.variant === "html" && a.html !== undefined ? { html: a.html } : {}),
        // The html frame padding lives on the annotation (the canvas edits it there), so
        // it is folded into the node's style alongside the shared frame overrides.
        ...(annoStyle ? { style: annoStyle } : {}),
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
        ...(pos.wrapDesc !== undefined ? { wrapDesc: pos.wrapDesc } : {}),
        ...(style ? { style } : {}),
      });
      continue;
    }
    // Catalog component: `type` is the persisted component identity (NOT derived
    // from the id — the id is a free-form instance handle). Emit label/desc/icon
    // only when they differ from the catalog default.
    const type = pos.type ?? baseId(id);
    const def = CATALOG_BY_ID.get(type)?.c;
    nodes.push({
      id, type, ...place, ...common,
      ...(pos.label !== undefined && pos.label !== def?.label ? { label: pos.label } : {}),
      ...(pos.desc !== undefined && pos.desc !== def?.desc ? { desc: pos.desc } : {}),
      ...(pos.showDesc !== undefined ? { showDesc: pos.showDesc } : {}),
      ...(pos.wrapDesc !== undefined ? { wrapDesc: pos.wrapDesc } : {}),
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
      ...(e.color ? { color: e.color } : {}),
      ...(e.shape && e.shape !== "smooth" ? { shape: e.shape } : {}),
      ...(e.flowStyle ? { flowStyle: e.flowStyle } : {}),
      ...(typeof e.centerX === "number" ? { centerX: e.centerX } : {}),
      ...(e.bezier ? { bezier: true } : {}),
      ...(e.controlPoints ? { controlPoints: e.controlPoints } : {}),
      ...(e.waypoints ? { waypoints: e.waypoints } : {}),
      ...(e.labelPos ? { labelPos: e.labelPos } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.ai_reasoning ? { ai_reasoning: e.ai_reasoning } : {}),
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
    ...(schema.aspect ? { aspect: schema.aspect } : {}),
    ...(schema.frame ? { frame: schema.frame } : {}),
    ...(schema.theme !== DEFAULT_THEME ? { theme: schema.theme } : {}),
    direction: schema.direction,
    ...(schema.enableTrademarkLogos || schema.edgeLabelSize !== undefined
      ? {
          options: {
            ...(schema.enableTrademarkLogos ? { trademarkLogos: true as const } : {}),
            ...(schema.edgeLabelSize !== undefined ? { edgeLabelSize: schema.edgeLabelSize } : {}),
          },
        }
      : {}),
    // Re-emit the lane declaration: symbolic `col` refs on un-pinned nodes are
    // meaningless without it, so dropping it (as the old serializer did) made a
    // single drag collapse every remaining symbolic node to the origin.
    ...(schema.columns?.length ? { columns: schema.columns } : {}),
    // Re-emit the shared-row-grid opt-in so `row`'s cross-column meaning survives
    // a save (same round-trip reason as `columns`).
    ...(schema.rowGrid ? { rowGrid: true } : {}),
    ...(typeof schema.rowGap === "number" ? { rowGap: schema.rowGap } : {}),
    // The legend round-trips VERBATIM (the on-canvas box is derived from it).
    ...(schema.legend?.items?.length ? { legend: schema.legend } : {}),
    ...(custom_logos.length ? { custom_logos } : {}),
    nodes,
    edges,
  };
  // A nested file is saved nested: the flat nodes go back into their containers (a
  // dragged node is re-parented / re-ordered by where it was dropped).
  const final = schema.tree ? nestTree(out, schema.tree) : out;
  return "```json\n" + JSON.stringify(final, null, 2) + "\n```\n";
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
