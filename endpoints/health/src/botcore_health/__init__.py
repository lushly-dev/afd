"""Reusable Health toolkit. Importing it never discovers targets or runs checks."""

from __future__ import annotations

import json
from importlib import resources

from .config import load_policy, load_targets, policy_from_mapping, targets_from_mapping
from .core import (
    SCHEMA_VERSION,
    ArtifactScope,
    Policy,
    Target,
    audit,
    capabilities,
    onboard,
    write_report,
)

__version__ = "0.1.0"

__all__ = [
    "SCHEMA_VERSION",
    "ArtifactScope",
    "HealthPlugin",
    "Policy",
    "Target",
    "__version__",
    "audit",
    "capabilities",
    "load_policy",
    "load_targets",
    "onboard",
    "policy_from_mapping",
    "report_schema",
    "targets_from_mapping",
    "write_report",
]


def report_schema() -> dict:
    """The JSON Schema for the report contract this version emits."""
    text = resources.files(__name__).joinpath(f"schemas/report-{SCHEMA_VERSION}.json").read_text()
    return json.loads(text)


class HealthPlugin:
    """Optional Botcore adapter; audited repositories need no toolkit dependency.

    Hosts must admit it explicitly (for example ``build_host(..., plugins=("health",),
    policies=host_policies())``). Commands read only the per-invocation context, so the
    plugin is safe to share across hosts.
    """

    host_context_safe = True

    def register(self, registry) -> None:
        from .commands import health_audit, health_capabilities

        registry.add_commands([health_audit, health_capabilities])

    def config_schema(self):
        return None
