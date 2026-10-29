"""Small, explicit host composition and policy shared by CLI, MCP and DirectClient.

Plugins and subprocesses are trusted installed code. This is cooperative policy,
not adversarial confinement. Undeclared commands fail closed in every profile.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any

from afd import CommandResult, DirectClient, error
from afd.core.result import ResultMetadata
from afd.direct import CommandInfo
from afd.server.middleware import compose_middleware

from botcore.context import ExecutionContext, use_context

VERDICTS = {"passed", "failed", "skipped", "unavailable", "error"}
EFFECTS = {
    "inspect",
    "source-write",
    "config-write",
    "baseline-write",
    "artifact-write",
    "release-write",
    "history-write",
    "subprocess",
    "browser",
    "service",
}


@dataclass(frozen=True)
class CommandPolicy:
    """Declared effects plus optional interpretation of an existing quality result.

    effects may depend on validated arguments (e.g. lint fix versus inspect).
    inspection permits only inspect, so subprocesses and their caches are denied.
    quality is an explicit bool/count/verdict field or the native execution adapter.
    """

    effects: tuple[str, ...] | Callable[[dict], tuple[str, ...]] = ("inspect",)
    capabilities: tuple[str, ...] = ()
    paths: tuple[str, ...] = ()
    quality: str | None = None
    output_scope: str | None = None
    possible_effects: tuple[str, ...] = ()

    def describe(self) -> dict:
        return {
            "effects": list(self.possible_effects if callable(self.effects) else self.effects),
            "effects_depend_on_arguments": callable(self.effects),
            "capabilities": list(self.capabilities),
            "paths": list(self.paths),
            "quality": self.quality,
            "output_scope": self.output_scope,
        }


@dataclass(frozen=True)
class QualityVerdict:
    status: str
    target: str
    evidence: dict

    def __post_init__(self):
        if self.status not in VERDICTS:
            raise ValueError(f"Unknown quality verdict: {self.status}")


def interpret_quality(result: CommandResult, field: str, target: str) -> QualityVerdict:
    """Interpret an explicitly registered legacy result without changing success."""
    data = result.data if isinstance(result.data, dict) else {}
    if not result.success:
        code = result.error.code if result.error else "INVALID_RESULT"
        status = (
            "failed"
            if code in {"LINT_FAILED", "TEST_FAILED", "BUILD_FAILED", "BROKEN_LINKS"}
            else "error"
        )
        if code in {
            "NO_LINTER",
            "NO_TEST_RUNNER",
            "TOOL_NOT_FOUND",
            "TOOL_UNAVAILABLE",
            "UNAVAILABLE",
        }:
            status = "unavailable"
        return QualityVerdict(status, target, {"error": code})
    value = data.get(field)
    if field == "execution":
        status = "passed"  # Explicit adapter for native tools that encode failure in success.
    elif field == "verdict" and isinstance(value, str) and value in VERDICTS:
        status = value
    elif field in {"passed", "valid"} and isinstance(value, bool):
        status = "passed" if value else "failed"
    elif field not in {"passed", "valid"} and type(value) is int and value >= 0:
        status = "passed" if value == 0 else "failed"
    else:
        status = "error"  # Missing, malformed or unspecified evidence never passes.
    return QualityVerdict(status, target, {"field": field, "value": value})


def aggregate_quality(verdicts: list[QualityVerdict]) -> str:
    """All required checks must pass. Empty/skipped/unavailable plans never pass."""
    if not verdicts:
        return "error"
    for status in ("error", "failed", "unavailable", "skipped"):
        if any(verdict.status == status for verdict in verdicts):
            return status
    return "passed"


class CommandHost:
    """An isolated catalog/context implementing AFD's DirectRegistry protocol."""

    def __init__(self, name: str, context: ExecutionContext):
        self.name = name
        self.context = context
        self._commands: dict[str, Callable] = {}
        self._policies: dict[str, CommandPolicy] = {}
        self.middleware: list[Callable] = []
        self.docs: dict[str, str] = {}

    def register(self, name: str, handler: Callable, policy: CommandPolicy) -> None:
        if name in self._commands:
            raise ValueError(f"Duplicate command: {name}")
        declared = policy.possible_effects if callable(policy.effects) else policy.effects
        if (callable(policy.effects) and not declared) or set(declared) - EFFECTS:
            raise ValueError(f"Declare known effects for {name}")
        self._commands[name] = handler
        self._policies[name] = policy

    def has_command(self, name: str) -> bool:
        return name in self._commands

    def list_command_names(self) -> list[str]:
        return sorted(self._commands)

    def list_commands(self) -> list[CommandInfo]:
        return [
            CommandInfo(name, self._commands[name].__doc__ or "")
            for name in self.list_command_names()
        ]

    def get_command(self, name: str):
        return None  # The shared dispatcher binds the actual Python signature.

    def catalog(self) -> list[dict]:
        return [
            {"name": name, **self._policies[name].describe()} for name in self.list_command_names()
        ]

    def direct_client(self) -> DirectClient:
        return DirectClient(self)

    async def execute(self, name: str, args: Any = None, context: Any = None) -> CommandResult:
        if name not in self._commands:
            return error("COMMAND_NOT_FOUND", name, suggestion="Inspect the host catalog")
        if args is not None and not isinstance(args, dict):
            return error(
                "VALIDATION_ERROR",
                "Arguments must be an object",
                suggestion="Pass command arguments as a JSON object",
            )
        policy = self._policies[name]
        handler = self._commands[name]
        kwargs = dict(args or {})
        try:
            bound = inspect.signature(handler).bind(**kwargs)
            bound.apply_defaults()
            effects = (
                policy.effects(dict(bound.arguments))
                if callable(policy.effects)
                else (policy.effects)
            )
            declared = policy.possible_effects if callable(policy.effects) else policy.effects
            if set(effects) - set(declared):
                raise ValueError("Command effects exceed its declared catalog capabilities")
            if self.context.profile != "trusted-local" and set(effects) - {"inspect"}:
                return error(
                    "EFFECT_DENIED",
                    f"{name} requires: {', '.join(effects)}",
                    suggestion="Use a separately authorized trusted-local host",
                )
            package = kwargs.get("package")
            if package and (
                not isinstance(package, str)
                or package.startswith("-")
                or ".." in package.split("/")
                or package.startswith("/")
            ):
                raise ValueError("Package must be a declared name inside the selected target")
            for key in policy.paths:
                if kwargs.get(key) is not None:
                    kwargs[key] = self.context.resolve_path(kwargs[key])
        except (TypeError, ValueError) as exc:
            return error(
                "INVALID_TARGET_OR_INPUT",
                str(exc),
                suggestion="Use declared arguments and paths within the host target",
            )

        async def invoke():
            return await handler(**kwargs)

        try:
            with use_context(self.context):
                result = (
                    await compose_middleware(*self.middleware)(name, kwargs, context, invoke)
                    if (self.middleware)
                    else await invoke()
                )
            if not isinstance(result, CommandResult):
                return error(
                    "INVALID_COMMAND_RESULT",
                    name,
                    suggestion="Register an adapter returning CommandResult",
                )
            if policy.quality:
                verdict = interpret_quality(result, policy.quality, str(self.context.target))
                metadata = result.metadata.model_dump(exclude_none=True) if result.metadata else {}
                result = result.model_copy(
                    update={"metadata": ResultMetadata(**{**metadata, "quality": asdict(verdict)})}
                )
            return result
        except Exception as exc:
            return error(
                "COMMAND_EXECUTION_ERROR",
                str(exc),
                suggestion="Inspect the selected target and command configuration",
            )


