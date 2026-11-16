"""Dead-demo-database reaper — reclaims the shared Lakebase pool's orphaned dbs.

Every Lakebase-backed demo the build agent creates lands as a
`db-dbgen-<slug>[-<hex>]` database in the shared pool project(s)
(`solution-builder`, `-2`…). Each `CREATE DATABASE` auto-provisions ~2
zeroETL roles, and roles-per-branch is a HARD Lakebase limit — so a *deleted*
demo's leftover db keeps costing roles until it's dropped. PR #202 stopped NEW
dbs piling onto the maxed base branch (proactive pool distribution); this reaper
is the other half — it DRAINS the dbs whose Solution Builder project is gone.

⚠️ SAFETY (learned from a live prod investigation, 2026-09-17): a naive
"no live project records this db in resources.json" reaper would have dropped 34
LIVE demos' databases. Two failure modes it must survive:
  1. a db linked to a live project by an id-suffix that resources.json doesn't
     spell out, and
  2. a recently-built db whose resources.json hasn't recorded the db name yet.
So a db is reaped ONLY when it is unreferenced by BOTH signals —
  (a) the project-id-suffix (`db-…-<hex>` where `<hex>` prefixes a live project id), and
  (b) a full-text scan of every live project's `resources.json`
— AND it is older than an age gate (so a just-built live db is never in range).
Short-slug dbs that can't be reliably text-verified are held for manual review,
never auto-reaped. And the reaper is **DRY-RUN by default**
(`LAKEBASE_DEAD_DB_REAP_ARMED` unset) — it only logs what it WOULD drop until an
operator arms it.

Identities: the live-signal read runs as the app SP against the app's own
metadata DB (no elevated Postgres role). The drop runs as the deployer SP (which
owns the pool) against the target workspace via the SDK `postgres` service.

Tunables (env, all optional):
  LAKEBASE_DEAD_DB_REAP_ARMED     unset/false => dry-run (log only); 1/true => drop
  LAKEBASE_DEAD_DB_MIN_AGE_DAYS   default 14 — never reap a db younger than this
  LAKEBASE_DEAD_DB_MAX_PER_RUN    default 25 — cap drops per sweep
  LAKEBASE_DEAD_DB_REAP_INTERVAL  default 21600 (6h) — sweep cadence
  LAKEBASE_SHARED_PROJECT         default solution-builder — pool base slug
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..core._config import AppConfig, logger
from ..models import RESOURCE_SUFFIX_LEN, resource_suffix

# ── Constants / tunables ──────────────────────────────────────────────────────
DBGEN_PREFIX = "db-dbgen-"
POOL_BRANCH = "production"
RESOURCES_JSON = "resources.json"
_HEXCHARS = frozenset("0123456789abcdef")
# A slug shorter than this can't be reliably distinguished in a full-text scan,
# so we never auto-reap on its absence — it's held for manual review instead.
_MIN_SLUG_LEN = 5


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


DEAD_DB_REAP_INTERVAL = _env_int("LAKEBASE_DEAD_DB_REAP_INTERVAL", 6 * 60 * 60)
DEAD_DB_MIN_AGE_DAYS = _env_int("LAKEBASE_DEAD_DB_MIN_AGE_DAYS", 14)
DEAD_DB_MAX_PER_RUN = _env_int("LAKEBASE_DEAD_DB_MAX_PER_RUN", 25)


def _shared_pool_base() -> str:
    return os.environ.get("LAKEBASE_SHARED_PROJECT", "solution-builder")


def pool_projects() -> list[str]:
    """The shared pool projects the build agent distributes across (base + -2…-9),
    matching lakebase_setup_db.sh's `shared_candidates`."""
    base = _shared_pool_base()
    return [base] + [f"{base}-{i}" for i in range(2, 10)]


