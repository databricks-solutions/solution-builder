/**
 * platform-diagram/composite-genie-code — the "Built with Genie Code" strip.
 *
 * A JS-driven looping demo of the full flow (so the typing is per-character /
 * realistic and the build steps sequence properly):
 *   1. the request TYPES out character by character (wrapping naturally),
 *   2. the agent "thinks" (generating… with pulsing dots),
 *   3. the agent BUILDS — a pipeline.sql appears (Bronze→Silver→Gold), then a
 *      dashboard renders (KPIs + chart + donut),
 *   4. hold, then reset and loop.
 * A composite node kind ("genie-code").
 */
import { memo, useContext, useEffect, useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";
import { MEDALLION } from "./composite-lakeflow";

const PROMPT_TEXT = "Ingest my data and create a dashboard...";

// Phase timeline (ms). The loop runs type → think → pipeline → dashboard → hold.
const T = {
  charMs: 55,                 // per-character typing speed
  thinkMs: 1200,              // "generating…" beat after typing
  pipelineMs: 1400,           // pipeline reveal + stages
  dashMs: 1800,               // dashboard reveal
  holdMs: 1600,               // hold the finished state
};
type Phase = "typing" | "think" | "pipeline" | "dashboard" | "hold";

function useGenieSequence() {
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    const push = (fn: () => void, ms: number) => { timers.current.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };

    const run = () => {
      // reset
      setPhase("typing");
      setTyped(0);
      // type each char
      for (let i = 1; i <= PROMPT_TEXT.length; i++) push(() => setTyped(i), i * T.charMs);
      const typeDone = PROMPT_TEXT.length * T.charMs;
      push(() => setPhase("think"), typeDone);
      push(() => setPhase("pipeline"), typeDone + T.thinkMs);
      push(() => setPhase("dashboard"), typeDone + T.thinkMs + T.pipelineMs);
      push(() => setPhase("hold"), typeDone + T.thinkMs + T.pipelineMs + T.dashMs);
      push(() => run(), typeDone + T.thinkMs + T.pipelineMs + T.dashMs + T.holdMs);
    };
    run();
    return () => { cancelled = true; timers.current.forEach(clearTimeout); timers.current = []; };
  }, []);

  const built = phase === "pipeline" || phase === "dashboard" || phase === "hold";
  const showDash = phase === "dashboard" || phase === "hold";
  return { typed, phase, built, showDash };
}

export const GenieCodeBlock = memo(function GenieCodeBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 16 });

  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      baseW={nat.w}
      baseH={nat.h}
      editMode={editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h, center) => d.onResize(d.nodeId, w, h, undefined, center)}
      onScale={(w) => d.onResize(d.nodeId, w, Math.round((w * nat.h) / nat.w), w / nat.w)}
      stack={d.stack}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full flex-col p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          <GenieCodeBody d={d} />
        </div>
      </div>
    </RotatableCard>
  );
});

/** The Genie Code inner content (header + typing terminal + the pipeline →
 *  dashboard build animation), WITHOUT the card chrome — so it can render
 *  standalone or stacked below Lakeflow in the combined block. Owns its own
 *  looping sequence + keyframes. */
