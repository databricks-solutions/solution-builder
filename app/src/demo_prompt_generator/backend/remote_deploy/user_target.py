"""Cross-workspace deploy target resolution (v2 — per-project pinning).

TWO levels:
  • USER-level "current target" — an account setting (set on the home page,
    `UserSettings.target_workspace_host`). This is only the DEFAULT for NEW
    projects.
  • PROJECT-level "pinned target" — `Project.target_workspace_host`, FROZEN the
    first time a project deploys cross-workspace. Once pinned it is immutable:
    the project deploys to that same target forever, even if the user later
    switches their account setting. INVARIANT: no mixed targets within a project.

Use `resolve_project_target(...)` on every build/deploy/link path — it returns
the project's pinned host when set, and only falls back to the live per-user
value for a project's very first deploy (or a legacy project created before
pinning existed). `resolve_user_target(...)` (per-user, DB-free) remains for the
new-project default + the freeze source.

USER resolution order (the freeze source / new-project default):
  1. the user's saved `UserSettings.target_workspace_host`
  2. the server default `config.default_target_workspace_host`
  3. None → classic same-workspace OBO (nothing changes)

The pure `resolve_user_target` is DB-free (unit-tested); the DB helpers upsert
by email, since deployed mode never persists a `users` row.
"""
from __future__ import annotations

import logging
from typing import Optional

from .probe import normalize_host

logger = logging.getLogger(__name__)


def resolve_user_target(*, user_target: Optional[str], config) -> Optional[str]:
    """Return the effective deploy target host for a user, normalized to
    https://<host>, or None if neither the user nor the server sets one.

    HARD GATE: returns None whenever the cross-workspace deploy feature is off
    (`config.cross_workspace_deploy_enabled` is falsy or absent). This is the
    single source of truth for "this install has cross-workspace deploy
    disabled" — an OSS install with no deployer SP configured resolves NO
    target, so every downstream path falls back to classic same-workspace OBO.
    Gating here (not only at the call sites) means a future consumer can't
    accidentally act on a stranded/pinned host by forgetting to re-check."""
    if not getattr(config, "cross_workspace_deploy_enabled", False):
        return None
    candidate = (user_target or "").strip()
    if not candidate:
        candidate = (getattr(config, "default_target_workspace_host", "") or "").strip()
    if not candidate:
        return None
    return normalize_host(candidate)


def resolve_project_target(
    *, project, user_email: Optional[str], session, config,
    has_built_resources: bool = False,
) -> Optional[str]:
    """Return the effective deploy target host for a PROJECT, honoring the
    per-project PIN.

    A project's target is FROZEN the first time it deploys cross-workspace (see
    `pin_project_target`). Once pinned, that value is authoritative forever — even
    if the user later changes their account-level target. This is the invariant:
    a project sticks to the target it first built against; no mixed targets per
    project.

    Falls back to the live per-user setting ONLY when the project has never been
    pinned (its first deploy, or a legacy project created before pinning existed).
    Normalized to https://<host>, or None for classic same-workspace OBO.

    LEGACY GUARD (`has_built_resources`): a project that ALREADY has built
    resources but no pinned target is a LEGACY (pre-Model-3) project — its
    resources were provisioned via OBO on the app's OWN workspace. Falling back
    to the user's live remote-target setting here would pin the WRONG workspace
    (the resource tiles + iterate would then query a workspace that doesn't hold
    the resources → access failures). So when `has_built_resources` is True and
    the project is unpinned, resolve to the app's OWN host (`config.databricks_host`,
    where the resources actually live) instead of the live user setting. A pinned
    project is unaffected (its pin already wins); a brand-new empty project is
    unaffected (the user's picker still drives its first target).

    HARD GATE: like `resolve_user_target`, returns None whenever the feature is
    off — even for an already-pinned project. So a project pinned while the
    feature was enabled stops resolving its target the moment the feature is
    disabled, and no downstream path can act on the stranded host."""
    if not getattr(config, "cross_workspace_deploy_enabled", False):
        return None
    pinned = getattr(project, "target_workspace_host", None) if project is not None else None
    if pinned:
        return normalize_host(pinned)
    # Legacy project with existing resources → pin to the app's own workspace
    # (where those OBO-built resources live), never the user's remote picker.
    if has_built_resources:
        own = (getattr(config, "databricks_host", "") or "").strip()
        return normalize_host(own) if own else None
    return resolve_user_target(
        user_target=get_user_target(session, user_email),
        config=config,
    )


def resolve_and_pin_project_target(
    *, project, user_email: Optional[str], session, config,
    has_built_resources: bool = False, can_pin: bool = False,
) -> Optional[str]:
    """Resolve a project's effective deploy target AND freeze it onto the project.

    The single source of truth for "which workspace does THIS project use" —
    call it from EVERY path that acts on the target (the .databrickscfg writer,
    the resource-tile/link resolver, and the deploy path) so they can never
    disagree. It:

      1. resolves via `resolve_project_target` (honors an existing pin; else the
         legacy guard / live user setting), then
      2. pins the result via `pin_project_target` when `can_pin` is True (the
         caller is the driver/owner, i.e. allowed to freeze it) — a no-op once
         the project is already pinned (the pin is immutable).

    So the FIRST driver interaction (open or build) freezes the target, and every
    later call — tiles, .databrickscfg, redeploy — returns that same pinned host
    even if the user later changes their account-level target. Returns the
    normalized host, or None for classic same-workspace OBO / feature-off.

    `can_pin` MUST be False for viewers / non-drivers (they may resolve to render
    links, but must never write a pin into someone else's project)."""
    target = resolve_project_target(
        project=project, user_email=user_email, session=session, config=config,
        has_built_resources=has_built_resources,
    )
    if can_pin and target:
        pin_project_target(session, project, target)
    return target


