/**
 * Architecture Schema Types and Transformer
 *
 * Converts a declarative YAML/JSON schema into ReactFlow nodes and edges.
 * This allows AI to generate architecture diagrams without knowing ReactFlow internals.
 */

import { Node, Edge, MarkerType } from "@xyflow/react";
import type { DatabricksIconName } from "../components/databricks-icons";
import { getIconPalette, MEDALLION } from "./resource-palette";

// =============================================================================
// Schema Types (what the AI generates)
// =============================================================================

export type TierType =
  | "source"
  | "ingest"
  | "bronze"
  | "silver"
  | "gold"
  | "compute"
  | "analytics"
  | "ai"
  | "consumer"
  | "governance"
  | "sdp"
  | "orchestration"
  | "interface";

export interface SchemaNode {
  id: string;
  label: string;
  icon: DatabricksIconName;
  tier: TierType;
  desc?: string;
  row?: number; // Explicit row position override (default: auto-increment)
}

export interface SchemaBar {
  id: string;
  label: string;
  tier: TierType;
  vertical?: boolean;
}

export interface SchemaGroup {
  label: string;
  tier: TierType;
}

export interface SchemaColumn {
  nodes?: SchemaNode[];
  bars?: SchemaBar[];
  group?: SchemaGroup;
}

export interface SchemaEdge {
  from: string;
  to: string;
  label?: string;
  animated?: boolean;
}

export interface SchemaFoundationBar {
  label: string;
  tier: TierType;
  startColumn?: number; // 0-indexed column to start (default: 0)
  endColumn?: number;   // 0-indexed column to end (default: last column before interface/consumer)
}

export interface ArchitectureSchema {
  name: string;
  columns: SchemaColumn[];
  edges: SchemaEdge[];
  bars?: SchemaFoundationBar[];
}

// =============================================================================
// Tier Colors (same as architecture-diagram.tsx)
// =============================================================================

export const TIER_CONFIG: Record<TierType, {
  color: string;
  bg: string;
  border: string;
  accent: string;
  stripe: string;
}> = {
  source: {
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-500/[0.08]",
    border: "border-slate-500/25",
    accent: "bg-slate-500",
    stripe: "#64748b",
  },
  ingest: {
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/[0.08]",
    border: "border-blue-500/25",
    accent: "bg-blue-500",
    stripe: "#3b82f6",
  },
  bronze: {
    color: "text-orange-700 dark:text-orange-400",
    bg: "bg-orange-800/[0.08]",
    border: "border-orange-700/30",
    accent: "bg-orange-700",
    stripe: "#cd7f32",
  },
  silver: {
    color: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-400/[0.08]",
    border: "border-slate-400/30",
    accent: "bg-slate-400",
    stripe: "#a8a9ad",
  },
  gold: {
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-600/[0.08]",
    border: "border-amber-600/30",
    accent: "bg-amber-600",
    stripe: "#c9a227",
  },
  compute: {
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/[0.08]",
    border: "border-violet-500/25",
    accent: "bg-violet-500",
    stripe: "#8b5cf6",
  },
  analytics: {
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/[0.08]",
    border: "border-pink-500/25",
    accent: "bg-pink-500",
    stripe: "#ec4899",
  },
  ai: {
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/[0.08]",
    border: "border-indigo-500/25",
    accent: "bg-indigo-500",
    stripe: "#6366f1",
  },
  consumer: {
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/[0.08]",
    border: "border-emerald-500/25",
    accent: "bg-emerald-500",
    stripe: "#10b981",
  },
  governance: {
    color: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-600/[0.08]",
    border: "border-slate-600/25",
    accent: "bg-slate-600",
    stripe: "#475569",
  },
  sdp: {
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/[0.08]",
    border: "border-teal-500/25",
    accent: "bg-teal-500",
    stripe: "#14b8a6",
  },
  orchestration: {
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/[0.08]",
    border: "border-sky-500/25",
    accent: "bg-sky-500",
    stripe: "#0ea5e9",
  },
  interface: {
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/[0.08]",
    border: "border-rose-500/25",
    accent: "bg-rose-500",
    stripe: "#f43f5e",
  },
};

// =============================================================================
// Layout Constants
// =============================================================================

const LAYOUT = {
  columnWidth: 280,      // Horizontal spacing between columns
  rowHeight: 105,        // Vertical spacing between rows
  nodeWidth: 210,        // Default node width
  groupPadding: 28,      // Padding around group contents
  barHeight: 34,         // Height of horizontal bars
  verticalBarWidth: 30,  // Width of vertical bars
  verticalBarHeight: 240, // Height of vertical bars
};

// =============================================================================
// Transformer Function
// =============================================================================

