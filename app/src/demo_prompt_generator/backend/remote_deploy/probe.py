"""Cross-workspace target validation (v1).

Before a project deploys to a user-pasted workspace URL, validate it AS THE
DEPLOYER SP in three tiers — all detectable with the SP's own OAuth-M2M creds,
no account-admin required:

  1. REACHABLE — can the SP authenticate to the workspace at all? An account
     SP's token is only accepted by workspaces in its OWN account. Cross-account
     → token/OIDC failure. This is also exactly the account where Cross-Workspace
     Network Policy (CWNP) is enabled, so "reachable" ⟺ "in the SP's own account"
     ⟺ "cross-workspace deploy can work".
  2. ADMIN — is the SP in the workspace's `admins` group? A full `bundle
     deploy` sets run_as/ownership to the user, which a non-admin SP cannot do
     (verified: 403 "Non-admins can set run_as to themselves only"). If not
     admin, the user (who owns the workspace) can add the SP as a workspace
     admin via the workspace UI.
  3. CATALOG — does the target's region map to a provisioned catalog?

The probe is dependency-injected (`scim_me`, `region_of`) so it's unit-testable
without a network. The route layer supplies real implementations built on the
deployer SP's WorkspaceClient.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Callable, Optional

from . import region as _target_region

logger = logging.getLogger(__name__)


class TargetUnreachable(Exception):
    """Raised by a `scim_me` implementation when the SP cannot authenticate to
    the target (cross-account / 401 / token-exchange failure)."""


# Status codes the UI branches on.
STATUS_READY = "ready"                       # can_deploy
STATUS_OUT_OF_ACCOUNT = "out_of_account"     # outside the SP's account / CWNP-off
STATUS_NEEDS_ADMIN = "needs_admin"           # reachable but SP not admin → prompt to bless
STATUS_REGION_UNSUPPORTED = "region_unsupported"  # region has no catalog yet
STATUS_REGION_UNKNOWN = "region_unknown"     # couldn't determine the region
STATUS_INVALID_HOST = "invalid_host"         # not a Databricks workspace URL (never contacted)


@dataclass
class TargetVerdict:
    host: str
    reachable: bool
    is_admin: bool
    region: Optional[str]
    catalog: Optional[str]
    status: str
    message: str

    @property
    def can_deploy(self) -> bool:
        return self.status == STATUS_READY


def admin_settings_url(host: str) -> str:
    """Deep link to a workspace's service-principal Identity settings, where a
    workspace admin adds the deployer SP."""
    return f"{host.rstrip('/')}/settings/workspace/identity-and-access/service-principals"


def admin_instructions(host: str, sp_name: str, sp_application_id: str) -> str:
    """Ready-to-show steps for the user to add the deployer SP as a workspace
    admin on `host`. Includes the prerequisite that the USER themselves must
    already be a workspace admin on the workspace they pasted."""
    return (
        f"To deploy here, add the deployer service principal as an admin on this "
        f"workspace:\n"
        f"1. Open {admin_settings_url(host)}\n"
        f"2. Add service principal → Application ID: {sp_application_id} "
        f"(name: {sp_name})\n"
        f"3. Grant it the workspace Admin role, then click Check again.\n"
        f"Note: you must already be a workspace admin on this workspace to add it."
    )


def normalize_host(raw: str) -> str:
    """Normalize a pasted workspace URL to `https://<host>` (no trailing slash).
    Bundle/CLI host comparisons are literal, so this must match how the target
    is stored on the project."""
    h = (raw or "").strip().rstrip("/")
    if h and not h.startswith(("http://", "https://")):
        h = f"https://{h}"
    return h


# Databricks-owned workspace domains (AWS, Azure, GCP). The deployer SP's client
# secret is POSTed to whatever host the SDK is given, so a target must be a real
# workspace URL, never a host the user typed. The fullmatch excludes userinfo
# (`@`), ports, paths, queries and IP literals by construction.
_WORKSPACE_HOST_RE = re.compile(
    r"https://(?:[a-z0-9-]+\.)+(?:cloud\.databricks\.com|azuredatabricks\.net|gcp\.databricks\.com)",
    re.IGNORECASE,
)


def validate_target_host(raw: str) -> str:
    """Return the normalized `https://<workspace>` URL iff `raw` is a Databricks
    workspace URL; raise ValueError otherwise. Every deployer-SP client and every
    deployer-SP credential file is built only from a host that passed this."""
    host = normalize_host(raw)
    if not _WORKSPACE_HOST_RE.fullmatch(host):
        raise ValueError(
            "Not a Databricks workspace URL. Use the workspace address, e.g. "
            "https://<workspace>.cloud.databricks.com."
        )
    return host


def _has_admin(scim_result: dict) -> bool:
    groups = scim_result.get("groups") or []
    names = {(g.get("display") or "").lower() for g in groups}
    return "admins" in names


def probe_target(
    raw_host: str,
    *,
    scim_me: Callable[[str], dict],
    region_of: Callable[[str], Optional[str]],
    catalog_overrides: Optional[dict] = None,
) -> TargetVerdict:
    """Validate a target workspace as the deployer SP. Never raises for the
    expected failure modes — returns a structured verdict the UI renders.

    scim_me(host)   -> the SP's SCIM `Me` dict for that host; raises
                       TargetUnreachable if the SP can't authenticate.
    region_of(host) -> the workspace's cloud region, or None if undeterminable.
    catalog_overrides -> optional {region: catalog} map (from config) applied
                       when resolving the region's catalog.
    """
    try:
        host = validate_target_host(raw_host)
    except ValueError as e:
        # Rejected before ANY client is built: the deployer secret never reaches this host.
        return TargetVerdict(
            host=normalize_host(raw_host),
            reachable=False,
            is_admin=False,
            region=None,
            catalog=None,
            status=STATUS_INVALID_HOST,
            message=str(e),
        )

    # --- tier 1: reachability ---
    # An account-level SP gets an OIDC `invalid_client` for BOTH "workspace is
    # in another account" AND "workspace is in this account but the SP hasn't
    # been added to it yet" — the SP can't tell them apart. The common, fixable
    # cause is the latter, so treat unreachable as needs-blessing: tell the user
    # to add the SP as a workspace admin (with the caveat that if it's not in
    # the SP's own account, that's the other possible reason).
    try:
        me = scim_me(host)
    except TargetUnreachable:
        return TargetVerdict(
            host=host,
            reachable=False,
            is_admin=False,
            region=None,
            catalog=None,
            status=STATUS_NEEDS_ADMIN,
            message=(
                "The deployer service principal can't authenticate to this "
                "workspace yet — add it as a workspace admin (see below), then "
                "re-check. If this workspace isn't in the deployer SP's own "
                "account, that's the other possible reason; cross-workspace "
                "deploy only supports workspaces in the SP's account."
            ),
        )

    is_admin = _has_admin(me)

    # --- tier 3 (compute region/catalog regardless, so the UI shows context) ---
    region = region_of(host)
    catalog = _target_region.resolve_catalog_for_region(region, overrides=catalog_overrides)

    # --- tier 2: admin ---
    if not is_admin:
        return TargetVerdict(
            host=host,
            reachable=True,
            is_admin=False,
            region=region,
            catalog=catalog,
            status=STATUS_NEEDS_ADMIN,
            message=(
                "The deployer service principal (solution-builder-deployer) is "
                "not an admin on this workspace. As the workspace owner, add it "
                "as a workspace admin (Settings → Identity and access → Service "
                "principals), then re-check."
            ),
        )

    # reachable + admin: now the region/catalog decide deployability
    if region is None:
        return TargetVerdict(
            host=host,
            reachable=True,
            is_admin=True,
            region=None,
            catalog=None,
            status=STATUS_REGION_UNKNOWN,
            message="Couldn't determine this workspace's region.",
        )

    if catalog is None:
        return TargetVerdict(
            host=host,
            reachable=True,
            is_admin=True,
            region=region,
            catalog=None,
            status=STATUS_REGION_UNSUPPORTED,
            message=(
                f"Region {region} isn't onboarded for cross-workspace deploy yet "
                "(no solution_builder catalog provisioned). Supported regions: "
                + ", ".join(_target_region.supported_regions())
                + "."
            ),
        )

    return TargetVerdict(
        host=host,
        reachable=True,
        is_admin=True,
        region=region,
        catalog=catalog,
        status=STATUS_READY,
        message=f"Ready: deploys into `{catalog}` in {region}.",
    )


# --- real SP-backed implementations of the injected callables --------------
#
# These build a WorkspaceClient as the DEPLOYER SP (OAuth-M2M) against the
# target host and read SCIM Me + the workspace region. Kept out of the pure
# core above so `probe_target` stays unit-testable without a network.

def make_sp_scim_me(client_id: str, client_secret: str) -> Callable[[str], dict]:
    """Return a `scim_me(host)` that authenticates as the deployer SP against
    `host` and returns the SCIM Me dict. Raises TargetUnreachable if the SP
    can't authenticate (cross-account / 401 / token-exchange failure) — the
    signal that the workspace is outside the SP's own account (CWNP off)."""
    def _scim_me(host: str) -> dict:
        try:
            ws = make_sp_target_client(host, client_id, client_secret)
            me = ws.current_user.me()
            return {
                "id": me.id,
                "groups": [{"display": g.display} for g in (me.groups or [])],
            }
        except Exception as e:  # noqa: BLE001 — any auth/network failure ⇒ unreachable
            logger.info("[target-probe] SP unreachable at %s: %s", host, str(e)[:200])
            raise TargetUnreachable(str(e)) from e

    return _scim_me


