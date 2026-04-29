/**
 * Unified color palette for Databricks resources.
 *
 * Single source of truth shared by:
 *   - DeployedResourcesBar pills (per resource_type)
 *   - Architecture diagram nodes (per icon, overlays tier color when present)
 *
 * Keyed by Databricks icon name. The pill UI maps `resource_type` strings
 * to icon names via RESOURCE_TYPE_TO_ICON below.
 *
 * IMPORTANT: Tailwind v4 scans literal class names — every class string here
 * must appear verbatim in the source so the JIT can find it.
 */

import type { DatabricksIconName } from "../components/databricks-icons";

export interface ResourceColor {
  // Pill (resource bar): light tint backgrounds, on-light icon
  pillBg: string;
  pillHover: string;
  iconClass: string;
  // Architecture node: stronger label color, soft bg, accent stripe
  labelClass: string;
  nodeBg: string;
  nodeBorder: string;
  stripe: string; // hex for borderLeft + edges
}

// Bronze-Silver-Gold medallion gradient — pipelines only
export const MEDALLION = {
  pillBg:
    "bg-[linear-gradient(110deg,rgba(180,83,9,0.18),rgba(148,163,184,0.18)_50%,rgba(202,138,4,0.18))] border-amber-600/40",
  pillHover:
    "hover:bg-[linear-gradient(110deg,rgba(180,83,9,0.28),rgba(148,163,184,0.28)_50%,rgba(202,138,4,0.28))]",
  iconClass: "text-amber-600 dark:text-amber-400",
  labelClass: "text-amber-700 dark:text-amber-400",
  nodeBg:
    "bg-[linear-gradient(110deg,rgba(180,83,9,0.10),rgba(148,163,184,0.10)_50%,rgba(202,138,4,0.10))]",
  nodeBorder: "border-amber-600/30",
  stripe: "#c9a227",
} as const;

const VIOLET: ResourceColor = {
  pillBg: "bg-violet-500/10 border-violet-500/30",
  pillHover: "hover:bg-violet-500/20",
  iconClass: "text-violet-500",
  labelClass: "text-violet-600 dark:text-violet-400",
  nodeBg: "bg-violet-500/[0.08]",
  nodeBorder: "border-violet-500/25",
  stripe: "#8b5cf6",
};

const AMBER: ResourceColor = {
  pillBg: "bg-amber-500/10 border-amber-500/30",
  pillHover: "hover:bg-amber-500/20",
  iconClass: "text-amber-500",
  labelClass: "text-amber-600 dark:text-amber-400",
  nodeBg: "bg-amber-500/[0.08]",
  nodeBorder: "border-amber-500/25",
  stripe: "#f59e0b",
};

const FUCHSIA: ResourceColor = {
  pillBg: "bg-fuchsia-500/10 border-fuchsia-500/30",
  pillHover: "hover:bg-fuchsia-500/20",
  iconClass: "text-fuchsia-500",
  labelClass: "text-fuchsia-600 dark:text-fuchsia-400",
  nodeBg: "bg-fuchsia-500/[0.08]",
  nodeBorder: "border-fuchsia-500/25",
  stripe: "#d946ef",
};

const PINK: ResourceColor = {
  pillBg: "bg-pink-500/10 border-pink-500/30",
  pillHover: "hover:bg-pink-500/20",
  iconClass: "text-pink-500",
  labelClass: "text-pink-600 dark:text-pink-400",
  nodeBg: "bg-pink-500/[0.08]",
  nodeBorder: "border-pink-500/25",
  stripe: "#ec4899",
};

const CYAN: ResourceColor = {
  pillBg: "bg-cyan-500/10 border-cyan-500/30",
  pillHover: "hover:bg-cyan-500/20",
  iconClass: "text-cyan-500",
  labelClass: "text-cyan-600 dark:text-cyan-400",
  nodeBg: "bg-cyan-500/[0.08]",
  nodeBorder: "border-cyan-500/25",
  stripe: "#06b6d4",
};

const EMERALD: ResourceColor = {
  pillBg: "bg-emerald-500/10 border-emerald-500/30",
  pillHover: "hover:bg-emerald-500/20",
  iconClass: "text-emerald-500",
  labelClass: "text-emerald-600 dark:text-emerald-400",
  nodeBg: "bg-emerald-500/[0.08]",
  nodeBorder: "border-emerald-500/25",
  stripe: "#10b981",
};

const SKY: ResourceColor = {
  pillBg: "bg-sky-500/10 border-sky-500/30",
  pillHover: "hover:bg-sky-500/20",
  iconClass: "text-sky-500",
  labelClass: "text-sky-600 dark:text-sky-400",
  nodeBg: "bg-sky-500/[0.08]",
  nodeBorder: "border-sky-500/25",
  stripe: "#0ea5e9",
};

const INDIGO: ResourceColor = {
  pillBg: "bg-indigo-500/10 border-indigo-500/30",
  pillHover: "hover:bg-indigo-500/20",
  iconClass: "text-indigo-500",
  labelClass: "text-indigo-600 dark:text-indigo-400",
  nodeBg: "bg-indigo-500/[0.08]",
  nodeBorder: "border-indigo-500/25",
  stripe: "#6366f1",
};

const ROSE: ResourceColor = {
  pillBg: "bg-rose-500/10 border-rose-500/30",
  pillHover: "hover:bg-rose-500/20",
  iconClass: "text-rose-500",
  labelClass: "text-rose-600 dark:text-rose-400",
  nodeBg: "bg-rose-500/[0.08]",
  nodeBorder: "border-rose-500/25",
  stripe: "#f43f5e",
};

