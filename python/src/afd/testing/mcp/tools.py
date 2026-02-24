"""
MCP tool definitions for AFD testing.

Generates MCP tool specifications from the scenario commands,
allowing AI agents to discover and invoke JTBD testing capabilities.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from afd.testing.mcp.hints import AgentEnhancedResult, enhance_with_agent_hints


@dataclass
class McpTool:
    """MCP Tool definition following JSON-RPC 2.0 / MCP spec.

    Attributes:
        name: Unique tool name.
        description: Human-readable description.
        input_schema: JSON Schema for input parameters.
    """

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class RegisteredTool:
    """Registered tool with handler.

    Attributes:
        tool: Tool definition.
        handler: Async handler function.
    """

    tool: McpTool
    handler: Callable[..., Any]


@dataclass
class ToolExecutionContext:
    """Options for tool execution.

    Attributes:
        command_handler: Command handler for scenario-evaluate.
        cwd: Working directory for file operations.
    """

    command_handler: Callable[..., Any] | None = None
    cwd: str | None = None


def generate_tools() -> list[McpTool]:
    """Generate MCP tool definitions for all scenario commands.

    Returns:
        List of McpTool definitions for scenario-list, scenario-evaluate,
        scenario-coverage, scenario-create, and scenario-suggest.
    """
    return [
        McpTool(
            name='scenario-list',
            description=(
                'List JTBD (Jobs-to-be-Done) scenario files. Returns scenario names, '
                'jobs, tags, and metadata. Use to discover available test scenarios before running them.'
            ),
            input_schema={
                'type': 'object',
                'properties': {
                    'directory': {'type': 'string', 'description': 'Directory to search for scenarios (default: ./scenarios)'},
                    'tags': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Filter scenarios by tags'},
                    'job': {'type': 'string', 'description': 'Filter scenarios by job name pattern'},
                    'recursive': {'type': 'boolean', 'description': 'Search subdirectories recursively (default: true)'},
                },
                'additionalProperties': False,
            },
        ),
        McpTool(
            name='scenario-evaluate',
            description=(
                'Execute JTBD scenarios and return detailed test results. Runs scenarios against '
                'a command handler, supports parallel execution, and outputs in multiple formats.'
            ),
            input_schema={
                'type': 'object',
                'properties': {
                    'directory': {'type': 'string', 'description': 'Directory containing scenarios'},
                    'scenarios': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Specific scenario files to run'},
                    'tags': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Run scenarios matching these tags'},
                    'job': {'type': 'string', 'description': 'Run scenarios matching this job pattern'},
                    'concurrency': {'type': 'number', 'description': 'Number of scenarios to run in parallel (default: 1)'},
                    'stop_on_failure': {'type': 'boolean', 'description': 'Stop execution on first failure (default: false)'},
                    'format': {'type': 'string', 'enum': ['json', 'junit', 'markdown'], 'description': 'Output format (default: json)'},
                    'output': {'type': 'string', 'description': 'Write results to this file path'},
                    'verbose': {'type': 'boolean', 'description': 'Include detailed step-by-step output'},
                },
                'additionalProperties': False,
            },
        ),
        McpTool(
            name='scenario-coverage',
            description=(
                'Analyze test coverage of JTBD scenarios against known commands. Shows which '
                'commands are tested, untested, and calculates coverage percentage.'
            ),
            input_schema={
                'type': 'object',
                'properties': {
                    'directory': {'type': 'string', 'description': 'Directory containing scenarios'},
                    'known_commands': {'type': 'array', 'items': {'type': 'string'}, 'description': 'List of all commands that should be tested'},
                    'format': {'type': 'string', 'enum': ['json', 'markdown'], 'description': 'Output format (default: json)'},
                    'output': {'type': 'string', 'description': 'Write coverage report to this file'},
                },
                'required': ['known_commands'],
                'additionalProperties': False,
            },
        ),
        McpTool(
            name='scenario-create',
            description=(
                'Generate a new JTBD scenario file from a template. Creates properly structured '
                'YAML with job definition, setup, and steps.'
            ),
            input_schema={
                'type': 'object',
                'properties': {
                    'name': {'type': 'string', 'description': 'Scenario name (becomes filename)'},
                    'job': {'type': 'string', 'description': 'Job-to-be-done description'},
                    'template': {'type': 'string', 'enum': ['basic', 'crud', 'workflow', 'validation'], 'description': 'Template type (default: basic)'},
                    'directory': {'type': 'string', 'description': 'Output directory (default: ./scenarios)'},
                    'commands': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Commands to include in the scenario'},
                    'tags': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Tags to apply to the scenario'},
                },
                'required': ['name', 'job'],
                'additionalProperties': False,
            },
        ),
        McpTool(
            name='scenario-suggest',
            description=(
                'Get scenario suggestions based on context. Supports multiple strategies: '
                'changed-files, uncovered, failed, command, natural.'
            ),
            input_schema={
                'type': 'object',
                'properties': {
                    'context': {'type': 'string', 'enum': ['changed-files', 'uncovered', 'failed', 'command', 'natural'], 'description': 'Context type for suggestions'},
                    'files': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Changed files (for changed-files context)'},
                    'command': {'type': 'string', 'description': 'Specific command to suggest scenarios for'},
                    'query': {'type': 'string', 'description': 'Natural language query (for natural context)'},
                    'directory': {'type': 'string', 'description': 'Directory containing scenarios'},
                    'known_commands': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Known commands for coverage analysis'},
                    'limit': {'type': 'number', 'description': 'Maximum suggestions to return (default: 5)'},
                    'include_skeleton': {'type': 'boolean', 'description': 'Include skeleton scenario in suggestions'},
                },
                'required': ['context'],
                'additionalProperties': False,
            },
        ),
    ]


def create_tool_registry(
    context: ToolExecutionContext | None = None,
) -> dict[str, RegisteredTool]:
    """Create a tool registry with handlers.

    Args:
        context: Execution context with command handler and cwd.

    Returns:
        Dict mapping tool name to RegisteredTool.
    """
    ctx = context or ToolExecutionContext()
    registry: dict[str, RegisteredTool] = {}
    tools = generate_tools()

    from afd.testing.scenarios.commands import (
        scenario_coverage_command,
        scenario_create_command,
        scenario_evaluate_command,
        scenario_list_command,
        scenario_suggest_command,
    )

    tool_handlers: dict[str, tuple[Callable[..., Any], list[str]]] = {
        'scenario-list': (scenario_list_command, []),
        'scenario-evaluate': (scenario_evaluate_command, []),
        'scenario-coverage': (scenario_coverage_command, ['known_commands']),
        'scenario-create': (scenario_create_command, ['name', 'job']),
        'scenario-suggest': (scenario_suggest_command, ['context']),
    }

    for tool in tools:
        handler_info = tool_handlers.get(tool.name)
        if not handler_info:
            continue

        command_fn, required_fields = handler_info

        async def _make_handler(
            input: Any,
            *,
            _fn: Callable[..., Any] = command_fn,
            _required: list[str] = required_fields,
            _name: str = tool.name,
        ) -> AgentEnhancedResult:
            parsed = _validate_input(input, _required)

            if _name == 'scenario-evaluate' and ctx.command_handler:
                parsed['handler'] = ctx.command_handler

            result = await _fn(parsed)
            return enhance_with_agent_hints(_name, result)

        registry[tool.name] = RegisteredTool(tool=tool, handler=_make_handler)

    return registry


def get_tool(name: str) -> McpTool | None:
    """Get a tool definition by name.

    Args:
        name: Tool name.

    Returns:
        McpTool or None if not found.
    """
    for tool in generate_tools():
        if tool.name == name:
            return tool
    return None


async def execute_tool(
    registry: dict[str, RegisteredTool],
    name: str,
    input: Any,
) -> AgentEnhancedResult:
    """Execute a tool by name with the given input.

    Args:
        registry: Tool registry from create_tool_registry.
        name: Tool name to execute.
        input: Input arguments.

    Returns:
        AgentEnhancedResult with result and hints.
    """
    registered = registry.get(name)

    if not registered:
        error_result: dict[str, Any] = {
            'success': False,
            'error': {
                'code': 'UNKNOWN_TOOL',
                'message': f"Tool '{name}' not found",
                'suggestion': f"Available tools: {', '.join(registry.keys())}",
            },
        }
        return enhance_with_agent_hints(name, error_result)

    return await registered.handler(input)


def _validate_input(input: Any, required_fields: list[str] | None = None) -> dict[str, Any]:
    """Validate and normalize tool input."""
    if input is None:
        input = {}
    if not isinstance(input, dict):
        raise ValueError('Input must be an object')

    for field_name in required_fields or []:
        if field_name not in input:
            raise ValueError(f'Missing required field: {field_name}')

    return dict(input)
