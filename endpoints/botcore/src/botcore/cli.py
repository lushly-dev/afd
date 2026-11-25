"""CLI entry point for botcore — thin Click wrapper over async commands."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import click

import botcore

_SUPPORTED_LANGUAGES = ["python", "typescript", "rust"]

# ── Helpers ──────────────────────────────────────────────────────────────────


def _run_async(coro: Any) -> Any:
    """Bridge async commands to sync Click handlers."""
    try:
        return asyncio.run(coro)
    except RuntimeError as exc:
        if "cannot be called from a running event loop" in str(exc):
            click.secho(
                "Error: botcore CLI cannot run inside an existing event loop "
                "(e.g. Jupyter). Use the Python API directly instead.",
                fg="red",
                err=True,
            )
            sys.exit(1)
        raise


def _is_json(ctx: click.Context) -> bool:
    """Check if JSON output is requested on this command or any enclosing Click group."""
    current: click.Context | None = ctx
    while current is not None:
        if current.params.get("json_mode"):
            return True
        current = current.parent
    return False


def _to_dict(result: Any) -> Any:
    """Normalize an afd ``CommandResult`` (Pydantic model) to a plain dict."""
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json", exclude_none=True)
    return result


def _is_error(result: Any) -> bool:
    """True for a failed CommandResult (``success: False``) or a legacy error dict."""
    if not isinstance(result, dict):
        return False
    return result.get("success") is False or result.get("status") == "error"


def _format_result(result: Any, json_mode: bool) -> None:
    """Format a CommandResult for output and set exit code."""
    result = _to_dict(result)
    failed = _is_error(result)
    if json_mode:
        click.echo(json.dumps(result, indent=2, default=str))
        if failed:
            sys.exit(1)
        return
    if not isinstance(result, dict):
        click.echo(result)
        return
    if failed:
        err = result.get("error", "unknown")
        suggestion = result.get("suggestion")
        if isinstance(err, dict):
            code, message = err.get("code"), err.get("message", "unknown")
            suggestion = err.get("suggestion") or suggestion
            err = f"{code}: {message}" if code else message
        click.secho(f"Error: {err}", fg="red", err=True)
        if suggestion:
            click.secho(f"  Hint: {suggestion}", fg="yellow", err=True)
        sys.exit(1)
    data = result.get("data")
    if data is not None:
        click.echo(json.dumps(data, indent=2, default=str))
    else:
        click.echo(json.dumps(result, indent=2, default=str))


# ── TOML generation ─────────────────────────────────────────────────────────

_EXTENSION_EXTRAS = {
    "agents": "lushly-botcore-agents",
    "llm": "lushly-botcore-llm",
    "memory": "lushly-botcore-memory",
}


def _generate_toml(language: str | None, tools: dict[str, str]) -> str:
    """Generate a botcore.toml config file."""
    lines = ["# botcore configuration", "# https://github.com/lushly-dev/botcore", ""]

    if language:
        lines.append(f'language = "{language}"')
    if tools.get("linter"):
        lines.append(f'linter = "{tools["linter"]}"')
    if tools.get("test_runner"):
        lines.append(f'test_runner = "{tools["test_runner"]}"')
    if tools.get("formatter"):
        lines.append(f'formatter = "{tools["formatter"]}"')

    lines.append("")
    lines.append("[skills]")
    lines.append('source_dir = ".claude/skills"')
    lines.append("")

    return "\n".join(lines)


def _select_extensions(
    non_interactive: bool,
    *,
    with_agents: bool = False,
    with_llm: bool = False,
    with_memory: bool = False,
) -> list[str]:
    """Resolve extension selections from flags or interactive prompts."""
    if non_interactive:
        flags = {"agents": with_agents, "llm": with_llm, "memory": with_memory}
        return [name for name, enabled in flags.items() if enabled]
    selected: list[str] = []
    for ext_name in _EXTENSION_EXTRAS:
        if click.confirm(f"Include {ext_name} extension?", default=False):
            selected.append(ext_name)
    return selected


# ── Shared option ────────────────────────────────────────────────────────────

_json_option = click.option(
    "--json",
    "json_mode",
    is_flag=True,
    default=False,
    help="Output as JSON",
)

# ── CLI Group ────────────────────────────────────────────────────────────────


@click.group()
@click.version_option(version=botcore.__version__, prog_name="botcore")
@_json_option
@click.pass_context
def cli(ctx: click.Context, json_mode: bool) -> None:
    """botcore — shared bot infrastructure for config, plugins, and commands."""
    ctx.ensure_object(dict)
    ctx.obj["json"] = json_mode

    # Discover plugins and wire middleware into the registry
    from botcore.plugin import PluginRegistry, discover_plugins
    from botcore.registry import registry, set_plugin_middleware

    plugins = discover_plugins()
    plugin_reg = PluginRegistry()
    for plugin in plugins.values():
        plugin.register(plugin_reg)
    # Register plugin commands
    for cmd_fn in plugin_reg.commands:
        registry.register(cmd_fn.__name__, cmd_fn)
    # Wire plugin middleware
    if plugin_reg.middleware:
        set_plugin_middleware(plugin_reg.middleware)


# ── init ─────────────────────────────────────────────────────────────────────


@cli.command()
@click.option("--non-interactive", is_flag=True, default=False, help="Accept all defaults")
@click.option(
    "--language",
    "-l",
    default=None,
    type=click.Choice(_SUPPORTED_LANGUAGES, case_sensitive=False),
    help="Override detected language",
)
@click.option("--no-skills", is_flag=True, default=False, help="Skip skill seeding")
@click.option("--force", is_flag=True, default=False, help="Overwrite existing botcore.toml")
@click.option("--with-agents", is_flag=True, default=False, help="Include agents extension info")
@click.option("--with-llm", is_flag=True, default=False, help="Include LLM extension info")
@click.option("--with-memory", is_flag=True, default=False, help="Include memory extension info")
@_json_option
@click.pass_context
def init(
    ctx: click.Context,
    non_interactive: bool,
    language: str | None,
    no_skills: bool,
    force: bool,
    with_agents: bool,
    with_llm: bool,
    with_memory: bool,
    **_kwargs: Any,
) -> None:
    """Initialize a botcore project with config and skills."""
    from pathlib import Path

    from botcore.config import _TOOL_DEFAULTS
    from botcore.utils.workspace import detect_language, find_workspace

    json_out = _is_json(ctx)
    ws = find_workspace() or Path.cwd()
    config_path = ws / "botcore.toml"

    # Check for existing config
    if config_path.exists() and not force:
        if json_out:
            click.echo(
                json.dumps(
                    {
                        "status": "skipped",
                        "config_path": str(config_path),
                        "reason": "already exists (use --force to overwrite)",
                    },
                    indent=2,
                )
            )
        else:
            click.echo(f"botcore.toml already exists at {config_path}")
            click.echo("Use --force to overwrite.")
        return

    # Detect language
    detected = detect_language(ws)
    lang: str | None
    if language:
        lang = language
    elif non_interactive:
        lang = detected
    else:
        default_lang = detected or "python"
        lang = click.prompt(
            "Detected language",
            default=default_lang,
            type=click.Choice(_SUPPORTED_LANGUAGES, case_sensitive=False),
        )

    tools = _TOOL_DEFAULTS.get(lang, {}) if lang else {}

    # Extension preferences
    extensions_selected = _select_extensions(
        non_interactive,
        with_agents=with_agents,
        with_llm=with_llm,
        with_memory=with_memory,
    )

    # Generate config
    toml_content = _generate_toml(lang, tools)
    config_path.write_text(toml_content, encoding="utf-8")

    # Seed skills
    skills_seeded = 0
    if not no_skills:
        from botcore.commands.skill.seed import skill_seed

        try:
            result = _to_dict(_run_async(skill_seed()))
            if isinstance(result, dict) and not _is_error(result):
                data = result.get("data") or {}
                skills_seeded = len(data.get("seeded", []))
        except Exception as exc:
            if not json_out:
                click.secho(f"  Warning: skill seeding failed: {exc}", fg="yellow", err=True)

    # Extension install commands
    extensions_available = {name: f"pip install {pkg}" for name, pkg in _EXTENSION_EXTRAS.items()}

    if json_out:
        click.echo(
            json.dumps(
                {
                    "status": "success",
                    "config_path": str(config_path),
                    "language": lang,
                    "skills_seeded": skills_seeded,
                    "extensions_selected": extensions_selected,
                    "extensions_available": extensions_available,
                },
                indent=2,
            )
        )
    else:
        click.secho(f"Created {config_path}", fg="green")
        click.echo(f"  Language: {lang or 'none detected'}")
        if tools:
            click.echo(f"  Linter: {tools.get('linter', 'none')}")
            click.echo(f"  Test runner: {tools.get('test_runner', 'none')}")
            click.echo(f"  Formatter: {tools.get('formatter', 'none')}")
        if skills_seeded:
            click.echo(f"  Skills seeded: {skills_seeded}")

        if extensions_selected:
            click.echo("\nTo install selected extensions:")
            for ext in extensions_selected:
                click.echo(f"  pip install {_EXTENSION_EXTRAS[ext]}")

        click.echo("\nNext steps:")
        click.echo("  botcore serve    # Start MCP server")
        click.echo("  botcore info     # Show workspace info")


# ── serve ────────────────────────────────────────────────────────────────────


@cli.command()
@click.option("--name", default="botcore", help="Server name")
@click.option(
    "--transport",
    default="stdio",
    type=click.Choice(["stdio", "sse"], case_sensitive=False),
    help="Transport: stdio. sse is refused, since the server runs any Python its client sends",
)
def serve(name: str, transport: str) -> None:
    """Start the trusted-local botcore MCP server over stdio.

    Its run tool executes any Python its client sends, with your permissions, so it serves only
    the client that started it, over stdio. To serve commands over HTTP, serve a managed host
    with botcore.host_http (create_host_http_app, run with serve_hosts) and bearer tokens from
    `botcore host-token issue` (docs/host-composition.md).
    """
    if transport.lower() != "stdio":
        click.secho(
            "Error: botcore serve runs any Python its client sends, so it serves only over stdio, "
            "to the client that started it. To serve commands over HTTP, serve a managed "
            "host with botcore.host_http (create_host_http_app, run with serve_hosts), which "
            "checks bearer tokens from `botcore host-token issue` (docs/host-composition.md).",
            fg="red",
            err=True,
        )
        sys.exit(2)
    try:
        from botcore.server import create_mcp_server

        server = create_mcp_server(name, version=botcore.__version__)
        server.run(transport=transport)
    except ImportError:
        click.secho(
            "Error: MCP dependencies not installed. Run: pip install 'lushly-botcore[mcp]'",
            fg="red",
            err=True,
        )
        sys.exit(1)
    except KeyboardInterrupt:
        pass


# ── host-token ───────────────────────────────────────────────────────────────


@cli.group("host-token")
def host_token() -> None:
    """Issue, list and revoke bearer tokens for a host served over HTTP.

    Run on the serving machine as the operator. The store holds only each token's digest;
    an issued token is printed once.
    """


_store_option = click.option(
    "--store",
    "store",
    required=True,
    type=click.Path(dir_okay=False, path_type=Path),
    help="The token store file the server reads",
)


@host_token.command("issue")
@_store_option
@click.option("--route", required=True, help="The one route the token opens")
@click.option(
    "--kind", required=True, type=click.Choice(["human", "agent", "service"]), help="Actor kind"
)
@click.option("--actor", "actor_id", required=True, help="Actor id, such as lane@random")
@click.option("--label", default=None, help="A readable name for the actor")
def host_token_issue(store: Path, route: str, kind: str, actor_id: str, label: str | None) -> None:
    """Issue a token; prints it once."""
    from botcore.host_tokens import TokenStore

    record, secret = TokenStore(store).issue(route, kind, actor_id, label)
    click.echo(json.dumps({**record.public(), "token": secret}, indent=2))


@host_token.command("list")
@_store_option
def host_token_list(store: Path) -> None:
    """List tokens without their secrets."""
    from botcore.host_tokens import TokenStore

    click.echo(json.dumps([r.public() for r in TokenStore(store).list()], indent=2))


@host_token.command("revoke")
@_store_option
@click.argument("token_id")
def host_token_revoke(store: Path, token_id: str) -> None:
    """Revoke TOKEN_ID; the server refuses it from its next call."""
    from botcore.host_tokens import TokenStore

    record = TokenStore(store).revoke(token_id)
    if record is None:
        click.secho(f"No token {token_id}", fg="red", err=True)
        sys.exit(1)
    click.echo(json.dumps(record.public(), indent=2))


# ── Command wrappers ─────────────────────────────────────────────────────────


@cli.command("skill-seed")
@click.option("--update", is_flag=True, default=False, help="Update existing managed skills")
@click.option("--dry-run", is_flag=True, default=False, help="Show what would be done")
@_json_option
@click.pass_context
def skill_seed_cmd(ctx: click.Context, update: bool, dry_run: bool, **_kwargs: Any) -> None:
    """Seed bundled skills into the project."""
    from botcore.commands.skill.seed import skill_seed

    result = _run_async(skill_seed(update=update, dry_run=dry_run))
    _format_result(result, _is_json(ctx))


@cli.command("skill-list")
@click.option("--show-source", is_flag=True, default=False, help="Show skill source info")
@_json_option
@click.pass_context
def skill_list_cmd(ctx: click.Context, show_source: bool, **_kwargs: Any) -> None:
    """List available and installed skills."""
    from botcore.commands.skill.list import skill_list

    result = _run_async(skill_list(show_source=show_source))
    _format_result(result, _is_json(ctx))


@cli.command("skill-status")
@_json_option
@click.pass_context
def skill_status_cmd(ctx: click.Context, **_kwargs: Any) -> None:
    """Show skill version drift status."""
    from botcore.commands.skill.status import skill_status

    result = _run_async(skill_status())
    _format_result(result, _is_json(ctx))


@cli.command("skill-lint")
@click.argument("path", required=False, default=None)
@_json_option
@click.pass_context
def skill_lint_cmd(ctx: click.Context, path: str | None, **_kwargs: Any) -> None:
    """Lint SKILL.md files under PATH (default: current directory), rules SK001-SK020."""
    from botcore.commands.skill_lint import skill_lint_spec

    result = _run_async(skill_lint_spec(path=path))
    _format_result(result, _is_json(ctx))


@cli.command("skill-usage-collect")
@click.option(
    "--since-days",
    type=int,
    default=None,
    help="Re-read this many days instead of continuing from the last collection",
)
@click.option(
    "--t3-store", default=None, help="Read this T3 Code store, not this machine's (needs --machine)"
)
@click.option("--machine", default=None, help="The machine a copied store came from")
@click.option(
    "--rebuild",
    is_flag=True,
    default=False,
    help="Read everything again and replace what an older botcore recognised",
)
@_json_option
@click.pass_context
def skill_usage_collect_cmd(  # noqa: PLR0913 - the command's options
    ctx: click.Context,
    since_days: int | None,
    t3_store: str | None,
    machine: str | None,
    rebuild: bool,
    **_kwargs: Any,
) -> None:
    """Add the skill loads the harnesses recorded to this machine's record."""
    from botcore.commands.skill_usage import skill_usage_collect

    result = _run_async(
        skill_usage_collect(
            since_days=since_days, t3_store=t3_store, machine=machine, rebuild=rebuild
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("skill-usage-report")
@click.option("--days", type=int, default=30, show_default=True, help="Days to report")
@click.option("--project", default=None, help="Only this project (owner/name, or its name)")
@click.option("--harness", default=None, help="Only this harness: claude or codex")
@click.option("--skill", default=None, help="Only this skill")
@click.option("--agent", default=None, help="Only loads by main, delegate or subagent")
@click.option(
    "--ending-days-ago",
    type=int,
    default=0,
    show_default=True,
    help="End the window this many days ago, to compare two periods",
)
@click.option("--limit", type=int, default=50, show_default=True, help="Skills to list")
@_json_option
@click.pass_context
def skill_usage_report_cmd(  # noqa: PLR0913 - the command's options
    ctx: click.Context,
    days: int,
    project: str | None,
    harness: str | None,
    skill: str | None,
    agent: str | None,
    ending_days_ago: int,
    limit: int,
    **_kwargs: Any,
) -> None:
    """Report which skills were used, how often, and by which harness. Read-only."""
    from botcore.commands.skill_usage import skill_usage_report

    result = _run_async(
        skill_usage_report(
            days=days,
            project=project,
            harness=harness,
            ending_days_ago=ending_days_ago,
            skill=skill,
            agent=agent,
            limit=limit,
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("skill-usage-triggers")
@click.option("--days", type=int, default=30, show_default=True, help="Days to report")
@click.option(
    "--repo",
    default=None,
    help="The repository's checkout (default: the one holding the working directory)",
)
@_json_option
@click.pass_context
def skill_usage_triggers_cmd(
    ctx: click.Context,
    days: int,
    repo: str | None,
    **_kwargs: Any,
) -> None:
    """Report the merged changes whose opener had not loaded a required skill. Read-only."""
    from botcore.commands.skill_usage import skill_usage_triggers

    result = _run_async(skill_usage_triggers(days=days, repo=repo))
    _format_result(result, _is_json(ctx))


@cli.command("gate-outcome-collect")
@click.option(
    "--since-days",
    type=click.IntRange(1, 365),
    default=7,
    show_default=True,
    help="Whole UTC days to collect, today included: 1 to 365",
)
@click.option(
    "--source",
    "sources",
    multiple=True,
    help="What to read; repeat for several. ci (the Actions runs) and main (the fix commits "
    "and reverts on the default branch, and the issues they close); reviews and runs are "
    "refused. Default: ci",
)
@click.option(
    "--requests",
    type=click.IntRange(1, 5000),
    default=1000,
    show_default=True,
    help="The most GitHub requests to make: 1 to 5000. It also stops when the account's "
    "hourly allowance is down to half",
)
@click.option(
    "--rebuild",
    is_flag=True,
    default=False,
    help="Ask GitHub again for everything in the window, whatever the record holds",
)
@_json_option
@click.pass_context
def gate_outcome_collect_cmd(
    ctx: click.Context,
    since_days: int,
    sources: tuple[str, ...],
    requests: int,
    rebuild: bool,
    **_kwargs: Any,
) -> None:
    """Read this checkout's repository's workflow runs from GitHub, or the fix commits on its
    default branch, into the gate outcome record."""
    from botcore.commands.gate_outcome import gate_outcome_collect

    result = _run_async(
        gate_outcome_collect(
            since_days=since_days,
            sources=list(sources) or None,
            requests=requests,
            rebuild=rebuild,
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("gate-outcome-report")
@click.option(
    "--days",
    type=click.IntRange(1, 365),
    default=7,
    show_default=True,
    help="Whole UTC days in the window: 1 to 365",
)
@click.option(
    "--ending-days-ago",
    type=click.IntRange(0, 365),
    default=0,
    show_default=True,
    help="The window's last day is this many days before today: 0 to 365",
)
@click.option(
    "--by",
    type=click.Choice(["workflow", "check", "area", "class", "decision"]),
    default="workflow",
    show_default=True,
    help="Rows by workflow, or by check (a step of a job, or a command of a hook group step), "
    "and event, or by area (the fix commits on the default branch by the unit that holds "
    "their files); class and decision are refused until a botcore reports them",
)
@click.option(
    "--where",
    type=click.Choice(
        ["pull_request", "merge_group", "schedule", "push", "workflow_dispatch", "local"]
    ),
    default=None,
    help="Only runs of this event (local is refused until it is collected); default: all five",
)
@click.option("--workflow", default=None, help="Only this workflow, by its name or its file")
@click.option(
    "--check",
    default=None,
    help="Only this check, by its id as written: '<workflow file> / <job> / <step>' with "
    "' / <command>' inside a hook group step (with --by check)",
)
@click.option(
    "--area",
    default=None,
    help="Only this area, with --by area: a unit's folder (packages/core), repository or "
    "several; its commits are listed with the issues each closes",
)
@click.option("--finding-class", default=None, help="The plan's filter for --by class")
@click.option("--decision", default=None, help="The plan's filter for --by class and decision")
@click.option("--pull-request", type=int, default=None, help="The plan's filter for --by class")
@click.option("--due/--not-due", default=None, help="The plan's filter for --by decision")
@click.option(
    "--sort",
    type=click.Choice(["minutes", "failed", "runs"]),
    default="minutes",
    show_default=True,
    help="Row order, largest first",
)
@click.option(
    "--limit",
    type=click.IntRange(1, 200),
    default=25,
    show_default=True,
    help="Rows to give: 1 to 200",
)
@_json_option
@click.pass_context
def gate_outcome_report_cmd(  # noqa: PLR0913 - the command's options
    ctx: click.Context,
    days: int,
    ending_days_ago: int,
    by: str,
    where: str | None,
    workflow: str | None,
    check: str | None,
    area: str | None,
    finding_class: str | None,
    decision: str | None,
    pull_request: int | None,
    due: bool | None,
    sort: str,
    limit: int,
    **_kwargs: Any,
) -> None:
    """Report each workflow's or each check's runs by event: how they ended, what they cost,
    queue groups, quiet and not-observed checks; or the fix commits and escapes by area.
    Read-only."""
    from botcore.commands.gate_outcome import gate_outcome_report

    result = _run_async(
        gate_outcome_report(
            days=days,
            ending_days_ago=ending_days_ago,
            by=by,
            where=where,
            workflow=workflow,
            check=check,
            area=area,
            finding_class=finding_class,
            decision=decision,
            pull_request=pull_request,
            due=due,
            sort=sort,
            limit=limit,
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("disk-report")
@click.option("--repo", default=None, help="Report one repository instead of the registered ones")
@click.option(
    "--unclassified",
    is_flag=True,
    default=False,
    help="List ignored paths no [disk] pattern covers",
)
@click.option(
    "--budget",
    "budget_seconds",
    type=float,
    default=180.0,
    show_default=True,
    help="Seconds to spend measuring before reporting what is left unmeasured",
)
@_json_option
@click.pass_context
def disk_report_cmd(
    ctx: click.Context,
    repo: str | None,
    unclassified: bool,
    budget_seconds: float,
    **_kwargs: Any,
) -> None:
    """Report worktrees, caches and volumes, and what a reclaim would free. Read-only."""
    from botcore.commands.disk import disk_report

    result = _run_async(
        disk_report(repo=repo, unclassified=unclassified, budget_seconds=budget_seconds)
    )
    json_out = _is_json(ctx)
    if unclassified and not json_out:
        rendered = _to_dict(result)
        if (
            isinstance(rendered, dict)
            and not _is_error(rendered)
            and isinstance(rendered.get("data"), dict)
        ):
            from botcore.commands.disk.unclassified import format_unclassified_summary

            click.echo(format_unclassified_summary(rendered["data"]))
            return
    _format_result(result, json_out)


@cli.command("disk-reclaim")
@click.option(
    "--tier",
    type=click.IntRange(0, 2),
    default=1,
    show_default=True,
    help="0: caches and aged folders; 1: also idle build output; 2: also finished worktrees",
)
@click.option(
    "--include-restorable",
    is_flag=True,
    default=False,
    help="With --tier 2, also remove worktrees that hold nothing unique but have not landed",
)
@click.option("--apply", is_flag=True, default=False, help="Carry out the plan (default: dry run)")
@click.option("--repo", default=None, help="Reclaim one repository instead of the registered ones")
@click.option(
    "--pressure", is_flag=True, default=False, help="Act as if a watched volume were low on space"
)
@_json_option
@click.pass_context
def disk_reclaim_cmd(  # noqa: PLR0913 - one argument per option
    ctx: click.Context,
    tier: int,
    include_restorable: bool,
    apply: bool,
    repo: str | None,
    pressure: bool,
    **_kwargs: Any,
) -> None:
    """Prune caches, strip build output, remove finished worktrees. Dry run unless --apply."""
    from botcore.commands.disk import disk_reclaim

    result = _run_async(
        disk_reclaim(
            tier=tier,
            apply=apply,
            repo=repo,
            pressure=pressure,
            include_restorable=include_restorable,
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("disk-setup")
@click.option(
    "--uninstall",
    is_flag=True,
    default=False,
    help="Remove the scheduled job (settings and receipts stay)",
)
@click.option("--repo", "repos", multiple=True, help="Also register this repository")
@click.option(
    "--no-schedule",
    is_flag=True,
    default=False,
    help="Write the settings without installing the job",
)
@click.option(
    "--remove-landed/--keep-landed",
    default=None,
    help="Let the job remove finished worktrees (tier 2); off unless asked",
)
@_json_option
@click.pass_context
def disk_setup_cmd(  # noqa: PLR0913 - one argument per option
    ctx: click.Context,
    uninstall: bool,
    repos: tuple[str, ...],
    no_schedule: bool,
    remove_landed: bool | None,
    **_kw: Any,
) -> None:
    """Register repositories and volumes, and install the hourly disk job."""
    from botcore.commands.disk import disk_setup

    result = _run_async(
        disk_setup(
            uninstall=uninstall,
            repos=list(repos),
            install_schedule=not no_schedule,
            remove_landed=remove_landed,
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("disk-keep")
@click.argument("path")
@click.option("--until", default=None, help="YYYY-MM-DD; 14 days from today by default")
@click.option("--reason", default="", help="Why it is kept")
@_json_option
@click.pass_context
def disk_keep_cmd(
    ctx: click.Context,
    path: str,
    until: str | None,
    reason: str,
    **_kw: Any,
) -> None:
    """Protect a worktree from every disk-* action until a date."""
    from botcore.commands.disk import disk_keep

    _format_result(_run_async(disk_keep(path=path, until=until, reason=reason)), _is_json(ctx))


@cli.command("disk-unkeep")
@click.argument("path")
@_json_option
@click.pass_context
def disk_unkeep_cmd(ctx: click.Context, path: str, **_kw: Any) -> None:
    """Release a keep that disk-keep made."""
    from botcore.commands.disk import disk_unkeep

    _format_result(_run_async(disk_unkeep(path=path)), _is_json(ctx))


@cli.command("disk-restore")
@click.argument("path")
@_json_option
@click.pass_context
def disk_restore_cmd(ctx: click.Context, path: str, **_kw: Any) -> None:
    """Recreate a worktree a tier 2 reclaim removed, at the same path and commit."""
    from botcore.commands.disk import disk_restore

    _format_result(_run_async(disk_restore(path=path)), _is_json(ctx))


@cli.command("disk-status")
@_json_option
@click.pass_context
def disk_status_cmd(ctx: click.Context, **_kwargs: Any) -> None:
    """Show the disk job's state, its last run and watched volumes' free space."""
    from botcore.commands.disk import disk_status

    result = _run_async(disk_status())
    _format_result(result, _is_json(ctx))


@cli.command("disk-run")
@click.option("--force", is_flag=True, default=False, help="Reclaim now even if not due")
@_json_option
@click.pass_context
def disk_run_cmd(ctx: click.Context, force: bool, **_kwargs: Any) -> None:
    """The scheduled job: check free space, and reclaim when due or low."""
    from botcore.commands.disk import disk_run

    # this process is the run's own: a step that only waits is left behind when it ends
    result = _run_async(disk_run(force=force, own_process=True))
    _format_result(result, _is_json(ctx))


@cli.command()
@_json_option
@click.pass_context
def info(ctx: click.Context, **_kwargs: Any) -> None:
    """Show workspace information."""
    from botcore.commands.info import info_workspace

    result = _run_async(info_workspace())
    _format_result(result, _is_json(ctx))


# ── Changeset commands ───────────────────────────────────────────────────────

_CHANGESET_TYPES = ["added", "changed", "deprecated", "removed", "fixed", "security"]


@cli.command("changeset-create")
@click.option(
    "--type",
    "change_type",
    required=True,
    type=click.Choice(_CHANGESET_TYPES, case_sensitive=False),
    help="Type of change",
)
@click.option("--description", "-d", required=True, help="Changelog entry text")
@_json_option
@click.pass_context
def changeset_create_cmd(
    ctx: click.Context,
    change_type: str,
    description: str,
    **_kw: Any,
) -> None:
    """Create a changeset file for the next release."""
    from botcore.commands.changeset import changeset_create

    result = _run_async(changeset_create(change_type=change_type, description=description))
    _format_result(result, _is_json(ctx))


@cli.command("changeset-status")
@_json_option
@click.pass_context
def changeset_status_cmd(ctx: click.Context, **_kwargs: Any) -> None:
    """Show pending changeset files."""
    from botcore.commands.changeset import changeset_status

    result = _run_async(changeset_status())
    _format_result(result, _is_json(ctx))


@cli.command("changeset-consume")
@click.option("--version", "-v", default=None, help="Version string (e.g. 1.2.0)")
@_json_option
@click.pass_context
def changeset_consume_cmd(ctx: click.Context, version: str | None, **_kwargs: Any) -> None:
    """Consume changesets and update CHANGELOG.md."""
    from botcore.commands.changeset import changeset_consume

    result = _run_async(changeset_consume(version=version))
    _format_result(result, _is_json(ctx))


# ── Snapshot & PR inspection commands (read-only by default) ─────────────────


@cli.command("dev-snapshot")
@click.option("--base", default=None, help="Git ref or SHA for diff-size stats (default: HEAD)")
@click.option(
    "--compare-to",
    "compare_to",
    default=None,
    help="Prior dev-snapshot JSON string or 64-char sha256 digest",
)
@click.option("--path", default=None, help="Directory inside the target git checkout")
@_json_option
@click.pass_context
def dev_snapshot_cmd(
    ctx: click.Context,
    base: str | None,
    compare_to: str | None,
    path: str | None,
    **_kwargs: Any,
) -> None:
    """Capture a read-only checkout integrity snapshot and optional diff-size comparison."""
    from botcore.commands.dev.snapshot import dev_snapshot

    result = _run_async(dev_snapshot(base=base, compare_to=compare_to, path=path))
    _format_result(result, _is_json(ctx))


@cli.command("pr-status")
@click.argument("pr", required=False, default=None)
@click.option("--repo", default=None, help="Repository slug (owner/name)")
@_json_option
@click.pass_context
def pr_status_cmd(
    ctx: click.Context,
    pr: str | None,
    repo: str | None,
    **_kwargs: Any,
) -> None:
    """Inspect a pull request's checks, bots, merge queue, and readiness. Read-only."""
    from botcore.commands.pr.status import pr_status

    result = _run_async(pr_status(pr=pr, repo=repo))
    _format_result(result, _is_json(ctx))


@cli.command("pr-drift")
@click.argument("pr", required=False, default=None)
@click.option("--repo", default=None, help="Repository slug (owner/name)")
@click.option(
    "--fetch",
    is_flag=True,
    default=False,
    help="Fetch origin's base ref before inspecting (default: read-only, no fetch)",
)
@click.option(
    "--after-rebase-from",
    default=None,
    help="Pre-rebase head SHA to summarize with git range-diff",
)
@click.option(
    "--scan-overlapping-prs",
    type=int,
    default=10,
    show_default=True,
    help="Recent open/merged PRs to scan for overlapping files (0 skips)",
)
@_json_option
@click.pass_context
def pr_drift_cmd(  # noqa: PLR0913 - one argument per CLI option
    ctx: click.Context,
    pr: str | None,
    repo: str | None,
    fetch: bool,
    after_rebase_from: str | None,
    scan_overlapping_prs: int,
    **_kwargs: Any,
) -> None:
    """Gather PR staleness, base-branch drift, overlapping PRs, and author credits."""
    from botcore.commands.pr.drift import pr_drift

    result = _run_async(
        pr_drift(
            pr=pr,
            repo=repo,
            fetch=fetch,
            after_rebase_from=after_rebase_from,
            scan_overlapping_prs=scan_overlapping_prs,
        )
    )
    _format_result(result, _is_json(ctx))


@cli.command("pr-wait")
@click.argument("pr", required=False, default=None)
@click.option("--repo", default=None, help="Repository slug (owner/name)")
@click.option(
    "--until",
    type=click.Choice(["ready", "green", "any-change"], case_sensitive=False),
    default="ready",
    show_default=True,
    help="Condition to wait for",
)
@click.option("--interval", type=int, default=None, help="Seconds between polls")
@click.option("--timeout", "timeout_seconds", type=int, default=1800, show_default=True)
@click.option("--max-polls", type=int, default=None, help="Stop after at most this many polls")
@click.option(
    "--persist-state",
    is_flag=True,
    default=False,
    help="Hold a cross-platform single-instance lock and save event watermarks on disk",
)
@_json_option
@click.pass_context
def pr_wait_cmd(  # noqa: PLR0913 - one argument per CLI option
    ctx: click.Context,
    pr: str | None,
    repo: str | None,
    until: str,
    interval: int | None,
    timeout_seconds: int,
    max_polls: int | None,
    persist_state: bool,
    **_kwargs: Any,
) -> None:
    """Wait for PR events until ready, green, or any change. Read-only by default."""
    from botcore.commands.pr.wait import pr_wait

    json_mode = _is_json(ctx)

    def _emit_line(event: dict[str, Any]) -> None:
        if not json_mode:
            suffix = f" {event['url']}" if event.get("url") else ""
            click.echo(f"{event['message']}{suffix}")

    result = _run_async(
        pr_wait(
            pr=pr,
            repo=repo,
            until=until.lower(),  # type: ignore[arg-type]
            interval=interval,
            timeout_seconds=timeout_seconds,
            max_polls=max_polls,
            persist_state=persist_state,
            on_event=_emit_line,
        )
    )
    normalized = _to_dict(result)
    if json_mode:
        click.echo(json.dumps(normalized, indent=2, default=str))
        if _is_error(normalized):
            sys.exit(1)
        data = normalized.get("data") or {}
        sys.exit(int(data.get("exit_code", 0)))
    if _is_error(normalized):
        _format_result(normalized, False)
        return
    data = normalized.get("data") or {}
    click.echo(f"{data.get('repo', '')}#{data.get('number', '')}: {data.get('outcome', 'done')}")
    sys.exit(int(data.get("exit_code", 0)))


from botcore.cli_cdp import cdp_group  # noqa: E402

cli.add_command(cdp_group)

from botcore.cli_docs import docs_command  # noqa: E402

cli.add_command(docs_command)
