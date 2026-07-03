/**
 * platform-diagram/edges/edge-flow — the flowing-data animation rendered along
 * an edge path (`EdgeFlow`) and a small live menu preview of each flow style
 * (`FlowStylePreview`). Pure SVG, no ReactFlow coupling.
 */
import { type FlowStyle } from "../shared";

/** Flowing-data animation along an edge path. Styles:
 *   dot       — a single glowing dot (the original).
 *   particles — a dense red "river" of cubes/circles/triangles (streaming data).
 *   docs       — small document glyphs moving along (file ingest).
 *   laser      — a futuristic pulsing red beam with a bright streak racing along
 *                (DB / SaaS connector data). */
export function EdgeFlow({ style, path }: { style: FlowStyle; path: string }) {
  if (style === "dot") {
    return (
      <circle r="3.5" fill="var(--primary)" style={{ filter: "drop-shadow(0 0 4px var(--primary))" }}>
        <animateMotion dur="2s" repeatCount="indefinite" path={path} />
      </circle>
    );
  }
  if (style === "laser") {
    // A comet of data: a faint steady wire with a bright head + fading tail
    // gliding along it. The tail is built from stacked dashes of decreasing
    // width/opacity that lag the head slightly, so it reads as a glowing pulse
    // with a trail — no discrete dots, no pulsing of the whole beam.
    const RED = "#EF5B3F";
    const DUR = "2.6s";
    const PERIOD = 240;          // dash period (head + long empty gap)
    // Trail segments: [length, width, opacity, extra lag]. Front = bright head.
    const TRAIL: [number, number, number, number][] = [
      [10, 2.6, 1.0, 0],     // head — short, bright, thick
      [16, 2.0, 0.55, 8],    // mid tail
      [26, 1.4, 0.28, 18],   // far tail — long, dim, thin
    ];
    return (
      <>
        {/* steady faint wire the comet rides on */}
        <path d={path} fill="none" stroke={RED} strokeWidth={1.2} strokeLinecap="round" opacity={0.22} />
        {TRAIL.map(([len, w, op, lag], i) => (
          <path key={i} d={path} fill="none" stroke={i === 0 ? "#FFE3DA" : RED} strokeWidth={w} strokeLinecap="round"
            strokeDasharray={`${len} ${PERIOD - len}`} opacity={op}
            style={i === 0 ? { filter: `drop-shadow(0 0 3px ${RED})` } : undefined}>
            <animate attributeName="stroke-dashoffset" values={`${PERIOD + lag};${lag}`} dur={DUR} repeatCount="indefinite" />
          </path>
        ))}
      </>
    );
  }
  if (style === "particles") {
    // A dense, slow "river" of records: many small Databricks-red cubes,
    // circles and triangles packed along the path (they ARE the line — no
    // underlying stroke). Each rides the path and sways perpendicular so the
    // stream ripples. Variety (shape / size / amplitude) is index-driven with
    // mixed strides so it reads as irregular rather than periodic.
    // 8 glyphs read as a dense "river" at canvas zoom while keeping the animated
    // SMIL node count per edge low (each glyph = a motion + a sway transform).
    const N = 8;
    const DUR = 5; // seconds for a full traverse — slow
    const RED = "#EF5B3F";
    return (
      <>
        {Array.from({ length: N }).map((_, i) => {
          const begin = `${-(i * DUR) / N}s`;          // pre-spread along the path
          const shape = (i * 3) % 7 < 3 ? "cube" : (i * 3) % 7 < 5 ? "circle" : "tri"; // ~irregular mix
          const sz = 1.3 + ((i * 7) % 5) * 0.55;        // 1.3–3.5, varied
          const sway = 1.4 + ((i * 5) % 6) * 0.55;      // perpendicular amplitude
          const swayDur = 0.9 + ((i * 11) % 7) * 0.16;  // varied wobble speed
          const phase = `${-((i * 13) % 9) * 0.12}s`;
          const op = 0.7 + ((i * 3) % 4) * 0.1;
          return (
            <g key={i}>
              <g>
                {shape === "cube" ? (
                  <rect x={-sz} y={-sz} width={sz * 2} height={sz * 2} rx={0.5} fill={RED} opacity={op} />
                ) : shape === "circle" ? (
                  <circle r={sz} fill={RED} opacity={op} />
                ) : (
                  <path d={`M0 ${-sz * 1.2} L${sz * 1.1} ${sz} L${-sz * 1.1} ${sz} Z`} fill={RED} opacity={op} />
                )}
                <animateTransform attributeName="transform" type="translate" values={`0 ${-sway};0 ${sway};0 ${-sway}`} dur={`${swayDur}s`} begin={phase} repeatCount="indefinite" additive="sum" />
              </g>
              <animateMotion dur={`${DUR}s`} begin={begin} repeatCount="indefinite" path={path} />
            </g>
          );
        })}
      </>
    );
  }
  // docs — a couple of document glyphs moving along the path (sparse).
  const N = 2;
  const DUR = 3.6;
  return (
    <>
      {Array.from({ length: N }).map((_, i) => (
        <g key={i}>
          <g transform="translate(-3 -4)">
            <rect x={0} y={0} width={6} height={8} rx={1} fill="var(--background)" stroke="#EF5B3F" strokeWidth={1} />
            <path d="M1.5 2.5h3M1.5 4h3M1.5 5.5h2" stroke="#EF5B3F" strokeWidth={0.6} strokeLinecap="round" />
          </g>
          <animateMotion dur={`${DUR}s`} begin={`${-(i * DUR) / N}s`} repeatCount="indefinite" path={path} />
        </g>
      ))}
    </>
  );
}

/** A small live preview of a flow style on a short straight line — used as the
 *  menu choices (a real sample reads better than an icon + name). */
export function FlowStylePreview({ style }: { style: FlowStyle }) {
  // Full-width sample line: the svg fills the menu row width (h-auto keeps the
  // glyphs proportional — the menu width ≈ the viewBox width so no distortion).
  const PATH = "M8 11 L156 11";
  return (
    <svg viewBox="0 0 164 22" width="100%" height={22} className="block overflow-visible">
      {/* faint base line (laser/particles draw their own; this is just a guide) */}
      <path d={PATH} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} opacity={style === "dot" ? 0.5 : 0.18} />
      <EdgeFlow style={style} path={PATH} />
    </svg>
  );
}
