"""
AFD CLI main module.

Provides the Click-based command-line interface.
"""

import asyncio
import contextlib
import importlib.util
import json
import math
import os
import sys
import threading
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import click
from rich.text import Text

from afd.cli.elicitation import interactive_elicitation
from afd.cli.output import (
    console,
    plain,
    print_connecting,
    print_disconnecting,
    print_error,
    print_info,
    print_result,
    print_success,
    print_tool_detail,
    print_tools,
    print_warning,
)
from afd.cli.surface_commands import approval_policy_warnings, collect_surface_commands
from afd.cli.terminal import configure_stdio, terminal_text
from afd.core.builtin_names import is_afd_builtin_name
from afd.transports import (
    ElicitationHandler,
    HttpTransport,
    MockTransport,
    SseTransport,
    StreamableHttpTransport,
    Transport,
)

# State file for persistent connection info
STATE_FILE = Path.home() / ".afd" / "state.json"


def validate_command_surface(commands: list[Any], options: Any = None) -> Any:
    """Run surface validation from ``afd.testing``.

    Imported on first use: ``afd.testing`` needs the ``testing`` extra (pytest),
    which the CLI does not otherwise require.
    """
    from afd.testing.surface.validate import validate_command_surface as _validate

    return _validate(commands, options)


def _load_state() -> dict[str, Any]:
    """Load CLI state from disk."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_state(state: dict[str, Any]) -> None:
    """Save CLI state to disk."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def _get_transport(
    server: str | None = None,
    *,
    on_elicitation: ElicitationHandler | None = None,
    timeout: float | None = None,
    headers: dict[str, str] | None = None,
) -> Transport:
    """
    Get a transport instance.

    Args:
        server: Server URL, or a special value:
            - "mock" or a "mock:" prefix for MockTransport
            - an http(s) URL ending in /sse for SseTransport (deprecated)
            - an http(s) URL ending in /message or /messages for HttpTransport (deprecated)
            - any other http(s) URL (such as /mcp) for StreamableHttpTransport
        on_elicitation: Answers server elicitations on a Streamable HTTP transport.
        timeout: Request timeout in seconds; the transport's default when omitted.
        headers: Request headers sent with every request.

    Returns:
        Configured transport instance

    Raises:
        click.ClickException: If no server is given or saved, or the target is
            not a URL. The CLI has no stdio or named-server transport, so it
            refuses rather than "connecting" to an empty in-process server.
    """
    if server is None:
        # Load from state
        state = _load_state()
        server = state.get("server")
        if not server:
            raise click.ClickException("No server connected. Use 'afd connect <url>' first.")

    # Check for mock transport
    if server == "mock" or server.startswith("mock:"):
        return MockTransport()

    parsed = urlparse(server)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        options: dict[str, Any] = {} if timeout is None else {"timeout": timeout}
        if headers:
            options["headers"] = headers
        normalized_path = parsed.path.rstrip("/")
        if normalized_path.endswith("/message") or normalized_path.endswith("/messages"):
            return HttpTransport(server, **options)
        if normalized_path.endswith("/sse"):
            return SseTransport(server, **options)
        return StreamableHttpTransport(server, on_elicitation=on_elicitation, **options)

    raise click.ClickException(
        f"'{server}' is not a server URL. Connect to a running server by URL, for example "
        "'afd connect http://localhost:3100/mcp' (MCP Streamable HTTP), or use 'afd connect mock' "
        "for testing. Named and stdio servers are not supported by the CLI."
    )


def _fail(message: str) -> None:
    """Print an error that may carry server text: escapes stripped, no Rich markup."""
    click.echo(f"{click.style('✗ Error:', fg='red')} {terminal_text(message)}", err=True)


def _headers_option(func: Any) -> Any:
    return click.option(
        "--header",
        "-H",
        "headers",
        multiple=True,
        help="Request header 'Name: value', repeatable (never saved; also read from AFD_HEADERS)",
    )(func)


def _resolve_headers(flags: tuple[str, ...]) -> dict[str, str]:
    """Headers from ``AFD_HEADERS`` and ``-H``; a malformed one exits 1, as in TypeScript."""
    from afd.cli.args import resolve_headers

    try:
        return resolve_headers(flags)
    except ValueError as e:
        _fail(str(e))
        sys.exit(1)


