/**
 * platform-diagram/composite-genie-code — the "Built with Genie Code" strip.
 *
 * Tells the full flow as a looping sequence (one shared ~9s timeline):
 *   1. the user's request TYPES out in a terminal prompt,
 *   2. the agent "thinks" (a generating… indicator with pulsing dots),
 *   3. the agent builds the result: a dashboard artifact reveals on the right,
 *      its KPI row then its chart lighting up in sequence,
 *   4. hold, then reset and loop.
 * A composite node kind ("genie-code").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { RotatableCard, baseSize, DropTargetContext, type NodeData } from "./shared";

const PROMPT_TEXT = "Ingest my data and create a dashboard...";

// One shared loop. Phase boundaries (as % of 9s): type 0–30%, think 30–46%,
// build 46–78% (artifact in, then 3 stages stagger), hold 78–100%.
const KEYFRAMES = `
@keyframes gc-type {            /* width 0→full during the type phase, hold */
  0% { width: 0 } 28% { width: 100% } 100% { width: 100% }
}
@keyframes gc-caret {           /* blink while typing, hide once thinking */
  0%,28% { opacity: 1 } 14% { opacity: 0 } 30%,100% { opacity: 0 }
}
@keyframes gc-think {           /* "generating…" visible only mid-sequence */
  0%,30% { opacity: 0 } 34%,46% { opacity: 1 } 50%,100% { opacity: 0 }
}
@keyframes gc-think-dot {       /* dots pulse during think phase */
  0%,30% { opacity: .25 } 38% { opacity: 1 } 46%,100% { opacity: .25 }
}
@keyframes gc-artifact {        /* artifact fades+rises in at build start */
  0%,44% { opacity: 0; transform: translateY(4px) scale(.96) }
  52%,100% { opacity: 1; transform: none }
}
@keyframes gc-flow {            /* the connector dot travels once per loop */
  0%,30% { opacity: 0 } 34% { opacity: 1; left: 0 } 48% { opacity: 1; left: 100% } 52%,100% { opacity: 0 }
}
/* three stage keyframes, staggered IN the timeline (not via animation-delay,
   which would desync them from the shared loop) */
@keyframes gc-stage0 { 0%,52% { opacity:.15; transform:scale(.8) } 58%,100% { opacity:1; transform:none } }
@keyframes gc-stage1 { 0%,58% { opacity:.15; transform:scale(.8) } 64%,100% { opacity:1; transform:none } }
@keyframes gc-stage2 { 0%,64% { opacity:.15; transform:scale(.8) } 70%,100% { opacity:1; transform:none } }
`;

export const GenieCodeBlock = memo(function GenieCodeBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const nat = baseSize(d.component);
  const GenieCode = DATABRICKS_ICONS.genieCodeBrand;
  const LOOP = "9s";
  return (
    <RotatableCard
      rot={d.rot}
      w={d.w ?? nat.w}
      h={d.h ?? nat.h}
      scale={d.scale ?? 1}
      editMode={d.editMode}
      selected={!!selected}
      forceDots={isDropTarget}
      onResize={(w, h) => d.onResize(d.nodeId, w, h)}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <style>{KEYFRAMES}</style>
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow ${
          selected ? "ring-2 ring-primary/60 shadow-md" : "hover:shadow-md"
        }`}
        style={{ borderColor: `${d.bandColor}66` }}
      >
        <div className="flex h-full w-full flex-col gap-1.5 p-2.5" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* header */}
          <div className="flex items-center gap-1.5">
            <GenieCode className="h-5 w-5 shrink-0" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[12px] font-bold text-foreground">{d.component.label || "Built with Genie Code"}</span>
              <span className="truncate text-[8.5px] text-muted-foreground">Describe it — Genie Code ingests the data and builds the dashboard.</span>
            </span>
          </div>

          {/* stage: prompt (+ think) → flow → built artifact */}
          <div className="flex flex-1 items-stretch gap-2">
            {/* LEFT: terminal prompt that types out, then a "generating…" beat */}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[9px]">
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-[#EF5B3F]">$</span>
                <span className="relative inline-block overflow-hidden whitespace-nowrap text-foreground" style={{ animation: `gc-type ${LOOP} steps(40) infinite` }}>
                  {PROMPT_TEXT}
                </span>
                <span className="ml-[1px] inline-block h-[10px] w-[5px] shrink-0 bg-[#EF5B3F]" style={{ animation: `gc-caret ${LOOP} steps(1) infinite` }} />
              </div>
              {/* "generating…" — the agent thinking */}
              <div className="flex items-center gap-1 text-[8px] text-[#EF5B3F]" style={{ animation: `gc-think ${LOOP} ease-in-out infinite` }}>
                <GenieCode className="h-2.5 w-2.5" />
                <span>generating</span>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1 w-1 rounded-full bg-[#EF5B3F]" style={{ animation: `gc-think-dot ${LOOP} ease-in-out infinite`, animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>

            {/* connector with a dot that travels once the agent starts building */}
            <div className="relative flex w-7 shrink-0 items-center">
              <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-muted-foreground/25" />
              <span className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#EF5B3F]" style={{ left: 0, animation: `gc-flow ${LOOP} ease-in-out infinite` }} />
            </div>

            {/* RIGHT: the built dashboard artifact (reveals during build) —
                the prompt asks to ingest + create a dashboard, so the agent's
                output is a little AI/BI dashboard. */}
            <div className="flex w-[46%] shrink-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background/70" style={{ animation: `gc-artifact ${LOOP} ease-out infinite` }}>
              <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1">
                {(() => { const I = DATABRICKS_ICONS.aibiBrand; return <I className="h-3 w-3 shrink-0" />; })()}
                <span className="truncate font-mono text-[8.5px] text-foreground">dashboard</span>
                <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[7px] font-bold uppercase text-emerald-600">ready</span>
              </div>
              {/* a KPI row + a mini bar chart, revealed stage by stage */}
              <div className="flex flex-1 flex-col gap-1 p-1.5">
                <div className="flex gap-1" style={{ animation: `gc-stage0 ${LOOP} ease-out infinite` }}>
                  {["#094074", "#3C6997", "#FE9000"].map((c, i) => (
                    <span key={i} className="flex-1 rounded-sm px-1 py-0.5" style={{ background: `${c}1f` }}>
                      <span className="block h-0.5 w-2/3 rounded-full" style={{ background: c }} />
                      <span className="mt-0.5 block h-1 w-full rounded-full" style={{ background: `${c}66` }} />
                    </span>
                  ))}
                </div>
                <div className="flex flex-1 items-end gap-0.5 rounded-sm bg-muted/40 px-1 py-0.5" style={{ animation: `gc-stage1 ${LOOP} ease-out infinite` }}>
                  {[40, 70, 55, 90, 65, 80].map((h, i) => (
                    <span key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%`, background: i % 2 ? "#3C6997" : "#FE9000" }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