def make_sp_region_of(client_id: str, client_secret: str) -> Callable[[str], Optional[str]]:
    """Return a `region_of(host)` that reads the workspace's cloud region as
    the deployer SP. Best-effort: returns None if it can't be determined."""
    from databricks.sdk import WorkspaceClient

    def _region_of(host: str) -> Optional[str]:
        try:
            ws = make_sp_target_client(host, client_id, client_secret)
            # The metastore assigned to the workspace carries the region and is
            # exactly what determines the catalog's location.
            summary = ws.metastores.summary()
            return getattr(summary, "region", None)
        except Exception as e:  # noqa: BLE001
            logger.info("[target-probe] region lookup failed at %s: %s", host, str(e)[:200])
            return None

    return _region_of


def make_sp_target_client(host: str, client_id: str, client_secret: str):
    """Build a WorkspaceClient authed as the DEPLOYER SP (OAuth-M2M) against a
    target workspace `host`. The single canonical construction — used by the
    probe callables above, the resource-link builder, AND the ownership
    reconcile, so the "act as the deployer SP against the target" idiom lives
    in exactly one place.

    The client is lazy: auth only fires on the first API call, and an
    out-of-account / not-yet-blessed target throws OIDC `invalid_client` there
    (the same signal `make_sp_scim_me` wraps as TargetUnreachable). `host` is
    normalized to https://<host> so SDK/CLI host comparisons stay literal.
    The host is validated FIRST (validate_target_host): a non-Databricks host
    raises ValueError and no client is constructed, so the secret never leaves."""
    from databricks.sdk import WorkspaceClient  # local import: keep module import-light

    return WorkspaceClient(
        host=validate_target_host(host),
        client_id=client_id,
        client_secret=client_secret,
        auth_type="oauth-m2m",
    )
