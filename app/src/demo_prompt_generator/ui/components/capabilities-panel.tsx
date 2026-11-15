/**
 * CapabilitiesPanel — the home-page picker, split into two tabs.
 *
 *   • "Simple solution" (default) — a curated baseline: synthetic
 *     data → dashboard + Genie + Unity Catalog. Optional opt-in for the
 *     Databricks App + Lakebase pair via one toggle. Everything else is
 *     hidden so first-time users get a fast path.
 *
 *   • "Custom solution" — the full `ProductSelector`, inline under the
 *     tabs, so power users can pick exactly what they want.
 *
 * The Genie Code workshop uses the same two tabs: Simple = WORKSHOP_SIMPLE
 * hard-locked (the reference workshop minus ML), Custom = WORKSHOP_BASELINE
 * (everything but Feature Store), editable.
 *
 * Both tabs write to the same `selectedProducts` set in the parent, so
 * the downstream build CTA + confirm dialog behave identically regardless
 * of which tab the user used to make selections.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  "aibi-dashboards",
  "genie",
] as const;
const SIMPLE_TALK_TRACK = [
  // Unity Catalog is part of every demo but no longer rendered as a tile (to
  // save horizontal space) — it stays in the baseline via the talk track.
  "unity-catalog",
  "lakeflow-connect",
  "genie-one",
  "genie-code",
] as const;
export const SIMPLE_BASELINE = [
  ...SIMPLE_VISIBLE_TILES,
  ...SIMPLE_TALK_TRACK,
] as const;

// Genie Code workshop baseline = exactly what the reference workshop HTML
// covers (synthetic data → notebooks EDA → SDP → quality → jobs → dashboards →
// Genie → metric views → governance → ML → Genie Code/One → AI functions).
// No app/lakebase/documents (hidden in the workshop). Every id must exist in
// references/blocks/capabilities/*.md.
export const WORKSHOP_BASELINE = [
  "synthetic-data-gen",
  "notebooks-eda",
  "sdp",
  "lakeflow-jobs",
  "aibi-dashboards",
  "genie",
  "metric-views",
  "abac",
  "data-classification",
  "ml-training-serving",
  "unity-catalog",
  "genie-code",
  "genie-one",
  "ai-functions",
] as const;

// Simple workshop = the baseline without the ML page. Hard-locked like the
// story Simple tab.
export const WORKSHOP_SIMPLE = WORKSHOP_BASELINE.filter((id) => id !== "ml-training-serving");
// What the Simple workshop summary names (the rest rides along).
const WORKSHOP_SIMPLE_VISIBLE = ["sdp", "aibi-dashboards", "genie", "metric-views", "abac"] as const;

// Optional toggle in the simple view: flip on the App + Lakebase pair
// together (matches the merged bundle in the custom view).
export const APP_BUNDLE = ["databricks-apps", "lakebase"] as const;

// Optional documents toggle in the simple view. Unlike the app bundle it is NOT
// hard-locked off: until the user flips it, the suggest LLM may add it when the
// brief centers on PDFs / policy lookups (otherwise a PDF brief silently loses
// its documents in Simple mode). Shown only when the capability is offered
// (the Genie Code workshop filters it out).
export const DOCS_CAPABILITY = "unstructured-documents";
type DocsChoice = "selected" | "unselected" | null;

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
  /** Hide the "add a custom app + Lakebase backend" toggle — set in the Genie
   *  Code workshop, where apps + Lakebase aren't available. */
  hideAppBundle?: boolean;
  /** Genie Code workshop: Simple locks to WORKSHOP_SIMPLE (no app bundle),
   *  Custom starts from WORKSHOP_BASELINE, every id explicitly selected. */
  workshop?: boolean;
  /** Notified whenever the active tab changes (and once on mount with the
   *  initial tab). Lets the home page drive its own UX off Simple vs Custom
   *  — e.g. a bigger free-type input + no story suggestions in Custom. */
  onTabChange?: (tab: "simple" | "custom") => void;
  /** Horizontal alignment of the tab header + summary. "center" (default) for
   *  the standalone layout; "left" when the panel sits in a row beside the
   *  Build button so both hug their respective edges. */
  align?: "center" | "left";
}

