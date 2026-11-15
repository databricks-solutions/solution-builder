"""
/api/me — unified identity endpoint.

Single source of truth for "who is the user" across both local and
deployed modes. See backend/AUTH.md for the full model.

UI components that need identity call this. Nothing else. The legacy
`current_user` field on /api/config/status is deprecated.
"""

from __future__ import annotations

from fastapi import HTTPException

from ..core import Dependencies, create_router
from ..core.auth import WhoAmI, whoami
# Cross-workspace ("scale") deploy lives in the OPTIONAL remote_deploy/ module.
# Import it tolerantly so a generic Tier-1 build (that excludes the module)
# still boots — the target endpoints then degrade to "no target configured".
try:
    from ..remote_deploy import probe as _target_probe, user_target as _user_target
except ImportError:  # remote_deploy/ excluded from this build
    _target_probe = None
    _user_target = None
from ..models import (
    TargetValidateRequest,
    TargetValidateResponse,
    UserSettingsOut,
    UserSettingsUpdateRequest,
)

router = create_router()


def _default_target_host(config) -> str | None:
    """The server's shared-default deploy-target host, normalized (or None).
    None when the remote_deploy module is absent (generic build)."""
    if _target_probe is None:
        return None
    raw = getattr(config, "default_target_workspace_host", "") or ""
    return _target_probe.normalize_host(raw) if raw else None


@router.get("/me", response_model=WhoAmI, operation_id="getMe")
def get_me(
    headers: Dependencies.Headers,
    session: Dependencies.Session,
) -> WhoAmI:
    """Return the current user's identity.

    - Deployed mode: email from `x-forwarded-email`, profile=null.
    - Local mode: single User row from the DB.
    - No user row in local mode: `is_configured=false` → UI routes to /setup.
    """
    return whoami(headers, session)


@router.get("/me/settings", response_model=UserSettingsOut, operation_id="getMySettings")
def get_my_settings(
    headers: Dependencies.Headers,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> UserSettingsOut:
    """Return the current user's account settings + the effective deploy target
    (user value, else the server default) so the UI can show the default."""
    who = whoami(headers, session)
    if _user_target is None:  # generic build — no remote-deploy targets exist
        return UserSettingsOut(
            cross_workspace_deploy_enabled=config.cross_workspace_deploy_enabled,
        )
    saved = _user_target.get_user_target(session, who.email)
    return UserSettingsOut(
        target_workspace_host=saved,
        effective_target_workspace_host=_user_target.resolve_user_target(
            user_target=saved, config=config
        ),
        cross_workspace_deploy_enabled=config.cross_workspace_deploy_enabled,
        default_target_workspace_host=_default_target_host(config),
    )


@router.put("/me/settings", response_model=UserSettingsOut, operation_id="updateMySettings")
def update_my_settings(
    body: UserSettingsUpdateRequest,
    headers: Dependencies.Headers,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> UserSettingsOut:
    """Set the current user's cross-workspace deploy target (applies to ALL of
    their projects). Empty clears it → fall back to the server default."""
    who = whoami(headers, session)
    if _user_target is None:  # generic build — targets aren't a concept here
        raise HTTPException(status_code=404, detail="Cross-workspace deploy is not available in this build.")
    if not who.email:
        # Local mode with no configured user — nothing to key settings on.
        raise HTTPException(status_code=400, detail="No current user to save settings for.")
    if body.target_workspace_host and body.target_workspace_host.strip():
        # Stored targets later receive the deployer SP secret, so only workspace URLs may be saved.
        try:
            _target_probe.validate_target_host(body.target_workspace_host)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    _user_target.set_user_target(session, who.email, body.target_workspace_host, config=config)
    saved = _user_target.get_user_target(session, who.email)
    return UserSettingsOut(
        target_workspace_host=saved,
        effective_target_workspace_host=_user_target.resolve_user_target(
            user_target=saved, config=config
        ),
        cross_workspace_deploy_enabled=config.cross_workspace_deploy_enabled,
        default_target_workspace_host=_default_target_host(config),
    )


@router.post(
    "/me/validate-target",
    response_model=TargetValidateResponse,
    operation_id="validateMyDeployTarget",
)
def validate_my_deploy_target(
    body: TargetValidateRequest,
    headers: Dependencies.Headers,
    session: Dependencies.Session,
    config: Dependencies.Config,
) -> TargetValidateResponse:
    """Validate a candidate deploy target as the deployer SP (project-independent
    — used by the home-page target control before any project exists). Three
    tiers: reachable (== in the SP's own account / CWNP-on) → SP is workspace admin →
    region has a provisioned catalog."""
    if _target_probe is None or not config.cross_workspace_deploy_enabled:
        raise HTTPException(
            status_code=400,
            detail="Cross-workspace deploy is not enabled (no deployer SP configured).",
        )
    verdict = _target_probe.probe_target(
        body.target_workspace_host,
        scim_me=_target_probe.make_sp_scim_me(
            config.deployer_sp_client_id, config.deployer_sp_client_secret
        ),
        region_of=_target_probe.make_sp_region_of(
            config.deployer_sp_client_id, config.deployer_sp_client_secret
        ),
        catalog_overrides=config.target_catalog_overrides,
    )
    if verdict.status == _target_probe.STATUS_INVALID_HOST:
        # Never contacted: the deployer secret is only ever sent to Databricks workspaces.
        raise HTTPException(status_code=400, detail=verdict.message)
    sp_name = "solution-builder-deployer"
    sp_app_id = config.deployer_sp_client_id
    admin_url = None
    instructions = None
    if verdict.status == _target_probe.STATUS_NEEDS_ADMIN and verdict.host:
        admin_url = _target_probe.admin_settings_url(verdict.host)
        instructions = _target_probe.admin_instructions(verdict.host, sp_name, sp_app_id)
    return TargetValidateResponse(
        host=verdict.host,
        reachable=verdict.reachable,
        is_admin=verdict.is_admin,
        region=verdict.region,
        catalog=verdict.catalog,
        status=verdict.status,
        can_deploy=verdict.can_deploy,
        message=verdict.message,
        deployer_sp_name=sp_name,
        deployer_sp_application_id=sp_app_id,
        admin_settings_url=admin_url,
        admin_instructions=instructions,
    )
