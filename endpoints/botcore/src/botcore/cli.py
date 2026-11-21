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
                fg="red", err=True,
            )
            sys.exit(1)
        raise


def _is_json(ctx: click.Context) -> bool:
    """Check if JSON output is requested (subcommand flag or group flag)."""
    if ctx.params.get("json_mode"):
        return True
    # Walk up to parent (group) context
    parent = ctx.parent
    if parent and parent.params.get("json_mode"):
        return True
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
    "--json", "json_mode", is_flag=True, default=False, help="Output as JSON",
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
    "--language", "-l", default=None,
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
            click.echo(json.dumps({
                "status": "skipped",
                "config_path": str(config_path),
                "reason": "already exists (use --force to overwrite)",
            }, indent=2))
        else:
            click.echo(f"botcore.toml already exists at {config_path}")
            click.echo("Use --force to overwrite.")
        return

    # Detect language
    detected = detect_language(ws)
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
        non_interactive, with_agents=with_agents, with_llm=with_llm, with_memory=with_memory,
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
    extensions_available = {
        name: f"pip install {pkg}" for name, pkg in _EXTENSION_EXTRAS.items()
    }

    if json_out:
        click.echo(json.dumps({
            "status": "success",
            "config_path": str(config_path),
            "language": lang,
            "skills_seeded": skills_seeded,
            "extensions_selected": extensions_selected,
            "extensions_available": extensions_available,
        }, indent=2))
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
    help="Transport type",
)
def serve(name: str, transport: str) -> None:
    """Start the botcore MCP server."""
    try:
        from botcore.server import create_mcp_server

        server = create_mcp_server(name, version=botcore.__version__)
        server.run(transport=transport)
    except ImportError:
        click.secho(
            "Error: MCP dependencies not installed. "
            "Run: pip install 'lushly-botcore[mcp]'",
            fg="red", err=True,
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
    """Lint SKILL.md files under PATH (default: current directory), rules SK001-SK019."""
    from botcore.commands.skill_lint import skill_lint_spec

    result = _run_async(skill_lint_spec(path=path))
    _format_result(result, _is_json(ctx))


@cli.command("disk-report")
@click.option("--repo", default=None, help="Report one repository instead of the registered ones")
@click.option(
    "--unclassified", is_flag=True, default=False,
    help="List ignored paths no [disk] pattern covers",
)
@click.option(
    "--budget", "budget_seconds", type=float, default=180.0, show_default=True,
    help="Seconds to spend measuring before reporting what is left unmeasured",
)
@_json_option
@click.pass_context
def disk_report_cmd(
    ctx: click.Context, repo: str | None, unclassified: bool, budget_seconds: float,
    **_kwargs: Any,
) -> None:
    """Report worktrees, caches and volumes, and what a reclaim would free. Read-only."""
    from botcore.commands.disk import disk_report

    result = _run_async(
        disk_report(repo=repo, unclassified=unclassified, budget_seconds=budget_seconds)
    )
    _format_result(result, _is_json(ctx))


@cli.command("disk-reclaim")
@click.option("--tier", type=click.IntRange(0, 2), default=1, show_default=True,
              help="0: caches and aged folders; 1: also idle build output; "
                   "2: also finished worktrees")
@click.option("--include-restorable", is_flag=True, default=False,
              help="With --tier 2, also remove worktrees that hold nothing unique but have "
                   "not landed")
@click.option("--apply", is_flag=True, default=False, help="Carry out the plan (default: dry run)")
@click.option("--repo", default=None, help="Reclaim one repository instead of the registered ones")
@click.option("--pressure", is_flag=True, default=False,
              help="Act as if a watched volume were low on space")
@_json_option
@click.pass_context
def disk_reclaim_cmd(  # noqa: PLR0913 - one argument per option
    ctx: click.Context, tier: int, include_restorable: bool, apply: bool, repo: str | None,
    pressure: bool, **_kwargs: Any,
) -> None:
    """Prune caches, strip build output, remove finished worktrees. Dry run unless --apply."""
    from botcore.commands.disk import disk_reclaim

    result = _run_async(disk_reclaim(tier=tier, apply=apply, repo=repo, pressure=pressure,
                                     include_restorable=include_restorable))
    _format_result(result, _is_json(ctx))


@cli.command("disk-setup")
@click.option("--uninstall", is_flag=True, default=False,
              help="Remove the scheduled job (settings and receipts stay)")
@click.option("--repo", "repos", multiple=True, help="Also register this repository")
@click.option("--no-schedule", is_flag=True, default=False,
              help="Write the settings without installing the job")
@click.option("--remove-landed/--keep-landed", default=None,
              help="Let the job remove finished worktrees (tier 2); off unless asked")
@_json_option
@click.pass_context
def disk_setup_cmd(  # noqa: PLR0913 - one argument per option
    ctx: click.Context, uninstall: bool, repos: tuple[str, ...], no_schedule: bool,
    remove_landed: bool | None, **_kw: Any,
) -> None:
    """Register repositories and volumes, and install the hourly disk job."""
    from botcore.commands.disk import disk_setup

    result = _run_async(disk_setup(uninstall=uninstall, repos=list(repos),
                                   install_schedule=not no_schedule,
                                   remove_landed=remove_landed))
    _format_result(result, _is_json(ctx))


@cli.command("disk-keep")
@click.argument("path")
@click.option("--until", default=None, help="YYYY-MM-DD; 14 days from today by default")
@click.option("--reason", default="", help="Why it is kept")
@_json_option
@click.pass_context
def disk_keep_cmd(
    ctx: click.Context, path: str, until: str | None, reason: str, **_kw: Any,
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

    result = _run_async(disk_run(force=force))
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
    "--type", "change_type", required=True,
    type=click.Choice(_CHANGESET_TYPES, case_sensitive=False),
    help="Type of change",
)
@click.option("--description", "-d", required=True, help="Changelog entry text")
@_json_option
@click.pass_context
def changeset_create_cmd(
    ctx: click.Context, change_type: str, description: str, **_kw: Any,
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
