/**
 * CapabilitiesPanel — the home-page picker, split into two tabs.
 *
 *   • "Simple Databricks demo" (default) — a curated baseline: synthetic
 *     data → dashboard + Genie + Unity Catalog. Optional opt-in for the
 *     Databricks App + Lakebase pair via one toggle. Everything else is
 *     hidden so first-time users get a fast path.
 *
 *   • "Custom solution" — the full `ProductSelector` so power users can
 *     pick exactly what they want.
 *
 * Both tabs write to the same `selectedProducts` set in the parent, so
 * the downstream build CTA + confirm dialog behave identically regardless
 * of which tab the user used to make selections.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DATABRICKS_ICONS } from "@/components/databricks-icons";
import { TIER_CONFIG, type TierType } from "@/lib/architecture-schema";
import { CAPABILITY_META } from "@/lib/capabilities";
import { Capability } from "@/lib/custom-api";
import { ProductSelector } from "@/components/product-selector";

// Full capability set the AI should see when in Simple mode. Three groups:
//   • SIMPLE_VISIBLE_TILES — rendered as tiles in the UI. The user-visible
//     story arc: synthetic data → governance → dashboard → conversational.
//   • SIMPLE_TALK_TRACK — sent to the suggest LLM for context (so it can
//     anchor the story in a realistic stack) but NOT rendered as tiles.
//     Same hidden-from-listing slugs as project-overview's HIDDEN_SLUGS.
//   • APP_BUNDLE — optional add-on toggled by the app/lakebase switch.
const SIMPLE_VISIBLE_TILES = [
  "synthetic-data-gen",
  "unity-catalog",
  "aibi-dashboards",
  "genie",
] as const;
const SIMPLE_TALK_TRACK = [
  "lakeflow-connect",
  "genie-one",
  "genie-code",
] as const;
export const SIMPLE_BASELINE = [
  ...SIMPLE_VISIBLE_TILES,
  ...SIMPLE_TALK_TRACK,
] as const;

// Optional toggle in the simple view: flip on the App + Lakebase pair
// together (matches the merged bundle in the custom view).
export const APP_BUNDLE = ["databricks-apps", "lakebase"] as const;

// Tier override per capability id — must mirror the same map in
// product-selector.tsx so a capability tile reads the same color across
// both surfaces. Kept local + minimal (only the ids the simple view
// actually renders).
const CAPABILITY_TIER: Partial<Record<string, TierType>> = {
  "synthetic-data-gen": "ingest",
  "unity-catalog": "governance",
  "aibi-dashboards": "analytics",
  "genie": "ai",
  "databricks-apps": "interface",
  "lakebase": "ingest",
};

interface Props {
  capabilities: Capability[];
  selectedProducts: Set<string>;
  onToggleProduct: (productId: string) => void;
  /** Replace the entire selection AND explicit-status map in one op.
   *  Caller (this panel) computes the right semantics per tab:
   *    - Simple → hard-lock: every non-baseline id explicit "unselected".
   *    - Custom → user-driven: only ids the user touched are explicit. */
  onReplaceSelection: (
    nextSelected: Set<string>,
    nextExplicit: Map<string, "selected" | "unselected">,
  ) => void;
  expanded: boolean;
  isLoading?: boolean;
  explicitSelections?: Map<string, "selected" | "unselected">;
  /** Which tab to open on. The build-from-architecture dialog passes "custom"
   *  when the diagram doesn't fit the simple baseline. Default "simple". */
  initialTab?: "simple" | "custom";
}

// Build the explicit-status map for Simple mode: every baseline id (+ app
// bundle if on) marked "selected", every other known capability marked
// "unselected" (hard lock — prevents the LLM from suggesting extras).
function buildSimpleExplicit(
  knownIds: string[],
  appOn: boolean,
): Map<string, "selected" | "unselected"> {
  const selected = new Set<string>(SIMPLE_BASELINE);
  if (appOn) for (const id of APP_BUNDLE) selected.add(id);
  const m = new Map<string, "selected" | "unselected">();
  for (const id of knownIds) {
    m.set(id, selected.has(id) ? "selected" : "unselected");
  }
  return m;
}

function buildSimpleSelected(appOn: boolean): Set<string> {
  const s = new Set<string>(SIMPLE_BASELINE);
  if (appOn) for (const id of APP_BUNDLE) s.add(id);
  return s;
}

