"""Configuration and user management endpoints."""

from __future__ import annotations

import os
import subprocess
from configparser import ConfigParser
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import select, text

from ..core import Dependencies, create_router
from ..core._config import logger
from ..models import (
    ConfigStatus,
    DatabaseStatus,
    DatabricksConnectionStatus,
    DatabricksProfile,
    User,
    UserOut,
    UserUpdateRequest,
)

router = create_router()


def _is_pglite_mode() -> bool:
    """Mirror of core.lakebase._is_pglite_mode (kept inline to avoid a route→core import)."""
    if os.environ.get("USE_PGLITE") == "1":
        return True
    return not os.environ.get("LAKEBASE_DATABASE_PATH")


def _get_databricks_profiles() -> list[DatabricksProfile]:
    """Read available Databricks profiles from ~/.databrickscfg."""
    profiles = []
    config_path = Path.home() / ".databrickscfg"

    if not config_path.exists():
        logger.warning(f"Databricks config not found: {config_path}")
        return profiles

    try:
        # Parse the file manually to properly handle [DEFAULT] section
        # (Python's ConfigParser treats DEFAULT specially and doesn't list it in sections())
        current_section = None
        sections_data: dict[str, dict[str, str]] = {}

        with open(config_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith(";"):
                    continue
                if line.startswith("[") and line.endswith("]"):
                    current_section = line[1:-1]
                    sections_data[current_section] = {}
                elif current_section and "=" in line:
                    key, value = line.split("=", 1)
                    sections_data[current_section][key.strip()] = value.strip()

        # Check for default profile in environment
        default_profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")

        for section, data in sections_data.items():
            host = data.get("host")
            profiles.append(
                DatabricksProfile(
                    name=section,
                    host=host,
                    is_default=(section == default_profile),
                )
            )

        logger.info(f"Found {len(profiles)} Databricks profiles: {[p.name for p in profiles]}")
    except Exception as e:
        logger.error(f"Failed to read Databricks config: {e}")

    return profiles


def _test_databricks_connection(profile: str) -> DatabricksConnectionStatus:
    """Test Databricks connection and get user info using CLI."""
    try:
        # Run databricks auth describe to test connection and get user
        result = subprocess.run(
            ["databricks", "auth", "describe", "--profile", profile],
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = result.stdout + result.stderr

        # Check for authentication failure in output (CLI may return 0 even on auth failure)
        if result.returncode != 0 or "Unable to authenticate" in output:
            # Extract error message from output
            error_msg = ""
            for line in output.split("\n"):
                line = line.strip()
                if line.startswith("Unable to authenticate"):
                    error_msg = line
                    break
            if not error_msg:
                error_msg = result.stderr.strip() or "Authentication failed"

            logger.error(f"Databricks auth failed for profile {profile}: {error_msg}")
            return DatabricksConnectionStatus(
                connected=False,
                profile=profile,
                error=error_msg,
            )

        # Parse the output to get user email and host
        user_email = None
        host = None

        for line in output.split("\n"):
            line = line.strip()
            # Parse "User: email@example.com" format
            if line.startswith("User:"):
                user_email = line.split(":", 1)[1].strip()
            # Parse "✓ host: https://..." format from current configuration
            elif "host:" in line.lower():
                # Extract host from lines like "✓ host: https://example.com (from ...)"
                parts = line.split("host:", 1)
                if len(parts) > 1:
                    host_part = parts[1].strip()
                    # Remove trailing "(from ...)" if present
                    if "(" in host_part:
                        host_part = host_part.split("(")[0].strip()
                    host = host_part

        if not user_email:
            # Try alternative parsing (JSON format)
            import json
            try:
                data = json.loads(output)
                user_email = data.get("user") or data.get("username")
                host = data.get("host") or host
            except json.JSONDecodeError:
                pass

        if not user_email:
            logger.warning(f"Could not parse user email from: {output[:500]}")
            return DatabricksConnectionStatus(
                connected=True,
                profile=profile,
                host=host,
                error="Connected but could not determine user email",
            )

        logger.info(f"Databricks connection successful: {user_email} @ {host}")
        return DatabricksConnectionStatus(
            connected=True,
            profile=profile,
            host=host,
            user_email=user_email,
        )

    except subprocess.TimeoutExpired:
        logger.error(f"Databricks auth timed out for profile {profile}")
        return DatabricksConnectionStatus(
            connected=False,
            profile=profile,
            error="Connection timeout",
        )
    except FileNotFoundError:
        logger.error("Databricks CLI not found")
        return DatabricksConnectionStatus(
            connected=False,
            profile=profile,
            error="Databricks CLI not installed. Install it with: brew install databricks (macOS) or curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh",
        )
    except Exception as e:
        logger.error(f"Databricks connection error: {e}")
        return DatabricksConnectionStatus(
            connected=False,
            profile=profile,
            error=str(e),
        )


@router.get("/config/status", response_model=ConfigStatus, operation_id="getConfigStatus")
def get_config_status(session: Dependencies.Session, config: Dependencies.Config):
    """Get overall configuration status including database and Databricks profiles."""
    # Check database connection
    try:
        session.execute(text("SELECT 1"))
        db_status = DatabaseStatus(
            connected=True,
            type="local" if _is_pglite_mode() else "remote",
        )
    except Exception as e:
        db_status = DatabaseStatus(
            connected=False,
            type="local" if _is_pglite_mode() else "remote",
            error=str(e),
        )

    # Get Databricks profiles
    profiles = _get_databricks_profiles()

    # Get current user if exists
    current_user = None
    is_configured = False
    try:
        # Get the first (and only) user - single user app
        stmt = select(User).limit(1)
        user = session.exec(stmt).first()
        if user:
            current_user = UserOut(
                id=user.id,
                email=user.email,
                databricks_profile=user.databricks_profile,
                created_at=user.created_at,
                updated_at=user.updated_at,
            )
            is_configured = True
    except Exception as e:
        logger.warning(f"Failed to get current user: {e}")

    return ConfigStatus(
        database=db_status,
        databricks_profiles=profiles,
        current_user=current_user,
        is_configured=is_configured,
        default_catalog=config.default_catalog,
    )


@router.get(
    "/config/databricks/profiles",
    response_model=list[DatabricksProfile],
    operation_id="getDatabricksProfiles",
)
def get_databricks_profiles():
    """List available Databricks CLI profiles."""
    return _get_databricks_profiles()


@router.post(
    "/config/databricks/test",
    response_model=DatabricksConnectionStatus,
    operation_id="testDatabricksConnection",
)
def test_databricks_connection(profile: str = "DEFAULT"):
    """Test Databricks connection with a specific profile."""
    return _test_databricks_connection(profile)


@router.get("/config/user", response_model=UserOut, operation_id="getCurrentConfigUser")
def get_current_user(session: Dependencies.Session):
    """Get the current user configuration."""
    stmt = select(User).limit(1)
    user = session.exec(stmt).first()

    if not user:
        raise HTTPException(status_code=404, detail="No user configured")

    return UserOut(
        id=user.id,
        email=user.email,
        databricks_profile=user.databricks_profile,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.post("/config/user", response_model=UserOut, operation_id="saveUserConfig")
def save_user_config(
    request: UserUpdateRequest,
    session: Dependencies.Session,
):
    """Save user configuration. Tests the connection first to get the email."""
    # Test the connection to get user email
    connection = _test_databricks_connection(request.databricks_profile)

    if not connection.connected:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect with profile '{request.databricks_profile}': {connection.error}",
        )

    if not connection.user_email:
        raise HTTPException(
            status_code=400,
            detail="Could not determine user email from Databricks connection",
        )

    # Check if user already exists
    stmt = select(User).where(User.email == connection.user_email)
    existing_user = session.exec(stmt).first()

    if existing_user:
        # Update existing user
        existing_user.databricks_profile = request.databricks_profile
        existing_user.updated_at = datetime.now(timezone.utc)
        session.add(existing_user)
        session.commit()
        session.refresh(existing_user)
        user = existing_user
        logger.info(f"Updated user: {user.email} with profile: {user.databricks_profile}")
    else:
        # Create new user
        user = User(
            email=connection.user_email,
            databricks_profile=request.databricks_profile,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        logger.info(f"Created user: {user.email} with profile: {user.databricks_profile}")

    return UserOut(
        id=user.id,
        email=user.email,
        databricks_profile=user.databricks_profile,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
