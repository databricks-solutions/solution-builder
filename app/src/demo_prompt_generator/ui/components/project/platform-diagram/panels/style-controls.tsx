/**
 * platform-diagram/panels/style-controls — the per-node style controls
 * (opacity / fill / font / border / radius / shadow) and the annotation
 * sub-menu (font + align; logo pick; image url). Extracted here so they are a
 * SINGLE source of truth shared by both the floating edge/legacy context menu
 * (menus/context-menu.tsx) and the docked right-side edit panel (edit-panel.tsx).
 */
import { type AnnotationData } from "@/lib/platform-architecture";
import { shadowLevel, type StylePatch } from "../shared";
import {
  Trash2,
  RotateCw,
  Type,
  Shapes,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

/** Shape of the small menu-item button factory shared across menu + panel. */
export type MenuItemFn = (p: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Keyboard-shortcut hint shown right-aligned + greyed (e.g. "⌘G"). */
  hint?: string;
}) => React.ReactElement;

/** The right-click menu body for a free-form annotation node — varies by
 *  variant (text/box: font + border + alignment; logo: pick; image: set URL). */
export function AnnotationMenu({
  a,
  Item,
  onAnno,
  onPickLogo,
  onRotate,
  onRemove,
}: {
  a: AnnotationData;
  Item: MenuItemFn;
  onAnno: (patch: Partial<AnnotationData>) => void;
  onPickLogo: () => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  const isTextual = a.variant === "text" || a.variant === "box";
  const fontSize = a.fontSize ?? 14;
  // Mirror the render default: plain text is left-aligned, a box is centered.
  const hAlign = a.hAlign ?? (a.variant === "text" ? "left" : "center");
  return (
    <>
      {a.variant === "logo" && <Item icon={<Shapes className="h-3.5 w-3.5" />} label="Pick logo…" onClick={onPickLogo} />}
      {a.variant === "logo" && (() => {
        // Where the text label sits relative to the icon. Legacy side==right,
        // below==bottom; unset defaults to bottom.
        const cur = a.caption === "side" ? "right" : a.caption === "below" || a.caption === undefined ? "bottom" : a.caption;
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
              <button key={p} type="button" onClick={(e) => { e.stopPropagation(); onAnno({ caption: p }); }}
                title={`Text ${p}`}
                className={`grid h-6 w-6 cursor-pointer place-items-center rounded ${cur === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {ico}
              </button>
            ))}
          </div>
        );
      })()}
      {/* Text size (caption font) for a logo. */}
      {a.variant === "logo" && (
        <div className="px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><Type className="h-3.5 w-3.5" /> Text size</span>
            <span>{fontSize}px</span>
          </div>
          <input type="range" min={9} max={28} step={1} value={fontSize}
            onChange={(e) => onAnno({ fontSize: Number(e.target.value) })}
            onClick={(e) => e.stopPropagation()} className="h-1.5 w-full cursor-pointer accent-primary" />
        </div>
      )}
      {a.variant === "image" && (
        <div className="px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" /> Image URL
          </div>
          <input
            type="text"
            defaultValue={a.src ?? ""}
            placeholder="https://…"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onAnno({ src: e.target.value })}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
          />
        </div>
      )}
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
          {/* Bold toggle */}
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="mr-auto text-[11px] text-muted-foreground">Bold</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAnno({ bold: !a.bold }); }}
              className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-bold ${a.bold ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
              title="Bold text"
            >
              B
            </button>
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
          {/* Overflow mode for a TEXT node (always available).
                • Auto (default) — the box grows with the text as you type.
                • Wrap — fixed box; text flows onto new lines.
                • Truncate — fixed box; one line + ellipsis.
              Picking Wrap/Truncate on an Auto node fixes its current size (the
              box stops hugging the text); Auto reverts to grow-to-fit. Clearing
              the legacy `sized` flag keeps the mode authoritative. */}
          {a.variant === "text" && (() => {
            const cur = a.textWrap && a.textWrap !== "auto" ? a.textWrap : a.sized ? "wrap" : "auto";
            return (
              <div className="flex items-center gap-1 px-2 py-1.5">
                <span className="mr-auto text-[11px] text-muted-foreground">Overflow</span>
                {(["auto", "wrap", "truncate"] as const).map((mode) => (
                  <button key={mode} type="button" onClick={(e) => { e.stopPropagation(); onAnno({ textWrap: mode, sized: undefined }); }}
                    className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] capitalize ${cur === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    {mode}
                  </button>
                ))}
              </div>
            );
          })()}
        </>
      )}
      <div className="my-1 border-t border-border/60" />
      <Item icon={<RotateCw className="h-3.5 w-3.5" />} label="Rotate 90°" onClick={onRotate} hint="R" />
      <Item icon={<Trash2 className="h-3.5 w-3.5" />} label="Remove" onClick={onRemove} hint="⌫" />
    </>
  );
}

/** Opacity / fill-color / font-color controls shared by single + multi-select.
 *  A color swatch with a reset (×) that clears the override (back to default). */
// Swatch palette for the "Icon color" recolor — the unified accent first, then
// a spread of common diagram colors. "None" resets to the icon's own default.
const ICON_SWATCHES = ["#FF5F46", "#5266A6", "#111827", "#64748B", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

export function StyleControls({
  style,
  onStyle,
  showIconColor = false,
  noBoxDefaults = false,
}: {
  style?: StylePatch;
  onStyle: (patch: StylePatch) => void;
  /** Show the "Icon color" recolor row (logo annotations only). */
  showIconColor?: boolean;
  /** Logo defaults: NO border / NO shadow / TRANSPARENT fill unless the user
   *  sets one — so the controls read "None / off / transparent" at rest and
   *  adding a value gives the logo a box. */
  noBoxDefaults?: boolean;
}) {
  const opacityPct = Math.round((style?.opacity ?? 1) * 100);
  // For logos (noBoxDefaults) an UNSET fill is transparent → the "None" toggle
  // is active; boxes default to a white fill so unset ≠ transparent.
  const isTransparent = style?.fillColor === "transparent" || (noBoxDefaults && style?.fillColor === undefined);
  // Default fonts to the theme's dark foreground so the picker shows it.
  const DEFAULT_FONT = "#1e293b";
  const borderW = style?.borderWidth ?? (noBoxDefaults ? 0 : 1);
  const borderStyle = style?.borderStyle ?? "solid";
  const radius = style?.borderRadius ?? (noBoxDefaults ? 8 : 12);
  const shadowPct = shadowLevel(noBoxDefaults ? (style?.shadow ?? 0) : style?.shadow);
  return (
    <>
      {/* Icon color — recolor a logo's SVG. A swatch palette + a custom picker,
          and "None" to fall back to the icon's own default color. */}
      {showIconColor && (
        <div className="px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Icon color</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStyle({ iconColor: undefined }); }}
              className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${style?.iconColor === undefined ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
              title="Use the icon's default color"
            >
              None
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {ICON_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={(e) => { e.stopPropagation(); onStyle({ iconColor: c }); }}
                title={c}
                className={`h-4 w-4 cursor-pointer rounded-full border ${style?.iconColor === c ? "ring-2 ring-primary ring-offset-1" : "border-border"}`}
                style={{ background: c }}
              />
            ))}
            {/* Custom color */}
            <input
              type="color"
              value={style?.iconColor || "#FF5F46"}
              onChange={(e) => onStyle({ iconColor: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
              title="Custom icon color"
            />
          </div>
        </div>
      )}
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
      {/* Border: width slider, solid/dashed toggle, color. "None" toggles the
          border OFF↔ON — 0px when there's a border, back to 1px when there
          isn't (a quick on/off). */}
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Border
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStyle({ borderWidth: borderW === 0 ? 1 : 0 }); }}
              className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${borderW === 0 ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
              title={borderW === 0 ? "Add a 1px border" : "Remove border"}
            >
              None
            </button>
          </span>
          <span>{borderW}px</span>
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
      {/* Drop shadow intensity (0 = none → strong). */}
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Shadow</span><span>{shadowPct === 0 ? "Off" : `${shadowPct}%`}</span>
        </div>
        <input
          type="range" min={0} max={100} step={5} value={shadowPct}
          onChange={(e) => onStyle({ shadow: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          className="h-1.5 w-full cursor-pointer accent-primary"
          title="Drop shadow intensity (drag to 0 to remove)"
        />
      </div>
    </>
  );
}
