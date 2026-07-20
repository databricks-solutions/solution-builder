/**
 * platform-diagram/export-image — capture the rendered diagram as PNG/SVG.
 * Shared by the app's Architecture tab (chrome-bar Download menu), the
 * standalone editor toolbar, and the agent's passive auto-snapshot.
 * `html-to-image` is lazy-imported on click so it never weighs on the initial
 * bundle.
 *
 * ── Framing ────────────────────────────────────────────────────────────────
 * The naive approach — capture `.react-flow__viewport` as-is — bakes in the
 * user's current pan/zoom: the output is sized by wherever the zoom slider was
 * left (tiny + blurry when zoomed out, huge when zoomed in) and content near
 * the panned edge gets clipped or padded with dead space. That's the "frame is
 * wrong" bug.
 *
 * Instead we compute the tight bounding box of the actual node elements (in the
 * viewport's own, pre-zoom coordinate space), size the output canvas to exactly
 * that box + a small uniform pad, and render with a normalized transform
 * (translate the box to the origin, scale 1). Result: the image is exactly the
 * diagram's extent — no dead margin, nothing cut off — regardless of the live
 * pan/zoom. Works without a ReactFlow instance (pure DOM), so every caller
 * (in-app menu, standalone, agent snapshot) gets the same correct framing.
 */

/** The transformed layer that holds the nodes (RF applies pan/zoom here as a
 *  CSS transform). Falls back to the pane element. */
function captureTarget(): HTMLElement | null {
  return (
    (document.querySelector(".react-flow__viewport") as HTMLElement | null) ??
    (document.querySelector(".react-flow") as HTMLElement | null)
  );
}

/** Read the live zoom (scale) from the viewport's computed transform matrix. */
function currentZoom(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 1;
  // matrix(a, b, c, d, e, f) — `a` is the horizontal scale (uniform here).
  const m = /matrix\(([^)]+)\)/.exec(t);
  if (!m) return 1;
  const a = parseFloat(m[1].split(",")[0]);
  return Number.isFinite(a) && a > 0 ? a : 1;
}

interface Box { minX: number; minY: number; width: number; height: number }

/** Tight bounding box of the rendered nodes in the VIEWPORT's local (pre-zoom)
 *  coordinate space. Uses getBoundingClientRect (so node rotation is handled)
 *  divided by the live zoom to undo the viewport transform. Returns null when
 *  there are no nodes to frame. */
function contentBounds(viewport: HTMLElement): Box | null {
  const nodes = viewport.querySelectorAll<HTMLElement>(".react-flow__node");
  if (nodes.length === 0) return null;
  const zoom = currentZoom(viewport);
  const vp = viewport.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // skip un-rendered
    // Screen px → viewport-local px: subtract the viewport's own screen origin,
    // then divide by zoom (the transform's scale) to reach untransformed coords.
    const x0 = (r.left - vp.left) / zoom;
    const y0 = (r.top - vp.top) / zoom;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x0 + r.width / zoom);
    maxY = Math.max(maxY, y0 + r.height / zoom);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** html-to-image options that crop+normalize to the content bounds. When there
 *  are no measurable nodes we fall back to the element's natural box (no
 *  transform override) so we never produce a zero-size image. */
function framingOptions(viewport: HTMLElement, pad: number) {
  const box = contentBounds(viewport);
  if (!box) return {};
  const width = Math.ceil(box.width + pad * 2);
  const height = Math.ceil(box.height + pad * 2);
  // Translate so the top-left of the content (minus pad) sits at the origin,
  // and drop the live zoom (scale 1) — html-to-image then rasterizes exactly
  // the [width×height] region we sized to the diagram.
  return {
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${pad - box.minX}px, ${pad - box.minY}px) scale(1)`,
      transformOrigin: "0 0",
    },
  };
}

export function downloadDataUrl(name: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/** Uniform padding (viewport px) around the diagram in the exported image. */
const EXPORT_PAD = 32;

/** Render the diagram to a PNG or SVG data-url and trigger a download. Framed
 *  to the full diagram's bounds (no dead space, nothing clipped) regardless of
 *  the current pan/zoom. */
export async function exportDiagramImage(kind: "png" | "svg", name = "architecture") {
  const el = captureTarget();
  if (!el) return;
  const { toPng, toSvg } = await import("html-to-image");
  const opts = {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    cacheBust: true,
    ...framingOptions(el, EXPORT_PAD),
  };
  const dataUrl = kind === "png" ? await toPng(el, opts) : await toSvg(el, opts);
  downloadDataUrl(`${name}.${kind}`, dataUrl);
}

/** Capture the live diagram as a PNG data-url WITHOUT downloading it. Used by
 *  the passive auto-snapshot: the open tab POSTs this back so the agent can
 *  read a rendered image of the diagram. Returns null if the canvas isn't
 *  mounted (no tab-open / not on the Architecture tab). Same full-diagram
 *  framing as the download so the agent sees the whole thing, not the user's
 *  current pan/zoom. */
export async function captureDiagramPngDataUrl(): Promise<string | null> {
  const el = captureTarget();
  if (!el) return null;
  const { toPng } = await import("html-to-image");
  // Slightly lower pixelRatio than the download (this is for the agent to
  // "see", not a poster) to keep the POST payload small. skipFonts avoids
  // html-to-image trying to inline cross-origin Google Fonts CSS (which throws
  // a harmless SecurityError on cssRules); system fonts render fine for the
  // agent's snapshot.
  return toPng(el, {
    backgroundColor: "#ffffff",
    pixelRatio: 1.5,
    cacheBust: true,
    skipFonts: true,
    ...framingOptions(el, EXPORT_PAD),
  });
}
