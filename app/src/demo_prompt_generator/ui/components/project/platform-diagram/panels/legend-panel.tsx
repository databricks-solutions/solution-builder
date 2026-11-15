/**
 * platform-diagram/panels/legend-panel — the READABLE legend.
 *
 * A numbered diagram keys spots on the canvas (`type:"callout"` circles, or
 * numbered edge labels) to sentences. Those sentences have two homes:
 *
 *   • ON the canvas — a derived box (see LEGEND_NODE_ID); it ships inside the
 *     PNG/SVG export, so a customer gets a self-contained picture; and/or
 *   • HERE — chrome OUTSIDE `.react-flow`, so it is EXCLUDED from the image
 *     export but always legible in the HTML (in-app and in the standalone
 *     viewer/editor), at real UI text size and selectable/copyable.
 *
 * `legend.show` picks which ("diagram" | "panel" | "both"). This panel renders
 * whenever the tab HAS a legend, regardless of `show`: with `show:"diagram"`
 * it's the same content in a form you can read and copy; with `show:"panel"`
 * it's the only home. Read-only — the legend is authored in `architecture.md`.
 */
import { memo } from "react";
import { X } from "lucide-react";
import { legendEntries, type LegendSpec } from "@/lib/platform-architecture";

export const LegendPanel = memo(function LegendPanel({
  legend,
  onClose,
}: {
  legend: LegendSpec;
  onClose: () => void;
}) {
  const entries = legendEntries(legend);
  if (!entries.length) return null;
  const onCanvas = (legend.show ?? "both") !== "panel";
  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-96 max-w-[92vw] flex-col border-l border-border bg-background shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-foreground">
            {legend.title?.trim() || "Legend"}
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {onCanvas
              ? "Also drawn on the diagram — included in the image export."
              : "Not drawn on the diagram — this panel is its only home."}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ol className="space-y-2.5">
          {entries.map((e) => (
            <li key={e.n} className="flex items-start gap-2.5">
              {/* Mirrors the on-canvas callout circle so the number reads as the
                  same object in both places. */}
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[10.5px] font-bold text-primary-foreground">
                {e.n}
              </span>
              <span className="select-text text-[12.5px] leading-snug text-foreground">{e.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
