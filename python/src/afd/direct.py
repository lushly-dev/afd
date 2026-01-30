"""Direct Transport for zero-overhead in-process command execution.

This module enables co-located agents to execute commands directly
without any transport overhead (no JSON-RPC, no IPC, no network).

Example:
    >>> from afd.direct import DirectClient, create_registry
    >>> from my_app import registry
    >>>
    >>> client = DirectClient(registry)
    >>> result = await client.call('todo.create', {'title': 'Fast!'})
    >>> # ~0.1ms latency vs 10-100ms for MCP

Pipeline Example:
    >>> result = await client.pipe([
    ...     {'command': 'user.get', 'input': {'id': 123}, 'as': 'user'},
    ...     {'command': 'order.list', 'input': {'user_id': '$user.id'}},
    ... ])
"""

from __future__ import annotations

import time
import uuid
from abc import abstractmethod
from dataclasses import dataclass, field
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Protocol,
    Sequence,
    TypeVar,
    Union,
    runtime_checkable,
)

from afd.core.result import CommandResult, failure, success
from afd.core.errors import not_found_error, validation_error


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════

T = TypeVar("T")


@dataclass
class CommandContext:
    """Context for command execution."""
    
    trace_id: str
    source: Optional[str] = None
    timeout: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CommandInfo:
    """Information about a registered command."""
    
    name: str
    description: str


@dataclass
class CommandParameter:
    """Command parameter definition for validation."""
    
    name: str
    type: str  # 'string', 'number', 'boolean', 'object', 'array'
    description: str = ""
    required: bool = True
    default: Any = None
    enum: Optional[List[Any]] = None


@dataclass
class CommandDefinition:
    """Full command definition with parameters."""
    
    name: str
    description: str
    parameters: List[CommandParameter] = field(default_factory=list)


@dataclass
class DirectClientOptions:
    """Options for DirectClient."""
    
    source: Optional[str] = None
    debug: bool = False
    validate_inputs: bool = True


@dataclass
class DirectCallContext:
    """Context for individual command calls."""
    
    trace_id: Optional[str] = None
    timeout: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)


# ═══════════════════════════════════════════════════════════════════════════════
# UNKNOWN TOOL ERROR
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class UnknownToolError:
    """Structured error when an agent calls a non-existent tool."""
    
    error: str = "UNKNOWN_TOOL"
    message: str = ""
    requested_tool: str = ""
    available_tools: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    hint: Optional[str] = None


def _levenshtein_similarity(a: str, b: str) -> float:
    """Calculate similarity between two strings (0 to 1)."""
    a_lower = a.lower()
    b_lower = b.lower()
    
    if a_lower == b_lower:
        return 1.0
    
    len_a, len_b = len(a_lower), len(b_lower)
    
    # Create distance matrix
    matrix = [[0] * (len_b + 1) for _ in range(len_a + 1)]
    
    for i in range(len_a + 1):
        matrix[i][0] = i
    for j in range(len_b + 1):
        matrix[0][j] = j
    
    for i in range(1, len_a + 1):
        for j in range(1, len_b + 1):
            cost = 0 if a_lower[i - 1] == b_lower[j - 1] else 1
            matrix[i][j] = min(
                matrix[i - 1][j] + 1,      # deletion
                matrix[i][j - 1] + 1,      # insertion
                matrix[i - 1][j - 1] + cost  # substitution
            )
    
    max_len = max(len_a, len_b)
    if max_len == 0:
        return 1.0
    return 1.0 - matrix[len_a][len_b] / max_len


def _find_similar_tools(
    requested: str,
    available: List[str],
    max_suggestions: int = 3
) -> List[str]:
    """Find similar tool names for suggestions."""
    scored = [
        (tool, _levenshtein_similarity(requested, tool))
        for tool in available
    ]
    filtered = [(t, s) for t, s in scored if s >= 0.4]
    filtered.sort(key=lambda x: x[1], reverse=True)
    return [t for t, _ in filtered[:max_suggestions]]


