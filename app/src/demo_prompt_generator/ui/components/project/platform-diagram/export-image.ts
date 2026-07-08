/**
 * platform-diagram/export-image — capture the rendered diagram as PNG/SVG.
 * Shared by the app's Architecture tab (chrome-bar Download menu) and the
 * standalone editor toolbar. `html-to-image` is lazy-imported on click so it
 * never weighs on the initial bundle.
 */

/** The element to capture: the ReactFlow viewport (the transformed layer
 *  holding the nodes) — falls back to the pane. */
function captureTarget(): HTMLElement | null {
  return (
    (document.querySelector(".react-flow__viewport") as HTMLElement | null) ??
    (document.querySelector(".react-flow") as HTMLElement | null)
  );
}

export function downloadDataUrl(name: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/** Render the diagram to a PNG or SVG data-url and trigger a download. */
export async function exportDiagramImage(kind: "png" | "svg", name = "architecture") {
  const el = captureTarget();
  if (!el) return;
  const { toPng, toSvg } = await import("html-to-image");
  const opts = { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true };
  const dataUrl = kind === "png" ? await toPng(el, opts) : await toSvg(el, opts);
  downloadDataUrl(`${name}.${kind}`, dataUrl);
}

/** Capture the live diagram as a PNG data-url WITHOUT downloading it. Used by
 *  the passive auto-snapshot: the open tab POSTs this back so the agent can
 *  read a rendered image of the diagram. Returns null if the canvas isn't
 *  mounted (no tab-open / not on the Architecture tab). */
export async function captureDiagramPngDataUrl(): Promise<string | null> {
  const el = captureTarget();
  if (!el) return null;
  const { toPng } = await import("html-to-image");
  // Slightly lower pixelRatio than the download (this is for the agent to
  // "see", not a poster) to keep the POST payload small. skipFonts avoids
  // html-to-image trying to inline cross-origin Google Fonts CSS (which throws
  // a harmless SecurityError on cssRules); system fonts render fine for the
  // agent's snapshot.
  return toPng(el, { backgroundColor: "#ffffff", pixelRatio: 1.5, cacheBust: true, skipFonts: true });
}
