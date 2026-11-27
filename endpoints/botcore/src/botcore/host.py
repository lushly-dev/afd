"""Small, explicit host composition and policy shared by CLI, MCP and DirectClient.

Plugins and subprocesses are trusted installed code. This is cooperative policy,
not adversarial confinement. Undeclared commands fail closed in every profile.
"""

from __future__ import annotations

import asyncio
import contextlib
import difflib
import inspect
import uuid
import warnings
from collections.abc import Awaitable, Callable, Iterator
from contextvars import ContextVar
from dataclasses import asdict, dataclass, replace
from pathlib import Path, PureWindowsPath
from typing import Any, cast

from afd import Actor, CommandResult, DirectClient, error, system_clock, system_random
from afd.core.commands import CommandContext, CommandMiddleware
from afd.core.result import ResultMetadata
from afd.direct import CommandContext as DirectCommandContext
from afd.direct import CommandInfo
from afd.server.middleware import compose_middleware

try:  # afd 0.14.0 or later: the journal behind the host reads a command's `secret`.
    from afd.core import open_dispatch
    from afd.core.commands import declared_secret
    from afd.server.journal import run_off_tape
except ImportError:  # pragma: no cover - an older afd cannot honour `secret` (#2695)
    open_dispatch = None  # type: ignore[assignment]
    declared_secret = None  # type: ignore[assignment]
    run_off_tape = None  # type: ignore[assignment]

from botcore.context import PROFILE_EFFECTS, ExecutionContext, use_call, use_context
from botcore.host_inputs import check_arguments, describe_inputs, summary, validate_arguments