export function schemaToReactFlow(schema: ArchitectureSchema): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Track node positions for edge color lookup
  const nodeIdToTier: Record<string, TierType> = {};
  const nodeIdToIcon: Record<string, DatabricksIconName | undefined> = {};

  // Calculate row Y position
  const rowY = (row: number) => row * LAYOUT.rowHeight;

  // Pre-compute column X positions — bar-only columns get reduced width
  const colPositions: number[] = [];
  let runningX = 0;
  schema.columns.forEach((column) => {
    colPositions.push(runningX);
    // Bar-only columns (e.g. "Databricks One" vertical bar) are narrow
    const isBarOnly = column.bars && column.bars.length > 0 && (!column.nodes || column.nodes.length === 0);
    runningX += isBarOnly ? LAYOUT.verticalBarWidth + 60 : LAYOUT.columnWidth;
  });

  // Process each column
  schema.columns.forEach((column, colIndex) => {
    const colX = colPositions[colIndex];

    // Track current row within column for auto-positioning
    let currentRow = 0;

    // If column has a group, create group node first
    if (column.group) {
      const nodeCount = column.nodes?.length || 0;
      // Find max row to calculate group height
      let maxRow = nodeCount - 1;
      column.nodes?.forEach(node => {
        if (node.row !== undefined && node.row > maxRow) {
          maxRow = node.row;
        }
      });

      const groupHeight = (maxRow + 1) * LAYOUT.rowHeight + LAYOUT.groupPadding * 2;

      nodes.push({
        id: `group-${colIndex}`,
        type: "group",
        position: { x: colX - LAYOUT.groupPadding, y: -LAYOUT.groupPadding },
        style: {
          width: LAYOUT.nodeWidth + LAYOUT.groupPadding * 2,
          height: groupHeight,
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
        },
        data: { label: column.group.label, tier: column.group.tier },
        zIndex: -1,
      });
    }

    // Process nodes in this column
    column.nodes?.forEach((node) => {
      const row = node.row !== undefined ? node.row : currentRow;
      currentRow = row + 1; // Next auto-row

      nodeIdToTier[node.id] = node.tier;
      nodeIdToIcon[node.id] = node.icon;

      nodes.push({
        id: node.id,
        type: "custom",
        position: { x: colX, y: rowY(row) },
        data: {
          label: node.label,
          icon: node.icon,
          tier: node.tier,
          description: node.desc,
        },
      });
    });

    // Process bars in this column (vertical bars like Databricks One)
    column.bars?.forEach((bar) => {
      nodeIdToTier[bar.id] = bar.tier;

      nodes.push({
        id: bar.id,
        type: "bar",
        position: { x: colX, y: rowY(0) - 10 },
        style: {
          width: LAYOUT.verticalBarWidth,
          height: LAYOUT.verticalBarHeight,
        },
        data: {
          label: bar.label,
          tier: bar.tier,
          vertical: bar.vertical,
        },
      });
    });
  });

  // Add foundation bars (horizontal bars at bottom)
  if (schema.bars && schema.bars.length > 0) {
    const totalColumns = schema.columns.length;

    // Find the maximum row used
    let maxRow = 0;
    schema.columns.forEach(col => {
      col.nodes?.forEach(node => {
        const row = node.row !== undefined ? node.row : 0;
        if (row > maxRow) maxRow = row;
      });
    });

    const barStartY = rowY(maxRow + 1) + LAYOUT.rowHeight * 0.3;

    schema.bars.forEach((bar, barIndex) => {
      // Use custom column span or default to full width minus interface/consumer
      const startCol = bar.startColumn ?? 1; // Default: skip sources (column 0)
      const endCol = bar.endColumn ?? Math.max(0, totalColumns - 3); // Default: stop before interface & consumer

      const barStartX = (colPositions[startCol] ?? startCol * LAYOUT.columnWidth) - 10;
      const barEndX = (colPositions[endCol] ?? endCol * LAYOUT.columnWidth) + LAYOUT.nodeWidth;
      const barWidth = barEndX - barStartX + 10;

      nodes.push({
        id: `foundation-bar-${barIndex}`,
        type: "bar",
        position: { x: barStartX, y: barStartY + barIndex * 35 },
        style: { width: barWidth, height: LAYOUT.barHeight },
        data: { label: bar.label, tier: bar.tier },
        zIndex: 0,
      });
    });
  }

  // Process edges
  schema.edges.forEach((edge, edgeIndex) => {
    const sourceTier = nodeIdToTier[edge.from] || "source";
    const sourceIcon = nodeIdToIcon[edge.from];

    // Edge color tracks the source node's color: icon override wins over
    // tier so an edge leaving a Genie node looks Genie-amber, not consumer-emerald.
    let edgeColor = TIER_CONFIG[sourceTier].stripe;
    if (sourceIcon) {
      const override = getIconPalette(sourceIcon);
      if (override?.kind === "medallion") edgeColor = MEDALLION.stripe;
      else if (override?.kind === "color") edgeColor = override.color.stripe;
    }

    // Determine handles based on typical flow (left-to-right, top-to-bottom)
    // This is a simplification - could be made smarter
    let sourceHandle = "right";
    let targetHandle = "left-target";

    // Check if it's a vertical connection (same column, different row)
    // by checking if source and target are in same column
    const sourceNode = nodes.find(n => n.id === edge.from);
    const targetNode = nodes.find(n => n.id === edge.to);

    if (sourceNode && targetNode) {
      const sameColumn = Math.abs(sourceNode.position.x - targetNode.position.x) < 50;
      if (sameColumn && targetNode.position.y > sourceNode.position.y) {
        sourceHandle = "bottom";
        targetHandle = "top-target";
      }
    }

    // "Lakeflow Connect" is a Databricks product, not a verb — when the
    // schema author puts it as an edge label, sibling ingestion arrows
    // overlap the text. Strip it so it stays a node-only concept; the AI
    // can model the product as its own node when it matters.
    const rawLabel = edge.label?.trim();
    const label = rawLabel && /lakeflow\s*connect/i.test(rawLabel) ? undefined : rawLabel;

    edges.push({
      id: `e${edgeIndex + 1}`,
      source: edge.from,
      target: edge.to,
      sourceHandle,
      targetHandle,
      type: "smoothstep",
      // Animate every arrow by default — keeps the diagram alive and reads
      // as data flowing. Schemas can still opt out with animated: false.
      animated: edge.animated ?? true,
      label,
      labelStyle: label ? { fontSize: 11, fontWeight: 600, fill: edgeColor } : undefined,
      labelBgStyle: label ? { fill: "var(--color-background, white)", fillOpacity: 0.9 } : undefined,
      labelBgPadding: label ? [6, 3] as [number, number] : undefined,
      style: { stroke: edgeColor, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
    });
  });

  return { nodes, edges };
}

