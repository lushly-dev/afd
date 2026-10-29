"""Teams plugin configuration models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TeamsRolesConfig(BaseModel):
    """Role-to-group mapping for Teams authorization."""

    model_config = ConfigDict(extra="forbid")

    admin_groups: list[str] = []
    user_groups: list[str] = []


class TeamsConfig(BaseModel):
    """Configuration for the Teams bot plugin."""

    model_config = ConfigDict(extra="forbid")

    app_id: str = ""
    app_password: str = ""
    tenant_id: str = ""
    allowed_groups: list[str] = []
    roles: TeamsRolesConfig = TeamsRolesConfig()
    webhook_path: str = "/api/messages"
    host: str = "0.0.0.0"
    port: int = 3978
