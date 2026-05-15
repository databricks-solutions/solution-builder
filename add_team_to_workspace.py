#!/usr/bin/env python3
"""Add a manager's full org (direct + indirect reports) to a workspace group.

Account-level path: no welcome emails are sent (the workspace SCIM POST
path was previously sending welcome emails on every fresh enrollment).
Flow:
  1. Resolve the org tree under <manager_email> via Logfood
     (main.metric_store.dim_workday_attributes_latest).
  2. The workspace's parent account is read from the workspace profile
     (WorkspaceClient.config.account_id) — no extra param needed.
  3. For each report email:
       a. Look up at the account level (`account.users.list`). If missing,
          report the email; we don't create new account users here.
       b. Assign to the target workspace via the WorkspaceAssignment API
          (`PUT /api/2.0/accounts/{acct}/workspaces/{wid}/permissionassignments/principals/{uid}`).
          Idempotent — no email.
  4. Ensure the `dbdemos-generator-sales` group exists at the account
     level. Adds every resolved user to it (idempotent).
  5. Bind the account group to the target workspace (so members get USER
     access to it).

Usage:
    python add_team_to_workspace.py tom.perez@databricks.com
    python add_team_to_workspace.py tom.perez@databricks.com \\
        --group-name dbdemos-generator-sales \\
        --workspace-host https://fevm-demo-generator.cloud.databricks.com/

Prereqs:
    - `databricks auth login --host <workspace-host> --profile FEVM_DEMO_GENERATOR`
      AND that profile must have account-admin permissions on its parent
      account (the SDK uses the same OAuth token for AccountClient).
    - `logfood` Databricks CLI profile (same as dbrain's ops/connectors/logfood).
    - `pip install databricks-sdk`.

Safe to re-run.
"""
from __future__ import annotations

import argparse
import sys
from typing import Iterable

# ── Defaults ──────────────────────────────────────────────────────────────
LOGFOOD_PROFILE = "logfood"
LOGFOOD_WAREHOUSE_ID = "927ac096f9833442"
WORKSPACE_PROFILE = "FEVM_DEMO_GENERATOR"
DEFAULT_WORKSPACE_HOST = "https://fevm-demo-generator.cloud.databricks.com/"
DEFAULT_GROUP_NAME = "dbdemos-generator-sales"
# Walk depth from manager down. 5 covers every realistic Databricks chain
# (Tom → his directs → their directs → … typical max is 3).
DOWN_LEVELS = 5


# ── Logfood: walk the org tree ────────────────────────────────────────────
def _build_walk_down_sql(down_levels: int) -> str:
    """Flat UNION ALL of `down_levels` joins. Copied from
    dbrain/ops/connectors/logfood/collect.py — fastest shape for this query
    (recursive CTE is ~2x slower on a warm warehouse)."""
    aliases = list("abcdefghijk")  # a = anchor, b = lvl 1, c = lvl 2, ...
    table = "main.metric_store.dim_workday_attributes_latest"
    anchor_subq = (
        f"(SELECT * FROM {table} "
        "WHERE LOWER(dim_employee_email_latest) = LOWER(:anchor))"
    )
    parts: list[str] = []
    parts.append(
        f"SELECT 0 AS lvl, a.dim_employee_email_latest AS email, "
        f"a.dim_employee_name_latest AS name, "
        f"a.dim_business_title_latest AS title "
        f"FROM {anchor_subq} a"
    )
    for lvl in range(1, down_levels + 1):
        leaf = aliases[lvl]
        chain: list[str] = []
        for i in range(lvl, 0, -1):
            child = aliases[i]
            parent = aliases[i - 1]
            parent_src = anchor_subq if i == 1 else table
            chain.append(
                f"JOIN {parent_src} {parent} "
                f"ON LOWER({child}.dim_manager_email_latest) "
                f"= LOWER({parent}.dim_employee_email_latest)"
            )
        parts.append(
            f"SELECT {lvl} AS lvl, {leaf}.dim_employee_email_latest AS email, "
            f"{leaf}.dim_employee_name_latest AS name, "
            f"{leaf}.dim_business_title_latest AS title "
            f"FROM {table} {leaf} " + " ".join(chain)
        )
    return "\nUNION ALL\n".join(parts)


