"""CLI subcommand ``botcore docs`` — the docs topics the local server's docs tool serves."""

from __future__ import annotations

import click

# The name ``botcore serve`` gives its server by default, so the overview's heading matches.
_SERVER_NAME = "botcore"


def _load_docs() -> dict[str, str]:
    """Build the topics exactly as ``create_mcp_server`` does: core docs plus every plugin's."""
    from botcore.server import build_docs, build_namespace

    _, registry = build_namespace()
    return build_docs(registry)


@click.command("docs")
@click.argument("topic", required=False, default=None)
@click.option("--json", "json_mode", is_flag=True, default=False, help="Output as JSON")
@click.pass_context
def docs_command(ctx: click.Context, topic: str | None, json_mode: bool) -> None:
    """Print a docs topic: the text the botcore server's docs tool returns for it.

    With no TOPIC, list every topic with its first line (the same as TOPIC `overview`).
    The topics are botcore's own (dev, pr, skill, disk and more) and each installed
    plugin's; run `botcore docs` to see them.
    """
    from afd import error, success

    from botcore.cli import _format_result, _is_json
    from botcore.server import render_docs_topic

    docs = _load_docs()
    name = "overview" if topic is None else topic
    text, found = render_docs_topic(docs, name, name=_SERVER_NAME)
    as_json = json_mode or _is_json(ctx)
    if not found:
        failed = error("UNKNOWN_TOPIC", text, suggestion="Run `botcore docs` to list the topics.")
        _format_result(failed, as_json)  # exits 1
    elif as_json:
        _format_result(success({"topic": name, "text": text}), True)
    else:
        click.echo(text)
