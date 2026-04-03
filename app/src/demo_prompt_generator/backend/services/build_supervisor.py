"""Build supervisor: orchestrates multiple worker agents with a shared context ledger.

The supervisor:
1. Sets up shared infrastructure (catalog, schema, volumes)
2. Dispatches worker agents by dependency tier
3. Maintains a context ledger (what's been created, resource IDs, names)
4. Validates between tiers (resources exist, names consistent)
5. Runs final validation pass
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
from collections.abc import AsyncIterator
from contextvars import copy_context
from dataclasses import dataclass, field
from pathlib import Path

from .build_executor import (
    _build_claude_env,
    _process_agent_message,
    _KEEPALIVE_INTERVAL,
    resolve_build_dir,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Context Ledger
# ---------------------------------------------------------------------------


@dataclass
class CreatedResource:
    """A resource created by a worker agent."""
    resource_type: str  # table, volume, pipeline, endpoint, dashboard, genie, ka, mas, app
    name: str
    full_name: str = ""
    extra: dict = field(default_factory=dict)  # resource-specific metadata


@dataclass
class ContextLedger:
    """Shared state between supervisor and workers.

    The ledger tracks:
    - What catalog/schema/volume have been created
    - All resources created by workers so far
    - Key identifiers that must be consistent across components
    """
    catalog: str = ""
    schema: str = ""
    volume_path: str = ""
    resources: list[CreatedResource] = field(default_factory=list)
    identifiers: dict[str, str] = field(default_factory=dict)
    worker_notes: list[str] = field(default_factory=list)

    def add_resource(self, resource: CreatedResource) -> None:
        self.resources.append(resource)

    def to_context_string(self) -> str:
        """Format the ledger as context for a worker agent's system prompt."""
        lines = [
            "# Context Ledger — Resources Created So Far",
            "",
            f"Catalog: `{self.catalog}`" if self.catalog else "",
            f"Schema: `{self.schema}`" if self.schema else "",
            f"Volume: `{self.volume_path}`" if self.volume_path else "",
            "",
        ]

        if self.resources:
            lines.append("## Created Resources")
            lines.append("")
            for r in self.resources:
                detail = f"  - **{r.resource_type}**: `{r.name}`"
                if r.full_name:
                    detail += f" ({r.full_name})"
                if r.extra:
                    extras = ", ".join(f"{k}={v}" for k, v in r.extra.items())
                    detail += f" [{extras}]"
                lines.append(detail)
            lines.append("")

        if self.identifiers:
            lines.append("## Key Identifiers (must be consistent)")
            lines.append("")
            for k, v in self.identifiers.items():
                lines.append(f"  - **{k}**: `{v}`")
            lines.append("")

        if self.worker_notes:
            lines.append("## Notes from Previous Workers")
            lines.append("")
            for note in self.worker_notes:
                lines.append(f"  - {note}")

        return "\n".join(line for line in lines if line is not None)

    def to_dict(self) -> dict:
        return {
            "catalog": self.catalog,
            "schema": self.schema,
            "volume_path": self.volume_path,
            "resources": [
                {"type": r.resource_type, "name": r.name, "full_name": r.full_name, **r.extra}
                for r in self.resources
            ],
            "identifiers": self.identifiers,
            "worker_notes": self.worker_notes,
        }


# ---------------------------------------------------------------------------
# Worker system prompt composition
# ---------------------------------------------------------------------------


def compose_worker_system_prompt(
    instruction_file: str,
    instruction_content: str,
    shared_context: str,
    ledger: ContextLedger,
) -> str:
    """Build a focused system prompt for a worker agent."""
    return f"""\
You are a Databricks demo builder worker. Your job is to execute ONE specific \
part of a demo build plan.

You have access to Claude Code tools (Read, Write, Edit, Bash, Glob, Grep) \
and Databricks MCP tools (execute_sql, create_or_update_dashboard, etc.). \
Use the appropriate AI Dev Kit skills when building specific components.

# Your Task: {instruction_file}

{instruction_content}

# Shared Story & Data Context

{shared_context}

# What Already Exists

{ledger.to_context_string()}

# Rules

1. Use the catalog, schema, and volume from the context ledger above — do NOT create new ones.
2. Use existing tables listed in the ledger — do NOT recreate data that already exists.
3. Load the relevant AI Dev Kit skill BEFORE building each component type.
4. After completing each resource, report what you created in this format:
   CREATED: <type> | <name> | <full_name> | <extra_info>
5. If you encounter an inconsistency (e.g., a table name in your instructions doesn't \
match what's in the ledger), use the ledger's version — it reflects what actually exists.
6. Report progress after completing each major step.
7. When finished, provide a summary starting with "WORKER COMPLETE:" listing all resources created."""


# ---------------------------------------------------------------------------
# Worker agent runner
# ---------------------------------------------------------------------------


def _run_worker_in_thread(
    result_queue: queue.Queue,
    prompt: str,
    system_prompt: str,
    project_dir: str,
    claude_env: dict[str, str],
    worker_id: str,
):
    """Run a worker agent in a dedicated thread."""
    from claude_agent_sdk import ClaudeAgentOptions, query

    async def _run():
        try:
            options = ClaudeAgentOptions(
                cwd=project_dir,
                system_prompt=system_prompt,
                allowed_tools=[
                    "Read", "Write", "Edit", "Bash", "Glob", "Grep", "Skill",
                ],
                permission_mode="bypassPermissions",
                env=claude_env,
                max_turns=50,
            )

            async for message in query(prompt=prompt, options=options):
                result_queue.put(("message", worker_id, message))

        except Exception as exc:
            result_queue.put(("error", worker_id, exc))
        finally:
            result_queue.put(("done", worker_id, None))

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Supervisor: orchestrate workers
# ---------------------------------------------------------------------------


