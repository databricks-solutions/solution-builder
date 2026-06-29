/**
 * platform-diagram/menus/context-menu — the floating right-click menu for a
 * node (rotate / scale / change-type / style / z-order / remove) or an edge
 * (flow toggle, flow style, routing shape, label, delete). Includes the
 * annotation-specific sub-menu and the shared per-node style controls.
 */
import { memo } from "react";
import { type Edge } from "@xyflow/react";
import { type AnnotationData } from "@/lib/platform-architecture";
import { type FlowStyle, type StylePatch, type EdgeData } from "../shared";
import { FlowStylePreview } from "../edges/edge-flow";
import {
  Zap,
  Trash2,
  Check,
  RotateCw,
  Minus,
  Spline,
  MoveRight,
  CornerDownRight,
  Scaling,
  Replace,
  Type,
  Shapes,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  BringToFront,
  SendToBack,
  Wand2,
  Tag,
  Copy,
} from "lucide-react";

export type CtxMenu =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | null;

type MenuItemFn = (p: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) => React.ReactElement;

/** The right-click menu body for a free-form annotation node — varies by
 *  variant (text/box: font + border + alignment; logo: pick; image: set URL). */
function AnnotationMenu({
  a, Item, onAnno, onPickLogo, onSetImageUrl, onRotate, onRemove,
}: {
  a: AnnotationData;
  Item: MenuItemFn;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onSetImageUrl: () => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  const isTextual = a.variant === "text" || a.variant === "box";
  const fontSize = a.fontSize ?? 14;
  const hAlign = a.hAlign ?? "center";
  return (
    <>
      {a.variant === "logo" && <Item icon={<Shapes className="h-3.5 w-3.5" />} label="Pick logo…" onClick={onPickLogo} />}
      {a.variant === "image" && <Item icon={<ImageIcon className="h-3.5 w-3.5" />} label="Set image URL…" onClick={onSetImageUrl} />}
      {isTextual && (
        <>
          {/* Font size */}
          <div className="px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Type className="h-3.5 w-3.5" /> Font</span>
              <span>{fontSize}px</span>
            </div>
            <input type="range" min={9} max={48} step={1} value={fontSize}
              onChange={(e) => onAnno({ fontSize: Number(e.target.value) })}
              onClick={(e) => e.stopPropagation()} className="h-1.5 w-full cursor-pointer accent-primary" />
          </div>
          {/* Horizontal text alignment */}
          <div className="flex items-center gap-1 px-2 py-1.5">
            <span className="mr-auto text-[11px] text-muted-foreground">Align</span>
            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([al, Ico]) => (
              <button key={al} type="button" onClick={() => onAnno({ hAlign: al })}
                className={`grid h-6 w-6 cursor-pointer place-items-center rounded ${hAlign === al ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                <Ico className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          {a.variant === "box" && (
            <div className="flex items-center gap-1 px-2 py-1.5">
              <span className="mr-auto text-[11px] text-muted-foreground">Position</span>
              {(["top", "middle", "bottom"] as const).map((v) => (
                <button key={v} type="button" onClick={() => onAnno({ vAlign: v })}
                  className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] capitalize ${(a.vAlign ?? "middle") === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                  {v[0]}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="my-1 border-t border-border/60" />
      <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} />
      <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove" onClick={onRemove} />
    </>
  );
}

/** Opacity / fill-color / font-color controls shared by single + multi-select.
 *  A color swatch with a reset (×) that clears the override (back to default). */
function StyleControls({
  style,
  onStyle,
}: {
  style?: StylePatch;
  onStyle: (patch: StylePatch) => void;
}) {
  const opacityPct = Math.round((style?.opacity ?? 1) * 100);
  const isTransparent = style?.fillColor === "transparent";
  // Default fonts to the theme's dark foreground so the picker shows it.
  const DEFAULT_FONT = "#1e293b";
  const borderW = style?.borderWidth ?? 1;
  const borderStyle = style?.borderStyle ?? "solid";
  const radius = style?.borderRadius ?? 12;
  const shadow = style?.shadow ?? true;
  return (
    <>
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Opacity</span><span>{opacityPct}%</span>
        </div>
        <input
          type="range" min={10} max={100} step={5} value={opacityPct}
          onChange={(e) => onStyle({ opacity: Number(e.target.value) / 100 })}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
      </div>
      {/* Fill: color swatch + a "transparent" toggle. */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="mr-auto text-[11px] text-muted-foreground">Fill</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStyle({ fillColor: "transparent" }); }}
          className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${isTransparent ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          title="Transparent fill"
        >
          None
        </button>
        <input
          type="color"
          value={isTransparent || !style?.fillColor ? "#ffffff" : style.fillColor}
          onChange={(e) => onStyle({ fillColor: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent p-0"
          title="Fill color"
        />
      </div>
      {/* Text color. */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="mr-auto text-[11px] text-muted-foreground">Text color</span>
        <input
          type="color"
          value={style?.fontColor || DEFAULT_FONT}
          onChange={(e) => onStyle({ fontColor: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent p-0"
          title="Text color"
        />
      </div>
      {/* Border: width slider, solid/dashed toggle, color. */}
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Border</span><span>{borderW}px</span>
        </div>
        <input
          type="range" min={0} max={6} step={1} value={borderW}
          onChange={(e) => onStyle({ borderWidth: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStyle({ borderStyle: "solid" }); }}
            className={`flex-1 cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${borderStyle === "solid" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          >
            Solid
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStyle({ borderStyle: "dashed" }); }}
            className={`flex-1 cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${borderStyle === "dashed" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          >
            Dashed
          </button>
          <input
            type="color"
            value={style?.borderColor || "#94a3b8"}
            onChange={(e) => onStyle({ borderColor: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            title="Border color"
          />
        </div>
      </div>
      {/* Corner radius. */}
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Corners</span><span>{radius}px</span>
        </div>
        <input
          type="range" min={0} max={28} step={2} value={radius}
          onChange={(e) => onStyle({ borderRadius: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
      </div>
      {/* Drop shadow toggle. */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="mr-auto text-[11px] text-muted-foreground">Shadow</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStyle({ shadow: !shadow }); }}
          className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${shadow ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          title="Toggle the box drop shadow"
        >
          {shadow ? "On" : "Off"}
        </button>
      </div>
    </>
  );
}

/** Floating right-click menu for a node (rotate/remove) or an edge
 *  (toggle flow, dashed, routing shape, delete). */
export const ContextMenu = memo(function ContextMenu({
  menu,
  edge,
  nodeScale = 1,
  annotation,
  onClose,
  onRotate,
  onRemoveNode,
  onChangeType,
  onSetScale,
  onToggleFlow,
  onToggleDashed,
  onSetShape,
  onSetFlowStyle,
  onSetEdgeLabel,
  onRemoveEdge,
  onAnno,
  onPickLogo,
  onSetImageUrl,
  style,
  selectionCount = 1,
  onStyle,
  onCopyStyle,
  onZ,
}: {
  menu: NonNullable<CtxMenu>;
  edge?: Edge;
  nodeScale?: number;
  /** Present when the right-clicked node is a free-form annotation. */
  annotation?: AnnotationData;
  onClose: () => void;
  onRotate: () => void;
  onRemoveNode: () => void;
  onChangeType: () => void;
  onSetScale: (s: number) => void;
  onToggleFlow: () => void;
  onToggleDashed: () => void;
  onSetShape: (s: "smooth" | "straight" | "step") => void;
  onSetFlowStyle: (s: FlowStyle | undefined) => void;
  /** Set (or clear, with "") the edge's mid-line label. */
  onSetEdgeLabel: (label: string) => void;
  onRemoveEdge: () => void;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onSetImageUrl: () => void;
  /** Current style of the right-clicked node (for the controls' values). */
  style?: StylePatch;
  /** How many nodes the style controls will affect (>1 → multi-select). */
  selectionCount?: number;
  onStyle: (patch: StylePatch) => void;
  /** Copy this node's style, then paste it onto others by clicking them. */
  onCopyStyle: () => void;
  onZ: (dir: "front" | "back") => void;
}) {
  const ed = edge?.data as EdgeData | undefined;
  const Item = ({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-muted ${active ? "text-primary" : "text-foreground"}`}
    >
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {label}
      {active && <Check className="ml-auto h-3.5 w-3.5" />}
    </button>
  );
  const ZItems = (
    <>
      <Item icon={<BringToFront className="h-3.5 w-3.5" />} label="Bring to front" onClick={() => onZ("front")} />
      <Item icon={<SendToBack className="h-3.5 w-3.5" />} label="Send to back" onClick={() => onZ("back")} />
    </>
  );
  // Flip the menu so it's always fully visible: open LEFT when the click is in
  // the right portion of the viewport, and open UP when it's in the bottom
  // portion. Anchoring with right/bottom (instead of left/top) keeps the menu
  // pinned to the click point as it grows the other way.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const flipX = menu.x > vw * 0.65; // right portion → open leftward
  const flipY = menu.y > vh * 0.55; // bottom portion → open upward
  const pos: React.CSSProperties = {
    ...(flipX ? { right: vw - menu.x } : { left: menu.x }),
    ...(flipY ? { bottom: vh - menu.y } : { top: menu.y }),
  };
  return (
    <>
      {/* click-away catcher */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 max-h-[85vh] w-52 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        style={pos}
      >
        {menu.kind === "node" && selectionCount > 1 ? (
          /* MULTI-SELECT: only the options common to ALL selected nodes — the
             style controls. They apply to every selected node at once; nodes a
             given option doesn't fit just ignore it. */
          <>
            <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">{selectionCount} selected</div>
            <StyleControls style={style} onStyle={onStyle} />
            <div className="my-1 border-t border-border/60" />
            {ZItems}
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove all" onClick={onRemoveNode} />
          </>
        ) : menu.kind === "node" && annotation ? (
          <>
            <AnnotationMenu a={annotation} Item={Item} onAnno={onAnno} onPickLogo={onPickLogo} onSetImageUrl={onSetImageUrl} onRotate={onRotate} onRemove={onRemoveNode} />
            <div className="my-1 border-t border-border/60" />
            <StyleControls style={style} onStyle={onStyle} />
            <Item icon={<Copy className="h-3.5 w-3.5" />} label="Copy style" onClick={onCopyStyle} />
            <div className="my-1 border-t border-border/60" />
            {ZItems}
          </>
        ) : menu.kind === "node" ? (
          <>
            <Item icon={<Replace className="h-3.5 w-3.5" />} label="Change type…" onClick={onChangeType} />
            <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} />
            {/* Content scale slider — shrink/grow the icon+label inside the box
                (the box itself is unchanged; content is cropped if too big). */}
            <div className="px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><Scaling className="h-3.5 w-3.5" /> Scale</span>
                <span>{Math.round(nodeScale * 100)}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={Math.round(nodeScale * 100)}
                onChange={(e) => onSetScale(Number(e.target.value) / 100)}
                onClick={(e) => e.stopPropagation()}
                className="h-1.5 w-full cursor-pointer accent-primary"
              />
            </div>
            <div className="my-1 border-t border-border/60" />
            <StyleControls style={style} onStyle={onStyle} />
            <Item icon={<Copy className="h-3.5 w-3.5" />} label="Copy style" onClick={onCopyStyle} />
            <div className="my-1 border-t border-border/60" />
            {ZItems}
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove" onClick={onRemoveNode} />
          </>
        ) : (
          <>
            <Item icon={<Zap className="h-3.5 w-3.5" />} label="Data flow" onClick={onToggleFlow} active={!!ed?.animated} />
            <Item icon={<Minus className="h-3.5 w-3.5" />} label="Dashed line" onClick={onToggleDashed} active={!!ed?.dashed} />
            <div className="my-1 border-t border-border/60" />
            <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Flow style</div>
            <Item icon={<Wand2 className="h-3.5 w-3.5" />} label="Auto (by source)" onClick={() => onSetFlowStyle(undefined)} active={ed?.flowStyle == null} />
            {(["laser", "particles", "docs", "dot"] as const).map((fs) => (
              <button
                key={fs}
                type="button"
                onClick={() => onSetFlowStyle(fs)}
                title={fs}
                className={`flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-muted ${ed?.flowStyle === fs ? "bg-muted" : ""}`}
              >
                <span className="min-w-0 flex-1"><FlowStylePreview style={fs} /></span>
                {ed?.flowStyle === fs && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))}
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Spline className="h-3.5 w-3.5" />} label="Smooth" onClick={() => onSetShape("smooth")} active={(ed?.shape ?? "smooth") === "smooth"} />
            <Item icon={<MoveRight className="h-3.5 w-3.5" />} label="Straight" onClick={() => onSetShape("straight")} active={ed?.shape === "straight"} />
            <Item icon={<CornerDownRight className="h-3.5 w-3.5" />} label="Step" onClick={() => onSetShape("step")} active={ed?.shape === "step"} />
            <div className="my-1 border-t border-border/60" />
            <Item
              icon={<Tag className="h-3.5 w-3.5" />}
              label={typeof edge?.label === "string" && edge.label ? "Edit label…" : "Add label…"}
              onClick={() => {
                const next = window.prompt("Line label (leave empty to remove):", typeof edge?.label === "string" ? edge.label : "");
                if (next !== null) onSetEdgeLabel(next.trim());
              }}
              active={typeof edge?.label === "string" && !!edge.label}
            />
            <div className="my-1 border-t border-border/60" />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete line" onClick={onRemoveEdge} />
          </>
        )}
      </div>
    </>
  );
});
