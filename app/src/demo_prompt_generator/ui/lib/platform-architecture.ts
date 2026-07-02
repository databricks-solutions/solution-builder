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
  /** For SOURCE components only — how the source is ingested. Drives the
   *  ingest rail between Sources and Agentic Data:
   *    "lakeflow-connect" → routed through the Lakeflow Connect rail (default)
   *    "zerobus"          → realtime path (Zerobus), drawn distinctly
   *    "direct"           → no rail (e.g. files landing on a Volume) */
  ingest?: IngestPath;
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
}

export type IngestPath = "lakeflow-connect" | "zerobus" | "direct";

/** The animated-flow rendering style of an edge. `dot` = a single travelling
 *  dot; `particles` = a dense river of cubes/circles/triangles (realtime);
 *  `docs` = travelling document glyphs (file landing); `laser` = a comet with a
 *  fading tail (explicit-choice only — never auto-derived). Canonical home for
 *  the union; the UI layer re-uses it so schema + renderer + menu never drift. */
export type FlowStyle = "dot" | "particles" | "docs" | "laser";

/** Composite block kinds (super-set components that draw an inner mini-diagram
 *  and expose multiple named ports). Extend this as we add more blocks. */
export type CompositeKind = "lakeflow" | "genie-code" | "governance" | "lakeflow-genie" | "agent-bricks" | "db-platform";

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
   *  logo-catalog key + icon; label/ingest defaults come from the unified
   *  logo-catalog.json. Present only for such nodes. */
  source?: { key: string; icon: IconKey; ingest?: IngestPath };
  /** Group membership — a shared id stamped on every member of a group
   *  (right-click → Group). Selecting one member selects the whole group so
   *  they move together. Cleared on Ungroup. No container node — just a tag. */
  groupId?: string;
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
  /** box: vertical × horizontal text placement (default "middle"/"center"). */
  vAlign?: "top" | "middle" | "bottom";
  hAlign?: "left" | "center" | "right";
  /** logo: the chosen icon key — a DatabricksIconName OR a file-icon key
   *  ("file:vendor/snowflake", "file:cloud/aws/storage/s3"). */
  icon?: string;
  /** logo: where the text caption sits relative to the icon —
   *  right | left | top | bottom. Legacy "side" == right, "below" == bottom.
   *  Default (unset) renders below (the original logo caption behavior). */
  caption?: "right" | "left" | "top" | "bottom" | "side" | "below";
  /** image: a URL, or a `data:` base64 string for pasted images. */
  src?: string;
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
  /** Flowing-data animation style. Unset → auto-derived from the source's
   *  ingest (zerobus → particles, direct → docs, else dot). An explicit value
   *  overrides that default (this is the only way to get `laser`). */
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
  icon?: IconKey;
  /** source nodes: ingest path. */
  ingest?: IngestPath;
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
 *  with story-tied copy. Kept short — one sentence, what it does for a user. */
