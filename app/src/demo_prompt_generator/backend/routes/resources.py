"""Databricks resources endpoints (clusters, warehouses, catalogs, schemas).

Includes server-side caching to avoid slow API calls on every request.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from itertools import islice
from typing import Any, Optional

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
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

# The catalog ENUMERATION is the expensive, slow-changing call (this workspace
# has thousands of catalogs → ~9s to page + deserialize them all). Catalogs are
# created/dropped rarely, so cache the name list much longer than the default —
# the ~9s is then paid at most once per this window per user, not every 5 min.
# (Per-item grant checks keep the default TTL so access changes still reflect.)
CATALOG_LIST_TTL = 1800  # 30 minutes

# Page size for catalogs.list — fewer round-trips when paging a metastore with
# thousands of catalogs (the volume dominates, but this trims the round-trips).
_CATALOG_LIST_PAGE_SIZE = 1000


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

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Cache a value. `ttl` overrides the default for THIS entry — used to
        keep slow, slow-changing lists (the catalog enumeration) warm far longer
        than fast-moving per-item data (grant checks), which stay at the default
        so a revoked grant reflects promptly."""
        self._cache[key] = CacheEntry(
            data=value,
            expires_at=time.time() + (ttl if ttl is not None else self.ttl),
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
    serverless: bool = False


class ColumnMetadata(BaseModel):
    """Unity Catalog column metadata (schema only — never data)."""

    name: str
    type_text: Optional[str] = None
    type_name: Optional[str] = None
    nullable: Optional[bool] = None
    comment: Optional[str] = None


class TableMetadata(BaseModel):
    """Unity Catalog table metadata (schema only — never data)."""

    full_name: str
    name: Optional[str] = None
    comment: Optional[str] = None
    table_type: Optional[str] = None
    columns: list[ColumnMetadata] = []


class WorkspaceInfo(BaseModel):
    """The connected workspace's host + numeric id — lets the UI build
    Catalog Explorer deep links for the tables the user is browsing."""

    host: Optional[str] = None
    workspace_id: Optional[str] = None


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
def list_clusters(ws: Dependencies.Client):
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
def list_warehouses(ws: Dependencies.Client):
    """List available SQL warehouses (cached, RUNNING first)."""
    # Per workspace: a cross-workspace project lists the TARGET's warehouses.
    cache_key = f"warehouses:{getattr(getattr(ws, 'config', None), 'host', '')}"
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
                serverless=bool(getattr(w, "enable_serverless_compute", False)),
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


# Warehouse names we prefer for ad-hoc query execution, in order.
_PREFERRED_WAREHOUSE_NAMES = ("shared endpoint", "dbdemos-shared-endpoint")


def pick_query_warehouse(ws) -> tuple[str | None, str | None]:
    """Pick the best warehouse to run an ad-hoc query on, with a real fallback.

    Tiering (first match wins), serverless preferred within each tier:
      1. RUNNING warehouse with a known preferred name
      2. RUNNING warehouse with 'shared' in the name
      3. any RUNNING warehouse
      4. STOPPED warehouse with 'shared' in the name
      5. any warehouse at all

    This mirrors ai-dev-kit's ``get_best_warehouse`` and, unlike the older
    ``_find_shared_warehouse`` (which returned None unless a 'shared'-named
    warehouse existed), always resolves a warehouse when the workspace has one.
    Returns ``(warehouse_id, warehouse_name)`` or ``(None, None)``.
    """
    try:
        warehouses = list_warehouses(ws)
    except Exception as e:  # noqa: BLE001 — degrade, caller handles None
        logger.warning(f"pick_query_warehouse: failed to list warehouses: {e}")
        return None, None
    if not warehouses:
        logger.warning("pick_query_warehouse: no warehouses in workspace")
        return None, None

    def _running(w: WarehouseInfo) -> bool:
        return (w.state or "").upper() == "RUNNING"

    # Serverless first within a tier (cheapest cold start), then by name.
    def _tier_sort(ws_list: list[WarehouseInfo]) -> list[WarehouseInfo]:
        return sorted(ws_list, key=lambda w: (not w.serverless, w.name.lower()))

    running = [w for w in warehouses if _running(w)]
    shared_running = [w for w in running if "shared" in w.name.lower()]
    preferred_running = [
        w for w in shared_running if w.name.lower() in _PREFERRED_WAREHOUSE_NAMES
    ]
    shared_any = [w for w in warehouses if "shared" in w.name.lower()]

    for tier in (
        _tier_sort(preferred_running),
        _tier_sort(shared_running),
        _tier_sort(running),
        _tier_sort(shared_any),
        _tier_sort(warehouses),
    ):
        if tier:
            picked = tier[0]
            logger.info(
                f"pick_query_warehouse: {picked.name} ({picked.id}), "
                f"state={picked.state}, serverless={picked.serverless}"
            )
            return picked.id, picked.name

    return None, None


# ---------------------------------------------------------------------------
# Access filtering — show only what the CURRENT USER can SELECT
#
# The "use existing data" picker must only offer objects the user can actually
# build on, because the demo build queries them AS THE USER (agent auth = the
# user's profile / OBO token), NOT the app service principal that lists them.
# UC `.list()` returns *visible* (BROWSE-able) objects, not SELECT-able ones, so
# we filter by the user's EFFECTIVE privileges via the grants metadata API
# (`grants.get_effective` — a control-plane call that works via OBO on Apps,
# unlike warehouse queries). Traverse-check granularity: catalogs/schemas gate on
# USE, tables gate on SELECT. Fail closed per item: anything we can't confirm is
# dropped; a wholesale failure falls back to the unfiltered list (see callers).
# ---------------------------------------------------------------------------

_SELECTABLE_WORKERS = 16
_CATALOG_KEEP = {"USE_CATALOG", "ALL_PRIVILEGES"}
_SCHEMA_KEEP = {"USE_SCHEMA", "ALL_PRIVILEGES"}
_TABLE_KEEP = {"SELECT", "ALL_PRIVILEGES"}


def _effective_privileges(
    user_ws: WorkspaceClient, securable_type: str, full_name: str, principal: str
) -> set[str]:
    """Privilege names `principal` EFFECTIVELY holds on a securable — includes
    inherited (catalog→schema→table) + group grants, resolved server-side.
    Empty set on ANY error → caller treats the object as inaccessible (fail-closed).
    Mirrors `core/_catalog_bootstrap._principal_privileges`, but effective."""
    try:
        resp = user_ws.grants.get_effective(
            securable_type=securable_type, full_name=full_name, principal=principal
        )
    except Exception as e:
        logger.warning(
            f"get_effective failed for {securable_type} {full_name!r} "
            f"({principal!r}): {e}"
        )
        return set()
    out: set[str] = set()
    for assignment in resp.privilege_assignments or []:
        for p in assignment.privileges or []:
            name = getattr(getattr(p, "privilege", None), "value", None) or str(
                getattr(p, "privilege", "")
            )
            if name:
                out.add(name)
    return out


def _accessible(
    user_ws: WorkspaceClient,
    principal: str,
    securable_type: str,
    full_names: list[str],
    keep: set[str],
) -> set[str]:
    """Subset of `full_names` on which `principal` effectively holds any `keep`
    privilege. Per-securable decisions are cached (TTL) so repeated / typed
    lookups are cheap; uncached checks run in parallel."""
    result: set[str] = set()
    misses: list[str] = []
    for fq in full_names:
        cached = _resource_cache.get(f"sel:{principal}:{securable_type}:{fq}")
        if cached is None:
            misses.append(fq)
        elif cached:
            result.add(fq)
    if misses:
        def check(fq: str) -> tuple[str, bool]:
            return fq, bool(
                _effective_privileges(user_ws, securable_type, fq, principal) & keep
            )

        with ThreadPoolExecutor(max_workers=min(_SELECTABLE_WORKERS, len(misses))) as ex:
            for fq, ok in ex.map(check, misses):
                _resource_cache.set(f"sel:{principal}:{securable_type}:{fq}", ok)
                if ok:
                    result.add(fq)
    return result


def _selectable_principal(selectable_only: bool, headers) -> Optional[str]:
    """The principal to filter by, or None to skip filtering (unknown identity —
    fall back to the unfiltered list rather than hiding everything)."""
    if not selectable_only:
        return None
    principal = getattr(headers, "user_email", None)
    if not principal or principal == "anonymous@local":
        return None
    return principal


def _is_not_found(e: Exception) -> bool:
    """A missing securable (catalog/schema/table) — a legacy/orphan reference or a
    since-deleted object. `NotFound` is the SDK's mapping; the message check also
    catches transports that raise a plain `DatabricksError` whose text says "does
    not exist". These are expected/recoverable (return empty / skip the item), NOT
    an ERROR + HTTP 500 — which was the top noisy 500 in prod OTel."""
    return isinstance(e, NotFound) or "does not exist" in str(e).lower()


@router.get(
    "/resources/catalogs",
    response_model=list[str],
    operation_id="listCatalogs",
)
def list_catalogs(
    ws: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    headers: Dependencies.Headers,
    q: Optional[str] = Query(None, description="Search query (min 1 char)"),
    browse: bool = Query(
        False,
        description=(
            "Return the (capped) full list when no query is given, for a "
            "browsable dropdown. Default off: no query means no results."
        ),
    ),
    selectable_only: bool = Query(
        False,
        description=(
            "Filter to catalogs the CURRENT USER can traverse (effective "
            "USE_CATALOG) — for the 'use existing data' picker, so it only "
            "offers objects the demo can actually build on. Lists + checks as "
            "the user (OBO); fail-closed per item."
        ),
    ),
):
    """List Unity Catalog catalogs (cached), optionally filtered by search query."""
    principal = _selectable_principal(selectable_only, headers)
    # List as the user (OBO) when filtering, so the candidate set is the user's
    # own visible catalogs; cache under a per-user key so access-scoped results
    # don't leak across users.
    client = user_ws if principal else ws
    cache_key = f"catalogs:u:{principal}" if principal else "catalogs"
    cached = _resource_cache.get(cache_key)

    if cached is None:
        try:
            logger.info("Fetching catalogs from Databricks API")
            # Larger page size → fewer round-trips paging a metastore with
            # thousands of catalogs. We need EVERY name (the picker searches by
            # substring across all of them), so we still enumerate fully — just
            # in bigger pages. Cached with the long CATALOG_LIST_TTL below.
            catalogs_list = list(
                client.catalogs.list(max_results=_CATALOG_LIST_PAGE_SIZE)
            )
            cached = sorted([c.name for c in catalogs_list if c.name])
            _resource_cache.set(cache_key, cached, ttl=CATALOG_LIST_TTL)
        except Exception as e:
            if _is_not_found(e):
                logger.info("list catalogs: securable not found — returning none")
                cached = []
                _resource_cache.set(cache_key, cached, ttl=CATALOG_LIST_TTL)
            else:
                logger.error(f"Failed to list catalogs: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to list catalogs: {str(e)}")

    # No query: type-to-search callers get nothing (they gate on typed input);
    # browse callers get the capped list so a dropdown can render immediately.
    if not q:
        candidates = cached[:MAX_RESULTS] if browse else []
    else:
        query_lower = q.lower()
        candidates = [c for c in cached if query_lower in c.lower()][:MAX_RESULTS]

    if not principal or not candidates:
        return candidates
    try:
        acc = _accessible(user_ws, principal, "CATALOG", candidates, _CATALOG_KEEP)
        return [c for c in candidates if c in acc]
    except Exception as e:  # wholesale failure → don't break the picker
        logger.warning(f"selectable catalog filter failed; returning unfiltered: {e}")
        return candidates


@router.get(
    "/resources/schemas",
    response_model=list[str],
    operation_id="listSchemas",
)
def list_schemas(
    ws: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    headers: Dependencies.Headers,
    catalog: str = Query(..., description="Catalog name"),
    q: Optional[str] = Query(None, description="Search query (min 1 char)"),
    browse: bool = Query(
        False,
        description=(
            "Return the (capped) full list when no query is given, for a "
            "browsable dropdown. Default off: no query means no results."
        ),
    ),
    selectable_only: bool = Query(
        False,
        description=(
            "Filter to schemas the CURRENT USER can traverse (effective "
            "USE_SCHEMA). See listCatalogs.selectable_only."
        ),
    ),
):
    """List schemas in a catalog (cached per catalog), optionally filtered by search query."""
    principal = _selectable_principal(selectable_only, headers)
    client = user_ws if principal else ws
    cache_key = f"schemas:u:{principal}:{catalog}" if principal else f"schemas:{catalog}"
    cached = _resource_cache.get(cache_key)

    if cached is None:
        try:
            logger.info(f"Fetching schemas for catalog {catalog}")
            schemas_list = list(client.schemas.list(catalog_name=catalog))
            cached = sorted([s.name for s in schemas_list if s.name])
            _resource_cache.set(cache_key, cached)
        except Exception as e:
            # A missing catalog (e.g. a legacy/orphan `ai_demo_gen` reference from
            # before the workspace move, or a since-deleted catalog) is NOT a
            # server error — return an empty schema list so the picker just shows
            # nothing. Genuine failures (permission, transport) still 500.
            if _is_not_found(e):
                logger.info(f"Catalog {catalog!r} not found — returning no schemas")
                cached = []
                _resource_cache.set(cache_key, cached)
            else:
                logger.error(f"Failed to list schemas: {e}")
                raise HTTPException(
                    status_code=500, detail=f"Failed to list schemas: {str(e)}"
                )

    # No query: type-to-search callers get nothing (they gate on typed input);
    # browse callers get the capped list so a dropdown can render immediately.
    if not q:
        candidates = cached[:MAX_RESULTS] if browse else []
    else:
        query_lower = q.lower()
        candidates = [s for s in cached if query_lower in s.lower()][:MAX_RESULTS]

    if not principal or not candidates:
        return candidates
    try:
        fulls = [f"{catalog}.{s}" for s in candidates]
        acc = _accessible(user_ws, principal, "SCHEMA", fulls, _SCHEMA_KEEP)
        return [s for s in candidates if f"{catalog}.{s}" in acc]
    except Exception as e:
        logger.warning(f"selectable schema filter failed; returning unfiltered: {e}")
        return candidates


@router.get(
    "/resources/tables",
    response_model=list[str],
    operation_id="listTables",
)
def list_tables(
    ws: Dependencies.Client,
    user_ws: Dependencies.UserClient,
    headers: Dependencies.Headers,
    catalog: str = Query(..., description="Catalog name"),
    schema: str = Query(..., description="Schema name"),
    q: Optional[str] = Query(None, description="Search query (min 1 char)"),
    selectable_only: bool = Query(
        False,
        description=(
            "Filter to tables the CURRENT USER can SELECT (effective SELECT) — "
            "the decisive 'can build off of' gate for the 'use existing data' "
            "picker. See listCatalogs.selectable_only."
        ),
    ),
):
    """List tables in a schema (cached per catalog.schema), optionally filtered by query.

    Reads table NAMES only (metadata, never data). Lists via the app service
    principal by default; when `selectable_only`, lists + access-checks as the
    current user (OBO) so only SELECT-able tables are returned.
    """
    principal = _selectable_principal(selectable_only, headers)
    client = user_ws if principal else ws
    cache_key = (
        f"tables:u:{principal}:{catalog}.{schema}" if principal else f"tables:{catalog}.{schema}"
    )
    cached = _resource_cache.get(cache_key)

    if cached is None:
        try:
            logger.info(f"Fetching tables for {catalog}.{schema}")
            # We only read `.name` here, so tell the server to skip the heavy
            # per-table payload it would otherwise assemble + serialize for
            # every table: column schemas, table properties, and owner lookup.
            # On a wide schema this is the difference between a name-light list
            # and dozens of full TableInfo objects. No behavior change.
            tables_list = list(
                client.tables.list(
                    catalog_name=catalog,
                    schema_name=schema,
                    omit_columns=True,
                    omit_properties=True,
                    omit_username=True,
                )
            )
            cached = sorted([t.name for t in tables_list if t.name])
            _resource_cache.set(cache_key, cached)
        except Exception as e:
            if _is_not_found(e):
                logger.info(f"Schema {catalog}.{schema} not found — returning no tables")
                cached = []
                _resource_cache.set(cache_key, cached)
            else:
                logger.error(f"Failed to list tables for {catalog}.{schema}: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"Failed to list tables in {catalog}.{schema}: {str(e)}. "
                        "The app's service principal needs USE + SELECT on this "
                        "catalog/schema to read table metadata."
                    ),
                )

    # Unlike catalogs/schemas (thousands, so we gate on a typed query), a
    # schema's tables are a bounded set — return them all when there's no
    # query so the picker can show the list immediately.
    if not q:
        candidates = cached[:MAX_RESULTS]
    else:
        query_lower = q.lower()
        candidates = [t for t in cached if query_lower in t.lower()][:MAX_RESULTS]

    if not principal or not candidates:
        return candidates
    try:
        fulls = [f"{catalog}.{schema}.{t}" for t in candidates]
        acc = _accessible(user_ws, principal, "TABLE", fulls, _TABLE_KEEP)
        return [t for t in candidates if f"{catalog}.{schema}.{t}" in acc]
    except Exception as e:
        logger.warning(f"selectable table filter failed; returning unfiltered: {e}")
        return candidates


