/**
 * platform-diagram/composite-genie-one — the "Genie One" business-user entry
 * point, WITH the persona built in as a stylized pill that STRADDLES the top
 * border: a "Business users" tab (user glyph + label) floats half-over the top
 * edge, and the Genie One brand + label form the card body below.
 * This replaces the old convention of a separate `file:persona/user` node beside
 * Genie One — drop one `genie-one` node and the user is already there.
 * A composite node kind ("genie-one").
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { DATABRICKS_ICONS } from "../../databricks-icons";
import { FileSvgIcon } from "../../file-icons";
import { RotatableCard, baseSize, DropTargetContext, EditModeContext, cardStyle, type NodeData } from "./shared";

export const GenieOneBlock = memo(function GenieOneBlock({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const c = d.component;
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);
  const nat = baseSize(c, d.params, d.theme);
  const card = cardStyle(d, { borderColor: `${d.bandColor}55`, radius: 14, borderWidth: 1, shadow: 1 });
  const Brand = DATABRICKS_ICONS.genieOneBrand;
  const w = d.w ?? nat.w;
  const h = d.h ?? nat.h;
  const q = ((((d.rot ?? 0) % 360) + 360) % 360);
  // rot 90/270 = the slim vertical lane tile. The shell rotates the whole card, so
  // the landscape layout would read sideways and the persona pill would stick out
  // past the slim box. Instead, keep the rotated footprint and draw the contents
  // UPRIGHT inside it: an h×w frame counter-rotated by -rot, stacked vertically.
  if (q === 90 || q === 270) {
    return (
      <RotatableCard
        rot={d.rot}
        w={w}
        h={h}
        scale={d.scale ?? 1}
        baseW={nat.w}
        baseH={nat.h}
        editMode={editMode}
        selected={!!selected}
        forceDots={isDropTarget}
        onResize={(nw, nh, center) => d.onResize(d.nodeId, nw, nh, undefined, center)}
        onScale={(nw) => d.onResize(d.nodeId, nw, Math.round((nw * nat.h) / nat.w), nw / nat.w)}
        stack={d.stack}
        onContext={(e) => { e.preventDefault(); d.onContext(d.nodeId, e.clientX, e.clientY); }}
      >
        <div
          onClick={() => d.onSelect(d.nodeId)}
          className={`relative h-full w-full overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
          style={card.style}
        >
          <div
            className="absolute left-1/2 top-1/2 flex flex-col items-center justify-center gap-2 px-1.5 py-3 text-center"
            style={{ width: h, height: w, transform: `translate(-50%, -50%) rotate(${-q}deg)` }}
          >
            <span className="flex flex-col items-center gap-0.5 rounded-full px-2 py-1 text-white shadow-sm" style={{ background: "#1B2A4A" }} title="Business users">
              <FileSvgIcon iconKey="file:persona/user" className="h-4 w-4 shrink-0" />
            </span>
            <span className="text-[10px] font-semibold leading-tight text-muted-foreground">Business users</span>
            <span className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-background ${d.theme === "slide" ? "h-11 w-11" : "h-9 w-9"}`} style={{ boxShadow: `inset 0 0 0 1px ${d.bandColor}22` }}>
              <Brand className={d.theme === "slide" ? "h-7 w-7" : "h-5 w-5"} />
            </span>
            <span className={`font-semibold leading-tight text-foreground ${d.theme === "slide" ? "text-[17px]" : "text-[14px]"}`}>{c.label}</span>
          </div>
        </div>
      </RotatableCard>
    );
  }
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
      {/* Wrapper allows the persona pill to overflow above the card's top edge. */}
      <div className="relative h-full w-full">
        {/* Persona pill — floats straddling the top border, centered. Solid
            dark fill + white text/glyph so it always pops as the entry point
            (independent of band tint). */}
        <div
          className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 text-white shadow-sm"
          style={{ background: "#1B2A4A" }}
        >
          <FileSvgIcon iconKey="file:persona/user" className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap text-[11px] font-semibold">Business users</span>
        </div>
        {/* Card body: the Genie One mark + label. */}
        <div
          onClick={() => d.onSelect(d.nodeId)}
          className={`flex h-full w-full items-center overflow-hidden transition-shadow ${card.hasFill ? "" : "bg-card"} ${selected ? "ring-2 ring-primary/60" : ""}`}
          style={card.style}
        >
          <div className="flex min-h-0 w-full flex-1 items-center gap-2.5 px-3 pb-2 pt-3" style={{ transform: "scale(var(--cs, 1))", transformOrigin: "center" }}>
            <span className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-background ${d.theme === "slide" ? "h-11 w-11" : "h-9 w-9"}`} style={{ boxShadow: `inset 0 0 0 1px ${d.bandColor}22` }}>
              <Brand className={d.theme === "slide" ? "h-7 w-7" : "h-5 w-5"} />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className={`truncate font-semibold text-foreground ${d.theme === "slide" ? "text-[19px]" : "text-[15px]"}`}>{c.label}</span>
              {c.sublabel && d.theme !== "slide" && <span className="truncate text-[11px] font-normal text-muted-foreground">{c.sublabel}</span>}
            </span>
          </div>
        </div>
      </div>
    </RotatableCard>
  );
});
