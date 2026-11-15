"""Token usage + cost of a project's agent conversations (the chat's "$" chip).

Source of truth = the Claude Code transcripts the SDK writes under
`<project>/.claude/projects/<cwd>/`: `<session>.jsonl` for the main agent and
`<session>/subagents/agent-<id>.jsonl` (+ `.meta.json` with the agent type) for
each subagent. Every assistant line carries the API `usage`; one response is
split over several lines (one per content block) that repeat the SAME usage, so
rows are keyed by message id — counting lines would multiply the cost.

Rows land in `agent_usage` at the end of every turn (`ingest_session_from_disk`)
and, for conversations that predate this table, lazily from the DB copy of the
transcripts (`backfill_from_db`). Cost is computed at read time from `PRICING`.
"""
from __future__ import annotations

import io
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

import zstandard as zstd
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, select

from ..core._config import logger
from ..models import AgentUsage, ProjectFile
from .file_sync import _ZSTD_MAGIC_FIRST_BYTE, decompress_content

# ---------------------------------------------------------------------------
# Pricing — USD per million tokens. Copied from Claude Code's baked-in model
# catalog (the same table the CLI uses for its own `total_cost_usd`). These
# equal Databricks' pay-per-token list prices at $0.07/DBU (e.g. Opus 4.7 =
# 71.429 DBU/M in, 357.143 out); negotiated discounts aren't applied.
# ---------------------------------------------------------------------------

_TIERS: dict[str, dict[str, Any]] = {
    "tier_2_10": {"input": 2, "output": 10, "write_5m": 2.5, "write_1h": 4, "read": 0.2},
    "tier_2_10_read_0_10": {"input": 2, "output": 10, "write_5m": 2.5, "write_1h": 4, "read": 0.1},
    "tier_3_15": {"input": 3, "output": 15, "write_5m": 3.75, "write_1h": 6, "read": 0.3},
    "tier_4_20_read_0_20": {"input": 4, "output": 20, "write_5m": 5, "write_1h": 8, "read": 0.2},
    "tier_5_25": {"input": 5, "output": 25, "write_5m": 6.25, "write_1h": 10, "read": 0.5},
    "tier_10_50": {"input": 10, "output": 50, "write_5m": 12.5, "write_1h": 20, "read": 1},
    "tier_10_50_read_0_25": {"input": 10, "output": 50, "write_5m": 12.5, "write_1h": 20, "read": 0.25},
    "tier_15_75": {"input": 15, "output": 75, "write_5m": 18.75, "write_1h": 30, "read": 1.5},
    "haiku_35": {"input": 0.8, "output": 4, "write_5m": 1, "write_1h": 1.6, "read": 0.08},
    "haiku_45": {"input": 1, "output": 5, "write_5m": 1.25, "write_1h": 2, "read": 0.1},
    "haiku_55": {
        "input": 0.1, "output": 0.5, "write_5m": 0.125, "write_1h": 0.2, "read": 0.01,
        "long_prompt": {"above": 100_000, "input": 0.5, "output": 2.5, "write_5m": 0.625, "write_1h": 1, "read": 0.05},
    },
}
WEB_SEARCH_USD = 0.01  # per request
US_ONLY_MULTIPLIER = 1.1  # `inference_geo == "us"`

PRICING: dict[str, str] = {
    "claude-3-5-haiku": "haiku_35",
    "claude-haiku-4-5": "haiku_45",
    "claude-haiku-5-5": "haiku_55",
    "claude-3-5-sonnet": "tier_3_15",
    "claude-3-7-sonnet": "tier_3_15",
    "claude-sonnet-4-0": "tier_3_15",
    "claude-sonnet-4-5": "tier_3_15",
    "claude-sonnet-4-6": "tier_3_15",
    "claude-sonnet-5": "tier_2_10",
    "claude-sonnet-5-5": "tier_2_10_read_0_10",
    "claude-opus-4-0": "tier_15_75",
    "claude-opus-4-1": "tier_15_75",
    "claude-opus-4-5": "tier_5_25",
    "claude-opus-4-6": "tier_5_25",
    "claude-opus-4-7": "tier_5_25",
    "claude-opus-4-8": "tier_5_25",
    "claude-opus-5": "tier_5_25",
    "claude-opus-5-5": "tier_4_20_read_0_20",
    "claude-fable-5": "tier_10_50",
    "claude-fable-5-1": "tier_10_50_read_0_25",
}

