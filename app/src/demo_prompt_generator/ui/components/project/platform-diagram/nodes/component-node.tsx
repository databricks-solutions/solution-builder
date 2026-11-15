/**
 * platform-diagram/nodes/component-node — the standard product/source node.
 * A thin adapter over the shared <NodeCard>: it resolves the product-tile vs
 * source props (icon via BrandMark with the trademark gate, subtitle/badge/
 * live-dot/SDP medallion for product tiles; caption position + auto-fit for
 * sources) and hands them to NodeCard, which owns the actual rendering.
 */
import { memo, useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import {
  type NodeData,
  DropTargetContext,
  EditModeContext,
  baseSize,
  verticalSourceSize,
  wrapDescExtraH,
} from "../shared";
import { BrandMark, isTrademarkMark } from "../brand-mark";
import { MedallionRow } from "../composite-lakeflow";
import { baseId } from "@/lib/platform-architecture";
import { NodeCard, type CaptionPosition } from "./node-card";

/** The standard product/source node — brand icon tile + label. */
export const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const { component: c, bandColor } = d;
  // Lakebase is app state, not a user-facing live surface — no "live" dot.
  const live = !!d.deepLink && c.id !== "lakebase";
  const muted = c.state === "mentioned";
  const isDropTarget = useContext(DropTargetContext) === d.nodeId;
  const editMode = useContext(EditModeContext);

  const isSdp = c.id === "sdp";
  // A source tile can position its label + auto-fit; product tiles are fixed.
  const isSource = d.type === "source" || !!d.sourceKey || baseId(d.nodeId).startsWith("src-");
  const cap: CaptionPosition = isSource ? (d.sourceCaption ?? "right") : "right";
  const vertical = isSource && (cap === "top" || cap === "bottom");

  // Default box: sources with a vertical caption use the taller box (matches
  // nodeFootprint so the node box + edge anchors track the card); everything
  // else uses the component's natural size. A captioned SOURCE in a same-lane
  // group carries a DERIVED lane-uniform width (`d.laneW`, computeLayout step
  // 2.5) so the grouped cards match + icons align — honor it over the natural
  // 200 (a user resize `d.w`/`d.h` still wins, applied inside NodeCard).
  const nat = baseSize(c, d.params);
  const baseDefault = vertical
    ? verticalSourceSize()
    : isSource && d.laneW
      ? { w: d.laneW, h: nat.h }
      : nat;
  // Grow the fallback HEIGHT for a wrapped description so the rendered card is as
  // tall as its content (matches nodeFootprint's grow of the RF node box, via the
  // SAME helper — so the two never disagree). The desc text is `d.desc` for a
  // source, else the catalog desc. A user's explicit `d.h` still wins in NodeCard.
  const descText = isSource ? d.desc : (c.desc ?? c.sublabel);
  const wrapExtraH = wrapDescExtraH(
    { desc: descText, showDesc: d.showDesc ?? (!isSource && !!(c.desc ?? c.sublabel)), wrapDesc: d.wrapDesc, vertical, theme: d.theme },
    baseDefault.w,
  );
  // AUTO-HEIGHT: any wrap-desc tile sizes to its MEASURED content (the card measures
  // itself and reports d.autoH) — even one authored with a `size` height, since a
  // fixed height would clip or pad the wrapped text. The estimate is only the
  // pre-paint seed; once measured, d.autoH drives the box exactly (no empty space,
  // no clip, any font/length). Without wrap, the explicit `d.h` passes through.
  const autoHeight = wrapExtraH > 0;
  const defaultSize = { w: baseDefault.w, h: baseDefault.h + wrapExtraH };
  const effH = autoHeight
    ? (d.autoH ?? Math.max(d.h ?? 0, defaultSize.h))
    : d.h;

  // Icon: real logo, or a full-name brand badge when the logo is trademark-
  // gated and not enabled — OR when the node opts into a label-only text badge
  // (`icon:"text"` / no icon, e.g. a partner we have no logo for). Both render
  // the bare BrandMark (a TextBadge) with no icon-tile box around it.
  const isTextBadge = c.icon === "text" || !c.icon;
  const slide = d.theme === "slide";
  const icon = isTextBadge || (isTrademarkMark(c.icon) && !d.allowTrademark) ? (
    <BrandMark iconKey={c.icon} label={c.label} bandColor={bandColor} allowTrademark={false} iconColor={d.iconColor} />
  ) : (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden ${slide ? "h-10 w-10 rounded-md" : "h-9 w-9 rounded-lg bg-background"}`}
      style={slide ? undefined : { boxShadow: `inset 0 0 0 1px ${bandColor}22` }}
    >
      <BrandMark iconKey={c.icon} label={c.label} bandColor={bandColor} allowTrademark={!!d.allowTrademark} iconColor={d.iconColor} className={slide ? "h-8 w-8" : "h-5 w-5"} />
    </span>
  );

  return (
    <NodeCard
      nodeId={d.nodeId}
      deprecated={!!c.deprecated}
      theme={d.theme}
      selected={!!selected}
      editMode={editMode}
      isDropTarget={isDropTarget}
      rot={d.rot}
      scale={d.scale ?? 1}
      w={d.w}
      h={effH}
      icon={icon}
      title={c.label}
      // Sources behave like logos: an empty label commits "" (renders nothing,
      // no re-derive). Product tiles keep the guard — a blank label is
      // meaningless there, so ignore empty commits.
      onCommitTitle={
        isSource
          ? (v) => { if (v !== c.label) d.onRename(d.nodeId, v); }
          : (v) => { if (v && v !== c.label) d.onRename(d.nodeId, v); }
      }
      hideEmptyTitle={isSource}
      // Product tiles: badge/live-dot + the SDP medallion. There's no separate
      // subtitle line — a tile is title + ONE description (the old sublabel and
      // desc were redundant), so the subtitle slot is unused here.
      subtitle={undefined}
      // Description line: sources carry it on d.desc; product tiles use the
      // catalog desc, falling back to the sublabel for tiles that only have one.
      // SLIDE hides EVERY tile's description — sources AND product tiles — so the
      // label + icon do the work on a slide, even when the author set
      // showDesc:true (a relabeled "Batch Scoring Job" keeps its LABEL, drops the
      // "Nightly predictions → Gold" subtitle; a Git source keeps "Git", drops
      // "Source of truth"). Technical keeps the old behavior: sources are opt-in
      // via showDesc; a product tile shows its desc unless showDesc:false.
      description={isSource ? d.desc : (c.desc ?? c.sublabel)}
      showDescription={
        slide
          ? false
          : isSource
            ? d.showDesc
            : (d.showDesc ?? !!(c.desc ?? c.sublabel))
      }
      wrapDescription={!!d.wrapDesc}
      autoHeight={autoHeight}
      onAutoHeight={autoHeight && d.onAutoHeight ? (h) => d.onAutoHeight!(d.nodeId, h) : undefined}
      onCommitDescription={(v) => d.onSetDescription?.(d.nodeId, v)}
      badge={!isSource && c.badge ? {
        text: c.badge,
        icon: c.badge === "RT"
          ? <svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" /></svg>
          : undefined,
      } : undefined}
      liveLink={!isSource && live}
      extraContent={isSdp ? <MedallionRow /> : undefined}
      caption={cap}
      // Both sources and product tiles keep a FIXED box — changing the label must
      // NOT resize the component. (Only a pure `text` annotation auto-fits to its
      // text; that path lives in annotations.tsx, not NodeCard.)
      defaultSize={defaultSize}
      styleVariant="tile"
      muted={muted}
      bandBorderColor={muted ? "transparent" : `${bandColor}66`}
      // Sources can size their label; product tiles keep the brand-tile default.
      // Slide: product tiles use 16px (was 20) + tighter icon gap so longer names
      // (AI/BI Dashboard, Knowledge Assistant, Model Serving…) fit without cropping.
      fontSize={isSource ? (d.fontSize ?? (slide ? 20 : undefined)) : slide ? 16 : undefined}
      fontColor={d.fontColor}
      fillColor={d.fillColor}
      borderWidth={d.borderWidth}
      borderStyle={d.borderStyle}
      borderColor={d.borderColor}
      borderRadius={d.borderRadius}
      shadow={d.shadow}
      opacity={d.opacity}
      stack={d.stack}
      onSelect={d.onSelect}
      onResize={d.onResize}
      onScale={(id, w) => d.onResize(id, w, Math.round((w * defaultSize.h) / defaultSize.w), w / defaultSize.w)}
      onContext={d.onContext}
    />
  );
});