#: Whether the installed afd reads ``secret`` declarations (0.14.0 or later); before that its
#: ``define_command`` takes no ``secret`` and its journal behind the host reads unknown.
SECRET_AWARE = open_dispatch is not None

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
    secret declares that the command takes or returns a secret (``spec/journal.md``): AFD's
    journal behind the host never records a call to it without ``redact``.
    """

    effects: tuple[str, ...] | Callable[[dict[str, Any]], tuple[str, ...]] = ("inspect",)
    capabilities: tuple[str, ...] = ()
    paths: tuple[str, ...] = ()
    quality: str | None = None
    output_scope: str | None = None
    possible_effects: tuple[str, ...] = ()
    secret: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.secret, bool):
            raise TypeError(f"secret must be a bool, got {type(self.secret).__name__}")

    def declared(self) -> tuple[str, ...]:
        """Every effect a call may have: the static effects, or possible_effects."""
        return tuple(self.possible_effects if callable(self.effects) else self.effects)

    def describe(self) -> dict[str, Any]:
        return {
            "effects": list(self.declared()),
            "effects_depend_on_arguments": callable(self.effects),
            "capabilities": list(self.capabilities),
            "paths": list(self.paths),
            "quality": self.quality,
            "output_scope": self.output_scope,
            "secret": self.secret,
        }


@dataclass(frozen=True)
class QualityVerdict:
    status: str
    target: str
    evidence: dict[str, Any]

    def __post_init__(self) -> None:
        if self.status not in VERDICTS:
            raise ValueError(f"Unknown quality verdict: {self.status}")


def interpret_quality(result: CommandResult[Any], field: str, target: str) -> QualityVerdict:
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


@dataclass(frozen=True)
class HostSkills:
    """Where a managed host's served skills come from (``botcore.host_skills``).

    ``dirs`` are the folders its plugins register (``PluginRegistry.add_skills_dir``), served
    after Botcore's bundled skills when ``bundled``. ``include`` and ``skip`` are the
    workspace's ``[skills]`` filter, and a skill already seeded under ``seeded_dir`` is not
    served.
    """

    dirs: tuple[Path, ...] = ()
    include: tuple[str, ...] | None = None
    skip: tuple[str, ...] = ()
    seeded_dir: Path | None = None
    bundled: bool = True


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
        self._commands: dict[str, Callable[..., Any]] = {}
        self._policies: dict[str, CommandPolicy] = {}
        self.middleware: list[Callable[..., Any]] = []
        self.docs: dict[str, str] = {}
        #: The plugin instances whose commands this host serves (set by ``build_host``).
        self.plugins: dict[str, Any] = {}
        #: Where the skills its MCP server serves come from (set by ``build_host``); ``None``
        #: serves none. A host built from another host's commands copies it.
        self.skills: HostSkills | None = None

    async def aclose(self) -> None:
        """Release what the host's plugins hold open, calling each plugin's ``close()``."""
        for plugin in self.plugins.values():
            close = getattr(plugin, "close", None)
            if callable(close):
                outcome = close()
                if inspect.isawaitable(outcome):
                    await outcome

    def register(self, name: str, handler: Callable[..., Any], policy: CommandPolicy) -> None:
        if name in self._commands or _other_spelling(name) in self._commands:
            raise ValueError(f"Duplicate command: {name}")
        declared = policy.declared()
        if (callable(policy.effects) and not declared) or set(declared) - EFFECTS:
            raise ValueError(f"Declare known effects for {name}")
        if declared_secret is not None:
            # A handler decorated with define_command(secret=True) is secret whatever the policy.
            secret = declared_secret(name, handler, policy.secret)
            if secret != policy.secret:
                policy = replace(policy, secret=secret)
        elif policy.secret:  # afd before 0.14.0
            warnings.warn(
                f"{name} declares secret, but the installed afd predates 0.14.0 and its journal "
                "records the call unless a redact removes the secret; upgrade afd",
                RuntimeWarning,
                stacklevel=2,
            )
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

    def handler(self, name: str) -> Callable[..., Any]:
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

    def get_command(self, name: str) -> None:
        return None  # The shared dispatcher binds the actual Python signature.

    def catalog(self) -> list[dict[str, Any]]:
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

    def call_context(
        self, context: CommandContext | DirectCommandContext | None = None
    ) -> CommandContext | DirectCommandContext:
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

    def _not_found(self, name: Any) -> CommandResult[Any]:
        meant = self.closest_command(name) if isinstance(name, str) else None
        return error(
            "COMMAND_NOT_FOUND",
            f"{self.name} has no command {name}" + (f"; did you mean {meant}?" if meant else ""),
            suggestion=(f"Call {meant}, or i" if meant else "I")
            + f"nspect the host catalog ({self.name} catalog) for the commands it serves",
            details={"suggestedCommand": meant} if meant else None,
        )

    def validate_call(
        self,
        name: str,
        args: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, Any]] | CommandResult[Any]:
        """Validate command existence, arguments, policy effects and target paths.

        Returns ``(served_name, resolved_kwargs)`` when the call is admitted by this host's
        policy and execution profile, or a failure ``CommandResult`` otherwise.
        """
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
        return served, kwargs

    async def execute(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        context: CommandContext | DirectCommandContext | None = None,
    ) -> CommandResult[Any]:
        """Run one command through the host's policy and middleware.

        Inside :func:`isolated_call` the host does not run a secret call off tape itself.
        """
        # Read once, for this call only: commands it runs in turn are not isolated.
        isolated = _ISOLATED.get()
        checked = self.validate_call(name, args)
        if isinstance(checked, CommandResult):
            return checked
        served, kwargs = checked
        policy = self._policies[served]
        handler = self._commands[served]

        async def invoke() -> Any:
            if inspect.iscoroutinefunction(handler) or inspect.iscoroutinefunction(
                getattr(handler, "__call__", None)
            ):
                return await handler(**kwargs)
            outcome = await asyncio.to_thread(handler, **kwargs)
            if inspect.isawaitable(outcome):
                return await outcome
            return outcome

        call = self.call_context(context)
        try:
            # Bind the command's `secret` to the chain's continuation, so AFD's journal behind
            # the host reads the declaration as it does behind AFD's own executor.
            with (
                use_context(self.context),
                use_call(call),
                _not_isolated(),
                _dispatch(call, policy.secret) as dispatch,
            ):

                async def run() -> Any:
                    if not self.middleware:
                        return await invoke()
                    chain_next = dispatch.bind(invoke) if dispatch is not None else invoke
                    return await compose_middleware(*self.middleware)(
                        served, kwargs, cast(CommandContext, call), chain_next
                    )

                # A secret call reads no recording parent's tape, even when no journal is in
                # the host's own chain (an outer journal records the call that runs it).
                result = (
                    await run_off_tape(call, run)
                    if policy.secret and not isolated and run_off_tape is not None
                    else await run()
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


_ISOLATED: ContextVar[bool] = ContextVar("botcore_isolated_call", default=False)


@contextlib.contextmanager
def isolated_call() -> Iterator[None]:
    """Mark the next ``host.execute`` as already kept off its parents' tapes.

    The caller's engine does that, and may be recording the call on its own entry: AFD's journal
    does for the command ``create_host_mcp_server`` registers when it is in the server's
    middleware. The host then does not run a secret call off tape again, which would strip that
    recording's own tape. A context variable, not an argument, so subclasses that override
    ``execute`` keep working.
    """
    token = _ISOLATED.set(True)
    try:
        yield
    finally:
        _ISOLATED.reset(token)


@contextlib.contextmanager
def _not_isolated() -> Iterator[None]:
    token = _ISOLATED.set(False)
    try:
        yield
    finally:
        _ISOLATED.reset(token)


def _dispatch(call: Any, secret: bool) -> Any:
    """The dispatch binding ``secret`` for AFD's journal, or none on an older afd."""
    if open_dispatch is None:  # pragma: no cover - afd before 0.14.0
        return contextlib.nullcontext(None)
    return open_dispatch(call, secret=secret)