_MODEL_RE = re.compile(r"claude-(?:(\d)-(\d)-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d)(?!\d))?)?")


def resolve_model(model: str, aliases: dict[str, str] | None = None) -> tuple[str, bool] | None:
    """Map a transcript model name to a `PRICING` key → (key, estimated).

    Handles gateway spellings (`databricks-claude-opus-4-7`, `us.anthropic.…`,
    `…[1m]`, date suffixes). A version missing from the catalog falls back to the
    closest LOWER version of the same family (e.g. sonnet-4-8 → sonnet-4-6) and is
    flagged `estimated`. A name that isn't a Claude model (a custom AI Gateway
    endpoint) is priced as `aliases[name]`, also flagged `estimated`. None = not
    a Claude model we can price.
    """
    m = _MODEL_RE.search(model.lower())
    if not m:
        target = (aliases or {}).get(model)
        resolved = resolve_model(target) if target else None
        return (resolved[0], True) if resolved else None
    old_major, old_minor, family, major, minor = m.groups()
    if old_major:  # claude-3-5-sonnet style
        key = f"claude-{old_major}-{old_minor}-{family}"
        return (key, False) if key in PRICING else None
    if not major:
        return None
    exact = f"claude-{family}-{major}" + (f"-{minor}" if minor else "")
    if exact in PRICING:
        return exact, False
    if minor is None and f"{exact}-0" in PRICING:
        return f"{exact}-0", False
    want = (int(major), int(minor or 0))
    same_family = []
    for key in PRICING:
        k = _MODEL_RE.search(key)
        if k and k.group(3) == family and k.group(4):
            same_family.append(((int(k.group(4)), int(k.group(5) or 0)), key))
    lower = [c for c in same_family if c[0] <= want]
    if not lower:
        return None
    return max(lower)[1], True


def cost_usd(row: AgentUsage, aliases: dict[str, str] | None = None) -> float | None:
    """List-price cost of one response (the CLI's formula). None = unpriced model."""
    resolved = resolve_model(row.model, aliases)
    if resolved is None:
        return None
    tier = _TIERS[PRICING[resolved[0]]]
    prompt = row.input_tokens + row.cache_read_tokens + row.cache_write_5m_tokens + row.cache_write_1h_tokens
    lp = tier.get("long_prompt")
    if lp and prompt > lp["above"]:
        tier = lp
    usd = (
        row.input_tokens * tier["input"]
        + row.output_tokens * tier["output"]
        + row.cache_read_tokens * tier["read"]
        + row.cache_write_5m_tokens * tier["write_5m"]
        + row.cache_write_1h_tokens * tier["write_1h"]
    ) / 1e6
    if row.inference_geo == "us":
        usd *= US_ONLY_MULTIPLIER
    return usd + row.web_search_requests * WEB_SEARCH_USD


# ---------------------------------------------------------------------------
# Transcript parsing
# ---------------------------------------------------------------------------


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def parse_transcript(
    lines: Iterable[str],
    *,
    session_id: str,
    agent_id: str | None = None,
    agent_type: str | None = None,
    agent_description: str | None = None,
) -> dict[str, dict[str, Any]]:
    """One row dict per API message id (last line wins — they repeat the same usage)."""
    rows: dict[str, dict[str, Any]] = {}
    for line in lines:
        if '"usage"' not in line:  # cheap pre-filter: most lines are tool results
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        msg = entry.get("message") if entry.get("type") == "assistant" else None
        if not isinstance(msg, dict):
            continue
        usage, mid, model = msg.get("usage"), msg.get("id"), msg.get("model") or ""
        if not isinstance(usage, dict) or not mid or model == "<synthetic>":
            continue
        cache = usage.get("cache_creation") or {}
        write_total = int(usage.get("cache_creation_input_tokens") or 0)
        write_1h = min(int(cache.get("ephemeral_1h_input_tokens") or 0), write_total)
        # Older CLIs wrote subagent turns into the main file, flagged as sidechain.
        line_agent = entry.get("agentId") if entry.get("isSidechain") else None
        rows[mid] = {
            "session_id": session_id,
            "message_id": mid,
            "agent_id": agent_id or line_agent,
            "agent_type": agent_type or ("subagent" if line_agent else None),
            "agent_description": agent_description,
            "model": model[:200],
            "input_tokens": int(usage.get("input_tokens") or 0),
            "output_tokens": int(usage.get("output_tokens") or 0),
            "cache_read_tokens": int(usage.get("cache_read_input_tokens") or 0),
            "cache_write_5m_tokens": write_total - write_1h,
            "cache_write_1h_tokens": write_1h,
            "web_search_requests": int((usage.get("server_tool_use") or {}).get("web_search_requests") or 0),
            "inference_geo": (usage.get("inference_geo") or None),
            "created_at": _parse_ts(entry.get("timestamp")),
        }
    return rows


