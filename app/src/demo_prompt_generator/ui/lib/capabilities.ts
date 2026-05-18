/**
 * Capability metadata — slug → {group, display, icon, deployed_type}.
 *
 * Single source of truth for how each Databricks capability is presented in
 * the Summary tab's overview card. Slugs match
 * `.claude/skills/databricks-demo-generator/references/platform_architecture.md`
 * — update both files together when adding capabilities.
 *
 * `deployed_type` tells the renderer which `DeployedResourceLink.resource_type`
 * from `/api/projects/{id}/deployed-resources` corresponds to this capability,
 * so we can flip the pill state from pending → live when the build completes.
 * Capabilities with no `deployed_type` only ever show as pending pills
 * (governed talking-track items like Unity Catalog when it isn't surfaced as
 * a clickable resource on its own).
 */
import type { DatabricksIconName } from "@/components/databricks-icons";

export type CapabilityGroup =
  | "Data Ingestion"
  | "Data Processing"
  | "AI"
  | "Data Analysis"
  | "Analyst Layer"
  | "Foundation";

export interface CapabilityMeta {
  group: CapabilityGroup;
  display: string;
  icon: DatabricksIconName;
  /** Match key against DeployedResourceLink.resource_type (set by
   *  backend's _build_deployed_links). */
  deployed_type?: string;
}

export const CAPABILITY_META: Record<string, CapabilityMeta> = {
  // ── Data Ingestion ────────────────────────────────────────────────
  "synthetic-data-gen": { group: "Data Ingestion", display: "Synthetic Data", icon: "lakeflowConnect" },
  "lakeflow-connect":   { group: "Data Ingestion", display: "Lakeflow Connect", icon: "lakeflowConnect" },
  "sdp":                { group: "Data Ingestion", display: "Spark Declarative Pipelines", icon: "sdpPipeline", deployed_type: "pipeline" },
  "zerobus-ingest":     { group: "Data Ingestion", display: "Zerobus Ingest", icon: "streaming" },
  "delta-sharing":      { group: "Data Ingestion", display: "Delta Sharing", icon: "deltaSharing" },
  "marketplace":        { group: "Data Ingestion", display: "Marketplace", icon: "deltaSharing" },

  // ── Data Processing ───────────────────────────────────────────────
  "ai-functions":  { group: "Data Processing", display: "AI Functions", icon: "aiFunctions" },
  "metric-views":  { group: "Data Processing", display: "Metric Views", icon: "metricViews", deployed_type: "metric_view" },
  "lakeflow-jobs": { group: "Data Processing", display: "Lakeflow Jobs", icon: "sdpPipeline" },

  // ── AI ────────────────────────────────────────────────────────────
  "knowledge-assistant":    { group: "AI", display: "Knowledge Assistant", icon: "knowledgeAssistant", deployed_type: "knowledge_assistant" },
  "supervisor-agent":       { group: "AI", display: "Multi-Agent Supervisor", icon: "multiAgentSupervisor", deployed_type: "multi_agent_supervisor" },
  "ml-training-serving":    { group: "AI", display: "ML Training & Serving", icon: "mlModel", deployed_type: "mlflow_experiment" },
  "vector-search":          { group: "AI", display: "Vector Search", icon: "vectorSearch" },
  "information-extraction": { group: "AI", display: "Information Extraction", icon: "unstructuredData" },
  "ai-gateway":             { group: "AI", display: "AI Gateway", icon: "aiGateway" },

  // ── Data Analysis ─────────────────────────────────────────────────
  "aibi-dashboards": { group: "Data Analysis", display: "AI/BI Dashboard", icon: "dashboard", deployed_type: "dashboard" },
  "genie":           { group: "Data Analysis", display: "AI/BI Genie", icon: "genie", deployed_type: "genie_space" },
  "notebooks-eda":   { group: "Data Analysis", display: "Notebooks", icon: "notebooks" },
  "genie-code":      { group: "Data Analysis", display: "Genie Code", icon: "agents" },

  // ── Analyst Layer ─────────────────────────────────────────────────
  "databricks-apps": { group: "Analyst Layer", display: "Databricks App", icon: "databricksApps", deployed_type: "app" },
  "lakebase":        { group: "Analyst Layer", display: "Lakebase", icon: "lakebase", deployed_type: "lakebase_project" },
  "databricks-one":  { group: "Analyst Layer", display: "Databricks One", icon: "businessUser" },

  // ── Foundation ────────────────────────────────────────────────────
  "unity-catalog":       { group: "Foundation", display: "Unity Catalog", icon: "unityCatalog", deployed_type: "catalog_explorer" },
  "data-quality":        { group: "Foundation", display: "Data Quality", icon: "unityCatalog" },
  "abac":                { group: "Foundation", display: "ABAC", icon: "unityCatalog" },
  "data-classification": { group: "Foundation", display: "Data Classification", icon: "unityCatalog" },
};

/** Render order for the columns. Foundation is rendered separately as a
 *  footer row. */
export const GROUP_ORDER: CapabilityGroup[] = [
  "Data Ingestion",
  "Data Processing",
  "AI",
  "Data Analysis",
  "Analyst Layer",
];
