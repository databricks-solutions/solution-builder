/**
 * Product capability selector for demo creation.
 * Shows categories horizontally with toggleable product chips.
 */

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

// Product categories and their features
export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    id: "data-processing",
    name: "Data Processing",
    products: [
      { id: "lakeflow-connect", name: "Lakeflow Connect", description: "Managed connectors for SaaS, DBs, files" },
      { id: "sdp", name: "SDP", description: "Spark Declarative Pipelines" },
      { id: "lakeflow-jobs", name: "Lakeflow Jobs", description: "Workflow orchestration" },
      { id: "ai-query", name: "AI Query", description: "Natural language to SQL in notebooks — coming soon!", unavailable: true },
    ],
  },
  {
    id: "ai-bi",
    name: "AI/BI",
    products: [
      { id: "dashboards", name: "Dashboards", description: "AI-assisted dashboards" },
      { id: "genie", name: "Genie", description: "Natural language BI" },
      { id: "metric-views", name: "Metric Views", description: "Centralized semantic layer for consistent metrics" },
      { id: "databricks-sql", name: "Databricks SQL", description: "Serverless data warehouse" },
    ],
  },
  {
    id: "ai-genai-ml",
    name: "AI/GenAI and ML",
    products: [
      { id: "vector-search", name: "Vector Search", description: "Managed embeddings for RAG — coming soon!", unavailable: true },
      { id: "knowledge-assistant", name: "Knowledge Assistant", description: "Managed RAG agent for documents" },
      { id: "supervisor-agent", name: "Supervisor Agent", description: "Multi-agent orchestration" },
      { id: "_separator", name: "", description: "" }, // Visual separator
      { id: "model-training-mlflow", name: "Model Training + MLflow", description: "EDA, experiments, model registry" },
      { id: "model-serving", name: "Model Serving", description: "Serverless model endpoints — coming soon!", unavailable: true },
    ],
  },
  {
    id: "governance",
    name: "Governance",
    products: [
      { id: "unity-catalog", name: "Unity Catalog", description: "Unified governance" },
      { id: "delta-sharing", name: "Delta Sharing", description: "Zero-copy data sharing — coming soon!", unavailable: true },
      { id: "abac", name: "ABAC", description: "Attribute-based access control — coming soon!", unavailable: true },
      { id: "data-classification", name: "Data Classification", description: "Automatic data tagging — coming soon!", unavailable: true },
      { id: "data-quality", name: "Data Quality", description: "Quality monitoring — coming soon!", unavailable: true },
    ],
  },
  {
    id: "apps",
    name: "Apps",
    products: [
      { id: "databricks-apps", name: "Databricks Apps", description: "Serverless app runtime — coming soon!", unavailable: true },
      { id: "lakebase", name: "Lakebase", description: "Managed Postgres — coming soon!", unavailable: true },
    ],
  },
];

interface ProductSelectorProps {
  selectedProducts: Set<string>;
  onToggleProduct: (productId: string) => void;
  expanded: boolean;
}

export function ProductSelector({
  selectedProducts,
  onToggleProduct,
  expanded,
}: ProductSelectorProps) {
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
            <p className="text-xs text-muted-foreground mb-2.5">
              Select capabilities to include in your demo:
            </p>
            <div className="flex gap-4 overflow-x-auto">
              {PRODUCT_CATEGORIES.map((category) => (
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
                    const isUnavailable = product.unavailable;
                    return (
                      <Tooltip key={product.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => !isUnavailable && onToggleProduct(product.id)}
                            disabled={isUnavailable}
                            className={cn(
                              "px-2 py-0.5 text-xs rounded-md border transition-all text-left whitespace-nowrap",
                              isUnavailable
                                ? "bg-muted/30 border-border/30 text-muted-foreground/50 cursor-not-allowed"
                                : "cursor-pointer",
                              !isUnavailable && isSelected
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : !isUnavailable && "bg-background/60 border-border/50 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                            )}
                          >
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
    </TooltipProvider>
  );
}
