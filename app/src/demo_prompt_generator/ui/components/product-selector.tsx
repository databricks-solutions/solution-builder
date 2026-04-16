/**
 * Product capability selector for demo creation.
 * Shows categories horizontally with toggleable product chips.
 * Capabilities are loaded from the API.
 */

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Capability } from "@/lib/custom-api";
import { useMemo } from "react";
import { Loader2, Check, X } from "lucide-react";

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

// Convert API capabilities to ProductCategory structure
function capabilitiesToCategories(capabilities: Capability[]): ProductCategory[] {
  const categoryMap = new Map<string, Product[]>();

  for (const cap of capabilities) {
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

export function ProductSelector({
  capabilities,
  selectedProducts,
  onToggleProduct,
  expanded,
  isLoading = false,
  explicitSelections = new Map(),
}: ProductSelectorProps) {
  // Memoize the category transformation
  const categories = useMemo(
    () => capabilitiesToCategories(capabilities),
    [capabilities]
  );

  return (
    <TooltipProvider delayDuration={100}>
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out overflow-hidden",
          expanded ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0 mt-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs text-muted-foreground">
                Select capabilities to include in your demo:
              </p>
              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="italic">AI is helping you pick the key Databricks capabilities...</span>
                </div>
              )}
            </div>
            <div className="relative">
              <div className={cn(
                "flex gap-4 overflow-x-auto transition-opacity duration-200",
                isLoading && "opacity-50 pointer-events-none"
              )}>
                {categories.map((category) => (
                <div key={category.id} className="shrink-0">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    {category.name}
                  </p>
                  <div className="flex flex-col gap-1">
                    {category.products.map((product) => {
                      // Render separator as spacing
                      if (product.id === "_separator") {
                        return <div key={product.id} className="h-1.5" />;
                      }
                      const isSelected = selectedProducts.has(product.id);
                      const isUnavailable = product.unavailable || isLoading;
                      const explicitStatus = explicitSelections.get(product.id);
                      const isExplicitlySelected = explicitStatus === "selected";
                      const isExplicitlyUnselected = explicitStatus === "unselected";

                      return (
                        <Tooltip key={product.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => !isUnavailable && onToggleProduct(product.id)}
                              disabled={isUnavailable}
                              className={cn(
                                "px-2 py-0.5 text-xs rounded-md border transition-all text-left whitespace-nowrap flex items-center gap-1",
                                isUnavailable
                                  ? "bg-muted/30 border-border/30 text-muted-foreground/50 cursor-not-allowed"
                                  : "cursor-pointer",
                                // Selected states
                                !isUnavailable && isSelected && isExplicitlySelected
                                  ? "bg-primary/15 border-primary/40 text-primary font-medium"
                                  : !isUnavailable && isSelected
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : null,
                                // Unselected states
                                !isUnavailable && !isSelected && isExplicitlyUnselected
                                  ? "bg-muted/40 border-border/60 text-muted-foreground/70"
                                  : !isUnavailable && !isSelected
                                    ? "bg-background/60 border-border/50 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                                    : null
                              )}
                            >
                              {/* Show icon for explicit user selections */}
                              {isExplicitlySelected && (
                                <Check className="h-3 w-3 shrink-0" />
                              )}
                              {isExplicitlyUnselected && (
                                <X className="h-3 w-3 shrink-0" />
                              )}
                              {product.name}
                            </button>
                          </TooltipTrigger>
                          {product.description && (
                            <TooltipContent>
                              <p>{product.description}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
