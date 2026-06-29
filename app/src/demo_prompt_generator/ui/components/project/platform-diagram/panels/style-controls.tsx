/**
 * platform-diagram/panels/style-controls — the per-node style controls
 * (opacity / fill / font / border / radius / shadow) and the annotation
 * sub-menu (font + align; logo pick; image url). Extracted here so they are a
 * SINGLE source of truth shared by both the floating edge/legacy context menu
 * (menus/context-menu.tsx) and the docked right-side edit panel (edit-panel.tsx).
 */
import { type AnnotationData } from "@/lib/platform-architecture";
import { type StylePatch } from "../shared";
import {
  Trash2,
  RotateCw,
  Type,
  Shapes,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";

/** Shape of the small menu-item button factory shared across menu + panel. */
export type MenuItemFn = (p: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) => React.ReactElement;

/** The right-click menu body for a free-form annotation node — varies by
 *  variant (text/box: font + border + alignment; logo: pick; image: set URL). */
export function AnnotationMenu({
  a,
  Item,
  onAnno,
  onPickLogo,
  onSetImageUrl,
  onRotate,
  onRemove,
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
export function StyleControls({
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
