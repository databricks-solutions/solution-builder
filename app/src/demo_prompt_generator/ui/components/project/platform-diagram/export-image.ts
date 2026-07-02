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
