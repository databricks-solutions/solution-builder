/**
 * platform-diagram/panels/edit-panel — the persistent right-side edit panel
 * shown (in edit mode) whenever one or more NODES are selected. It replaces the
 * floating node context menu: selection alone drives it. Edges keep their own
 * floating context menu (menus/context-menu.tsx).
 *
 * The body varies by selection:
 *   • multi-select (2+)   → shared style controls + Group/Ungroup + z-order + Remove all
 *   • single annotation   → annotation controls + style controls + z-order
 *   • single group / Agent Bricks → Ungroup + the single-node controls
 *   • single plain node   → Change type / Rotate / Scale / style / z-order / Remove
 *
 * All the style + annotation controls are the SAME components used by the edge
 * context menu (panels/style-controls), so there's one source of truth.
 */
import { memo } from "react";
import { type AnnotationData, type ComponentOption } from "@/lib/platform-architecture";
import { type StylePatch } from "../shared";
import { StyleControls, AnnotationMenu, type MenuItemFn } from "./style-controls";
import {
  X,
  Trash2,
  Check,
  RotateCw,
  Scaling,
  Layers,
  Replace,
  BringToFront,
  SendToBack,
  Copy,
  Group,
  Ungroup,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Type,
} from "lucide-react";

export const EditPanel = memo(function EditPanel({
  selectionCount,
  annotation,
  nodeScale = 1,
  nodeStack = 1,
  onSetStack,
  style,
  isGroup = false,
  canGroup = false,
  isAgentBricks = false,
  sourceCaption,
  onSetSourceCaption,
  sourceFontSize,
  onSetSourceFontSize,
  showDescription,
  onSetShowDescription,
  options,
  params,
  onSetParam,
  nodeTitle,
  onSetTitle,
  onClose,
  onRotate,
  onRemove,
  onChangeType,
  onSetScale,
  onAnno,
  onPickLogo,
  onStyle,
  onCopyStyle,
  onGroup,
  onUngroup,
  onZ,
}: {
  /** How many nodes are selected (>1 → multi-select layout). */
  selectionCount: number;
  /** Present when the (single) selected node is a free-form annotation. */
  annotation?: AnnotationData;
  nodeScale?: number;
  /** Stack count (N cards) for the single selection; 1 = single. Setter writes it. */
  nodeStack?: number;
  onSetStack?: (n: number) => void;
  /** Current style of the selection (single node, or the first when multi). */
  style?: StylePatch;
  /** Selection belongs to a group → offer Ungroup. */
  isGroup?: boolean;
  /** Selection (2+) can be grouped → offer Group. */
  canGroup?: boolean;
  /** Selection is a single Agent Bricks composite → Ungroup explodes it. */
  isAgentBricks?: boolean;
  /** Set when the single selected node is a data SOURCE tile → show the
   *  label-position control. The current placement (right default). */
  sourceCaption?: "right" | "left" | "top" | "bottom";
  onSetSourceCaption?: (pos: "right" | "left" | "top" | "bottom") => void;
  /** Source label font size (px) + its setter — shown alongside Text position. */
  sourceFontSize?: number;
  onSetSourceFontSize?: (px: number) => void;
  /** Description-line toggle — set when the single selection is a source, logo,
   *  or product tile. `showDescription` is the resolved on/off state; the setter
   *  writes an explicit true/false. Undefined → no toggle for this selection. */
  showDescription?: boolean;
  onSetShowDescription?: (show: boolean) => void;
  /** Toggleable component options (checkboxes). Set when the single selection is
   *  a component that declares `options`. `params` is the node's current values;
   *  `onSetParam` writes one key. */
  options?: ComponentOption[];
  params?: Record<string, boolean>;
  onSetParam?: (key: string, value: boolean) => void;
  /** Editable block title (composites like the medallion table). `nodeTitle` is
   *  the current text (or its default placeholder); `onSetTitle` renames it. */
  nodeTitle?: string;
  onSetTitle?: (title: string) => void;
  onClose: () => void;
  onRotate: () => void;
  onRemove: () => void;
  onChangeType: () => void;
  onSetScale: (s: number) => void;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onStyle: (patch: StylePatch) => void;
  onCopyStyle: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onZ: (dir: "front" | "back") => void;
}) {
  const Item: MenuItemFn = ({ icon, label, onClick, active, hint }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-muted ${active ? "text-primary" : "text-foreground"}`}
    >
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {label}
      {active && <Check className="ml-auto h-3.5 w-3.5" />}
      {!active && hint && <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground/70">{hint}</span>}
    </button>
  );
  const ZItems = (
    <>
      <Item icon={<BringToFront className="h-3.5 w-3.5" />} label="Bring to front" onClick={() => onZ("front")} hint="⌘⇧↑" />
      <Item icon={<SendToBack className="h-3.5 w-3.5" />} label="Send to back" onClick={() => onZ("back")} hint="⌘⇧↓" />
    </>
  );
  const Divider = () => <div className="my-1 border-t border-border/60" />;

  // "Show description" toggle — a checkable Item, shown for source / logo /
  // product-tile single selection. Editing the text itself is inline (double-
  // click the node), so the panel only owns the visibility toggle.
  const DescToggle =
    onSetShowDescription !== undefined ? (
      <Item
        icon={<Type className="h-3.5 w-3.5" />}
        label="Show description"
        onClick={() => onSetShowDescription(!showDescription)}
        active={!!showDescription}
      />
    ) : null;

  const title =
    selectionCount > 1
      ? `${selectionCount} selected`
      : annotation
        ? "Annotation"
        : "Element";

  return (
    <div className="flex h-full w-[240px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="text-[12.5px] font-semibold text-foreground">{title}</div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Clear selection (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {selectionCount > 1 ? (
          /* MULTI-SELECT: only options common to ALL selected nodes — the style
             controls. They apply to every selected node at once. */
          <>
            {(canGroup || isGroup) && (
              <>
                {canGroup && <Item icon={<Group className="h-3.5 w-3.5" />} label="Group" onClick={onGroup} hint="⌘G" />}
                {isGroup && <Item icon={<Ungroup className="h-3.5 w-3.5" />} label="Ungroup" onClick={onUngroup} hint="⇧⌘G" />}
                <Divider />
              </>
            )}
            <StyleControls style={style} onStyle={onStyle} />
            <Item icon={<Copy className="h-3.5 w-3.5" />} label="Copy style" onClick={onCopyStyle} />
            <Divider />
            {ZItems}
            <Divider />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove all" onClick={onRemove} hint="⌫" />
          </>
        ) : annotation ? (
          <>
            <AnnotationMenu a={annotation} Item={Item} onAnno={onAnno} onPickLogo={onPickLogo} onRotate={onRotate} onRemove={onRemove} />
            {DescToggle}
            <Divider />
            <StyleControls style={style} onStyle={onStyle} showIconColor={annotation.variant === "logo"} noBoxDefaults={annotation.variant === "logo"} />
            <Item icon={<Copy className="h-3.5 w-3.5" />} label="Copy style" onClick={onCopyStyle} />
            <Divider />
            {ZItems}
          </>
        ) : (
          <>
            <Item icon={<Replace className="h-3.5 w-3.5" />} label="Change type…" onClick={onChangeType} />
            {(isGroup || isAgentBricks) && <Item icon={<Ungroup className="h-3.5 w-3.5" />} label="Ungroup" onClick={onUngroup} hint="⇧⌘G" />}
            <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} hint="R" />
            {/* Editable block title (composites that expose one, e.g. medallion). */}
            {onSetTitle && (
              <div className="px-2 py-1.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Type className="h-3.5 w-3.5" /> Title
                </div>
                <input
                  type="text"
                  value={nodeTitle ?? ""}
                  placeholder="Title…"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetTitle(e.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
                />
              </div>
            )}
            {/* Component options — checkboxes for any component declaring `options`
                (e.g. the medallion table's Feature store / Metric views forks). */}
            {options && options.length > 0 && onSetParam && (
              <>
                <Divider />
                <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Options</div>
                {options.map((o) => {
                  const on = params?.[o.key] ?? o.default ?? false;
                  return (
                    <label key={o.key} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px] hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => { e.stopPropagation(); onSetParam(o.key, e.target.checked); }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {o.label}
                    </label>
                  );
                })}
              </>
            )}
            {/* Source tiles: where the label sits relative to the icon. */}
            {onSetSourceCaption && (() => {
              const cur = sourceCaption ?? "right";
              const opts = [
                ["left", <ArrowLeft className="h-3.5 w-3.5" />],
                ["top", <ArrowUp className="h-3.5 w-3.5" />],
                ["right", <ArrowRight className="h-3.5 w-3.5" />],
                ["bottom", <ArrowDown className="h-3.5 w-3.5" />],
              ] as const;
              return (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="mr-auto text-[11px] text-muted-foreground">Text</span>
                  {opts.map(([p, ico]) => (
                    <button key={p} type="button" onClick={() => onSetSourceCaption(p)}
                      title={`Text ${p}`}
                      className={`grid h-6 w-6 cursor-pointer place-items-center rounded ${cur === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                      {ico}
                    </button>
                  ))}
                </div>
              );
            })()}
            {/* Source label size (same control the logo caption has). */}
            {onSetSourceFontSize && (
              <div className="px-2 py-1.5">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Type className="h-3.5 w-3.5" /> Text size</span>
                  <span>{sourceFontSize ?? 13}px</span>
                </div>
                <input type="range" min={9} max={28} step={1} value={sourceFontSize ?? 13}
                  onChange={(e) => onSetSourceFontSize(Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()} className="h-1.5 w-full cursor-pointer accent-primary" />
              </div>
            )}
            {/* Description-line visibility (source + product tile). */}
            {DescToggle}
            {/* Content scale slider — shrink/grow the icon+label inside the box. */}
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
            {/* Stack slider — render the node as N cards (blank offsets peeking
                bottom-right) to show "many of these" (e.g. N apps). 1 = single. */}
            {onSetStack && (
              <div className="px-2 py-1.5">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Stack</span>
                  <span>{nodeStack > 1 ? `×${nodeStack}` : "off"}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={nodeStack}
                  onChange={(e) => onSetStack(Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                  className="h-1.5 w-full cursor-pointer accent-primary"
                />
              </div>
            )}
            <Divider />
            <StyleControls style={style} onStyle={onStyle} />
            <Item icon={<Copy className="h-3.5 w-3.5" />} label="Copy style" onClick={onCopyStyle} />
            <Divider />
            {ZItems}
            <Divider />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove" onClick={onRemove} hint="⌫" />
          </>
        )}
      </div>
    </div>
  );
});
