/**
 * HighLevelArchitecture — glanceable, embedded-in-README architecture view.
 *
 * Renders a `glance` fenced code block as a row of category columns, each
 * column being a small uppercase label followed by clickable product pills.
 * Each product pill links out to its Databricks docs page where one is known.
 *
 * Visual vocabulary reuses `TIER_CONFIG` colors and `DATABRICKS_ICONS` so the
 * block sits naturally next to the detailed ReactFlow view in the Architecture
 * tab — but the layout is plain flex, no ReactFlow, optimized for fast inline
 * Markdown rendering.
 */

import { memo, useMemo } from "react";
import {
  DATABRICKS_ICONS,
  type DatabricksIconName,
} from "../databricks-icons";
import { TIER_CONFIG, type TierType } from "../../lib/architecture-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlanceItem {
  label: string;
  icon?: DatabricksIconName;
}

export interface GlanceGroup {
  label: string;
  items: GlanceItem[];
}

export interface GlanceSpec {
  groups: GlanceGroup[];
  foundation?: GlanceGroup;
}

// ---------------------------------------------------------------------------
// Tier mapping by category label
// ---------------------------------------------------------------------------

const GROUP_TIER: Record<string, TierType> = {
  "data ingestion": "sdp",
  "ai": "ai",
  "data analysis": "analytics",
  "analyst layer": "consumer",
};

const FOUNDATION_TIER: TierType = "governance";