@click.group()
@click.version_option(package_name="afd")
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.option("--quiet", "-q", is_flag=True, help="Suppress non-essential output")
@click.pass_context
def cli(ctx: click.Context, json_output: bool, quiet: bool) -> None:
    """
    AFD - Agent-First Development CLI.

    Interact with MCP servers using the AFD command pattern.

    \b
    Examples:
        afd connect http://localhost:3100/sse
        afd tools
        afd call user.create '{"name": "Alice"}'
    """
    configure_stdio()
    ctx.ensure_object(dict)
    ctx.obj["json_output"] = json_output
    ctx.obj["quiet"] = quiet


@cli.command()
@click.argument("server")
@click.option(
    "--timeout",
    "-t",
    type=click.FloatRange(min=0, min_open=True),
    default=30.0,
    show_default=True,
    help="Connection timeout in seconds",
)
@_headers_option
@click.pass_context
def connect(ctx: click.Context, server: str, timeout: float, headers: tuple[str, ...]) -> None:
    """
    Connect to an MCP server.

    SERVER is the server's URL, or a special value:
    \b
    - http(s)://host/mcp       MCP Streamable HTTP endpoint (2026-07-28 or 2025)
    - http(s)://host/sse       Deprecated SSE endpoint of an AFD server
    - http(s)://host/message   Deprecated HTTP message endpoint
    - mock                     Use mock transport for testing

    Headers from -H and AFD_HEADERS are sent to check the connection and are
    never saved; give them again to each later command.

    \b
    Examples:
        afd connect http://localhost:3100/mcp
        afd connect http://localhost:3100/mcp -H "Authorization: Bearer $TOKEN"
        afd connect mock
    """
    quiet = ctx.obj.get("quiet", False)
    if not math.isfinite(timeout):
        raise click.UsageError("--timeout must be finite")

    # Rejects a non-URL target before claiming to connect to it.
    request_headers = _resolve_headers(headers)
    transport = _get_transport(server, timeout=timeout, headers=request_headers)

    if not quiet:
        print_connecting(server)

    async def _connect() -> None:
        try:
            await transport.connect()

            # Save connection state
            _save_state({"server": server})

            if not quiet:
                print_success(f"Connected to {server}")

                # List available tools
                tools = await transport.list_tools()
                if tools:
                    print_info(f"Available tools: {len(tools)}")
            if request_headers:
                click.echo(
                    "Request headers are not saved. Pass --header again or set AFD_HEADERS "
                    "for later commands.",
                    err=True,
                )
        finally:
            await transport.disconnect()

    try:
        asyncio.run(_connect())
    except Exception as e:
        _fail(str(e))
        sys.exit(1)


@cli.command()
@click.pass_context
def disconnect(ctx: click.Context) -> None:
    """
    Disconnect from the current server.

    Clears the saved connection state.
    """
    quiet = ctx.obj.get("quiet", False)

    state = _load_state()
    server = state.get("server")

    if not server:
        if not quiet:
            print_info("No active connection")
        return

    if not quiet:
        print_disconnecting()

    # Clear state
    _save_state({})

    if not quiet:
        print_success(f"Disconnected from {server}")


@cli.command()
@click.option("--server", "-s", help="Server to query (uses saved connection if omitted)")
@click.option("--filter", "-f", "pattern", help="Filter tools by name pattern")
@click.option("--detail", "-d", "tool_name", help="Show detailed info for a specific tool")
@_headers_option
@click.pass_context
def tools(
    ctx: click.Context,
    server: str | None,
    pattern: str | None,
    tool_name: str | None,
    headers: tuple[str, ...],
) -> None:
    """
    List available tools from the connected server.

    \b
    Examples:
        afd tools
        afd tools --filter user
        afd tools --detail user.create
    """
    json_output = ctx.obj.get("json_output", False)
    request_headers = _resolve_headers(headers)

    async def _list_tools() -> None:
        transport = _get_transport(server, headers=request_headers)
        try:
            await transport.connect()
            tool_list = await transport.list_tools()

            # Filter if pattern provided
            if pattern:
                tool_list = [t for t in tool_list if pattern.lower() in t.name.lower()]

            # Show detail for specific tool
            if tool_name:
                matching = [t for t in tool_list if t.name == tool_name]
                if not matching:
                    raise click.ClickException(f"Tool '{tool_name}' not found")

                if json_output:
                    import json as json_module

                    click.echo(
                        json_module.dumps(
                            {
                                "name": matching[0].name,
                                "description": matching[0].description,
                                "input_schema": matching[0].input_schema,
                            },
                            indent=2,
                        )
                    )
                else:
                    print_tool_detail(matching[0])
                return

            # List all tools
            if json_output:
                import json as json_module

                click.echo(
                    json_module.dumps(
                        [{"name": t.name, "description": t.description} for t in tool_list],
                        indent=2,
                    )
                )
            else:
                print_tools(tool_list)
        finally:
            await transport.disconnect()

    try:
        asyncio.run(_list_tools())
    except click.ClickException:
        raise
    except Exception as e:
        _fail(str(e))
        sys.exit(1)


