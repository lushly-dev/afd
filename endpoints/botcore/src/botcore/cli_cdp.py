"""CLI subcommands for ``botcore cdp`` — Chrome DevTools Protocol automation."""

from __future__ import annotations

import json
from typing import Any

import click


def _dispatch(ctx: click.Context, coro: Any) -> None:
    from botcore.cli import _format_result, _is_json, _run_async

    _format_result(_run_async(coro), _is_json(ctx))


_json_option = click.option(
    "--json",
    "json_mode",
    is_flag=True,
    default=False,
    help="Output as JSON",
)


@click.group("cdp")
@_json_option
def cdp_group(**_kwargs: Any) -> None:
    """Drive Chromium over Chrome DevTools Protocol (requires ``lushly-botcore[cdp]``)."""


# ── Session ──────────────────────────────────────────────────────────────────


@cdp_group.command("launch")
@click.option("--url", default=None, help="Initial URL to open")
@click.option("--headless", is_flag=True, default=False, help="Run Chromium headless")
@click.option("--port", type=int, default=None, help="Remote debugging port")
@click.option("--profile-dir", default=None, help="Chrome user-data directory")
@click.option("--force", is_flag=True, default=False, help="Overwrite an existing session file")
@_json_option
@click.pass_context
def cdp_launch_cmd(
    ctx: click.Context,
    url: str | None,
    headless: bool,
    port: int | None,
    profile_dir: str | None,
    force: bool,
    **_kwargs: Any,
) -> None:
    """Launch Chromium with CDP enabled."""
    from botcore.commands.cdp import cdp_launch

    _dispatch(
        ctx, cdp_launch(url=url, headless=headless, port=port, profile_dir=profile_dir, force=force)
    )


@cdp_group.command("attach")
@click.option("--endpoint", default=None, help="CDP HTTP endpoint URL")
@click.option("--port", type=int, default=None, help="Local CDP port")
@click.option("--profile-dir", default=None, help="Chrome user-data directory")
@click.option("--force", is_flag=True, default=False, help="Overwrite an existing session file")
@_json_option
@click.pass_context
def cdp_attach_cmd(
    ctx: click.Context,
    endpoint: str | None,
    port: int | None,
    profile_dir: str | None,
    force: bool,
    **_kwargs: Any,
) -> None:
    """Attach to an existing CDP endpoint."""
    from botcore.commands.cdp import cdp_attach

    _dispatch(
        ctx,
        cdp_attach(endpoint=endpoint, port=port, profile_dir=profile_dir, force=force),
    )


@cdp_group.command("close")
@_json_option
@click.pass_context
def cdp_close_cmd(ctx: click.Context, **_kwargs: Any) -> None:
    """Close the active CDP session."""
    from botcore.commands.cdp import cdp_close

    _dispatch(ctx, cdp_close())


# ── Navigation ───────────────────────────────────────────────────────────────


@cdp_group.command("navigate")
@click.argument("url")
@click.option("--wait-until", default="load", show_default=True)
@_json_option
@click.pass_context
def cdp_navigate_cmd(ctx: click.Context, url: str, wait_until: str, **_kwargs: Any) -> None:
    """Navigate the selected page to URL."""
    from botcore.commands.cdp import cdp_navigate

    _dispatch(ctx, cdp_navigate(url=url, wait_until=wait_until))


@cdp_group.command("wait")
@click.option("--selector", default=None)
@click.option("--ms", type=int, default=None)
@click.option("--hidden", is_flag=True, default=False)
@click.option("--text", default=None)
@click.option("--timeout-ms", type=int, default=30_000, show_default=True)
@_json_option
@click.pass_context
def cdp_wait_cmd(
    ctx: click.Context,
    selector: str | None,
    ms: int | None,
    hidden: bool,
    text: str | None,
    timeout_ms: int,
    **_kwargs: Any,
) -> None:
    """Wait for a selector, text, or timeout."""
    from botcore.commands.cdp import cdp_wait

    _dispatch(
        ctx, cdp_wait(selector=selector, ms=ms, hidden=hidden, text=text, timeout_ms=timeout_ms)
    )


