/**
 * platform-diagram/panels/edit-panel — the persistent right-side edit panel
 * shown (in edit mode) whenever one or more NODES are selected. It replaces the
 * floating node context menu: selection alone drives it. Edges keep their own
 * floating context menu (menus/context-menu.tsx).
 *
 * The body varies by selection:
 *   • multi-select (2+)   → shared style controls + Group/Ungroup + z-order + Remove all
 *   • single annotation   → annotation controls + style controls + z-order
 *   • single group / Databricks Agent → Ungroup + the single-node controls
 *   • single plain node   → Change type / Rotate / Scale / style / z-order / Remove
 *
 * A single selection also gets numeric "Size & position" fields (footprint px +
 * top-left flow coords). They're the reachable counterpart of the resize grips:
 * a node parked at the right edge of the canvas can have its grips sit under
 * this very panel, so exact entry is the only way to resize it there.
 *
 * All the style + annotation controls are the SAME components used by the edge
 * context menu (panels/style-controls), so there's one source of truth.
 */
import { memo, useState, type ReactNode } from "react";
import { CATALOG, type AnnotationData, type ComponentOption } from "@/lib/platform-architecture";
import { type StylePatch } from "../shared";
import { StyleControls, AnnotationMenu, type MenuItemFn } from "./style-controls";
import { applyMdFormat, type MdFormat } from "../md-format";
import { applyToActiveMdEditor } from "../md-text";
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
  PaintRoller,
  Group,
  Ungroup,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Type,
  WrapText,
  Ruler,
  Bold,
  Italic,
  List,
  Heading2,
} from "lucide-react";

/** Exact on-canvas geometry of a single selection. `w`/`h` are the FOOTPRINT
 *  (what the box occupies on the canvas, i.e. already rotation-swapped); `x`/`y`
 *  are its TOP-LEFT in flow coordinates — the numbers a user reads off the
 *  canvas. Top-left (not centre) so changing W/H grows right/down and leaves
 *  X/Y alone, the Figma/Lucid convention. */
export interface NodeGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GEO_FIELDS = [
  ["w", "W", "Width in px"],
  ["h", "H", "Height in px"],
  ["x", "X", "Left edge (canvas x)"],
  ["y", "Y", "Top edge (canvas y)"],
] as const;

/** Numeric size/position entry for the single selection.
 *
 *  Each field keeps a local DRAFT while focused so a half-typed value ("-", or
 *  "12" on the way to "120") never commits, and drops back to the live value on
 *  blur/Escape. Commit is on Enter or blur — one history step per edit, not one
 *  per keystroke. Keydown is stopped so the canvas's window shortcuts
 *  (Backspace = delete node, arrows = nudge, Escape = clear selection) can't
 *  fire while typing a number. */