_RESOURCES_JSON_PATHS = (
    "resources.json",
    "specifications/resources.json",
    "instructions/resources.json",
)


def project_has_built_resources(file_sync, project_id: str, *, session) -> bool:
    """True iff the project's resources.json carries at least one REAL OWNED
    resource — i.e. something the ownership reconcile would actually re-home.
    DB-only + JSON-only — no LLM extraction, no network — so it's cheap enough
    to call on the deploy path.

    Reuses the reconciler's own `classify()` + the SKIP/NOTE filter (the same
    "material" set that drives `reconcile_hash`), so this detector can NEVER
    disagree with the reconciler on what counts as a built resource. In
    particular a manifest with only a catalog / warehouse (both MECH_SKIP) or a
    workspace folder (MECH_NOTE) is NOT "built" — those aren't owned resources.

    Feeds the legacy-project guard in `resolve_project_target`: a project that
    already has built resources but no pinned target is a pre-Model-3 (legacy)
    project whose resources live on the app's own workspace, so it must NOT
    inherit the user's live remote-target pick."""
    import json

    # Local imports avoid a module-level import cycle (ownership_reconcile pulls
    # in the SDK/models lazily; user_target is imported very early).
    from .ownership_reconcile import (
        MECH_NOTE,
        MECH_SKIP,
        _created_resources,
        _is_placeholder,
        classify,
    )

    content = None
    for path in _RESOURCES_JSON_PATHS:
        content = file_sync.get_file_content(project_id, path, session=session)
        if content is not None:
            break
    if content is None:
        return False
    try:
        text = content.decode("utf-8") if isinstance(content, (bytes, bytearray)) else content
        obj = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
        return False
    if not isinstance(obj, dict):
        return False
    # A "material" action (not SKIP/NOTE) == a real owned resource. Also require
    # a non-placeholder value: classify() keeps a placeholder `schema` token as
    # a material action, but a `<schema>` placeholder isn't a built resource.
    return any(
        a.mechanism not in (MECH_SKIP, MECH_NOTE) and not _is_placeholder(a.value)
        for a in classify(_created_resources(obj))
    )


def pin_project_target(session, project, target_host: Optional[str]) -> None:
    """Freeze `target_host` onto the project the FIRST time it deploys
    cross-workspace. No-op if the project already has a pinned target (the pin is
    immutable) or if there's no target to pin (same-workspace / unset). Commits
    in the caller's session."""
    if project is None or not target_host:
        return
    if getattr(project, "target_workspace_host", None):
        return  # already pinned — immutable
    project.target_workspace_host = normalize_host(target_host)
    session.add(project)
    session.commit()
    # The preview proxy caches "is this project remote?" for 30 s and that answer decides
    # which token it forwards (AUTH.md: one identity per preview). Drop it at the pin.
    try:
        from ..preview.routes import forget_remote_target  # local import: avoid a cycle

        forget_remote_target(project.id)
    except Exception:  # noqa: BLE001 — never fail a pin over a cache
        logger.warning("[target] could not clear the preview remote-target cache", exc_info=True)


# --- DB helpers (upsert-by-email; deployed mode has no persisted users row) --

def get_user_target(session, email: Optional[str]) -> Optional[str]:
    """Return the user's saved target_workspace_host, or None. Never raises for
    a missing row / missing email."""
    if not email:
        return None
    from ..models import UserSettings  # local import: avoid import cycle

    row = session.get(UserSettings, email)
    return row.target_workspace_host if row else None


def get_user_catalog(session, email: Optional[str]) -> Optional[str]:
    """Return the catalog resolved from the user's target region, or None."""
    if not email:
        return None
    from ..models import UserSettings

    row = session.get(UserSettings, email)
    return row.target_catalog if row else None


def set_user_target(session, email: str, target_workspace_host: Optional[str], *, config=None):
    """Upsert the user's target. Empty/blank clears it (→ default fallback).
    When `config` is provided and the deployer SP is configured, also resolve +
    cache the target's catalog (resolved per region) so project
    creation doesn't re-probe. Returns the persisted UserSettings row."""
    from datetime import datetime, timezone

    from ..models import UserSettings
    from . import probe as _target_probe, region as _target_region

    normalized = None
    raw = (target_workspace_host or "").strip()
    if raw:
        normalized = normalize_host(raw)

    catalog = None
    if normalized and config is not None and getattr(config, "cross_workspace_deploy_enabled", False):
        try:
            region = _target_probe.make_sp_region_of(
                config.deployer_sp_client_id, config.deployer_sp_client_secret
            )(normalized)
            catalog = _target_region.resolve_catalog_for_region(
                region, overrides=getattr(config, "target_catalog_overrides", None)
            )
        except Exception:  # noqa: BLE001 — never block the save on the probe
            catalog = None

    row = session.get(UserSettings, email)
    if row is None:
        row = UserSettings(email=email, target_workspace_host=normalized, target_catalog=catalog)
    else:
        row.target_workspace_host = normalized
        row.target_catalog = catalog
        row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