@router.get(
    "/resources/table-metadata",
    response_model=list[TableMetadata],
    operation_id="getTableMetadata",
)
def get_table_metadata(
    ws: Dependencies.Client,
    tables: str = Query(
        ...,
        description="Comma-separated fully-qualified table names (catalog.schema.table)",
    ),
):
    """Fetch column-level metadata (schema only, never data) for the given tables.

    Uses the app service principal — OBO tokens can't read UC on Databricks Apps.
    """
    names = [t.strip() for t in tables.split(",") if t.strip()]
    if not names:
        return []

    result: list[TableMetadata] = []
    for full_name in names[:MAX_RESULTS]:
        cache_key = f"table-metadata:{full_name}"
        cached = _resource_cache.get(cache_key)
        if cached is None:
            try:
                info = ws.tables.get(full_name=full_name)
                cached = TableMetadata(
                    full_name=info.full_name or full_name,
                    name=info.name,
                    comment=info.comment,
                    table_type=(
                        info.table_type.value
                        if info.table_type is not None
                        else None
                    ),
                    columns=[
                        ColumnMetadata(
                            name=c.name or "",
                            type_text=c.type_text,
                            type_name=(
                                c.type_name.value if c.type_name is not None else None
                            ),
                            nullable=c.nullable,
                            comment=c.comment,
                        )
                        for c in (info.columns or [])
                    ],
                )
                _resource_cache.set(cache_key, cached)
            except Exception as e:
                if _is_not_found(e):
                    # Table gone (deep-link / cached selection to a since-deleted
                    # table) — skip it rather than failing the whole batch with 500.
                    logger.info(f"Table {full_name} not found — skipping")
                    continue
                logger.error(f"Failed to get metadata for {full_name}: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"Failed to read metadata for {full_name}: {str(e)}. "
                        "The app's service principal needs USE + SELECT on the "
                        "table's catalog/schema."
                    ),
                )
        result.append(cached)

    return result


