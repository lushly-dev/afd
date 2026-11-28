"""Server factory for creating AFD MCP servers."""

from __future__ import annotations

import copy
import dataclasses
import logging
import os
from collections.abc import (
    AsyncGenerator,
    AsyncIterator,
    Awaitable,
    Callable,
    Iterator,
    Mapping,
    Sequence,
)
from contextlib import asynccontextmanager, contextmanager, suppress
from contextvars import ContextVar
from typing import (
    Any,
    Literal,
    TypeVar,
)

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from afd.core.actor import Actor, ContextDefaults
from afd.core.approval import ApprovalPolicy
from afd.core.batch import (
    DEFAULT_MAX_BATCH_PARALLELISM as DEFAULT_MAX_BATCH_PARALLELISM,
)
from afd.core.batch import (
    DEFAULT_MAX_BATCH_SIZE as DEFAULT_MAX_BATCH_SIZE,
)
from afd.core.batch import (
    BatchResult,
)
from afd.core.builtin_names import (
    AFD_BOOTSTRAP_COMMAND_NAMES,
    AFD_CONTEXT_COMMAND_NAMES,
    AFD_META_TOOL_NAMES,
)
from afd.core.clock import Clock, RandomSource
from afd.core.command_execution import (
    StreamExecutorOptions,
)
from afd.core.command_execution import (
    execute_stream as _execute_core_stream,
)
from afd.core.commands import (
    DEFAULT_EXPOSE,
    CallGrant,
    CommandConfirmationMode,
    CommandContext,
    CommandDefinition,
    CommandExample,
    CommandRegistry,
    ExposeOptions,
    TaskSupport,
    app_call_granted,
    call_not_granted,
    create_command_registry,
    validate_command_scopes,
    validate_confirmation_mode,
    validate_secret,
    validate_task_declaration,
)
from afd.core.direct_allow import _is_allowed, _not_allowed
from afd.core.errors import CommandError, ErrorCodes, Recovery
from afd.core.meta_keys import assert_advertised_input_schema, assert_tool_meta
from afd.core.output_budget import (
    OutputBudget,
    bind_output_budget_ask,
    normalize_ask_option,
    output_budget_ask_from_meta,
    validate_output_budget_declaration,
)
from afd.core.pipeline import (
    PipelineResult,
)
from afd.core.result import (
    CommandResult,
    coerce_command_result,
    error,
    execution_failure,
    failure,
)
from afd.core.schema_validation import (
    DEFAULT_MAX_VALIDATION_ISSUES,
    SchemaValidationError,
    check_schema,
    resolve_max_validation_issues,
)
from afd.core.single_executor import CommandExecutionConfig, execute_command
from afd.core.streaming import StreamChunk, StreamOptions
from afd.server.approval_admission import (
    Admission,
    admission_for,
    admission_required,
    take_admission,
)
from afd.server.approval_relay import bind_approval_relay, current_up_front_approval
from afd.server.auth import (
    AuthLayer,
    McpAuthOptions,
    PreDispatchCheck,
    admitted_credentials_for,
    admitted_view_for,
    bind_trusted_transport,
    create_auth_layer,
    credentials_actor,
    is_trusted_transport,
)
from afd.server.auth_middleware_check import assert_auth_middleware_recognises_tokens
from afd.server.auth_resource import ProtectedResource
from afd.server.auth_rules import Credentials
from afd.server.auth_scopes import ScopeChallenge
from afd.server.auth_view import (
    ScopeAuthority,
    ScopeView,
    listed_commands,
    scope_view_of,
)
from afd.server.batch_execution import execute_batch, execute_pipeline_request
from afd.server.bootstrap import ContextState, get_bootstrap_commands
from afd.server.callability import can_call, not_found_guide
from afd.server.config import (
    DEFAULT_COMMAND_TIMEOUT_MS as DEFAULT_COMMAND_TIMEOUT_MS,
)
from afd.server.config import (
    DEFAULT_TOOLS_LIST_TTL_MS as DEFAULT_TOOLS_LIST_TTL_MS,
)
from afd.server.config import (
    MCPTransport as MCPTransport,
)
from afd.server.config import (
    ServerConfig,
    _resolve_default_timeout_ms,
    default_instructions,
    refuse_apps_tool_call,
)
from afd.server.confirmations import (
    CONFIRMATION_MODES,
    ConfirmationGate,
    bind_confirmation_channel,
)
from afd.server.context_fields import (
    AFD_CONTEXT_FIELDS_META_KEY,
    JOURNALED_CONTEXT_FIELDS,
    ContextField,
    apply_context_fields,
    bind_context_field_values,
    check_context_fields,
    context_field_values,
    describe_context_fields,
)
from afd.server.context_hook import (
    ContextHook,
    HookOutcome,
    bind_hook_outcome,
    current_hook_outcome,
    run_context_hook,
    trace_prefix_for_tool,
)
from afd.server.decorators import (
    CommandMetadata,
    command_to_definition,
    define_command,
    get_command_metadata,
    has_command_metadata,
    validate_command_input,
)
from afd.server.elicitation import MAX_IN_BAND_ROUNDS, ElicitationRound
from afd.server.first_class import check_first_class_tools, normalize_first_class_tools
from afd.server.human_relay import (
    HumanRelay,
    HumanRelayChannel,
    HumanRelayGate,
    bind_human_relay_channel,
    bind_relay_wire,
)
from afd.server.instance_state import ServerInstances, check_instance_state, warn_instances_once
from afd.server.lazy_tools import command_not_found
from afd.server.meta_argument import lift_meta_argument, meta_argument_keys
from afd.server.middleware import CommandMiddleware
from afd.server.principal import principal_binding, sdk_credentials
from afd.server.relay_evidence import (
    RelayDispatchAdmission,
    clear_relay_evidence,
    clear_relay_state,
    pop_relay_dispatch_admission,
    take_relay_context_validated,
    take_relay_validated_input,
    transfer_relay_state,
)
from afd.server.relay_wire import (
    in_context as _in_context,
)
from afd.server.relay_wire import (
    install_pre_boundary_middleware,
    targets_host_verified,
)
from afd.server.relay_wire import (
    request_meta as _request_meta,
)
from afd.server.relay_wire import (
    validated_input_for_resolver as _validated_input_for_resolver,
)
from afd.server.resources import (
    ResourceService,
    ResourcesOption,
    create_resource_service,
    strip_unused_sdk_handlers,
)
from afd.server.sdk_internals import lowlevel_server
from afd.server.session_context import (
    SessionContextState,
    UnknownContextError,
    is_modern_protocol,
)
from afd.server.skills import SKILLS_EXTENSION_ID, SkillCatalog
from afd.server.tasks import (
    TASKS_EXTENSION_ID,
    TaskOptions,
    TaskStore,
    assert_valid_task_commands,
)
from afd.server.tasks_runtime import (
    TaskRuntime,
    composite_task_error,
    is_created_task_sentinel,
)
from afd.server.tool_results import (
    approval_unavailable as _approval_unavailable,
)
from afd.server.tool_results import (
    is_input_required as _is_input_required,
)
from afd.server.tool_results import (
    is_mcp_error as _is_mcp_error,
)
from afd.server.tool_results import (
    tool_call_result as _tool_call_result,
)
from afd.server.tool_results import (
    unanswered_approval as _unanswered_approval,
)
from afd.server.tool_router import (
    ToolRouterDeps,
    create_tool_router,
    new_trace_id,
    not_in_context_error,
)
from afd.server.tools import get_tools_list
from afd.server.types import (
    ContextConfig,
    GroupByFn,
    ToolStrategy,
)
from afd.server.up_front_check import check_approved_at_run
from afd.server.validation import _input_validation_failure

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput")

# Never log to stdout: the stdio transport uses it for JSON-RPC.
logger = logging.getLogger("afd.server")

META_TOOL_NAMES: frozenset[str] = AFD_META_TOOL_NAMES
"""Tools the router handles itself (defined in ``afd.core.builtin_names``). They are not commands: a command cannot use
these names, and batch items and pipeline steps cannot call them."""

_CONTEXT_COMMAND_NAMES = frozenset({"afd-context-enter", "afd-context-exit"})


# The SDK request context (``ServerRequestContext``) of the MCP request being handled,
# captured by middleware so tools/list and tools/call can bind its context state.
_CURRENT_REQUEST: ContextVar[Any] = ContextVar("afd_mcp_request", default=None)

_MAX_TOOL_LISTS = 64
"""Most cached tool lists a server keeps (one per strategy, active context and listed commands);
past this, the cache starts again rather than grow with every scope view a caller presents."""


def _copy_json(value: Any) -> Any:
    """A copy of JSON-shaped data: new dicts and lists all the way down.

    Tool definitions are JSON (``tool_meta`` and the schemas are checked to be), and this is
    several times faster than ``copy.deepcopy``, which would cost as much as rebuilding.
    """
    if isinstance(value, dict):
        return {key: _copy_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_json(item) for item in value]
    return value


class _ToolList:
    """One cached ``tools/list`` answer: its definitions and, once asked for, the SDK's models.

    Shared between requests and never handed out: ``get_tool_definitions`` returns a copy, and
    the SDK only serializes the models.
    """

    __slots__ = ("definitions", "group_by", "_sdk_tools")

    def __init__(self, definitions: list[dict[str, Any]], group_by: Any) -> None:
        self.definitions = definitions
        # The key holds group_by by id; holding the object here keeps that id from being
        # reused by another function while this list is cached.
        self.group_by = group_by
        self._sdk_tools: list[Any] | None = None

    def sdk_tools(self) -> list[Any]:
        if self._sdk_tools is None:
            from mcp.types import Tool as MCPTool

            self._sdk_tools = [MCPTool(**definition) for definition in self.definitions]
        return list(self._sdk_tools)


