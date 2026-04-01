import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  BackgroundVariant,
  Position,
  MarkerType,
  Handle,
  type NodeProps,
  type NodeTypes,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Map,
  Wand2,
  Bot,
  ClipboardCheck,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Circle,
  Clock,
  ArrowRight,
  Library,
  MessageSquare,
  Rocket,
  Eye,
  RefreshCw,
  Send,
  BookCheck,
  Sparkles,
  Users,
  Settings,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/_sidebar/plan")({
  component: PlanPage,
});

// ---------------------------------------------------------------------------
// Flow diagram — clean architecture overview
// ---------------------------------------------------------------------------

type FlowNodeData = {
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  style?: "default" | "emphasis" | "muted";
};

function FlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const style = data.style || "default";
  const styles = {
    default: "border-border/60 bg-card",
    emphasis: "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/10",
    muted: "border-border/40 bg-muted/30",
  };
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-primary/50 !w-1.5 !h-1.5 !border-0" />
      <div className={`rounded-lg border ${styles[style]} px-5 py-3 shadow-sm min-w-[140px]`}>
        <div className="flex items-center gap-2.5">
          {data.icon}
          <div>
            <p className="text-[13px] font-semibold leading-tight">{data.label}</p>
            {data.sublabel && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{data.sublabel}</p>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary/50 !w-1.5 !h-1.5 !border-0" />
    </>
  );
}

const nodeTypes: NodeTypes = { flowNode: FlowNode };

const edgeStyle = { stroke: "hsl(var(--primary) / 0.25)", strokeWidth: 1.5 };
const edgeMarker = { type: MarkerType.ArrowClosed as const, color: "hsl(var(--primary) / 0.35)", width: 14, height: 14 };

const nodes: Node<FlowNodeData>[] = [
  { id: "sa", type: "flowNode", position: { x: 0, y: 55 }, data: { label: "SA", sublabel: "Context & use case", icon: <Users className="h-4 w-4 text-muted-foreground" />, style: "muted" } },
  { id: "library", type: "flowNode", position: { x: 230, y: 0 }, data: { label: "Skill Library", sublabel: "Vetted blueprints", icon: <Library className="h-4 w-4 text-primary/70" />, style: "default" } },
  { id: "builder", type: "flowNode", position: { x: 230, y: 110 }, data: { label: "Use-Case Generator", sublabel: "AI-drafted spec", icon: <Sparkles className="h-4 w-4 text-primary/70" />, style: "default" } },
  { id: "executor", type: "flowNode", position: { x: 490, y: 55 }, data: { label: "Agent Executor", sublabel: "Phase-by-phase build", icon: <Bot className="h-4 w-4 text-primary" />, style: "emphasis" } },
  { id: "demo", type: "flowNode", position: { x: 730, y: 55 }, data: { label: "Working Demo", sublabel: "On workspace", icon: <Rocket className="h-4 w-4 text-primary/70" />, style: "default" } },
  { id: "review", type: "flowNode", position: { x: 490, y: 175 }, data: { label: "Lead Review", sublabel: "Test & publish", icon: <Eye className="h-4 w-4 text-muted-foreground" />, style: "muted" } },
  { id: "maint", type: "flowNode", position: { x: 230, y: 220 }, data: { label: "AI Maintenance", sublabel: "Drift & updates", icon: <RefreshCw className="h-4 w-4 text-muted-foreground" />, style: "muted" } },
];

