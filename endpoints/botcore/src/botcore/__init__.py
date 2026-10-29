"""Botcore — shared bot infrastructure for config, plugins, and commands."""

from botcore.config import (
    BotCoreConfig,
    EnvConfig,
    PackageOverrideConfig,
    SkillsConfig,
    get_config_for_path,
    load_config,
)
from botcore.context import ExecutionContext
from botcore.host import CommandHost, CommandPolicy, QualityVerdict, aggregate_quality, build_host
from botcore.host_surfaces import create_host_cli, create_host_mcp_server
from botcore.plugin import (
    BotCorePlugin,
    PluginRegistry,
    discover_plugins,
)
from botcore.registry import (
    get_client,
    registry,
    reset_client,
)
from botcore.server import build_docs, build_namespace, create_mcp_server

__version__ = "0.6.0"

__all__ = [
    "__version__",
    "ExecutionContext",
    "CommandHost",
    "CommandPolicy",
    "QualityVerdict",
    "aggregate_quality",
    "build_host",
    "create_host_cli",
    "create_host_mcp_server",
    # Config
    "BotCoreConfig",
    "SkillsConfig",
    "PackageOverrideConfig",
    "EnvConfig",
    "load_config",
    "get_config_for_path",
    # Plugin
    "PluginRegistry",
    "BotCorePlugin",
    "discover_plugins",
    # Registry
    "registry",
    "get_client",
    "reset_client",
    # Server
    "build_namespace",
    "build_docs",
    "create_mcp_server",
]