export function GenieCodeBody({ d }: { d: NodeData }) {
  const GenieCode = DATABRICKS_ICONS.genieCodeBrand;
  const { typed, phase, built, showDash } = useGenieSequence();
  const typing = phase === "typing";
  return (
    <div className="flex h-full w-full flex-col gap-1.5">
      <style>{`
        @keyframes gc-caret { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes gc-dot { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
        @keyframes gc-in { from { opacity: 0; transform: translateY(3px) scale(.97) } to { opacity: 1; transform: none } }
      `}</style>
      {/* header */}
      <div className="flex items-center gap-1.5">
        <GenieCode className="h-5 w-5 shrink-0" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[12px] font-bold text-foreground">{d.component.label || "Built with Genie Code"}</span>
          <span className="truncate text-[8.5px] text-muted-foreground">Tell genie what to do, it'll build it for you and maintain it</span>
        </span>
        {/* ZeroOps wordmark, top-right */}
        <FileSvgIcon iconKey="file:vendor/zeroops" className="ml-auto h-3.5 w-auto shrink-0" />
      </div>

      {/* stage: prompt (+ think) → built artifacts */}
      <div className="flex flex-1 items-stretch gap-2">
        {/* LEFT: terminal — types per character, then "generating…" */}
        <div className="flex w-[46%] shrink-0 flex-col gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[9px]">
          <div className="flex flex-1 items-start gap-1">
            <span className="shrink-0 text-[#EF5B3F]">$</span>
            <span className="whitespace-pre-wrap break-words text-foreground">
              {PROMPT_TEXT.slice(0, typed)}
              {typing && <span className="ml-[1px] inline-block h-[9px] w-[5px] translate-y-[1px] bg-[#EF5B3F]" style={{ animation: "gc-caret 1s steps(1) infinite" }} />}
            </span>
          </div>
          {phase === "think" && (
            <div className="flex items-center gap-1 text-[8px] text-[#EF5B3F]">
              <GenieCode className="h-2.5 w-2.5" />
              <span>generating</span>
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1 w-1 rounded-full bg-[#EF5B3F]" style={{ animation: "gc-dot 1s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
        </div>

        {/* connector */}
        <div className="relative flex w-5 shrink-0 items-center">
          <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-muted-foreground/25" />
          {(phase === "pipeline" || phase === "think") && (
            <span className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#EF5B3F]" style={{ animation: "gc-dot 1.2s ease-in-out infinite" }} />
          )}
        </div>

        {/* RIGHT: built artifacts — pipeline first, then dashboard */}
        <div className="flex min-w-0 flex-1 items-stretch">
          {!built && (
            <div className="grid w-full place-items-center rounded-md border border-dashed border-border/50 text-[8px] text-muted-foreground/60">…</div>
          )}
          {built && !showDash && <MiniPipeline />}
          {showDash && <MiniDashboard />}
        </div>
      </div>
    </div>
  );
}

/** The pipeline.sql artifact (Bronze → Silver → Gold), shown mid-build. */
function MiniPipeline() {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background/70" style={{ animation: "gc-in .3s ease-out both" }}>
      <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1">
        {(() => { const I = DATABRICKS_ICONS.jobsPipelines; return <I className="h-3 w-3 shrink-0 text-muted-foreground" />; })()}
        <span className="truncate font-mono text-[8.5px] text-foreground">pipeline.sql</span>
        <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[7px] font-bold uppercase text-emerald-600">built</span>
      </div>
      <div className="flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5">
        {MEDALLION.map((m, i) => (
          <span key={m.label} className="flex items-center gap-1">
            {i > 0 && <span className="text-[9px] text-muted-foreground/50">→</span>}
            <span className="flex items-center gap-0.5" style={{ animation: "gc-in .3s ease-out both", animationDelay: `${i * 0.12}s` }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
              <span className="text-[7.5px] font-semibold" style={{ color: m.color }}>{m.label}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The finished dashboard artifact — a compact bar chart + donut (no header /
 *  KPI counters, kept short). */
function MiniDashboard() {
  const BARS = [42, 70, 55, 88, 64, 80, 73];
  return (
    <div className="flex w-full items-stretch gap-1 overflow-hidden rounded-md border border-border/60 bg-background/70 p-1.5" style={{ animation: "gc-in .35s ease-out both" }}>
      <div className="flex flex-[2] items-end justify-center gap-[3px] rounded-sm bg-muted/40 px-1 py-1" style={{ animation: "gc-in .3s ease-out both", animationDelay: ".12s" }}>
        {BARS.map((h, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-t-sm" style={{ height: `${h}%`, background: i % 2 ? "#3C6997" : "#FE9000" }} />
        ))}
      </div>
      <div className="grid flex-1 place-items-center rounded-sm bg-muted/40 px-1" style={{ animation: "gc-in .3s ease-out both", animationDelay: ".2s" }}>
        <span
          className="h-5 w-5 rounded-full"
          style={{ background: "conic-gradient(#094074 0 45%, #3C6997 45% 72%, #FE9000 72% 100%)", WebkitMask: "radial-gradient(circle 4px at center, transparent 99%, #000 100%)", mask: "radial-gradient(circle 4px at center, transparent 99%, #000 100%)" }}
        />
      </div>
    </div>
  );
}
