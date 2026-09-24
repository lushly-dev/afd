"""
Rich output formatting for AFD CLI.

Provides beautiful terminal output using Rich library.
"""

from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table
from rich.tree import Tree

from afd.core import CommandResult
from afd.transports import ToolInfo

# Global console instance
console = Console()
error_console = Console(stderr=True)


def print_result(result: CommandResult[Any], *, json_output: bool = False) -> None:
    """
    Print a CommandResult with rich formatting.

    Args:
        result: The command result to display (can be CommandResult or dict)
        json_output: If True, output raw JSON instead of formatted
    """
    import json

    if json_output:
        from afd.core.wire import to_wire

        console.print(json.dumps(to_wire(result), indent=2))
        return

    # Handle both dict and CommandResult objects
    if isinstance(result, dict):
        success = result.get("success", False)
    else:
        success = getattr(result, "success", False)
    
    if success:
        _print_success_result(result)
    else:
        _print_error_result(result)


def _get_attr(obj: Any, key: str, default: Any = None) -> Any:
    """Get attribute from dict or object."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _print_success_result(result: CommandResult[Any]) -> None:
    """Print a successful result with rich formatting."""
    import json

    # Show confidence if present
    confidence = _get_attr(result, "confidence")
    if confidence is not None:
        confidence_bar = _create_confidence_bar(confidence)
        console.print(f"Confidence: {confidence_bar} {confidence:.0%}")

    # Show reasoning if present
    reasoning = _get_attr(result, "reasoning")
    if reasoning:
        console.print(f"[dim]💭 {reasoning}[/dim]")

    # Show data
    data = _get_attr(result, "data")
    if data is not None:
        if isinstance(data, (dict, list)):
            json_str = json.dumps(data, indent=2, default=str)
            syntax = Syntax(json_str, "json", theme="monokai", line_numbers=False)
            console.print(Panel(syntax, title="[green]✓ Success[/green]", border_style="green"))
        else:
            console.print(Panel(str(data), title="[green]✓ Success[/green]", border_style="green"))
    else:
        console.print("[green]✓ Command completed successfully[/green]")

    # Show warnings if present
    warnings = _get_attr(result, "warnings", [])
    for warning in warnings:
        if isinstance(warning, dict):
            print_warning(warning.get("message", str(warning)))
        else:
            print_warning(getattr(warning, "message", str(warning)))

    # Show plan if present
    plan = _get_attr(result, "plan", [])
    if plan:
        _print_plan(plan)

    # Show alternatives if present
    alternatives = _get_attr(result, "alternatives", [])
    if alternatives:
        _print_alternatives(alternatives)


def _print_error_result(result: CommandResult[Any]) -> None:
    """Print an error result with rich formatting."""
    error = _get_attr(result, "error", {})
    
    if isinstance(error, dict):
        code = error.get("code", "UNKNOWN_ERROR")
        message = error.get("message", "An unknown error occurred")
        suggestion = error.get("suggestion")
    else:
        code = getattr(error, "code", "UNKNOWN_ERROR")
        message = getattr(error, "message", "An unknown error occurred")
        suggestion = getattr(error, "suggestion", None)

    error_text = f"[bold red]{code}[/bold red]\n{message}"
    if suggestion:
        error_text += f"\n\n[yellow]💡 Suggestion:[/yellow] {suggestion}"

    error_console.print(Panel(error_text, title="[red]✗ Error[/red]", border_style="red"))


def _create_confidence_bar(confidence: float, width: int = 10) -> str:
    """Create a visual confidence bar."""
    filled = int(confidence * width)
    empty = width - filled
    
    if confidence >= 0.8:
        color = "green"
    elif confidence >= 0.5:
        color = "yellow"
    else:
        color = "red"
    
    return f"[{color}]{'█' * filled}{'░' * empty}[/{color}]"


def _print_plan(plan: list[dict[str, Any]]) -> None:
    """Print execution plan as a tree."""
    tree = Tree("[bold]📋 Execution Plan[/bold]")
    
    for step in plan:
        if isinstance(step, dict):
            status = step.get("status", "pending")
            description = step.get("description", "Unknown step")
        else:
            status = getattr(step, "status", "pending")
            description = getattr(step, "description", "Unknown step")
        
        status_icons = {
            "pending": "⏳",
            "in_progress": "🔄",
            "completed": "✅",
            "failed": "❌",
            "skipped": "⏭️",
        }
        icon = status_icons.get(str(status), "•")
        
        tree.add(f"{icon} {description}")
    
    console.print(tree)


def _print_alternatives(alternatives: list[dict[str, Any]]) -> None:
    """Print alternatives as a table."""
    table = Table(title="🔀 Alternatives Considered")
    table.add_column("Option", style="cyan")
    table.add_column("Reason", style="dim")
    table.add_column("Confidence", justify="right")
    
    for alt in alternatives[:5]:  # Limit to 5
        if isinstance(alt, dict):
            reason = alt.get("reason", "")
            confidence = alt.get("confidence")
            data = alt.get("data")
        else:
            reason = getattr(alt, "reason", "")
            confidence = getattr(alt, "confidence", None)
            data = getattr(alt, "data", None)
        
        confidence_str = f"{confidence:.0%}" if confidence is not None else "-"
        
        # Truncate data for display
        if isinstance(data, dict):
            data_str = str(data)[:50] + "..." if len(str(data)) > 50 else str(data)
        else:
            data_str = str(data)[:50]
        
        table.add_row(data_str, reason, confidence_str)
    
    console.print(table)


def print_tools(tools: list[ToolInfo]) -> None:
    """
    Print available tools as a formatted table.

    Args:
        tools: List of ToolInfo objects to display
    """
    if not tools:
        console.print("[yellow]No tools available[/yellow]")
        return

    table = Table(title="🔧 Available Tools")
    table.add_column("Name", style="cyan", no_wrap=True)
    table.add_column("Description", style="dim")

    for tool in sorted(tools, key=lambda t: t.name):
        description = tool.description or "[dim]No description[/dim]"
        # Truncate long descriptions
        if len(description) > 60:
            description = description[:57] + "..."
        table.add_row(tool.name, description)

    console.print(table)
    console.print(f"\n[dim]Total: {len(tools)} tools[/dim]")


def print_tool_detail(tool: ToolInfo) -> None:
    """
    Print detailed information about a single tool.

    Args:
        tool: ToolInfo object to display
    """
    import json

    console.print(f"\n[bold cyan]{tool.name}[/bold cyan]")
    
    if tool.description:
        console.print(f"[dim]{tool.description}[/dim]\n")

    if tool.input_schema:
        console.print("[bold]Input Schema:[/bold]")
        schema_str = json.dumps(tool.input_schema, indent=2)
        syntax = Syntax(schema_str, "json", theme="monokai", line_numbers=False)
        console.print(syntax)


def print_error(message: str) -> None:
    """
    Print an error message.

    Args:
        message: Error message to display
    """
    error_console.print(f"[red]✗ Error:[/red] {message}")


def print_success(message: str) -> None:
    """
    Print a success message.

    Args:
        message: Success message to display
    """
    console.print(f"[green]✓[/green] {message}")


def print_warning(message: str) -> None:
    """
    Print a warning message.

    Args:
        message: Warning message to display
    """
    console.print(f"[yellow]⚠[/yellow] {message}")


def print_info(message: str) -> None:
    """
    Print an info message.

    Args:
        message: Info message to display
    """
    console.print(f"[blue]ℹ[/blue] {message}")


def print_connecting(server: str) -> None:
    """Print a connecting message."""
    console.print(f"[dim]Connecting to {server}...[/dim]")


def print_disconnecting() -> None:
    """Print a disconnecting message."""
    console.print("[dim]Disconnecting...[/dim]")