@router.get(
    "/resources/defaults",
    response_model=ResourceDefaults,
    operation_id="getResourceDefaults",
)
def get_resource_defaults():
    """Get default resource values."""
    return ResourceDefaults()


@router.get(
    "/resources/workspace-info",
    response_model=WorkspaceInfo,
    operation_id="getWorkspaceInfo",
)
def get_workspace_info(ws: Dependencies.Client):
    """Return the connected workspace host + numeric id so the UI can build
    Catalog Explorer deep links (``{host}/explore/data/<cat>/<schema>/<table>
    ?o=<workspace_id>``). Cached — neither value changes over the app's life.
    Best-effort: a resolution failure returns nulls, not an error, so the
    picker still works (it just won't show the external links)."""
    cache_key = "workspace-info"
    cached = _resource_cache.get(cache_key)
    if cached is not None:
        return cached

    host: str | None = None
    workspace_id: str | None = None
    try:
        host = str(ws.config.host).rstrip("/") if ws.config.host else None
    except Exception:  # noqa: BLE001
        logger.warning("Could not resolve workspace host for explore links")
    try:
        # `?o=<id>` scopes the link to the right workspace for multi-workspace
        # users; without it the page can bounce to a login/chooser screen.
        workspace_id = str(ws.get_workspace_id())
    except Exception:  # noqa: BLE001
        logger.warning("Could not resolve workspace_id; explore links omit ?o=")

    info = WorkspaceInfo(host=host, workspace_id=workspace_id)
    _resource_cache.set(cache_key, info)
    return info


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