const edges: Edge[] = [
  { id: "1", source: "sa", target: "library", style: edgeStyle, markerEnd: edgeMarker },
  { id: "2", source: "sa", target: "builder", style: edgeStyle, markerEnd: edgeMarker },
  { id: "3", source: "library", target: "executor", style: edgeStyle, markerEnd: edgeMarker },
  { id: "4", source: "builder", target: "executor", style: edgeStyle, markerEnd: edgeMarker },
  { id: "5", source: "executor", target: "demo", animated: true, style: { ...edgeStyle, stroke: "hsl(var(--primary) / 0.4)" }, markerEnd: { ...edgeMarker, color: "hsl(var(--primary) / 0.5)" } },
  { id: "6", source: "builder", target: "review", style: { ...edgeStyle, strokeDasharray: "4 4" }, markerEnd: edgeMarker, label: "submit", labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 9, fontWeight: 500 }, labelBgStyle: { fill: "transparent" } },
  { id: "7", source: "review", target: "library", style: { ...edgeStyle, strokeDasharray: "4 4" }, markerEnd: edgeMarker, label: "publish", labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 9, fontWeight: 500 }, labelBgStyle: { fill: "transparent" } },
  { id: "8", source: "maint", target: "library", style: { ...edgeStyle, strokeDasharray: "4 4" }, markerEnd: edgeMarker },
];