async def _terminal_approval() -> bool:
    return await _terminal_yes("Approve? [y/N] ")


async def _terminal_yes(prompt: str) -> bool:
    """Ask a yes/no question on stderr; only ``y`` or ``yes`` is a yes.

    An unanswered terminal must not keep asyncio.run's executor shutdown alive.
    """
    loop = asyncio.get_running_loop()
    decision = loop.create_future()

    click.echo(prompt, err=True, nl=False)
    descriptor = sys.stdin.fileno()

    def ask() -> None:
        # Unbuffered reads avoid holding stdin's Python buffer lock during shutdown.
        # This daemon may remain in the OS read after timeout; it owns no approval authority.
        line = bytearray()
        try:
            while len(line) < 1024:
                char = os.read(descriptor, 1)
                if not char or char in (b"\n", b"\r"):
                    break
                line.extend(char)
            answer = bytes(line).strip().lower() in (b"y", b"yes")
        except (OSError, ValueError):
            answer = False

        def finish() -> None:
            if not decision.done():
                decision.set_result(answer is True)

        # The call may have expired and its event loop already closed.
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(finish)

    threading.Thread(target=ask, daemon=True).start()
    return await decision


@cli.command()
@click.argument("tool")
@click.argument("args", required=False, default="")
@click.option("--server", "-s", help="Server to use (uses saved connection if omitted)")
@click.option(
    "--module",
    "module_path",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="Load a Python file exporting registry for an in-process call",
)
@click.option("--approve", is_flag=True, help="Explicitly approve one in-process retry")
@click.option(
    "--timeout", type=click.FloatRange(min=0, min_open=True), help="Total in-process deadline in ms"
)
@_headers_option
@click.pass_context
def call(
    ctx: click.Context,
    tool: str,
    args: str,
    server: str | None,
    module_path: Path | None,
    approve: bool,
    timeout: float | None,
    headers: tuple[str, ...],
) -> None:
    """
    Call a tool on the connected server.

    TOOL is the name of the tool to call.
    ARGS is one argument: a JSON object or key=value pairs (quote the whole
    argument when it holds several pairs or spaces). Empty means {}. A value is
    parsed as JSON when it can be (count=2, done=true) and kept as a string
    otherwise (title=milk).

    \b
    Examples:
        afd call user.list
        afd call user.create '{"name": "Alice", "email": "alice@example.com"}'
        afd call user.create 'name="Alice Smith" email=alice@example.com'
        afd call doc.get id=123 -H "Authorization: Bearer $TOKEN"
    """
    from afd.cli.args import describe_args_error, parse_tool_args

    json_output = ctx.obj.get("json_output", False)

    try:
        parsed_args = parse_tool_args(args)
    except ValueError as e:
        _fail(describe_args_error(e))
        sys.exit(1)

    if module_path is not None and server is not None:
        raise click.UsageError("--module and --server cannot be combined")
    if module_path is not None and headers:
        raise click.UsageError("--header needs a server; --module calls run in process")
    if module_path is None and (approve or timeout is not None):
        raise click.UsageError(
            "--approve and --timeout require --module; remote approval belongs to the server"
        )
    if timeout is not None and not math.isfinite(timeout):
        raise click.UsageError("--timeout must be finite")
    request_headers = _resolve_headers(headers) if module_path is None else {}

    async def _call_module() -> None:
        from afd.direct import DirectCallContext, DirectClient, DirectClientOptions

        spec = importlib.util.spec_from_file_location(f"_afd_call_{uuid.uuid4().hex}", module_path)
        if spec is None or spec.loader is None:
            raise click.ClickException("Could not load the command module")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        try:
            spec.loader.exec_module(module)
            registry = getattr(module, "registry", None)
            if registry is None:
                raise click.ClickException("The module must export registry")

            async def decide(request):
                # JSON escaping keeps command-provided control characters out of the terminal.
                def plain(value):
                    return json.dumps(value, ensure_ascii=True)[1:-1]

                click.echo(
                    f"{plain(request.command)} needs approval before it runs.\n"
                    f"Action: {plain(request.summary)}\n"
                    f"Approval expires: {plain(request.expires_at)}",
                    err=True,
                )
                if approve:
                    return True
                if json_output or not sys.stdin.isatty() or not sys.stderr.isatty():
                    return False
                return await _terminal_approval()

            client = DirectClient(registry, DirectClientOptions(on_approval_needed=decide))
            result = await client.call(tool, parsed_args, DirectCallContext(timeout=timeout))
            print_result(result, json_output=json_output)
        finally:
            if sys.modules.get(spec.name) is module:
                del sys.modules[spec.name]

    async def _call_tool() -> None:
        transport = _get_transport(
            server, on_elicitation=interactive_elicitation(_terminal_yes), headers=request_headers
        )
        try:
            await transport.connect()
            result = await transport.call_tool(tool, parsed_args)
            print_result(result, json_output=json_output)
        finally:
            await transport.disconnect()

    try:
        asyncio.run(_call_module() if module_path is not None else _call_tool())
    except Exception as e:
        _fail(str(e))
        sys.exit(1)


