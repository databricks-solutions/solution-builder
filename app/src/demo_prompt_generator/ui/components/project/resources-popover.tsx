/**
 * Resources popover - displays and configures Databricks resources.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Server, Database, Boxes } from "lucide-react";
import {
  listClusters,
  listWarehouses,
  listCatalogs,
  listSchemas,
  type Cluster,
  type Warehouse,
} from "@/lib/custom-api";
import { cn } from "@/lib/utils";

export interface ProjectResources {
  clusterId: string | null;
  clusterName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  catalog: string | null;
  schema: string | null;
}

interface ResourcesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  resources: ProjectResources;
  onResourcesChange: (resources: ProjectResources) => void;
}

export function ResourcesPopover({
  isOpen,
  onClose,
  resources,
  onResourcesChange,
}: ResourcesPopoverProps) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);

  const [isLoadingClusters, setIsLoadingClusters] = useState(false);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(false);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);

  // Load resources when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadClusters();
      loadWarehouses();
      loadCatalogs();
    }
  }, [isOpen]);

  // Load schemas when catalog changes
  useEffect(() => {
    if (resources.catalog) {
      loadSchemas(resources.catalog);
    } else {
      setSchemas([]);
    }
  }, [resources.catalog]);

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

  const loadCatalogs = useCallback(async () => {
    setIsLoadingCatalogs(true);
    try {
      const data = await listCatalogs();
      setCatalogs(data);
    } catch (error) {
      console.error("Failed to load catalogs:", error);
    } finally {
      setIsLoadingCatalogs(false);
    }
  }, []);

  const loadSchemas = useCallback(async (catalog: string) => {
    setIsLoadingSchemas(true);
    try {
      const data = await listSchemas(catalog);
      setSchemas(data);
    } catch (error) {
      console.error("Failed to load schemas:", error);
    } finally {
      setIsLoadingSchemas(false);
    }
  }, []);

  const handleClusterChange = (clusterId: string) => {
    const cluster = clusters.find((c) => c.id === clusterId);
    onResourcesChange({
      ...resources,
      clusterId,
      clusterName: cluster?.name || null,
    });
  };

  const handleWarehouseChange = (warehouseId: string) => {
    const warehouse = warehouses.find((w) => w.id === warehouseId);
    onResourcesChange({
      ...resources,
      warehouseId,
      warehouseName: warehouse?.name || null,
    });
  };

  const handleCatalogChange = (catalog: string) => {
    onResourcesChange({
      ...resources,
      catalog,
      schema: null, // Reset schema when catalog changes
    });
  };

  const handleSchemaChange = (schema: string) => {
    onResourcesChange({
      ...resources,
      schema,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Databricks Resources
          </DialogTitle>
          <DialogDescription>
            Configure the compute and catalog resources for this project
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Cluster */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="cluster" className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                Cluster
              </Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={loadClusters}
                disabled={isLoadingClusters}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isLoadingClusters && "animate-spin"
                  )}
                />
              </Button>
            </div>
            <Select
              value={resources.clusterId || ""}
              onValueChange={handleClusterChange}
              disabled={isLoadingClusters}
            >
              <SelectTrigger id="cluster">
                <SelectValue placeholder="Select a cluster" />
              </SelectTrigger>
              <SelectContent>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster.id} value={cluster.id}>
                    <div className="flex items-center gap-2">
                      <span>{cluster.name}</span>
                      {cluster.state && (
                        <span
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded",
                            cluster.state === "RUNNING"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
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
            <div className="flex items-center justify-between">
              <Label htmlFor="warehouse" className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                SQL Warehouse
              </Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={loadWarehouses}
                disabled={isLoadingWarehouses}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isLoadingWarehouses && "animate-spin"
                  )}
                />
              </Button>
            </div>
            <Select
              value={resources.warehouseId || ""}
              onValueChange={handleWarehouseChange}
              disabled={isLoadingWarehouses}
            >
              <SelectTrigger id="warehouse">
                <SelectValue placeholder="Select a warehouse" />
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
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
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
            <div className="flex items-center justify-between">
              <Label htmlFor="catalog" className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground" />
                Catalog
              </Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={loadCatalogs}
                disabled={isLoadingCatalogs}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    isLoadingCatalogs && "animate-spin"
                  )}
                />
              </Button>
            </div>
            <Select
              value={resources.catalog || ""}
              onValueChange={handleCatalogChange}
              disabled={isLoadingCatalogs}
            >
              <SelectTrigger id="catalog">
                <SelectValue placeholder="Select a catalog" />
              </SelectTrigger>
              <SelectContent>
                {catalogs.map((catalog) => (
                  <SelectItem key={catalog} value={catalog}>
                    {catalog}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Schema */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="schema" className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                Schema
              </Label>
              {resources.catalog && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    resources.catalog && loadSchemas(resources.catalog)
                  }
                  disabled={isLoadingSchemas}
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      isLoadingSchemas && "animate-spin"
                    )}
                  />
                </Button>
              )}
            </div>
            <Select
              value={resources.schema || ""}
              onValueChange={handleSchemaChange}
              disabled={isLoadingSchemas || !resources.catalog}
            >
              <SelectTrigger id="schema">
                <SelectValue
                  placeholder={
                    resources.catalog
                      ? "Select a schema"
                      : "Select a catalog first"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {schemas.map((schema) => (
                  <SelectItem key={schema} value={schema}>
                    {schema}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