function SystemDiagram() {
  return (
    <ReactFlowProvider>
      <div className="h-[340px] w-full rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="opacity-20" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

const milestones = [
  { date: "Mar 27", label: "POC complete", detail: "Basic CUJ tested, app scaffolded.", status: "done" as const },
  { date: "Apr 3", label: "Skill structure", detail: "Define what every skill captures universally.", status: "in-progress" as const },
  { date: "Apr 10", label: "CUJ 1 live", detail: "Prompt construction + demo building working in-app.", status: "upcoming" as const },
  { date: "Apr 17", label: "V1 ship", detail: "End-to-end flow polished and ready for the team.", status: "upcoming" as const },
];

const statusMeta = {
  done: { color: "bg-green-500", text: "text-green-500", badge: "Done" },
  "in-progress": { color: "bg-primary", text: "text-primary", badge: "Now" },
  upcoming: { color: "bg-muted-foreground/30", text: "text-muted-foreground", badge: "" },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function PlanPage() {
  return (
    <div className="space-y-12 pb-12">
      {/* ── Hero ── */}
      <div className="space-y-3 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Proposal
        </p>
        <h1 className="text-4xl font-bold tracking-tight">
          Demo Skill System
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          A platform where SAs build production-quality demos in minutes — powered by
          reusable, AI-maintained skill blueprints that Industry Leads curate and the
          platform keeps fresh.
        </p>
      </div>

      {/* ── Architecture ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">How it works</h2>
          <p className="text-sm text-muted-foreground mt-1">
            An SA provides context, picks or builds a skill, and the agent executor assembles a working demo on the workspace.
          </p>
        </div>
        <SystemDiagram />
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: "Skill Library", desc: "Vetted, reusable blueprints" },
            { label: "Agent Executor", desc: "Phase-by-phase with assertions" },
            { label: "AI Maintenance", desc: "Drift detection & auto-repair" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border/40 bg-card/40 px-3 py-2.5">
              <p className="text-xs font-semibold">{item.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <Separator className="opacity-50" />

      {/* ── User Journeys ── */}
      <section className="space-y-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">User journeys</h2>
          <p className="text-sm text-muted-foreground mt-1">Three roles, three workflows — all connected through the skill spec.</p>
        </div>

        {/* Journey 1 */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Wand2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">SA: Building a Demo</h3>
              <p className="text-xs text-muted-foreground">Two paths — pick a skill or describe something new.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Path A */}
            <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-primary/80 uppercase tracking-wider">Path A</span>
                <Separator className="flex-1 opacity-30" />
                <span className="text-xs text-muted-foreground">Existing skill</span>
              </div>
              {[
                ["Browse the library", "Filter by industry, persona, or use case."],
                ["Provide context", "Customer name, SFDC UCO — anything relevant."],
                ["Launch", "Agent executes phase-by-phase with real state assertions."],
                ["Get the demo", "5–30 min of input. Agent handles the rest."],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-xs font-mono text-muted-foreground/60 mt-0.5 w-4 shrink-0 text-right">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Path B */}
            <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-primary/80 uppercase tracking-wider">Path B</span>
                <Separator className="flex-1 opacity-30" />
                <span className="text-xs text-muted-foreground">Custom build</span>
              </div>
              {[
                ["Describe your use case", "Industry, persona, data, outcomes — or paste your UCO."],
                ["Iterate with Use-Case Generator", "AI asks questions, drafts the full spec."],
                ["Review & launch", "Same execution as Path A, your spec as blueprint."],
                ["Contribute back", "Submit for Industry Lead review → shared library."],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-xs font-mono text-muted-foreground/60 mt-0.5 w-4 shrink-0 text-right">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Journey 2 */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <ClipboardCheck className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Industry Lead: Skill Review</h3>
              <p className="text-xs text-muted-foreground">Gate-keep quality. Feedback is spec edits, not rebuilds.</p>
            </div>
          </div>

          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {[
              ["Check the spec", "Crisp goal, legible, real customer issues"],
              ["Run it", "Note which phases drift or fail"],
              ["Approve / edit", "Feedback as spec changes"],
              ["Publish", "Live in library, you as owner"],
            ].map(([title, desc], i, arr) => (
              <div key={i} className="flex items-center shrink-0">
                <div className="rounded-lg border border-border/40 bg-card/40 px-4 py-3 w-48">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground/30 mx-1 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Journey 3 */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Skill Maintenance</h3>
              <p className="text-xs text-muted-foreground">LLM reviews skills on a cadence, notifies owners of issues.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { trigger: "Platform changes", action: "Edit the spec — demo rebuilds on next run." },
              { trigger: "Drift detected", action: "Failed assertions surface the exact fix." },
              { trigger: "Vertical updates", action: "Edit the reference file — all skills inherit." },
            ].map((item) => (
              <div key={item.trigger} className="rounded-lg border border-border/40 bg-card/40 px-4 py-3">
                <p className="text-sm font-medium">{item.trigger}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{item.action}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            The maintainer's job is <span className="text-foreground font-medium">taste + engagement</span> — keep your context fresh, or the skill gets retired. The platform makes this easy.
          </p>
        </div>
      </section>

      <Separator className="opacity-50" />

      {/* ── Roadmap + Notes side by side ── */}
      <section className="grid gap-8 lg:grid-cols-5">
        {/* Roadmap — wider */}
        <div className="lg:col-span-3 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Roadmap</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Parallel tracks (maintenance, ownership model) not yet scheduled.
            </p>
          </div>

          <div className="space-y-0">
            {milestones.map((m, i) => {
              const meta = statusMeta[m.status];
              return (
                <div key={i} className="flex gap-4">
                  {/* Timeline */}
                  <div className="flex flex-col items-center w-3">
                    <div className={`h-3 w-3 rounded-full ${meta.color} shrink-0 mt-1`} />
                    {i < milestones.length - 1 && <div className="w-px flex-1 bg-border" />}
                  </div>
                  {/* Content */}
                  <div className="pb-6">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{m.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{m.date}</span>
                      {meta.badge && (
                        <Badge variant={m.status === "done" ? "default" : "secondary"} className="text-[10px] h-4 px-1.5">
                          {meta.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{m.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes — narrower */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Open questions</h2>
            <p className="text-sm text-muted-foreground mt-1">Things we need to decide.</p>
          </div>

          <div className="space-y-3">
            {[
              { tag: "Arch", note: "Each session needs a fresh Agent SDK session — no prior context." },
              { tag: "Arch", note: "While-loop to keep LLM iterating until requirements are met." },
              { tag: "TBD", note: "Workspace app (AI Dev Kit style) vs. remote-deploy?" },
              { tag: "Scope", note: "CUJs 1 & 2 ≈ 1 week. CUJ 3 is significantly harder." },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 mt-0.5 shrink-0">{item.tag}</Badge>
                <p className="text-sm text-muted-foreground">{item.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