def fetch_org_tree(manager_email: str) -> list[dict]:
    """Return [{email, name, title, lvl}] for manager + everyone under them."""
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.service.sql import StatementParameterListItem

    w = WorkspaceClient(profile=LOGFOOD_PROFILE)
    sql = _build_walk_down_sql(DOWN_LEVELS)
    params = [
        StatementParameterListItem(name="anchor", value=manager_email, type="STRING"),
    ]
    print(f"[logfood] walking org under {manager_email} (up to {DOWN_LEVELS} levels)…")
    resp = w.statement_execution.execute_statement(
        warehouse_id=LOGFOOD_WAREHOUSE_ID,
        statement=sql,
        parameters=params,
        wait_timeout="50s",
    )
    if resp.status and resp.status.state and str(resp.status.state) not in (
        "StatementState.SUCCEEDED", "SUCCEEDED"
    ):
        err = resp.status.error.message if resp.status.error else (
            f"unknown error (state={resp.status.state})"
        )
        raise RuntimeError(f"logfood query failed: {err}")
    if not resp.result or not resp.result.data_array:
        return []
    rows: list[dict] = []
    for row in resp.result.data_array:
        rows.append({
            "lvl": int(row[0]),
            "email": row[1] or "",
            "name": row[2] or "",
            "title": row[3] or "",
        })
    return rows


# ── Account-level operations (no welcome emails) ──────────────────────────
def find_account_user(ac, email: str):
    """Return the account-level SCIM user for `email`, or None."""
    matches = list(ac.users.list(filter=f'userName eq "{email}"'))
    return matches[0] if matches else None


def find_or_create_account_group(ac, name: str):
    """Return the account-level SCIM group with this displayName, creating it
    if missing. Account groups can be bound to any workspace in the account."""
    matches = list(ac.groups.list(filter=f'displayName eq "{name}"'))
    if matches:
        print(f"[account] group '{name}' exists ({len(matches[0].members or [])} members)")
        return matches[0]
    print(f"[account] creating group '{name}'…")
    return ac.groups.create(display_name=name)


def add_group_members(ac, group, user_ids: Iterable[str]) -> tuple[int, int]:
    """Add each user_id to the account-level `group` (idempotent).
    Returns (added, already_present)."""
    from databricks.sdk.service.iam import Patch, PatchOp, PatchSchema

    existing = {m.value for m in (group.members or [])}
    to_add = [uid for uid in user_ids if uid not in existing]
    if not to_add:
        return (0, len(existing))

    operations = [
        Patch(
            op=PatchOp.ADD,
            path="members",
            value=[{"value": uid} for uid in to_add],
        ),
    ]
    ac.groups.patch(
        id=group.id,
        operations=operations,
        schemas=[PatchSchema.URN_IETF_PARAMS_SCIM_API_MESSAGES_2_0_PATCH_OP],
    )
    return (len(to_add), len(existing))


def assign_to_workspace(ac, workspace_id: int, principal_id: str, email: str) -> bool:
    """PUT the user (or group) onto the workspace with USER permission.
    Idempotent — re-applying the same permission is a no-op. No email sent.
    Returns True on success."""
    from databricks.sdk.service.iam import WorkspacePermission

    try:
        ac.workspace_assignment.update(
            workspace_id=workspace_id,
            principal_id=int(principal_id),
            permissions=[WorkspacePermission.USER],
        )
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[account]   ✗ could not assign {email} ({principal_id}) to workspace: {e}")
        return False