export const CATALOG: Record<BandId, CatalogComponent[]> = {
  "agentic-apps": [
    { id: "databricks-apps", label: "Databricks Apps", icon: "databricksApps", desc: "Custom web app where the team does the work — queue, actions, all in one place." },
    { id: "aibi-dashboards", label: "AI/BI Dashboard", icon: "aibiBrand", sublabel: "Analyst consult & build insight", desc: "Governed dashboards on the same data — one set of numbers, one page." },
  ],
  "agentic-work": [
    { id: "databricks-apps-work", label: "Databricks Apps", icon: "databricksAppsBrand", sublabel: "Deploy business apps", desc: "Deploy business apps",
      authoring: "The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Room." },
    { id: "genie-one", label: "Genie One - Mobile app", icon: "genieOneBrand", sublabel: "Databricks access for business user", desc: "Databricks access for business user",
      authoring: "The business-user / mobile entry point. Convention: a file:persona/user logo (caption 'Business users') to its right — user ==> Genie One, and Genie One --> dashboard / Genie Room / app. Those edges auto-render as arrows (leave `arrow` out)." },
    { id: "genie", label: "Genie Room", icon: "genieBrand", sublabel: "Ask anything about your data", desc: "ask anything about your data" },
    { id: "knowledge-assistant", label: "Knowledge Assistant", icon: "knowledgeAssistant", desc: "Chat with your documents — grounded, cited answers from unstructured content." },
    { id: "supervisor-agent", label: "Supervisor Agent", icon: "multiAgentSupervisor", desc: "Routes a question to the right specialist agent and composes the answer." },
    // Composite "Agent Bricks" block: the bundled agent building blocks
    // (supervisor + extraction + document parsing + classification).
    { id: "agent-bricks", label: "Agent Bricks", icon: "file:vendor/agent-bricks", kind: "agent-bricks",
      desc: "Databricks' managed agents — a multi-agent supervisor plus information extraction, document parsing, and classification, built and governed for you.",
      authoring: "Managed MULTI-agent system: a Supervisor orchestrating Knowledge Assistant / Genie / MCP / Functions (with extraction·parsing·classification chips). Use when the agent layer is a supervisor routing to specialists; if the demo uses only one agent capability, use that single tile instead." },
    { id: "ml-training-serving", label: "ML Models", icon: "mlModel", desc: "Train, register, and serve models on governed data." },
    { id: "vector-search", label: "Vector Search", icon: "vectorSearch", desc: "Semantic search and retrieval that grounds agents in your data." },
    { id: "information-extraction", label: "Information Extraction", icon: "unstructuredData", desc: "Turn PDFs and documents into structured, queryable data." },
    // The Agent Bricks building blocks (also surfaced inside the composite).
    { id: "document-parsing", label: "Document Parsing", icon: "inputData", desc: "Parse PDFs and documents into clean, structured text + layout." },
    { id: "classification", label: "Classification", icon: "aiFunctions", desc: "Classify documents and records into governed categories." },
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
      desc: "The Databricks Data Intelligence Platform — one governed foundation for all data + AI.",
      authoring: "Title banner (the Databricks wordmark). Pin it top-left, usually paired with a big background box (z:-1) wrapping everything → reads as 'all of this is the platform'." },
    { id: "unity-catalog", label: "Unity Catalog", icon: "unityCatalogBrand", desc: "One governed catalog — access, lineage, and semantics across data + AI." },
    { id: "ai-gateway", label: "Unity AI Gateway", icon: "aiGatewayBrand", desc: "Every model and agent call governed — security, cost, and rate limits." },
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
      ports: { "in-lakeflow-connect": "← databases / SaaS apps (ingest: lakeflow-connect)", "in-zerobus": "← realtime streams / sensors (ingest: zerobus)", "in-direct": "← files: PDF / CSV / Parquet (ingest: direct)", "r": "→ the compute layer" } },
    // Combined box: the Lakeflow super-block stacked over the Genie Code block.
    { id: "lakeflow-genie-block", label: "Lakeflow + Genie", icon: "lakeflowConnectBrand", kind: "lakeflow-genie",
      desc: "Lakeflow ingest + declarative pipeline, with Genie Code building and maintaining it — one box, end to end.",
      authoring: "The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it.",
      ports: { "in-lakeflow-connect": "← databases / SaaS apps (ingest: lakeflow-connect)", "in-zerobus": "← realtime streams / sensors (ingest: zerobus)", "in-direct": "← files: PDF / CSV / Parquet (ingest: direct)", "r": "→ the compute layer" } },
    { id: "lakeflow-connect", label: "Lakeflow Connect", icon: "lakeflowConnectBrand", desc: "A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems." },
    { id: "zerobus-ingest", label: "Lakeflow Zerobus", icon: "zerobus", desc: "Real-time, direct ingest of streaming events into the lakehouse." },
    { id: "sdp", label: "Lakeflow SDP", icon: "sdpBrand", desc: "Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale." },
    { id: "uc-volume", label: "UC Volume", icon: "volume", desc: "Governed file storage in Unity Catalog — where raw documents (PDFs) land." },
    { id: "lakeflow-jobs", label: "Lakeflow Jobs", icon: "lakeflowJobsBrand", sublabel: "Orchestrate anything", desc: "Orchestrate the whole pipeline on a schedule or trigger." },
    { id: "notebooks-eda", label: "Notebooks", icon: "notebooks", desc: "Interactive exploration and analysis on governed data." },
    { id: "delta-sharing", label: "Delta Sharing", icon: "deltaSharing", desc: "Open, cross-org data sharing with no copies." },
    { id: "marketplace", label: "Marketplace", icon: "deltaSharing", desc: "Discover and consume third-party data and AI assets." },
    { id: "lakebase", label: "Lakebase", icon: "lakebaseBrand", sublabel: "Serverless Postgres — instant start, branch", desc: "Managed Postgres for app state — reads/writes the live queue." },
    { id: "lakehouse", label: "Lakehouse", icon: "lakehouseBrand", badge: "RT", sublabel: "~100 ms charts, thousands of concurrent users", desc: "One copy of governed data for BI + AI — real-time queries at scale." },
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
    { id: "src-kafka", label: "Kafka", icon: "file:vendor/kafka", ingest: "zerobus", desc: "Streaming events ingested in real time via Zerobus." },
    { id: "src-postgres", label: "Postgres", icon: "file:vendor/postgresql", ingest: "lakeflow-connect", desc: "Operational database ingested via Lakeflow Connect." },
    { id: "src-sensors", label: "Sensor data", icon: "sensorSource", ingest: "zerobus", desc: "Real-time sensor / IoT telemetry, streamed via Zerobus." },
    { id: "src-pdf", label: "PDF documents", icon: "pdfLogo", ingest: "direct", desc: "Documents (PDFs) — landed as files on a UC Volume." },
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