// =============================================================================
// Example Schema (Meridian Bank)
// =============================================================================

export const MERIDIAN_BANK_SCHEMA: ArchitectureSchema = {
  name: "Demo architecture",

  columns: [
    // Column 0: Data Sources
    {
      nodes: [
        { id: "src-banking", label: "Core Banking", icon: "inputData", tier: "source", desc: "Transactions" },
        { id: "src-processor", label: "Card Processor", icon: "inputData", tier: "source", desc: "Auth Data" },
        { id: "src-salesforce", label: "Salesforce", icon: "inputData", tier: "source", desc: "Merchants" },
        { id: "src-docs", label: "Security Audits", icon: "unstructuredData", tier: "source", desc: "PDF Reports", row: 3.5 },
      ],
    },

    // Column 1: SDP Pipeline
    {
      group: { label: "SDP Pipeline", tier: "sdp" },
      nodes: [
        { id: "bronze", label: "Bronze Layer", icon: "deltaTable", tier: "bronze", desc: "Raw Data" },
        { id: "silver", label: "Silver Layer", icon: "deltaTable", tier: "silver", desc: "Cleaned" },
        { id: "gold", label: "Gold Layer", icon: "deltaTable", tier: "gold", desc: "Analytics Ready" },
        { id: "volume", label: "Document Volume", icon: "unstructuredData", tier: "bronze", desc: "Unstructured", row: 3.5 },
      ],
    },

    // Column 2: Analytics + AI Layer
    {
      nodes: [
        { id: "dashboard", label: "AI/BI Dashboard", icon: "dashboard", tier: "analytics" },
        { id: "genie", label: "AI/BI Genie", icon: "genie", tier: "ai", desc: "Natural Language" },
        { id: "ka", label: "Knowledge Assistant", icon: "knowledgeAssistant", tier: "ai", desc: "Doc Search", row: 2.5 },
      ],
    },

    // Column 3: Multi-Agent Supervisor
    {
      nodes: [
        { id: "mas", label: "Multi-Agent Supervisor", icon: "multiAgentSupervisor", tier: "ai", desc: "Routing", row: 1 },
      ],
    },

    // Column 4: Databricks One Interface
    {
      bars: [
        { id: "db-one", label: "Databricks One", tier: "interface", vertical: true },
      ],
    },

    // Column 5: Consumer
    {
      nodes: [
        { id: "user", label: "Users", icon: "businessUser", tier: "consumer", desc: "End Users", row: 0.5 },
      ],
    },
  ],

  edges: [
    // Sources → Bronze (via Lakeflow Connect)
    { from: "src-banking", to: "bronze", label: "Lakeflow Connect", animated: true },
    { from: "src-processor", to: "bronze", animated: true },
    { from: "src-salesforce", to: "bronze", animated: true },

    // Docs → Volume (Auto Loader)
    { from: "src-docs", to: "volume", label: "Auto Loader", animated: true },

    // Medallion flow (vertical)
    { from: "bronze", to: "silver", animated: true },
    { from: "silver", to: "gold", animated: true },

    // Gold → AI
    { from: "gold", to: "dashboard" },
    { from: "gold", to: "genie" },

    // Volume → KA
    { from: "volume", to: "ka" },

    // AI → MAS
    { from: "genie", to: "mas" },
    { from: "ka", to: "mas" },

    // Dashboard & MAS → Databricks One
    { from: "dashboard", to: "db-one" },
    { from: "mas", to: "db-one" },

    // Databricks One → User
    { from: "db-one", to: "user" },
  ],

  bars: [
    { label: "Databricks Workflows — Orchestration", tier: "orchestration", startColumn: 1, endColumn: 3 },
    { label: "Unity Catalog — Governance & Security", tier: "governance", startColumn: 0, endColumn: 5 },
  ],
};