@cli.command()
@click.argument("commands")
@click.option("--server", help="Server to use (uses saved connection if omitted)")
@click.option("--stop-on-error", "-s", is_flag=True, help="Stop execution on first error")
@click.option(
    "--timeout",
    "-t",
    type=click.IntRange(min=0),
    default=30000,
    show_default=True,
    help="Timeout for the entire batch in milliseconds",
)
@click.option(
    "--parallel",
    "-p",
    type=click.IntRange(min=1),
    default=1,
    show_default=True,
    help="Maximum parallel commands (1 = sequential)",
)
@click.option(
    "--format",
    "-f",
    "output_format",
    type=click.Choice(["json", "text"]),
    default="text",
    show_default=True,
    help="Output format (--json also selects json)",
)
@click.option("--verbose", "-v", is_flag=True, help="Show detailed output for each command")
@_headers_option
@click.pass_context
def batch(
    ctx: click.Context,
    commands: str,
    server: str | None,
    stop_on_error: bool,
    timeout: int,
    parallel: int,
    output_format: str,
    verbose: bool,
    headers: tuple[str, ...],
) -> None:
    """
    Execute multiple commands in a single batch request.

    COMMANDS is a JSON array, [{"command":"name","input":{}},...], or the path
    of a .json file holding one. Exits 1 when the batch fails and 2 when some
    of its commands fail.

    \b
    Examples:
        afd batch '[{"command":"todo-create","input":{"title":"Task 1"}}]'
        afd batch ./commands.json --stop-on-error --verbose
    """
    from afd.cli.batch_stream import (
        SERVER_DEADLINE_MARGIN_S,
        batch_exit_code,
        batch_text,
        parse_batch_commands,
        run_batch,
    )

    json_output = ctx.obj.get("json_output", False) or output_format == "json"
    request_headers = _resolve_headers(headers)
    try:
        parsed = parse_batch_commands(commands)
    except (ValueError, OSError) as e:
        _fail(f"Invalid commands format: {e}")
        click.echo(
            '\nExpected format:\n  [{"command":"todo-create","input":{"title":"Task 1"}},...]'
            "\n\nOr provide a JSON file path:\n  afd batch ./commands.json",
            err=True,
        )
        sys.exit(1)

    # The batch deadline runs on the server: wait a margin past it for the answer, and
    # never less than the default request timeout, as TypeScript's client does.
    transport = _get_transport(
        server,
        on_elicitation=interactive_elicitation(_terminal_yes),
        timeout=max(30.0, timeout / 1000 + SERVER_DEADLINE_MARGIN_S),
        headers=request_headers,
    )

    async def _batch() -> dict[str, Any]:
        await transport.connect()
        try:
            return await run_batch(
                transport.call_tool,
                parsed,
                {
                    "stopOnError": stop_on_error,
                    "timeout": timeout,
                    "parallelism": parallel,
                },
            )
        finally:
            await transport.disconnect()

    try:
        result = asyncio.run(_batch())
    except Exception as e:
        _fail(f"Batch execution error: {e}")
        sys.exit(1)

    if json_output:
        click.echo(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        click.echo("\n".join(batch_text(result, verbose=verbose)))
    code = batch_exit_code(result)
    if code:
        sys.exit(code)


@cli.command()
@click.argument("name")
@click.argument("args", required=False, default="")
@click.option("--server", "-s", help="Server to use (uses saved connection if omitted)")
@click.option(
    "--timeout",
    "-t",
    type=click.IntRange(min=0),
    default=60000,
    show_default=True,
    help="Timeout in milliseconds (0: no deadline)",
)
@click.option(
    "--format",
    "-f",
    "output_format",
    type=click.Choice(["json", "text"]),
    default="text",
    show_default=True,
    help="Output format: json prints one chunk per line (--json also selects it)",
)
@click.option("--progress/--no-progress", default=True, help="Show or hide progress updates")
@_headers_option
@click.pass_context
def stream(
    ctx: click.Context,
    name: str,
    args: str,
    server: str | None,
    timeout: int,
    output_format: str,
    progress: bool,
    headers: tuple[str, ...],
) -> None:
    """
    Execute a command with streaming results (Ctrl+C to cancel).

    NAME is the command; ARGS is a JSON object or key=value pairs (quote values
    with spaces). The server must serve AFD's POST /stream/<command> next to its
    MCP endpoint, as the TypeScript server does. Exits 1 on an error chunk and
    130 when cancelled with Ctrl+C or SIGTERM.

    \b
    Examples:
        afd stream export-run format=csv
        afd stream export-run '{"format": "csv"}' --format json --no-progress
    """
    import signal

    from afd.cli.args import describe_args_error, parse_tool_args
    from afd.cli.batch_stream import EXIT_CANCELLED, StreamPrinter
    from afd.client import McpClient, McpClientConfig
    from afd.client_stream import stream_error_chunk

    json_output = ctx.obj.get("json_output", False) or output_format == "json"
    try:
        parsed_args = parse_tool_args(args)
    except ValueError as e:
        _fail(describe_args_error(e))
        sys.exit(1)
    request_headers = _resolve_headers(headers)

    url = server or _load_state().get("server")
    if url and (url == "mock" or url.startswith("mock:")):
        raise click.ClickException(
            "Streaming needs an HTTP server URL; the mock transport has no stream endpoint."
        )
    transport = _get_transport(url, headers=request_headers)

    def dump(chunk: dict[str, Any]) -> None:
        click.echo(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")))

    printer = StreamPrinter(show_progress=progress, write=lambda text: click.echo(text, nl=False))
    failed = False
    cancel: asyncio.Event | None = None

    async def _stream() -> None:
        nonlocal failed, cancel
        cancel = asyncio.Event()
        loop = asyncio.get_running_loop()
        handled = []
        for signum in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(signum, cancel.set)
                handled.append(signum)
            except (NotImplementedError, RuntimeError, ValueError):
                pass  # Windows: Ctrl+C arrives as KeyboardInterrupt instead.
        client = McpClient(
            McpClientConfig(url=str(url or ""), auto_reconnect=False, headers=request_headers),
            transport=transport,
        )
        try:
            await client.connect()
            if not json_output and progress:
                click.echo(
                    click.style(f"Streaming {terminal_text(name)}... (Ctrl+C to cancel)", dim=True)
                )
                click.echo()
            async for chunk in client.stream(
                name,
                parsed_args,
                timeout=timeout / 1000 if timeout else None,
                cancel=cancel,
                idle_timeout=None,  # -t bounds the stream, and -t 0 means no limit, as in TypeScript
            ):
                if json_output:
                    dump(chunk)
                    failed = failed or chunk.get("type") == "error"
                elif printer.handle(chunk):
                    failed = True
        finally:
            for signum in handled:
                loop.remove_signal_handler(signum)
            await client.disconnect()

    interrupted = False
    try:
        asyncio.run(_stream())
    except KeyboardInterrupt:
        interrupted = True
    except Exception as e:
        if json_output:
            dump(
                stream_error_chunk(
                    {
                        "code": "STREAM_FAILED",
                        "message": str(e),
                        "suggestion": "Check the connection and retry the stream",
                    },
                    0,
                    True,
                )
            )
        else:
            _fail(f"Stream failed: {e}")
        sys.exit(1)
    if interrupted or (cancel is not None and cancel.is_set()):
        printer.clear_progress()
        if not json_output:
            click.echo()
            click.echo(click.style("⚠ Stream cancelled by user", fg="yellow"))
        sys.exit(EXIT_CANCELLED)
    if failed:
        sys.exit(1)


@cli.command()
@click.pass_context
def status(ctx: click.Context) -> None:
    """
    Show current connection status.

    Displays the currently connected server and connection state.
    """
    json_output = ctx.obj.get("json_output", False)

    state = _load_state()
    server = state.get("server")

    if json_output:
        click.echo(
            json.dumps(
                {
                    "connected": server is not None,
                    "server": server,
                },
                indent=2,
            )
        )
        return

    if server:
        print_success(f"Connected to: {server}")
    else:
        print_info("Not connected to any server")
        print_info("Use 'afd connect <server>' to connect")


@cli.command()
@click.option("--server", "-s", help="Server to validate")
@click.option("--surface", is_flag=True, help="Run cross-command surface validation")
@click.option(
    "--similarity-threshold",
    type=float,
    default=0.7,
    show_default=True,
    help="Similarity threshold for surface validation",
)
@click.option(
    "--skip-category",
    multiple=True,
    help="Skip a category during surface validation (repeatable)",
)
@click.option(
    "--suppress",
    multiple=True,
    help="Suppress a surface validation rule or rule:command pair (repeatable)",
)
@click.option("--strict", is_flag=True, help="Treat warnings as errors in validation")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed validation output")
@_headers_option
@click.pass_context
def validate(
    ctx: click.Context,
    server: str | None,
    surface: bool,
    similarity_threshold: float,
    skip_category: tuple[str, ...],
    suppress: tuple[str, ...],
    strict: bool,
    verbose: bool,
    headers: tuple[str, ...],
) -> None:
    """
    Validate server connection/tools, or run cross-command surface validation.

    A mutation or destructive tool whose _meta has no approval policy gets a
    MISSING_APPROVAL_POLICY warning (an error with --strict).
    """
    json_output = ctx.obj.get("json_output", False)
    request_headers = _resolve_headers(headers)

    async def _validate_connection() -> None:
        transport = _get_transport(server, headers=request_headers)
        results: dict[str, Any] = {
            "connection": False,
            "tools_listed": False,
            "tool_count": 0,
            "errors": [],
        }

        try:
            await transport.connect()
            results["connection"] = True

            tools = await transport.list_tools()
            results["tools_listed"] = True
            results["tool_count"] = len(tools)
            warnings = [
                {"tool": tool.name, **warning}
                for tool in tools
                for warning in approval_policy_warnings(tool)
            ]
            results["warnings"] = warnings
            failed = strict and bool(warnings)

            if json_output:
                click.echo(json.dumps(results, indent=2))
            else:
                print_success("Connection: OK")
                print_success(f"Tools listed: {len(tools)}")
                for warning in warnings:
                    print_warning(f"{warning['tool']} {warning['path']}: {warning['message']}")
                if failed:
                    print_error("Validation failed: warnings are errors with --strict")
                else:
                    print_success("Validation passed!")
            if failed:
                sys.exit(1)

        except Exception as e:
            results["errors"].append(str(e))
            if json_output:
                click.echo(json.dumps(results, indent=2))
            else:
                _fail(f"Validation failed: {e}")
            sys.exit(1)
        finally:
            await transport.disconnect()

    async def _validate_surface() -> None:
        from afd.testing.surface.types import SurfaceValidationOptions

        transport = _get_transport(server, headers=request_headers)
        try:
            await transport.connect()
            commands, configured_contexts, source_warnings = await _load_surface_commands(transport)
            result = validate_command_surface(
                commands,
                SurfaceValidationOptions(
                    similarity_threshold=similarity_threshold,
                    skip_categories=list(skip_category),
                    suppressions=list(suppress),
                    strict=strict,
                    configured_contexts=configured_contexts or None,
                ),
            )

            if json_output:
                click.echo(
                    json.dumps(
                        {
                            "valid": result.valid,
                            "warnings": source_warnings,
                            "findings": [
                                {
                                    "rule": finding.rule,
                                    "severity": finding.severity,
                                    "message": finding.message,
                                    "commands": finding.commands,
                                    "suggestion": finding.suggestion,
                                    "suppressed": finding.suppressed,
                                    "evidence": finding.evidence,
                                }
                                for finding in result.findings
                            ],
                            "summary": {
                                "commandCount": result.summary.command_count,
                                "errorCount": result.summary.error_count,
                                "warningCount": result.summary.warning_count,
                                "infoCount": result.summary.info_count,
                                "suppressedCount": result.summary.suppressed_count,
                                "rulesEvaluated": result.summary.rules_evaluated,
                                "durationMs": result.summary.duration_ms,
                            },
                        },
                        indent=2,
                    )
                )
            else:
                for warning in source_warnings:
                    print_warning(warning)
                print_info(f"Surface validation analyzed {result.summary.command_count} commands")
                severity_buckets = {
                    "error": [
                        finding
                        for finding in result.findings
                        if not finding.suppressed and finding.severity == "error"
                    ],
                    "warning": [
                        finding
                        for finding in result.findings
                        if not finding.suppressed and finding.severity == "warning"
                    ],
                    "info": [
                        finding
                        for finding in result.findings
                        if not finding.suppressed and finding.severity == "info"
                    ],
                }
                for severity, findings in severity_buckets.items():
                    if not findings:
                        continue
                    if severity == "error":
                        print_error(f"{len(findings)} error finding(s)")
                    elif severity == "warning":
                        print_warning(f"{len(findings)} warning finding(s)")
                    else:
                        print_info(f"{len(findings)} info finding(s)")
                    for finding in findings:
                        # Findings quote command names and descriptions: print them as text.
                        console.print(plain(f"  [{severity}] {finding.rule}: {finding.message}"))
                        if verbose:
                            console.print(plain(f"    Commands: {', '.join(finding.commands)}"))
                            console.print(plain(f"    Fix: {finding.suggestion}"))
                            if finding.evidence:
                                evidence = json.dumps(finding.evidence, sort_keys=True)
                                console.print(plain(f"    Evidence: {evidence}"))

                if result.summary.suppressed_count:
                    print_info(f"{result.summary.suppressed_count} finding(s) suppressed")

                if result.valid and result.summary.warning_count == 0:
                    print_success("Surface validation passed!")
                elif result.valid:
                    print_warning("Surface validation passed with warnings")
                else:
                    print_error("Surface validation failed")
                    sys.exit(1)
        except Exception as e:
            _fail(f"Surface validation failed: {e}")
            sys.exit(1)
        finally:
            await transport.disconnect()

    try:
        asyncio.run(_validate_surface() if surface else _validate_connection())
    except Exception as e:
        _fail(str(e))
        sys.exit(1)


async def _load_surface_commands(
    transport: Transport,
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """Load the commands to validate, configured contexts, and warnings.

    Uses the bootstrap tools (afd-help, afd-schema) when they are listed, else the
    tool listing (grouped tools expanded, lazy servers enumerated with
    afd-discover). AFD's built-in tools are skipped either way.
    """
    tools = await transport.list_tools()
    tool_names = {tool.name for tool in tools}
    configured_contexts: list[str] = []

    if "afd-context-list" in tool_names:
        try:
            context_result = await transport.call_tool("afd-context-list", {})
            context_payload = (
                context_result.get("data", context_result)
                if isinstance(context_result, dict)
                else {}
            )
            configured_contexts = [
                item["name"]
                for item in context_payload.get("contexts", [])
                if isinstance(item, dict) and "name" in item
            ]
        except Exception:
            configured_contexts = []

    if "afd-help" in tool_names and "afd-schema" in tool_names:
        help_result = await transport.call_tool("afd-help", {"format": "full"})
        schema_result = await transport.call_tool("afd-schema", {"format": "json"})
        help_payload = help_result.get("data", help_result) if isinstance(help_result, dict) else {}
        schema_payload = (
            schema_result.get("data", schema_result) if isinstance(schema_result, dict) else {}
        )
        schema_map = {
            item["name"]: item
            for item in schema_payload.get("schemas", [])
            if isinstance(item, dict) and "name" in item
        }
        commands: list[dict[str, Any]] = []
        for item in help_payload.get("commands", []):
            if not isinstance(item, dict) or is_afd_builtin_name(str(item.get("name", ""))):
                continue
            schema = schema_map.get(item["name"], {})
            commands.append(
                {
                    "name": item["name"],
                    "description": item.get("description", ""),
                    "category": item.get("category"),
                    "jsonSchema": schema.get("input_schema") or schema.get("inputSchema"),
                    "outputJsonSchema": (schema.get("output_schema") or schema.get("outputSchema")),
                    "requires": item.get("requires"),
                    "contexts": item.get("contexts"),
                }
            )
        return commands, configured_contexts, []

    commands, warnings = await collect_surface_commands(transport, tools)
    return commands, configured_contexts, warnings


@cli.command()
@_headers_option
@click.pass_context
def shell(ctx: click.Context, headers: tuple[str, ...]) -> None:
    """
    Start an interactive shell.

    Provides a REPL for calling tools interactively. A call's arguments are a
    JSON object or key=value pairs. Use 'exit' or Ctrl+D to quit.
    """
    from rich.prompt import Prompt

    from afd.cli.args import describe_args_error, parse_tool_args

    request_headers = _resolve_headers(headers)

    state = _load_state()
    server = state.get("server")

    if not server:
        print_error("No server connected. Use 'afd connect <server>' first.")
        sys.exit(1)

    console.print(Text.assemble(("AFD Shell", "bold"), " - Connected to ", plain(server, "cyan")))
    console.print("[dim]Type 'help' for commands, 'exit' to quit[/dim]\n")

    async def _shell() -> None:
        transport = _get_transport(server, headers=request_headers)
        await transport.connect()

        try:
            while True:
                try:
                    line = Prompt.ask("[cyan]afd[/cyan]")
                except EOFError:
                    break

                line = line.strip()
                if not line:
                    continue

                if line in ("exit", "quit"):
                    break

                if line == "help":
                    console.print()
                    console.print(Text("Commands:", style="bold"))
                    console.print(
                        Text(
                            "  tools              List available tools\n"
                            "  call <tool> [args] Call a tool with a JSON object or key=value pairs\n"
                            "  help               Show this help\n"
                            "  exit               Exit the shell\n"
                        )
                    )
                    continue

                # A failed request prints its error and the prompt returns, as in
                # TypeScript's shell; only exit, quit or Ctrl+D end it.
                if line == "tools":
                    try:
                        print_tools(await transport.list_tools())
                    except Exception as e:
                        _fail(f"Listing tools failed: {e}")
                    continue

                if line.split(maxsplit=1)[0] == "call":
                    parts = line[4:].strip().split(maxsplit=1)
                    if not parts:
                        _fail("Usage: call <name> [args]")
                        continue
                    tool_name = parts[0]
                    try:
                        tool_args = parse_tool_args(parts[1] if len(parts) > 1 else "")
                    except ValueError as e:
                        _fail(describe_args_error(e))
                        continue

                    try:
                        result = await transport.call_tool(tool_name, tool_args)
                        print_result(result)
                    except Exception as e:
                        _fail(f"Call failed: {e}")
                    continue

                console.print(plain(f"Unknown command: {line}", "yellow"))

        finally:
            await transport.disconnect()

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_shell())

    console.print("\n[dim]Goodbye![/dim]")


def main() -> None:
    """Entry point for the CLI."""
    configure_stdio()
    cli()


if __name__ == "__main__":
    main()
