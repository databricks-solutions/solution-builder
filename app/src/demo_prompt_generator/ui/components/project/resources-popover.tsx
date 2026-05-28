/**
 * Resources popover - displays and configures Databricks resources.
 *
 * Uses server-side caching - data is fetched once per session.
 * Click "Refresh All" to invalidate cache and reload.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Server, Database, Boxes, Search } from "lucide-react";
import {
  getConfigStatus,
  listClusters,
  listWarehouses,
  listCatalogs,
  listSchemas,
  refreshResources,
  updateProjectResources,
  type Cluster,
  type Warehouse,
} from "@/lib/custom-api";
import { cn } from "@/lib/utils";

// Project naming convention for the auto-suggested schema. Catalog
// default now comes from /api/config/status (backend's AppConfig
// .default_catalog) — see the fetch in the component below.
const DEFAULT_SCHEMA_PREFIX = "my_solution_";

export interface ProjectResources {
  clusterId: string | null;
  clusterName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  catalog: string | null;
  schema: string | null;
}

interface ResourcesPopoverProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  resources: ProjectResources;
  onResourcesChange: (resources: ProjectResources) => void;
}

export function ResourcesPopover({
  projectId,
  isOpen,
  onClose,
  resources,
  onResourcesChange,
}: ResourcesPopoverProps) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [catalogSuggestions, setCatalogSuggestions] = useState<string[]>([]);
  const [schemaSuggestions, setSchemaSuggestions] = useState<string[]>([]);

  const [isLoadingClusters, setIsLoadingClusters] = useState(false);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(false);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // Catalog autocomplete state
  const [catalogInput, setCatalogInput] = useState(resources.catalog || "");
  const [showCatalogDropdown, setShowCatalogDropdown] = useState(false);
  const catalogInputRef = useRef<HTMLInputElement>(null);
  const catalogDropdownRef = useRef<HTMLDivElement>(null);

  // Schema autocomplete state
  const [schemaInput, setSchemaInput] = useState(resources.schema || "");
  const [showSchemaDropdown, setShowSchemaDropdown] = useState(false);
  const schemaInputRef = useRef<HTMLInputElement>(null);
  const schemaDropdownRef = useRef<HTMLDivElement>(null);

  // Default catalog from the backend (env-driven; see DEFAULT_CATALOG in
  // databricks.<target>.yml). Empty string until /api/config/status
  // resolves — the "(default)" badge just doesn't render in that window.
  const [defaultCatalog, setDefaultCatalog] = useState<string>("");

  // Track if we've loaded data at least once
  const hasLoadedRef = useRef(false);

  // Fetch the backend-configured default catalog once. Independent of
  // open/close so we have the value as soon as the popover mounts.
  useEffect(() => {
    let cancelled = false;
    getConfigStatus()
      .then((s) => {
        if (!cancelled) setDefaultCatalog(s.default_catalog);
      })
      .catch(() => {
        // Non-fatal — the popover still works, the "(default)" hint is just absent.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute default schema from project ID
  const defaultSchema = `${DEFAULT_SCHEMA_PREFIX}${projectId.split("-")[0]}`;

  // Load all resources on first open (uses server cache)
  useEffect(() => {
    if (isOpen && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadAllResources();
    }
  }, [isOpen]);

  // Sync catalog input with resources.catalog when it changes externally
  useEffect(() => {
    if (resources.catalog && resources.catalog !== catalogInput) {
      setCatalogInput(resources.catalog);
    }
  }, [resources.catalog]);

  // Sync schema input with resources.schema when it changes externally
  useEffect(() => {
    if (resources.schema && resources.schema !== schemaInput) {
      setSchemaInput(resources.schema);
    }
  }, [resources.schema]);

  // Search schemas when input changes (debounced)
  useEffect(() => {
    if (!resources.catalog || schemaInput.length < 1) {
      setSchemaSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoadingSchemas(true);
      try {
        const results = await listSchemas(resources.catalog!, schemaInput);
        setSchemaSuggestions(results);
        setShowSchemaDropdown(results.length > 0);
      } catch (error) {
        console.error("Failed to search schemas:", error);
      } finally {
        setIsLoadingSchemas(false);
      }
    }, 200); // 200ms debounce

    return () => clearTimeout(timer);
  }, [schemaInput, resources.catalog]);

  // Search catalogs when input changes (debounced)
  useEffect(() => {
    if (catalogInput.length < 1) {
      setCatalogSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoadingCatalogs(true);
      try {
        const results = await listCatalogs(catalogInput);
        setCatalogSuggestions(results);
        setShowCatalogDropdown(results.length > 0);
      } catch (error) {
        console.error("Failed to search catalogs:", error);
      } finally {
        setIsLoadingCatalogs(false);
      }
    }, 200); // 200ms debounce

    return () => clearTimeout(timer);
  }, [catalogInput]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Catalog dropdown
      if (
        catalogDropdownRef.current &&
        !catalogDropdownRef.current.contains(e.target as Node) &&
        catalogInputRef.current &&
        !catalogInputRef.current.contains(e.target as Node)
      ) {
        setShowCatalogDropdown(false);
      }
      // Schema dropdown
      if (
        schemaDropdownRef.current &&
        !schemaDropdownRef.current.contains(e.target as Node) &&
        schemaInputRef.current &&
        !schemaInputRef.current.contains(e.target as Node)
      ) {
        setShowSchemaDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadAllResources = useCallback(async () => {
    // Load clusters and warehouses in parallel (catalogs are searched on-demand)
    await Promise.all([loadClusters(), loadWarehouses()]);
  }, []);

  const loadClusters = useCallback(async () => {
    setIsLoadingClusters(true);
    try {
      const data = await listClusters();
      setClusters(data);
    } catch (error) {
      console.error("Failed to load clusters:", error);
    } finally {
      setIsLoadingClusters(false);
    }
  }, []);

  const loadWarehouses = useCallback(async () => {
    setIsLoadingWarehouses(true);
    try {
      const data = await listWarehouses();
      setWarehouses(data);
    } catch (error) {
      console.error("Failed to load warehouses:", error);
    } finally {
      setIsLoadingWarehouses(false);
    }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      // Invalidate all server caches
      await refreshResources();
      // Reload clusters and warehouses
      await loadAllResources();
      // Clear schema suggestions (user will need to search again)
      setSchemaSuggestions([]);
    } catch (error) {
      console.error("Failed to refresh resources:", error);
    } finally {
      setIsRefreshingAll(false);
    }
  }, [loadAllResources]);

  const handleClusterChange = async (clusterId: string) => {
    // Handle "none" selection
    const isNone = clusterId === "__none__";
    const actualClusterId = isNone ? null : clusterId;
    const cluster = isNone ? null : clusters.find((c) => c.id === clusterId);
    const clusterName = cluster?.name || null;
    const newResources = {
      ...resources,
      clusterId: actualClusterId,
      clusterName,
    };
    onResourcesChange(newResources);
    // Save to backend (include both id and name)
    try {
      await updateProjectResources(projectId, {
        cluster_id: actualClusterId,
        cluster_name: clusterName,
      });
    } catch (error) {
      console.error("Failed to save cluster:", error);
    }
  };

  const handleWarehouseChange = async (warehouseId: string) => {
    const warehouse = warehouses.find((w) => w.id === warehouseId);
    const warehouseName = warehouse?.name || null;
    const newResources = {
      ...resources,
      warehouseId,
      warehouseName,
    };
    onResourcesChange(newResources);
    // Save to backend (include both id and name)
    try {
      await updateProjectResources(projectId, {
        warehouse_id: warehouseId || null,
        warehouse_name: warehouseName,
      });
    } catch (error) {
      console.error("Failed to save warehouse:", error);
    }
  };

  const handleCatalogSelect = async (catalog: string) => {
    setCatalogInput(catalog);
    setShowCatalogDropdown(false);
    const newResources = {
      ...resources,
      catalog,
      schema: null, // Reset schema when catalog changes
    };
    onResourcesChange(newResources);
    // Clear schema state
    setSchemaInput("");
    setSchemaSuggestions([]);
    // Save to backend
    try {
      await updateProjectResources(projectId, {
        default_catalog: catalog || null,
        default_schema: null,
      });
    } catch (error) {
      console.error("Failed to save catalog:", error);
    }
  };

  const handleCatalogInputChange = (value: string) => {
    setCatalogInput(value);
    if (value.length >= 1) {
      setShowCatalogDropdown(true);
    } else {
      setShowCatalogDropdown(false);
      setCatalogSuggestions([]);
    }
  };

  const handleSchemaSelect = async (schema: string) => {
    setSchemaInput(schema);
    setShowSchemaDropdown(false);
    const newResources = {
      ...resources,
      schema,
    };
    onResourcesChange(newResources);
    // Save to backend
    try {
      await updateProjectResources(projectId, { default_schema: schema || null });
    } catch (error) {
      console.error("Failed to save schema:", error);
    }
  };

  const handleSchemaInputChange = (value: string) => {
    setSchemaInput(value);
    if (value.length >= 1 && resources.catalog) {
      setShowSchemaDropdown(true);
    } else {
      setShowSchemaDropdown(false);
      setSchemaSuggestions([]);
    }
  };

  const isAnyLoading =
    isLoadingClusters ||
    isLoadingWarehouses ||
    isLoadingCatalogs ||
    isLoadingSchemas;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Databricks Resources
              </DialogTitle>
              <DialogDescription>
                Configure the compute and catalog resources for this project
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              disabled={isRefreshingAll || isAnyLoading}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  (isRefreshingAll || isAnyLoading) && "animate-spin"
                )}
              />
              Refresh All
            </Button>
          </div>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Cluster */}
          <div className="grid gap-2">
            <Label htmlFor="cluster" className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Cluster
            </Label>
            <Select
              value={resources.clusterId || "__none__"}
              onValueChange={handleClusterChange}
              disabled={isLoadingClusters}
            >
              <SelectTrigger id="cluster">
                <SelectValue
                  placeholder={
                    isLoadingClusters ? "Loading..." : "Select a cluster"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">None (no cluster)</span>
                </SelectItem>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster.id} value={cluster.id}>
                    <div className="flex items-center gap-2">
                      <span>{cluster.name}</span>
                      {cluster.state && (
                        <span
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded",
                            cluster.state === "RUNNING"
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          )}
                        >
                          {cluster.state}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Warehouse */}
          <div className="grid gap-2">
            <Label htmlFor="warehouse" className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              SQL Warehouse
            </Label>
            <Select
              value={resources.warehouseId || ""}
              onValueChange={handleWarehouseChange}
              disabled={isLoadingWarehouses}
            >
              <SelectTrigger id="warehouse">
                <SelectValue
                  placeholder={
                    isLoadingWarehouses ? "Loading..." : "Select a warehouse"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    <div className="flex items-center gap-2">
                      <span>{warehouse.name}</span>
                      {warehouse.state && (
                        <span
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded",
                            warehouse.state === "RUNNING"
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          )}
                        >
                          {warehouse.state}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Catalog */}
          <div className="grid gap-2">
            <Label htmlFor="catalog" className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-muted-foreground" />
              Catalog
            </Label>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={catalogInputRef}
                  id="catalog"
                  value={catalogInput}
                  onChange={(e) => handleCatalogInputChange(e.target.value)}
                  onFocus={() => {
                    if (catalogInput.length >= 1 && catalogSuggestions.length > 0) {
                      setShowCatalogDropdown(true);
                    }
                  }}
                  placeholder="Type to search catalogs..."
                  className="pl-8"
                />
                {isLoadingCatalogs && (
                  <RefreshCw className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {showCatalogDropdown && catalogSuggestions.length > 0 && (
                <div
                  ref={catalogDropdownRef}
                  className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto bg-popover border border-border rounded-md shadow-md"
                >
                  {catalogSuggestions.map((catalog) => (
                    <button
                      key={catalog}
                      type="button"
                      onClick={() => handleCatalogSelect(catalog)}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                        catalog === resources.catalog && "bg-accent"
                      )}
                    >
                      {catalog}
                      {defaultCatalog && catalog === defaultCatalog && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (default)
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {resources.catalog && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium">{resources.catalog}</span>
              </p>
            )}
          </div>

          {/* Schema */}
          <div className="grid gap-2">
            <Label htmlFor="schema" className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Schema
            </Label>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={schemaInputRef}
                  id="schema"
                  value={schemaInput}
                  onChange={(e) => handleSchemaInputChange(e.target.value)}
                  onFocus={() => {
                    if (schemaInput.length >= 1 && schemaSuggestions.length > 0) {
                      setShowSchemaDropdown(true);
                    }
                  }}
                  placeholder={
                    resources.catalog
                      ? "Type to search schemas..."
                      : "Select a catalog first"
                  }
                  disabled={!resources.catalog}
                  className="pl-8"
                />
                {isLoadingSchemas && (
                  <RefreshCw className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {showSchemaDropdown && schemaSuggestions.length > 0 && (
                <div
                  ref={schemaDropdownRef}
                  className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto bg-popover border border-border rounded-md shadow-md"
                >
                  {schemaSuggestions.map((schema) => (
                    <button
                      key={schema}
                      type="button"
                      onClick={() => handleSchemaSelect(schema)}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                        schema === resources.schema && "bg-accent"
                      )}
                    >
                      {schema}
                      {schema === defaultSchema && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (default)
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {resources.schema && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium">{resources.schema}</span>
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
