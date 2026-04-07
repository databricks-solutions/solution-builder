"""Databricks resources endpoints (clusters, warehouses, catalogs, schemas).

Includes server-side caching to avoid slow API calls on every request.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from itertools import islice
from typing import Any, Optional

from databricks.sdk import WorkspaceClient
from fastapi import HTTPException, Query
from pydantic import BaseModel

from ..core import Dependencies, create_router
from ..core._config import logger

router = create_router()


# ---------------------------------------------------------------------------
# Cache implementation
# ---------------------------------------------------------------------------

DEFAULT_CACHE_TTL = 300  # 5 minutes
MAX_RESULTS = 50  # Limit results to 50 items


@dataclass
class CacheEntry:
    """A cached value with expiration time."""
    data: Any
    expires_at: float


@dataclass
class ResourceCache:
    """Simple in-memory cache for Databricks resources."""
    _cache: dict[str, CacheEntry] = field(default_factory=dict)
    ttl: int = DEFAULT_CACHE_TTL

    def get(self, key: str) -> Any | None:
        """Get a cached value if not expired."""
        entry = self._cache.get(key)
        if entry is None:
            return None
        if time.time() > entry.expires_at:
            del self._cache[key]
            return None
        return entry.data

    def set(self, key: str, value: Any) -> None:
        """Cache a value with TTL."""
        self._cache[key] = CacheEntry(
            data=value,
            expires_at=time.time() + self.ttl
        )

    def invalidate(self, key: str | None = None) -> None:
        """Invalidate a specific key or all keys."""
        if key is None:
            self._cache.clear()
        elif key in self._cache:
            del self._cache[key]


# Global cache instance
_resource_cache = ResourceCache()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ClusterInfo(BaseModel):
    """Cluster metadata."""

    id: str
    name: str
    state: Optional[str] = None
    spark_version: Optional[str] = None


class WarehouseInfo(BaseModel):
    """SQL Warehouse metadata."""

    id: str
    name: str
    state: Optional[str] = None
    size: Optional[str] = None


class ResourceDefaults(BaseModel):
    """Default values for resources."""
    catalog: str = "ai_demo_gen"
    schema_prefix: str = "my_demo_"


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _get_cluster_sort_key(cluster: ClusterInfo) -> tuple[int, str]:
    """Sort key: RUNNING first, then by name."""
    state_priority = {
        "RUNNING": 0,
        "PENDING": 1,
        "RESIZING": 2,
        "RESTARTING": 3,
        "TERMINATING": 4,
        "TERMINATED": 5,
    }
    priority = state_priority.get(cluster.state or "", 99)
    return (priority, cluster.name.lower())


def _get_warehouse_sort_key(warehouse: WarehouseInfo) -> tuple[int, str]:
    """Sort key: RUNNING first, then by name."""
    state_priority = {
        "RUNNING": 0,
        "STARTING": 1,
        "STOPPING": 2,
        "STOPPED": 3,
        "DELETED": 4,
    }
    priority = state_priority.get(warehouse.state or "", 99)
    return (priority, warehouse.name.lower())


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/resources/clusters",
    response_model=list[ClusterInfo],
    operation_id="listClusters",
)
def list_clusters(ws: Dependencies.UserClient):
    """List available Databricks clusters (cached, RUNNING first).

    Only lists interactive clusters (UI/API created), excludes job/pipeline clusters.
    """
    cache_key = "clusters"
    cached = _resource_cache.get(cache_key)
    if cached is not None:
        logger.debug("Returning cached clusters")
        return cached

    try:
        from databricks.sdk.service.compute import ClusterSource, ListClustersFilterBy

        logger.info("Fetching interactive clusters from Databricks API")
        # Filter to only UI and API clusters (interactive), exclude JOB, PIPELINE, etc.
        filter_by = ListClustersFilterBy(
            cluster_sources=[ClusterSource.UI, ClusterSource.API]
        )
        clusters_list = list(islice(ws.clusters.list(filter_by=filter_by), MAX_RESULTS * 2))

        result = [
            ClusterInfo(
                id=c.cluster_id,
                name=c.cluster_name,
                state=str(c.state.value) if c.state else None,
                spark_version=c.spark_version,
            )
            for c in clusters_list
            if c.cluster_id and c.cluster_name
        ]

        # Sort: RUNNING first, then by name
        result.sort(key=_get_cluster_sort_key)

        # Limit results
        result = result[:MAX_RESULTS]

        _resource_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Failed to list clusters: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list clusters: {str(e)}")


@router.get(
    "/resources/warehouses",
    response_model=list[WarehouseInfo],
    operation_id="listWarehouses",
)
def list_warehouses(ws: Dependencies.UserClient):
    """List available SQL warehouses (cached, RUNNING first)."""
    cache_key = "warehouses"
    cached = _resource_cache.get(cache_key)
    if cached is not None:
        logger.debug("Returning cached warehouses")
        return cached

    try:
        logger.info("Fetching warehouses from Databricks API")
        # Use islice to stop after MAX_RESULTS * 2
        warehouses_list = list(islice(ws.warehouses.list(), MAX_RESULTS * 2))

        result = [
            WarehouseInfo(
                id=w.id,
                name=w.name,
                state=str(w.state.value) if w.state else None,
                size=w.cluster_size,
            )
            for w in warehouses_list
            if w.id and w.name
        ]

        # Sort: RUNNING first, then by name
        result.sort(key=_get_warehouse_sort_key)

        # Limit results
        result = result[:MAX_RESULTS]

        _resource_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Failed to list warehouses: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list warehouses: {str(e)}")


@router.get(
    "/resources/catalogs",
    response_model=list[str],
    operation_id="listCatalogs",
)
def list_catalogs(
    ws: Dependencies.UserClient,
    q: Optional[str] = Query(None, description="Search query (min 1 char)"),
):
    """List Unity Catalog catalogs (cached), optionally filtered by search query."""
    cache_key = "catalogs"
    cached = _resource_cache.get(cache_key)

    if cached is None:
        try:
            logger.info("Fetching catalogs from Databricks API")
            catalogs_list = list(ws.catalogs.list())
            cached = sorted([c.name for c in catalogs_list if c.name])
            _resource_cache.set(cache_key, cached)
        except Exception as e:
            logger.error(f"Failed to list catalogs: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to list catalogs: {str(e)}")

    # If no query, return empty (user must type to search)
    if not q:
        return []

    # Filter by query (case-insensitive prefix/contains match)
    query_lower = q.lower()
    result = [c for c in cached if query_lower in c.lower()]

    # Limit results
    return result[:MAX_RESULTS]


@router.get(
    "/resources/schemas",
    response_model=list[str],
    operation_id="listSchemas",
)
def list_schemas(
    ws: Dependencies.UserClient,
    catalog: str = Query(..., description="Catalog name"),
    q: Optional[str] = Query(None, description="Search query (min 1 char)"),
):
    """List schemas in a catalog (cached per catalog), optionally filtered by search query."""
    cache_key = f"schemas:{catalog}"
    cached = _resource_cache.get(cache_key)

    if cached is None:
        try:
            logger.info(f"Fetching schemas for catalog {catalog}")
            schemas_list = list(ws.schemas.list(catalog_name=catalog))
            cached = sorted([s.name for s in schemas_list if s.name])
            _resource_cache.set(cache_key, cached)
        except Exception as e:
            logger.error(f"Failed to list schemas: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to list schemas: {str(e)}")

    # If no query, return empty (user must type to search)
    if not q:
        return []

    # Filter by query (case-insensitive contains match)
    query_lower = q.lower()
    result = [s for s in cached if query_lower in s.lower()]

    # Limit results
    return result[:MAX_RESULTS]


@router.get(
    "/resources/defaults",
    response_model=ResourceDefaults,
    operation_id="getResourceDefaults",
)
def get_resource_defaults():
    """Get default resource values."""
    return ResourceDefaults()


@router.post(
    "/resources/refresh",
    operation_id="refreshResources",
)
def refresh_resources(
    resource_type: Optional[str] = Query(
        None,
        description="Type to refresh: clusters, warehouses, catalogs, schemas, or None for all"
    ),
    catalog: Optional[str] = Query(
        None,
        description="Catalog name (required when refreshing schemas)"
    ),
):
    """Invalidate resource cache to force fresh fetch."""
    if resource_type is None:
        _resource_cache.invalidate()
        logger.info("Invalidated all resource caches")
        return {"message": "All resource caches invalidated"}

    if resource_type == "schemas" and catalog:
        _resource_cache.invalidate(f"schemas:{catalog}")
        logger.info(f"Invalidated schemas cache for {catalog}")
    else:
        _resource_cache.invalidate(resource_type)
        logger.info(f"Invalidated {resource_type} cache")

    return {"message": f"Cache invalidated for {resource_type}"}