# ── Interaction ──────────────────────────────────────────────────────────────


@cdp_group.command("click")
@click.argument("selector")
@click.option("--x", type=int, default=None)
@click.option("--y", type=int, default=None)
@click.option("--button", default="left", show_default=True)
@click.option("--double", is_flag=True, default=False)
@click.option("--ctrl", is_flag=True, default=False)
@click.option("--shift", is_flag=True, default=False)
@click.option("--alt", is_flag=True, default=False)
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_click_cmd(  # noqa: PLR0913 - mirrors cdp_click options
    ctx: click.Context,
    selector: str,
    x: int | None,
    y: int | None,
    button: str,
    double: bool,
    ctrl: bool,
    shift: bool,
    alt: bool,
    deep: bool,
    **_kwargs: Any,
) -> None:
    """Click an element."""
    from botcore.commands.cdp import cdp_click

    _dispatch(
        ctx,
        cdp_click(
            selector=selector,
            x=x,
            y=y,
            button=button,
            double=double,
            ctrl=ctrl,
            shift=shift,
            alt=alt,
            deep=deep,
        ),
    )


@cdp_group.command("hover")
@click.argument("selector")
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_hover_cmd(ctx: click.Context, selector: str, deep: bool, **_kwargs: Any) -> None:
    """Hover over an element."""
    from botcore.commands.cdp import cdp_hover

    _dispatch(ctx, cdp_hover(selector=selector, deep=deep))


@cdp_group.command("scroll")
@click.option("--selector", default=None)
@click.option("--x", type=int, default=None)
@click.option("--y", type=int, default=None)
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_scroll_cmd(
    ctx: click.Context,
    selector: str | None,
    x: int | None,
    y: int | None,
    deep: bool,
    **_kwargs: Any,
) -> None:
    """Scroll an element into view or scroll the page by offset."""
    from botcore.commands.cdp import cdp_scroll

    _dispatch(ctx, cdp_scroll(selector=selector, x=x, y=y, deep=deep))


@cdp_group.command("drag")
@click.argument("selector")
@click.option("--to", default=None)
@click.option("--dx", type=int, default=None)
@click.option("--dy", type=int, default=None)
@_json_option
@click.pass_context
def cdp_drag_cmd(
    ctx: click.Context,
    selector: str,
    to: str | None,
    dx: int | None,
    dy: int | None,
    **_kwargs: Any,
) -> None:
    """Drag an element to a target selector or by offset."""
    from botcore.commands.cdp import cdp_drag

    _dispatch(ctx, cdp_drag(selector=selector, to=to, dx=dx, dy=dy))


@cdp_group.command("type")
@click.argument("text")
@click.option("--selector", default=None)
@click.option("--delay-ms", type=int, default=0, show_default=True)
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_type_cmd(
    ctx: click.Context,
    text: str,
    selector: str | None,
    delay_ms: int,
    deep: bool,
    **_kwargs: Any,
) -> None:
    """Type text into the focused element or a selector."""
    from botcore.commands.cdp import cdp_type

    _dispatch(ctx, cdp_type(text=text, selector=selector, delay_ms=delay_ms, deep=deep))


@cdp_group.command("press")
@click.argument("key")
@click.option("--selector", default=None)
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_press_cmd(
    ctx: click.Context, key: str, selector: str | None, deep: bool, **_kwargs: Any
) -> None:
    """Press a key or key combination."""
    from botcore.commands.cdp import cdp_press

    _dispatch(ctx, cdp_press(key=key, selector=selector, deep=deep))


# ── Inspection ───────────────────────────────────────────────────────────────