/** Natural [w,h] for a file `type` (catalog id / composite kind / source /
 *  annotation variant). Mirrors shared.tsx `baseSize`. */
export function naturalSize(type: string): { w: number; h: number } {
  if (ANNOTATION_TYPES.has(type as AnnotationVariant)) return ANNOTATION_SIZE[type as AnnotationVariant];
  const c = CATALOG_BY_ID.get(type)?.c;
  const kind = c?.kind;
  if (kind === "lakeflow") return { w: 224, h: 148 };
  if (kind === "lakeflow-genie") return { w: 360, h: 208 };
  if (kind === "agent-bricks") return { w: 230, h: 170 };
  if (kind === "genie-code") return { w: 360, h: 112 };
  if (kind === "governance") return { w: 580, h: 108 };
  if (kind === "db-platform") return { w: 380, h: 60 };
  if (type === "sdp") return { w: 230, h: 112 };
  if (c?.sublabel) return { w: 230, h: 70 };
  return { w: 200, h: 56 }; // plain tile + sources
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

const COL_GAP = 340;  // x spacing between lane centers
const ROW_GAP = 28;   // vertical gap between stacked tiles in a lane
const WRAP_PAD = 24;   // default container padding

export interface ResolvedBox { x: number; y: number; w: number; h: number }

/** Resolve every node's CENTER [x,y] (and, for wrapper boxes, its [w,h]) from
 *  the file's `columns`/`col`/`row` + `wraps`. A node with an explicit `at` is
 *  pinned there (and excluded from column stacking). Returns a map id→box. */
export function computeLayout(file: ArchitectureFile): Map<string, ResolvedBox> {
  const out = new Map<string, ResolvedBox>();
  const nodes = file.nodes ?? [];
  const sizeOf = (n: FileNode): { w: number; h: number } =>
    n.size ? { w: n.size[0], h: n.size[1] } : naturalSize(n.type);

  // 1) Pinned nodes (explicit `at`) — use verbatim. Wrapper boxes are resolved
  //    later (their size/pos derive from children) unless they too were pinned.
  for (const n of nodes) {
    if (Array.isArray(n.at)) {
      const s = sizeOf(n);
      out.set(n.id, { x: n.at[0], y: n.at[1], w: s.w, h: s.h });
    }
  }

  // 2) Column stacking — only non-wrapper, un-pinned nodes that declare a `col`.
  const cols = file.columns ?? [];
  const colIndex = new Map(cols.map((c, i) => [c, i]));
  const laned = nodes.filter((n) => !out.has(n.id) && !n.wraps && n.col && colIndex.has(n.col));
  const byCol = new Map<string, FileNode[]>();
  for (const n of laned) {
    const arr = byCol.get(n.col!) ?? [];
    arr.push(n);
    byCol.set(n.col!, arr);
  }
  for (const [col, list] of byCol) {
    list.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)); // stable-ish; appearance order kept for ties
    const x = (colIndex.get(col)! ) * COL_GAP;
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
      out.set(n.id, { x: 0, y: 0, w: s.w, h: s.h });
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
  const colCenterX = (name: string) =>
    colIndex.has(name) ? colIndex.get(name)! * COL_GAP : undefined;
  const sideCoord = (spec: string, axis: "x" | "y"): number | undefined => {
    if (spec === "wrap") return undefined;
    if (spec.startsWith("col:")) {
      const [, name, anchor = "center"] = spec.split(":");
      const cx = colCenterX(name);
      if (cx === undefined || axis !== "x") return undefined;
      // a column has no intrinsic width here → treat center == left == right
      return cx + (anchor === "left" ? -COL_GAP / 2 : anchor === "right" ? COL_GAP / 2 : 0);
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
    const pos: NodePosition = {
      x: x ?? 0,
      y: y ?? 0,
      ...(n.rot !== undefined ? { rot: n.rot } : {}),
      ...(derivedSize ? { w: derivedSize[0], h: derivedSize[1] } : {}),
      ...(n.scale !== undefined ? { scale: n.scale } : {}),
      ...(n.z !== undefined ? { z: n.z } : {}),
      ...(n.group !== undefined ? { groupId: n.group } : {}),
      ...(n.label !== undefined ? { label: n.label } : {}),
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
        ...(n.icon !== undefined ? { icon: n.icon } : {}),
        ...(n.caption !== undefined ? { caption: n.caption } : {}),
        ...(n.src !== undefined ? { src: n.src } : {}),
      };
    } else if (n.type === "source") {
      // A data source: carry its logo key + icon + (optional) ingest so
      // flow-mapping renders it via the canvas-added-source path.
      const key = (n.icon ?? "").replace(/^file:.*\//, "").replace(/^file:/, "").toLowerCase() || baseId(n.id).replace(/^src-/, "");
      pos.source = { key, icon: (n.icon ?? "inputData") as IconKey, ...(n.ingest ? { ingest: n.ingest } : {}) };
      if (n.label !== undefined) pos.label = n.label;
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
  // it from geometry (+ source ingest into a Lakeflow block).
  const ingestOf = (fileId: string): IngestPath | undefined => {
    const fn = (file.nodes ?? []).find((x) => x.id === fileId);
    return fn?.type === "source" ? (fn.ingest ?? "lakeflow-connect") : undefined;
  };
  const isLakeflow = (fileId: string): boolean => {
    const fn = (file.nodes ?? []).find((x) => x.id === fileId);
    const k = fn ? CATALOG_BY_ID.get(fn.type)?.c.kind : undefined;
    return k === "lakeflow" || k === "lakeflow-genie";
  };
  const inferHandles = (sId: string, tId: string): { sh?: string; th?: string } => {
    // Source → Lakeflow block: pick the target PORT from the source's ingest.
    if (ingestOf(sId) && isLakeflow(tId)) return { sh: "r", th: `in-${ingestOf(sId)}` };
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
    const at: [number, number] = [Math.round(pos.x), Math.round(pos.y)];
    const common: Partial<FileNode> = {
      ...(pos.w !== undefined && pos.h !== undefined ? { size: [pos.w, pos.h] as [number, number] } : {}),
      ...(pos.rot ? { rot: pos.rot } : {}),
      ...(pos.scale !== undefined && pos.scale !== 1 ? { scale: pos.scale } : {}),
      ...(pos.z ? { z: pos.z } : {}),
      ...(pos.groupId ? { group: pos.groupId } : {}),
    };
    const style = styleOf(pos);

    if (pos.annotation) {
      const a = pos.annotation;
      nodes.push({
        id, type: a.variant, at, ...common,
        ...(a.text !== undefined ? { text: a.text } : {}),
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.titleIcon !== undefined ? { titleIcon: a.titleIcon as IconKey } : {}),
        ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
        ...(a.bold !== undefined ? { bold: a.bold } : {}),
        ...(a.vAlign !== undefined ? { vAlign: a.vAlign } : {}),
        ...(a.hAlign !== undefined ? { hAlign: a.hAlign } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        ...(a.caption !== undefined ? { caption: a.caption } : {}),
        ...(a.src !== undefined ? { src: a.src } : {}),
        ...(style ? { style } : {}),
      });
      continue;
    }
    if (pos.source) {
      nodes.push({
        id, type: "source", at, ...common,
        ...(pos.label !== undefined ? { label: pos.label } : {}),
        icon: (pos.icon ?? pos.source.icon) as IconKey,
        ...(pos.source.ingest ? { ingest: pos.source.ingest } : {}),
        ...(style ? { style } : {}),
      });
      continue;
    }
    // Catalog component: type = its base id. Emit label/desc/icon only when
    // they differ from the catalog default.
    const type = baseId(id);
    const def = CATALOG_BY_ID.get(type)?.c;
    nodes.push({
      id, type, at, ...common,
      ...(pos.label !== undefined && pos.label !== def?.label ? { label: pos.label } : {}),
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
