/**
 * Architecture Diagram component using ReactFlow.
 * Renders a visual representation of the Databricks architecture from a schema.
 */

import { memo, useMemo, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Position,
  Handle,
  BackgroundVariant,
  ConnectionLineType,
  addEdge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  DATABRICKS_ICONS,
  type DatabricksIconName,
} from "../databricks-icons";
import {
  schemaToReactFlow,
  TIER_CONFIG,
  MERIDIAN_BANK_SCHEMA,
  type TierType,
  type ArchitectureSchema,
} from "../../lib/architecture-schema";
import { getViewportForBounds } from "@xyflow/system";
import { Button } from "@/components/ui/button";
import { Download, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { toPng, toSvg } from "html-to-image";

interface ArchitectureDiagramProps {
  schema?: ArchitectureSchema;
  content?: string; // Markdown content with JSON code block
  showDebugPanel?: boolean;
  onConnectionCreated?: (from: string, to: string) => void;
}

/**
 * Parse JSON schema from markdown content.
 * Looks for a JSON code block (```json ... ```) and extracts the schema.
 */
function parseSchemaFromMarkdown(content: string): ArchitectureSchema | null {
  try {
    // Try to find JSON code block
    const jsonBlockMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    let schema: ArchitectureSchema | null = null;

    if (jsonBlockMatch) {
      const jsonStr = jsonBlockMatch[1].trim();
      schema = JSON.parse(jsonStr) as ArchitectureSchema;
    } else {
      // If no code block, try to parse the whole content as JSON
      const trimmed = content.trim();
      if (trimmed.startsWith("{")) {
        schema = JSON.parse(trimmed) as ArchitectureSchema;
      }
    }

    // Generalize consumer/businessUser nodes to "Users" instead of specific people
    if (schema) {
      for (const col of schema.columns) {
        if (col.nodes) {
          for (const node of col.nodes) {
            if (node.tier === "consumer" && node.icon === "businessUser") {
              node.label = "Users";
              node.desc = "End Users";
            }
          }
        }
      }
    }

    return schema;
  } catch (error) {
    console.error("Failed to parse architecture schema:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Custom Node Component (clean card style)
// ---------------------------------------------------------------------------

interface CustomNodeData {
  label: string;
  icon: DatabricksIconName;
  tier?: TierType;
  description?: string;
}

const CustomNode = memo(function CustomNode({
  data,
  selected
}: {
  data: CustomNodeData;
  selected?: boolean;
}) {
  const Icon = DATABRICKS_ICONS[data.icon] || DATABRICKS_ICONS.data;
  const cfg = TIER_CONFIG[data.tier || "source"];

  return (
    <div
      className={`relative rounded-xl border ${cfg.border} ${cfg.bg} min-w-[170px] max-w-[220px] transition-all duration-200 dark:backdrop-blur-sm ${
        selected
          ? "shadow-lg shadow-primary/10 ring-2 ring-primary/50 -translate-y-0.5"
          : "shadow-md hover:shadow-lg hover:-translate-y-0.5"
      }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: cfg.stripe }}
    >
      <div className="pl-3.5 pr-3.5 py-2.5">
        {/* Connection handles */}
        <Handle type="source" position={Position.Top} id="top"
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-top-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Top} id="top-target"
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-top-1.5" />
        <Handle type="source" position={Position.Bottom} id="bottom"
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-bottom-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Bottom} id="bottom-target"
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-bottom-1.5" />
        <Handle type="source" position={Position.Left} id="left"
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-left-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Left} id="left-target"
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-left-1.5" />
        <Handle type="source" position={Position.Right} id="right"
          className="!w-2.5 !h-2.5 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-right-1.5 !transition-all !duration-150" />
        <Handle type="target" position={Position.Right} id="right-target"
          className="!w-2.5 !h-2.5 !bg-transparent !border-0 !-right-1.5" />

        {/* Content */}
        <div className="flex items-center gap-2.5">
          <div className={`shrink-0 ${cfg.color}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[13px] font-semibold ${cfg.color} truncate leading-tight`}>
              {data.label}
            </div>
            {data.description && (
              <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                {data.description}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Group Node for SDP/background layers (dashed border style)
// ---------------------------------------------------------------------------

interface GroupNodeData {
  label: string;
  tier?: TierType;
}

const GroupNode = memo(function GroupNode({ data }: { data: GroupNodeData }) {
  const cfg = TIER_CONFIG[data.tier || "governance"];

  return (
    <div
      className="w-full h-full relative pointer-events-none rounded-lg"
      style={{
        border: `1px dashed ${cfg.stripe}70`,
      }}
    >
      {/* Floating label at bottom */}
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider pointer-events-auto"
        style={{
          backgroundColor: cfg.stripe,
          color: 'white',
        }}
      >
        {data.label}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Bar Node for horizontal/vertical foundation layers
// ---------------------------------------------------------------------------

interface BarNodeData {
  label: string;
  tier?: TierType;
  vertical?: boolean;
}

const BarNode = memo(function BarNode({ data }: { data: BarNodeData }) {
  const cfg = TIER_CONFIG[data.tier || "governance"];
  const isVertical = data.vertical;

  if (isVertical) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center relative">
        <Handle type="target" position={Position.Left} id="left-target"
          className="!w-2 !h-2 !bg-transparent !border-0" />
        <Handle type="source" position={Position.Right} id="right"
          className="!w-2 !h-2 !bg-transparent !border-0" />

        <div className="absolute top-0 bottom-0 left-1/2 w-[1px]"
          style={{ backgroundColor: `${cfg.stripe}40` }} />

        <div
          className="relative z-10 px-1.5 py-2 rounded-full text-[9px] font-semibold tracking-wide whitespace-nowrap bg-background"
          style={{
            border: `1px solid ${cfg.stripe}60`,
            color: cfg.stripe,
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
          }}
        >
          {data.label}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <div className="absolute left-0 right-0 top-1/2 h-[1px]"
        style={{ backgroundColor: `${cfg.stripe}40` }} />

      <div
        className="relative z-10 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-background"
        style={{
          border: `1px solid ${cfg.stripe}60`,
          color: cfg.stripe,
        }}
      >
        {data.label}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Node Types
// ---------------------------------------------------------------------------

const nodeTypes = {
  custom: CustomNode,
  group: GroupNode,
  bar: BarNode,
};

// ---------------------------------------------------------------------------
// Architecture Diagram Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inner diagram (needs ReactFlowProvider context for useReactFlow)
// ---------------------------------------------------------------------------

const ArchitectureDiagramInner = memo(function ArchitectureDiagramInner({
  schema,
  content,
  showDebugPanel = false,
  onConnectionCreated,
}: ArchitectureDiagramProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { fitView, zoomIn, zoomOut, getNodes, getNodesBounds } = useReactFlow();

  // Parse schema from content if provided, otherwise use schema prop or default
  const resolvedSchema = useMemo(() => {
    if (content) {
      const parsed = parseSchemaFromMarkdown(content);
      if (parsed) return parsed;
    }
    return schema || MERIDIAN_BANK_SCHEMA;
  }, [content, schema]);

  // Convert schema to ReactFlow nodes/edges
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => schemaToReactFlow(resolvedSchema),
    [resolvedSchema]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Handle manual connection between nodes
  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find(n => n.id === params.source);
      const sourceTier = ((sourceNode?.data as unknown) as CustomNodeData)?.tier || "source";
      const edgeColor = TIER_CONFIG[sourceTier]?.stripe || "#64748b";

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            style: { stroke: edgeColor, strokeWidth: 1.5 },
            markerEnd: { type: "arrowclosed" as any, color: edgeColor },
          },
          eds
        )
      );

      // Notify parent about the new connection
      if (onConnectionCreated && params.source && params.target) {
        onConnectionCreated(params.source, params.target);
      }
    },
    [nodes, setEdges, onConnectionCreated]
  );

  // Fit-to-bounds export helper: fits the viewport around all nodes, then captures
  const exportDiagram = useCallback(async (format: "png" | "svg") => {
    const flowViewport = reactFlowWrapper.current?.querySelector(".react-flow__viewport") as HTMLElement;
    const flowEl = reactFlowWrapper.current?.querySelector(".react-flow") as HTMLElement;
    if (!flowViewport || !flowEl) return;

    // Compute bounding box of all nodes via the ReactFlow instance
    const allNodes = getNodes();
    if (allNodes.length === 0) return;
    const nodeIds = allNodes.map(n => n.id);
    const bounds = getNodesBounds(nodeIds);

    const padding = 60;
    const imageWidth = bounds.width + padding * 2;
    const imageHeight = bounds.height + padding * 2;

    // Compute the viewport transform that fits all nodes
    const viewport = getViewportForBounds(
      bounds,
      imageWidth,
      imageHeight,
      0.5,
      2,
      0,
    );

    const isDark = document.documentElement.classList.contains("dark");
    const bgColor = isDark ? "#1a1a1a" : "#ffffff";

    try {
      const fn = format === "png" ? toPng : toSvg;
      const dataUrl = await fn(flowViewport, {
        backgroundColor: bgColor,
        width: imageWidth,
        height: imageHeight,
        quality: 1,
        pixelRatio: format === "png" ? 2 : 1,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      });
      const link = document.createElement("a");
      link.download = `architecture-${resolvedSchema.name.replace(/\s+/g, "-").toLowerCase()}.${format}`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [resolvedSchema, getNodes, getNodesBounds]);

  // Generate position string for debugging
  const positionString = nodes
    .filter(n => n.type === 'custom' || n.id === 'db-one')
    .map(n => `${n.id}: x=${Math.round(n.position.x)}, y=${Math.round(n.position.y)}`)
    .join('\n');

  return (
    <div className="w-full h-full flex flex-col" ref={reactFlowWrapper}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="text-sm font-medium text-foreground">
          {resolvedSchema.name}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => zoomIn()}>
            <ZoomIn className="h-3.5 w-3.5" /> Zoom In
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => zoomOut()}>
            <ZoomOut className="h-3.5 w-3.5" /> Zoom Out
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => fitView({ padding: 0.08, minZoom: 0.6 })}>
            <Maximize2 className="h-3.5 w-3.5" /> Fit
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => exportDiagram("png")}>
            <Download className="h-3.5 w-3.5" /> PNG
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => exportDiagram("svg")}>
            <Download className="h-3.5 w-3.5" /> SVG
          </Button>
        </div>
      </div>

      {/* Diagram area — takes all remaining vertical space */}
      <div className="flex-1 min-h-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.08, minZoom: 0.6 }}
          minZoom={0.2}
          maxZoom={3}
          defaultEdgeOptions={{ type: "smoothstep" }}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: "var(--primary)", strokeWidth: 2 }}
          connectionLineType={ConnectionLineType.SmoothStep}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#94a3b8" className="opacity-30" />
          <Controls
            className="!bg-background !border-border !shadow-sm [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
            showInteractive={false}
          />
          <MiniMap
            className="!bg-muted/50 !border-border"
            nodeColor={(node) => {
              const data = node.data as unknown as CustomNodeData | GroupNodeData | BarNodeData;
              const tier = 'tier' in data ? data.tier : undefined;
              return tier ? TIER_CONFIG[tier]?.stripe || "#64748b" : "#64748b";
            }}
            maskColor="rgba(0,0,0,0.1)"
            pannable
            zoomable
          />
        </ReactFlow>

        {/* Legend — ordered to match left-to-right architecture flow */}
        <div className="absolute bottom-4 left-4 bg-background/95 backdrop-blur-sm border border-border rounded-lg px-4 py-3 shadow-md">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Layers</div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#64748b" }} />
              <span className="text-xs text-foreground">Raw Data</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#cd7f32" }} />
              <span className="text-xs text-foreground">Bronze</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#a8a9ad" }} />
              <span className="text-xs text-foreground">Silver</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#c9a227" }} />
              <span className="text-xs text-foreground">Gold</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#8b5cf6" }} />
              <span className="text-xs text-foreground">Compute</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#ec4899" }} />
              <span className="text-xs text-foreground">Analytics</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#6366f1" }} />
              <span className="text-xs text-foreground">AI</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#10b981" }} />
              <span className="text-xs text-foreground">Users</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
            Drag between handles to connect nodes
          </div>
        </div>
      </div>

      {/* Position Debug Panel (optional) */}
      {showDebugPanel && (
        <div className="p-3 bg-muted/50 border-t border-border">
          <div className="text-xs font-semibold mb-2 text-muted-foreground">Node Positions (drag nodes, then copy-paste):</div>
          <pre className="text-[10px] font-mono bg-background p-2 rounded border border-border overflow-auto max-h-48 select-all">
            {positionString}
          </pre>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Exported wrapper (provides ReactFlow context)
// ---------------------------------------------------------------------------

export const ArchitectureDiagram = memo(function ArchitectureDiagram(props: ArchitectureDiagramProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureDiagramInner {...props} />
    </ReactFlowProvider>
  );
});

export default ArchitectureDiagram;