@cdp_group.command("inspect")
@click.argument("selector")
@click.option("--prop", default=None)
@click.option("--attr", default=None)
@click.option("--style", default=None)
@click.option("--text", is_flag=True, default=False)
@click.option("--visible", is_flag=True, default=False)
@click.option("--enabled", is_flag=True, default=False)
@click.option("--focused", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_inspect_cmd(  # noqa: PLR0913 - mirrors cdp_inspect options
    ctx: click.Context,
    selector: str,
    prop: str | None,
    attr: str | None,
    style: str | None,
    text: bool,
    visible: bool,
    enabled: bool,
    focused: bool,
    **_kwargs: Any,
) -> None:
    """Inspect element properties, attributes, styles, and state."""
    from botcore.commands.cdp import cdp_inspect

    _dispatch(
        ctx,
        cdp_inspect(
            selector=selector,
            prop=prop,
            attr=attr,
            style=style,
            text=text,
            visible=visible,
            enabled=enabled,
            focused=focused,
        ),
    )


@cdp_group.command("query")
@click.argument("selector")
@click.option("--deep/--no-deep", default=True, show_default=True)
@_json_option
@click.pass_context
def cdp_query_cmd(ctx: click.Context, selector: str, deep: bool, **_kwargs: Any) -> None:
    """Query elements matching selector."""
    from botcore.commands.cdp import cdp_query

    _dispatch(ctx, cdp_query(selector=selector, deep=deep))


@cdp_group.command("snapshot")
@click.option("--root-selector", default=None)
@_json_option
@click.pass_context
def cdp_snapshot_cmd(ctx: click.Context, root_selector: str | None, **_kwargs: Any) -> None:
    """Take an ARIA accessibility snapshot."""
    from botcore.commands.cdp import cdp_snapshot

    _dispatch(ctx, cdp_snapshot(root_selector=root_selector))


# ── Forms and tabs ───────────────────────────────────────────────────────────


@cdp_group.command("fill")
@click.argument("selector")
@click.argument("value")
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_fill_cmd(ctx: click.Context, selector: str, value: str, deep: bool, **_kwargs: Any) -> None:
    """Fill an input element."""
    from botcore.commands.cdp import cdp_fill

    _dispatch(ctx, cdp_fill(selector=selector, value=value, deep=deep))


@cdp_group.command("fill-form")
@click.argument("fields_json")
@_json_option
@click.pass_context
def cdp_fill_form_cmd(ctx: click.Context, fields_json: str, **_kwargs: Any) -> None:
    """Fill multiple form fields from a JSON object of selector -> value."""
    from botcore.commands.cdp import cdp_fill_form

    try:
        fields = json.loads(fields_json)
    except ValueError as exc:
        raise click.BadParameter(f"fields_json must be valid JSON: {exc}") from exc
    if not isinstance(fields, dict):
        raise click.BadParameter("fields_json must be a JSON object")
    _dispatch(ctx, cdp_fill_form(fields={str(k): str(v) for k, v in fields.items()}))


@cdp_group.command("upload")
@click.argument("selector")
@click.argument("file_path")
@click.option("--deep", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_upload_cmd(
    ctx: click.Context, selector: str, file_path: str, deep: bool, **_kwargs: Any
) -> None:
    """Upload a file via a file input element."""
    from botcore.commands.cdp import cdp_upload

    _dispatch(ctx, cdp_upload(selector=selector, file_path=file_path, deep=deep))


@cdp_group.command("handle-dialog")
@click.option("--action", default="accept", show_default=True)
@click.option("--prompt-text", default=None)
@_json_option
@click.pass_context
def cdp_handle_dialog_cmd(
    ctx: click.Context, action: str, prompt_text: str | None, **_kwargs: Any
) -> None:
    """Attach a dialog handler on the current connection."""
    from botcore.commands.cdp import cdp_handle_dialog

    _dispatch(ctx, cdp_handle_dialog(action=action, prompt_text=prompt_text))


@cdp_group.command("list-pages")
@_json_option
@click.pass_context
def cdp_list_pages_cmd(ctx: click.Context, **_kwargs: Any) -> None:
    """List open pages/tabs."""
    from botcore.commands.cdp import cdp_list_pages

    _dispatch(ctx, cdp_list_pages())


@cdp_group.command("select-page")
@click.argument("index", type=int)
@_json_option
@click.pass_context
def cdp_select_page_cmd(ctx: click.Context, index: int, **_kwargs: Any) -> None:
    """Select a page by index for subsequent commands."""
    from botcore.commands.cdp import cdp_select_page

    _dispatch(ctx, cdp_select_page(index=index))


@cdp_group.command("new-page")
@click.option("--url", default=None)
@_json_option
@click.pass_context
def cdp_new_page_cmd(ctx: click.Context, url: str | None, **_kwargs: Any) -> None:
    """Open a new page/tab."""
    from botcore.commands.cdp import cdp_new_page

    _dispatch(ctx, cdp_new_page(url=url))


@cdp_group.command("close-page")
@click.argument("index", type=int, default=0)
@_json_option
@click.pass_context
def cdp_close_page_cmd(ctx: click.Context, index: int, **_kwargs: Any) -> None:
    """Close a page by index."""
    from botcore.commands.cdp import cdp_close_page

    _dispatch(ctx, cdp_close_page(index=index))


@cdp_group.command("resize")
@click.argument("width", type=int)
@click.argument("height", type=int)
@_json_option
@click.pass_context
def cdp_resize_cmd(ctx: click.Context, width: int, height: int, **_kwargs: Any) -> None:
    """Resize the viewport and persist it in the session."""
    from botcore.commands.cdp import cdp_resize

    _dispatch(ctx, cdp_resize(width=width, height=height))


# ── Diagnostics and traces ───────────────────────────────────────────────────


@cdp_group.command("screenshot")
@click.option("--path", default=None)
@click.option("--full-page", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_screenshot_cmd(
    ctx: click.Context, path: str | None, full_page: bool, **_kwargs: Any
) -> None:
    """Capture a screenshot of the selected page."""
    from botcore.commands.cdp import cdp_screenshot

    _dispatch(ctx, cdp_screenshot(path=path, full_page=full_page))


@cdp_group.command("console")
@click.option("--tail", type=int, default=None)
@click.option("--level", default=None)
@click.option("--grep", default=None)
@click.option("--clear", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_console_cmd(
    ctx: click.Context,
    tail: int | None,
    level: str | None,
    grep: str | None,
    clear: bool,
    **_kwargs: Any,
) -> None:
    """Show captured console entries."""
    from botcore.commands.cdp import cdp_console

    _dispatch(ctx, cdp_console(tail=tail, level=level, grep=grep, clear=clear))


@cdp_group.command("get-console-message")
@click.argument("index", type=int)
@_json_option
@click.pass_context
def cdp_get_console_message_cmd(ctx: click.Context, index: int, **_kwargs: Any) -> None:
    """Get a specific console entry by index."""
    from botcore.commands.cdp import cdp_get_console_message

    _dispatch(ctx, cdp_get_console_message(index=index))


@cdp_group.command("eval")
@click.argument("expression")
@_json_option
@click.pass_context
def cdp_eval_cmd(ctx: click.Context, expression: str, **_kwargs: Any) -> None:
    """Evaluate a JavaScript expression in the selected page."""
    from botcore.commands.cdp import cdp_eval

    _dispatch(ctx, cdp_eval(expression=expression))


@cdp_group.command("list-network")
@click.option("--resource-type", default=None)
@click.option("--limit", type=int, default=50, show_default=True)
@_json_option
@click.pass_context
def cdp_list_network_cmd(
    ctx: click.Context, resource_type: str | None, limit: int, **_kwargs: Any
) -> None:
    """List network requests from the page's Performance Resource Timing API."""
    from botcore.commands.cdp import cdp_list_network

    _dispatch(ctx, cdp_list_network(resource_type=resource_type, limit=limit))


@cdp_group.command("get-network")
@click.argument("url_pattern")
@_json_option
@click.pass_context
def cdp_get_network_cmd(ctx: click.Context, url_pattern: str, **_kwargs: Any) -> None:
    """Get network requests matching a URL regex pattern."""
    from botcore.commands.cdp import cdp_get_network

    _dispatch(ctx, cdp_get_network(url_pattern=url_pattern))


@cdp_group.command("emulate")
@click.option("--color-scheme", default=None)
@click.option("--viewport", default=None)
@click.option("--user-agent", default=None)
@click.option("--offline", is_flag=True, default=False)
@click.option("--cpu-throttle", type=float, default=None)
@click.option("--reset", is_flag=True, default=False)
@_json_option
@click.pass_context
def cdp_emulate_cmd(  # noqa: PLR0913 - mirrors cdp_emulate options
    ctx: click.Context,
    color_scheme: str | None,
    viewport: str | None,
    user_agent: str | None,
    offline: bool,
    cpu_throttle: float | None,
    reset: bool,
    **_kwargs: Any,
) -> None:
    """Emulate device/browser features and persist them in the session."""
    from botcore.commands.cdp import cdp_emulate

    _dispatch(
        ctx,
        cdp_emulate(
            color_scheme=color_scheme,
            viewport=viewport,
            user_agent=user_agent,
            offline=offline,
            cpu_throttle=cpu_throttle,
            reset=reset,
        ),
    )


@cdp_group.command("trace-capture")
@click.option("--url", default=None)
@click.option("--path", default=None)
@click.option("--name", default=None)
@click.option("--wait-until", default="load", show_default=True)
@click.option("--settle-ms", type=int, default=0, show_default=True)
@click.option("--categories", default=None)
@click.option("--stream-format", default="json", show_default=True)
@click.option("--stream-compression", default="none", show_default=True)
@click.option("--timeout-ms", type=int, default=30_000, show_default=True)
@_json_option
@click.pass_context
def cdp_trace_capture_cmd(  # noqa: PLR0913 - mirrors cdp_trace_capture options
    ctx: click.Context,
    url: str | None,
    path: str | None,
    name: str | None,
    wait_until: str,
    settle_ms: int,
    categories: str | None,
    stream_format: str,
    stream_compression: str,
    timeout_ms: int,
    **_kwargs: Any,
) -> None:
    """Capture a Chrome DevTools performance trace."""
    from botcore.commands.cdp import cdp_trace_capture

    _dispatch(
        ctx,
        cdp_trace_capture(
            url=url,
            path=path,
            name=name,
            wait_until=wait_until,
            settle_ms=settle_ms,
            categories=categories,
            stream_format=stream_format,
            stream_compression=stream_compression,
            timeout_ms=timeout_ms,
        ),
    )


@cdp_group.command("trace-summary")
@click.argument("path")
@click.option("--long-task-threshold-ms", type=float, default=50.0, show_default=True)
@click.option("--top-limit", type=int, default=10, show_default=True)
@_json_option
@click.pass_context
def cdp_trace_summary_cmd(
    ctx: click.Context,
    path: str,
    long_task_threshold_ms: float,
    top_limit: int,
    **_kwargs: Any,
) -> None:
    """Summarize a captured Chrome DevTools trace."""
    from botcore.commands.cdp import cdp_trace_summary

    _dispatch(
        ctx,
        cdp_trace_summary(
            path=path,
            long_task_threshold_ms=long_task_threshold_ms,
            top_slices_limit=top_limit,
        ),
    )


@cdp_group.command("trace-query")
@click.argument("path")
@click.argument("sql")
@click.option("--limit", type=int, default=100, show_default=True)
@_json_option
@click.pass_context
def cdp_trace_query_cmd(
    ctx: click.Context, path: str, sql: str, limit: int, **_kwargs: Any
) -> None:
    """Query a captured Chrome DevTools trace with PerfettoSQL."""
    from botcore.commands.cdp import cdp_trace_query

    _dispatch(ctx, cdp_trace_query(path=path, sql=sql, limit=limit))