function tierForGroup(label: string): TierType {
  return GROUP_TIER[label.trim().toLowerCase()] ?? "compute";
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Product name → icon lookup (falls back to `data`)
// ---------------------------------------------------------------------------

const ICON_BY_NAME: Record<string, DatabricksIconName> = {
  // ingestion
  lakeflowconnect: "lakeflowConnect",
  sparkdeclarativepipelines: "sdpPipeline",
  sdppipeline: "sdpPipeline",
  sdp: "sdpPipeline",
  zerobusingest: "streaming",
  streaming: "streaming",
  autoloader: "lakeflowConnect",
  // ai
  knowledgeassistant: "knowledgeAssistant",
  multiagentsupervisor: "multiAgentSupervisor",
  supervisoragent: "multiAgentSupervisor",
  predictionmodel: "mlModel",
  mlmodel: "mlModel",
  mltrainingserving: "mlModel",
  mlflow: "mlModel",
  vectorsearch: "vectorSearch",
  informationextraction: "unstructuredData",
  aigateway: "aiGateway",
  agents: "agents",
  modelserving: "modelServing",
  // analysis
  genie: "genie",
  aibigenie: "genie",
  dashboard: "dashboard",
  aibidashboard: "dashboard",
  aibidashboards: "dashboard",
  dashboards: "dashboard",
  metricviews: "metricViews",
  notebooks: "notebooks",
  notebookseda: "notebooks",
  aifunctions: "aiFunctions",
  // analyst layer
  databricksapp: "databricksApps",
  databricksapps: "databricksApps",
  app: "databricksApps",
  lakebase: "lakebase",
  databricksone: "businessUser",
  geniecode: "agents",
  // foundation
  unitycatalog: "unityCatalog",
  governance: "unityCatalog",
  dataquality: "unityCatalog",
  abac: "unityCatalog",
  dataclassification: "unityCatalog",
  deltasharing: "deltaSharing",
  // generic
  users: "businessUser",
  user: "businessUser",
  endusers: "businessUser",
};

function iconForItem(name: string, explicit?: DatabricksIconName): DatabricksIconName {
  if (explicit && DATABRICKS_ICONS[explicit]) return explicit;
  return ICON_BY_NAME[normalize(name)] ?? "data";
}

// ---------------------------------------------------------------------------
// Product name → Databricks docs URL
// ---------------------------------------------------------------------------

const DOCS_URL_BY_NAME: Record<string, string> = {
  // ingestion
  lakeflowconnect: "https://docs.databricks.com/aws/en/ingestion/lakeflow-connect/",
  sparkdeclarativepipelines: "https://docs.databricks.com/aws/en/dlt/",
  sdppipeline: "https://docs.databricks.com/aws/en/dlt/",
  sdp: "https://docs.databricks.com/aws/en/dlt/",
  zerobusingest: "https://docs.databricks.com/aws/en/zerobus/",
  autoloader: "https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/auto-loader/",
  // ai
  knowledgeassistant:
    "https://docs.databricks.com/aws/en/generative-ai/agent-bricks/knowledge-assistant",
  multiagentsupervisor:
    "https://docs.databricks.com/aws/en/generative-ai/agent-bricks/multi-agent-supervisor",
  supervisoragent:
    "https://docs.databricks.com/aws/en/generative-ai/agent-bricks/multi-agent-supervisor",
  predictionmodel: "https://docs.databricks.com/aws/en/machine-learning/",
  mlmodel: "https://docs.databricks.com/aws/en/machine-learning/",
  mltrainingserving: "https://docs.databricks.com/aws/en/machine-learning/",
  mlflow: "https://docs.databricks.com/aws/en/mlflow/",
  vectorsearch: "https://docs.databricks.com/aws/en/generative-ai/vector-search",
  informationextraction:
    "https://docs.databricks.com/aws/en/generative-ai/agent-bricks/information-extraction",
  aigateway: "https://docs.databricks.com/aws/en/ai-gateway/",
  modelserving: "https://docs.databricks.com/aws/en/machine-learning/model-serving/",
  // analysis
  dashboard: "https://docs.databricks.com/aws/en/dashboards/",
  aibidashboard: "https://docs.databricks.com/aws/en/dashboards/",
  aibidashboards: "https://docs.databricks.com/aws/en/dashboards/",
  dashboards: "https://docs.databricks.com/aws/en/dashboards/",
  genie: "https://docs.databricks.com/aws/en/genie/",
  aibigenie: "https://docs.databricks.com/aws/en/genie/",
  metricviews: "https://docs.databricks.com/aws/en/metric-views/",
  notebooks: "https://docs.databricks.com/aws/en/notebooks/",
  notebookseda: "https://docs.databricks.com/aws/en/notebooks/",
  aifunctions: "https://docs.databricks.com/aws/en/large-language-models/ai-functions",
  // analyst layer
  databricksapp: "https://docs.databricks.com/aws/en/dev-tools/databricks-apps/",
  databricksapps: "https://docs.databricks.com/aws/en/dev-tools/databricks-apps/",
  app: "https://docs.databricks.com/aws/en/dev-tools/databricks-apps/",
  lakebase: "https://docs.databricks.com/aws/en/oltp/",
  databricksone: "https://docs.databricks.com/aws/en/databricks-one/",
  geniecode: "https://docs.databricks.com/aws/en/notebooks/databricks-assistant-faq",
  // foundation
  unitycatalog: "https://docs.databricks.com/aws/en/data-governance/unity-catalog/",
  dataquality: "https://docs.databricks.com/aws/en/lakehouse-monitoring/",
  abac: "https://docs.databricks.com/aws/en/data-governance/unity-catalog/abac",
  dataclassification:
    "https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-classification",
  deltasharing: "https://docs.databricks.com/aws/en/delta-sharing/",
};

function docsUrlForItem(name: string): string | undefined {
  return DOCS_URL_BY_NAME[normalize(name)];
}

// ---------------------------------------------------------------------------
// DSL parser — `Label: item1, item2, ...` per line; `Foundation:` line is the
// cross-cutting bar. JSON is also accepted as a fallback.
// ---------------------------------------------------------------------------

export function parseGlanceSpec(raw: string): GlanceSpec | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as GlanceSpec;
      if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
        return parsed;
      }
    } catch {
      // fall through to DSL
    }
  }

  const groups: GlanceGroup[] = [];
  let foundation: GlanceGroup | undefined;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;

    const label = line.slice(0, colonIdx).trim();
    const itemsRaw = line.slice(colonIdx + 1).trim();
    if (!label || !itemsRaw) continue;

    const items: GlanceItem[] = itemsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ label: name }));

    if (items.length === 0) continue;

    if (label.toLowerCase() === "foundation") {
      foundation = { label: items.map((i) => i.label).join(", "), items };
    } else {
      groups.push({ label, items });
    }
  }

  if (groups.length === 0) return null;
  return { groups, foundation };
}

