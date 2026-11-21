"""Small, explicit host composition and policy shared by CLI, MCP and DirectClient.

Plugins and subprocesses are trusted installed code. This is cooperative policy,
not adversarial confinement. Undeclared commands fail closed in every profile.
"""

from __future__ import annotations

import difflib
import inspect
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import PureWindowsPath
from typing import Any

from afd import Actor, CommandResult, DirectClient, error, system_clock, system_random
from afd.core.commands import CommandContext
from afd.core.result import ResultMetadata
from afd.direct import CommandInfo
from afd.server.middleware import compose_middleware

from botcore.context import PROFILE_EFFECTS, ExecutionContext, use_call, use_context
from botcore.host_inputs import check_arguments, describe_inputs, summary, validate_arguments

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

    def declared(self) -> tuple[str, ...]:
        """Every effect a call may have: the static effects, or possible_effects."""
        return tuple(self.possible_effects if callable(self.effects) else self.effects)

    def describe(self) -> dict:
        return {
            "effects": list(self.declared()),
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


def kebab_name(name: str) -> str:
    """AFD's kebab-case spelling of a command name: ``issue_claim`` is ``issue-claim``."""
    return name.replace("_", "-")


def _other_spelling(name: str) -> str:
    return name.replace("-", "_") if "-" in name else name.replace("_", "-")


def _name_key(name: str) -> str:
    return "".join(character for character in name.lower() if character.isalnum())


class CommandHost:
    """An isolated catalog/context implementing AFD's DirectRegistry protocol.

    Commands are served under the names they are registered with; a call may also use the
    other spelling (``issue_claim`` for ``issue-claim`` and back). ``actor`` is who a call
    without its own context is made as: a surface that verifies its caller passes a context.
    """

    def __init__(self, name: str, context: ExecutionContext, *, actor: Actor | None = None):
        self.name = name
        self.context = context
        self.actor = actor
        self._commands: dict[str, Callable] = {}
        self._policies: dict[str, CommandPolicy] = {}
        self.middleware: list[Callable] = []
        self.docs: dict[str, str] = {}

    def register(self, name: str, handler: Callable, policy: CommandPolicy) -> None:
        if name in self._commands or _other_spelling(name) in self._commands:
            raise ValueError(f"Duplicate command: {name}")
        declared = policy.declared()
        if (callable(policy.effects) and not declared) or set(declared) - EFFECTS:
            raise ValueError(f"Declare known effects for {name}")
        self._commands[name] = handler
        self._policies[name] = policy

    def resolve(self, name: str) -> str | None:
        """The registered name ``name`` calls, in either spelling, or ``None``.

        Read from ``_commands`` itself, so a host that shares another's commands resolves
        the same names."""
        if not isinstance(name, str):
            return None
        for candidate in (name, _other_spelling(name)):
            if candidate in self._commands:
                return candidate
        return None

    def handler(self, name: str) -> Callable:
        return self._commands[self.resolve(name) or name]

    def policy(self, name: str) -> CommandPolicy:
        return self._policies[self.resolve(name) or name]

    def has_command(self, name: str) -> bool:
        return self.resolve(name) is not None

    def list_command_names(self) -> list[str]:
        return sorted(self._commands)

    def closest_command(self, name: str) -> str | None:
        """The served name a wrong one most likely meant, by spelling, else by difflib."""
        by_key = {_name_key(served): served for served in self.list_command_names()}
        key = _name_key(str(name))
        if key in by_key:
            return by_key[key]
        match = difflib.get_close_matches(key, list(by_key), n=1, cutoff=0.6)
        return by_key[match[0]] if match else None

    def list_commands(self) -> list[CommandInfo]:
        return [
            CommandInfo(name, summary(self.handler(name))) for name in self.list_command_names()
        ]

    def get_command(self, name: str):
        return None  # The shared dispatcher binds the actual Python signature.

    def catalog(self) -> list[dict]:
        """Each command's one-line description, input JSON Schema and policy."""
        rows = []
        for name in self.list_command_names():
            description, input_schema = describe_inputs(self.handler(name))
            rows.append(
                {
                    "name": name,
                    "description": description,
                    "input_schema": input_schema,
                    **self.policy(name).describe(),
                }
            )
        return rows

    def direct_client(self) -> DirectClient:
        return DirectClient(self)

    def call_context(self, context: Any = None) -> CommandContext:
        """The per-call context middleware and handlers see: ``context`` when a surface
        built one (with the caller it verified as ``actor``), else a fresh one with a
        trace ID and this host's ``actor``."""
        if context is None:
            context = CommandContext(actor=self.actor)
        if getattr(context, "trace_id", None) is None:
            context.trace_id = uuid.uuid4().hex
        if getattr(context, "clock", None) is None:
            context.clock = system_clock
        if getattr(context, "random", None) is None:
            context.random = system_random
        return context

    def _not_found(self, name: Any) -> CommandResult:
        meant = self.closest_command(name) if isinstance(name, str) else None
        return error(
            "COMMAND_NOT_FOUND",
            f"{self.name} has no command {name}" + (f"; did you mean {meant}?" if meant else ""),
            suggestion=(f"Call {meant}, or i" if meant else "I")
            + f"nspect the host catalog ({self.name} catalog) for the commands it serves",
            details={"suggestedCommand": meant} if meant else None,
        )

    async def execute(self, name: str, args: Any = None, context: Any = None) -> CommandResult:
        registered = self.resolve(name)
        if registered is None:
            return self._not_found(name)
        served = registered
        if args is not None and not isinstance(args, dict):
            return error(
                "VALIDATION_ERROR",
                "Arguments must be an object",
                suggestion="Pass command arguments as a JSON object",
            )
        policy = self._policies[registered]
        handler = self._commands[registered]
        kwargs = dict(args or {})
        refusal = check_arguments(served, handler, kwargs)
        if refusal is not None:
            return refusal
        kwargs, refusal = validate_arguments(served, handler, kwargs)
        if refusal is not None:
            return refusal
        try:
            bound = inspect.signature(handler).bind(**kwargs)
            bound.apply_defaults()
            effects = (
                policy.effects(dict(bound.arguments))
                if callable(policy.effects)
                else (policy.effects)
            )
            declared = policy.declared()
            if set(effects) - set(declared):
                return error(
                    "EFFECT_DENIED",
                    f"{served} with these arguments requires: {', '.join(effects)}; "
                    f"this host admits: {', '.join(declared)}",
                    suggestion="Use arguments whose effects the host catalog lists",
                )
            admitted = PROFILE_EFFECTS[self.context.profile]
            if admitted is not None and set(effects) - admitted:
                return error(
                    "EFFECT_DENIED",
                    f"{served} requires: {', '.join(effects)}; the {self.context.profile} "
                    f"profile admits: {', '.join(sorted(admitted))}",
                    suggestion=(
                        "Call a command whose effects this host's catalog lists; this effect "
                        "is not served to remote callers"
                        if self.context.profile == "remote-caller"
                        else "Use a separately authorized trusted-local host"
                    ),
                )
            package = kwargs.get("package")
            if package and (
                not isinstance(package, str)
                or "\x00" in package
                or "\\" in package
                or ":" in package
                or package.startswith(("-", "/"))
                or ".." in package.split("/")
                or PureWindowsPath(package).is_absolute()
                or bool(PureWindowsPath(package).drive)
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

        call = self.call_context(context)
        try:
            with use_context(self.context), use_call(call):
                result = (
                    await compose_middleware(*self.middleware)(served, kwargs, call, invoke)
                    if (self.middleware)
                    else await invoke()
                )
            if not isinstance(result, CommandResult):
                return error(
                    "INVALID_COMMAND_RESULT",
                    served,
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


def narrow_policy(name: str, plugin: CommandPolicy, host: CommandPolicy) -> CommandPolicy:
    """Apply an explicit host policy to a plugin-declared one, which it may only narrow.

    The host may admit a subset of the plugin's possible effects and confine more path
    arguments. It may not add an effect, stop confining a path, or leave out an effect
    the command always has. The plugin's per-argument effects still apply, so a call
    whose effects fall outside the host's set is denied. The host's capabilities,
    quality and output scope replace the plugin's where the host sets them.
    """
    plugin_effects, host_effects = set(plugin.declared()), set(host.declared())
    always = set() if callable(plugin.effects) else plugin_effects
    problems = [
        f"{problem}: {', '.join(sorted(names))}"
        for problem, names in (
            ("adds effects the plugin does not declare", host_effects - plugin_effects),
            ("leaves out effects the command always has", always - host_effects),
            ("stops confining path arguments", set(plugin.paths) - set(host.paths)),
        )
        if names
    ]
    if problems:
        raise ValueError(
            f"Host policy for {name} {'; '.join(problems)}; "
            "a host policy may only narrow the plugin's"
        )

    def per_call(arguments: dict) -> tuple[str, ...]:
        extra = host.effects(arguments) if callable(host.effects) else host.effects
        return tuple(sorted({*plugin.effects(arguments), *extra}))

    dynamic = callable(plugin.effects)  # A static plugin set equals the host's here.
    return CommandPolicy(
        per_call if dynamic else plugin.effects,
        host.capabilities or plugin.capabilities,
        host.paths,
        host.quality or plugin.quality,
        host.output_scope or plugin.output_scope,
        tuple(sorted(host_effects)) if dynamic else (),
    )


def _refuse_foreign_policies(plugin_name: str, registry, commands: set, policies: set) -> None:
    registered = {command.__name__ for command in registry.commands} - commands
    foreign = set(registry.policies) - policies - registered
    if foreign:
        raise ValueError(
            f"Plugin {plugin_name} declares policies for commands it does not register: "
            f"{', '.join(sorted(foreign))}"
        )


def build_host(
    name: str,
    context: ExecutionContext,
    *,
    plugins: tuple[str, ...] = (),
    extra_commands: tuple[Callable, ...] = (),
    policies: dict[str, CommandPolicy] | None = None,
    core_commands: tuple[str, ...] = tuple(CORE_POLICIES),
    kebab_names: bool = False,
) -> CommandHost:
    """Explicit plugins only. Unadapted plugin commands fail catalog construction.

    A command's policy comes from its plugin (PluginRegistry.add_policy) or from
    `policies`. Where both declare one, the host's may only narrow the plugin's
    (narrow_policy); a conflict that would widen effects refuses construction.
    ``kebab_names`` serves every command under AFD's kebab-case name (``issue-claim``)
    instead of its Python function's (``issue_claim``); either spelling calls it.
    """
    from botcore import commands
    from botcore.config import load_config
    from botcore.plugin import PluginRegistry, discover_plugins
    from botcore.server import build_docs

    selected = discover_plugins(plugins)
    registry = PluginRegistry(cli_name=name, mcp_name=name)
    with use_context(context):
        config = load_config(workspace=context.target, discovered_plugins=selected, selection=True)
        for plugin_name in sorted(selected):
            plugin = selected[plugin_name]
            if getattr(plugin, "host_context_safe", False) is not True:
                raise ValueError(
                    f"Plugin {plugin_name} needs a per-host adapter declaring host_context_safe"
                )
            configure = getattr(plugin, "configure", None)
            if callable(configure) and plugin_name in config.plugins:
                configure(config.plugins[plugin_name])
            before = {command.__name__ for command in registry.commands}, set(registry.policies)
            plugin.register(registry)
            _refuse_foreign_policies(plugin_name, registry, *before)
    host = CommandHost(name, context)
    host.docs = build_docs(registry)
    host.middleware = registry.middleware
    explicit = policies or {}
    command_policies = {**CORE_POLICIES, **explicit}
    for command_name, declared in registry.policies.items():
        command_policies[command_name] = (
            narrow_policy(command_name, declared, explicit[command_name])
            if command_name in explicit
            else declared
        )
    handlers = [getattr(commands, command_name) for command_name in core_commands]
    for handler in [*handlers, *registry.commands, *extra_commands]:
        command_name = handler.__name__
        if command_name not in command_policies:
            raise ValueError(f"Declare command effects before admission: {command_name}")
        served = kebab_name(command_name) if kebab_names else command_name
        host.register(served, handler, command_policies[command_name])
    return host