def _reap_armed() -> bool:
    return os.environ.get("LAKEBASE_DEAD_DB_REAP_ARMED", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


# ── Data ──────────────────────────────────────────────────────────────────────
@dataclass
class DbCandidate:
    project_slug: str          # pool project the db lives in (solution-builder[-N])
    name: str                  # full resource path projects/…/databases/db-dbgen-…
    db_id: str                 # the leaf: db-dbgen-<slug>[-<hex>]
    create_time: datetime | None


@dataclass
class ReapDecision:
    db: DbCandidate
    verdict: str               # live | dead | too_young | uncertain | skipped
    reason: str


@dataclass
class ReapResult:
    disabled: bool = False
    listed: int = 0
    live: int = 0
    held: int = 0              # too_young
    uncertain: int = 0
    dead: int = 0
    reaped: int = 0
    errors: int = 0
    armed: bool = False
    dropped: list[str] = field(default_factory=list)
    would_drop: list[str] = field(default_factory=list)


# ── Pure classification (the safety core — exhaustively unit-tested) ──────────
def _slug(db_id: str) -> str:
    return db_id[len(DBGEN_PREFIX):]


def _trailing_hex(slug: str) -> str:
    last = slug.rsplit("-", 1)[-1] if "-" in slug else slug
    return last if last and all(c in _HEXCHARS for c in last) else ""


def _slug_variants(slug: str) -> set[str]:
    # a db resource id `db-dbgen-foo-bar` maps to pg database `dbgen_foo_bar`;
    # a live resources.json may spell the slug with hyphens, underscores, or joined.
    return {slug, slug.replace("-", "_"), slug.replace("-", "")}


def _age_days(create_time: datetime | None, now: datetime) -> int | None:
    if create_time is None:
        return None
    ct = create_time if create_time.tzinfo else create_time.replace(tzinfo=timezone.utc)
    return (now - ct).days


def classify_databases(
    candidates: list[DbCandidate],
    *,
    live_id_prefixes: set[str],
    live_haystack: str,
    now: datetime,
    min_age_days: int,
) -> list[ReapDecision]:
    """Decide each pool db's fate. A db is `dead` (reclaimable) ONLY when it is
    unreferenced by the project-id-suffix AND by a full-text scan of every live
    project's resources.json, AND older than `min_age_days`. Recent ones are
    `too_young` (held); short unverifiable slugs are `uncertain` (held)."""
    hay = live_haystack or ""
    out: list[ReapDecision] = []
    for c in candidates:
        if not c.db_id.startswith(DBGEN_PREFIX):
            out.append(ReapDecision(c, "skipped", "not a db-dbgen-* pool database"))
            continue
        slug = _slug(c.db_id)

        # Signal 1: id-suffix. `<hex>` (>= the resource-suffix length) that prefixes
        # a live project id proves the owning project still exists.
        th = _trailing_hex(slug)
        if len(th) >= RESOURCE_SUFFIX_LEN and th[:RESOURCE_SUFFIX_LEN] in live_id_prefixes:
            out.append(ReapDecision(
                c, "live", f"id-suffix {th[:RESOURCE_SUFFIX_LEN]} matches a live project"))
            continue

        # Signal 2: the slug (any spelling) appears in some live resources.json.
        variants = [v for v in _slug_variants(slug) if len(v) >= _MIN_SLUG_LEN]
        if any(v in hay for v in variants):
            out.append(ReapDecision(
                c, "live", "slug referenced in a live project's resources.json"))
            continue

        # No live signal. The age gate is the guard against reaping a just-built
        # live db whose resources.json hasn't recorded it yet.
        age = _age_days(c.create_time, now)
        if age is None or age < min_age_days:
            out.append(ReapDecision(c, "too_young", f"age {age}d < {min_age_days}d gate — held"))
            continue

        # Old + unreferenced, but too short to have text-verified → don't guess.
        if not variants:
            out.append(ReapDecision(
                c, "uncertain", f"slug '{slug}' too short to verify — manual review"))
            continue

        out.append(ReapDecision(
            c, "dead", f"unreferenced (id-suffix + resources.json), age {age}d >= {min_age_days}d"))
    return out


def select_for_reap(decisions: list[ReapDecision], *, max_per_run: int) -> list[DbCandidate]:
    """The capped set actually eligible to drop: only `dead`, oldest first."""
    dead = [d.db for d in decisions if d.verdict == "dead"]
    _far_future = datetime.max.replace(tzinfo=timezone.utc)
    dead.sort(key=lambda db: (db.create_time or _far_future))  # oldest (smallest) first
    return dead[: max(0, max_per_run)]


# ── I/O (real implementations; injectable so the sweep is unit-testable) ──────
def _load_live_signals(engine) -> tuple[set[str], str]:
    """Live project id-prefixes + a lowercased concat of every live project's
    root resources.json (the full-text haystack). Read as the app SP against the
    app's own metadata DB — no elevated Postgres role needed. Skips resources.json
    rows whose project no longer exists (belt-and-braces; delete cascades)."""
    prefixes: set[str] = set()
    if engine is None:
        return prefixes, ""
    from sqlmodel import Session, select

    from .file_sync import decompress_content
    from ..models import Project, ProjectFile

    live_ids: set[str] = set()
    blobs: list[bytes] = []
    with Session(engine) as session:
        for row in session.exec(select(Project.id)).all():
            pid = row if isinstance(row, str) else row[0]
            if pid:
                live_ids.add(pid)
                prefixes.add(resource_suffix(pid))
        for row in session.exec(
            select(ProjectFile.project_id, ProjectFile.content_compressed)
            .where(ProjectFile.relative_path == RESOURCES_JSON)
        ).all():
            pid, blob = row
            if pid in live_ids and blob is not None:
                blobs.append(blob)

    parts: list[str] = []
    for blob in blobs:
        try:
            parts.append(decompress_content(blob).decode("utf-8", "replace").lower())
        except Exception as e:  # noqa: BLE001 — one bad blob must not blind the scan
            logger.debug(f"[reapers] dead-db reaper: skipped a resources.json blob: {e!r}")
    return prefixes, "\n".join(parts)


def _target_sp_client(config):
    """A WorkspaceClient authenticated as the deployer SP against the target
    workspace (which owns the pool)."""
    from databricks.sdk import WorkspaceClient

    host = config.default_target_workspace_host or ""
    if host and not host.startswith("http"):
        host = f"https://{host}"
    return WorkspaceClient(
        host=host,
        client_id=config.deployer_sp_client_id,
        client_secret=config.deployer_sp_client_secret,
        auth_type="oauth-m2m",
    )


def _parse_ts(ts) -> datetime | None:
    """Normalize a Lakebase `create_time` to a tz-aware datetime.

    ⚠️ The postgres SDK hands back a `google.protobuf.timestamp_pb2.Timestamp`
    (its `str()` is `'seconds: N'`, NOT ISO-8601) — so `.ToDatetime()` is the
    correct conversion; naively `fromisoformat(str(ts))` yields None, which would
    make EVERY db classify `too_young` and the reaper silently never reap. Plain
    `datetime` and ISO-8601 strings are also accepted for robustness."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    # google.protobuf Timestamp — use its native conversion (signature varies by
    # protobuf version: newer accepts tzinfo=, older returns naive UTC).
    to_dt = getattr(ts, "ToDatetime", None)
    if callable(to_dt):
        try:
            parsed = to_dt(tzinfo=timezone.utc)
        except TypeError:
            parsed = to_dt()
        except Exception:  # noqa: BLE001
            parsed = None
        if isinstance(parsed, datetime):
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    # ISO-8601 string fallback.
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _list_pool_databases(client, projects: list[str]) -> list[DbCandidate]:
    out: list[DbCandidate] = []
    for proj in projects:
        parent = f"projects/{proj}/branches/{POOL_BRANCH}"
        try:
            for db in client.postgres.list_databases(parent):
                name = getattr(db, "name", "") or ""
                db_id = name.split("/")[-1]
                if not db_id.startswith(DBGEN_PREFIX):
                    continue
                out.append(DbCandidate(
                    project_slug=proj, name=name, db_id=db_id,
                    create_time=_parse_ts(getattr(db, "create_time", None)),
                ))
        except Exception as e:  # noqa: BLE001 — a not-yet-created -N project is fine
            logger.debug(f"[reapers] dead-db reaper: list {parent} skipped: {e!r}")
    return out


def _drop_database(client, name: str) -> None:
    client.postgres.delete_database(name)


# ── Orchestration ─────────────────────────────────────────────────────────────
def sweep_dead_databases(
    app,
    *,
    load_signals=None,
    make_client=None,
    list_pool=None,
    drop=None,
    now: datetime | None = None,
    armed: bool | None = None,
    min_age_days: int | None = None,
    max_per_run: int | None = None,
) -> ReapResult:
    """One reaper pass. Reads live signals + lists the pool, classifies, and (only
    when armed) drops up to `max_per_run` confirmed-dead dbs. Returns a ReapResult.
    The `*_fn` params are injection seams for tests; production uses the real I/O.
    """
    config = getattr(getattr(app, "state", None), "config", None) or AppConfig()
    now = now or datetime.now(timezone.utc)
    armed = _reap_armed() if armed is None else armed
    min_age_days = DEAD_DB_MIN_AGE_DAYS if min_age_days is None else min_age_days
    max_per_run = DEAD_DB_MAX_PER_RUN if max_per_run is None else max_per_run
    load_signals = load_signals or _load_live_signals
    make_client = make_client or _target_sp_client
    list_pool = list_pool or _list_pool_databases
    drop = drop or _drop_database

    res = ReapResult(armed=armed)

    # Only runs where the shared REMOTE pool exists (cross-workspace deploy). In a
    # plain single-workspace build there is no shared pool to reap.
    if not (config.cross_workspace_deploy_enabled and config.default_target_workspace_host):
        res.disabled = True
        logger.info("[reapers] dead-db reaper: disabled (no cross-workspace target configured)")
        return res

    engine = getattr(getattr(app, "state", None), "engine", None)
    prefixes, haystack = load_signals(engine)
    client = make_client(config)
    candidates = list_pool(client, pool_projects())
    res.listed = len(candidates)

    decisions = classify_databases(
        candidates, live_id_prefixes=prefixes, live_haystack=haystack,
        now=now, min_age_days=min_age_days,
    )
    res.live = sum(1 for d in decisions if d.verdict == "live")
    res.held = sum(1 for d in decisions if d.verdict == "too_young")
    res.uncertain = sum(1 for d in decisions if d.verdict == "uncertain")
    res.dead = sum(1 for d in decisions if d.verdict == "dead")

    to_reap = select_for_reap(decisions, max_per_run=max_per_run)
    res.would_drop = [db.db_id for db in to_reap]

    if not armed:
        logger.info(
            f"[reapers] dead-db reaper DRY-RUN: listed={res.listed} live={res.live} "
            f"held={res.held} uncertain={res.uncertain} dead={res.dead}; would drop "
            f"{len(to_reap)} (cap {max_per_run}): {res.would_drop}"
        )
        return res

    for db in to_reap:
        try:
            drop(client, db.name)
            res.reaped += 1
            res.dropped.append(db.db_id)
            logger.warning(
                f"[reapers] dead-db reaper DROPPED {db.db_id} (pool={db.project_slug})"
            )
        except Exception as e:  # noqa: BLE001 — one failed drop must not stop the rest
            res.errors += 1
            logger.warning(f"[reapers] dead-db reaper: drop failed for {db.db_id}: {e!r}")

    logger.info(
        f"[reapers] dead-db reaper: listed={res.listed} live={res.live} held={res.held} "
        f"uncertain={res.uncertain} dead={res.dead} reaped={res.reaped} errors={res.errors}"
    )
    return res