// Build the explicit-status map for Simple mode: every baseline id (+ app
// bundle if on) marked "selected", every other known capability marked
// "unselected" (hard lock — prevents the LLM from suggesting extras). The
// documents capability follows the user's choice; with no choice yet it is left
// out of the map (null → the LLM decides from the brief). The workshop can't
// build documents, so there it is locked off like any other extra.
export function buildSimpleExplicit(
  knownIds: string[],
  appOn: boolean,
  workshop = false,
  docs: DocsChoice = null,
): Map<string, "selected" | "unselected"> {
  const selected = buildSimpleSelected(appOn, workshop, docs === "selected");
  const m = new Map<string, "selected" | "unselected">();
  for (const id of knownIds) {
    if (id === DOCS_CAPABILITY && !workshop) {
      if (docs) m.set(id, docs);
      continue;
    }
    m.set(id, selected.has(id) ? "selected" : "unselected");
  }
  return m;
}

export function buildSimpleSelected(appOn: boolean, workshop = false, docsOn = false): Set<string> {
  const s = new Set<string>(workshop ? WORKSHOP_SIMPLE : SIMPLE_BASELINE);
  if (appOn && !workshop) for (const id of APP_BUNDLE) s.add(id);
  if (docsOn && !workshop) s.add(DOCS_CAPABILITY);
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
  hideAppBundle = false,
  workshop = false,
  onTabChange,
  align = "center",
}: Props) {
  const [tab, setTab] = useState<"simple" | "custom">(initialTab);
  // Tell the parent the initial tab once on mount (so its input size / suggest
  // gating starts in the right mode).
  useEffect(() => {
    onTabChange?.(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const docs = explicitSelections.get(DOCS_CAPABILITY) ?? null;
    const nextSelected = buildSimpleSelected(appOn, workshop, docs === "selected");
    const nextExplicit = buildSimpleExplicit(allKnown, appOn, workshop, docs);
    onReplaceSelection(nextSelected, nextExplicit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, capabilities.length, workshop]);

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
        } else if (workshop) {
          // Workshop Custom starts from the full workshop baseline (everything
          // but Feature Store), marked selected so the suggest LLM keeps it;
          // the user deselects what they don't want.
          onReplaceSelection(
            new Set<string>(WORKSHOP_BASELINE),
            new Map(WORKSHOP_BASELINE.map((id) => [id, "selected" as const])),
          );
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
      onTabChange?.(nextTab);
    },
    [tab, selectedProducts, explicitSelections, onReplaceSelection, onTabChange, workshop],
  );

  // App-bundle toggle in Simple — just re-runs the lock with the new
  // app state and lets onReplaceSelection take care of the rest.
  const appBundleOn = APP_BUNDLE.some((id) => selectedProducts.has(id));
  // On when the user turned it on OR the LLM picked it (no explicit choice yet).
  const docsOn = selectedProducts.has(DOCS_CAPABILITY);
  const docsChoice: DocsChoice = explicitSelections.get(DOCS_CAPABILITY) ?? null;
  const docsOffered = capabilities.some((c) => c.id === DOCS_CAPABILITY);
  const allKnown = capabilities.map((c) => c.id);
  const toggleAppBundle = () => {
    const nextAppOn = !appBundleOn;
    onReplaceSelection(
      buildSimpleSelected(nextAppOn, workshop, docsOn),
      buildSimpleExplicit(allKnown, nextAppOn, workshop, docsChoice),
    );
  };
  // Flipping the chip is an explicit choice either way (on = selected, off =
  // unselected), so the LLM can no longer re-add documents the user removed.
  const toggleDocs = () => {
    const next: DocsChoice = docsOn ? "unselected" : "selected";
    onReplaceSelection(
      buildSimpleSelected(appBundleOn, workshop, next === "selected"),
      buildSimpleExplicit(allKnown, appBundleOn, workshop, next),
    );
  };

  const pickerClass = cn(
    "grid transition-all duration-300 ease-in-out",
    expanded ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0 overflow-hidden",
  );

  return (
    <div className={pickerClass}>
      <div className={cn(!expanded && "overflow-hidden")}>
        <div>
          <Tabs value={tab} onValueChange={(v) => handleTabChange(v as "simple" | "custom")}>
            <div
              className={cn(
                "flex flex-col mb-2.5",
                align === "left" ? "items-start text-left" : "items-center text-center",
              )}
            >
              <TabsList>
                <TabsTrigger value="simple">{workshop ? "Simple workshop" : "Simple solution"}</TabsTrigger>
                <TabsTrigger value="custom">{workshop ? "Custom workshop" : "Custom solution"}</TabsTrigger>
              </TabsList>
            </div>

            {/* SIMPLE — curated baseline. Collapsed to a one-line summary by
                default (the baseline is predictable); the optional app/lakebase
                pair is a compact inline chip when expanded. */}
            <TabsContent value="simple" className="mt-0">
              <SimpleSummary
                isLoading={isLoading}
                align={align}
                workshop={workshop}
                appBundle={
                  hideAppBundle || workshop
                    ? undefined
                    : { on: appBundleOn, onToggle: toggleAppBundle, disabled: isLoading }
                }
                docs={
                  docsOffered
                    ? { on: docsOn, onToggle: toggleDocs, disabled: isLoading }
                    : undefined
                }
              />
            </TabsContent>

            {/* CUSTOM — the full picker, inline (no popover) so every tile is
                visible at once and the page just grows. */}
            <TabsContent value="custom" className="mt-0">
              <div className="rounded-xl border border-border/60 bg-muted/10 px-3 pb-3 pt-2.5 text-left">
                <ProductSelector
                  capabilities={capabilities}
                  selectedProducts={selectedProducts}
                  onToggleProduct={onToggleProduct}
                  expanded={true}
                  isLoading={isLoading}
                  explicitSelections={explicitSelections}
                />
              </div>
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

// One-line Simple baseline: "Included: Synthetic Data · AI/BI Dashboard · Genie
// Agent" on the left, and a compact toggle on the right to add the App +
// Lakebase pair. When the app is on, a small note flags the longer build.
type ChipToggle = { on: boolean; onToggle: () => void; disabled?: boolean };

// Compact on/off pill used for the Simple-view add-ons.
function ToggleChip({
  toggle,
  label,
  onLabel,
  offLabel,
}: {
  toggle: ChipToggle;
  label: string;
  onLabel: string;
  offLabel: string;
}) {
  const { on } = toggle;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={toggle.onToggle}
      disabled={toggle.disabled}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        on
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-primary/40 bg-primary/5 text-primary/90 hover:bg-primary/10 hover:border-primary/60",
      )}
    >
      {on ? onLabel : offLabel}
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted-foreground/40",
        )}
      >
        <span
          className={cn(
            "inline-block h-3 w-3 transform rounded-full bg-background shadow transition-transform",
            on ? "translate-x-[14px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  );
}

function SimpleSummary({
  isLoading,
  appBundle,
  docs,
  align = "center",
  workshop = false,
}: {
  isLoading: boolean;
  appBundle?: ChipToggle;
  docs?: ChipToggle;
  align?: "center" | "left";
  workshop?: boolean;
}) {
  const names = (workshop ? WORKSHOP_SIMPLE_VISIBLE : SIMPLE_VISIBLE_TILES).map(
    (id) => CAPABILITY_META[id]?.display ?? id,
  );
  const appOn = !!appBundle?.on;
  const docsOn = !!docs?.on;
  return (
    <div
      className={cn(
        "flex w-fit max-w-2xl flex-col gap-1 rounded-lg border border-border/50 bg-muted/20 px-4 py-2",
        align === "center" && "mx-auto",
        isLoading && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Included:</span>{" "}
          {names.join(" · ")}
        </span>
        {docs && (
          <ToggleChip
            toggle={docs}
            label="Add PDF documents the Genie agent answers from"
            onLabel="PDF documents"
            offLabel="+ PDF documents"
          />
        )}
        {appBundle && (
          <ToggleChip
            toggle={appBundle}
            label="Add a custom app + Lakebase backend"
            onLabel="App + Lakebase"
            offLabel="+ Add app"
          />
        )}
      </div>
      {/* "Takes longer" notes — inside the box, under the Included line. */}
      {(appOn || docsOn) && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Zap className="mt-0.5 h-3 w-3 shrink-0 text-primary/60" />
          {appOn && docsOn
            ? "Adding PDF documents and an app + Lakebase backend makes the build take longer."
            : appOn
              ? "Adding an app + Lakebase backend makes the build take longer."
              : "PDF documents are generated and indexed for the Genie agent, which adds a few minutes to the build."}
        </p>
      )}
    </div>
  );
}