class MCPServer:
    """AFD MCP server for exposing commands and built-in tools."""

    def __init__(self, config: ServerConfig):
        if (
            isinstance(config.max_batch_size, bool)
            or not isinstance(config.max_batch_size, int)
            or config.max_batch_size < 1
            or isinstance(config.max_batch_parallelism, bool)
            or not isinstance(config.max_batch_parallelism, int)
            or config.max_batch_parallelism < 1
        ):
            raise ValueError("max_batch_size and max_batch_parallelism must be at least 1")
        self._default_timeout_ms = _resolve_default_timeout_ms(config.default_timeout_ms)
        self._max_validation_issues = resolve_max_validation_issues(config.max_validation_issues)
        if config.context_hook is not None and not callable(config.context_hook):
            raise TypeError("context_hook must be callable")
        if config.call_grant is not None and not callable(config.call_grant):
            raise TypeError("call_grant must be callable")
        if config.human_relay is not None:
            if not callable(getattr(config.human_relay, "begin", None)) or not callable(
                getattr(config.human_relay, "resume", None)
            ):
                raise TypeError("human_relay must implement begin and resume")
            approved_ctx = getattr(config.human_relay, "approved_context", None)
            if approved_ctx is not None and not callable(approved_ctx):
                raise TypeError("human_relay.approved_context must be callable")
            pending_list = getattr(config.human_relay, "pending_list", None)
            if pending_list is not None and not callable(pending_list):
                raise TypeError("human_relay.pending_list must be callable")
        if config.task_options is not None and not isinstance(config.task_options, TaskOptions):
            raise TypeError("task_options must be a TaskOptions instance")
        if config.tools_list_ttl_ms is not None and (
            isinstance(config.tools_list_ttl_ms, bool)
            or not isinstance(config.tools_list_ttl_ms, int)
            or config.tools_list_ttl_ms < 0
        ):
            raise ValueError("tools_list_ttl_ms must be a non-negative integer")
        resources_ttl_ms = (
            config.tools_list_ttl_ms
            if config.tools_list_ttl_ms is not None
            else DEFAULT_TOOLS_LIST_TTL_MS
        )
        if config.confirmations not in CONFIRMATION_MODES:
            raise ValueError("confirmations must be 'off', 'enforce' or 'require-human'")
        instance_state = check_instance_state(
            name=config.name,
            instances=config.instances,
            confirmation_key=config.confirmation_key,
            confirmations=config.confirmations,
            middleware=config.middleware,
        )
        assert_auth_middleware_recognises_tokens(
            has_auth=config.auth is not None,
            middleware=config.middleware,
        )
        self._confirmations: str = config.confirmations
        self._confirmation_key: bytes | None = instance_state.confirmation_key
        self._instances_http_warning: str | None = instance_state.http_warning
        # The set's options are checked here; its entries once the commands are registered.
        first_class = normalize_first_class_tools(config.tool_strategy, config.first_class_tools)
        config.first_class_tools = first_class
        config.context_fields = check_context_fields(config.context_fields)
        self.config = config
        self._resource_service: ResourceService | None = create_resource_service(
            config.resources,
            config.skills,
            ttl_ms=resources_ttl_ms,
            dev_mode=config.dev_mode,
        )
        self._registry = create_command_registry(call_grant=config.call_grant)
        self._commands: dict[str, Callable[..., Any]] = {}
        self._metadata: dict[str, CommandMetadata] = {}
        self._mcp_server: Any = None
        self._stateless_http = False
        self._middleware: list[CommandMiddleware] = list(config.middleware)
        self._context_state = SessionContextState()
        self._bootstrap_commands: list[CommandDefinition] | None = None
        self._names_key: tuple[Any, ...] | None = None
        # Per-call caches, rebuilt after register() or a context change.
        self._command_index: dict[str, CommandDefinition] | None = None
        self._router: Callable[..., Awaitable[Any]] | None = None
        self._human_relay_gate: HumanRelayGate | None = None
        # The MCP tool list per strategy, active context and listed commands (#1760).
        self._tool_lists: dict[tuple[Any, ...], _ToolList] = {}
        # The input schema of each tool the SDK may validate Mcp-Param headers against.
        self._sdk_tool_schemas: dict[str, dict[str, Any]] = {}
        # Schemas of tools served beside AFD's own (Botcore's compatibility aliases).
        self._extra_tool_schemas: dict[str, dict[str, Any]] = {}
        self._scope_authority: ScopeAuthority | None = None
        self._first_class_checked = False
        self._auth_layer: AuthLayer | None = (
            create_auth_layer(
                config.auth,
                clock=config.clock,
                get_scope_authority=self._get_scope_authority,
            )
            if config.auth is not None
            else None
        )
        self._task_runtime = TaskRuntime(
            get_exposed_commands=lambda: self.list_exposed_commands(
                interface="mcp", include_bootstrap=False, context_filtered=False
            ),
            execute_command=self._execute_command,
            store=config.task_store,
            options=config.task_options,
            clock=config.clock,
            actor=config.actor,
            has_context_hook=config.context_hook is not None,
            run_context_hook=(self._run_context_hook if config.context_hook is not None else None),
            get_admitted_credentials=self._current_admitted_credentials,
            get_scope_view=self._current_scope_view,
        )

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def version(self) -> str:
        return self.config.version

    @property
    def registry(self) -> CommandRegistry:
        return self._registry

    @property
    def context_state(self) -> ContextState:
        return self._context_state

    @property
    def context_fields(self) -> tuple[ContextField, ...]:
        """The declared context fields, so ``replay_journal`` can tell which recorded values
        still apply."""
        return tuple(self.config.context_fields)

    @property
    def task_store(self) -> TaskStore:
        """The :class:`~afd.server.tasks.TaskStore` backing MCP Tasks on this server."""
        return self._task_runtime.store

    @property
    def protected_resource(self) -> ProtectedResource | None:
        """The server's RFC 9728 protected-resource metadata when ``auth`` is configured."""
        return self._auth_layer.protected_resource if self._auth_layer is not None else None

    def trusted_transport(self) -> Any:
        """Context manager marking a non-HTTP transport explicitly trusted for this server
        (``spec/authorization.md``, M1)."""
        return bind_trusted_transport(self._auth_layer)

    def admit(self, request_or_scope: Any, credentials: Credentials) -> Any:
        """Context manager admitting ``credentials`` that a host's own HTTP layer vouches for,
        for this request alone (``spec/authorization.md``, M6)."""
        if self._auth_layer is None:
            raise ValueError("[AFD] admit needs the auth option")
        return self._auth_layer.host_admit(request_or_scope, credentials)

    def pre_dispatch_check(
        self,
        *,
        challenge: ScopeChallenge | None = None,
        scope_source: str | None = None,
        max_body_bytes: int | None = None,
    ) -> PreDispatchCheck:
        """Build the pre-dispatch scope checker for a host's own HTTP layer
        (``spec/authorization.md``, M6)."""
        if self._auth_layer is None:
            raise ValueError("[AFD] pre_dispatch_check needs the auth option")
        self._check_before_request()
        return self._auth_layer.pre_dispatch_check(
            challenge=challenge,
            scope_source=scope_source,
            max_body_bytes=max_body_bytes,
        )

    def _get_scope_authority(self) -> ScopeAuthority:
        if self._auth_layer is None:
            raise RuntimeError("auth layer is not configured")
        self._check_before_request()
        if self._scope_authority is None:
            commands = self.list_exposed_commands(
                interface="mcp", include_bootstrap=True, context_filtered=False
            )
            self._scope_authority = ScopeAuthority(
                required_scopes=self._auth_layer.required_scopes,
                resolver=self._auth_layer.resolver,
                filter_tools_by_scope=self._auth_layer.filter_tools_by_scope,
                commands=commands,
                tool_strategy=self.config.tool_strategy,
                group_by_fn=self.config.group_by,
                resource=self._auth_layer.protected_resource,
            )
        return self._scope_authority

    def _current_admitted_credentials(self) -> Credentials | None:
        if self._auth_layer is None:
            return None
        return admitted_credentials_for(self._auth_layer)

    def _current_scope_view(self) -> ScopeView | None:
        if self._auth_layer is None:
            return None
        return admitted_view_for(self._auth_layer)

    def _insufficient_scope_rpc_error(self, view: ScopeView, missing: Sequence[str]) -> Exception:
        from mcp import MCPError
        from mcp_types import INVALID_REQUEST

        err = view.insufficient_scope(missing)
        return MCPError(
            code=INVALID_REQUEST,
            message=err.message,
            data={
                "code": err.code,
                "suggestion": err.suggestion,
                "scopes": list(missing),
                "retryable": False,
            },
        )

    def _is_auth_admitted(self) -> bool:
        """Whether the current MCP request may proceed under M1's fail-closed rule."""
        if self._auth_layer is None:
            return True
        if admitted_credentials_for(self._auth_layer) is not None:
            return True
        return is_trusted_transport(self._auth_layer)

    def _unauthorized_error(self) -> CommandError:
        suggestion = (
            self._auth_layer.protected_resource.unauthorized_body()["suggestion"]
            if self._auth_layer is not None
            else "Obtain a valid access token and retry."
        )
        return CommandError(
            code=ErrorCodes.UNAUTHORIZED,
            message="This server requires a verified access token",
            suggestion=suggestion,
            retryable=False,
        )

    def _unauthorized_rpc_error(self) -> Exception:
        from mcp import MCPError
        from mcp_types import INVALID_REQUEST

        err = self._unauthorized_error()
        return MCPError(
            code=INVALID_REQUEST,
            message=err.message,
            data={"code": err.code, "suggestion": err.suggestion, "retryable": False},
        )

    def stop_tasks(self) -> None:
        """Stop all locally running MCP tasks without overwriting shared store state."""
        self._task_runtime.dispose()

    def list_contexts(self) -> list[ContextConfig]:
        return list(self.config.contexts)

    def command(
        self,
        name: str,
        description: str,
        category: str | None = None,
        input_schema: type[BaseModel] | dict[str, Any] | None = None,
        output_schema: type[BaseModel] | None = None,
        tags: list[str] | None = None,
        mutation: bool = False,
        examples: list[CommandExample | dict[str, Any]] | None = None,
        requires: list[str] | None = None,
        contexts: list[str] | None = None,
        expose: ExposeOptions | None = None,
        destructive: bool | None = None,
        confirm_prompt: str | None = None,
        undoable: bool | None = None,
        approval: ApprovalPolicy | None = None,
        version: str | None = None,
        title: str | None = None,
        errors: list[str] | None = None,
        execution_time: Literal["instant", "fast", "slow", "long-running"] | None = None,
        handoff: bool = False,
        handoff_protocol: str | None = None,
        task: TaskSupport | None = None,
        tool_meta: dict[str, Any] | None = None,
        advertised_input_schema: dict[str, Any] | None = None,
        output_budget: OutputBudget | dict[str, Any] | None = None,
        scopes: Sequence[str] | None = None,
        confirmation_mode: CommandConfirmationMode | None = None,
        secret: bool = False,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator to register a command with this server (arguments as ``define_command``)."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            decorated = define_command(
                name=name,
                description=description,
                category=category,
                input_schema=input_schema,
                output_schema=output_schema,
                tags=tags,
                mutation=mutation,
                examples=examples,
                requires=requires,
                contexts=contexts,
                scopes=scopes,
                expose=expose,
                destructive=destructive,
                confirm_prompt=confirm_prompt,
                undoable=undoable,
                approval=approval,
                version=version,
                title=title,
                errors=errors,
                execution_time=execution_time,
                handoff=handoff,
                handoff_protocol=handoff_protocol,
                task=task,
                tool_meta=tool_meta,
                advertised_input_schema=advertised_input_schema,
                output_budget=output_budget,
                confirmation_mode=confirmation_mode,
                secret=secret,
                # Point a name warning at the user's @server.command line.
                _stacklevel=3,
            )(func)
            self.register(decorated)
            return decorated

        return decorator

    def register(self, func: Callable[..., Any] | CommandDefinition) -> None:
        """Register a decorated command function or :class:`CommandDefinition`.

        Raises:
            ValueError: If a callable is not decorated with ``@define_command``,
                or the command's name is one the server handles itself, as
                TypeScript's ``assertValidCommandNames`` refuses: the router's
                meta-tools (``afd-call``, ``afd-batch``, ``afd-pipe``,
                ``afd-discover``, ``afd-detail``), always; ``afd-help``,
                ``afd-docs`` and ``afd-schema`` when ``bootstrap=True``; and
                ``afd-context-list``, ``afd-context-enter`` and
                ``afd-context-exit`` when contexts are configured. Without
                those options the names are ordinary commands.
        """
        metadata: CommandMetadata | None = None
        if isinstance(func, CommandDefinition):
            if not callable(func.handler):
                raise TypeError(f"Command '{func.name}' handler must be callable")
            if (
                func.approval is not None
                and func.approval not in ("required", "not-required")
                and not callable(func.approval)
            ):
                raise TypeError(
                    f"Command '{func.name}' has an invalid approval policy: "
                    "use 'required', 'not-required' or a function"
                )
            checked_tool_meta = assert_tool_meta(func.name, func.tool_meta)
            checked_advertised = assert_advertised_input_schema(
                func.name, func.advertised_input_schema
            )
            if func.input_schema is not None:
                check_schema(func.input_schema)
            normalized_scopes = validate_command_scopes(func.name, func.scopes)
            validate_secret(func.name, getattr(func, "secret", False))
            normalized_confirmation_mode = validate_confirmation_mode(
                func.name, getattr(func, "confirmation_mode", None)
            )
            validate_task_declaration(
                func.name,
                func.task,
                confirm_prompt=func.confirm_prompt,
                approval=func.approval,
                confirmation_mode=normalized_confirmation_mode,
            )
            normalized_output_budget = validate_output_budget_declaration(
                func.name, func.output_budget
            )
            definition = dataclasses.replace(
                func,
                tool_meta=checked_tool_meta,
                advertised_input_schema=checked_advertised,
                scopes=normalized_scopes,
                confirmation_mode=normalized_confirmation_mode,
                output_budget=normalized_output_budget,
            )
            handler_func: Callable[..., Any] = definition.handler
        else:
            if not has_command_metadata(func):
                raise ValueError(f"Function {func.__name__} is not decorated with @define_command")

            converted = command_to_definition(func)
            metadata = get_command_metadata(func)
            if converted is None or metadata is None:
                raise ValueError(f"Function {func.__name__} is missing command metadata")
            definition = converted
            handler_func = func
            definition.confirmation_mode = validate_confirmation_mode(
                definition.name, getattr(definition, "confirmation_mode", None)
            )
            validate_task_declaration(
                definition.name,
                definition.task,
                confirm_prompt=definition.confirm_prompt,
                approval=definition.approval,
                confirmation_mode=definition.confirmation_mode,
            )
            definition.output_budget = validate_output_budget_declaration(
                definition.name, definition.output_budget
            )

        if definition.name in META_TOOL_NAMES:
            raise ValueError(
                f"Command name '{definition.name}' is reserved: the tool router handles "
                f"'{definition.name}' itself, so the command would be unreachable. "
                "Rename the command."
            )
        reserved = self._reserved_name_error(definition.name)
        if reserved is not None:
            raise ValueError(reserved)

        first_class = self.config.first_class_tools or []
        if definition.name in first_class and not self._is_exposed_to(definition, "mcp"):
            # The first-class set cannot change while the server runs (H2).
            raise ValueError(
                f"Command '{definition.name}' is in first_class_tools, so it must stay exposed "
                "to MCP (expose.mcp true): listing it would reveal a private command."
            )

        self._registry.register(definition)
        self._commands[definition.name] = handler_func
        if metadata is not None:
            self._metadata[definition.name] = metadata
        self._invalidate_caches()
        self._sync_mcp_tool_definitions()

    def _reserved_name_error(self, name: str) -> str | None:
        """Why ``name`` cannot be a command while its built-in is on, or ``None``."""
        if self.config.bootstrap and name in AFD_BOOTSTRAP_COMMAND_NAMES:
            return (
                f"Command name '{name}' is reserved: bootstrap=True registers a built-in "
                f"'{name}'. Rename the command, or do not register get_bootstrap_commands() "
                "output on a server that sets bootstrap=True."
            )
        if self.config.contexts and name in AFD_CONTEXT_COMMAND_NAMES:
            return (
                f"Command name '{name}' is reserved: contexts registers a built-in '{name}'. "
                "Rename the command."
            )
        return None

    def _check_reserved_names(self) -> None:
        """Refuse a registered command that has the name of a built-in that is on.

        ``register`` refuses one at once. This check, run before each tools/list and
        command call, also catches a command added through ``server.registry`` directly,
        a built-in turned on (``config.bootstrap``, ``config.contexts``) after
        registration, and a definition renamed after registration. When the options or
        the registered names have changed since the last request, the built-ins, the
        command index and the router are rebuilt, so no lookup uses a stale name.
        """
        commands = self._registry.list()
        key = (
            self.config.bootstrap,
            tuple(context.name for context in self.config.contexts or ()),
            tuple(id(command) for command in commands),
            tuple(command.name for command in commands),
            tuple(getattr(command, "confirmation_mode", None) for command in commands),
        )
        if key != self._names_key:
            self._bootstrap_commands = None
            self._invalidate_caches()
            for command in commands:
                assert_tool_meta(command.name, command.tool_meta)
                assert_advertised_input_schema(command.name, command.advertised_input_schema)
            self._names_key = key
            # A command added through server.registry is callable from now on, so the SDK
            # validates its Mcp-Param headers against its schema too.
            self._sync_mcp_tool_definitions()
        if not (self.config.bootstrap or self.config.contexts):
            return
        for command in commands:
            reserved = self._reserved_name_error(command.name)
            if reserved is not None:
                raise ValueError(reserved)

    def _check_before_request(self) -> None:
        """The registration checks that must hold before the server answers a request."""
        self._check_reserved_names()
        commands = self._registry.list()
        for command in commands:
            command.confirmation_mode = validate_confirmation_mode(
                command.name, getattr(command, "confirmation_mode", None)
            )
            command.output_budget = validate_output_budget_declaration(
                command.name, command.output_budget
            )
            command.scopes = validate_command_scopes(command.name, command.scopes)
        assert_valid_task_commands(commands)
        self._check_first_class_tools()

    def _invalidate_caches(self) -> None:
        self._command_index = None
        self._tool_lists.clear()
        self._router = None
        self._human_relay_gate = None
        self._scope_authority = None
        self._first_class_checked = False

    def _check_first_class_tools(self) -> None:
        """Check a hybrid server's first-class set against its commands (spec H2).

        Run before the server answers a request, and again after each registration.
        """
        if self._first_class_checked or self.config.tool_strategy != "hybrid":
            return
        check_first_class_tools(
            self.config.first_class_tools or [],
            self._get_command_index(),
            lambda command: self._is_exposed_to(command, "mcp"),
        )
        self._first_class_checked = True

    def _get_bootstrap_commands(self) -> list[CommandDefinition]:
        if self._bootstrap_commands is None:
            options: dict[str, Any] = {
                "get_json_schema": lambda command: (
                    command.advertised_input_schema or command.input_schema or {}
                ),
            }
            options["tool_strategy"] = self.config.tool_strategy
            if self.config.tool_strategy == "hybrid":
                options["first_class_tools"] = list(self.config.first_class_tools or [])
            if self.config.context_fields:
                options["context_fields"] = list(self.config.context_fields)
            options["include_discovery"] = self.config.bootstrap
            if self.config.contexts:
                options["get_contexts"] = self.list_contexts
                options["context_state"] = self._context_state
            # Discovery commands are served over MCP, so they only see
            # MCP-exposed commands.
            self._bootstrap_commands = get_bootstrap_commands(
                lambda: self.list_exposed_commands(
                    interface="mcp", include_bootstrap=True, context_filtered=True
                ),
                options=options,
            )
        return list(self._bootstrap_commands)

    def _get_command_index(self) -> dict[str, CommandDefinition]:
        """Name -> definition for registered and bootstrap commands (cached)."""
        if self._command_index is None:
            index = {command.name: command for command in self._get_bootstrap_commands()}
            # No registered command has the name of a built-in that is on: register() and
            # _check_reserved_names(), run before each request, refuse one.
            index.update({command.name: command for command in self._registry.list()})
            self._command_index = index
        return self._command_index

    def list_commands(
        self,
        *,
        include_bootstrap: bool = False,
        context_filtered: bool = False,
    ) -> list[CommandDefinition]:
        """List registered commands."""

        commands = list(self._registry.list())
        if include_bootstrap:
            commands.extend(self._get_bootstrap_commands())
        if context_filtered:
            active_context = self._context_state.get_active()
            commands = [command for command in commands if _in_context(command, active_context)]
        return commands

    def _find_command(
        self,
        name: str,
        *,
        include_bootstrap: bool = True,
        context_filtered: bool = False,
    ) -> CommandDefinition | None:
        command = (
            self._get_command_index().get(name) if include_bootstrap else self._registry.get(name)
        )
        if command is None:
            return None
        if context_filtered and not _in_context(command, self._context_state.get_active()):
            return None
        return command

    def _is_exposed_to(self, command: CommandDefinition, interface: Any) -> bool:
        # An unknown interface exposes nothing, and is never looked up as an attribute.
        if interface not in ("palette", "mcp", "agent", "cli", "apps"):
            return False
        expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
        return bool(getattr(expose, interface, False))

    def list_exposed_commands(
        self,
        *,
        interface: str = "mcp",
        include_bootstrap: bool = True,
        context_filtered: bool = False,
    ) -> list[CommandDefinition]:
        """List commands exposed on a specific interface."""

        return [
            command
            for command in self.list_commands(
                include_bootstrap=include_bootstrap,
                context_filtered=context_filtered,
            )
            if self._is_exposed_to(command, interface)
        ]

    def _prepare_command(
        self,
        name: str,
        input: Any,
        context: CommandContext,
        *,
        check_before_request: bool = False,
        meta_tools: bool = False,
    ) -> tuple[CommandDefinition, Any] | CommandResult[Any]:
        """Check a call before any middleware runs.

        Lookup (with a "did you mean" suggestion), exposure, active context and
        input validation, in the order of ``packages/server/src/execution.ts``.
        Returns the command and the validated input that the middleware chain
        and the handler receive, or the failure that rejects the call.
        """
        interface = context.extra.get("interface") if context.extra else None
        active_context = self._context_state.get_active()
        view = scope_view_of(context)

        # App-to-app calls (spec/command-metadata.md, "App-to-app calls"): check
        # existence, expose.apps and call_grant FIRST, before configuration
        # preflight, allow, lookup suggestions, active context, input validation,
        # context fields and middleware.
        if interface == "apps":
            command = self._registry.get(name)
            if command is not None and view is not None and not view.known(command.name):
                command = None
            if not app_call_granted(command, name, context, self.config.call_grant):
                return failure(call_not_granted())
            if check_before_request:
                self._check_before_request()

        if not _is_allowed(context, name):
            return failure(_not_allowed(name))

        command = self._find_command(name)
        # A remote caller (the MCP router) gets the unknown-command answer for a
        # command hidden from it, so it cannot learn that the command exists
        # (spec/error-codes.md, D4; spec/authorization.md, M6).
        remote = bool(context.extra.get("remote")) if context.extra else False
        if command is not None and (
            (remote and not self._is_exposed_to(command, interface))
            or (view is not None and not view.known(command.name))
        ):
            command = None
        if command is None:
            # Only names the caller could call: a few close matches, never the
            # whole list, and never a command hidden from this interface or scope view.
            callable_names = [
                candidate.name
                for candidate in self._get_command_index().values()
                if _in_context(candidate, active_context)
                and _is_allowed(context, candidate.name)
                and (not interface or self._is_exposed_to(candidate, interface))
                and (view is None or view.shown(candidate.name))
            ]
            return command_not_found(
                name,
                callable_names,
                not_found_guide(
                    self, context, active_context, remote=remote, meta_tools=meta_tools
                ),
            )

        # An unknown interface exposes nothing, as in TypeScript's isExposedTo.
        if (
            interface is not None
            and interface != ""
            and not self._is_exposed_to(command, interface)
        ):
            return error(
                "COMMAND_NOT_EXPOSED",
                f"Command '{command.name}' is not exposed to {interface}",
                suggestion=(
                    "Call it from an interface it is exposed to, or set "
                    f"expose.{interface} to true in its definition"
                ),
                retryable=False,
                recovery=Recovery(kind="external"),
            )

        if not _in_context(command, active_context):
            return not_in_context_error(
                command.name,
                active_context,
                can=lambda name: can_call(self, name, context, active_context),
                belongs_to=command.contexts,
            )

        metadata = get_command_metadata(command.handler)
        input_schema = metadata.input_schema if metadata is not None else command.input_schema
        try:
            data = validate_command_input(
                input_schema, input, max_issues=self._max_validation_issues
            )
        except (PydanticValidationError, SchemaValidationError) as exc:
            if input_schema is None:
                raise
            return _input_validation_failure(
                input_schema,
                {} if input is None else input,
                exc,
                max_issues=self._max_validation_issues,
            )
        except Exception as exc:
            # A validator that raises something other than ValueError or
            # AssertionError: the input is still what failed, as in TypeScript.
            logger.error("Input validation for '%s' raised", command.name, exc_info=exc)
            return error(
                "VALIDATION_ERROR",
                "Input validation failed",
                suggestion=(
                    f"Input validation threw: {exc}"
                    if self.config.dev_mode
                    else f"Check the input against the input schema of '{command.name}' "
                    "(afd-detail returns it) and retry"
                ),
            )
        return command, data

    async def _validate_for_execution(
        self,
        command: CommandDefinition,
        input: Any,
        context: CommandContext,
    ) -> tuple[bool, Any]:
        metadata = get_command_metadata(command.handler)
        input_schema = metadata.input_schema if metadata is not None else command.input_schema
        try:
            data = validate_command_input(
                input_schema, input, max_issues=self._max_validation_issues
            )
        except (PydanticValidationError, SchemaValidationError) as exc:
            if input_schema is None:
                raise
            return (
                False,
                _input_validation_failure(
                    input_schema,
                    {} if input is None else input,
                    exc,
                    max_issues=self._max_validation_issues,
                ),
            )
        except Exception as exc:
            logger.error("Input validation for '%s' raised", command.name, exc_info=exc)
            return (
                False,
                error(
                    "VALIDATION_ERROR",
                    "Input validation failed",
                    suggestion=(
                        f"Input validation threw: {exc}"
                        if self.config.dev_mode
                        else f"Check the input against the input schema of '{command.name}' "
                        "(afd-detail returns it) and retry"
                    ),
                ),
            )

        prevalidated = take_relay_validated_input(context, command.name)
        if prevalidated is not None:
            data = prevalidated[0]

        up_front = current_up_front_approval()
        approved = None if up_front is None else await up_front.validated(command.name, input)
        if approved is not None:
            refused = check_approved_at_run(
                command.name, input_schema, approved[0], self._max_validation_issues
            )
            if refused is not None:
                return False, refused
            data = approved[0]
        return True, data

    def _post_validate_for_execution(
        self,
        command: CommandDefinition,
        data: Any,
        context: CommandContext,
    ) -> CommandResult[Any] | None:
        view = scope_view_of(context)
        if view is not None:
            exec_input = _validated_input_for_resolver(data) if view.has_resolver else None
            exec_decision = view.decide_execution(command.name, exec_input)
            if exec_decision != "proceed":
                return failure(view.insufficient_scope(exec_decision.forbidden))
        if take_relay_context_validated(context):
            if self.config.context_fields:
                journaled = tuple(
                    declared.name for declared in self.config.context_fields if declared.journal
                )
                with suppress(AttributeError, TypeError):
                    setattr(context, JOURNALED_CONTEXT_FIELDS, journaled)
            return None
        return apply_context_fields(
            self.config.context_fields, context, command.name, dev_mode=self.config.dev_mode
        )

    def _is_hidden_for_execution(
        self,
        command: CommandDefinition,
        context: CommandContext,
    ) -> bool:
        interface = context.extra.get("interface") if context.extra else None
        remote = bool(context.extra.get("remote")) if context.extra else False
        view = scope_view_of(context)
        if interface == "apps":
            return view is not None and not view.known(command.name)
        return (remote and not self._is_exposed_to(command, interface)) or (
            view is not None and not view.known(command.name)
        )

    def _is_shown_for_execution(
        self,
        command: CommandDefinition,
        context: CommandContext,
    ) -> bool:
        view = scope_view_of(context)
        return view is None or view.shown(command.name)

    @contextmanager
    def _context_scope_for_execution(
        self, caller_context: CommandContext | None, exec_context: CommandContext
    ) -> Iterator[None]:
        if caller_context is not None:
            transfer_relay_state(caller_context, exec_context)
        try:
            yield
        finally:
            clear_relay_state(exec_context)

    @contextmanager
    def _admission_scope_for_execution(
        self, context: CommandContext, command: CommandDefinition
    ) -> Iterator[tuple[Admission, RelayDispatchAdmission | None]]:
        relay_dispatch = pop_relay_dispatch_admission(context)
        with (
            bind_human_relay_channel(None),
            bind_relay_wire(None),
            admission_for(context, command) as record,
        ):
            yield record, relay_dispatch

    def _check_admission_for_execution(
        self,
        admission_tuple: tuple[Admission, RelayDispatchAdmission | None],
        command: CommandDefinition,
        data: Any,
    ) -> CommandResult[Any] | None:
        record, relay_dispatch = admission_tuple
        if relay_dispatch is not None and relay_dispatch.consume(command.name, data) == "mismatch":
            return _approval_unavailable(command.name, "mismatch")
        if admission_required(record, getattr(command, "approval", None)):
            admission = take_admission(record, command.name, data)
            if admission != "admitted":
                return _approval_unavailable(command.name, admission)
        return None

    async def _invoke_handler_for_execution(
        self, command: CommandDefinition, data: Any, context: CommandContext
    ) -> Any:
        clear_relay_evidence(context)
        handler = getattr(command.handler, "__afd_validated_handler__", command.handler)
        # The shared executor coerces what this returns (#1760).
        return await handler(data, context)

    def _internal_error(self, command_name: str, exc: BaseException) -> CommandResult[Any]:
        """Log an unexpected exception and return a failure that is safe to send remotely.

        The exception text is only returned when ``dev_mode`` is enabled.
        """
        logger.error(
            "Command '%s' raised an unhandled exception",
            command_name,
            exc_info=exc,
        )
        return execution_failure(exc, self.config.dev_mode)

    def _as_command_result(self, command_name: str, result: Any) -> CommandResult[Any]:
        """Coerce what a command or its middleware returned (see coerce_command_result).

        A dict with a boolean ``success`` is parsed; anything else that is not a
        CommandResult becomes an ``INVALID_COMMAND_RESULT`` failure.
        """
        if isinstance(result, CommandResult):
            return result
        logger.warning(
            "Command '%s' returned %s instead of a CommandResult",
            command_name,
            type(result).__name__,
        )
        return coerce_command_result(result, command_name)

    async def _execute_command(
        self,
        name: str,
        input: Any,
        context: CommandContext | None = None,
        *,
        output_budget: Any = None,
        _check_before_request: bool = False,
        _meta_tools: bool = False,
    ) -> CommandResult[Any]:
        """Run a command (never a built-in tool) through the shared single-command executor.

        ``_meta_tools`` says the caller's entry point also routes the meta-tools, as ``execute``
        does outside ``apps``.

        Always a CommandResult: a handler's or middleware's raw return value is coerced the
        same way for a single call, a batch item, a pipeline step and a stream
        (``spec/error-codes.md``, ``INVALID_COMMAND_RESULT``).
        """
        remote = (
            bool(context.extra.get("remote")) if context is not None and context.extra else False
        )
        config = CommandExecutionConfig(
            lookup=self._find_command,
            lookup_apps=self._registry.get,
            list_commands=lambda: list(self._get_command_index().values()),
            middleware=self._middleware,
            dev_mode=self.config.dev_mode,
            call_grant=self.config.call_grant,
            context_defaults=ContextDefaults(clock=self.config.clock, random=self.config.random),
            default_timeout_ms=self._default_timeout_ms,
            logger=logger,
            stamp_metadata=True,
            context_scope=self._context_scope_for_execution,
            before_request=self._check_before_request if _check_before_request else None,
            active_context_getter=lambda _ctx: self._context_state.get_active(),
            is_hidden=self._is_hidden_for_execution,
            is_shown=self._is_shown_for_execution,
            not_found_builder=lambda unknown, names: command_not_found(
                unknown,
                names,
                not_found_guide(
                    self,
                    context,
                    self._context_state.get_active(),
                    remote=remote,
                    meta_tools=_meta_tools,
                ),
            ),
            validate_input=self._validate_for_execution,
            post_validate=self._post_validate_for_execution,
            admission_scope=self._admission_scope_for_execution,
            check_admission=self._check_admission_for_execution,
            invoke_handler=self._invoke_handler_for_execution,
            after_execute=self._refresh_dynamic_tools,
        )
        result = await execute_command(
            name,
            input,
            context,
            config=config,
            output_budget=output_budget,
        )
        # Already a CommandResult: the shared executor coerces a handler's or a middleware's
        # plain value (afd.core.single_executor, #1760). This only keeps the type exact.
        return self._as_command_result(name, result)

    async def execute(
        self,
        name: str,
        input: Any,
        context: CommandContext | None = None,
        *,
        output_budget: Any = None,
    ) -> Any:
        """Execute a command or built-in tool by name."""

        interface = (
            context.extra.get("interface") if context is not None and context.extra else None
        )
        if interface == "apps":
            return await self._execute_command(
                name,
                input,
                context,
                output_budget=output_budget,
                _check_before_request=True,
            )
        self._check_before_request()
        if name in META_TOOL_NAMES:
            meta_keys = meta_argument_keys(self.config.context_fields)
            lifted = lift_meta_argument(name, input, None, meta_keys)
            if lifted.error is not None:
                return failure(lifted.error)
            # Trusted in-process option / context wins over meta argument (B2).
            explicit_ask: Any = None
            if output_budget is not None:
                explicit_ask = normalize_ask_option(output_budget)
            elif context is not None:
                ctx_ask = getattr(context, "_output_budget_ask", None)
                if ctx_ask is not None:
                    explicit_ask = ctx_ask
                elif getattr(context, "output_budget", None) is not None:
                    explicit_ask = normalize_ask_option(context.output_budget)
            budget_ask = (
                explicit_ask
                if explicit_ask is not None
                else output_budget_ask_from_meta(lifted.meta)
            )
            field_values = context_field_values(self.config.context_fields, lifted.meta)
            with (
                bind_context_field_values(field_values),
                bind_output_budget_ask(budget_ask),
            ):
                return await self.route_tool_call(name, lifted.arguments, caller_context=context)
        return await self._execute_command(
            name, input, context, output_budget=output_budget, _meta_tools=True
        )

    def _refresh_dynamic_tools(self, name: str, result: Any) -> None:
        """Refresh caches and live MCP tools after context-changing commands."""

        if name in _CONTEXT_COMMAND_NAMES and isinstance(result, CommandResult) and result.success:
            self._router = None
            # The shared FastMCP registry stays complete; tools/list filters per session.

    def _advertise_fixed_tools_list(self) -> None:
        """Report ``capabilities.tools.listChanged`` as false, as the spec says (H6).

        No AFD server sends ``notifications/tools/list_changed``, but the SDK derives the flag
        from the methods it serves (``subscriptions/listen`` on 2026-07-28), which would
        promise a notification that never comes.
        """
        lowlevel = lowlevel_server(self._mcp_server)
        if lowlevel is None:
            return
        # SDK internal GET_CAPABILITIES (afd.server.sdk_internals).
        get_capabilities = getattr(lowlevel, "get_capabilities", None)
        if get_capabilities is None or getattr(lowlevel, "_afd_fixed_tools_list", False):
            return

        def fixed(*args: Any, **kwargs: Any) -> Any:
            capabilities = get_capabilities(*args, **kwargs)
            updates: dict[str, Any] = {}
            if capabilities.tools is not None:
                updates["tools"] = capabilities.tools.model_copy(update={"list_changed": False})
            if capabilities.prompts is not None:
                updates["prompts"] = None
            if capabilities.resources is not None:
                updates["resources"] = capabilities.resources.model_copy(
                    update={"subscribe": False, "list_changed": False}
                )
            if updates:
                capabilities = capabilities.model_copy(update=updates)
            req_ctx = _CURRENT_REQUEST.get()
            protocol_version = kwargs.get("protocol_version")
            if protocol_version is None and req_ctx is not None:
                protocol_version = getattr(req_ctx, "protocol_version", None)
            if is_modern_protocol(protocol_version) and self._task_runtime.declares_tasks_for(
                req_ctx
            ):
                exts = dict(capabilities.extensions or {})
                exts[TASKS_EXTENSION_ID] = {}
                capabilities = capabilities.model_copy(update={"extensions": exts})
            elif capabilities.extensions and TASKS_EXTENSION_ID in capabilities.extensions:
                exts = {
                    key: value
                    for key, value in capabilities.extensions.items()
                    if key != TASKS_EXTENSION_ID
                }
                capabilities = capabilities.model_copy(update={"extensions": exts or None})
            return capabilities

        lowlevel.get_capabilities = fixed
        lowlevel._afd_fixed_tools_list = True

    def _advertise_context_fields(self) -> None:
        """List the declared context fields in ``server/discover`` (``spec/context-fields.md``).

        The SDK answers ``server/discover`` with the low-level server's registered handler
        (by default ``Server._handle_discover``, derived from server state per request). This
        wraps that entry, through the SDK's own ``get_request_handler`` and
        ``add_request_handler``, and adds ``_meta["dev.afd/context-fields"]`` to its result.
        ``tests/test_context_fields_mcp.py`` fails if an SDK upgrade serves discover another way.
        """
        if not self.config.context_fields:
            return
        lowlevel = lowlevel_server(self._mcp_server)
        if lowlevel is None:
            return
        get_handler = getattr(lowlevel, "get_request_handler", None)
        entry = get_handler("server/discover") if get_handler is not None else None
        if entry is None or getattr(lowlevel, "_afd_context_fields_discover", False):
            return
        described = describe_context_fields(self.config.context_fields)
        discover = entry.handler

        async def discover_with_fields(ctx: Any, params: Any) -> Any:
            result = await discover(ctx, params)
            # A copy per answer, so a response never aliases the server's description.
            listed = {AFD_CONTEXT_FIELDS_META_KEY: copy.deepcopy(described)}
            if isinstance(result, BaseModel):
                meta = getattr(result, "meta", None)
                return result.model_copy(update={"meta": {**(meta or {}), **listed}})
            if isinstance(result, Mapping):
                meta = result.get("_meta")
                return {
                    **result,
                    "_meta": {**(meta if isinstance(meta, Mapping) else {}), **listed},
                }
            return result

        lowlevel.add_request_handler("server/discover", entry.params_type, discover_with_fields)
        lowlevel._afd_context_fields_discover = True

    async def _call_sdk_tool(self, name: str, arguments: Any, afd_ctx: Any) -> Any:
        """Answer the SDK's ``tools/call`` for ``name``: every tool name, listed or not.

        A command hidden by the active context gets the actionable not-in-context error;
        everything else goes through :meth:`_serve_tool_call`, so unknown and private names
        share the D4 result and a command the strategy does not list (every command under
        grouped or lazy) runs with the same confirmation and approval rounds as its own tool
        (``spec/tool-strategies.md``, "Routing"). The SDK's own tool manager is never used.
        """
        payload = dict(arguments) if isinstance(arguments, Mapping) else {}
        try:
            if name not in self._sdk_tool_schemas and self._current_scope_view() is None:
                active_context = self._context_state.get_active()
                registered = self._find_command(
                    name, include_bootstrap=True, context_filtered=False
                )
                visible = self._find_command(name, include_bootstrap=True, context_filtered=True)
                if (
                    active_context
                    and registered is not None
                    and self._is_exposed_to(registered, "mcp")
                    and visible is None
                    and registered.contexts
                    and active_context not in registered.contexts
                ):
                    return _tool_call_result(
                        not_in_context_error(
                            name,
                            active_context,
                            can=lambda tool: can_call(
                                self, tool, None, active_context, interface="mcp"
                            ),
                            belongs_to=registered.contexts,
                        )
                    )
            return await self._serve_tool_call(name, payload, afd_ctx)
        except Exception as exc:
            if _is_mcp_error(exc):
                raise
            return _tool_call_result(self._internal_error(name, exc))

    # ── Batch, pipeline and stream (shared core executors) ─────────────────

    async def _run_apps_isolated(
        self, command_name: str, input: Any, context: CommandContext
    ) -> CommandResult[Any]:
        """Run one batch item or stream command with app-grant-before-preflight ordering."""
        try:
            result = await self._execute_command(
                command_name, input, context, _check_before_request=True
            )
        except Exception as exc:
            result = self._internal_error(command_name, exc)
        return self._as_command_result(command_name, result)

    async def execute_batch(
        self,
        request: Any,
        context: CommandContext | None = None,
    ) -> BatchResult[Any]:
        """Run a batch with partial-success semantics through the shared core executor."""
        raw_extra = getattr(context, "extra", None)
        interface = raw_extra.get("interface") if isinstance(raw_extra, Mapping) else None
        if interface != "apps":
            self._check_before_request()
            runner = self._run_isolated
        else:
            runner = self._run_apps_isolated
        return await execute_batch(
            request,
            context,
            run_command=runner,
            max_batch_size=self.config.max_batch_size,
            max_batch_parallelism=self.config.max_batch_parallelism,
            dev_mode=self.config.dev_mode,
        )

    async def _execute_batch(
        self,
        request: Any,
        context: CommandContext | None = None,
    ) -> BatchResult[Any]:
        """Run a batch with partial-success semantics (see ``execute_batch``)."""
        return await self.execute_batch(request, context)

    def execute_stream(
        self,
        name: str,
        input: Any,
        options: StreamOptions | None = None,
        context: CommandContext | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Run a command through this server's executor and stream its result chunks."""
        raw_extra = getattr(context, "extra", None)
        interface = raw_extra.get("interface") if isinstance(raw_extra, Mapping) else None
        if interface != "apps":
            self._check_before_request()
            runner = self._run_isolated
        else:
            runner = self._run_apps_isolated
        timeout = options.timeout if options is not None else None
        return _execute_core_stream(
            name,
            input,
            runner,
            context,
            StreamExecutorOptions(dev_mode=self.config.dev_mode, timeout=timeout),
        )

    async def _execute_pipeline(
        self,
        request: Any,
        context: CommandContext | None = None,
    ) -> PipelineResult[Any]:
        """Run a pipeline of commands (see ``execute_pipeline_request``)."""
        return await execute_pipeline_request(
            request, context, run_command=self._run_isolated, dev_mode=self.config.dev_mode
        )

    async def _run_isolated(
        self, command_name: str, input: Any, context: CommandContext
    ) -> CommandResult[Any]:
        """Run one batch command or pipeline step. Never raises, except when cancelled."""
        try:
            result = await self._execute_command(command_name, input, context)
        except Exception as exc:
            result = self._internal_error(command_name, exc)
        return self._as_command_result(command_name, result)

    # ── Tool routing ───────────────────────────────────────────────────────

    def _get_human_relay_gate(self, commands: list[CommandDefinition]) -> HumanRelayGate:
        if self._human_relay_gate is None:
            self._human_relay_gate = HumanRelayGate(
                self.config.human_relay,
                commands,
                actor=self.config.actor or Actor(kind="agent"),
                dev_mode=self.config.dev_mode,
                context_fields=self.config.context_fields,
                clock=self.config.clock,
                max_validation_issues=self._max_validation_issues,
                has_auth_layer=self._auth_layer is not None,
                lookup_command=lambda name: self._find_command(name),
            )
        return self._human_relay_gate

    def _get_router(self) -> Callable[..., Awaitable[Any]]:
        """The tool router, built once and rebuilt after register() or a context change."""
        self._check_before_request()
        if self._router is None:
            commands = self.list_exposed_commands(
                interface="mcp", include_bootstrap=True, context_filtered=False
            )
            self._router = create_tool_router(
                ToolRouterDeps(
                    execute_command=self._execute_command,
                    execute_batch=self._execute_batch,
                    execute_pipeline=self._execute_pipeline,
                    commands=commands,
                    tool_strategy=self.config.tool_strategy,
                    group_by_fn=self.config.group_by,
                    # Only MCP-exposed commands are visible to MCP routing and
                    # discovery (afd-call, afd-detail), as in the TS server.
                    all_commands=commands,
                    exposed_command_names={command.name for command in commands},
                    context_state=self._context_state,
                    actor=self.config.actor or Actor(kind="agent"),
                    confirmations=ConfirmationGate(self._confirmations, commands),
                    human_relay=self._get_human_relay_gate(commands),
                    can_run=self._step_can_run,
                    validate_step=self._validate_step,
                    dispatch_task=self._task_runtime.dispatch_command,
                    refuse_composite_task=composite_task_error,
                    get_admitted_credentials=self._current_admitted_credentials,
                    get_scope_view=self._current_scope_view,
                    max_batch_size=self.config.max_batch_size,
                    max_batch_parallelism=self.config.max_batch_parallelism,
                )
            )
        return self._router

    def _step_context(self) -> CommandContext:
        # No actor: validation does not read it, and a step that validates differently when it
        # runs fails closed (it was not asked about, so it is held).
        return CommandContext(
            extra={"interface": "mcp", "remote": True},
            _scope_view=self._current_scope_view(),
        )

    def _step_can_run(self, name: str) -> bool:
        """Whether an MCP caller can run ``name`` (for the up-front approval of ``afd-pipe``)."""
        view = self._current_scope_view()
        if view is not None and not view.known(name):
            return False
        command = self._find_command(name)
        return (
            command is not None
            and self._is_exposed_to(command, "mcp")
            and _in_context(command, self._context_state.get_active())
        )

    def _validate_step(self, name: str, input: Any) -> tuple[bool, Any]:
        """One step's validated input, as the step will run it (for the up-front approval of
        ``afd-batch`` and ``afd-pipe``)."""
        prepared = self._prepare_command(name, input, self._step_context())
        if isinstance(prepared, CommandResult):
            return False, None
        return True, prepared[1]

    def _create_router(self) -> Callable[[str, Any], Any]:
        """Compatibility alias for :meth:`_get_router`."""
        return self._get_router()

    async def route_tool_call(
        self,
        tool_name: str,
        args: Any = None,
        *,
        caller_context: CommandContext | None = None,
    ) -> Any:
        """Route a tool call through the shared tool router."""

        refused = refuse_apps_tool_call(tool_name, caller_context)
        if refused is not None:
            return refused
        return await self._get_router()(tool_name, {} if args is None else args, caller_context)

    async def call_tool(self, tool_name: str, args: Any = None) -> Any:
        """Compatibility wrapper for invoking an MCP-visible tool directly."""

        return await self.route_tool_call(tool_name, {} if args is None else args)

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Return the MCP-visible tool definitions for the current strategy.

        Each call returns its own copy, which the caller may change.
        """

        copied: list[dict[str, Any]] = _copy_json(self._tool_list().definitions)
        return copied

    def _tool_list(self) -> _ToolList:
        """The tool list this request sees, built once per strategy, context and commands.

        Building a tool list copies every command's input schema and, under ``grouped``,
        measures each group's schemas, so ``tools/list`` reuses the list it built for the same
        strategy, active context and listed commands (#1760). Registering a command, a change
        to the registered names or built-ins, or a change to these options builds it again.
        A registered definition is read once: changing one in place (its description, schema
        or contexts) is not seen until the list is built again, so register a new definition
        instead.
        """
        self._check_before_request()
        exposed = self.list_exposed_commands(
            interface="mcp", include_bootstrap=True, context_filtered=False
        )
        listed = listed_commands(exposed, self._current_scope_view())
        active_context = self._context_state.get_active()
        first_class = self.config.first_class_tools
        key = (
            tuple((id(command), command.name) for command in listed),
            self.config.tool_strategy,
            # By identity: the config holds it, and a callable object need not be hashable.
            id(self.config.group_by),
            active_context,
            self._confirmations,
            tuple(first_class) if first_class is not None else None,
            self.config.advertise_output_schema,
        )
        cached = self._tool_lists.get(key)
        if cached is None or cached.group_by is not self.config.group_by:
            if len(self._tool_lists) >= _MAX_TOOL_LISTS:
                self._tool_lists.clear()
            cached = _ToolList(
                get_tools_list(
                    listed,
                    self.config.tool_strategy,
                    group_by_fn=self.config.group_by,
                    active_context=active_context,
                    confirmations=self._confirmations,
                    first_class_tools=first_class,
                    output_schema=self.config.advertise_output_schema,
                ),
                self.config.group_by,
            )
            self._tool_lists[key] = cached
        return cached

    def get_mcp_tools(self) -> list[dict[str, Any]]:
        """Compatibility wrapper returning current MCP-visible tool definitions."""

        return self.get_tool_definitions()

    def _sync_mcp_tool_definitions(self) -> None:
        """Record the input schema of every tool any session may list.

        The SDK validates a 2026-07-28 HTTP request's ``Mcp-Param`` headers against the called
        tool's input schema before any middleware runs, so this is the whole list, in no
        context (``SessionMCPServer._tool_input_schema`` reads it). AFD does not register its
        tools with the SDK's tool manager: ``tools/list`` and ``tools/call`` are answered by
        ``SessionMCPServer`` itself (#1756). It is rebuilt at ``register()`` and, for a command
        added through ``server.registry``, at the next request's checks: the SDK reads it
        before those run, so that request's headers are checked against the previous table.
        """

        if not self._mcp_server:
            return
        # Session context must never narrow what every session may call.
        definitions = get_tools_list(
            self.list_exposed_commands(interface="mcp", include_bootstrap=True),
            self.config.tool_strategy,
            group_by_fn=self.config.group_by,
            active_context=None,
            confirmations=self._confirmations,
            first_class_tools=self.config.first_class_tools,
            output_schema=self.config.advertise_output_schema,
        )
        self._sdk_tool_schemas = {
            **self._extra_tool_schemas,
            **{
                definition["name"]: definition.get(
                    "inputSchema", {"type": "object", "properties": {}}
                )
                for definition in definitions
            },
        }

    def _add_tool_input_schemas(self, definitions: Sequence[Mapping[str, Any]]) -> None:
        """Validate Mcp-Param headers for tools served beside AFD's own.

        For a host that answers more tool names on the SDK server than AFD lists (Botcore's
        compatibility aliases): each definition's ``inputSchema`` is kept across
        re-registration, and AFD's own tools win a name both have.
        """
        for definition in definitions:
            schema = definition.get("inputSchema")
            self._extra_tool_schemas[str(definition["name"])] = (
                dict(schema) if isinstance(schema, Mapping) else {"type": "object"}
            )
        self._sync_mcp_tool_definitions()

    async def _serve_tool_call(self, tool_name: str, payload: dict[str, Any], afd_ctx: Any) -> Any:
        """Answer one SDK ``tools/call``: its result, or the next question.

        The SDK request decides how the call can be confirmed and whether its approval can be
        asked (``afd.server.elicitation``). When the approval middleware held the call for the
        human, a 2026-07-28 request is answered with ``input_required``; a 2025 connection is
        asked in band, and the call runs again with the answer.
        """
        try:
            round = (
                ElicitationRound(afd_ctx, self._stateless_http, _CURRENT_REQUEST.get())
                if afd_ctx is not None
                else None
            )
        except ValueError:
            # The SDK's own call_tool, outside any request: nothing can be asked.
            round = None
        if round is None:
            # Nothing an enclosing call bound may answer for this one.
            with (
                bind_confirmation_channel(None),
                bind_approval_relay(None),
                bind_human_relay_channel(None),
            ):
                result = await self.route_tool_call(tool_name, payload)
                if is_created_task_sentinel(result):
                    from mcp.types import CallToolResult

                    return CallToolResult(content=[])
                return _tool_call_result(result)
        relay_channel = HumanRelayChannel.from_sdk(afd_ctx, _CURRENT_REQUEST.get())
        for _ in range(MAX_IN_BAND_ROUNDS):
            relay = round.relay() if round.can_elicit else None
            with (
                bind_confirmation_channel(round),
                bind_approval_relay(relay),
                bind_human_relay_channel(relay_channel),
            ):
                result = await self.route_tool_call(tool_name, payload)
            if _is_input_required(result):
                return result
            if is_created_task_sentinel(result):
                from mcp.types import CallToolResult

                return CallToolResult(content=[])
            held = relay.held if relay is not None else None
            if held is None:
                return _tool_call_result(result)
            if round.modern:
                return round.ask_approval(held)
            if not await round.ask_in_band(held):
                return _tool_call_result(_unanswered_approval(tool_name))
        return _tool_call_result(_unanswered_approval(tool_name))

    def _create_mcp_server(self) -> Any:
        """Create the underlying MCP SDK server (``mcp.server.mcpserver.MCPServer``)."""

        try:
            from mcp.server import CacheHint
            from mcp.server.mcpserver import MCPServer as SdkMCPServer
            from mcp.server.request_state import RequestStateSecurity
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise ImportError("mcp not installed. Install with: pip install afd[server]") from exc

        self._check_before_request()
        server = self
        context_names = {item.name for item in self.config.contexts}
        ttl_ms = self.config.tools_list_ttl_ms
        if ttl_ms is None:
            # With contexts, tools/list varies by _meta["dev.afd/context"], which SDK
            # clients leave out of their cache key, so the default is "always stale". The
            # hybrid and lazy lists never vary by context (H4, #533), so they keep the default.
            varies = bool(self.config.contexts) and self.config.tool_strategy not in (
                "hybrid",
                "lazy",
            )
            ttl_ms = 0 if varies else DEFAULT_TOOLS_LIST_TTL_MS
        if isinstance(ttl_ms, bool) or not isinstance(ttl_ms, int) or ttl_ms < 0:
            raise ValueError("tools_list_ttl_ms must be a non-negative integer")
        tools_list_scope: Literal["public", "private"] = (
            "private"
            if self._auth_layer is not None and self._auth_layer.filter_tools_by_scope
            else "public"
        )
        hint = CacheHint(ttl_ms=ttl_ms, scope=tools_list_scope)
        # When task advertisement can vary by verified credentials on HTTP, discovery must
        # not be cached publicly across anonymous and authenticated callers.
        discover_hint = (
            CacheHint(ttl_ms=ttl_ms, scope="private")
            if self._task_runtime.serves_tasks and not self._task_runtime._hook_identifies_callers
            else CacheHint(ttl_ms=ttl_ms, scope="public")
        )

        @asynccontextmanager
        async def _server_lifespan(_app: Any) -> AsyncIterator[dict[str, Any]]:
            try:
                yield {}
            finally:
                server.stop_tasks()

        async def capture_request(ctx: Any, call_next: Any) -> Any:
            token = _CURRENT_REQUEST.set(ctx)
            try:
                result = await call_next(ctx)
                # S1: declare `io.modelcontextprotocol/skills` in `initialize` capabilities on
                # the 2025 era too (the SDK's 2025-11-25 wire sieve strips `extensions` inside
                # `_inner`, before returning to middleware).
                if (
                    getattr(ctx, "method", None) == "initialize"
                    and server._resource_service is not None
                    and server._resource_service.has_skills
                    and isinstance(result, Mapping)
                    and isinstance(result.get("capabilities"), Mapping)
                ):
                    caps = dict(result["capabilities"])
                    exts = dict(caps.get("extensions") or {})
                    exts[SKILLS_EXTENSION_ID] = server._resource_service.skills_extension_settings()
                    caps["extensions"] = exts
                    return {**result, "capabilities": caps}
                return result
            finally:
                _CURRENT_REQUEST.reset(token)

        meta_keys = meta_argument_keys(self.config.context_fields)

        @contextmanager
        def bound_request(**meta: Any) -> Iterator[None]:
            try:
                with server._context_state.bind(
                    _CURRENT_REQUEST.get(),
                    stateless=server._stateless_http,
                    contexts=context_names,
                    **meta,
                ):
                    yield
            except UnknownContextError as exc:
                from mcp import MCPError
                from mcp.types import INVALID_PARAMS

                raise MCPError(
                    INVALID_PARAMS,
                    str(exc),
                    {"suggestion": f"Use one of: {', '.join(sorted(context_names))}"},
                ) from exc

        class SessionMCPServer(SdkMCPServer):
            def streamable_http_app(self, **options: Any) -> Any:
                warn_instances_once(server._instances_http_warning)
                app = super().streamable_http_app(**options)
                if server._auth_layer is not None:
                    return server._auth_layer.wrap_asgi_app(
                        app,
                        max_body_bytes=options.get("max_request_body_size"),
                        decide_post_body=True,
                    )
                return app

            def sse_app(self, **options: Any) -> Any:
                warn_instances_once(server._instances_http_warning)
                app = super().sse_app(**options)
                if server._auth_layer is not None:
                    return server._auth_layer.wrap_asgi_app(
                        app,
                        max_body_bytes=options.get("max_request_body_size"),
                        decide_post_body=False,
                    )
                return app

            async def run_stdio_async(self) -> None:
                with bind_trusted_transport(server._auth_layer):
                    await super().run_stdio_async()

            async def run_sse_async(
                self, *, host: str = "127.0.0.1", port: int = 8000, **options: Any
            ) -> None:
                warn_instances_once(server._instances_http_warning)
                if server._auth_layer is None:
                    await super().run_sse_async(host=host, port=port, **options)
                    return
                import uvicorn

                starlette_app = self.sse_app(host=host, **options)
                # Disable Uvicorn access logs when auth is configured so raw query strings
                # (e.g. a rejected `?access_token=...`) are never written to logs (M2/M5).
                config = uvicorn.Config(
                    starlette_app,
                    host=host,
                    port=port,
                    log_level=self.settings.log_level.lower(),
                    access_log=False,
                )
                uvicorn_server = uvicorn.Server(config)
                await uvicorn_server.serve()

            async def run_streamable_http_async(
                self, *, host: str = "127.0.0.1", port: int = 8000, **options: Any
            ) -> None:
                warn_instances_once(server._instances_http_warning)
                if server._auth_layer is None:
                    await super().run_streamable_http_async(host=host, port=port, **options)
                    return
                import uvicorn

                starlette_app = self.streamable_http_app(host=host, **options)
                config = uvicorn.Config(
                    starlette_app,
                    host=host,
                    port=port,
                    log_level=self.settings.log_level.lower(),
                    access_log=False,
                )
                uvicorn_server = uvicorn.Server(config)
                await uvicorn_server.serve()

            async def list_tools(self) -> Any:
                if not server._is_auth_admitted():
                    raise server._unauthorized_rpc_error()
                view = server._current_scope_view()
                if view is not None:
                    req_dec = view.decide_request()
                    if req_dec != "proceed":
                        raise server._insufficient_scope_rpc_error(view, req_dec.forbidden)
                with bound_request():
                    return server._tool_list().sdk_tools()

            def _tool_input_schema(self, name: str) -> dict[str, Any] | None:
                # SDK internal (afd.server.sdk_internals): the low-level server reads it to
                # validate Mcp-Param headers, before any middleware runs.
                return server._sdk_tool_schemas.get(name)

            async def _dispatch_tool_call(
                self, name: Any, arguments: Any, context: Any, outcome: HookOutcome | None
            ) -> Any:
                # A hook or fail-closed auth refusal answers every route before meta-argument
                # lifting, context checks, confirmations or command lookup, so a refused caller
                # learns nothing about which tools or contexts exist.
                if outcome is not None and outcome.refusal is not None:
                    return _tool_call_result(failure(outcome.refusal))
                # A meta-tool's `meta` argument counts as _meta from here on.
                lifted = lift_meta_argument(
                    name, arguments, _request_meta(_CURRENT_REQUEST.get()), meta_keys
                )
                if lifted.error is not None:
                    return _tool_call_result(failure(lifted.error))
                # Declared context fields and output budget ask come from this request's _meta,
                # on both eras and every transport; undeclared keys are dropped. The router puts
                # them on the context (with hook values winning) and execution validates them.
                values = context_field_values(server.config.context_fields, lifted.meta)
                budget_ask = output_budget_ask_from_meta(lifted.meta)
                with (
                    bound_request(meta=lifted.meta),
                    bind_context_field_values(values),
                    bind_output_budget_ask(budget_ask),
                ):
                    return await server._call_sdk_tool(
                        name if isinstance(name, str) else "", lifted.arguments, context
                    )

            async def call_tool(self, name: Any, arguments: Any, context: Any = None) -> Any:
                if not server._is_auth_admitted():
                    return _tool_call_result(failure(server._unauthorized_error()))
                outcome = current_hook_outcome()
                if outcome is None and server.config.context_hook is not None:
                    # Direct SDK call_tool outside ServerRunner middleware: still run the hook.
                    outcome = await server._run_context_hook(
                        name if isinstance(name, str) else "", _CURRENT_REQUEST.get()
                    )
                    with bind_hook_outcome(outcome):
                        return await self._dispatch_tool_call(name, arguments, context, outcome)
                return await self._dispatch_tool_call(name, arguments, context, outcome)

        cache_hints: Any = {
            "tools/list": hint,
            "server/discover": discover_hint,
        }
        extensions: list[Any] = [self._task_runtime.create_extension()]
        if self._resource_service is not None:
            cache_hints.update(
                self._resource_service.cache_hints(auth_configured=self._auth_layer is not None)
            )
            skills_ext = self._resource_service.create_skills_extension()
            if skills_ext is not None:
                extensions.append(skills_ext)

        self._mcp_server = SessionMCPServer(
            self.config.name,
            description=self.config.description,
            # A host's own instructions win, even an empty string, as in TypeScript.
            instructions=self.config.instructions
            if self.config.instructions is not None
            else default_instructions(
                self.config.name,
                self.config.tool_strategy,
                self.config.contexts,
                self.config.bootstrap,
            ),
            version=self.config.version,
            cache_hints=cache_hints,
            middleware=[capture_request],
            extensions=extensions,
            lifespan=_server_lifespan,
            # The requestState of confirmation elicitations is sealed (AES-256-GCM) and bound
            # by the SDK to the request, the audience (the server name) and the call's principal
            # binding (spec/authorization.md, M8; #532): this server's actor and the verified
            # token's issuer, subject and client. A retry by another principal fails the SDK's
            # check exactly as an altered state does (JSON-RPC -32602), before any handler runs.
            # Without a configured key each process uses its own, as the SDK's default would.
            request_state_security=RequestStateSecurity(
                keys=[
                    self._confirmation_key if self._confirmation_key is not None else os.urandom(32)
                ],
                bind_principal=lambda _ctx: self._request_principal(),
            ),
        )
        lowlevel = lowlevel_server(self._mcp_server)
        strip_unused_sdk_handlers(lowlevel, serve_resources=self._resource_service is not None)
        if self._resource_service is not None:
            self._resource_service.install_handlers(
                lowlevel,
                get_admitted_credentials=self._current_admitted_credentials,
                auth_configured=self._auth_layer is not None,
            )
        self._install_pre_boundary_middleware()
        self._sync_mcp_tool_definitions()
        self._advertise_fixed_tools_list()
        self._advertise_context_fields()
        return self._mcp_server

    async def _run_context_hook(self, tool_name: str, request_context: Any) -> HookOutcome:
        """Run the server's per-request context hook once for ``tools/call``."""
        hook = self.config.context_hook
        if hook is None:
            raise RuntimeError("context_hook is not configured")
        return await run_context_hook(
            hook,
            tool_name,
            request_context,
            ContextDefaults(
                clock=self.config.clock,
                random=self.config.random,
                actor=self.config.actor,
            ),
            new_trace_id(trace_prefix_for_tool(tool_name)),
            credentials=self._current_admitted_credentials(),
        )

    def _targets_host_verified(
        self,
        tool_name: Any,
        arguments: Any,
        meta: Any,
        view: ScopeView | None,
    ) -> bool:
        return targets_host_verified(
            tool_name=tool_name,
            arguments=arguments,
            meta=meta,
            view=view,
            context_fields=self.config.context_fields,
            context_names={item.name for item in self.config.contexts},
            exposed_commands=self.list_exposed_commands(
                interface="mcp", include_bootstrap=True, context_filtered=False
            ),
            tool_strategy=self.config.tool_strategy,
            group_by=self.config.group_by,
        )

    def _install_pre_boundary_middleware(self) -> None:
        install_pre_boundary_middleware(self)

    def _request_principal(self) -> str:
        """The principal binding of the MCP request being served: the actor its commands run
        with (from ``context_hook`` when set, else the verified credentials' default actor, else
        the server's configured ``actor`` or ``Actor(kind="agent")``) and the identity of the
        verified access token, if any.

        Raises:
            IncompleteCredentials: A verified token lacks an issuer, subject or client id. The
                SDK then refuses to seal a state with an internal error, and
                ``_install_pre_boundary_middleware`` refuses a retry the same way.
        """
        admitted = self._current_admitted_credentials()
        outcome = current_hook_outcome()
        if outcome is not None and outcome.actor_at_start is not None:
            actor = outcome.actor_at_start
        elif admitted is not None:
            actor = credentials_actor(admitted)
        else:
            actor = self.config.actor or Actor(kind="agent")
        creds = admitted if self._auth_layer is not None else sdk_credentials()
        return principal_binding(actor, creds)

    def streamable_http_app(self, **options: Any) -> Any:
        """The Streamable HTTP ASGI app, for mounting in a host application.

        ``options`` are those of the SDK's ``MCPServer.streamable_http_app``, such as
        ``stateless_http``, ``json_response``, ``transport_security`` and
        ``max_request_body_size``. One app serves MCP 2026-07-28 statelessly and 2025
        clients that send ``initialize``. When ``auth`` is configured, the returned app
        enforces bearer-token verification, scope enforcement and RFC 9728 metadata (M1–M7).
        """
        mcp = self._create_mcp_server()
        self._stateless_http = bool(options.get("stateless_http", False))
        return mcp.streamable_http_app(**options)

    def sse_app(self, **options: Any) -> Any:
        """The deprecated SSE ASGI app, for mounting in a host application.

        When ``auth`` is configured, the returned app enforces bearer-token verification,
        scope enforcement and RFC 9728 metadata (M1–M7).
        """
        mcp = self._create_mcp_server()
        self._stateless_http = False
        return mcp.sse_app(**options)

    def run(self, transport: str = "stdio", **options: Any) -> None:
        """Run the server.

        Args:
            transport: "stdio", "sse" or "streamable-http".
            options: Transport options passed to the SDK, such as ``host``, ``port``,
                ``stateless_http`` or ``transport_security`` for "streamable-http".
        """
        if transport not in {"stdio", "sse", "streamable-http"}:
            raise ValueError(f"Unknown transport: {transport}")
        mcp = self._create_mcp_server()
        self._stateless_http = transport == "streamable-http" and bool(
            options.get("stateless_http", False)
        )
        try:
            mcp.run(transport=transport, **options)
        finally:
            self.stop_tasks()

    async def run_async(self, transport: str = "stdio", **options: Any) -> None:
        """Run the server in the current event loop; see :meth:`run` for ``options``."""
        if transport not in {"stdio", "sse", "streamable-http"}:
            raise ValueError(f"Unknown transport: {transport}")
        mcp = self._create_mcp_server()
        self._stateless_http = transport == "streamable-http" and bool(
            options.get("stateless_http", False)
        )
        try:
            if transport == "stdio":
                await mcp.run_stdio_async(**options)
            elif transport == "sse":
                await mcp.run_sse_async(**options)
            else:
                await mcp.run_streamable_http_async(**options)
        finally:
            self.stop_tasks()


def create_server(
    name: str,
    version: str = "1.0.0",
    description: str | None = None,
    middleware: list[CommandMiddleware] | None = None,
    *,
    tool_strategy: ToolStrategy = "grouped",
    contexts: list[ContextConfig] | None = None,
    group_by: GroupByFn | None = None,
    dev_mode: bool = False,
    default_timeout_ms: int | float | None = DEFAULT_COMMAND_TIMEOUT_MS,
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM,
    max_validation_issues: int = DEFAULT_MAX_VALIDATION_ISSUES,
    instructions: str | None = None,
    tools_list_ttl_ms: int | None = None,
    clock: Clock | None = None,
    random: RandomSource | None = None,
    actor: Actor | None = None,
    context_hook: ContextHook | None = None,
    confirmations: str = "off",
    confirmation_key: bytes | bytearray | memoryview | str | None = None,
    instances: ServerInstances | None = None,
    human_relay: HumanRelay | None = None,
    first_class_tools: Sequence[str] | None = None,
    context_fields: Sequence[ContextField | dict[str, Any]] | None = None,
    advertise_output_schema: bool = True,
    bootstrap: bool = False,
    task_store: TaskStore | None = None,
    task_options: TaskOptions | None = None,
    auth: McpAuthOptions | None = None,
    resources: ResourcesOption | None = None,
    skills: SkillCatalog | None = None,
    call_grant: CallGrant | None = None,
) -> MCPServer:
    """Create a new AFD MCP server.

    Args:
        context_fields: Request values the host declares (``spec/context-fields.md``): each
            one's name, ``_meta`` key, schema (a Pydantic model or any type
            ``pydantic.TypeAdapter`` accepts), and whether the journal keeps it
            (``journal=True``) or a call needs it (``required=True``). A call carries a
            field's value in ``context.extra[name]``: in process on the call's context, and
            over MCP from ``tools/call``'s ``params._meta[meta]`` (both eras, every transport;
            undeclared ``_meta`` keys are dropped, and HTTP headers are never read). It is
            validated before middleware runs and replaced with the schema's output, and an
            invalid or missing required value fails the call with ``VALIDATION_ERROR``
            (``required`` is not enforced for AFD's own ``afd-*`` commands, so a client can
            discover the fields first). ``server/discover`` lists the fields under
            ``_meta["dev.afd/context-fields"]`` and ``afd-help`` as ``contextFields``; neither
            ``tools/list`` nor its cache hint varies by a field. A bad declaration (an empty,
            reserved or repeated name, a ``meta`` key without a reverse-DNS prefix, with a
            reserved one or repeated) raises ``ValueError`` naming the field; a schema pydantic
            cannot use raises ``TypeError``.
        tool_strategy: How commands become MCP tools: ``"grouped"`` (the default, as in every
            language), ``"individual"``, ``"lazy"`` or ``"hybrid"`` (``spec/tool-strategies.md``).
            Every strategy lists the five meta-tools first.
        first_class_tools: With ``tool_strategy="hybrid"`` (required there, and refused with any
            other strategy), the commands to list as tools after the five meta-tools and the
            context tools, in order: 1 to 8 registered commands exposed to MCP, none a built-in
            tool, none repeated. Every other command is reached with ``afd-discover``,
            ``afd-detail`` and ``afd-call``. The list does not vary by context, so
            ``tools_list_ttl_ms`` defaults to 300000 even with ``contexts``. The set is checked
            against the registered commands before the first request, so ``@server.command``
            may follow ``create_server``.
        dev_mode: Development mode. When False (the default), a command that
            raises returns the generic message "An internal error occurred"
            instead of the exception text. The exception and its traceback are
            logged to the ``afd.server`` logger either way. Mirrors the
            TypeScript server's ``devMode`` option.
        max_batch_size: Most commands one ``afd-batch`` request may hold
            (default 500). A larger batch returns ``INVALID_BATCH_REQUEST``
            without running anything.
        max_batch_parallelism: Highest ``options.parallelism`` an ``afd-batch``
            request may ask for (default 16). A higher value returns
            ``INVALID_BATCH_REQUEST``.
        instructions: Agent guidance returned by MCP ``server/discover``. Defaults to
            a description of the tool strategy, the meta-tools and the contexts.
        tools_list_ttl_ms: ``ttlMs`` freshness hint of MCP 2026-07-28 ``tools/list``
            and ``server/discover`` results (default 300000, or 0 when ``contexts``
            are configured, because clients cache ``tools/list`` without its
            ``_meta``; the hybrid strategy's list does not vary, so it keeps 300000).
        clock: Clock given to handlers as ``context.clock`` when the context has
            none. Default: ``system_clock``. Pass ``fixed_clock()`` in tests.
        random: Random source given to handlers as ``context.random`` when the
            context has none. Default: ``system_random``.
        actor: Default actor for commands called over MCP when ``context_hook``
            is not set or leaves ``context.actor`` unset. Default: ``Actor(kind="agent")``.
            Direct ``server.execute()`` calls get no default actor.
        context_hook: Per-request hook ``(request, context) -> CommandContext | CommandError``
            (sync or async; see ``afd.server.context_hook``) invoked once per MCP
            ``tools/call`` (before the request-state boundary, confirmation gate and
            command lookup, on every route) and on ``tasks/get``, ``tasks/update``
            and ``tasks/cancel`` (with ``request.tool`` set to the method name,
            before task owner lookup). Receives a :class:`ContextHookRequest`
            (the tool name, SDK ``ServerRequestContext``, and Starlette HTTP request
            when present) and a base ``CommandContext`` with server defaults (no
            ``_meta`` context fields). Trust identity only from what a verified
            transport layer set, never from ``_meta`` or an unverified caller header;
            fail closed with a ``CommandError`` when a call cannot be attributed
            (``details`` and ``cause`` are stripped). The resolved actor is bound into
            confirmation and approval-relay ``requestState`` alongside any SDK-verified
            token (#532, #800), and hook ``extra`` values win over declared ``_meta``
            context fields. Does not run on ``tools/list``, ``server/discover``,
            ``initialize`` or ``server.execute()``.
        confirmations: Enforce ``confirm_prompt`` on MCP calls
            (``spec/command-metadata.md``, "Confirmations"): ``"off"`` (the default),
            ``"enforce"`` (an accepted elicitation, or an acknowledgement:
            ``confirm: true`` or ``_meta["dev.afd/confirm"]``) or ``"require-human"``
            (an accepted elicitation only). Otherwise the call fails with
            ``CONFIRMATION_REQUIRED`` or ``CONFIRMATION_DECLINED`` before the handler
            runs. ``server.execute()`` and DirectClient calls are never gated.
        confirmation_key: Key (32 bytes or more, as a string or bytes) that seals the
            ``requestState`` of confirmation and approval elicitations, shared by every instance
            behind one URL. Validated and copied at creation. Default: a random key per server.
            The state is bound to the call's principal binding (``afd.server.principal``, #532,
            #800): the actor from ``context_hook`` (or ``actor``) and the issuer, subject and
            client of the access token the SDK verified.
        instances: How many processes serve this server's URL: ``"single"`` or ``"multiple"``.
            With ``"multiple"``, creating the server raises ``ValueError`` when confirmations or
            an approval middleware with ``relay="mcp-elicitation"`` lacks ``confirmation_key``,
            or when a single-use approval middleware lacks ``nonce_store``. When omitted, serving
            over HTTP logs one warning per process to stderr if a per-process default is in use;
            ``"single"`` silences the warning (a supplied ``confirmation_key`` is still validated).
            Stdio logs nothing.
        human_relay: Host-verified confirmation relay (``afd.server.HumanRelay``;
            ``spec/command-metadata.md``, "Host-verified confirmation") enforcing
            ``confirmation_mode="host-verified"`` commands on single-command MCP 2026-07-28
            calls regardless of ``confirmations``.
        advertise_output_schema: Advertise a top-level MCP ``outputSchema`` (the
            CommandResult envelope, with ``data`` typed by ``output_schema``) on each command
            listed as its own tool. MCP clients validate a result's ``structuredContent``
            against it, so a handler whose ``data`` does not match its declared output schema
            fails on the client; set False to switch it off. Every tool result carries the
            whole CommandResult as ``structuredContent`` either way, and ``_meta.outputSchema``
            is always reported. Mirrors TypeScript's ``advertiseOutputSchema``.
        bootstrap: Register the ``afd-help``, ``afd-docs`` and ``afd-schema`` tools, which
            describe the server's commands, and name them in the default instructions. Off by
            default, as TypeScript's ``bootstrap`` option (parity decision D5); earlier releases
            always registered them. The meta-tools and context tools are listed either way.
        call_grant: Synchronous host grant predicate ``(command, context) -> bool`` for
            app-to-app calls (``context.extra["interface"] == "apps"``;
            ``spec/command-metadata.md``, "App-to-app calls"). Must return strictly ``True`` to
            permit a call; when omitted, or when the command does not exist, does not set
            ``expose.apps = True``, or the predicate returns anything else or raises, the call
            fails before lookup, validation, middleware and handler with ``CALL_NOT_GRANTED``.
    """
    if confirmations not in CONFIRMATION_MODES:
        raise ValueError("confirmations must be 'off', 'enforce' or 'require-human'")

    normalized_contexts = [
        item
        if isinstance(item, ContextConfig)
        else ContextConfig(**item)
        if isinstance(item, dict)
        else ContextConfig(
            name=item.name,
            description=getattr(item, "description", None),
            triggers=list(getattr(item, "triggers", []) or []),
            priority=getattr(item, "priority", None),
        )
        for item in (contexts or [])
    ]

    config = ServerConfig(
        name=name,
        version=version,
        description=description,
        middleware=middleware or [],
        tool_strategy=tool_strategy,
        contexts=normalized_contexts,
        group_by=group_by,
        dev_mode=dev_mode,
        default_timeout_ms=default_timeout_ms,
        max_batch_size=max_batch_size,
        max_batch_parallelism=max_batch_parallelism,
        max_validation_issues=max_validation_issues,
        instructions=instructions,
        tools_list_ttl_ms=tools_list_ttl_ms,
        clock=clock,
        random=random,
        actor=actor,
        context_hook=context_hook,
        confirmations=confirmations,
        confirmation_key=confirmation_key,
        instances=instances,
        human_relay=human_relay,
        first_class_tools=first_class_tools,  # type: ignore[arg-type]  # MCPServer checks it
        advertise_output_schema=advertise_output_schema,
        bootstrap=bootstrap,
        # MCPServer checks the declarations and converts mappings.
        context_fields=[] if context_fields is None else context_fields,  # type: ignore[arg-type]
        task_store=task_store,
        task_options=task_options,
        auth=auth,
        resources=resources,
        skills=skills,
        call_grant=call_grant,
    )
    return MCPServer(config)
