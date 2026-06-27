/**
 * Platform Architecture Schema + Catalog
 * =======================================
 *
 * The *higher-level* successor to the old `architecture-schema.ts` wiring
 * diagram. Instead of nodes/edges/tiers, this models the demo the way the
 * Databricks "Data + AI Platform" slide does: a handful of CAPABILITY BANDS
 * stacked top→bottom, each holding a few product COMPONENTS.
 *
 *   Agentic Apps        ← apps, dashboards, Databricks One
 *   Agentic Work        ← Genie, agents, KA, ML
 *   Unified Governance  ← Unity Catalog, AI Gateway
 *   Agentic Data        ← Lakeflow, Lakehouse, Lakebase, AI Functions, …
 *   ── Open Storage ──   ← Delta / Iceberg footer strip
 *   Sources             ← the demo's source systems
 *
 * Why a fixed catalog + per-demo overrides:
 *   The bands and the full set of platform components are ALWAYS the same —
 *   that's the "default architecture base" the user asked for. A given demo
 *   only ever (a) marks which components are `active` vs `mentioned` vs
 *   `hidden`, and (b) tweaks per-demo copy (the story-tied description on a
 *   tile). Defaults for (a) are seeded from the project's resources.json
 *   (buildable → active, talking_track → mentioned, everything else hidden),
 *   so a freshly-generated demo already looks right with zero authoring.
 *
 * The agent writes a small JSON override into `architecture.md`; `buildSchema`
 * merges it onto the catalog. Everything the renderer needs is resolved here
 * so the component stays presentational.
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
}

export type IngestPath = "lakeflow-connect" | "zerobus" | "direct";

/** Composite block kinds (super-set components that draw an inner mini-diagram
 *  and expose multiple named ports). Extend this as we add more blocks. */
export type CompositeKind = "lakeflow" | "genie-code";

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
  /** Border styling. borderWidth 0 = no border. */
  borderWidth?: number;    // px
  borderStyle?: "solid" | "dashed";
  borderColor?: string;    // hex
  /** Stacking order (bring to front / send to back). Default 0. */
  z?: number;
  /** A canvas-added data source (from "+ more data sources"). Stores just the
   *  logo-catalog key + icon; label/ingest defaults come from the unified
   *  logo-catalog.json. Present only for such nodes. */
  source?: { key: string; icon: IconKey };
}

/** A free-form canvas annotation — not a Databricks catalog component. One node
 *  kind with four variants; all props persist in the layout. */
