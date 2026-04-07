"""Databricks resources endpoints (clusters, warehouses, catalogs, schemas)."""

from __future__ import annotations

from typing import Optional

from databricks.sdk import WorkspaceClient
from fastapi import HTTPException, Query
from pydantic import BaseModel

from ..core import Dependencies, create_router

router = create_router()


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


@router.get(
    "/resources/clusters",
    response_model=list[ClusterInfo],
    operation_id="listClusters",
)
def list_clusters(ws: Dependencies.UserClient):
    """List available Databricks clusters."""
    try:
        clusters = ws.clusters.list()
        return [
            ClusterInfo(
                id=c.cluster_id,
                name=c.cluster_name,
                state=str(c.state.value) if c.state else None,
                spark_version=c.spark_version,
            )
            for c in clusters
            if c.cluster_id and c.cluster_name
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list clusters: {str(e)}")


@router.get(
    "/resources/warehouses",
    response_model=list[WarehouseInfo],
    operation_id="listWarehouses",
)
def list_warehouses(ws: Dependencies.UserClient):
    """List available SQL warehouses."""
    try:
        warehouses = ws.warehouses.list()
        return [
            WarehouseInfo(
                id=w.id,
                name=w.name,
                state=str(w.state.value) if w.state else None,
                size=w.cluster_size,
            )
            for w in warehouses
            if w.id and w.name
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list warehouses: {str(e)}")


@router.get(
    "/resources/catalogs",
    response_model=list[str],
    operation_id="listCatalogs",
)
def list_catalogs(ws: Dependencies.UserClient):
    """List Unity Catalog catalogs."""
    try:
        catalogs = ws.catalogs.list()
        return [c.name for c in catalogs if c.name]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list catalogs: {str(e)}")


@router.get(
    "/resources/schemas",
    response_model=list[str],
    operation_id="listSchemas",
)
def list_schemas(
    ws: Dependencies.UserClient,
    catalog: str = Query(..., description="Catalog name"),
):
    """List schemas in a catalog."""
    try:
        schemas = ws.schemas.list(catalog_name=catalog)
        return [s.name for s in schemas if s.name]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list schemas: {str(e)}")
