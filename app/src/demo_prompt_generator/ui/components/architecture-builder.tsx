import { useState, useCallback, useRef, useMemo, useEffect, memo, forwardRef, useImperativeHandle } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type NodeProps,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  ConnectionMode,
  NodeResizer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Database,
  Workflow,
  Zap,
  AppWindow,
  Search,
  GripVertical,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  ClipboardPaste,
  Grid3X3,
  Sparkles,
  ChevronDown,
  ChevronRight,
  X,
  Link2,
  Plus,
  Braces,
  LayoutTemplate,
  Check,
  AlignHorizontalDistributeCenter,
  FileText,
  ArrowRight,
  Loader2,
  SquareDashed,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/components/apx/theme-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Skill Catalog — full bank of referenceable skills
// ---------------------------------------------------------------------------

export type NodeType = "Data Asset" | "Compute" | "Application" | "External" | "Custom";
export type MedallionTier = "raw" | "bronze" | "silver" | "gold";
export type DataFormat = "delta" | "csv" | "json" | "parquet" | "pdf" | "iceberg" | "avro";
export type ComputePattern = "batch" | "streaming" | "real-time" | "on-demand";

export interface SkillDef {
  id: string;
  label: string;
  description: string;
  nodeType: NodeType;
  /** @deprecated kept for backward compat during migration */
  category?: SkillCategory;
  defaultFormat?: DataFormat;
  defaultTier?: MedallionTier;
  defaultPattern?: ComputePattern;
  /** Hidden from the architecture builder catalog but still referenceable by the LLM */
  hiddenFromBuilder?: boolean;
}

// Legacy category type — still used internally but mapped from NodeType
type SkillCategory = NodeType;

const CATEGORY_CONFIG: Record<
  NodeType,
  { color: string; bg: string; border: string; icon: typeof Database; accent: string }
> = {
  "Data Asset": {
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/[0.08]",
    border: "border-blue-500/25",
    icon: Database,
    accent: "bg-blue-500",
  },
  Compute: {
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/[0.08]",
    border: "border-purple-500/25",
    icon: Workflow,
    accent: "bg-purple-500",
  },
  Application: {
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/[0.08]",
    border: "border-emerald-500/25",
    icon: AppWindow,
    accent: "bg-emerald-500",
  },
  External: {
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/[0.08]",
    border: "border-orange-500/25",
    icon: Zap,
    accent: "bg-orange-500",
  },
  Custom: {
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/[0.08]",
    border: "border-pink-500/25",
    icon: Sparkles,
    accent: "bg-pink-500",
  },
};

const TIER_COLORS: Record<MedallionTier, string> = {
  raw: "#6b7280",     // gray
  bronze: "#CD7F32",  // copper
  silver: "#C0C0C0",  // silver
  gold: "#FFD700",    // gold
};

const FORMAT_LABELS: Record<DataFormat, string> = {
  delta: "Δ",
  csv: "CSV",
  json: "JSON",
  parquet: "PQT",
  pdf: "PDF",
  iceberg: "ICE",
  avro: "AVRO",
};

const SKILL_CATALOG: SkillDef[] = [
  // ── Data Assets ──
  { id: "delta-table", label: "Delta Table", description: "Managed or external Delta Lake table", nodeType: "Data Asset", defaultFormat: "delta" },
  { id: "streaming-table", label: "Streaming Table", description: "Delta table with built-in streaming ingestion", nodeType: "Data Asset", defaultFormat: "delta" },
  { id: "materialized-view", label: "Materialized View", description: "Pre-computed view that auto-refreshes", nodeType: "Data Asset", defaultFormat: "delta" },
  { id: "uc-volume", label: "UC Volume", description: "Unity Catalog Volume for files and artifacts", nodeType: "Data Asset" },
  { id: "feature-table", label: "Feature Table", description: "Feature engineering table for ML models", nodeType: "Data Asset", defaultFormat: "delta" },
  { id: "vector-index", label: "Vector Index", description: "Vector Search index for similarity queries", nodeType: "Data Asset" },
  { id: "external-file", label: "External File", description: "CSV, JSON, Parquet, or PDF files", nodeType: "Data Asset", defaultFormat: "csv" },

  // ── Compute / Services ──
  { id: "declarative-pipeline", label: "Declarative Pipeline", description: "Lakeflow Declarative Pipeline (DLT/SDP)", nodeType: "Compute", defaultPattern: "batch" },
  { id: "auto-loader", label: "Auto Loader", description: "Incremental file ingestion from cloud storage", nodeType: "Compute", defaultPattern: "streaming" },
  { id: "structured-streaming", label: "Structured Streaming", description: "Spark Structured Streaming for production workloads", nodeType: "Compute", defaultPattern: "streaming" },
  { id: "databricks-job", label: "Job / Workflow", description: "Orchestrated multi-task job with scheduling", nodeType: "Compute", defaultPattern: "batch" },
  { id: "model-serving", label: "Model Serving", description: "Deploy and query Model Serving endpoints", nodeType: "Compute", defaultPattern: "real-time" },
  { id: "sql-warehouse", label: "SQL Warehouse", description: "Serverless SQL compute for analytics queries", nodeType: "Compute", defaultPattern: "on-demand" },
  { id: "vector-search-endpoint", label: "Vector Search Endpoint", description: "Serve similarity search queries", nodeType: "Compute", defaultPattern: "real-time" },
  { id: "ai-agent", label: "AI Agent", description: "Mosaic AI Agent (tool-use, RAG, multi-turn)", nodeType: "Compute", defaultPattern: "real-time" },
  { id: "ai-gateway", label: "AI Gateway", description: "LLM routing, rate limiting, and governance", nodeType: "Compute", defaultPattern: "real-time" },
  { id: "lakeflow-connect", label: "Lakeflow Connect", description: "Managed connectors for SaaS and database ingestion", nodeType: "Compute", defaultPattern: "batch" },
  { id: "zerobus-ingest", label: "Zerobus Ingest", description: "Real-time Delta table ingestion via gRPC", nodeType: "Compute", defaultPattern: "real-time" },
  { id: "lakebase-sync", label: "Lakebase Sync", description: "Real-time sync from Delta to Lakebase", nodeType: "Compute", defaultPattern: "real-time" },
  { id: "synthetic-data-gen", label: "Synthetic Data Gen", description: "Generate realistic synthetic data", nodeType: "Compute", defaultPattern: "batch" },
  { id: "mlflow-evaluation", label: "MLflow Evaluation", description: "Agent evaluation with scorers", nodeType: "Compute", hiddenFromBuilder: true },
  { id: "mlflow-tracking", label: "MLflow Tracking", description: "Experiment tracking and model registry", nodeType: "Compute", hiddenFromBuilder: true },

  // ── Applications ──
  { id: "aibi-dashboard", label: "AI/BI Dashboard", description: "Lakeview dashboard with visualizations", nodeType: "Application" },
  { id: "genie-space", label: "Genie Space", description: "Natural language SQL exploration", nodeType: "Application" },
  { id: "databricks-app", label: "Databricks App", description: "Full-stack app (FastAPI/React or Streamlit)", nodeType: "Application" },
  { id: "agent-app", label: "Agent on Databricks Apps", description: "LangGraph agent deployed as a Databricks App", nodeType: "Application" },
  { id: "custom-mcp-app", label: "Custom MCP Server on Databricks Apps", description: "Custom MCP server deployed as a Databricks App", nodeType: "Application" },
  { id: "notebook", label: "Notebook", description: "Interactive notebook for analysis or orchestration", nodeType: "Application" },
  { id: "alert", label: "SQL Alert", description: "Scheduled SQL alert with notifications", nodeType: "Application" },

  // ── External Systems ──
  { id: "lakebase-db", label: "Lakebase (Postgres)", description: "Managed PostgreSQL for OLTP", nodeType: "External" },
  { id: "delta-sharing", label: "Delta Sharing", description: "Cross-org data sharing endpoint", nodeType: "External" },
  { id: "external-mcp", label: "External MCP Server", description: "Third-party MCP server outside Databricks", nodeType: "External" },
];

// ---------------------------------------------------------------------------
// Architecture Templates
// ---------------------------------------------------------------------------

interface ArchitectureTemplate {
  id: string;
  name: string;
  description: string;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: SkillNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    data?: { description?: string };
  }>;
}

