/**
 * Product capability selector for solution creation.
 *
 * Visual language matches the project-overview "Databricks resources"
 * grid: each capability is an icon-card tinted by tier. Selecting toggles
 * the tile to its full-color "live" appearance; unselected tiles are
 * muted. Explicit user clicks layer a check/x glyph so the agent's
 * suggestions stay visually distinct from the user's manual overrides.
 */

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Capability } from "@/lib/custom-api";
import { useMemo, useState } from "react";
import { Check, X, Plus, Minus } from "lucide-react";
import { DATABRICKS_ICONS } from "@/components/databricks-icons";
import { TIER_CONFIG, type TierType } from "@/lib/architecture-schema";
import { CAPABILITY_META } from "@/lib/capabilities";

export interface ProductCategory {
  id: string;
  name: string;
  products: Product[];
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  unavailable?: boolean;
}

// Category order for sorting
const CATEGORY_ORDER = ["Lakeflow", "AI/BI", "Agent Bricks", "UC Governance", "Apps & Infra"];

// Capability order within categories (hardcoded for now — upgrade to backend config if needed)
// Lower numbers = higher priority (shown first). Capabilities not listed default to 50.
const CAPABILITY_ORDER: Record<string, number> = {
  // UC Governance: Unity Catalog first
  "unity-catalog": 1,
  "data-quality": 10,
  "abac": 20,
  "data-classification": 30,
  // Agent Bricks: ML + MLflow and Model Serving last
  "knowledge-assistant": 10,
  "supervisor-agent": 20,
  "information-extraction": 30,
  "vector-search": 40,
  "ai-gateway": 50,
  "model-training-mlflow": 90,
  "model-serving": 91,
};

// Capabilities hidden by default (less commonly used)
const HIDDEN_CAPABILITY_IDS = [
  "synthetic-data-gen",
  "ai-gateway",
  "marketplace",
  "ai-functions",
  "notebooks-eda",
  "vector-search",
  "zerobus-ingest",
  "lakeflow-connect",
  "delta-sharing",
  "genie-code",
  "genie-one",
];

// Tier override per capability id — mirrors project-overview's CAPABILITY_TIER
// so a capability tile reads the same color in both surfaces (home picker
// and post-build resource grid).
const CAPABILITY_TIER: Partial<Record<string, TierType>> = {
  "sdp": "sdp",
  "lakeflow-connect": "ingest",
  "lakeflow-jobs": "orchestration",
  "zerobus-ingest": "ingest",
  "delta-sharing": "ingest",
  "marketplace": "ingest",
  "synthetic-data-gen": "ingest",
  "ai-functions": "ai",
  "metric-views": "analytics",
  "knowledge-assistant": "ai",
  "supervisor-agent": "ai",
  "ml-training-serving": "ai",
  "vector-search": "ai",
  "information-extraction": "ai",
  "ai-gateway": "ai",
  "genie": "ai",
  "genie-code": "ai",
  "aibi-dashboards": "analytics",
  "notebooks-eda": "analytics",
  "databricks-apps": "interface",
  "genie-one": "interface",
  "lakebase": "ingest",
  "unity-catalog": "governance",
  "data-quality": "governance",
  "abac": "governance",
  "data-classification": "governance",
};

// Last-resort fallback when a capability id isn't in CAPABILITY_TIER —
// keyed by the source category name (Lakeflow, AI/BI, etc.).
const CATEGORY_FALLBACK_TIER: Record<string, TierType> = {
  "Lakeflow": "sdp",
  "AI/BI": "analytics",
  "Agent Bricks": "ai",
  "UC Governance": "governance",
  "Apps & Infra": "interface",
};

function tierForProduct(productId: string, categoryName: string): TierType {
  return CAPABILITY_TIER[productId] ?? CATEGORY_FALLBACK_TIER[categoryName] ?? "ai";
}

// Check if a capability should be hidden
function isHiddenCapability(cap: Capability): boolean {
  // Hide if in the static list or if disabled/unavailable
  return HIDDEN_CAPABILITY_IDS.includes(cap.id) || cap.disabled === true;
}