export type AnnotationVariant = "text" | "box" | "logo" | "image";
export interface AnnotationData {
  variant: AnnotationVariant;
  /** text/box: the (editable) text. */
  text?: string;
  /** text/box: font size in px (default 14). */
  fontSize?: number;
  /** text/box: show a border (box defaults true, text defaults false). */
  border?: boolean;
  /** box: vertical × horizontal text placement (default "middle"/"center"). */
  vAlign?: "top" | "middle" | "bottom";
  hAlign?: "left" | "center" | "right";
  /** logo: the chosen icon key — a DatabricksIconName OR a file-icon key
   *  ("file:vendor/snowflake", "file:cloud/aws/storage/s3"). */
  icon?: string;
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
   *  ingest (zerobus → particles, direct → docs, else laser). An explicit
   *  value overrides that default. */
  flowStyle?: "dot" | "particles" | "docs" | "laser";
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

// -- The override shape the AGENT writes into architecture.md ----------------
// Everything is optional/partial: a demo only says what differs from defaults.

export interface ComponentOverride {
  id: string;
  label?: string;
  icon?: IconKey;
  desc?: string;
  state?: ComponentState;
  capability?: string;
  ingest?: IngestPath;
  kind?: CompositeKind;
  sublabel?: string;
  badge?: string;
}

export interface BandOverride {
  id: BandId;
  /** Extra components not in the catalog — primarily the demo's `sources`. */
  add?: ComponentOverride[];
  /** Patches keyed by component id (catalog OR added). */
  set?: ComponentOverride[];
}

export interface ArchitectureOverride {
  name?: string;
  story?: string;
  /** Opt-in to render real third-party brand logos (trademark ack). */
  enableTrademarkLogos?: boolean;
  bands?: BandOverride[];
  /** Saved canvas layout. Written back by the editor on drag/drop. */
  layout?: Partial<PlatformLayout>;
}

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
const CATALOG: Record<BandId, CatalogComponent[]> = {
  "agentic-apps": [
    { id: "databricks-apps", label: "Databricks Apps", icon: "databricksApps", desc: "Custom web app where the team does the work — queue, actions, all in one place." },
    { id: "aibi-dashboards", label: "AI/BI Dashboard", icon: "aibiBrand", desc: "Governed dashboards on the same data — one set of numbers, one page." },
    { id: "databricks-one", label: "Databricks One", icon: "businessUser", desc: "One branded home for business users to ask, get answers, and take action." },
  ],
  "agentic-work": [
    { id: "genie", label: "AI/BI Genie", icon: "genieBrand", desc: "Ask questions of your data in plain language and get governed answers." },
    { id: "knowledge-assistant", label: "Knowledge Assistant", icon: "knowledgeAssistant", desc: "Chat with your documents — grounded, cited answers from unstructured content." },
    { id: "supervisor-agent", label: "Multi-Agent Supervisor", icon: "multiAgentSupervisor", desc: "Routes a question to the right specialist agent and composes the answer." },
    { id: "ml-training-serving", label: "ML Models", icon: "mlModel", desc: "Train, register, and serve models on governed data." },
    { id: "vector-search", label: "Vector Search", icon: "vectorSearch", desc: "Semantic search and retrieval that grounds agents in your data." },
    { id: "information-extraction", label: "Information Extraction", icon: "unstructuredData", desc: "Turn PDFs and documents into structured, queryable data." },
    { id: "genie-code", label: "Built with Genie Code", icon: "genieCodeBrand", kind: "genie-code", desc: "Describe it — Genie Code ingests the data and builds the dashboard, end to end." },
  ],
  "unified-governance": [
    { id: "unity-catalog", label: "Unity Catalog", icon: "unityCatalogBrand", desc: "One governed catalog — access, lineage, and semantics across data + AI." },
    { id: "ai-gateway", label: "Unity AI Gateway", icon: "aiGatewayBrand", desc: "Every model and agent call governed — security, cost, and rate limits." },
    { id: "data-quality", label: "Data Quality", icon: "unityCatalog", desc: "Expectations and monitors keep bad data out of the gold layer." },
    { id: "abac", label: "ABAC", icon: "unityCatalog", desc: "Attribute-based access control — fine-grained, policy-driven permissions." },
    { id: "data-classification", label: "Data Classification", icon: "unityCatalog", desc: "Automatically tag and govern sensitive data." },
  ],
  "agentic-data": [
    // Composite "Lakeflow" super-block: Lakeflow Connect + Zerobus + direct
    // ingest feeding a bronze→silver→gold pipeline, with 3 left input ports.
    { id: "lakeflow-block", label: "Lakeflow", icon: "lakeflowConnectBrand", kind: "lakeflow", desc: "One block: managed ingest (Lakeflow Connect), real-time streams (Zerobus) and direct file landing, all flowing into a declarative bronze → silver → gold pipeline." },
    { id: "lakeflow-connect", label: "Lakeflow Connect", icon: "lakeflowConnectBrand", desc: "Managed connectors ingest from databases and SaaS apps under governance." },
    { id: "zerobus-ingest", label: "Lakeflow Zerobus", icon: "zerobus", desc: "Real-time, direct ingest of streaming events into the lakehouse." },
    { id: "sdp", label: "Lakeflow SDP", icon: "sdpBrand", desc: "Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale." },
    { id: "uc-volume", label: "UC Volume", icon: "volume", desc: "Governed file storage in Unity Catalog — where raw documents (PDFs) land." },
    { id: "lakeflow-jobs", label: "Lakeflow Jobs", icon: "lakeflowJobsBrand", desc: "Orchestrate the whole pipeline on a schedule or trigger." },
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
    { id: "src-shopify", label: "Shopify", icon: "file:vendor/shopify", ingest: "lakeflow-connect", desc: "Orders & returns — 400K rows over 24 months, via Lakeflow Connect." },
    { id: "src-zendesk", label: "Zendesk", icon: "file:vendor/zendesk", ingest: "lakeflow-connect", desc: "Customer-service tickets & return reasons, via Lakeflow Connect." },
    { id: "src-erp", label: "ERP", icon: "file:vendor/sap", ingest: "lakeflow-connect", desc: "Production lots & QC records, via Lakeflow Connect." },
    { id: "src-sensors", label: "Sensor data", icon: "sensorSource", ingest: "zerobus", desc: "Real-time sensor / IoT telemetry, streamed via Zerobus." },
    { id: "src-pdf", label: "PDF documents", icon: "pdfLogo", ingest: "direct", desc: "Documents (PDFs) — landed as files on a UC Volume." },
  ],
};

// =============================================================================
// Build: catalog + resources.json defaults + agent override → final schema
// =============================================================================

export interface BuildInputs {
  /** The agent's override JSON parsed from architecture.md (may be null). */
  override: ArchitectureOverride | null;
  /** From resources.json — seeds default component states. */
  capabilities: { buildable: string[]; talking_track: string[] } | null;
}

/** Seed a component's default state from resources.json capability lists.
 *  Sources default to `active` (they're always part of the story). */
function defaultState(
  bandId: BandId,
  componentId: string,
  capabilities: BuildInputs["capabilities"],
): ComponentState {
  if (bandId === "sources") return "active";
  if (!capabilities) {
    // No resources.json yet → show the canonical core, hide the long tail so
    // a brand-new project still reads as a clean platform rather than a wall.
    return CORE_DEFAULT.has(componentId) ? "active" : "hidden";
  }
  if (capabilities.buildable.includes(componentId)) return "active";
  if (capabilities.talking_track.includes(componentId)) return "mentioned";
  return "hidden";
}

/** Components shown by default before any resources.json exists. */
const CORE_DEFAULT = new Set<string>([
  "databricks-apps",
  "aibi-dashboards",
  "genie",
  "unity-catalog",
  "sdp",
  "lakeflow-connect",
]);

export function buildSchema({ override, capabilities }: BuildInputs): PlatformSchema {
  const overrideBands = new Map<BandId, BandOverride>();
  override?.bands?.forEach((b) => overrideBands.set(b.id, b));

  const bands: PlatformBand[] = BAND_ORDER.map((bandId) => {
    const meta = BAND_META[bandId];
    const ob = overrideBands.get(bandId);

    // Patches keyed by component id (applies to catalog + added components).
    const patches = new Map<string, ComponentOverride>();
    ob?.set?.forEach((p) => patches.set(p.id, p));

    // Start from the catalog, then merge demo-added components (sources) by id.
    // An `add` whose id already exists in the catalog OVERRIDES it (rather than
    // creating a duplicate node) — e.g. the example demo re-declares the
    // catalog's src-shopify with its own logo/desc/ingest.
    const base: CatalogComponent[] = [...CATALOG[bandId]];
    const baseIndex = new Map(base.map((c, i) => [c.id, i]));
    for (const a of ob?.add ?? []) {
      const merged: CatalogComponent = {
        id: a.id,
        label: a.label ?? a.id,
        icon: a.icon ?? ("inputData" as DatabricksIconName),
        desc: a.desc ?? "",
        capability: a.capability,
        ingest: a.ingest,
        kind: a.kind,
        sublabel: a.sublabel,
        badge: a.badge,
      };
      const existing = baseIndex.get(a.id);
      if (existing !== undefined) base[existing] = merged;
      else { baseIndex.set(a.id, base.length); base.push(merged); }
    }

    const components: PlatformComponent[] = base.map((c) => {
      const patch = patches.get(c.id);
      return {
        id: c.id,
        label: patch?.label ?? c.label,
        icon: patch?.icon ?? c.icon,
        desc: patch?.desc ?? c.desc,
        capability: patch?.capability ?? c.capability,
        ingest: patch?.ingest ?? c.ingest,
        kind: patch?.kind ?? c.kind,
        sublabel: patch?.sublabel ?? c.sublabel,
        badge: patch?.badge ?? c.badge,
        state: patch?.state ?? defaultState(bandId, c.id, capabilities),
      };
    });

    return { id: bandId, label: meta.label, sublabel: meta.sublabel, components };
  });

  const layout = buildLayout(bands, override?.layout);

  return {
    name: override?.name ?? "Solution architecture",
    story: override?.story,
    enableTrademarkLogos: override?.enableTrademarkLogos ?? false,
    bands,
    layout,
  };
}

// =============================================================================
// Layout — auto-place nodes by band (L→R), seed flow edges, merge saved layout
// =============================================================================

/** Canvas geometry for the auto-layout seed. */
export const CANVAS = {
  colGap: 300,     // x spacing between band columns
  rowGap: 96,      // y spacing between stacked nodes in a column
  colX: {          // x of each flow column
    sources: 0,
    "agentic-data": 300,
    "agentic-work": 600,
    "agentic-apps": 900,
  } as Record<string, number>,
  governanceY: 560, // y of the governance row (foundation, spans the bottom)
  topY: 40,
};

/** Compute the default position for a component, by band + index in column. */
function autoPos(bandId: BandId, index: number): NodePosition {
  if (bandId === FOUNDATION_BAND) {
    return { x: CANVAS.colX.sources + index * CANVAS.colGap, y: CANVAS.governanceY };
  }
  const x = CANVAS.colX[bandId] ?? 0;
  return { x, y: CANVAS.topY + index * CANVAS.rowGap };
}

/** A canvas node id is `<componentId>` or, for an extra placement of the same
 *  component, `<componentId>#2`, `#3`, … `baseId` recovers the catalog
 *  component id from any node/layout/edge id. */
export function baseId(nodeId: string): string {
  const h = nodeId.indexOf("#");
  return h === -1 ? nodeId : nodeId.slice(0, h);
}

/** Build the full layout: start from auto-positions + auto flow edges, then
 *  overlay anything the saved layout (architecture.md) pinned. */
export function buildLayout(
  bands: PlatformBand[],
  saved?: Partial<PlatformLayout>,
): PlatformLayout {
  const savedNodes = saved?.nodes ?? {};
  const hidden = new Set(saved?.hidden ?? []);

  const nodes: Record<string, NodePosition> = {};
  bands.forEach((band) => {
    const visible = band.components.filter(
      (c) => c.state !== "hidden" && !hidden.has(c.id),
    );
    visible.forEach((c, i) => {
      nodes[c.id] = savedNodes[c.id] ?? autoPos(band.id, i);
    });
  });

  // Carry over EXTRA placements (instance ids like `genie#2`) — duplicates the
  // user dropped that have no schema component of their own. Their base must be
  // a real, visible component; pin them at their saved position (or near base).
  for (const [nid, pos] of Object.entries(savedNodes)) {
    if (nid in nodes || nid.indexOf("#") === -1) continue;
    if (nodes[baseId(nid)]) nodes[nid] = pos;
  }

  // Carry over free-form ANNOTATION nodes (ids start with "anno-"). They have
  // no catalog component — their full props live in pos.annotation.
  for (const [nid, pos] of Object.entries(savedNodes)) {
    if (nid in nodes) continue;
    if (nid.startsWith("anno-") && pos.annotation) nodes[nid] = pos;
  }

  // Carry over canvas-added SOURCE nodes (from "+ more data sources"). Not in
  // the catalog — their label/icon/ingest live in pos.source.
  for (const [nid, pos] of Object.entries(savedNodes)) {
    if (nid in nodes) continue;
    if (pos.source) nodes[nid] = pos;
  }

  // Edges: saved if present, else auto-seed the real demo flow.
  const edges: PlatformEdge[] = saved?.edges?.length ? saved.edges : seedEdges(bands, hidden);

  return { nodes, edges, hidden: [...hidden] };
}

/** Auto-seed a sensible flow the user then reshapes:
 *   every source → its ingest target (Lakeflow Connect, or SDP directly for
 *   `zerobus`/`direct`) → SDP → first Agentic Work → first Agentic Apps.
 *  Connects ALL sources, not just the first. */
function seedEdges(bands: PlatformBand[], hidden: Set<string>): PlatformEdge[] {
  const edges: PlatformEdge[] = [];
  const seen = new Set<string>();
  const push = (source: string, target: string, targetHandle?: string, sourceHandle?: string, flowStyle?: PlatformEdge["flowStyle"]) => {
    const id = `e-${source}-${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, animated: true, ...(targetHandle ? { targetHandle } : {}), ...(sourceHandle ? { sourceHandle } : {}), ...(flowStyle && flowStyle !== "dot" ? { flowStyle } : {}) });
  };

  const band = (id: BandId) => bands.find((b) => b.id === id);
  const visible = (b?: PlatformBand) =>
    (b?.components ?? []).filter((c) => c.state !== "hidden" && !hidden.has(c.id));
  const firstId = (id: BandId) => visible(band(id))[0]?.id;

  const has = (id: string) =>
    bands.some((b) => b.components.some((c) => c.id === id && c.state !== "hidden" && !hidden.has(c.id)));

  // Prefer the composite Lakeflow block (it has named input ports per ingest
  // path); fall back to the separate lakeflow-connect / sdp components.
  const block = has("lakeflow-block") ? "lakeflow-block" : undefined;
  const sdp = has("sdp") ? "sdp" : undefined;
  const lfc = has("lakeflow-connect") ? "lakeflow-connect" : undefined;
  const dataFirst = firstId("agentic-data");

  // Each source → the right INPUT PORT of the Lakeflow block by its ingest path:
  //   lakeflow-connect → in-lakeflow-connect, zerobus → in-zerobus, direct → in-direct.
  for (const src of visible(band("sources"))) {
    const path = src.ingest ?? "lakeflow-connect";
    // Flow style by ingest: realtime/streaming (zerobus) → particles; direct
    // file landing → documents; managed connectors → plain dot.
    const flow: PlatformEdge["flowStyle"] = path === "zerobus" ? "particles" : path === "direct" ? "docs" : "dot";
    if (block) {
      push(src.id, block, `in-${path}`, undefined, flow);
    } else if (path === "lakeflow-connect" && lfc) {
      push(src.id, lfc);
    } else if (sdp) {
      push(src.id, sdp);
    } else if (dataFirst) {
      push(src.id, dataFirst);
    }
  }
  if (lfc && sdp) push(lfc, sdp); // legacy path when no composite block

  // Data exit → Agentic Work → Agentic Apps. The block emits from its right
  // output handle ("r").
  const workFirst = firstId("agentic-work");
  const appsFirst = firstId("agentic-apps");
  const dataExit = block ?? sdp ?? dataFirst;
  if (dataExit && workFirst) push(dataExit, workFirst, undefined, block ? "r" : undefined);
  if (workFirst && appsFirst) push(workFirst, appsFirst);

  return edges;
}

// =============================================================================
// Serialize — write the editor's layout back into an ArchitectureOverride
// =============================================================================

/** Reconstruct a COMPLETE override from the resolved schema. Emits every
 *  band with its components as `set` entries (label/icon/desc/state/…), and any
 *  component the catalog doesn't define (the demo's sources) as `add`. This is
 *  the bulletproof part: the canvas always writes the full semantic content
 *  rebuilt from the live schema, so a save can NEVER strip bands/descriptions
 *  — even if the file it loaded from was a partial/corrupt override. */
function schemaToOverride(schema: PlatformSchema, placed: Set<string>): ArchitectureOverride {
  const bands: BandOverride[] = schema.bands.map((band) => {
    const catalogIds = new Set(CATALOG[band.id].map((c) => c.id));
    const add: ComponentOverride[] = [];
    const set: ComponentOverride[] = [];
    for (const c of band.components) {
      // The CANVAS is the source of truth for visibility: a component placed
      // on it is active; one that isn't is hidden. This keeps state in sync
      // with the layout — fixes a library-added (default-hidden) component
      // vanishing on reload because its computed state stayed "hidden".
      const state: ComponentState = placed.has(c.id)
        ? c.state === "mentioned" ? "mentioned" : "active"
        : "hidden";
      const entry: ComponentOverride = {
        id: c.id,
        label: c.label,
        icon: c.icon,
        desc: c.desc,
        state,
        ...(c.capability ? { capability: c.capability } : {}),
        ...(c.ingest ? { ingest: c.ingest } : {}),
        ...(c.kind ? { kind: c.kind } : {}),
      };
      if (catalogIds.has(c.id)) set.push(entry);
      else add.push(entry);
    }
    return { id: band.id, ...(add.length ? { add } : {}), ...(set.length ? { set } : {}) };
  });
  return {
    name: schema.name,
    story: schema.story,
    ...(schema.enableTrademarkLogos ? { enableTrademarkLogos: true } : {}),
    bands,
  };
}

/** Build the JSON string to persist as architecture.md: the full semantic
 *  override rebuilt from the live schema + the edited canvas layout. The
 *  layout's node keys are the placed (visible) components. */
export function serializeArchitecture(
  schema: PlatformSchema,
  layout: PlatformLayout,
): string {
  // Visibility is keyed by catalog (base) id — duplicates (`genie#2`) collapse
  // to their base so the component stays "active". The layout keeps the
  // instance ids verbatim so each duplicate keeps its own position/edges.
  const placed = new Set(Object.keys(layout.nodes).map(baseId));
  const out: ArchitectureOverride = { ...schemaToOverride(schema, placed), layout };
  return "```json\n" + JSON.stringify(out, null, 2) + "\n```\n";
}

// =============================================================================
// Parsing — pull the override JSON out of architecture.md
// =============================================================================

/** Extract the JSON override from architecture.md (fenced ```json block or a
 *  bare top-level object). Returns null if absent/unparseable — the caller
 *  then renders the catalog defaults, which is the correct fallback. */
export function parseOverride(content: string): ArchitectureOverride | null {
  try {
    const block = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const raw = block ? block[1].trim() : content.trim();
    if (!raw.startsWith("{")) return null;
    return JSON.parse(raw) as ArchitectureOverride;
  } catch {
    return null;
  }
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