def _subagent_meta(raw: bytes | str | None) -> tuple[str | None, str | None]:
    if not raw:
        return None, None
    try:
        meta = json.loads(raw)
    except ValueError:
        return None, None
    return meta.get("agentType") or "subagent", meta.get("description")


def _transcript_kind(rel: str) -> tuple[str, str | None] | None:
    """`.claude/projects/<cwd>/<sid>.jsonl` → (sid, None);
    `.claude/projects/<cwd>/<sid>/subagents/agent-<aid>.jsonl` → (sid, aid)."""
    parts = Path(rel).parts
    if len(parts) < 4 or parts[0] != ".claude" or parts[1] != "projects" or not rel.endswith(".jsonl"):
        return None
    if len(parts) == 4:
        return parts[3][: -len(".jsonl")], None
    if len(parts) == 6 and parts[4] == "subagents" and parts[5].startswith("agent-"):
        return parts[3], parts[5][len("agent-"): -len(".jsonl")]
    return None


def _upsert(db: Session, project_id: str, rows: Iterable[dict[str, Any]]) -> int:
    rows = [{**r, "project_id": project_id} for r in rows]
    if not rows:
        return 0
    for i in range(0, len(rows), 500):
        stmt = pg_insert(AgentUsage.__table__).values(rows[i: i + 500])
        update = {c: stmt.excluded[c] for c in rows[0] if c not in ("project_id", "message_id")}
        db.exec(stmt.on_conflict_do_update(index_elements=["project_id", "message_id"], set_=update))  # type: ignore[call-overload]
    db.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


def _session_files_on_disk(project_dir: Path, session_id: str) -> Iterator[tuple[Path, str | None]]:
    root = project_dir / ".claude" / "projects"
    if not root.is_dir():
        return
    for cwd_dir in root.iterdir():
        main = cwd_dir / f"{session_id}.jsonl"
        if main.is_file():
            yield main, None
        sub = cwd_dir / session_id / "subagents"
        if sub.is_dir():
            for f in sorted(sub.glob("agent-*.jsonl")):
                yield f, f.stem[len("agent-"):]


def ingest_session_from_disk(engine, project_id: str, project_dir: Path, session_id: str) -> int:
    """Upsert every response of one conversation (main + subagents) from disk."""
    rows: dict[str, dict[str, Any]] = {}
    for path, agent_id in _session_files_on_disk(project_dir, session_id):
        agent_type = desc = None
        if agent_id:
            meta = path.with_suffix(".meta.json")
            agent_type, desc = _subagent_meta(meta.read_bytes() if meta.is_file() else None)
            agent_type = agent_type or "subagent"
        with path.open(encoding="utf-8", errors="replace") as fh:
            rows.update(parse_transcript(
                fh, session_id=session_id, agent_id=agent_id, agent_type=agent_type, agent_description=desc,
            ))
    with Session(engine) as db:
        return _upsert(db, project_id, rows.values())


def _iter_lines(blob: bytes) -> Iterator[str]:
    """Lines of a stored file without materialising it (zstd streams; legacy zlib
    rows predate big transcripts and are decompressed whole)."""
    if blob and blob[0] == _ZSTD_MAGIC_FIRST_BYTE:
        reader = zstd.ZstdDecompressor().stream_reader(io.BytesIO(blob), read_across_frames=True)
        yield from io.TextIOWrapper(reader, encoding="utf-8", errors="replace")
    else:
        yield from decompress_content(blob).decode("utf-8", errors="replace").splitlines()