# Audited common commands. No AFD architectural policy is imposed on consumers.
CORE_POLICIES = {
    **{name: CommandPolicy() for name in ("info_workspace", "info_scripts", "info_env")},
    **{name: CommandPolicy(paths=("path",), quality="valid") for name in ("spec_validate",)},
    "spec_status": CommandPolicy(paths=("path",)),
    **{
        name: CommandPolicy(("source-write",), paths=("path",))
        for name in ("spec_create", "spec_delete")
    },
    **{
        name: CommandPolicy(("release-write",))
        for name in ("changeset_create", "changeset_consume", "changeset_delete")
    },
    "changeset_status": CommandPolicy(),
    "dev_lint": CommandPolicy(
        lambda args: ("subprocess", "source-write") if args.get("fix") else ("subprocess",),
        capabilities=("subprocess",),
        paths=("path",),
        quality="execution",
        possible_effects=("subprocess", "source-write"),
    ),
    "dev_test": CommandPolicy(
        ("subprocess", "artifact-write"),
        ("subprocess",),
        paths=("path",),
        quality="execution",
        output_scope="target",
    ),
    "dev_build": CommandPolicy(
        ("subprocess", "artifact-write"),
        ("subprocess",),
        paths=("path",),
        quality="execution",
        output_scope="target",
    ),
}


def build_host(
    name: str,
    context: ExecutionContext,
    *,
    plugins: tuple[str, ...] = (),
    extra_commands: tuple[Callable, ...] = (),
    policies: dict[str, CommandPolicy] | None = None,
    core_commands: tuple[str, ...] = tuple(CORE_POLICIES),
) -> CommandHost:
    """Explicit plugins only. Unadapted plugin commands fail catalog construction."""
    from botcore import commands
    from botcore.config import load_config
    from botcore.plugin import PluginRegistry, discover_plugins
    from botcore.server import build_docs

    selected = discover_plugins(plugins)
    registry = PluginRegistry(cli_name=name, mcp_name=name)
    with use_context(context):
        config = load_config(workspace=context.target, discovered_plugins=selected)
        for plugin_name in sorted(selected):
            plugin = selected[plugin_name]
            if getattr(plugin, "host_context_safe", False) is not True:
                raise ValueError(
                    f"Plugin {plugin_name} needs a per-host adapter declaring host_context_safe"
                )
            configure = getattr(plugin, "configure", None)
            if callable(configure) and plugin_name in config.plugins:
                configure(config.plugins[plugin_name])
            plugin.register(registry)
    host = CommandHost(name, context)
    host.docs = build_docs(registry)
    host.middleware = registry.middleware
    command_policies = {**CORE_POLICIES, **(policies or {})}
    handlers = [getattr(commands, command_name) for command_name in core_commands]
    for handler in [*handlers, *registry.commands, *extra_commands]:
        command_name = handler.__name__
        if command_name not in command_policies:
            raise ValueError(f"Declare command effects before admission: {command_name}")
        host.register(command_name, handler, command_policies[command_name])
    return host