const RED: ResourceColor = {
  pillBg: "bg-red-500/10 border-red-500/30",
  pillHover: "hover:bg-red-500/20",
  iconClass: "text-red-500",
  labelClass: "text-red-600 dark:text-red-400",
  nodeBg: "bg-red-500/[0.08]",
  nodeBorder: "border-red-500/25",
  stripe: "#ef4444",
};

const TEAL: ResourceColor = {
  pillBg: "bg-teal-500/10 border-teal-500/30",
  pillHover: "hover:bg-teal-500/20",
  iconClass: "text-teal-500",
  labelClass: "text-teal-600 dark:text-teal-400",
  nodeBg: "bg-teal-500/[0.08]",
  nodeBorder: "border-teal-500/25",
  stripe: "#14b8a6",
};

const PURPLE: ResourceColor = {
  pillBg: "bg-purple-500/10 border-purple-500/30",
  pillHover: "hover:bg-purple-500/20",
  iconClass: "text-purple-500",
  labelClass: "text-purple-600 dark:text-purple-400",
  nodeBg: "bg-purple-500/[0.08]",
  nodeBorder: "border-purple-500/25",
  stripe: "#a855f7",
};

const BLUE: ResourceColor = {
  pillBg: "bg-blue-500/10 border-blue-500/30",
  pillHover: "hover:bg-blue-500/20",
  iconClass: "text-blue-500",
  labelClass: "text-blue-600 dark:text-blue-400",
  nodeBg: "bg-blue-500/[0.08]",
  nodeBorder: "border-blue-500/25",
  stripe: "#3b82f6",
};

const SLATE_DEFAULT: ResourceColor = {
  pillBg: "bg-slate-500/10 border-slate-500/30",
  pillHover: "hover:bg-slate-500/20",
  iconClass: "text-slate-500",
  labelClass: "text-slate-600 dark:text-slate-400",
  nodeBg: "bg-slate-500/[0.08]",
  nodeBorder: "border-slate-500/25",
  stripe: "#64748b",
};

// Per-icon palette. Each distinct Databricks product gets its own color so
// the architecture diagram and resource bar both look distinct at a glance.
export const ICON_PALETTE: Partial<Record<DatabricksIconName, ResourceColor>> =
  {
    dashboard: VIOLET,
    genie: AMBER,
    knowledgeAssistant: FUCHSIA,
    multiAgentSupervisor: PINK,
    agents: FUCHSIA,
    metricViews: CYAN,
    databricksApps: EMERALD,
    sqlWarehouse: SKY,
    lakebase: INDIGO,
    modelServing: ROSE,
    mlModel: RED,
    vectorSearch: TEAL,
    aiGateway: PURPLE,
    aiFunctions: BLUE,
    deltaSharing: INDIGO,
    lakeflowConnect: BLUE,
    streaming: BLUE,
  };

// Icons that should render the medallion (bronze/silver/gold) gradient.
export const MEDALLION_ICONS = new Set<DatabricksIconName>([
  "sdpPipeline",
  "jobsPipelines",
]);

// Icons that intentionally use tier color in the arch diagram, not an icon
// override. Returning null from getIconPalette for these lets nodes fall
// back to TIER_CONFIG so bronze/silver/gold layers stay visually distinct.
const GENERIC_ICONS = new Set<DatabricksIconName>([
  "deltaTable",
  "data",
  "deltaLake",
  "unstructuredData",
  "inputData",
  "unityCatalog",
  "businessUser",
  "notebooks",
]);

export type IconLookupResult =
  | { kind: "color"; color: ResourceColor }
  | { kind: "medallion" }
  | null;

export function getIconPalette(icon: DatabricksIconName): IconLookupResult {
  if (MEDALLION_ICONS.has(icon)) return { kind: "medallion" };
  if (GENERIC_ICONS.has(icon)) return null;
  const c = ICON_PALETTE[icon];
  return c ? { kind: "color", color: c } : null;
}

// Maps the resource_type strings in resources.json to icon palette keys.
// Used by DeployedResourcesBar so pill colors match arch node colors.
export const RESOURCE_TYPE_TO_ICON: Record<string, DatabricksIconName> = {
  pipeline: "sdpPipeline",
  dashboard: "dashboard",
  genie_space: "genie",
  sql_warehouse: "sqlWarehouse",
  app: "databricksApps",
  knowledge_assistant: "knowledgeAssistant",
  knowledge_assistant_endpoint: "modelServing",
  multi_agent_supervisor: "multiAgentSupervisor",
  multi_agent_supervisor_endpoint: "modelServing",
  mlflow_experiment: "mlModel",
  catalog_explorer: "unityCatalog",
};

// Resolve a pill palette entry by resource_type. Returns the medallion bag
// for pipelines, a color, or a slate default for unknown types.
export type PillPalette =
  | { kind: "color"; color: ResourceColor }
  | { kind: "medallion" };

export function getPillPalette(resourceType: string): PillPalette {
  const icon = RESOURCE_TYPE_TO_ICON[resourceType];
  if (icon && MEDALLION_ICONS.has(icon)) return { kind: "medallion" };
  if (icon) {
    const c = ICON_PALETTE[icon];
    if (c) return { kind: "color", color: c };
  }
  return { kind: "color", color: SLATE_DEFAULT };
}