def backfill_from_db(db: Session, project_id: str) -> int:
    """Ingest conversations that have transcripts in the DB but no usage rows yet
    (projects that predate the table). Reads only the missing sessions' files."""
    paths = db.exec(
        select(ProjectFile.relative_path).where(
            ProjectFile.project_id == project_id,
            ProjectFile.relative_path.like(".claude/projects/%"),  # type: ignore[attr-defined]
        )
    ).all()
    by_session: dict[str, list[str]] = defaultdict(list)
    for rel in paths:
        kind = _transcript_kind(rel)
        if kind:
            by_session[kind[0]].append(rel)
    if not by_session:
        return 0
    known = set(db.exec(
        select(AgentUsage.session_id).where(AgentUsage.project_id == project_id).distinct()
    ).all())
    missing = [p for sid, ps in by_session.items() if sid not in known for p in ps]
    if not missing:
        return 0

    def _blob(rel: str) -> bytes | None:
        # One file at a time: a build's transcripts can be hundreds of MB.
        return db.exec(
            select(ProjectFile.content_compressed).where(
                ProjectFile.project_id == project_id, ProjectFile.relative_path == rel,
            )
        ).first()

    rows: dict[str, dict[str, Any]] = {}
    for rel in missing:
        blob = _blob(rel)
        if blob is None:
            continue
        sid, agent_id = _transcript_kind(rel)  # type: ignore[misc]
        agent_type = desc = None
        if agent_id:
            meta = _blob(rel[: -len(".jsonl")] + ".meta.json")
            agent_type, desc = _subagent_meta(decompress_content(meta) if meta else None)
            agent_type = agent_type or "subagent"
        rows.update(parse_transcript(
            _iter_lines(blob), session_id=sid, agent_id=agent_id, agent_type=agent_type, agent_description=desc,
        ))
        del blob
    n = _upsert(db, project_id, rows.values())
    logger.info(f"[usage] backfilled {n} responses for project {project_id} ({len(set(by_session) - known)} conversations)")
    return n


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def _empty() -> dict[str, Any]:
    return {
        "responses": 0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
        "cache_write_tokens": 0, "cost_usd": 0.0, "unpriced_responses": 0,
    }


def _add(acc: dict[str, Any], row: AgentUsage, usd: float | None) -> None:
    acc["responses"] += 1
    acc["input_tokens"] += row.input_tokens
    acc["output_tokens"] += row.output_tokens
    acc["cache_read_tokens"] += row.cache_read_tokens
    acc["cache_write_tokens"] += row.cache_write_5m_tokens + row.cache_write_1h_tokens
    if usd is None:
        acc["unpriced_responses"] += 1
    else:
        acc["cost_usd"] += usd


def summarize(rows: list[AgentUsage], aliases: dict[str, str] | None = None) -> dict[str, Any]:
    """Totals, per conversation (→ per agent), and per model. Newest conversation first.
    `aliases`: endpoint name → model to price it as (see `resolve_model`)."""
    total = _empty()
    models: dict[str, dict[str, Any]] = {}
    convs: dict[str, dict[str, Any]] = {}
    for row in rows:
        usd = cost_usd(row, aliases)
        _add(total, row, usd)
        resolved = resolve_model(row.model, aliases)
        m = models.setdefault(row.model, {
            "model": row.model,
            "priced_as": resolved[0] if resolved else None,
            "estimated": bool(resolved and resolved[1]),
            "totals": _empty(),
        })
        _add(m["totals"], row, usd)
        c = convs.setdefault(row.session_id, {
            "session_id": row.session_id, "started_at": row.created_at, "ended_at": row.created_at,
            "totals": _empty(), "agents": {},
        })
        c["started_at"] = min(c["started_at"], row.created_at)
        c["ended_at"] = max(c["ended_at"], row.created_at)
        _add(c["totals"], row, usd)
        name = "main" if row.agent_id is None else (row.agent_type or "subagent")
        a = c["agents"].setdefault(name, {"agent": name, "subagents": set(), "totals": _empty()})
        if row.agent_id:
            a["subagents"].add(row.agent_id)
        _add(a["totals"], row, usd)
    conversations = []
    for c in sorted(convs.values(), key=lambda c: c["started_at"], reverse=True):
        agents = sorted(c.pop("agents").values(), key=lambda a: (a["agent"] != "main", -a["totals"]["cost_usd"]))
        c["agents"] = [{**a, "subagents": len(a["subagents"])} for a in agents]
        conversations.append(c)
    return {
        "totals": total,
        "conversations": conversations,
        "models": sorted(models.values(), key=lambda m: -m["totals"]["cost_usd"]),
    }