# ── Orchestration ─────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manager_email",
                    help="The root of the org tree to enroll (e.g. tom.perez@databricks.com).")
    ap.add_argument("--group-name", default=DEFAULT_GROUP_NAME,
                    help=f"Workspace group to populate (default: {DEFAULT_GROUP_NAME}).")
    ap.add_argument("--workspace-host", default=DEFAULT_WORKSPACE_HOST,
                    help=f"Target workspace URL (default: {DEFAULT_WORKSPACE_HOST}). "
                         f"Profile {WORKSPACE_PROFILE} must point at it.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Resolve the org tree and print what would happen — no writes.")
    args = ap.parse_args()

    from databricks.sdk import WorkspaceClient

    # ── 1. Org tree from Logfood ──────────────────────────────────────────
    org = fetch_org_tree(args.manager_email)
    if not org:
        print(f"[error] no rows for {args.manager_email} in dim_workday_attributes_latest")
        return 1
    print(f"[logfood] {len(org)} people in scope (incl. manager)")
    for r in sorted(org, key=lambda x: (x["lvl"], x["email"])):
        print(f"  lvl={r['lvl']}  {r['email']:<40s}  {r['title']}")

    emails = [r["email"] for r in org if r["email"]]
    by_email = {r["email"]: r for r in org if r["email"]}

    if args.dry_run:
        print("\n[dry-run] stopping before any workspace writes.")
        return 0

    # ── 2. Workspace + account clients ────────────────────────────────────
    # The workspace profile carries an OAuth token that the SDK reuses for
    # both WorkspaceClient and (via the same host's account_id) AccountClient.
    # Requires account-admin on the parent account.
    print(f"\n[workspace] connecting to {args.workspace_host} (profile={WORKSPACE_PROFILE})…")
    ws = WorkspaceClient(profile=WORKSPACE_PROFILE)
    account_id = ws.config.account_id
    workspace_id = ws.get_workspace_id()
    if not account_id:
        print("[error] workspace profile has no account_id — re-auth with an "
              "account-admin OAuth flow, or set DATABRICKS_ACCOUNT_ID.")
        return 1
    print(f"[account] account_id={account_id}, workspace_id={workspace_id}")

    from databricks.sdk import AccountClient
    ac = AccountClient(
        host="https://accounts.cloud.databricks.com",
        account_id=account_id,
        # Reuse the workspace profile's credentials. The SDK respects the
        # profile's auth (PAT / OAuth U2M / OAuth M2M) for AccountClient too
        # when host/account_id are set explicitly.
        profile=WORKSPACE_PROFILE,
    )

    # ── 3. Resolve each user at the account level (no creates → no emails) ─
    # If a Databricks employee is missing from the account directory, that's
    # an HR/Workday sync issue, not something this script should fix. Report
    # and move on.
    resolved_user_ids: list[str] = []
    missing: list[str] = []
    found: list[str] = []
    for email in emails:
        user = find_account_user(ac, email)
        if user:
            resolved_user_ids.append(user.id)
            found.append(email)
        else:
            missing.append(email)
            print(f"[account]   ✗ {email} not found in account directory — skipping")

    print(f"\n[account] users summary:")
    print(f"  found in account : {len(found)}")
    print(f"  not in account   : {len(missing)}")
    if missing:
        for e in missing:
            print(f"    ✗ {e}")

    # ── 4. Account group + membership ─────────────────────────────────────
    group = find_or_create_account_group(ac, args.group_name)
    added, existing_count = add_group_members(ac, group, resolved_user_ids)
    print(f"\n[account] group '{args.group_name}': "
          f"+{added} added, {existing_count} already in group, "
          f"total now {existing_count + added}")

    # ── 5. Bind the group to the workspace ────────────────────────────────
    # Assigning the GROUP (not each user) means anyone added to the group
    # later automatically gets workspace access without re-running this
    # step. Idempotent — re-applying the same permission is a no-op and
    # sends no email.
    print(f"\n[account] assigning group '{args.group_name}' to workspace {workspace_id}…")
    ok = assign_to_workspace(ac, workspace_id, group.id, f"group:{args.group_name}")
    if ok:
        print(f"[account]   ✓ group assigned to workspace (USER permission)")

    return 0 if not missing else 2  # exit 2 when some users couldn't be added


if __name__ == "__main__":
    sys.exit(main())
