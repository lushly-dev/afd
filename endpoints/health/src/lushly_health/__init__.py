"""Reusable Health toolkit. Importing it never discovers targets or runs checks."""

from __future__ import annotations

import json
from importlib import resources

from .config import load_policy, load_targets, policy_from_mapping, targets_from_mapping
from .core import (
    CONFIG_SCHEMA_VERSION,
    REPORT_SCHEMA_VERSIONS,
    SCHEMA_VERSION,
    ArtifactScope,
    Policy,
    Target,
    aggregate_verdict,
    audit,
    capabilities,
    onboard,
    write_report,
)

__version__ = "0.1.0"

__all__ = [
    "CONFIG_SCHEMA_VERSION",
    "REPORT_SCHEMA_VERSIONS",
    "SCHEMA_VERSION",
    "ArtifactScope",
    "HealthPlugin",
    "Policy",
    "Target",
    "__version__",
    "aggregate_verdict",
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


def report_schema(version: str = SCHEMA_VERSION) -> dict:
    """The JSON Schema for a report version; by default the one this version emits."""
    if version not in REPORT_SCHEMA_VERSIONS:
        known = ", ".join(REPORT_SCHEMA_VERSIONS)
        raise ValueError(f"Unknown report schema version; known: {known}")
    text = resources.files(__name__).joinpath(f"schemas/report-{version}.json").read_text()
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