def _create_unknown_tool_error(
    requested: str,
    available: List[str]
) -> UnknownToolError:
    """Create a structured unknown tool error."""
    suggestions = _find_similar_tools(requested, available)
    hint = f"Did you mean '{suggestions[0]}'?" if suggestions else None
    
    return UnknownToolError(
        error="UNKNOWN_TOOL",
        message=f"Tool '{requested}' not found in registry",
        requested_tool=requested,
        available_tools=available,
        suggestions=suggestions,
        hint=hint,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# DIRECT REGISTRY PROTOCOL
# ═══════════════════════════════════════════════════════════════════════════════


@runtime_checkable
class DirectRegistry(Protocol):
    """Protocol for registries that support direct execution.
    
    Implement this in your application to enable DirectClient.
    
    Example:
        >>> class MyRegistry:
        ...     def __init__(self):
        ...         self._commands = {}
        ...     
        ...     async def execute(self, name, args, context):
        ...         handler = self._commands.get(name)
        ...         return await handler(args)
        ...     
        ...     def has_command(self, name):
        ...         return name in self._commands
        ...     
        ...     def list_commands(self):
        ...         return [{'name': n, 'description': ''} for n in self._commands]
        ...     
        ...     def list_command_names(self):
        ...         return list(self._commands.keys())
    """
    
    async def execute(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
        context: Optional[CommandContext] = None,
    ) -> CommandResult:
        """Execute a command by name."""
        ...
    
    def has_command(self, name: str) -> bool:
        """Check if command exists."""
        ...
    
    def list_commands(self) -> List[CommandInfo]:
        """List all registered commands."""
        ...
    
    def list_command_names(self) -> List[str]:
        """List command names only."""
        ...
    
    # Optional method for validation support
    def get_command(self, name: str) -> Optional[CommandDefinition]:
        """Get command definition for validation (optional)."""
        ...


# ═══════════════════════════════════════════════════════════════════════════════
# SIMPLE REGISTRY IMPLEMENTATION
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class RegisteredCommand:
    """A registered command with its handler and metadata."""
    
    name: str
    description: str
    handler: Callable
    parameters: List[CommandParameter] = field(default_factory=list)


class SimpleRegistry:
    """Simple in-memory command registry.
    
    Example:
        >>> registry = SimpleRegistry()
        >>> 
        >>> @registry.command(name='hello', description='Say hello')
        ... async def hello(name: str = 'World'):
        ...     return success({'message': f'Hello, {name}!'})
        >>> 
        >>> client = DirectClient(registry)
        >>> result = await client.call('hello', {'name': 'Agent'})
    """
    
    def __init__(self):
        self._commands: Dict[str, RegisteredCommand] = {}
    
    def command(
        self,
        name: str,
        description: str = "",
        parameters: Optional[List[CommandParameter]] = None,
    ) -> Callable:
        """Decorator to register a command.
        
        Args:
            name: Command name (use dot.notation for namespacing)
            description: What the command does
            parameters: Parameter definitions for validation
        """
        def decorator(func: Callable) -> Callable:
            self._commands[name] = RegisteredCommand(
                name=name,
                description=description or func.__doc__ or "",
                handler=func,
                parameters=parameters or [],
            )
            return func
        return decorator
    
    def register(
        self,
        name: str,
        handler: Callable,
        description: str = "",
        parameters: Optional[List[CommandParameter]] = None,
    ) -> None:
        """Register a command imperatively."""
        self._commands[name] = RegisteredCommand(
            name=name,
            description=description or handler.__doc__ or "",
            handler=handler,
            parameters=parameters or [],
        )
    
    async def execute(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
        context: Optional[CommandContext] = None,
    ) -> CommandResult:
        """Execute a command by name."""
        cmd = self._commands.get(name)
        if not cmd:
            return failure(not_found_error(f"Command '{name}' not found"))
        
        try:
            result = await cmd.handler(**(args or {}))
            return result
        except Exception as e:
            return failure(
                validation_error(f"Command execution failed: {e}")
            )
    
    def has_command(self, name: str) -> bool:
        """Check if command exists."""
        return name in self._commands
    
    def list_commands(self) -> List[CommandInfo]:
        """List all registered commands."""
        return [
            CommandInfo(name=cmd.name, description=cmd.description)
            for cmd in self._commands.values()
        ]
    
    def list_command_names(self) -> List[str]:
        """List command names only."""
        return list(self._commands.keys())
    
    def get_command(self, name: str) -> Optional[CommandDefinition]:
        """Get command definition for validation."""
        cmd = self._commands.get(name)
        if not cmd:
            return None
        return CommandDefinition(
            name=cmd.name,
            description=cmd.description,
            parameters=cmd.parameters,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# DIRECT CLIENT
# ═══════════════════════════════════════════════════════════════════════════════


def _generate_trace_id() -> str:
    """Generate a unique trace ID."""
    return f"trace-{uuid.uuid4().hex[:12]}"


class DirectClient:
    """Zero-overhead command execution client.
    
    Calls commands directly via the registry without MCP transport.
    Provides ~0.1ms latency vs 10-100ms for MCP.
    
    Example:
        >>> client = DirectClient(registry)
        >>> result = await client.call('todo.create', {'title': 'Fast task'})
        >>> print(result.data)
    
    Pipeline Example:
        >>> result = await client.pipe([
        ...     {'command': 'user.get', 'input': {'id': 123}, 'as': 'user'},
        ...     {'command': 'order.list', 'input': {'user_id': '$user.id'}},
        ... ])
    """
    
    def __init__(
        self,
        registry: DirectRegistry,
        options: Optional[DirectClientOptions] = None,
    ):
        self.registry = registry
        self.options = options or DirectClientOptions()
    
    async def call(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
        context: Optional[DirectCallContext] = None,
    ) -> CommandResult:
        """Execute a command with zero transport overhead.
        
        Args:
            name: Command name
            args: Command arguments
            context: Optional call context for tracing
        
        Returns:
            CommandResult from the command handler
        """
        start_time = time.perf_counter() if self.options.debug else 0
        trace_id = (context.trace_id if context else None) or _generate_trace_id()
        
        self._debug(f"[{trace_id}] Calling {name}", args)
        
        # Check if command exists
        if not self.registry.has_command(name):
            available = self.registry.list_command_names()
            error_data = _create_unknown_tool_error(name, available)
            
            self._debug(f"[{trace_id}] Unknown command: {name}")
            
            return CommandResult(
                success=False,
                data=error_data,
                error={
                    "code": "UNKNOWN_TOOL",
                    "message": error_data.message,
                },
            )
        
        # Input validation (if registry supports getCommand)
        if self.options.validate_inputs and hasattr(self.registry, 'get_command'):
            cmd_def = self.registry.get_command(name)
            if cmd_def:
                issues = self._validate_input(args, cmd_def.parameters)
                if issues:
                    self._debug(f"[{trace_id}] Validation failed: {issues}")
                    return failure(
                        validation_error(
                            f"Invalid input for '{name}': {'; '.join(issues)}"
                        )
                    )
        
        # Build command context
        cmd_context = CommandContext(
            trace_id=trace_id,
            source=self.options.source,
            timeout=context.timeout if context else None,
            extra=context.extra if context else {},
        )
        
        # Execute the command
        result = await self.registry.execute(name, args, cmd_context)
        
        if self.options.debug:
            duration = (time.perf_counter() - start_time) * 1000
            self._debug(f"[{trace_id}] Completed in {duration:.3f}ms", {
                "success": result.success,
            })
        
        return result
    
    def list_commands(self) -> List[CommandInfo]:
        """List available commands."""
        return self.registry.list_commands()
    
    def list_command_names(self) -> List[str]:
        """List command names."""
        return self.registry.list_command_names()
    
    def has_command(self, name: str) -> bool:
        """Check if a command exists."""
        return self.registry.has_command(name)
    
    def get_source(self) -> Optional[str]:
        """Get the source identifier for this client."""
        return self.options.source
    
    def _validate_input(
        self,
        args: Optional[Dict[str, Any]],
        parameters: List[CommandParameter],
    ) -> List[str]:
        """Validate input against parameter definitions."""
        issues = []
        args = args or {}
        
        for param in parameters:
            if param.required and param.name not in args:
                issues.append(f"Missing required parameter: '{param.name}'")
                continue
            
            if param.name in args:
                value = args[param.name]
                # Type checking (basic)
                if param.type == "string" and not isinstance(value, str):
                    issues.append(f"'{param.name}' must be a string")
                elif param.type == "number" and not isinstance(value, (int, float)):
                    issues.append(f"'{param.name}' must be a number")
                elif param.type == "boolean" and not isinstance(value, bool):
                    issues.append(f"'{param.name}' must be a boolean")
                
                # Enum validation
                if param.enum and value not in param.enum:
                    issues.append(
                        f"'{param.name}' must be one of: {param.enum}"
                    )
        
        return issues
    
    def _debug(self, message: str, data: Any = None) -> None:
        """Debug logging helper."""
        if self.options.debug:
            print(f"[DirectClient] {message}", data if data else "")


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


def create_registry() -> SimpleRegistry:
    """Create a new SimpleRegistry instance.
    
    Example:
        >>> registry = create_registry()
        >>> 
        >>> @registry.command(name='ping', description='Health check')
        ... async def ping():
        ...     return success({'status': 'ok'})
    """
    return SimpleRegistry()


def create_direct_client(
    registry: DirectRegistry,
    source: Optional[str] = None,
    debug: bool = False,
    validate_inputs: bool = True,
) -> DirectClient:
    """Create a DirectClient for zero-overhead command execution.
    
    Args:
        registry: The command registry to execute against
        source: Optional source identifier (e.g., 'my-agent')
        debug: Enable debug logging
        validate_inputs: Validate inputs against schemas
    
    Returns:
        Configured DirectClient instance
    
    Example:
        >>> client = create_direct_client(registry, source='api-server')
        >>> result = await client.call('user.get', {'id': 123})
    """
    return DirectClient(
        registry,
        DirectClientOptions(
            source=source,
            debug=debug,
            validate_inputs=validate_inputs,
        ),
    )