def create_host_policy_middleware(host: CommandHost) -> CommandMiddleware:
    """AFD middleware enforcing a managed host's policy, execution profile and path bounds.

    Runs before downstream AFD middleware and command handlers so calls refused by the
    host's profile, declared effects, argument schema or target path bounds short-circuit
    at the AFD middleware boundary without reaching handlers or approval prompts.
    """

    async def host_policy_middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: Callable[[], Awaitable[CommandResult[Any]]],
    ) -> CommandResult[Any]:
        if not host.has_command(command_name):
            return await next_fn()
        checked = host.validate_call(command_name, input)
        if isinstance(checked, CommandResult):
            return checked
        return await next_fn()

    return host_policy_middleware


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

# Audited browser automation commands. Not included in `build_host`'s default `core_commands`
# so non-browser hosts stay small; pass `core_commands=(*CORE_POLICIES, *CDP_POLICIES)` (or
# individual names) to admit them with their declared `"browser"` effect and path confinement.
CDP_POLICIES = {
    **{
        name: CommandPolicy(("browser",), capabilities=("browser",))
        for name in (
            "cdp_close",
            "cdp_navigate",
            "cdp_wait",
            "cdp_click",
            "cdp_hover",
            "cdp_scroll",
            "cdp_drag",
            "cdp_type",
            "cdp_press",
            "cdp_inspect",
            "cdp_query",
            "cdp_snapshot",
            "cdp_fill",
            "cdp_fill_form",
            "cdp_handle_dialog",
            "cdp_list_pages",
            "cdp_select_page",
            "cdp_new_page",
            "cdp_close_page",
            "cdp_resize",
            "cdp_console",
            "cdp_get_console_message",
            "cdp_eval",
            "cdp_list_network",
            "cdp_get_network",
            "cdp_emulate",
        )
    },
    "cdp_launch": CommandPolicy(("browser",), capabilities=("browser",), paths=("profile_dir",)),
    "cdp_attach": CommandPolicy(("browser",), capabilities=("browser",), paths=("profile_dir",)),
    "cdp_upload": CommandPolicy(("browser",), capabilities=("browser",), paths=("file_path",)),
    "cdp_screenshot": CommandPolicy(("browser",), capabilities=("browser",), paths=("path",)),
    "cdp_trace_capture": CommandPolicy(("browser",), capabilities=("browser",), paths=("path",)),
    "cdp_trace_summary": CommandPolicy(("browser",), capabilities=("browser",), paths=("path",)),
    "cdp_trace_query": CommandPolicy(("browser",), capabilities=("browser",), paths=("path",)),
}


def narrow_policy(name: str, plugin: CommandPolicy, host: CommandPolicy) -> CommandPolicy:
    """Apply an explicit host policy to a plugin-declared one, which it may only narrow.

    The host may admit a subset of the plugin's possible effects and confine more path
    arguments. It may not add an effect, stop confining a path, or leave out an effect
    the command always has. The plugin's per-argument effects still apply, so a call
    whose effects fall outside the host's set is denied. The host's capabilities,
    quality and output scope replace the plugin's where the host sets them. Either may
    declare the command secret; the host may not unset the plugin's declaration.
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

    effects: tuple[str, ...] | Callable[[dict[str, Any]], tuple[str, ...]]
    if callable(plugin.effects):
        plugin_fn = plugin.effects

        def per_call(arguments: dict[str, Any]) -> tuple[str, ...]:
            extra = host.effects(arguments) if callable(host.effects) else host.effects
            return tuple(sorted({*plugin_fn(arguments), *extra}))

        effects = per_call
        dynamic = True
    else:
        effects = plugin.effects
        dynamic = False  # A static plugin set equals the host's here.
    return CommandPolicy(
        effects,
        host.capabilities or plugin.capabilities,
        host.paths,
        host.quality or plugin.quality,
        host.output_scope or plugin.output_scope,
        tuple(sorted(host_effects)) if dynamic else (),
        plugin.secret or host.secret,
    )


def _refuse_foreign_policies(
    plugin_name: str, registry: Any, commands: set[str], policies: set[str]
) -> None:
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
    extra_commands: tuple[Callable[..., Any], ...] = (),
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
    host.plugins = dict(selected)
    host.skills = HostSkills(
        dirs=tuple(registry.skills_dirs),
        include=None if config.skills.include is None else tuple(config.skills.include),
        skip=tuple(config.skills.skip),
        # Seeding writes at the worktree's root, whatever folder the host targets.
        seeded_dir=context.workspace / config.skills.source_dir,
    )
    host.docs = build_docs(registry)
    host.middleware = registry.middleware
    explicit = policies or {}
    command_policies = {**CORE_POLICIES, **CDP_POLICIES, **explicit}
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