// Convert API capabilities to ProductCategory structure
function capabilitiesToCategories(capabilities: Capability[], showHidden: boolean): ProductCategory[] {
  const categoryMap = new Map<string, Product[]>();

  for (const cap of capabilities) {
    // Skip hidden capabilities unless showHidden is true
    if (!showHidden && isHiddenCapability(cap)) {
      continue;
    }

    if (!categoryMap.has(cap.category)) {
      categoryMap.set(cap.category, []);
    }
    categoryMap.get(cap.category)!.push({
      id: cap.id,
      name: cap.name,
      unavailable: cap.disabled,
    });
  }

  // Convert to array and sort by category order
  const categories: ProductCategory[] = [];
  for (const [categoryName, products] of categoryMap.entries()) {
    // Skip empty categories
    if (products.length === 0) continue;
    // Sort products within category by CAPABILITY_ORDER (lower = first, default = 50)
    products.sort((a, b) => {
      const aOrder = CAPABILITY_ORDER[a.id] ?? 50;
      const bOrder = CAPABILITY_ORDER[b.id] ?? 50;
      return aOrder - bOrder;
    });
    categories.push({
      id: categoryName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: categoryName,
      products,
    });
  }

  // Sort categories by defined order
  categories.sort((a, b) => {
    const aIdx = CATEGORY_ORDER.indexOf(a.name);
    const bIdx = CATEGORY_ORDER.indexOf(b.name);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return categories;
}

interface ProductSelectorProps {
  capabilities: Capability[];
  selectedProducts: Set<string>;
  onToggleProduct: (productId: string) => void;
  expanded: boolean;
  isLoading?: boolean;
  explicitSelections?: Map<string, "selected" | "unselected">;
}

// IDs that get merged into a single tile in the picker. The combined tile
// behaves as one toggle from the user's POV: clicking flips every id in
// the bundle to the same target state. The bundle is selected when ANY
// member is selected (forgiving for both directions — the build agent
// handles missing pieces gracefully).
const MERGED_BUNDLES: Array<{
  /** Stable key used for React reconciliation + lookup. */
  key: string;
  /** Capability ids in this bundle, in display order. */
  ids: string[];
  /** Display name on the tile. */
  label: string;
  /** Optional tooltip / description. */
  description?: string;
}> = [
  {
    key: "apps-and-lakebase",
    ids: ["databricks-apps", "lakebase"],
    label: "Databricks App + Lakebase",
    description:
      "Custom React/Node app served via Databricks Apps, backed by a Lakebase Postgres database. The two are functionally coupled in the template — pick them together.",
  },
];

const MERGED_IDS = new Set(MERGED_BUNDLES.flatMap((b) => b.ids));

interface ProductTileProps {
  product: Product;
  categoryName: string;
  isSelected: boolean;
  explicitStatus: "selected" | "unselected" | undefined;
  isUnavailable: boolean;
  onToggle: () => void;
}

function ProductTile({
  product,
  categoryName,
  isSelected,
  explicitStatus,
  isUnavailable,
  onToggle,
}: ProductTileProps) {
  const meta = CAPABILITY_META[product.id];
  const Icon = meta ? DATABRICKS_ICONS[meta.icon] : null;
  const tier = tierForProduct(product.id, categoryName);
  const cfg = TIER_CONFIG[tier];
  const isExplicitlySelected = explicitStatus === "selected";
  const isExplicitlyUnselected = explicitStatus === "unselected";

  return (
    <button
      type="button"
      onClick={() => !isUnavailable && onToggle()}
      disabled={isUnavailable}
      className={cn(
        "group relative w-full text-left rounded-xl border transition-all",
        isUnavailable && "opacity-50 cursor-not-allowed",
        !isUnavailable && "cursor-pointer",
        !isUnavailable && isSelected
          ? cn(
              cfg.bg,
              cfg.border,
              "hover:-translate-y-px hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]",
            )
          : !isUnavailable
            ? "bg-muted/20 border-border/40 hover:border-primary/30 hover:bg-muted/30"
            : "bg-muted/20 border-border/30",
        isExplicitlySelected && "ring-1 ring-primary/40",
        isExplicitlyUnselected && "ring-1 ring-muted-foreground/30",
      )}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <div
          className={cn(
            "shrink-0 flex items-center justify-center h-7 w-7 rounded-md",
            isSelected && !isUnavailable
              ? cn(cfg.bg, "border", cfg.border)
              : "bg-muted/40 border border-border/30",
          )}
        >
          {Icon ? (
            <Icon
              className={cn(
                "h-4 w-4",
                isSelected && !isUnavailable ? cfg.color : "text-muted-foreground/50",
              )}
            />
          ) : null}
        </div>
        <span
          className={cn(
            "flex-1 min-w-0 text-[12px] font-medium leading-tight truncate",
            isSelected && !isUnavailable ? "text-foreground" : "text-muted-foreground/70",
          )}
        >
          {product.name}
        </span>
        {isExplicitlySelected && (
          <Check className={cn("h-3 w-3 shrink-0", cfg.color)} />
        )}
        {isExplicitlyUnselected && (
          <X className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        )}
      </div>
    </button>
  );
}

interface BundleTileProps {
  bundle: (typeof MERGED_BUNDLES)[number];
  categoryName: string;
  isSelected: boolean;
  /** Single explicit status — set to "selected" / "unselected" iff ALL
   *  members carry that same status, so a half-toggled bundle (rare —
   *  the bundle's onToggle flips every member at once) doesn't show a
   *  glyph that contradicts the visual state. */
  explicitStatus: "selected" | "unselected" | undefined;
  isUnavailable: boolean;
  onToggle: () => void;
}

function BundleTile({
  bundle,
  categoryName,
  isSelected,
  explicitStatus,
  isUnavailable,
  onToggle,
}: BundleTileProps) {
  // Bundle uses the first member's tier for color — pick the
  // visually-dominant one (apps over lakebase here) when ordering matters.
  const tier = tierForProduct(bundle.ids[0], categoryName);
  const cfg = TIER_CONFIG[tier];
  const isExplicitlySelected = explicitStatus === "selected";
  const isExplicitlyUnselected = explicitStatus === "unselected";

  // Look up every member's icon so the tile shows both glyphs.
  const memberIcons = bundle.ids
    .map((id) => CAPABILITY_META[id])
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => DATABRICKS_ICONS[m.icon]);

  return (
    <button
      type="button"
      onClick={() => !isUnavailable && onToggle()}
      disabled={isUnavailable}
      className={cn(
        "group relative w-full text-left rounded-xl border transition-all",
        isUnavailable && "opacity-50 cursor-not-allowed",
        !isUnavailable && "cursor-pointer",
        !isUnavailable && isSelected
          ? cn(
              cfg.bg,
              cfg.border,
              "hover:-translate-y-px hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.15)]",
            )
          : !isUnavailable
            ? "bg-muted/20 border-border/40 hover:border-primary/30 hover:bg-muted/30"
            : "bg-muted/20 border-border/30",
        isExplicitlySelected && "ring-1 ring-primary/40",
        isExplicitlyUnselected && "ring-1 ring-muted-foreground/30",
      )}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        {/* Stacked-icon affordance: two small icons side-by-side inside
            one bordered box so the tile reads as "a paired thing", not
            two adjacent tiles that happen to share a header. */}
        <div
          className={cn(
            "shrink-0 flex items-center gap-0.5 px-1 h-7 rounded-md",
            isSelected && !isUnavailable
              ? cn(cfg.bg, "border", cfg.border)
              : "bg-muted/40 border border-border/30",
          )}
        >
          {memberIcons.map((Icon, i) => (
            <Icon
              key={i}
              className={cn(
                "h-4 w-4",
                isSelected && !isUnavailable ? cfg.color : "text-muted-foreground/50",
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            "flex-1 min-w-0 text-[12px] font-medium leading-tight truncate",
            isSelected && !isUnavailable ? "text-foreground" : "text-muted-foreground/70",
          )}
        >
          {bundle.label}
        </span>
        {isExplicitlySelected && (
          <Check className={cn("h-3 w-3 shrink-0", cfg.color)} />
        )}
        {isExplicitlyUnselected && (
          <X className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        )}
      </div>
    </button>
  );
}

export function ProductSelector({
  capabilities,
  selectedProducts,
  onToggleProduct,
  expanded,
  isLoading = false,
  explicitSelections = new Map(),
}: ProductSelectorProps) {
  const [showHidden, setShowHidden] = useState(false);

  // Count hidden capabilities dynamically
  const hiddenCount = useMemo(
    () => capabilities.filter(isHiddenCapability).length,
    [capabilities]
  );

  // Memoize the category transformation
  const categories = useMemo(() => {
    const all = capabilitiesToCategories(capabilities, showHidden);
    // Hide the UC Governance column when its only entry is `unity-catalog` —
    // a lone governance tile reads as noise on the picker. The user can
    // still surface it by toggling the "+N" advanced-capabilities button
    // (which sets showHidden=true and brings in the rest of UC Governance:
    // data-quality, abac, data-classification).
    if (showHidden) return all;
    return all.filter((cat) => {
      if (cat.name !== "UC Governance") return true;
      const realProducts = cat.products.filter((p) => p.id !== "_separator");
      const onlyUC =
        realProducts.length === 1 && realProducts[0].id === "unity-catalog";
      return !onlyUC;
    });
  }, [capabilities, showHidden]);

  return (
    <TooltipProvider delayDuration={100}>
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out overflow-hidden",
          expanded ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/50 pt-4">
            <div className="flex flex-col items-center text-center mb-4 gap-1">
              <div className="flex items-center gap-2.5">
                <p className="text-base font-semibold text-foreground">
                  Your AI-picked capabilities — adjust before you build
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setShowHidden(!showHidden)}
                      className={cn(
                        "flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border transition-all cursor-pointer",
                        showHidden
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-muted/30 border-border/50 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                      )}
                    >
                      {showHidden ? (
                        <Minus className="h-3 w-3" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      <span>{hiddenCount}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{showHidden ? "Hide" : "Show"} {hiddenCount} advanced capabilities</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                Click any tile to toggle. The more you pick, the longer the build.
              </p>
            </div>

            {/* Column-per-category layout. Each column gets its own colored
                eyebrow header mirroring project-overview's ResourceColumn. */}
            <div
              className={cn(
                "grid gap-x-4 gap-y-2 transition-opacity duration-200",
                isLoading && "opacity-50 pointer-events-none",
              )}
              style={{
                gridTemplateColumns: `repeat(${Math.min(categories.length, 5)}, minmax(180px, 1fr))`,
              }}
            >
              {categories.map((category) => {
                // Which merged bundles apply to THIS category? A bundle
                // gets attached to whichever category its first member
                // currently lives in.
                const bundlesHere = MERGED_BUNDLES.filter((b) =>
                  category.products.some((p) => p.id === b.ids[0]),
                );
                // Hide every product that was absorbed into a bundle —
                // they're represented by the merged tile instead.
                const visibleProducts = category.products.filter(
                  (p) => !MERGED_IDS.has(p.id),
                );
                // Tint the column header with the tier of the first
                // visible product (or the first bundle's first member if
                // the column is bundle-only).
                const firstId =
                  visibleProducts.find((p) => p.id !== "_separator")?.id ??
                  bundlesHere[0]?.ids[0];
                const tier = firstId
                  ? tierForProduct(firstId, category.name)
                  : "ai";
                const cfg = TIER_CONFIG[tier];
                return (
                  <div key={category.id} className="flex flex-col">
                    <div
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.14em] pb-1.5 mb-2 border-b-2",
                        cfg.color,
                      )}
                      style={{ borderColor: cfg.stripe }}
                    >
                      {category.name}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {visibleProducts.map((product) => {
                        if (product.id === "_separator") {
                          return <div key={product.id} className="h-1.5" />;
                        }
                        const isSelected = selectedProducts.has(product.id);
                        const isUnavailable = product.unavailable || isLoading;
                        const explicitStatus = explicitSelections.get(product.id);
                        const tile = (
                          <ProductTile
                            product={product}
                            categoryName={category.name}
                            isSelected={isSelected}
                            explicitStatus={explicitStatus}
                            isUnavailable={isUnavailable}
                            onToggle={() => onToggleProduct(product.id)}
                          />
                        );
                        return product.description ? (
                          <Tooltip key={product.id}>
                            <TooltipTrigger asChild>
                              <div>{tile}</div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{product.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <div key={product.id}>{tile}</div>
                        );
                      })}

                      {bundlesHere.map((bundle) => {
                        // Bundle is "selected" iff ANY of its members are.
                        // Forgiving for both directions: the agent might
                        // suggest only one and we don't want to require a
                        // second click to fully enable the pair.
                        const isSelected = bundle.ids.some((id) =>
                          selectedProducts.has(id),
                        );
                        const isUnavailable =
                          isLoading ||
                          bundle.ids.every(
                            (id) =>
                              capabilities.find((c) => c.id === id)?.disabled,
                          );

                        // Combined explicit status: only show a glyph if
                        // every member carries the same explicit status.
                        const memberStatuses = bundle.ids.map((id) =>
                          explicitSelections.get(id),
                        );
                        const combinedExplicit:
                          | "selected"
                          | "unselected"
                          | undefined =
                          memberStatuses.every((s) => s === "selected")
                            ? "selected"
                            : memberStatuses.every((s) => s === "unselected")
                              ? "unselected"
                              : undefined;

                        const tile = (
                          <BundleTile
                            bundle={bundle}
                            categoryName={category.name}
                            isSelected={isSelected}
                            explicitStatus={combinedExplicit}
                            isUnavailable={isUnavailable}
                            onToggle={() => {
                              // Drive every member toward the OPPOSITE of
                              // current bundle-selection state. If any
                              // member is already in the target state, the
                              // toggle is a no-op for that member (the
                              // per-id handler flips it, so we have to
                              // call it only when the current value
                              // differs from the target).
                              const target = !isSelected;
                              for (const id of bundle.ids) {
                                const currently = selectedProducts.has(id);
                                if (currently !== target) {
                                  onToggleProduct(id);
                                }
                              }
                            }}
                          />
                        );
                        return bundle.description ? (
                          <Tooltip key={bundle.key}>
                            <TooltipTrigger asChild>
                              <div>{tile}</div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{bundle.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <div key={bundle.key}>{tile}</div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