const ARCHITECTURE_TEMPLATES: ArchitectureTemplate[] = [
  {
    id: "lakehouse-etl",
    name: "Lakehouse ETL Pipeline",
    description: "Ingest → Transform → Serve pattern with Delta Lake",
    nodes: [
      { id: "synth-1", position: { x: 80, y: 60 }, data: { label: "Synthetic Data Gen", skillId: "synthetic-data-gen", category: "Compute", description: "Generate realistic demo data", pattern: "batch" } },
      { id: "bronze-1", position: { x: 400, y: 60 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Raw synthetic data landed as-is", tier: "bronze", format: "delta" } },
      { id: "transform-1", position: { x: 400, y: 220 }, data: { label: "Declarative Pipeline", skillId: "declarative-pipeline", category: "Compute", description: "Cleansing, dedup & validation", pattern: "batch" } },
      { id: "silver-1", position: { x: 720, y: 220 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Cleaned & enriched data", tier: "silver", format: "delta" } },
      { id: "agg-1", position: { x: 720, y: 380 }, data: { label: "Declarative Pipeline", skillId: "declarative-pipeline", category: "Compute", description: "Aggregation & business logic", pattern: "batch" } },
      { id: "gold-1", position: { x: 1040, y: 380 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Business-level aggregates", tier: "gold", format: "delta" } },
      { id: "serve-1", position: { x: 1340, y: 380 }, data: { label: "SQL Warehouse", skillId: "sql-warehouse", category: "Compute", description: "Powers dashboard queries", pattern: "on-demand" } },
      { id: "dash-1", position: { x: 1340, y: 220 }, data: { label: "AI/BI Dashboard", skillId: "aibi-dashboard", category: "Application", description: "Visualizations & insights" } },
    ],
    edges: [
      { id: "e1", source: "synth-1", target: "bronze-1", sourceHandle: "right", targetHandle: "left", label: "Generated", data: { description: "Synthetic data written to bronze tables" } },
      { id: "e2", source: "bronze-1", target: "transform-1", sourceHandle: "bottom", targetHandle: "top", label: "Raw data", data: { description: "Raw bronze data fed to cleansing pipeline" } },
      { id: "e3", source: "transform-1", target: "silver-1", sourceHandle: "right", targetHandle: "left", label: "Cleaned", data: { description: "Validated and deduplicated records" } },
      { id: "e4", source: "silver-1", target: "agg-1", sourceHandle: "bottom", targetHandle: "top", label: "Enriched", data: { description: "Silver data fed to aggregation pipeline" } },
      { id: "e5", source: "agg-1", target: "gold-1", sourceHandle: "right", targetHandle: "left", label: "Aggregated", data: { description: "Business-level aggregates and dimensions" } },
      { id: "e6", source: "gold-1", target: "serve-1", sourceHandle: "right", targetHandle: "left", label: "Serve", data: { description: "SQL access to gold tables" } },
      { id: "e7", source: "gold-1", target: "dash-1", sourceHandle: "right", targetHandle: "left", label: "Dataset", data: { description: "Dashboard queries gold tables" } },
      { id: "e8", source: "serve-1", target: "dash-1", sourceHandle: "top", targetHandle: "bottom", label: "SQL compute", data: { description: "SQL warehouse executes dashboard queries" } },
    ],
  },
  {
    id: "rag-knowledge-assistant",
    name: "RAG Knowledge Assistant",
    description: "PDF ingestion → Vector Search → LangGraph agent via Managed MCP",
    nodes: [
      // Row 1 — data pipeline (left to right)
      { id: "pdf-gen", position: { x: 80, y: 60 }, data: { label: "Synthetic Data Gen", skillId: "synthetic-data-gen", category: "Compute", description: "Generate realistic PDF documents", pattern: "batch" } },
      { id: "vol-1", position: { x: 380, y: 60 }, data: { label: "UC Volume", skillId: "uc-volume", category: "Data Asset", description: "Stores raw PDF documents" } },
      { id: "chunk-job", position: { x: 680, y: 60 }, data: { label: "Job / Workflow", skillId: "databricks-job", category: "Compute", description: "Notebook job: parse PDFs & chunk text", pattern: "batch" } },
      { id: "chunks-table", position: { x: 1000, y: 60 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Chunked text with embeddings", tier: "gold", format: "delta" } },
      // Row 2 — vector index + serving layer (left-flowing)
      { id: "vs-index", position: { x: 1000, y: 260 }, data: { label: "Vector Index", skillId: "vector-index", category: "Data Asset", description: "Delta Sync index on chunks table" } },
      { id: "agent-1", position: { x: 540, y: 260 }, data: { label: "Agent on Databricks Apps", skillId: "agent-app", category: "Application", description: "LangGraph agent deployed as a Databricks App" } },
      { id: "app-1", position: { x: 80, y: 260 }, data: { label: "Databricks App", skillId: "databricks-app", category: "Application", description: "Chat UI for end users" } },
    ],
    edges: [
      { id: "r1", source: "pdf-gen", target: "vol-1", sourceHandle: "right", targetHandle: "left", label: "PDFs", data: { description: "Generated PDF documents written to UC Volume" } },
      { id: "r2", source: "vol-1", target: "chunk-job", sourceHandle: "right", targetHandle: "left", label: "Read", data: { description: "Notebook reads PDFs from volume" } },
      { id: "r3", source: "chunk-job", target: "chunks-table", sourceHandle: "right", targetHandle: "left", label: "Chunks", data: { description: "Parsed text chunks with embeddings written to Delta" } },
      { id: "r4", source: "chunks-table", target: "vs-index", sourceHandle: "bottom", targetHandle: "top", label: "Delta Sync", data: { description: "Vector index syncs automatically from chunks table" } },
      { id: "r5", source: "vs-index", target: "agent-1", sourceHandle: "left", targetHandle: "right", label: "via Managed MCP", data: { description: "Agent retrieves from Vector Index via Databricks Managed MCP connection" } },
      { id: "r6", source: "agent-1", target: "app-1", sourceHandle: "left", targetHandle: "right", label: "HTTP", data: { description: "Chat UI calls agent app via HTTP" } },
    ],
  },
  {
    id: "multi-tool-agent",
    name: "Multi-Tool Agent with MCP",
    description: "Agent calling Vector Search, Genie & Custom MCP Server",
    nodes: [
      // Top row — document pipeline feeding Vector Search
      { id: "pdf-gen", position: { x: 60, y: 60 }, data: { label: "Synthetic Data Gen", skillId: "synthetic-data-gen", category: "Compute", description: "Generate realistic PDF documents", pattern: "batch" } },
      { id: "vol-1", position: { x: 300, y: 60 }, data: { label: "UC Volume", skillId: "uc-volume", category: "Data Asset", description: "Stores raw PDF documents" } },
      { id: "chunk-job", position: { x: 540, y: 60 }, data: { label: "Job / Workflow", skillId: "databricks-job", category: "Compute", description: "Notebook job: parse PDFs & chunk text", pattern: "batch" } },
      { id: "chunks-table", position: { x: 780, y: 60 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Chunked text with embeddings", tier: "gold", format: "delta" } },
      { id: "vs-index", position: { x: 1020, y: 60 }, data: { label: "Vector Index", skillId: "vector-index", category: "Data Asset", description: "Delta Sync index on chunks table" } },
      // Middle row — structured data pipeline feeding Genie Space
      { id: "struct-gen", position: { x: 60, y: 260 }, data: { label: "Synthetic Data Gen", skillId: "synthetic-data-gen", category: "Compute", description: "Generate structured business data", pattern: "batch" } },
      { id: "bronze-1", position: { x: 300, y: 260 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Raw ingested records", tier: "bronze", format: "delta" } },
      { id: "gold-1", position: { x: 540, y: 260 }, data: { label: "Delta Table", skillId: "delta-table", category: "Data Asset", description: "Curated analytics tables", tier: "gold", format: "delta" } },
      { id: "sql-wh", position: { x: 780, y: 260 }, data: { label: "SQL Warehouse", skillId: "sql-warehouse", category: "Compute", description: "Serverless compute for Genie queries", pattern: "on-demand" } },
      { id: "genie-1", position: { x: 1020, y: 260 }, data: { label: "Genie Space", skillId: "genie-space", category: "Application", description: "Natural language SQL over business data" } },
      // Bottom row — Custom MCP Server
      { id: "mcp-srv", position: { x: 1020, y: 460 }, data: { label: "Custom MCP Server on Databricks Apps", skillId: "custom-mcp-app", category: "Application", description: "Custom tools for external system access" } },
      // Agent + Chat UI (downstream of all tools)
      { id: "agent-1", position: { x: 1320, y: 260 }, data: { label: "Agent on Databricks Apps", skillId: "agent-app", category: "Application", description: "LangGraph agent with multiple MCP tool connections" } },
      { id: "chat-ui", position: { x: 1600, y: 260 }, data: { label: "Databricks App", skillId: "databricks-app", category: "Application", description: "Chat UI frontend for end users" } },
    ],
    edges: [
      // Document pipeline
      { id: "m1", source: "pdf-gen", target: "vol-1", sourceHandle: "right", targetHandle: "left", label: "PDFs", data: { description: "Generated PDF documents written to UC Volume" } },
      { id: "m2", source: "vol-1", target: "chunk-job", sourceHandle: "right", targetHandle: "left", label: "Read", data: { description: "Notebook reads PDFs from volume" } },
      { id: "m3", source: "chunk-job", target: "chunks-table", sourceHandle: "right", targetHandle: "left", label: "Chunks", data: { description: "Parsed text chunks with embeddings written to Delta" } },
      { id: "m4", source: "chunks-table", target: "vs-index", sourceHandle: "right", targetHandle: "left", label: "Delta Sync", data: { description: "Vector index syncs automatically from chunks table" } },
      // Structured data pipeline
      { id: "m5", source: "struct-gen", target: "bronze-1", sourceHandle: "right", targetHandle: "left", label: "Raw data", data: { description: "Synthetic business data landed as bronze" } },
      { id: "m6", source: "bronze-1", target: "gold-1", sourceHandle: "right", targetHandle: "left", label: "Curated", data: { description: "Cleansed and enriched into gold tables" } },
      { id: "m7", source: "gold-1", target: "sql-wh", sourceHandle: "right", targetHandle: "left", label: "Query", data: { description: "SQL warehouse queries gold tables" } },
      { id: "m8", source: "sql-wh", target: "genie-1", sourceHandle: "right", targetHandle: "left", label: "Serves", data: { description: "Genie Space uses SQL warehouse for query execution" } },
      // Tools → Agent (MCP connections)
      { id: "m9", source: "vs-index", target: "agent-1", sourceHandle: "right", targetHandle: "left", label: "Managed MCP", data: { description: "Agent queries Vector Index via Databricks Managed MCP" } },
      { id: "m10", source: "genie-1", target: "agent-1", sourceHandle: "right", targetHandle: "left", label: "Managed MCP", data: { description: "Agent queries Genie Space via Databricks Managed MCP" } },
      { id: "m11", source: "mcp-srv", target: "agent-1", sourceHandle: "right", targetHandle: "left", label: "UC HTTP Connection", data: { description: "Agent calls Custom MCP Server via Unity Catalog HTTP Connection" } },
      // Agent → Chat UI
      { id: "m12", source: "agent-1", target: "chat-ui", sourceHandle: "right", targetHandle: "left", label: "HTTP", data: { description: "Chat UI calls agent app via HTTP" } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Custom Node Component
// ---------------------------------------------------------------------------

interface SkillNodeData {
  label: string;
  skillId: string;
  category: NodeType;
  description: string;
  tier?: MedallionTier;
  format?: DataFormat;
  pattern?: ComputePattern;
  [key: string]: unknown;
}

function SkillNode({ data, selected }: NodeProps<Node<SkillNodeData>>) {
  const cfg = CATEGORY_CONFIG[data.category] || CATEGORY_CONFIG["Data Asset"];
  const Icon = cfg.icon;
  const tierColor = data.tier ? TIER_COLORS[data.tier] : null;
  const formatLabel = data.format ? FORMAT_LABELS[data.format] : null;
  // Look up canonical Databricks service name from catalog; fall back to data.label for custom nodes
  const catalogEntry = SKILL_CATALOG.find((s) => s.id === data.skillId);
  const serviceName = catalogEntry?.label || data.label;
  return (
    <div
      className={`relative rounded-xl border ${cfg.border} ${cfg.bg} min-w-[180px] max-w-[230px] transition-all duration-200 dark:backdrop-blur-sm ${
        selected
          ? "shadow-lg shadow-primary/10 ring-2 ring-primary/50 -translate-y-0.5"
          : "shadow-md hover:shadow-lg hover:-translate-y-0.5"
      }`}
    >
      {/* Tier stripe (left edge) for Data Assets */}
      {tierColor && (
        <div
          className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
          style={{ backgroundColor: tierColor }}
        />
      )}

      {/* Top accent bar */}
      <div className={`absolute top-0 left-3 right-3 h-0.5 rounded-full ${cfg.accent} opacity-60`} />

      <div className={tierColor ? "pl-4 pr-3 py-2.5" : "px-3 py-2.5"}>
        {/* Connection handles */}
        <Handle type="source" position={Position.Top} id="top" isConnectable
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-top-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Top} id="top" isConnectable
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-top-1.5" />
        <Handle type="source" position={Position.Bottom} id="bottom" isConnectable
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-bottom-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Bottom} id="bottom" isConnectable
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-bottom-1.5" />
        <Handle type="source" position={Position.Left} id="left" isConnectable
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-left-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Left} id="left" isConnectable
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-left-1.5" />
        <Handle type="source" position={Position.Right} id="right" isConnectable
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-right-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Right} id="right" isConnectable
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-right-1.5" />

        {/* Header: type + badges */}
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className={`h-3.5 w-3.5 ${cfg.color} shrink-0`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.color}`}>
            {data.category}
          </span>
          {data.tier && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded"
              style={{ color: tierColor!, backgroundColor: `${tierColor}20` }}
            >
              {data.tier}
            </span>
          )}
          {data.format === "delta" ? (
            <img src="https://cdn.prod.website-files.com/68c803b3497f18f5503b830d/68da505ee9382ac2316b3e67_66192bf45f99cf9cd103c8b3_delta.svg" alt="Delta Lake" className="h-3.5 w-3.5 shrink-0" />
          ) : formatLabel ? (
            <span className="text-[9px] font-mono font-medium text-muted-foreground bg-muted/50 px-1 py-px rounded">
              {formatLabel}
            </span>
          ) : null}
          {data.pattern && (
            <span className="text-[9px] text-muted-foreground/70 italic ml-auto">
              {data.pattern}
            </span>
          )}
        </div>

        {/* Service name */}
        <div className="text-sm font-medium text-foreground leading-tight">
          {serviceName}
        </div>

        {/* Description (free text) */}
        {data.description && (
          <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">
            {data.description}
          </div>
        )}
      </div>
    </div>
  );
}

const MemoizedSkillNode = memo(SkillNode);

// ---------------------------------------------------------------------------
// Group Node Component (resizable transparent rectangle)
// ---------------------------------------------------------------------------

interface GroupNodeData extends SkillNodeData {
  // Group nodes reuse SkillNodeData with skillId="" and category="Custom"
}

const GROUP_COLORS = [
  { border: "#8b5cf6", label: "#a78bfa" }, // violet
  { border: "#3b82f6", label: "#60a5fa" }, // blue
  { border: "#10b981", label: "#34d399" }, // emerald
  { border: "#f59e0b", label: "#fbbf24" }, // amber
  { border: "#ef4444", label: "#f87171" }, // red
  { border: "#ec4899", label: "#f472b6" }, // pink
];

function createGroupColorCycler() {
  let index = 0;
  return () => {
    const color = GROUP_COLORS[index % GROUP_COLORS.length];
    index++;
    return color;
  };
}

function GroupNode({ data, selected }: NodeProps<Node<GroupNodeData>>) {
  const color = (data.groupColor as { border: string; label: string } | undefined) || GROUP_COLORS[0];
  return (
    <div className="relative w-full h-full">
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        lineClassName="!border-transparent"
        lineStyle={{ borderColor: `${color.border}66` }}
        handleClassName="!w-2.5 !h-2.5 !border-2 !border-background !rounded-sm"
        handleStyle={{ backgroundColor: color.border }}
      />
      {/* Connection handles for group-level edges */}
      <Handle type="source" position={Position.Right} id="right" isConnectable
        className="!w-3 !h-3 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-right-2 !top-1/2 !transition-all !duration-150" />
      <Handle type="target" position={Position.Right} id="right" isConnectable
        className="!w-3 !h-3 !bg-transparent !border-0 !-right-2 !top-1/2" />
      <Handle type="source" position={Position.Left} id="left" isConnectable
        className="!w-3 !h-3 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-left-2 !top-1/2 !transition-all !duration-150" />
      <Handle type="target" position={Position.Left} id="left" isConnectable
        className="!w-3 !h-3 !bg-transparent !border-0 !-left-2 !top-1/2" />
      <Handle type="source" position={Position.Top} id="top" isConnectable
        className="!w-3 !h-3 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-top-2 !left-1/2 !transition-all !duration-150" />
      <Handle type="target" position={Position.Top} id="top" isConnectable
        className="!w-3 !h-3 !bg-transparent !border-0 !-top-2 !left-1/2" />
      <Handle type="source" position={Position.Bottom} id="bottom" isConnectable
        className="!w-3 !h-3 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-bottom-2 !left-1/2 !transition-all !duration-150" />
      <Handle type="target" position={Position.Bottom} id="bottom" isConnectable
        className="!w-3 !h-3 !bg-transparent !border-0 !-bottom-2 !left-1/2" />
      <div
        className="w-full h-full rounded-xl border-2 border-dashed transition-colors"
        style={{
          borderColor: selected ? `${color.border}90` : `${color.border}50`,
          background: "transparent",
        }}
      >
        <div className="absolute top-2 left-3 flex items-center gap-1.5 max-w-[calc(100%-1.5rem)]">
          <SquareDashed className="h-3 w-3 shrink-0" style={{ color: `${color.label}99` }} />
          <span className="text-[11px] font-semibold truncate" style={{ color: color.label }}>
            {data.label}
          </span>
        </div>
        {data.description && (
          <div className="absolute top-6 left-3 right-3">
            <span className="text-[10px] line-clamp-1" style={{ color: `${color.label}88` }}>
              {data.description}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const MemoizedGroupNode = memo(GroupNode);

const nodeTypes: NodeTypes = {
  skill: MemoizedSkillNode,
  group: MemoizedGroupNode,
};

// ---------------------------------------------------------------------------
// Connection description dialog
// ---------------------------------------------------------------------------

function ConnectionDialog({
  onSubmit,
  onCancel,
  position,
}: {
  onSubmit: (desc: string) => void;
  onCancel: () => void;
  position: { x: number; y: number };
}) {
  const [desc, setDesc] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className="fixed z-50 rounded-lg border bg-popover shadow-xl p-3 w-72"
      style={{ left: position.x, top: position.y }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Link2 className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Describe this connection</span>
      </div>
      <Textarea
        ref={inputRef}
        placeholder="e.g., 'Raw data flows into the pipeline for cleansing...'"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(desc.trim() || "Connected");
          }
          if (e.key === "Escape") onCancel();
        }}
        className="text-xs min-h-[60px] mb-2"
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-xs">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSubmit(desc.trim() || "Connected")}
          className="h-7 text-xs"
        >
          Add Connection
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Undo/Redo History
// ---------------------------------------------------------------------------

interface HistoryEntry {
  nodes: Node<SkillNodeData>[];
  edges: Edge[];
}

function useHistory(
  nodes: Node<SkillNodeData>[],
  edges: Edge[],
  setNodes: (nodes: Node<SkillNodeData>[]) => void,
  setEdges: (edges: Edge[]) => void,
) {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const lastSnapshot = useRef<string>("");

  const snapshot = useCallback(() => {
    const key = JSON.stringify({ nodes, edges });
    if (key !== lastSnapshot.current) {
      undoStack.current.push({
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      });
      redoStack.current = [];
      lastSnapshot.current = key;
      // Keep stack manageable
      if (undoStack.current.length > 50) undoStack.current.shift();
    }
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    setNodes(entry.nodes);
    setEdges(entry.edges);
    lastSnapshot.current = JSON.stringify(entry);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    setNodes(entry.nodes);
    setEdges(entry.edges);
    lastSnapshot.current = JSON.stringify(entry);
  }, [nodes, edges, setNodes, setEdges]);

  return {
    snapshot,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Main Architecture Builder (inner, needs ReactFlowProvider)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Parse SKILL.md ## Architecture section for auto-population
// ---------------------------------------------------------------------------

interface ParsedComponent {
  label: string;
  skillId: string;
  category: string;
  description: string;
  tier?: MedallionTier;
  format?: DataFormat;
  pattern?: ComputePattern;
  /** True if this is a medallion layer node (Bronze/Silver/Gold Layer) */
  isLayerGroup?: boolean;
  /** Table names listed inside a layer node */
  containedTables?: string[];
}

interface ParsedConnection {
  sourceLabel: string;
  targetLabel: string;
  description: string;
}

interface ParsedArch {
  components: ParsedComponent[];
  connections: ParsedConnection[];
}

function matchSkillIdToCategory(skillId: string): { category: NodeType; label: string; description: string; defaultTier?: MedallionTier; defaultFormat?: DataFormat; defaultPattern?: ComputePattern } | null {
  const entry = SKILL_CATALOG.find((s) => s.id === skillId);
  if (entry) return { category: entry.nodeType, label: entry.label, description: entry.description, defaultTier: entry.defaultTier, defaultFormat: entry.defaultFormat, defaultPattern: entry.defaultPattern };
  // Fallback NodeType guessing from ID
  const id = skillId.toLowerCase();
  if (id.includes("delta") || id.includes("table") || id.includes("volume") || id.includes("feature") || id.includes("index") || id.includes("file") || id.includes("view")) return { category: "Data Asset", label: skillId, description: "" };
  if (id.includes("pipeline") || id.includes("loader") || id.includes("streaming") || id.includes("job") || id.includes("model") || id.includes("agent") || id.includes("mlflow") || id.includes("warehouse") || id.includes("vector-search") || id.includes("gateway") || id.includes("ingest") || id.includes("sync") || id.includes("connect")) return { category: "Compute", label: skillId, description: "" };
  if (id.includes("dashboard") || id.includes("genie") || id.includes("app") || id.includes("notebook") || id.includes("alert")) return { category: "Application", label: skillId, description: "" };
  if (id.includes("kafka") || id.includes("cloud-storage") || id.includes("jdbc") || id.includes("external") || id.includes("lakebase") || id.includes("sharing") || id.includes("api")) return { category: "External", label: skillId, description: "" };
  return null;
}

function parseMermaidArchitecture(md: string): ParsedArch {
  const components: ParsedComponent[] = [];
  const connections: ParsedConnection[] = [];

  // Extract mermaid code block from the Architecture section (supports # or ## heading)
  const archMatch = md.match(/#{1,2} Architecture[\s\S]*?```mermaid\n([\s\S]*?)```/);
  if (!archMatch) return { components, connections };
  const mermaidBody = archMatch[1];

  // Detect medallion subgraphs and collapse them into layer nodes.
  // If the LLM used `subgraph "Bronze Layer"` with individual table nodes inside,
  // we collapse those into a single layer node with tables listed in the description.
  type SubgraphInfo = { name: string; tier: MedallionTier; nodeIds: string[]; tableNames: string[] };
  const medallionSubgraphs: SubgraphInfo[] = [];
  const subgraphNodeIds = new Set<string>();

  for (const sg of mermaidBody.matchAll(/subgraph\s+"(Bronze|Silver|Gold)(?:\s+Layer)?"\s*\n([\s\S]*?)end/gi)) {
    const tier = sg[1].toLowerCase() as MedallionTier;
    const body = sg[2];
    const nodeIds: string[] = [];
    const tableNames: string[] = [];
    for (const nodeMatch of body.matchAll(/(\w+)\["([^"]+)"\]/g)) {
      nodeIds.push(nodeMatch[1]);
      const parts = nodeMatch[2].split("|").map((s) => s.trim());
      // Use the description (after |) as table name, or the full label
      tableNames.push(parts[1] || parts[0]);
      subgraphNodeIds.add(nodeMatch[1]);
    }
    if (nodeIds.length > 0) {
      medallionSubgraphs.push({ name: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Layer`, tier, nodeIds, tableNames });
    }
  }

  // Parse node definitions: id["skill-id | Description"]:::class %% metadata
  const nodeIdToIdx: Record<string, number> = {};

  // First, add collapsed layer nodes for any detected medallion subgraphs
  for (const sg of medallionSubgraphs) {
    const layerId = `g_${sg.tier}`;
    const comp: ParsedComponent = {
      label: sg.name,
      skillId: "delta-table",
      category: "Data Asset",
      description: sg.tableNames.join(", "),
      tier: sg.tier,
      format: "delta" as DataFormat,
      isLayerGroup: true,
      containedTables: sg.tableNames,
    };
    // Map all original node IDs to this layer's index
    for (const nid of sg.nodeIds) {
      nodeIdToIdx[nid] = components.length;
    }
    nodeIdToIdx[layerId] = components.length;
    components.push(comp);
  }

  for (const m of mermaidBody.matchAll(
    /(\w+)\["([^"]+)"\]:::(\w+)(?:\s*%%\s*(.+))?/g,
  )) {
    // Skip nodes that were collapsed into a medallion layer
    if (subgraphNodeIds.has(m[1])) continue;
    const nodeId = m[1];
    const labelParts = m[2].split("|").map((s) => s.trim());
    const skillId = labelParts[0] || "";
    const description = labelParts[1] || labelParts[0] || "";
    const classStr = m[3] || "";
    const metaStr = m[4] || "";

    // Detect medallion layer nodes: "Bronze Layer | table1, table2"
    const layerMatch = skillId.match(/^(Bronze|Silver|Gold)\s+Layer$/i);
    const isLayerGroup = !!layerMatch;
    let containedTables: string[] | undefined;
    if (isLayerGroup && labelParts[1]) {
      containedTables = labelParts[1].split(",").map((t) => t.trim()).filter(Boolean);
    }

    // Map class to category
    const classToCategory: Record<string, string> = {
      data_asset: "Data Asset", compute: "Compute",
      application: "Application", external: "External",
    };
    const category = classToCategory[classStr] || "Data Asset";
    const catalogEntry = isLayerGroup ? null : SKILL_CATALOG.find((s) => s.id === skillId);
    const label = isLayerGroup ? skillId : (catalogEntry?.label || description);

    const comp: ParsedComponent = {
      label, skillId: isLayerGroup ? "delta-table" : skillId,
      category, description,
      ...(isLayerGroup && { isLayerGroup: true }),
      ...(containedTables && { containedTables }),
    };
    for (const kv of metaStr.split(",")) {
      const [k, v] = kv.split("=").map((s) => s.trim());
      if (k === "tier" && v) comp.tier = v as MedallionTier;
      if (k === "format" && v) comp.format = v as DataFormat;
      if (k === "pattern" && v) comp.pattern = v as ComputePattern;
    }
    nodeIdToIdx[nodeId] = components.length;
    components.push(comp);
  }

  // Parse edges: srcId -->|"label"| tgtId  OR  srcId -->|label| tgtId
  for (const m of mermaidBody.matchAll(
    /(\w+)\s*-->\|"?([^"|]*)"?\|\s*(\w+)/g,
  )) {
    const srcIdx = nodeIdToIdx[m[1]];
    const tgtIdx = nodeIdToIdx[m[3]];
    if (srcIdx !== undefined && tgtIdx !== undefined) {
      connections.push({
        sourceLabel: components[srcIdx].description,
        targetLabel: components[tgtIdx].description,
        description: m[2].trim(),
      });
    }
  }

  return { components, connections };
}

function parseArchitectureSection(md: string): ParsedArch {
  // Try Mermaid format first
  const mermaidResult = parseMermaidArchitecture(md);
  if (mermaidResult.components.length > 0) return mermaidResult;

  // Fall back to legacy numbered-list format
  const components: ParsedComponent[] = [];
  const connections: ParsedConnection[] = [];

  const parts = md.split(/^(?=## )/gm);
  let archBody = "";
  for (const part of parts) {
    const hdr = part.match(/^#{1,2} (.+)\n/);
    if (hdr && hdr[1].trim().toLowerCase() === "architecture") {
      archBody = part.slice(hdr[0].length);
      break;
    }
  }

  if (!archBody) return { components, connections };

  const subParts = archBody.split(/^(?=### )/gm);
  const numIdToIdx: Record<number, number> = {};

  for (const sub of subParts) {
    const subHdr = sub.match(/^### (.+)\n/);
    if (!subHdr) continue;
    const subTitle = subHdr[1].trim().toLowerCase();
    const subBody = sub.slice(subHdr[0].length);

    if (subTitle.includes("component")) {
      for (const m of subBody.matchAll(
        /^(\d+)\.\s*([a-z][a-z0-9-]*)\s*\|\s*([A-Za-z ]+?)\s*\|\s*(.+?)(?:\s*\|\s*(.+?))?$/gm,
      )) {
        const numId = parseInt(m[1], 10);
        const skillId = m[2].trim();
        const category = m[3].trim();
        const descriptionText = m[4].trim();
        const metaStr = m[5] || "";
        const catalogEntry = SKILL_CATALOG.find((s) => s.id === skillId);
        const label = catalogEntry?.label || descriptionText;
        const comp: ParsedComponent = { label, skillId, category, description: descriptionText };
        for (const kv of metaStr.split(",")) {
          const [k, v] = kv.split("=").map((s) => s.trim());
          if (k === "tier" && v) comp.tier = v as MedallionTier;
          if (k === "format" && v) comp.format = v as DataFormat;
          if (k === "pattern" && v) comp.pattern = v as ComputePattern;
        }
        numIdToIdx[numId] = components.length;
        components.push(comp);
      }

      if (components.length === 0) {
        for (const m of subBody.matchAll(
          /^- \*\*(.+?)\*\*\s*\(`?([^)]+?)`?\)\s*(?:—|--|-)\s*([A-Za-z /]+?)(?:\s*\[([^\]]+)\])?(?:\s*:\s*(.+))?$/gm,
        )) {
          const boldText = m[1].trim();
          const skillId = m[2].trim();
          const category = m[3].trim();
          const metaStr = m[4] || "";
          const trailingDesc = m[5]?.trim() || "";
          const catalogEntry = SKILL_CATALOG.find((s) => s.id === skillId);
          const label = catalogEntry?.label || boldText;
          const description = trailingDesc || boldText;
          const comp: ParsedComponent = { label, skillId, category, description };
          for (const kv of metaStr.split(",")) {
            const [k, v] = kv.split("=").map((s) => s.trim());
            if (k === "tier" && v) comp.tier = v as MedallionTier;
            if (k === "format" && v) comp.format = v as DataFormat;
            if (k === "pattern" && v) comp.pattern = v as ComputePattern;
          }
          components.push(comp);
        }
        if (components.length === 0) {
          for (const m of subBody.matchAll(
            /^- \*\*(.+?)\*\*\s*(?:\(([^)]*)\))?[:\s]*(.*)$/gm,
          )) {
            const label = m[1].trim();
            const skillId = (m[2] || label.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
            const description = (m[3] || "").replace(/^[—\-–]\s*/, "").trim();
            const match = matchSkillIdToCategory(skillId);
            components.push({
              label,
              skillId,
              category: match?.category || "Data Asset",
              description: description || match?.description || label,
            });
          }
        }
      }
    } else if (subTitle.includes("connection")) {
      for (const m of subBody.matchAll(
        /^(\d+)\s*->\s*(\d+):\s*(.+)$/gm,
      )) {
        const srcNum = parseInt(m[1], 10);
        const tgtNum = parseInt(m[2], 10);
        const srcIdx = numIdToIdx[srcNum];
        const tgtIdx = numIdToIdx[tgtNum];
        if (srcIdx !== undefined && tgtIdx !== undefined) {
          connections.push({
            sourceLabel: components[srcIdx].description,
            targetLabel: components[tgtIdx].description,
            description: m[3].trim(),
          });
        }
      }
      if (connections.length === 0) {
        for (const m of subBody.matchAll(
          /^- \*\*(.+?)\*\*\s*->\s*\*\*(.+?)\*\*:\s*(.+)$/gm,
        )) {
          connections.push({
            sourceLabel: m[1].trim(),
            targetLabel: m[2].trim(),
            description: m[3].trim(),
          });
        }
      }
    }
  }

  return { components, connections };
}

// Fallback: parse from Datasets/Transforms/Outputs/Build Steps sections
// Supports both legacy ### subsections AND proposal-style tables/bold bullets
function parseLegacySections(md: string): ParsedArch {
  const components: ParsedComponent[] = [];
  const connections: ParsedConnection[] = [];

  const parts = md.split(/^(?=## )/gm);
  const sources: string[] = [];
  const transforms: string[] = [];
  const outputs: string[] = [];
  const tools: string[] = [];

  for (const part of parts) {
    const hdr = part.match(/^## (.+)\n/);
    if (!hdr) continue;
    const title = hdr[1].trim().toLowerCase();
    const body = part.slice(hdr[0].length);

    if (title.includes("dataset") || title.includes("data source")) {
      // Try ### subsections first
      const subs = [...body.matchAll(/^### (.+)$/gm)];
      if (subs.length > 0) {
        for (const m of subs) sources.push(m[1].trim());
      } else {
        // Try markdown table rows: | name | description | ~rows |
        for (const m of body.matchAll(/^\|\s*([^|]+?)\s*\|/gm)) {
          const cell = m[1].trim();
          if (cell && cell !== "Table" && !cell.startsWith("---")) sources.push(cell);
        }
        // Try bold bullet list: - **Name** — description
        if (sources.length === 0) {
          for (const m of body.matchAll(/^-\s+\*\*(.+?)\*\*/gm)) sources.push(m[1].trim());
        }
      }
    } else if (title.includes("transform") || title.includes("pipeline")) {
      // Try ### subsections
      const subs = [...body.matchAll(/^### (.+)$/gm)];
      if (subs.length > 0) {
        for (const m of subs) transforms.push(m[1].trim());
      } else {
        // Try bold bullet list: - **Stage name** — description
        const bullets = [...body.matchAll(/^-\s+\*\*(.+?)\*\*/gm)];
        if (bullets.length > 0) {
          for (const m of bullets) transforms.push(m[1].trim());
        } else {
          transforms.push("Data Pipeline");
        }
      }
    } else if (title.includes("output") || title.includes("deliverable") || title.includes("what gets built")) {
      // Try ### subsections
      const subs = [...body.matchAll(/^### (.+)$/gm)];
      if (subs.length > 0) {
        for (const m of subs) outputs.push(m[1].trim());
      } else {
        // Try bold bullet list: - **Name** — description
        for (const m of body.matchAll(/^-\s+\*\*(.+?)\*\*/gm)) outputs.push(m[1].trim());
      }
    } else if (title.includes("build step")) {
      for (const m of body.matchAll(/`(databricks-[a-z-]+|instrumenting-[a-z-]+|spark-[a-z-]+|agent-[a-z-]+)`/g)) {
        if (!tools.includes(m[1])) tools.push(m[1]);
      }
    } else if (title.includes("proposed solution")) {
      // Extract Databricks capabilities mentioned in prose for tool hints
      for (const m of body.matchAll(/\b(Model Serving|AI\/BI|Genie Space|Structured Streaming|Declarative Pipeline|Vector Search|Unity Catalog)\b/gi)) {
        const name = m[1].trim();
        if (!tools.includes(name)) tools.push(name);
      }
    }
  }

  for (const src of sources) {
    components.push({ label: src, skillId: "delta-table", category: "Data Asset", description: "Delta table" });
  }
  for (const tr of transforms) {
    components.push({ label: tr, skillId: "declarative-pipeline", category: "Compute", description: tr });
  }
  for (const out of outputs) {
    const l = out.toLowerCase();
    let skillId = "databricks-app";
    let cat = "Application";
    if (l.includes("dashboard") || l.includes("chart")) skillId = "aibi-dashboard";
    else if (l.includes("genie")) skillId = "genie-space";
    else if (l.includes("model") || l.includes("agent")) { skillId = "model-serving"; cat = "Compute"; }
    components.push({ label: out, skillId, category: cat, description: out });
  }
  const placedSkillIds = new Set(components.map((c) => c.skillId));
  for (const toolId of tools) {
    if (placedSkillIds.has(toolId)) continue;
    const entry = SKILL_CATALOG.find((s) => s.id === toolId);
    if (entry) components.push({ label: entry.label, skillId: entry.id, category: entry.nodeType, description: entry.description });
  }

  // Auto-generate linear connections: sources → transforms → outputs
  for (const src of sources) {
    for (const tr of transforms) {
      connections.push({ sourceLabel: src, targetLabel: tr, description: "Raw data ingested" });
    }
  }
  for (const tr of transforms) {
    for (const out of outputs) {
      connections.push({ sourceLabel: tr, targetLabel: out, description: "Processed data served" });
    }
  }

  return { components, connections };
}


const VALID_CATEGORIES = Object.keys(CATEGORY_CONFIG) as NodeType[];

/** Normalize a category/type string to the closest NodeType */
function normalizeCategory(raw: string): NodeType {
  // Exact match first
  if (CATEGORY_CONFIG[raw as NodeType]) return raw as NodeType;
  // Case-insensitive match
  const lower = raw.toLowerCase();
  const found = VALID_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (found) return found;
  // Partial match
  const partial = VALID_CATEGORIES.find(
    (c) => lower.includes(c.toLowerCase()) || c.toLowerCase().includes(lower),
  );
  if (partial) return partial;
  // Legacy category mapping
  if (lower.includes("engineering") || lower.includes("warehousing") || lower.includes("governance")) return "Data Asset";
  if (lower.includes("ai") || lower.includes("ml") || lower.includes("infrastructure") || lower.includes("real-time")) return "Compute";
  if (lower.includes("apps") || lower.includes("bi")) return "Application";
  if (lower.includes("connector")) return "External";
  return "Data Asset";
}

function buildFromSkillMd(md: string): { nodes: Node<SkillNodeData>[]; edges: Edge[] } {
  if (!md) return { nodes: [], edges: [] };

  // Try new Architecture section first, fall back to legacy
  let parsed = parseArchitectureSection(md);
  if (parsed.components.length === 0) {
    parsed = parseLegacySections(md);
  }
  if (parsed.components.length === 0) return { nodes: [], edges: [] };

  // ── Build adjacency for topological layering ──
  // Index by both label (service name) and description so connections can match either
  const labelToIdx: Record<string, number> = {};
  parsed.components.forEach((c, i) => {
    labelToIdx[c.label.toLowerCase()] = i;
    if (c.description) labelToIdx[c.description.toLowerCase()] = i;
  });

  const n = parsed.components.length;
  const outEdges: number[][] = Array.from({ length: n }, () => []);
  const inDegree: number[] = new Array(n).fill(0);

  for (const conn of parsed.connections) {
    const si = labelToIdx[conn.sourceLabel.toLowerCase()];
    const ti = labelToIdx[conn.targetLabel.toLowerCase()];
    if (si !== undefined && ti !== undefined && si !== ti) {
      outEdges[si].push(ti);
      inDegree[ti]++;
    }
  }

  // ── Longest-path layering via BFS from sources ──
  const layerByLongest: number[] = new Array(n).fill(0);
  // For each node, layer = max(layer of all parents) + 1
  const queue: number[] = [];
  const remaining = [...inDegree];
  for (let i = 0; i < n; i++) {
    if (remaining[i] === 0) queue.push(i);
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const child of outEdges[curr]) {
      layerByLongest[child] = Math.max(layerByLongest[child], layerByLongest[curr] + 1);
      remaining[child]--;
      if (remaining[child] === 0) queue.push(child);
    }
  }

  // Handle cycles (orphans still with remaining > 0): assign max layer + 1
  const maxLayer = Math.max(0, ...layerByLongest);
  for (let i = 0; i < n; i++) {
    if (remaining[i] > 0) layerByLongest[i] = maxLayer + 1;
  }

  // ── Group nodes by layer, order within layer to minimize crossings ──
  const layerGroups: number[][] = [];
  for (let i = 0; i < n; i++) {
    const l = layerByLongest[i];
    if (!layerGroups[l]) layerGroups[l] = [];
    layerGroups[l].push(i);
  }

  // Barycenter heuristic: order nodes in each layer by average position of parents
  for (let l = 1; l < layerGroups.length; l++) {
    if (!layerGroups[l]) continue;
    const prevPositions: Record<number, number> = {};
    if (layerGroups[l - 1]) {
      layerGroups[l - 1].forEach((nodeIdx, pos) => {
        prevPositions[nodeIdx] = pos;
      });
    }

    layerGroups[l].sort((a, b) => {
      const parentsA: number[] = [];
      const parentsB: number[] = [];
      for (const conn of parsed.connections) {
        const si = labelToIdx[conn.sourceLabel.toLowerCase()];
        const ti = labelToIdx[conn.targetLabel.toLowerCase()];
        if (ti === a && si !== undefined && prevPositions[si] !== undefined) parentsA.push(prevPositions[si]);
        if (ti === b && si !== undefined && prevPositions[si] !== undefined) parentsB.push(prevPositions[si]);
      }
      const avgA = parentsA.length > 0 ? parentsA.reduce((s, v) => s + v, 0) / parentsA.length : 0;
      const avgB = parentsB.length > 0 ? parentsB.reduce((s, v) => s + v, 0) / parentsB.length : 0;
      return avgA - avgB;
    });
  }

  // ── Position nodes in a zigzag/snake pattern ──
  const COL_WIDTH = 320;
  const ROW_HEIGHT = 180;
  const PADDING_X = 80;
  const PADDING_Y = 60;

  const nodePositions: { x: number; y: number }[] = new Array(n);
  const labelToNodeId: Record<string, string> = {};
  const nodes: Node<SkillNodeData>[] = [];

  // For mostly-linear graphs, use a snake/staircase pattern:
  // Pair consecutive nodes on each row, stepping right-then-down
  const isMostlyLinear = layerGroups.filter(Boolean).every((g) => g.length <= 2);

  if (isMostlyLinear) {
    const seq: number[] = [];
    for (const grp of layerGroups) {
      if (grp) seq.push(...grp);
    }
    for (let i = 0; i < seq.length; i++) {
      const pairIdx = Math.floor(i / 2);
      const posInPair = i % 2;
      nodePositions[seq[i]] = {
        x: PADDING_X + (pairIdx + posInPair) * COL_WIDTH,
        y: PADDING_Y + pairIdx * ROW_HEIGHT,
      };
    }
  } else {
    // Non-linear: standard layered layout with vertical centering
    const maxInLayer = Math.max(...layerGroups.filter(Boolean).map((g) => g.length));
    for (let l = 0; l < layerGroups.length; l++) {
      const group = layerGroups[l];
      if (!group) continue;
      const yOffset = PADDING_Y + ((maxInLayer - group.length) * ROW_HEIGHT) / 2;
      for (let r = 0; r < group.length; r++) {
        nodePositions[group[r]] = {
          x: PADDING_X + l * COL_WIDTH,
          y: yOffset + r * ROW_HEIGHT,
        };
      }
    }
  }

  const GROUP_W = 260;
  const TABLE_NODE_H = 90;
  const GROUP_PAD_TOP = 45;
  const GROUP_PAD_BOTTOM = 15;
  const TABLE_PAD_LEFT = 15;

  for (let l = 0; l < layerGroups.length; l++) {
    const group = layerGroups[l];
    if (!group) continue;
    for (let r = 0; r < group.length; r++) {
      const idx = group[r];
      const comp = parsed.components[idx];
      const { x, y } = nodePositions[idx];

      if (comp.isLayerGroup && comp.containedTables) {
        // Create a visual group + child table nodes for medallion layers
        const tierLabel = comp.tier
          ? comp.tier.charAt(0).toUpperCase() + comp.tier.slice(1)
          : "Layer";
        const groupId = `auto-group-${comp.tier || idx}`;
        const tableCount = Math.max(comp.containedTables.length, 1);
        const groupH = GROUP_PAD_TOP + tableCount * TABLE_NODE_H + GROUP_PAD_BOTTOM;
        const colorMap: Record<string, number> = { bronze: 4, silver: 1, gold: 3 };
        const colorIdx = colorMap[comp.tier || ""] ?? 0;

        nodes.push({
          id: groupId, type: "group",
          position: { x, y },
          style: { width: GROUP_W, height: groupH },
          zIndex: -1,
          data: {
            label: tierLabel, skillId: "", category: "Custom" as NodeType,
            description: `${tableCount} tables`,
            groupColor: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
          },
        });

        comp.containedTables.forEach((tbl, i) => {
          nodes.push({
            id: `auto-table-${comp.tier}-${i}`,
            type: "skill",
            position: { x: x + TABLE_PAD_LEFT, y: y + GROUP_PAD_TOP + i * TABLE_NODE_H },
            data: {
              label: "Delta Table", skillId: "delta-table",
              category: "Data Asset" as NodeType, description: tbl,
              tier: comp.tier, format: "delta" as DataFormat,
            },
          });
        });

        labelToNodeId[comp.label.toLowerCase()] = groupId;
        if (comp.description) labelToNodeId[comp.description.toLowerCase()] = groupId;
      } else {
        // Regular skill node
        const nodeId = `auto-${comp.skillId}-${idx}`;
        const catalogEntry = SKILL_CATALOG.find((s) => s.id === comp.skillId);
        const match = matchSkillIdToCategory(comp.skillId);
        const resolvedCategory = normalizeCategory(comp.category || catalogEntry?.nodeType || match?.category || "Data Asset");

        nodes.push({
          id: nodeId, type: "skill",
          position: { x, y },
          data: {
            label: comp.label, skillId: comp.skillId,
            category: resolvedCategory,
            description: comp.description || catalogEntry?.description || comp.label,
            ...(comp.tier && { tier: comp.tier }),
            ...(comp.format && { format: comp.format }),
            ...(comp.pattern && { pattern: comp.pattern }),
            ...(!comp.tier && catalogEntry?.defaultTier && { tier: catalogEntry.defaultTier }),
            ...(!comp.format && catalogEntry?.defaultFormat && { format: catalogEntry.defaultFormat }),
            ...(!comp.pattern && catalogEntry?.defaultPattern && { pattern: catalogEntry.defaultPattern }),
          },
        });
        labelToNodeId[comp.label.toLowerCase()] = nodeId;
        if (comp.description) labelToNodeId[comp.description.toLowerCase()] = nodeId;
      }
    }
  }

  // ── Build edges with smart handle selection ──
  const edges: Edge[] = [];
  for (const conn of parsed.connections) {
    const sourceId = labelToNodeId[conn.sourceLabel.toLowerCase()];
    const targetId = labelToNodeId[conn.targetLabel.toLowerCase()];
    const si = labelToIdx[conn.sourceLabel.toLowerCase()];
    const ti = labelToIdx[conn.targetLabel.toLowerCase()];
    if (sourceId && targetId && si !== undefined && ti !== undefined) {
      const sp = nodePositions[si];
      const tp = nodePositions[ti];

      // Choose handles based on relative positions
      let sourceHandle = "right";
      let targetHandle = "left";
      const dx = tp.x - sp.x;
      const dy = tp.y - sp.y;

      if (Math.abs(dx) < COL_WIDTH * 0.3) {
        // Nodes in same or very close column — use top/bottom
        if (dy > 0) {
          sourceHandle = "bottom";
          targetHandle = "top";
        } else {
          sourceHandle = "top";
          targetHandle = "bottom";
        }
      } else if (dx < 0) {
        // Target is to the left of source (backward edge)
        sourceHandle = "left";
        targetHandle = "right";
      }
      // else: target is to the right → use default right/left

      // Truncate for canvas display, store full text in data
      const canvasLabel = conn.description.length > 40
        ? conn.description.slice(0, 37) + "..."
        : conn.description;

      edges.push({
        id: `auto-edge-${edges.length}`,
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: "smoothstep",
        animated: true,
        label: conn.description,
        data: { description: conn.description, canvasLabel },
        labelStyle: { fontSize: 10, fontWeight: 500, fill: "hsl(var(--foreground))" },
        labelBgStyle: {
          fill: "hsl(var(--background))",
          stroke: "hsl(var(--border))",
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        },
        labelBgPadding: [6, 3] as [number, number],
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "hsl(var(--foreground))" },
        style: { strokeWidth: 2, stroke: "hsl(var(--foreground))" },
      });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Auto-Layout (topological sort)
// ---------------------------------------------------------------------------

async function elkAutoLayout(
  nodes: Node<SkillNodeData>[],
  edges: Edge[],
): Promise<{ nodes: Node<SkillNodeData>[]; edges: Edge[] }> {
  const LAY_COL = 320;
  const LAY_ROW = 180;
  const PAD_X = 80;
  const PAD_Y = 60;

  // Identify which skill nodes are inside group nodes (by containment)
  const groupNodes = nodes.filter((n) => n.type === "group");
  const childOfGroup = new Set<string>();
  for (const g of groupNodes) {
    const gx = g.position.x;
    const gy = g.position.y;
    const gw = (g.measured?.width ?? (g.style?.width as number)) || 0;
    const gh = (g.measured?.height ?? (g.style?.height as number)) || 0;
    for (const s of nodes) {
      if (s.type === "group" || s.id === g.id) continue;
      const sw = s.measured?.width || 180;
      const sh = s.measured?.height || 60;
      const cx = s.position.x + sw / 2;
      const cy = s.position.y + sh / 2;
      if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
        childOfGroup.add(s.id);
      }
    }
  }

  // Only layout top-level nodes (groups + ungrouped skill nodes)
  // Children stay at their relative positions inside their parent group
  const layoutNodes = nodes.filter((n) => !childOfGroup.has(n.id));

  // Build adjacency on layout nodes only
  const nodeIdx = new Map<string, number>();
  layoutNodes.forEach((n, i) => nodeIdx.set(n.id, i));
  const nCount = layoutNodes.length;
  const outEdgesArr: number[][] = Array.from({ length: nCount }, () => []);
  const inDeg: number[] = new Array(nCount).fill(0);

  for (const e of edges) {
    const si = nodeIdx.get(e.source);
    const ti = nodeIdx.get(e.target);
    if (si !== undefined && ti !== undefined && si !== ti) {
      outEdgesArr[si].push(ti);
      inDeg[ti]++;
    }
  }

  // Longest-path layering
  const layer: number[] = new Array(nCount).fill(0);
  const q: number[] = [];
  const rem = [...inDeg];
  for (let i = 0; i < nCount; i++) {
    if (rem[i] === 0) q.push(i);
  }
  while (q.length > 0) {
    const c = q.shift()!;
    for (const ch of outEdgesArr[c]) {
      layer[ch] = Math.max(layer[ch], layer[c] + 1);
      rem[ch]--;
      if (rem[ch] === 0) q.push(ch);
    }
  }
  // Handle cycles
  const mxL = Math.max(0, ...layer);
  for (let i = 0; i < nCount; i++) {
    if (rem[i] > 0) layer[i] = mxL + 1;
  }

  // Group by layer
  const groups: number[][] = [];
  for (let i = 0; i < nCount; i++) {
    if (!groups[layer[i]]) groups[layer[i]] = [];
    groups[layer[i]].push(i);
  }

  // Barycenter ordering within layers
  for (let l = 1; l < groups.length; l++) {
    if (!groups[l]) continue;
    const prevPos: Record<number, number> = {};
    if (groups[l - 1]) groups[l - 1].forEach((ni, pos) => { prevPos[ni] = pos; });
    groups[l].sort((a, b) => {
      let sumA = 0, cntA = 0, sumB = 0, cntB = 0;
      for (const e of edges) {
        const si = nodeIdx.get(e.source);
        const ti = nodeIdx.get(e.target);
        if (ti === a && si !== undefined && prevPos[si] !== undefined) { sumA += prevPos[si]; cntA++; }
        if (ti === b && si !== undefined && prevPos[si] !== undefined) { sumB += prevPos[si]; cntB++; }
      }
      return (cntA > 0 ? sumA / cntA : 0) - (cntB > 0 ? sumB / cntB : 0);
    });
  }

  // Position with snake/staircase for mostly-linear graphs
  const posMap = new Map<string, { x: number; y: number }>();
  const isMostlyLinear = groups.filter(Boolean).every((g) => g.length <= 2);

  if (isMostlyLinear) {
    const seq: number[] = [];
    for (const grp of groups) {
      if (grp) seq.push(...grp);
    }
    for (let i = 0; i < seq.length; i++) {
      const pairIdx = Math.floor(i / 2);
      const posInPair = i % 2;
      posMap.set(layoutNodes[seq[i]].id, {
        x: PAD_X + (pairIdx + posInPair) * LAY_COL,
        y: PAD_Y + pairIdx * LAY_ROW,
      });
    }
  } else {
    const maxInGroup = Math.max(...groups.filter(Boolean).map((g) => g.length));
    for (let l = 0; l < groups.length; l++) {
      const grp = groups[l];
      if (!grp) continue;
      const yOff = PAD_Y + ((maxInGroup - grp.length) * LAY_ROW) / 2;
      for (let r = 0; r < grp.length; r++) {
        posMap.set(layoutNodes[grp[r]].id, {
          x: PAD_X + l * LAY_COL,
          y: yOff + r * LAY_ROW,
        });
      }
    }
  }

  // Build a map of old group positions to compute deltas for children
  const oldGroupPos = new Map<string, { x: number; y: number }>();
  for (const g of groupNodes) oldGroupPos.set(g.id, { ...g.position });

  const newNodes = nodes.map((n) => {
    if (childOfGroup.has(n.id)) {
      // Find which group this child belongs to and move it by the same delta
      for (const g of groupNodes) {
        const gx = g.position.x;
        const gy = g.position.y;
        const gw = (g.measured?.width ?? (g.style?.width as number)) || 0;
        const gh = (g.measured?.height ?? (g.style?.height as number)) || 0;
        const sw = n.measured?.width || 180;
        const sh = n.measured?.height || 60;
        const cx = n.position.x + sw / 2;
        const cy = n.position.y + sh / 2;
        if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
          const newGroupPos = posMap.get(g.id);
          const oldGP = oldGroupPos.get(g.id);
          if (newGroupPos && oldGP) {
            const dx = newGroupPos.x - oldGP.x;
            const dy = newGroupPos.y - oldGP.y;
            return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
          }
        }
      }
      return n;
    }
    return { ...n, position: posMap.get(n.id) || n.position };
  });

  const newEdges = edges.map((e) => {
    const src = newNodes.find((n) => n.id === e.source);
    const tgt = newNodes.find((n) => n.id === e.target);
    if (!src || !tgt) return e;
    const handles = pickEdgeHandles(src.position, tgt.position);
    return { ...e, ...handles, type: "smoothstep" };
  });

  return { nodes: newNodes, edges: newEdges };
}

/** Pick source/target handles based on relative node positions. */
function pickEdgeHandles(
  src: { x: number; y: number },
  tgt: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" };
  }
  return dy > 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" };
}

// ---------------------------------------------------------------------------
// Main Architecture Builder (inner, needs ReactFlowProvider)
// ---------------------------------------------------------------------------

function ArchitectureBuilderInner({
  innerRef,
  onApplyArchitecture,
  onArchitectureChange,
  busy,
  architectureMd,
  proposalBuildSteps,
  hideCatalog,
  isVisible,
  stage,
}: {
  innerRef?: React.MutableRefObject<{ serialize: () => string } | null>;
  onApplyArchitecture?: (architectureDescription: string) => void;
  onArchitectureChange?: (mermaid: string) => void;
  busy?: boolean;
  /** architecture.md content (buildout/package stage) */
  architectureMd?: string;
  /** Full proposal markdown — only Build Steps are extracted (proposal stage) */
  proposalBuildSteps?: string;
  hideCatalog?: boolean;
  /** Whether the Architecture tab is currently visible */
  isVisible?: boolean;
  /** Current stage: "proposal" | "buildout" | "package" */
  stage?: string;
}) {
  const { theme } = useTheme();
  const resolvedDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const edgeColor = resolvedDark ? "#ffffff" : "#374151"; // gray-700 for light mode

  const nextGroupColor = useRef(createGroupColorCycler()).current;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<SkillNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [catalogOpen, setCatalogOpen] = useState(!hideCatalog);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [pendingConnection, setPendingConnection] = useState<{
    connection: Connection;
    position: { x: number; y: number };
  } | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [descPanelOpen, setDescPanelOpen] = useState(false);
  const [architectureNotes, setArchitectureNotes] = useState("");
  const [isLayouting, setIsLayouting] = useState(false);
  const hasAutoPopulated = useRef(false);
  const userEditedCanvas = useRef(false);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // ── Group drawing state ──
  const [drawingGroupMode, setDrawingGroupMode] = useState(false);
  // Screen-relative coordinates for the preview rectangle
  const [drawStartScreen, setDrawStartScreen] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrentScreen, setDrawCurrentScreen] = useState<{ x: number; y: number } | null>(null);

  const handleDrawMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingGroupMode) return;
      const rect = reactFlowWrapper.current?.getBoundingClientRect();
      if (!rect) return;
      setDrawStartScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDrawCurrentScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [drawingGroupMode],
  );

  const handleDrawMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawStartScreen) return;
      const rect = reactFlowWrapper.current?.getBoundingClientRect();
      if (!rect) return;
      setDrawCurrentScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [drawStartScreen],
  );

  // handleDrawMouseUp defined after useHistory (needs snapshot)

  // ── Group editing state ──
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupLabel, setEditGroupLabel] = useState("");
  const [editGroupDesc, setEditGroupDesc] = useState("");

  const saveGroupEdit = useCallback(() => {
    if (editingGroup) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === editingGroup
            ? { ...n, data: { ...n.data, label: editGroupLabel || "Group", description: editGroupDesc } }
            : n,
        ),
      );
      setEditingGroup(null);
    }
  }, [editingGroup, editGroupLabel, editGroupDesc, setNodes]);

  // Auto-populate from architecture.md (buildout/package) or Build Steps (proposal).
  // Re-populate if content changes (e.g. after refine), but not if the user
  // manually loaded a template or edited the canvas.
  const lastParsedArchRef = useRef<string>("");
  const mdSource = architectureMd || "";

  // Buildout/package: populate from architecture.md Mermaid content
  useEffect(() => {
    if (!mdSource) return;
    const hasArchSection = /^#{1,2} Architecture\b/m.test(mdSource);
    if (!hasArchSection) return;

    const archMatch = mdSource.match(/#{1,2} Architecture[\s\S]*?(?=\n#{1,2} [^#]|$)/);
    const archContent = archMatch ? archMatch[0] : mdSource;

    if (userEditedCanvas.current) return;
    if (archContent === lastParsedArchRef.current) return;

    const { nodes: autoNodes, edges: autoEdges } = buildFromSkillMd(mdSource);
    if (autoNodes.length > 0) {
      setNodes(autoNodes);
      setEdges(autoEdges);
      lastParsedArchRef.current = archContent;
      hasAutoPopulated.current = true;
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 150);
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 500);
    }
  }, [mdSource, setNodes, setEdges, fitView]);

  // Proposal stage: populate from ## Architecture Mermaid in the proposal
  const lastParsedProposalRef = useRef<string>("");
  useEffect(() => {
    if (!proposalBuildSteps || mdSource) return; // skip if architecture.md is present

    // Only parse if the proposal contains a ## Architecture section with Mermaid
    const archMatch = proposalBuildSteps.match(/## Architecture[\s\S]*?(?=\n## [^#]|$)/);
    if (!archMatch) return;
    const archContent = archMatch[0];
    if (archContent === lastParsedProposalRef.current) return;

    // If user manually edited the canvas, only allow LLM refinements to override
    if (userEditedCanvas.current) {
      userEditedCanvas.current = false; // reset so next LLM change can update
    }

    const parsed = buildFromSkillMd(proposalBuildSteps);
    if (parsed.nodes.length > 0) {
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      lastParsedProposalRef.current = archContent;
      hasAutoPopulated.current = true;
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 150);
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 500);
    }
  }, [proposalBuildSteps, mdSource, setNodes, setEdges, fitView]);

  // Center the diagram when the tab becomes visible (forceMount means fitView
  // can't work while display:none — so we re-fit when isVisible flips to true)
  const prevVisible = useRef(false);
  useEffect(() => {
    if (isVisible && !prevVisible.current && nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 50);
    }
    prevVisible.current = !!isVisible;
  }, [isVisible, nodes.length, fitView]);

  const { snapshot, undo, redo, canUndo, canRedo } = useHistory(
    nodes,
    edges,
    setNodes,
    setEdges,
  );

  // ── Dynamic tier assignment: update a node's tier based on which medallion group it's inside ──
  const MEDALLION_TIERS: Record<string, MedallionTier> = { bronze: "bronze", silver: "silver", gold: "gold" };

  /** For a given skill node, find which medallion group (if any) contains it */
  const getTierForNode = useCallback(
    (node: Node<SkillNodeData>, allNodes: Node<SkillNodeData>[]) => {
      const groupNodes = allNodes.filter((n) => n.type === "group");
      const sw = node.measured?.width || 180;
      const sh = node.measured?.height || 60;
      const cx = node.position.x + sw / 2;
      const cy = node.position.y + sh / 2;
      for (const g of groupNodes) {
        const gx = g.position.x;
        const gy = g.position.y;
        const gw = (g.measured?.width ?? (g.style?.width as number)) || 0;
        const gh = (g.measured?.height ?? (g.style?.height as number)) || 0;
        if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
          return MEDALLION_TIERS[(g.data.label || "").toLowerCase()];
        }
      }
      return undefined;
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node<SkillNodeData>) => {
      if (draggedNode.type === "group") {
        // Group was moved — re-evaluate all skill nodes' tiers
        setNodes((nds) => {
          const updated = nds.map((n) => {
            if (n.type === "group") return n;
            const newTier = getTierForNode(n, nds);
            if (newTier !== n.data.tier) {
              return { ...n, data: { ...n.data, tier: newTier, ...(newTier ? { format: "delta" as DataFormat } : {}) } };
            }
            return n;
          });
          return updated;
        });
        return;
      }

      // Skill node was moved — update just this node's tier
      const newTier = getTierForNode(draggedNode, nodes);
      if (newTier !== draggedNode.data.tier) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === draggedNode.id
              ? { ...n, data: { ...n.data, tier: newTier, ...(newTier ? { format: "delta" as DataFormat } : {}) } }
              : n,
          ),
        );
      }
    },
    [nodes, setNodes, getTierForNode],
  );

  // ── Group drawing: mouseUp (needs snapshot) ──
  const handleDrawMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drawStartScreen || !drawCurrentScreen) return;
      const rect = reactFlowWrapper.current?.getBoundingClientRect();
      if (!rect) return;
      const startFlow = screenToFlowPosition({ x: drawStartScreen.x + rect.left, y: drawStartScreen.y + rect.top });
      const endFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const x = Math.min(startFlow.x, endFlow.x);
      const y = Math.min(startFlow.y, endFlow.y);
      const w = Math.abs(endFlow.x - startFlow.x);
      const h = Math.abs(endFlow.y - startFlow.y);
      if (w > 40 && h > 30) {
        snapshot();
        userEditedCanvas.current = true;
        const newNode: Node<SkillNodeData> = {
          id: `group-${Date.now()}`,
          type: "group",
          position: { x, y },
          style: { width: w, height: h },
          data: { label: "New Group", description: "", skillId: "", category: "Custom", groupColor: nextGroupColor() },
          zIndex: -1,
        };
        setNodes((nds) => [newNode, ...nds]);
        // Immediately open the edit dialog for naming
        setEditingGroup(newNode.id);
        setEditGroupLabel("");
        setEditGroupDesc("");
      }
      setDrawStartScreen(null);
      setDrawCurrentScreen(null);
      setDrawingGroupMode(false);
    },
    [drawStartScreen, drawCurrentScreen, setNodes, snapshot, screenToFlowPosition],
  );

  // Filtered catalog (excludes skills hidden from builder)
  const filteredCatalog = useMemo(() => {
    const visible = SKILL_CATALOG.filter((s) => !s.hiddenFromBuilder);
    if (!catalogSearch.trim()) return visible;
    const q = catalogSearch.toLowerCase();
    return visible.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.nodeType.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [catalogSearch]);

  // Group by category
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, SkillDef[]> = {};
    for (const skill of filteredCatalog) {
      if (!groups[skill.nodeType]) groups[skill.nodeType] = [];
      groups[skill.nodeType].push(skill);
    }
    return groups;
  }, [filteredCatalog]);

  // Add skill to canvas
  const addSkillToCanvas = useCallback(
    (skill: SkillDef, position?: { x: number; y: number }) => {
      snapshot();
      userEditedCanvas.current = true;
      const id = `${skill.id}-${Date.now()}`;
      const newNode: Node<SkillNodeData> = {
        id,
        type: "skill",
        position: position || {
          x: 250 + Math.random() * 200,
          y: 150 + Math.random() * 200,
        },
        data: {
          label: skill.label,
          skillId: skill.id,
          category: skill.nodeType,
          description: skill.description,
          ...(skill.defaultTier && { tier: skill.defaultTier }),
          ...(skill.defaultFormat && { format: skill.defaultFormat }),
          ...(skill.defaultPattern && { pattern: skill.defaultPattern }),
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes, snapshot],
  );

  // Add custom-named node
  const [customNodeDialogOpen, setCustomNodeDialogOpen] = useState(false);
  const [customNodeName, setCustomNodeName] = useState("");
  const addCustomNode = useCallback(() => {
    setCustomNodeName("");
    setCustomNodeDialogOpen(true);
  }, []);
  const confirmAddCustomNode = useCallback(() => {
    if (!customNodeName.trim()) return;
    addSkillToCanvas({
      id: `custom-${Date.now()}`,
      label: customNodeName.trim(),
      description: "Custom component",
      nodeType: "Custom",
    });
    setCustomNodeDialogOpen(false);
    setCustomNodeName("");
  }, [customNodeName, addSkillToCanvas]);

  // Load a template onto the canvas
  const [templateKey, setTemplateKey] = useState(0);
  const loadTemplate = useCallback(
    (templateId: string) => {
      const template = ARCHITECTURE_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;
      userEditedCanvas.current = true; // prevent auto-populate from overwriting template
      setTemplateKey((k) => k + 1); // reset Select so same template can be re-selected
      snapshot();
      const templateNodes: Node<SkillNodeData>[] = template.nodes.map((n) => ({
        id: n.id,
        type: "skill",
        position: n.position,
        data: n.data,
      }));
      const templateEdges: Edge[] = template.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: "smoothstep",
        animated: true,
        label: e.label,
        data: e.data,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 2 },
      }));
      setNodes(templateNodes);
      setEdges(templateEdges);
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 50);
    },
    [setNodes, setEdges, snapshot, fitView],
  );

  // Copy current canvas as JSON config
  const [jsonCopied, setJsonCopied] = useState(false);
  const copyJsonConfig = useCallback(() => {
    const config = {
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
        data: e.data,
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
  }, [nodes, edges]);

  // Auto-layout with ELK.js
  const autoLayout = useCallback(async () => {
    if (nodes.length < 2) return;
    setIsLayouting(true);
    try {
      snapshot();
      const result = await elkAutoLayout(nodes, edges);
      setNodes(result.nodes);
      setEdges(result.edges);
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 50);
    } finally {
      setIsLayouting(false);
    }
  }, [nodes, edges, setNodes, setEdges, snapshot, fitView]);

  // Handle connection complete — show dialog
  const onConnect = useCallback(
    (connection: Connection) => {
      // Get mouse position for dialog placement
      const x = window.innerWidth / 2 - 144;
      const y = window.innerHeight / 2 - 80;
      setPendingConnection({ connection, position: { x, y } });
    },
    [],
  );

  const confirmConnection = useCallback(
    (description: string) => {
      if (!pendingConnection) return;
      snapshot();
      userEditedCanvas.current = true;
      const { connection } = pendingConnection;
      // Swap source/target so the arrow points from the node the user dragged
      // FROM (first click) to the node they dropped ON (second click).
      const flipped: Connection = {
        source: connection.target,
        target: connection.source,
        sourceHandle: connection.targetHandle,
        targetHandle: connection.sourceHandle,
      };
      const edgeId = `e-${flipped.source}-${flipped.target}-${Date.now()}`;
      setEdges((eds) =>
        addEdge(
          {
            ...flipped,
            id: edgeId,
            type: "default",
            animated: true,
            label: description,
            labelStyle: { fontSize: 11, fontWeight: 500, fill: edgeColor },
            labelBgStyle: {
              fill: "hsl(var(--background))",
              stroke: "hsl(var(--border))",
              strokeWidth: 1,
              rx: 4,
              ry: 4,
            },
            labelBgPadding: [6, 3] as [number, number],
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeColor },
            style: { strokeWidth: 2, stroke: edgeColor },
          },
          eds,
        ),
      );
      setPendingConnection(null);
    },
    [pendingConnection, setEdges, snapshot],
  );

  // Drag from catalog onto canvas
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const skillJson = e.dataTransfer.getData("application/skill");
      if (!skillJson) return;
      const skill: SkillDef = JSON.parse(skillJson);
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addSkillToCanvas(skill, position);
    },
    [screenToFlowPosition, addSkillToCanvas],
  );

  // Delete selected nodes/edges
  const deleteSelected = useCallback(() => {
    snapshot();
    userEditedCanvas.current = true;
    const selectedNodes = nodes.filter((n) => n.selected);
    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !e.selected &&
          !selectedNodeIds.has(e.source) &&
          !selectedNodeIds.has(e.target),
      ),
    );
    if (selectedEdge) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  }, [nodes, selectedEdge, setNodes, setEdges, snapshot]);

  // Copy/paste selected nodes
  const clipboardRef = useRef<Node<SkillNodeData>[]>([]);

  const copySelected = useCallback(() => {
    clipboardRef.current = nodes
      .filter((n) => n.selected)
      .map((n) => JSON.parse(JSON.stringify(n)));
  }, [nodes]);

  const pasteClipboard = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    snapshot();
    const newNodes = clipboardRef.current.map((n) => ({
      ...n,
      id: `${n.data.skillId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: { x: n.position.x + 30, y: n.position.y + 30 },
      selected: false,
    }));
    setNodes((nds) => [...nds, ...newNodes]);
  }, [setNodes, snapshot]);

  // Keyboard shortcuts — skip when focus is inside an input/textarea
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;
      if (isInput) return; // let native input handling work

      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        copySelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        pasteClipboard();
      }
    },
    [deleteSelected, undo, redo, copySelected, pasteClipboard],
  );

  // Serialize architecture for LLM
  const serializeArchitecture = useCallback((): string => {
    if (nodes.length === 0) return "";

    // Separate group nodes from skill nodes
    const groupNodes = nodes.filter((n) => n.type === "group");
    const skillNodes = nodes.filter((n) => n.type !== "group");

    // Compute containment: which skill nodes fall within each group's bounds
    const groupContents = new Map<string, string[]>();
    for (const g of groupNodes) {
      const gx = g.position.x;
      const gy = g.position.y;
      const gw = (g.measured?.width ?? (g.style?.width as number)) || 0;
      const gh = (g.measured?.height ?? (g.style?.height as number)) || 0;
      const contained: string[] = [];
      for (const s of skillNodes) {
        const sw = s.measured?.width || 180;
        const sh = s.measured?.height || 60;
        const cx = s.position.x + sw / 2;
        const cy = s.position.y + sh / 2;
        if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
          contained.push(s.data.label || s.id);
        }
      }
      groupContents.set(g.id, contained);
    }

    // Build a mermaid node ID from the ReactFlow node id (sanitize for mermaid)
    const toMermaidId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
    const categoryToClass: Record<string, string> = {
      "Data Asset": "data_asset", Compute: "compute",
      Application: "application", External: "external", Custom: "compute",
    };

    // Compute which group each skill node belongs to (by containment)
    const nodeToGroup = new Map<string, string>(); // skillNode.id -> groupNode.id
    for (const g of groupNodes) {
      const members = groupContents.get(g.id) || [];
      for (const s of skillNodes) {
        const sLabel = s.data.label || s.id;
        if (members.includes(sLabel)) {
          nodeToGroup.set(s.id, g.id);
        }
      }
    }

    const lines: string[] = ["## Architecture\n", "```mermaid", "graph LR"];

    // Track which skill nodes are inside groups (they get collapsed into the group node)
    const groupedSkillIds = new Set<string>();
    for (const s of skillNodes) {
      if (nodeToGroup.has(s.id)) groupedSkillIds.add(s.id);
    }

    // Emit ungrouped skill nodes only (grouped ones are represented by their group node)
    for (const s of skillNodes) {
      if (groupedSkillIds.has(s.id)) continue;
      const mid = toMermaidId(s.id);
      const cls = categoryToClass[s.data.category as string] || "compute";
      const meta: string[] = [];
      if (s.data.tier) meta.push(`tier=${s.data.tier}`);
      if (s.data.format) meta.push(`format=${s.data.format}`);
      if (s.data.pattern) meta.push(`pattern=${s.data.pattern}`);
      const metaComment = meta.length > 0 ? ` %% ${meta.join(", ")}` : "";
      lines.push(`  ${mid}["${s.data.skillId} | ${s.data.description}"]:::${cls}${metaComment}`);
    }

    // Emit groups as single Mermaid nodes (not subgraphs) — lists contained tables in description.
    // This gives the executing LLM a clear layer-level representation.
    for (const g of groupNodes) {
      const mid = toMermaidId(g.id);
      const containedLabels = (groupContents.get(g.id) || []);
      const tableList = containedLabels.length > 0 ? containedLabels.join(", ") : g.data.description || "";
      const tier = g.data.label?.toLowerCase() as MedallionTier | undefined;
      const meta: string[] = [];
      if (tier && ["bronze", "silver", "gold"].includes(tier)) meta.push(`tier=${tier}`);
      meta.push("format=delta");
      const metaComment = ` %% ${meta.join(", ")}`;
      lines.push(`  ${mid}["${g.data.label} Layer | ${tableList}"]:::data_asset${metaComment}`);
    }

    // Emit edges — groups are now regular Mermaid nodes, so edges work directly
    const allNodeIds = new Set([...skillNodes.map((n) => n.id), ...groupNodes.map((n) => n.id)]);
    for (const edge of edges) {
      if (!allNodeIds.has(edge.source) || !allNodeIds.has(edge.target)) continue;
      const desc = typeof edge.label === "string" ? edge.label : "";
      lines.push(`  ${toMermaidId(edge.source)} -->|"${desc}"| ${toMermaidId(edge.target)}`);
    }

    lines.push("```");

    if (architectureNotes.trim()) {
      lines.push("\n### Architecture Notes\n");
      lines.push(architectureNotes.trim());
    }

    return lines.join("\n");
  }, [nodes, edges, architectureNotes]);

  // Expose serialize to parent via innerRef
  useEffect(() => {
    if (innerRef) {
      innerRef.current = { serialize: serializeArchitecture };
    }
    return () => { if (innerRef) innerRef.current = null; };
  }, [innerRef, serializeArchitecture]);

  // Notify parent of architecture changes — only when user has edited the canvas,
  // not on auto-populate (which would overwrite the LLM's original Mermaid)
  useEffect(() => {
    if (onArchitectureChange && nodes.length > 0 && userEditedCanvas.current) {
      onArchitectureChange(serializeArchitecture());
    }
  }, [serializeArchitecture, onArchitectureChange, nodes.length]);

  const handleRefineSkill = useCallback(() => {
    const desc = serializeArchitecture();
    if (desc && onApplyArchitecture) {
      // Mark canvas as user-edited so auto-populate won't overwrite after refinement
      userEditedCanvas.current = true;
      onApplyArchitecture(desc);
    }
  }, [serializeArchitecture, onApplyArchitecture]);

  // Description panel: update a node's description
  const updateNodeDescription = useCallback(
    (nodeId: string, description: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, description } } : n,
        ),
      );
    },
    [setNodes],
  );

  // Description panel: update an edge's label/description
  const updateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? { ...e, label, data: { ...e.data, description: label } }
            : e,
        ),
      );
    },
    [setEdges],
  );

  // Double-click editing state
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [editNodeDesc, setEditNodeDesc] = useState("");
  const [editEdgeLabel, setEditEdgeLabel] = useState("");

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node<SkillNodeData>) => {
      if (node.type === "group") {
        setEditingGroup(node.id);
        setEditGroupLabel(node.data.label || "");
        setEditGroupDesc(node.data.description || "");
        setEditingNode(null);
        setEditingEdge(null);
      } else {
        setEditingNode(node.id);
        setEditNodeDesc(node.data.description || "");
        setEditingEdge(null);
        setEditingGroup(null);
      }
    },
    [],
  );

  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setEditingEdge(edge.id);
      setEditEdgeLabel(typeof edge.label === "string" ? edge.label : "");
      setEditingNode(null);
    },
    [],
  );

  const saveNodeEdit = useCallback(() => {
    if (editingNode) {
      updateNodeDescription(editingNode, editNodeDesc);
      setEditingNode(null);
    }
  }, [editingNode, editNodeDesc, updateNodeDescription]);

  const saveEdgeEdit = useCallback(() => {
    if (editingEdge) {
      updateEdgeLabel(editingEdge, editEdgeLabel);
      setEditingEdge(null);
    }
  }, [editingEdge, editEdgeLabel, updateEdgeLabel]);

  // Edge click to select
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge((prev) => (prev === edge.id ? null : edge.id));
  }, []);

  return (
    <div
      className="flex h-full"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {/* Side panel catalog */}
      {catalogOpen && (
        <div className="w-60 shrink-0 border-r border-border/60 flex flex-col bg-background">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Skill Catalog
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCatalogOpen(false)}
              className="h-6 w-6 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="px-2 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search skills..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
          </div>
          <div className="px-2 pb-1">
            <Button
              variant="outline"
              size="sm"
              onClick={addCustomNode}
              className="w-full h-7 text-xs gap-1.5"
            >
              <Plus className="h-3 w-3" /> Add Custom Node
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-2 pb-3 space-y-1">
              {Object.entries(groupedCatalog).map(([cat, skills]) => {
                const isCollapsed = collapsedCategories.has(cat);
                const cfg = CATEGORY_CONFIG[cat as SkillCategory];
                return (
                  <div key={cat}>
                    <button
                      onClick={() =>
                        setCollapsedCategories((prev) => {
                          const next = new Set(prev);
                          if (next.has(cat)) next.delete(cat);
                          else next.add(cat);
                          return next;
                        })
                      }
                      className="flex items-center gap-1.5 w-full px-1.5 py-1 text-left rounded-md hover:bg-muted transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      )}
                      <cfg.icon className={`h-3 w-3 ${cfg.color}`} />
                      <span className={`text-[11px] font-semibold ${cfg.color}`}>
                        {cat}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {skills.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="ml-2 space-y-0.5 mt-0.5">
                        {skills.map((skill) => (
                          <div
                            key={skill.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                "application/skill",
                                JSON.stringify(skill),
                              );
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onClick={() => addSkillToCanvas(skill)}
                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing hover:${cfg.bg} border border-transparent hover:${cfg.border} transition-all group`}
                          >
                            <GripVertical className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate">
                                {skill.label}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {skill.description}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredCatalog.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">
                  No skills matching "{catalogSearch}"
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Canvas */}
      <div
        className="flex-1 relative"
        ref={reactFlowWrapper}
      >
        {/* Draw-group overlay: sits above ReactFlow to capture mouse events */}
        {drawingGroupMode && (
          <div
            className="absolute inset-0 z-30"
            style={{ cursor: "crosshair" }}
            onMouseDown={handleDrawMouseDown}
            onMouseMove={handleDrawMouseMove}
            onMouseUp={handleDrawMouseUp}
          >
            {drawStartScreen && drawCurrentScreen && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <rect
                  x={Math.min(drawStartScreen.x, drawCurrentScreen.x)}
                  y={Math.min(drawStartScreen.y, drawCurrentScreen.y)}
                  width={Math.abs(drawCurrentScreen.x - drawStartScreen.x)}
                  height={Math.abs(drawCurrentScreen.y - drawStartScreen.y)}
                  fill="rgba(139, 92, 246, 0.06)"
                  stroke="rgba(139, 92, 246, 0.5)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  rx={12}
                />
              </svg>
            )}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges.map((e) => ({
            ...e,
            selected: e.id === selectedEdge,
            style: {
              ...e.style,
              stroke:
                e.id === selectedEdge
                  ? "#FF3621"
                  : resolvedDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)",
            },
          }))}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={onEdgeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          snapToGrid={snapToGrid}
          snapGrid={[20, 20]}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          onInit={() => {
            // fitView on init handles the case where tab was hidden during auto-populate
            if (nodes.length > 0) {
              setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2 }), 50);
            }
          }}
          colorMode={resolvedDark ? "dark" : "light"}
          style={{ background: resolvedDark ? "#1B1B1F" : "#FAFAFA" }}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: resolvedDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)" },
            style: { strokeWidth: 2, stroke: resolvedDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)" },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={resolvedDark ? "rgba(255,54,33,0.08)" : "rgba(255,54,33,0.12)"} />
          <Controls showInteractive={false} className={resolvedDark
            ? "!border-[#2a2a2e] !bg-[#1B1B1F] !shadow-sm [&>button]:!border-[#2a2a2e] [&>button]:!bg-[#1B1B1F] [&>button]:!text-white/60 [&>button:hover]:!bg-[#2a2a2e]"
            : "!border-border !bg-white !shadow-sm [&>button]:!border-border [&>button]:!bg-white [&>button]:!text-foreground/60 [&>button:hover]:!bg-muted"
          } />
          <MiniMap
            position="top-right"
            className={resolvedDark ? "!border-[#2a2a2e] !bg-[#1B1B1F]/90" : "!border-border !bg-white/90"}
            nodeColor={(n) => {
              if (n.type === "group") {
                const gc = (n.data as SkillNodeData)?.groupColor as { border: string } | undefined;
                return gc ? `${gc.border}33` : "rgba(139, 92, 246, 0.2)";
              }
              const cat = (n.data as SkillNodeData)?.category;
              if (!cat) return "#888";
              const colors: Record<string, string> = {
                "Data Asset": "#3b82f6",
                Compute: "#a855f7",
                Application: "#10b981",
                External: "#f97316",
                Custom: "#ec4899",
              };
              return colors[cat] || "#888";
            }}
          />

          {/* Toolbar panel */}
          <Panel position="top-left" className="flex gap-1">
            <TooltipProvider delayDuration={300}>
              {!catalogOpen && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCatalogOpen(true)}
                      className="h-7 text-xs gap-1.5 bg-background"
                    >
                      <GripVertical className="h-3 w-3" />
                      Catalog
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Show component catalog</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={undo}
                    disabled={!canUndo}
                    className="h-7 w-7 p-0 bg-background"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Undo (Cmd+Z)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={redo}
                    disabled={!canRedo}
                    className="h-7 w-7 p-0 bg-background"
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Redo (Cmd+Shift+Z)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deleteSelected}
                    disabled={!nodes.some((n) => n.selected) && !selectedEdge}
                    className="h-7 w-7 p-0 bg-background"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Delete selected (Del)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copySelected}
                    disabled={!nodes.some((n) => n.selected)}
                    className="h-7 w-7 p-0 bg-background"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Copy (Cmd+C)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={pasteClipboard}
                    disabled={clipboardRef.current.length === 0}
                    className="h-7 w-7 p-0 bg-background"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Paste (Cmd+V)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={snapToGrid ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSnapToGrid(!snapToGrid)}
                    className="h-7 w-7 p-0"
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Snap to grid</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={drawingGroupMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDrawingGroupMode(!drawingGroupMode)}
                    className="h-7 w-7 p-0"
                  >
                    <SquareDashed className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Draw group rectangle</TooltipContent>
              </Tooltip>
              <div className="mx-0.5 h-4 w-px bg-border" />
              <Select key={templateKey} onValueChange={loadTemplate}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SelectTrigger className="h-7 w-auto gap-1.5 text-xs bg-background border [&>svg:last-child]:h-3 [&>svg:last-child]:w-3">
                      <LayoutTemplate className="h-3 w-3 shrink-0" />
                      <SelectValue placeholder="Templates" />
                    </SelectTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Load a template architecture</TooltipContent>
                </Tooltip>
                <SelectContent>
                  {ARCHITECTURE_TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{t.name}</span>
                        <span className="text-[10px] text-muted-foreground">{t.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyJsonConfig}
                    disabled={nodes.length === 0}
                    className="h-7 gap-1.5 px-2 text-xs bg-background"
                  >
                    {jsonCopied ? <Check className="h-3 w-3 text-green-500" /> : <Braces className="h-3 w-3" />}
                    {jsonCopied ? "Copied" : "JSON"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Copy canvas config as JSON</TooltipContent>
              </Tooltip>
              <div className="mx-0.5 h-4 w-px bg-border" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={autoLayout}
                    disabled={nodes.length < 2 || isLayouting}
                    className="h-7 gap-1.5 px-2 text-xs bg-background"
                  >
                    {isLayouting ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlignHorizontalDistributeCenter className="h-3 w-3" />}
                    Auto-arrange
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Auto-layout with ELK.js (left-to-right)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={descPanelOpen ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDescPanelOpen((v) => !v)}
                    className="h-7 gap-1.5 px-2 text-xs"
                  >
                    <FileText className="h-3 w-3" />
                    Describe
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Architecture description panel (sent to LLM)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Panel>

          {/* Refine architecture.md button */}
          {onApplyArchitecture && nodes.length > 0 && !descPanelOpen && (
            <Panel position="top-right">
              <Button
                onClick={handleRefineSkill}
                disabled={busy}
                className="gap-1.5 text-xs h-8 shadow-md"
                size="sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {stage === "proposal" ? "Refine Proposed Solution" : "Refine architecture.md from diagram"}
              </Button>
            </Panel>
          )}

          {/* Node count */}
          <Panel position="bottom-left">
            <div className={`text-[10px] backdrop-blur-sm rounded px-2 py-1 border ${resolvedDark ? "text-white/40 bg-[#1B1B1F]/80 border-[#2a2a2e]" : "text-foreground/50 bg-white/80 border-border"}`}>
              {nodes.length} component{nodes.length !== 1 ? "s" : ""} &middot;{" "}
              {edges.length} connection{edges.length !== 1 ? "s" : ""}
            </div>
          </Panel>
        </ReactFlow>

        {/* Connection description dialog */}
        {pendingConnection && (
          <ConnectionDialog
            position={pendingConnection.position}
            onSubmit={confirmConnection}
            onCancel={() => setPendingConnection(null)}
          />
        )}

        {/* Node edit dialog */}
        {editingNode && (() => {
          const node = nodes.find((n) => n.id === editingNode);
          if (!node) return null;
          const svcName = SKILL_CATALOG.find((s) => s.id === node.data.skillId)?.label || node.data.label;
          return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
              onClick={(e) => { if (e.target === e.currentTarget) setEditingNode(null); }}>
              <div className="bg-popover border border-border rounded-xl shadow-2xl p-4 w-80 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Edit Component</h3>
                  <button onClick={() => setEditingNode(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Service</label>
                  <div className="text-sm font-medium text-foreground px-2 py-1.5 bg-muted/50 rounded-md">{svcName}</div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Category</label>
                  <div className="text-sm text-foreground px-2 py-1.5 bg-muted/50 rounded-md">{node.data.category}</div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Description</label>
                  <Textarea
                    value={editNodeDesc}
                    onChange={(e) => setEditNodeDesc(e.target.value)}
                    placeholder="Describe this component's role..."
                    className="text-sm min-h-[60px] resize-y"
                    rows={2}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNodeEdit(); } }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingNode(null)}>Cancel</Button>
                  <Button size="sm" onClick={saveNodeEdit}>Save</Button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Edge edit dialog */}
        {editingEdge && (() => {
          const edge = edges.find((e) => e.id === editingEdge);
          if (!edge) return null;
          const src = nodes.find((n) => n.id === edge.source);
          const tgt = nodes.find((n) => n.id === edge.target);
          const srcName = src ? (SKILL_CATALOG.find((s) => s.id === src.data.skillId)?.label || src.data.label) : "?";
          const tgtName = tgt ? (SKILL_CATALOG.find((s) => s.id === tgt.data.skillId)?.label || tgt.data.label) : "?";
          return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
              onClick={(e) => { if (e.target === e.currentTarget) setEditingEdge(null); }}>
              <div className="bg-popover border border-border rounded-xl shadow-2xl p-4 w-80 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Edit Connection</h3>
                  <button onClick={() => setEditingEdge(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-medium">{srcName}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium">{tgtName}</span>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Description</label>
                  <Textarea
                    value={editEdgeLabel}
                    onChange={(e) => setEditEdgeLabel(e.target.value)}
                    placeholder="Describe this data flow..."
                    className="text-sm min-h-[60px] resize-y"
                    rows={2}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdgeEdit(); } }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingEdge(null)}>Cancel</Button>
                  <Button size="sm" onClick={saveEdgeEdit}>Save</Button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Group edit dialog */}
        {editingGroup && (() => {
          const gNode = nodes.find((n) => n.id === editingGroup);
          if (!gNode) return null;
          return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
              onClick={(e) => { if (e.target === e.currentTarget) setEditingGroup(null); }}>
              <div className="bg-popover border border-border rounded-xl shadow-2xl p-4 w-80 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Edit Group</h3>
                  <button onClick={() => setEditingGroup(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Name</label>
                  <Input
                    value={editGroupLabel}
                    onChange={(e) => setEditGroupLabel(e.target.value)}
                    placeholder="Group name"
                    className="text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveGroupEdit(); } }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Description (optional)</label>
                  <Textarea
                    value={editGroupDesc}
                    onChange={(e) => setEditGroupDesc(e.target.value)}
                    placeholder="What does this group represent?"
                    className="text-sm min-h-[60px] resize-y"
                    rows={2}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveGroupEdit(); } }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingGroup(null)}>Cancel</Button>
                  <Button size="sm" onClick={saveGroupEdit}>Save</Button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="pointer-events-auto text-center max-w-lg space-y-5">
              <div>
                <Workflow className={`h-10 w-10 mx-auto mb-2 ${resolvedDark ? "text-white/15" : "text-foreground/15"}`} />
                <p className={`text-sm font-semibold ${resolvedDark ? "text-white/80" : "text-foreground/80"}`}>Design Your Architecture</p>
                <p className={`text-xs mt-1 ${resolvedDark ? "text-white/40" : "text-muted-foreground"}`}>
                  Build a visual architecture that guides the LLM when generating your demo.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setCatalogOpen(true)}
                  className={`flex flex-col items-center gap-2 rounded-xl border backdrop-blur-sm p-4 hover:border-[#FF3621]/30 hover:bg-[#FF3621]/[0.05] transition-all group ${resolvedDark ? "border-white/[0.06] bg-white/[0.03]" : "border-border/60 bg-white/80"}`}
                >
                  <GripVertical className={`h-5 w-5 group-hover:text-[#FF3621] transition-colors ${resolvedDark ? "text-white/30" : "text-muted-foreground"}`} />
                  <span className={`text-xs font-medium ${resolvedDark ? "text-white/70" : "text-foreground/70"}`}>Drag from Catalog</span>
                  <span className={`text-[10px] leading-tight ${resolvedDark ? "text-white/30" : "text-muted-foreground"}`}>Browse Databricks components</span>
                </button>
                <button
                  onClick={() => {
                    if (ARCHITECTURE_TEMPLATES.length > 0) loadTemplate(ARCHITECTURE_TEMPLATES[0].id);
                  }}
                  className={`flex flex-col items-center gap-2 rounded-xl border backdrop-blur-sm p-4 hover:border-[#FF3621]/30 hover:bg-[#FF3621]/[0.05] transition-all group ${resolvedDark ? "border-white/[0.06] bg-white/[0.03]" : "border-border/60 bg-white/80"}`}
                >
                  <LayoutTemplate className={`h-5 w-5 group-hover:text-[#FF3621] transition-colors ${resolvedDark ? "text-white/30" : "text-muted-foreground"}`} />
                  <span className={`text-xs font-medium ${resolvedDark ? "text-white/70" : "text-foreground/70"}`}>Start from Template</span>
                  <span className={`text-[10px] leading-tight ${resolvedDark ? "text-white/30" : "text-muted-foreground"}`}>Pre-built architecture patterns</span>
                </button>
                <div className={`flex flex-col items-center gap-2 rounded-xl border backdrop-blur-sm p-4 ${resolvedDark ? "border-white/[0.04] bg-white/[0.02]" : "border-border/40 bg-white/60"}`}>
                  <Sparkles className={`h-5 w-5 ${resolvedDark ? "text-white/20" : "text-muted-foreground/50"}`} />
                  <span className={`text-xs font-medium ${resolvedDark ? "text-white/40" : "text-muted-foreground/70"}`}>Generate from Prompt</span>
                  <span className={`text-[10px] leading-tight ${resolvedDark ? "text-white/20" : "text-muted-foreground/50"}`}>Auto-populates from your SKILL.md</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Description Panel (right side) */}
      {descPanelOpen && (
        <div className="w-80 shrink-0 border-l border-border/60 flex flex-col bg-background">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Architecture Description
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDescPanelOpen(false)} className="h-6 w-6 p-0">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="px-3 py-2 border-b border-border/30 bg-muted/30">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              This description is sent to the LLM when you refine your SKILL.md. Edit component roles, connection labels, and add notes to guide generation.
            </p>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              {/* Components */}
              {nodes.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Components ({nodes.length})
                  </h4>
                  <div className="space-y-2">
                    {nodes.map((node) => {
                      const cfg = CATEGORY_CONFIG[node.data.category] || CATEGORY_CONFIG["Data Asset"];
                      const Icon = cfg.icon;
                      const catEntry = SKILL_CATALOG.find((s) => s.id === node.data.skillId);
                      const svcName = catEntry?.label || node.data.label;
                      return (
                        <div key={node.id} className={`rounded-lg border ${cfg.border} ${cfg.bg} p-2.5`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <Icon className={`h-3 w-3 ${cfg.color}`} />
                            <span className="text-xs font-medium text-foreground">{svcName}</span>
                          </div>
                          <Input
                            value={node.data.description}
                            onChange={(e) => updateNodeDescription(node.id, e.target.value)}
                            placeholder="Describe this component's role..."
                            className="text-[11px] h-7 bg-background/50 border-border/40"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Connections */}
              {edges.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Data Flow ({edges.length})
                  </h4>
                  <div className="space-y-2">
                    {edges.map((edge) => {
                      const src = nodes.find((n) => n.id === edge.source);
                      const tgt = nodes.find((n) => n.id === edge.target);
                      if (!src || !tgt) return null;
                      const srcName = SKILL_CATALOG.find((s) => s.id === src.data.skillId)?.label || src.data.label;
                      const tgtName = SKILL_CATALOG.find((s) => s.id === tgt.data.skillId)?.label || tgt.data.label;
                      return (
                        <div key={edge.id} className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
                          <div className="flex items-center gap-1.5 mb-1 text-[11px]">
                            <span className="font-medium text-foreground truncate">{srcName}</span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-medium text-foreground truncate">{tgtName}</span>
                          </div>
                          <Textarea
                            value={typeof edge.label === "string" ? edge.label : ""}
                            onChange={(e) => updateEdgeLabel(edge.id, e.target.value)}
                            placeholder="Describe this data flow..."
                            className="text-[11px] min-h-[28px] bg-background/50 border-border/40 resize-y"
                            rows={1}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Architecture Notes */}
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Architecture Notes
                </h4>
                <Textarea
                  value={architectureNotes}
                  onChange={(e) => setArchitectureNotes(e.target.value)}
                  placeholder="Add context for the LLM — industry specifics, data volume expectations, compliance requirements, integration constraints..."
                  className="text-[11px] min-h-[80px] bg-background/50 border-border/40 resize-none"
                  rows={4}
                />
              </div>

              {/* Serialized preview */}
              {nodes.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    LLM Input Preview
                  </h4>
                  <pre className="text-[10px] text-muted-foreground bg-muted/30 rounded-lg border p-2.5 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                    {serializeArchitecture()}
                  </pre>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer with refine button */}
          {onApplyArchitecture && nodes.length > 0 && (
            <div className="p-3 border-t border-border/50">
              <Button
                onClick={handleRefineSkill}
                disabled={busy}
                className="w-full gap-1.5 text-xs h-8"
                size="sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {stage === "proposal" ? "Refine Proposed Solution" : "Refine architecture.md from diagram"}
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={customNodeDialogOpen} onOpenChange={setCustomNodeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Node</DialogTitle>
            <DialogDescription>
              Enter a name for the custom node to add to the canvas.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Node name"
            value={customNodeName}
            onChange={(e) => setCustomNodeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmAddCustomNode();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomNodeDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAddCustomNode} disabled={!customNodeName.trim()}>
              Add Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper with ReactFlowProvider
// ---------------------------------------------------------------------------

export interface ArchitectureBuilderHandle {
  getSerializedArchitecture: () => string | null;
}

const ArchitectureBuilder = forwardRef<ArchitectureBuilderHandle, {
  onApplyArchitecture?: (architectureDescription: string) => void;
  onArchitectureChange?: (mermaid: string) => void;
  busy?: boolean;
  architectureMd?: string;
  proposalBuildSteps?: string;
  hideCatalog?: boolean;
  isVisible?: boolean;
  stage?: string;
}>(function ArchitectureBuilder({ onApplyArchitecture, onArchitectureChange, busy, architectureMd, proposalBuildSteps, hideCatalog, isVisible, stage }, ref) {
  const innerRef = useRef<{ serialize: () => string } | null>(null);

  useImperativeHandle(ref, () => ({
    getSerializedArchitecture: () => {
      return innerRef.current?.serialize() || null;
    },
  }));

  return (
    <ReactFlowProvider>
      <ArchitectureBuilderInner
        innerRef={innerRef}
        onApplyArchitecture={onApplyArchitecture}
        onArchitectureChange={onArchitectureChange}
        busy={busy}
        architectureMd={architectureMd}
        proposalBuildSteps={proposalBuildSteps}
        hideCatalog={hideCatalog}
        isVisible={isVisible}
        stage={stage}
      />
    </ReactFlowProvider>
  );
});

export default ArchitectureBuilder;
