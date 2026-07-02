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
import { type AnnotationData } from "@/lib/platform-architecture";
import { type StylePatch } from "../shared";
import { StyleControls, AnnotationMenu, type MenuItemFn } from "./style-controls";
import {
  X,
  Trash2,
  Check,
  RotateCw,
  Scaling,
  Replace,
  BringToFront,
  SendToBack,
  Copy,
  Group,
  Ungroup,
} from "lucide-react";

export const EditPanel = memo(function EditPanel({
  selectionCount,
  annotation,
  nodeScale = 1,
  style,
  isGroup = false,
  canGroup = false,
  isAgentBricks = false,
  onClose,
  onRotate,
  onRemove,
  onChangeType,
  onSetScale,
  onAnno,
  onPickLogo,
  onSetImageUrl,
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
  /** Current style of the selection (single node, or the first when multi). */
  style?: StylePatch;
  /** Selection belongs to a group → offer Ungroup. */
  isGroup?: boolean;
  /** Selection (2+) can be grouped → offer Group. */
  canGroup?: boolean;
  /** Selection is a single Agent Bricks composite → Ungroup explodes it. */
  isAgentBricks?: boolean;
  onClose: () => void;
  onRotate: () => void;
  onRemove: () => void;
  onChangeType: () => void;
  onSetScale: (s: number) => void;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onSetImageUrl: () => void;
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
            <AnnotationMenu a={annotation} Item={Item} onAnno={onAnno} onPickLogo={onPickLogo} onSetImageUrl={onSetImageUrl} onRotate={onRotate} onRemove={onRemove} />
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