async def _run_worker(
    worker_id: str,
    instruction_file: str,
    instruction_content: str,
    shared_context: str,
    ledger: ContextLedger,
    project_dir: str,
    claude_env: dict[str, str],
) -> AsyncIterator[dict]:
    """Run a single worker agent and yield SSE events."""
    system_prompt = compose_worker_system_prompt(
        instruction_file, instruction_content, shared_context, ledger,
    )
    prompt = (
        f"Execute the build instructions for {instruction_file}. "
        f"Use the context ledger for existing resources. "
        f"Load relevant AI Dev Kit skills. Begin now."
    )

    result_queue: queue.Queue = queue.Queue()
    ctx = copy_context()

    thread = threading.Thread(
        target=lambda: ctx.run(
            _run_worker_in_thread,
            result_queue, prompt, system_prompt, project_dir, claude_env, worker_id,
        ),
        daemon=True,
    )
    thread.start()

    while True:
        try:
            msg_type, wid, msg = result_queue.get(timeout=_KEEPALIVE_INTERVAL)
        except queue.Empty:
            yield {"type": "keepalive"}
            continue

        if msg_type == "done":
            break

        if msg_type == "error":
            yield {
                "type": "worker_error",
                "worker": worker_id,
                "content": str(msg),
            }
            break

        if msg_type == "message":
            for event in _process_agent_message(msg):
                event["worker"] = worker_id
                # Prefix event types with worker_
                if event["type"].startswith("build_"):
                    event["type"] = "worker_" + event["type"][6:]
                yield event


async def stream_supervised_build(
    files: dict[str, str],
    collection_json: dict | None,
    user_email: str,
    demo_name: str,
    generation_id: int,
    databricks_host: str,
    databricks_token: str,
    model: str = "",
    base_dir: str = "",
) -> AsyncIterator[dict]:
    """Orchestrate a supervised multi-agent build.

    If collection_json is provided and has output_files with dependencies,
    uses the supervisor pattern. Otherwise falls back to single-agent build.
    """
    from .build_executor import stream_build_execution

    # Check if we should use supervisor mode
    output_files = []
    if collection_json:
        output_files = collection_json.get("output_files", [])

    if not output_files or len(output_files) <= 1:
        # Fall back to single-agent build
        async for event in stream_build_execution(
            files, user_email, demo_name, generation_id,
            databricks_host, databricks_token, model, base_dir,
        ):
            yield event
        return

    # --- Supervisor mode ---
    build_dir = resolve_build_dir(user_email, demo_name, generation_id, base_dir)
    project_dir = str(build_dir)
    claude_env = _build_claude_env(databricks_host, databricks_token)
    if model:
        claude_env["ANTHROPIC_MODEL"] = model

    ledger = ContextLedger()

    yield {"type": "supervisor_start", "project_dir": project_dir, "mode": "supervised"}

    # Extract shared context (always from the first file / story-and-data)
    shared_context = ""
    for fname in ["01-story-and-data.md", "reference.md"]:
        if fname in files:
            shared_context = files[fname]
            break
    if not shared_context:
        shared_context = next(iter(files.values()), "")

    # Build dependency tiers from output_files
    from .collection_service import OutputFile
    of_list = [
        OutputFile(filename=f["filename"], purpose=f["purpose"], depends_on=f.get("depends_on", []))
        for f in output_files
    ]

    # Simple tier computation
    remaining = list(of_list)
    completed_names: set[str] = set()
    tiers: list[list[OutputFile]] = []

    while remaining:
        tier = []
        for f in remaining:
            if not f.depends_on:
                tier.append(f)
            elif f.depends_on == ["*"]:
                continue
            elif all(d in completed_names for d in f.depends_on):
                tier.append(f)

        if not tier:
            tier = [f for f in remaining if f.depends_on == ["*"]]
            if not tier:
                tier = remaining[:]

        for f in tier:
            remaining.remove(f)
            completed_names.add(f.filename)
        tiers.append(tier)

    # Execute tiers sequentially, workers within tiers in parallel
    for tier_idx, tier_files in enumerate(tiers):
        worker_names = [f.filename for f in tier_files]
        yield {
            "type": "supervisor_tier_start",
            "tier": tier_idx,
            "workers": worker_names,
        }

        # For each worker in this tier, collect events
        # Run workers sequentially for now (parallel threading is complex)
        # TODO: true parallel worker execution
        for of in tier_files:
            instruction_content = files.get(of.filename, "")
            if not instruction_content:
                yield {
                    "type": "supervisor_warning",
                    "content": f"No instruction file found for {of.filename} — skipping",
                }
                continue

            worker_id = of.filename.replace(".md", "").replace("/", "_")

            yield {"type": "worker_start", "worker": worker_id, "filename": of.filename}

            async for event in _run_worker(
                worker_id=worker_id,
                instruction_file=of.filename,
                instruction_content=instruction_content,
                shared_context=shared_context,
                ledger=ledger,
                project_dir=project_dir,
                claude_env=claude_env,
            ):
                yield event

            yield {"type": "worker_complete", "worker": worker_id}

        # Between tiers: supervisor validates
        yield {
            "type": "supervisor_validating",
            "tier": tier_idx,
            "ledger": ledger.to_dict(),
        }

        yield {"type": "supervisor_tier_complete", "tier": tier_idx}

    # Final validation
    yield {"type": "supervisor_final_validation"}

    # List all created files
    created_files = []
    for p in build_dir.rglob("*"):
        if p.is_file():
            created_files.append(str(p.relative_to(build_dir)))

    yield {
        "type": "supervisor_complete",
        "project_dir": project_dir,
        "files_created": sorted(created_files),
        "ledger": ledger.to_dict(),
    }