export function CapabilitiesPanel({
  capabilities,
  selectedProducts,
  onToggleProduct,
  onReplaceSelection,
  expanded,
  isLoading = false,
  explicitSelections = new Map(),
  initialTab = "simple",
}: Props) {
  const [tab, setTab] = useState<"simple" | "custom">(initialTab);

  // Per-tab memory. Each entry stores (selectedProducts, explicitSelections)
  // for that tab so the user can switch back and forth without losing
  // their work in the other tab. The active tab's tuple lives in the
  // parent's state; the OTHER tab's tuple lives here, swapped in on
  // tab change.
  //
  // Custom-tab starts UNINITIALIZED — the first time the user enters
  // Custom we seed it with the current Simple selection (per spec: the
  // user sees the baseline as the starting point, every other id null
  // so the AI can suggest extras).
  const tabMemoryRef = useRef<{
    simple?: { selected: Set<string>; explicit: Map<string, "selected" | "unselected"> };
    custom?: { selected: Set<string>; explicit: Map<string, "selected" | "unselected"> };
  }>({});

  // Whenever the simple tab is the ACTIVE one, lock the selection to
  // the baseline (+ app bundle if currently on). Runs on tab entry AND
  // when capabilities first load (the lock needs the full universe so
  // it can mark every non-baseline id as explicitly unselected).
  useEffect(() => {
    if (tab !== "simple") return;
    if (capabilities.length === 0) return;
    const allKnown = capabilities.map((c) => c.id);
    const appOn = APP_BUNDLE.some((id) => selectedProducts.has(id));
    const nextSelected = buildSimpleSelected(appOn);
    const nextExplicit = buildSimpleExplicit(allKnown, appOn);
    onReplaceSelection(nextSelected, nextExplicit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, capabilities.length]);

  // Tab switch handler — saves the LEAVING tab's state, restores the
  // ENTERING tab's state. First-time Custom entry seeds from the current
  // Simple selection (so the user keeps what they were looking at).
  const handleTabChange = useCallback(
    (nextTab: "simple" | "custom") => {
      if (nextTab === tab) return;
      // Save the leaving tab's tuple.
      tabMemoryRef.current[tab] = {
        selected: new Set(selectedProducts),
        explicit: new Map(explicitSelections),
      };
      if (nextTab === "custom") {
        // Restore Custom memory if any; otherwise seed from current
        // (Simple) selection — the user sees their picks carry over,
        // but Custom's explicit map only carries the BASELINE as
        // "selected" with everything else NULL (LLM may decide).
        const remembered = tabMemoryRef.current.custom;
        if (remembered) {
          onReplaceSelection(remembered.selected, remembered.explicit);
        } else {
          const seedSelected = new Set(selectedProducts);
          const seedExplicit = new Map<string, "selected" | "unselected">();
          // Mark only the currently-selected ids as explicit "selected".
          // Everything else stays absent → null → LLM is free to suggest.
          for (const id of seedSelected) seedExplicit.set(id, "selected");
          onReplaceSelection(seedSelected, seedExplicit);
        }
      }
      // For "simple" entry the lock effect above (deps: [tab]) takes
      // over once we flip the state, so we don't need a manual restore
      // here. The lock always reconstructs from SIMPLE_BASELINE + appOn.
      setTab(nextTab);
    },
    [tab, selectedProducts, explicitSelections, onReplaceSelection],
  );

  // App-bundle toggle in Simple — just re-runs the lock with the new
  // app state and lets onReplaceSelection take care of the rest.
  const appBundleOn = APP_BUNDLE.some((id) => selectedProducts.has(id));
  const toggleAppBundle = () => {
    const nextAppOn = !appBundleOn;
    const allKnown = capabilities.map((c) => c.id);
    onReplaceSelection(
      buildSimpleSelected(nextAppOn),
      buildSimpleExplicit(allKnown, nextAppOn),
    );
  };

  return (
    <div
      className={cn(
        "grid transition-all duration-300 ease-in-out overflow-hidden",
        expanded ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0",
      )}
    >
      <div className="overflow-hidden">
        <div className="border-t border-border/50 pt-4">
          <Tabs value={tab} onValueChange={(v) => handleTabChange(v as "simple" | "custom")}>
            <div className="flex flex-col items-center text-center gap-3 mb-4">
              <TabsList>
                <TabsTrigger value="simple">Simple Databricks demo</TabsTrigger>
                <TabsTrigger value="custom">Custom solution</TabsTrigger>
              </TabsList>
            </div>

            {/* SIMPLE — curated baseline + optional app/lakebase pair */}
            <TabsContent value="simple" className="mt-0">
              <div className="flex flex-col items-center gap-4">
                <BaselineRow isLoading={isLoading} />

                <AppBundleToggle
                  on={appBundleOn}
                  onToggle={toggleAppBundle}
                  disabled={isLoading}
                />

                <button
                  type="button"
                  onClick={() => handleTabChange("custom")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer underline underline-offset-2 decoration-muted-foreground/40 hover:decoration-foreground"
                >
                  Need more control? Switch to Custom solution
                </button>
              </div>
            </TabsContent>

            {/* CUSTOM — the original granular picker */}
            <TabsContent value="custom" className="mt-0">
              <ProductSelector
                capabilities={capabilities}
                selectedProducts={selectedProducts}
                onToggleProduct={onToggleProduct}
                // `expanded` is now driven by the tab framework; force-true
                // here so the inner selector always shows its content.
                expanded={true}
                isLoading={isLoading}
                explicitSelections={explicitSelections}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple-view widgets
// ---------------------------------------------------------------------------

function BaselineRow({ isLoading }: { isLoading: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-2 transition-opacity",
        isLoading && "opacity-60",
      )}
    >
      {SIMPLE_VISIBLE_TILES.map((id, i) => (
        <div key={id} className="flex items-center gap-2">
          <BaselineTile id={id} />
          {i < SIMPLE_VISIBLE_TILES.length - 1 && (
            <span
              className="text-muted-foreground/40 text-xs select-none"
              aria-hidden
            >
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BaselineTile({ id }: { id: string }) {
  const meta = CAPABILITY_META[id];
  const Icon = meta ? DATABRICKS_ICONS[meta.icon] : null;
  const tier = CAPABILITY_TIER[id] ?? "ai";
  const cfg = TIER_CONFIG[tier];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-xl border",
        cfg.bg,
        cfg.border,
      )}
      title={meta?.display ?? id}
    >
      <div
        className={cn(
          "shrink-0 flex items-center justify-center h-7 w-7 rounded-md border",
          cfg.bg,
          cfg.border,
        )}
      >
        {Icon ? <Icon className={cn("h-4 w-4", cfg.color)} /> : null}
      </div>
      <span className="text-[12.5px] font-medium text-foreground">
        {meta?.display ?? id}
      </span>
    </div>
  );
}

function AppBundleToggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const appMeta = CAPABILITY_META["databricks-apps"];
  const lakebaseMeta = CAPABILITY_META["lakebase"];
  const AppIcon = appMeta ? DATABRICKS_ICONS[appMeta.icon] : null;
  const LakeIcon = lakebaseMeta ? DATABRICKS_ICONS[lakebaseMeta.icon] : null;
  const cfg = TIER_CONFIG[CAPABILITY_TIER["databricks-apps"] ?? "interface"];

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 w-full max-w-xl rounded-xl border px-4 py-3 transition-colors",
        on
          ? cn(cfg.bg, cfg.border)
          : "bg-muted/20 border-border/50 hover:border-primary/30",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "shrink-0 flex items-center gap-0.5 px-1 h-8 rounded-md border",
            on ? cn(cfg.bg, cfg.border) : "bg-muted/40 border-border/40",
          )}
        >
          {AppIcon && (
            <AppIcon
              className={cn(
                "h-4 w-4",
                on ? cfg.color : "text-muted-foreground/60",
              )}
            />
          )}
          {LakeIcon && (
            <LakeIcon
              className={cn(
                "h-4 w-4",
                on ? cfg.color : "text-muted-foreground/60",
              )}
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">
            Add a custom app + Lakebase backend
          </p>
          <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
            Ships a Databricks App with a Postgres data layer — for hands-on,
            interactive demos. Adds a few minutes to the build.
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
          on ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
            on ? "translate-x-[22px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </div>
  );
}