const GeometryFields = memo(function GeometryFields({
  geometry,
  onSetGeometry,
}: {
  geometry: NodeGeometry;
  onSetGeometry: (patch: Partial<NodeGeometry>) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<keyof NodeGeometry, string>>>({});
  const clear = (k: keyof NodeGeometry) =>
    setDraft((d) => {
      if (d[k] === undefined) return d;
      const next = { ...d };
      delete next[k];
      return next;
    });
  const commit = (k: keyof NodeGeometry, raw: string) => {
    clear(k);
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v) || raw.trim() === "" || v === geometry[k]) return;
    onSetGeometry({ [k]: v });
  };
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Ruler className="h-3.5 w-3.5" /> Size &amp; position
      </div>
      <div className="grid grid-cols-2 gap-1">
        {GEO_FIELDS.map(([k, label, hint]) => (
          <label
            key={k}
            title={hint}
            className="flex items-center gap-1 rounded border border-border bg-background px-1.5 py-1 focus-within:border-primary"
          >
            <span className="w-2.5 text-[10px] font-medium text-muted-foreground">{label}</span>
            <input
              type="number"
              step={1}
              value={draft[k] ?? String(geometry[k])}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              onBlur={(e) => commit(k, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { commit(k, e.currentTarget.value); e.currentTarget.blur(); }
                else if (e.key === "Escape") { clear(k); e.currentTarget.blur(); }
              }}
              className="w-full min-w-0 bg-transparent text-[11.5px] tabular-nums text-foreground outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
});

/** Annotation kinds whose `text` renders as markdown (see md-text). */
const MD_VARIANTS = new Set(["box", "note", "text"]);
const MD_BUTTONS: Array<{ kind: MdFormat; label: string; hint: string; icon: ReactNode }> = [
  { kind: "bold", label: "Bold", hint: "⌘B", icon: <Bold className="h-3.5 w-3.5" /> },
  { kind: "italic", label: "Italic", hint: "⌘I", icon: <Italic className="h-3.5 w-3.5" /> },
  { kind: "bullet", label: "Bullet list", hint: "- item", icon: <List className="h-3.5 w-3.5" /> },
  { kind: "heading", label: "Title", hint: "## title", icon: <Heading2 className="h-3.5 w-3.5" /> },
];

/** Bold / Italic / Bullet / Title. While the text is being edited (double-click
 *  the node) they toggle the format on the SELECTED text; otherwise on the whole
 *  text. mousedown is prevented so clicking a button doesn't blur the editor —
 *  that would commit the edit and lose the selection before the click lands. */
function MarkdownFormatRow({ text, onText }: { text: string; onText: (text: string) => void }) {
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Type className="h-3.5 w-3.5" /> Text format
        <span className="ml-auto text-[10px] opacity-70">markdown</span>
      </div>
      <div className="flex gap-1">
        {MD_BUTTONS.map((b) => (
          <button
            key={b.kind}
            type="button"
            title={`${b.label} (${b.hint}) — applies to the selected text while editing, else to all of it`}
            aria-label={b.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (applyToActiveMdEditor(b.kind)) return;
              onText(applyMdFormat(text, 0, text.length, b.kind).value);
            }}
            className="grid h-7 flex-1 cursor-pointer place-items-center rounded border border-border text-foreground hover:bg-muted"
          >
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Catalog title for a component id ("model-serving" → "Model Serving Endpoint").
 *  Undefined for ids outside the catalog (e.g. demo-authored source tiles). */
function catalogTitle(id?: string): string | undefined {
  if (!id) return undefined;
  for (const band of Object.values(CATALOG)) {
    const hit = band.find((c) => c.id === id);
    if (hit) return hit.label;
  }
  return undefined;
}

/** A labelled text field that keeps a local draft while focused and commits on
 *  Enter / blur (one history step per edit, not one per keystroke). Escape reverts.
 *  Keydown is stopped so canvas shortcuts (Backspace = delete) can't fire while
 *  typing. Empty commits are skipped when `allowEmpty` is false. */
const CommitField = memo(function CommitField({
  label,
  value,
  placeholder,
  multiline = false,
  allowEmpty = true,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  allowEmpty?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    if (raw === value) return;
    if (!allowEmpty && raw.trim() === "") return;
    onCommit(raw);
  };
  const common = {
    value: draft ?? value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => commit(e.target.value),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    className: "w-full rounded border border-border bg-background px-2 py-1 text-[11.5px] text-foreground outline-none focus:border-primary",
  };
  return (
    <label className="flex flex-col gap-1 px-2 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          {...common}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
          }}
          className={`${common.className} resize-none leading-snug`}
        />
      ) : (
        <input
          type="text"
          {...common}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
          }}
        />
      )}
    </label>
  );
});

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
  wrapDescription,
  onSetWrapDescription,
  options,
  params,
  onSetParam,
  nodeTitle,
  onSetTitle,
  titlePlaceholder,
  componentId,
  label,
  onSetLabel,
  desc,
  onSetDesc,
  descLockedReason,
  geometry,
  onSetGeometry,
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
  /** Selection is a single Databricks Agent composite → Ungroup explodes it. */
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
  /** Wrap-description toggle — set for source / product tiles. `wrapDescription`
   *  is the current on/off; the setter flips it. Undefined → no wrap toggle. */
  wrapDescription?: boolean;
  onSetWrapDescription?: (wrap: boolean) => void;
  /** Toggleable component options (checkboxes). Set when the single selection is
   *  a component that declares `options`. `params` is the node's current values;
   *  `onSetParam` writes one key. */
  options?: ComponentOption[];
  params?: Record<string, boolean | string>;
  onSetParam?: (key: string, value: boolean | string) => void;
  /** Editable block title (composites like the medallion table + Lakeflow blocks).
   *  `nodeTitle` is the current text (blank when still the default); `onSetTitle`
   *  renames it; `titlePlaceholder` hints the block's default when blank. */
  nodeTitle?: string;
  onSetTitle?: (title: string) => void;
  titlePlaceholder?: string;
  /** Catalog id of the single selected component — the header shows its catalog
   *  title ("Model Serving Endpoint"). Unknown ids fall back to "Element". */
  componentId?: string;
  /** Node label (plain tiles, sources, untitled composites) + its setter. Commits
   *  through the same path as double-click rename, so undo/collab/save all match. */
  label?: string;
  onSetLabel?: (label: string) => void;
  /** Description line (plain tiles + sources) + its setter. Commits through the same
   *  path as double-click edit on the canvas. */
  desc?: string;
  onSetDesc?: (desc: string) => void;
  /** Set when the active theme hides this node's description whatever its showDesc
   *  flag says (slide). The toggle still shows the rendered (off) state but is locked. */
  descLockedReason?: string;
  /** Exact geometry of the single selection (see NodeGeometry). Undefined → the
   *  Size & position fields are hidden (multi-select). Editing a field PINS the
   *  node, exactly like dragging or nudging it: it then serializes as a pixel
   *  `at` + `size` instead of its authored symbolic placement. */
  geometry?: NodeGeometry;
  onSetGeometry?: (patch: Partial<NodeGeometry>) => void;
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
  // Locked (slide theme): the row shows the RENDERED state (off) and says why,
  // instead of a checkbox that would toggle without changing the canvas.
  const DescToggle =
    onSetShowDescription !== undefined ? (
      descLockedReason ? (
        <div
          title={descLockedReason}
          className="flex cursor-not-allowed items-center gap-2 rounded px-2 py-1.5 text-[12.5px] text-muted-foreground"
        >
          <span className="grid h-4 w-4 place-items-center"><Type className="h-3.5 w-3.5" /></span>
          Show description
          <span className="ml-auto text-[10.5px] text-muted-foreground/70">{showDescription ? "on" : "off"} · {descLockedReason}</span>
        </div>
      ) : (
        <Item
          icon={<Type className="h-3.5 w-3.5" />}
          label="Show description"
          onClick={() => onSetShowDescription(!showDescription)}
          active={!!showDescription}
        />
      )
    ) : null;

  // "Wrap description" — multi-line instead of truncate (box auto-grows). Only
  // useful when the description is actually shown, so gate on showDescription.
  const WrapDescToggle =
    onSetWrapDescription !== undefined && showDescription ? (
      <Item
        icon={<WrapText className="h-3.5 w-3.5" />}
        label="Wrap description"
        onClick={() => onSetWrapDescription(!wrapDescription)}
        active={!!wrapDescription}
      />
    ) : null;

  const GeoFields =
    geometry && onSetGeometry ? <GeometryFields geometry={geometry} onSetGeometry={onSetGeometry} /> : null;

  const title =
    selectionCount > 1
      ? `${selectionCount} selected`
      : annotation
        ? (annotation.variant === "card" ? "Card" : annotation.variant === "html" ? "HTML block" : "Annotation")
        : (catalogTitle(componentId) ?? label ?? "Element");

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
            <Item icon={<PaintRoller className="h-3.5 w-3.5" />} label="Copy style (paint)" onClick={onCopyStyle} />
            <Divider />
            {ZItems}
            <Divider />
            <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove all" onClick={onRemove} hint="⌫" />
          </>
        ) : annotation ? (
          <>
            <AnnotationMenu a={annotation} Item={Item} onAnno={onAnno} onPickLogo={onPickLogo} onRotate={onRotate} onRemove={onRemove} />
            {MD_VARIANTS.has(annotation.variant) && (
              <MarkdownFormatRow text={annotation.text ?? ""} onText={(text) => onAnno({ text })} />
            )}
            {/* A logo owns its own Title + Description inputs (in AnnotationMenu),
                where an empty description hides the line — so no "Show description"
                toggle for logos. Other annotation kinds keep the toggle. */}
            {annotation.variant !== "logo" && DescToggle}
            {GeoFields}
            <Divider />
            <StyleControls style={style} onStyle={onStyle} showIconColor={annotation.variant === "logo" || annotation.variant === "card"} noBoxDefaults={annotation.variant === "logo"} />
            <Item icon={<PaintRoller className="h-3.5 w-3.5" />} label="Copy style (paint)" onClick={onCopyStyle} />
            <Divider />
            {ZItems}
          </>
        ) : (
          <>
            <Item icon={<Replace className="h-3.5 w-3.5" />} label="Change type…" onClick={onChangeType} />
            {(isGroup || isAgentBricks) && <Item icon={<Ungroup className="h-3.5 w-3.5" />} label="Ungroup" onClick={onUngroup} hint="⇧⌘G" />}
            <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} hint="R" />
            {/* Label + description — the same edits as double-clicking the node on
                the canvas (onRename / onSetDescription), so undo, collab and save
                all see one code path. Hidden for titled composites (they use Title). */}
            {onSetLabel && label !== undefined && (
              <CommitField label="Label" value={label} allowEmpty={false} onCommit={onSetLabel} />
            )}
            {onSetDesc && desc !== undefined && (
              <CommitField label="Description" value={desc} placeholder="Add a description…" multiline onCommit={onSetDesc} />
            )}
            {/* Editable block title (composites that expose one, e.g. medallion). */}
            {onSetTitle && (
              <div className="px-2 py-1.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Type className="h-3.5 w-3.5" /> Title
                </div>
                <input
                  type="text"
                  value={nodeTitle ?? ""}
                  placeholder={titlePlaceholder ?? "Title…"}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetTitle(e.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
                />
              </div>
            )}
            {/* Component options — declarative, from any component's `options`.
                A boolean option renders a checkbox (e.g. the medallion's Feature
                store / Metric views forks); a text option renders a labeled input
                (e.g. the bronze/silver/gold layer captions). Both round-trip via
                params, so adding an option to a catalog entry surfaces it here
                automatically — no per-component wiring. */}
            {options && options.length > 0 && onSetParam && (
              <>
                <Divider />
                <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Options</div>
                {options.map((o) =>
                  o.type === "text" ? (
                    <label key={o.key} className="flex flex-col gap-0.5 px-2 py-1 text-[11px] text-muted-foreground">
                      {o.label}
                      <input
                        type="text"
                        value={typeof params?.[o.key] === "string" ? (params[o.key] as string) : ""}
                        placeholder={o.placeholder}
                        onChange={(e) => { e.stopPropagation(); onSetParam!(o.key, e.target.value); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded border border-border bg-background px-2 py-1 text-[11.5px] text-foreground outline-none focus:border-primary"
                      />
                    </label>
                  ) : (
                    <label key={o.key} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px] hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={!!(params?.[o.key] ?? o.default ?? false)}
                        onChange={(e) => { e.stopPropagation(); onSetParam!(o.key, e.target.checked); }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {o.label}
                    </label>
                  ),
                )}
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
            {/* Wrap the description to multiple lines (box auto-grows). */}
            {WrapDescToggle}
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
            {/* Exact box geometry — the numeric counterpart of the resize grips
                (and the only way to size a node whose grips sit under this
                panel / off-screen). */}
            {GeoFields}
            <Divider />
            {/* Every catalog tile, source, composite and logo carries an icon: the colour control applies. */}
            <StyleControls style={style} onStyle={onStyle} showIconColor />
            <Item icon={<PaintRoller className="h-3.5 w-3.5" />} label="Copy style (paint)" onClick={onCopyStyle} />
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