// ---------------------------------------------------------------------------
// Item row — one product, optionally hyperlinked to its docs page
// ---------------------------------------------------------------------------

interface ItemRowProps {
  item: GlanceItem;
  tier: TierType;
}

const ItemRow = memo(function ItemRow({ item, tier }: ItemRowProps) {
  const cfg = TIER_CONFIG[tier];
  const Icon = DATABRICKS_ICONS[iconForItem(item.label, item.icon)];
  const href = docsUrlForItem(item.label);

  const inner = (
    <span className="group flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-md transition-colors hover:bg-muted/60">
      <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
      <span
        className={`text-[13px] font-medium leading-snug text-foreground/85 group-hover:text-foreground ${
          href ? "underline-offset-2 group-hover:underline decoration-foreground/40" : ""
        }`}
      >
        {item.label}
      </span>
    </span>
  );

  if (!href) return inner;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline block"
      title={`Open Databricks docs for ${item.label}`}
    >
      {inner}
    </a>
  );
});

// ---------------------------------------------------------------------------
// Group column — uppercase header with a colored accent line, then items
// ---------------------------------------------------------------------------

const GroupColumn = memo(function GroupColumn({ group }: { group: GlanceGroup }) {
  const tier = tierForGroup(group.label);
  const cfg = TIER_CONFIG[tier];

  return (
    <div className="flex flex-col">
      <div
        className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${cfg.color} pb-2.5 mb-2 border-b-2`}
        style={{ borderColor: cfg.stripe }}
      >
        {group.label}
      </div>
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <ItemRow key={item.label} item={item} tier={tier} />
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Foundation row — slim footer with cross-cutting concerns
// ---------------------------------------------------------------------------

const FoundationRow = memo(function FoundationRow({ group }: { group: GlanceGroup }) {
  const cfg = TIER_CONFIG[FOUNDATION_TIER];

  return (
    <div className="mt-6 pt-4 border-t border-dashed border-border/50 flex flex-wrap items-center gap-x-1 gap-y-1">
      <div className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${cfg.color} shrink-0 mr-3`}>
        Foundation
      </div>
      {group.items.map((item) => (
        <ItemRow key={item.label} item={item} tier={FOUNDATION_TIER} />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const COLUMN_WIDTH = 184; // px — uniform across all groups

interface HighLevelArchitectureProps {
  /** Raw text from the ` ```glance ` fenced block. */
  source: string;
}

export const HighLevelArchitecture = memo(function HighLevelArchitecture({ source }: HighLevelArchitectureProps) {
  const spec = useMemo(() => parseGlanceSpec(source), [source]);

  if (!spec) {
    return (
      <pre className="text-xs text-muted-foreground whitespace-pre-wrap p-3 my-4 rounded-lg border border-border/40 bg-muted/20">
        {source}
      </pre>
    );
  }

  return (
    <div className="my-6 not-prose flex justify-center overflow-x-auto">
      <div className="rounded-2xl border border-border/50 bg-card shadow-sm px-8 py-6">
        <div
          className="grid items-start gap-x-6"
          style={{ gridTemplateColumns: `repeat(${spec.groups.length}, ${COLUMN_WIDTH}px)` }}
        >
          {spec.groups.map((group) => (
            <GroupColumn key={group.label} group={group} />
          ))}
        </div>
        {spec.foundation && <FoundationRow group={spec.foundation} />}
      </div>
    </div>
  );
});

export default HighLevelArchitecture;
