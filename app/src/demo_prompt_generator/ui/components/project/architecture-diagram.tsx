/**
 * Architecture Diagram component using ReactFlow.
 * Renders a visual representation of the Databricks architecture from a schema.
 */

import { memo, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
  BackgroundVariant,
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

interface ArchitectureDiagramProps {
  schema?: ArchitectureSchema;
  content?: string; // Markdown content with JSON code block
  showDebugPanel?: boolean;
}

/**
 * Parse JSON schema from markdown content.
 * Looks for a JSON code block (```json ... ```) and extracts the schema.
 */
function parseSchemaFromMarkdown(content: string): ArchitectureSchema | null {
  try {
    // Try to find JSON code block
    const jsonBlockMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      const jsonStr = jsonBlockMatch[1].trim();
      return JSON.parse(jsonStr) as ArchitectureSchema;
    }

    // If no code block, try to parse the whole content as JSON
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as ArchitectureSchema;
    }

    return null;
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
      className={`relative rounded-xl border ${cfg.border} ${cfg.bg} min-w-[140px] max-w-[180px] transition-all duration-200 dark:backdrop-blur-sm ${
        selected
          ? "shadow-lg shadow-primary/10 ring-2 ring-primary/50 -translate-y-0.5"
          : "shadow-md hover:shadow-lg hover:-translate-y-0.5"
      }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: cfg.stripe }}
    >
      <div className="pl-3 pr-3 py-2">
        {/* Connection handles */}
        <Handle type="source" position={Position.Top} id="top"
          className="!w-2 !h-2 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-top-1 !transition-all !duration-150" />
        <Handle type="target" position={Position.Top} id="top-target"
          className="!w-2 !h-2 !bg-transparent !border-0 !-top-1" />
        <Handle type="source" position={Position.Bottom} id="bottom"
          className="!w-2 !h-2 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-bottom-1 !transition-all !duration-150" />
        <Handle type="target" position={Position.Bottom} id="bottom-target"
          className="!w-2 !h-2 !bg-transparent !border-0 !-bottom-1" />
        <Handle type="source" position={Position.Left} id="left"
          className="!w-2 !h-2 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-left-1 !transition-all !duration-150" />
        <Handle type="target" position={Position.Left} id="left-target"
          className="!w-2 !h-2 !bg-transparent !border-0 !-left-1" />
        <Handle type="source" position={Position.Right} id="right"
          className="!w-2 !h-2 !bg-muted-foreground/30 hover:!bg-primary hover:!scale-150 !border-2 !border-background !-right-1 !transition-all !duration-150" />
        <Handle type="target" position={Position.Right} id="right-target"
          className="!w-2 !h-2 !bg-transparent !border-0 !-right-1" />

        {/* Content */}
        <div className="flex items-center gap-2">
          <div className={`shrink-0 ${cfg.color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[11px] font-semibold ${cfg.color} truncate leading-tight`}>
              {data.label}
            </div>
            {data.description && (
              <div className="text-[9px] text-muted-foreground truncate leading-tight">
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
          className="relative z-10 px-1.5 py-2 rounded-full text-[8px] font-semibold tracking-wide whitespace-nowrap"
          style={{
            backgroundColor: 'white',
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
        className="relative z-10 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wide"
        style={{
          backgroundColor: 'white',
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

export const ArchitectureDiagram = memo(function ArchitectureDiagram({
  schema,
  content,
  showDebugPanel = false,
}: ArchitectureDiagramProps) {
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
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Generate position string for debugging
  const positionString = nodes
    .filter(n => n.type === 'custom' || n.id === 'db-one')
    .map(n => `${n.id}: x=${Math.round(n.position.x)}, y=${Math.round(n.position.y)}`)
    .join('\n');

  return (
    <div className="w-full">
      <div className="w-full h-[480px] rounded-lg border border-border overflow-hidden bg-background">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          maxZoom={2}
          defaultEdgeOptions={{ type: "smoothstep" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#94a3b8" className="opacity-30" />
          <Controls className="!bg-background !border-border !shadow-sm" showInteractive={false} />
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

        {/* Compact Legend */}
        <div className="absolute bottom-3 left-3 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 shadow-sm">
          <div className="flex items-center gap-3 text-[9px]">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="text-muted-foreground">Source</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#cd7f32" }} />
              <span className="text-muted-foreground">Bronze</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#a8a9ad" }} />
              <span className="text-muted-foreground">Silver</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#c9a227" }} />
              <span className="text-muted-foreground">Gold</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#6366f1" }} />
              <span className="text-muted-foreground">AI</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Consumer</span>
            </div>
          </div>
        </div>
      </div>

      {/* Position Debug Panel (optional) */}
      {showDebugPanel && (
        <div className="mt-4 p-3 bg-muted/50 rounded-lg border border-border">
          <div className="text-xs font-semibold mb-2 text-muted-foreground">Node Positions (drag nodes, then copy-paste):</div>
          <pre className="text-[10px] font-mono bg-background p-2 rounded border border-border overflow-auto max-h-48 select-all">
            {positionString}
          </pre>
        </div>
      )}
    </div>
  );
});

export default ArchitectureDiagram;
