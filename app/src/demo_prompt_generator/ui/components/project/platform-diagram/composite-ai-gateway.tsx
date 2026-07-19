/**
 * platform-diagram/composite-ai-gateway — the "Unity AI Gateway" tile.
 *
 * A standard product tile with a ROW of foundation-model logos across the top
 * (OpenAI · Anthropic · Gemini · Grok · Kimi) — conveying "govern + access ANY
 * model" at a glance — and the Unity AI Gateway brand icon + label + editable
 * description below. A composite node kind ("ai-gateway").
 *
 * The logos are `file:vendor/<name>` marks resolved through FileSvgIcon (same
 * mechanism as the Unified Governance bar's compact gateway). They're ALWAYS
 * shown regardless of the trademark-logo toggle — the model marks are integral
 * to the story of the tile.
 */
import { memo, useContext, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

/** Foundation models surfaced through the AI Gateway — shown as a logo row on
 *  top. `file:vendor/<name>` keys (grok + kimi were added to the logo bank). */
const FM_LOGOS: { key: string; label: string }[] = [
  { key: "file:vendor/openai", label: "OpenAI" },
  { key: "file:vendor/anthropic", label: "Anthropic" },
  { key: "file:vendor/gemini", label: "Gemini" },
  { key: "file:vendor/grok", label: "Grok" },
  { key: "file:vendor/kimi", label: "Kimi" },
];

const DEFAULT_DESC = "Security, cost, and rate limits.";

export const AIGatewayBlock = memo(function AIGatewayBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(d.component);
  const AIGateway = DATABRICKS_ICONS.aiGatewayBrand;
  const card = cardStyle(d, { borderColor: `${d.bandColor}66`, radius: 12 });

  // Editable description (double-click), mirroring the plain-tile / medallion UX.
  const desc = d.component.desc ?? DEFAULT_DESC;
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const commitDesc = () => {
    if (editingDesc !== null) { d.onSetDescription?.(d.nodeId, editingDesc.trim()); setEditingDesc(null); }
  };

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
      stackRadius={12}
      stackBorderColor={card.style.borderColor as string | undefined}
      onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
    >
      <div
        onClick={() => d.onSelect(d.nodeId)}
        className={`flex h-full w-full flex-col overflow-hidden rounded-[12px] transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
        style={card.style}
      >
        <div className="flex h-full w-full flex-col gap-1.5 px-3 py-2" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "top left" }}>
          {/* Foundation-model logo row — the "access any model" cue. A subtle
              divider separates it from the gateway body below. */}
          <div className="flex items-center justify-center gap-2 border-b border-border/60 pb-1.5">
            {FM_LOGOS.map((m) => (
              <FileSvgIcon key={m.key} iconKey={m.key} className="h-5 w-5 shrink-0" />
            ))}
          </div>
          {/* Gateway body: brand icon + label, then the editable description. */}
          <div className="flex min-h-0 flex-1 items-center gap-2">
            <AIGateway className="h-6 w-6 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[13px] font-semibold text-foreground">{d.component.label}</span>
              {editingDesc !== null ? (
                <input
                  autoFocus
                  value={editingDesc}
                  onChange={(e) => setEditingDesc(e.target.value)}
                  onBlur={commitDesc}
                  onKeyDown={(e) => { if (e.key === "Enter") commitDesc(); else if (e.key === "Escape") setEditingDesc(null); e.stopPropagation(); }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Description"
                  className="mt-0.5 w-full min-w-0 bg-transparent text-[9.5px] font-normal leading-tight text-muted-foreground outline-none"
                />
              ) : (
                <span
                  className="mt-0.5 block truncate text-[9.5px] font-normal leading-tight text-muted-foreground"
                  title="Double-click to edit description"
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingDesc(desc === DEFAULT_DESC ? "" : desc); }}
                >
                  {desc}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
