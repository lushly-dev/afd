---
name: plugin-builder
description: >
  Builds Botcore plugins: commands that return AFD CommandResults, registration,
  entry points, and serving them through a managed host with command policies.
  Use when writing or changing a Botcore plugin or exposing its commands over
  MCP or a CLI.
metadata:
  source: botcore
  version: 2.3.0
  portable: true
---

# Botcore plugins

Serve plugins through a managed host (`build_host`). It admits only the plugins you name and only commands that have an effect policy. The sources are [`host-composition.md`](https://github.com/lushly-dev/afd/blob/main/endpoints/botcore/docs/host-composition.md) and `botcore/plugin.py` and `botcore/host.py` in the installed package.

## Write the plugin

```python
from pathlib import Path
from afd import error, success
from botcore import CommandPolicy

async def notes_count(path: str, pattern: str = "*.md"):
    """Count files matching a pattern under a directory."""
    root = Path(path)
    if not root.is_dir():
        return error("NOT_A_DIRECTORY", f"{path} is not a directory",
                     suggestion="Pass a directory inside the selected target")
    count = sum(1 for _ in root.rglob(pattern))
    return success({"count": count}, reasoning=f"Found {count} files")

class NotesPlugin:
    host_context_safe = True  # audited: no state shared between hosts

    def register(self, registry):
        registry.add_commands([notes_count])
        registry.add_docs("notes", "notes_count(path, pattern='*.md') -> {count}")

    def config_schema(self):
        return None

def host_policies():
    return {"notes_count": CommandPolicy(paths=("path",))}
```

```toml
[project.entry-points."botcore.plugins"]
notes = "notes_plugin:NotesPlugin"
```

- **Plain class.** `BotCorePlugin` is a runtime-checkable `Protocol`, so there is nothing to subclass.
- **Errors.** Use `error(code, message, *, suggestion=...)`; `error("msg")` raises `TypeError`. Return failures rather than raising them, because the host turns an exception into a bare `COMMAND_EXECUTION_ERROR`.
- **Names.** A command's name is its function's `__name__`. A duplicate command name or docs topic, including a clash with core, raises.
- **Docs.** MCP clients see names, policies and docs topics but not docstrings. Put call signatures in the `add_docs` topic.
- **`host_context_safe`.** `build_host` refuses a plugin without it. Set it only once the plugin keeps no module-global state.
- **Config.** `config_schema()` returns a Pydantic model class that validates `[tool.botcore.plugins.<entry-point name>]`. `build_host` and `botcore serve` pass the result to an optional `configure(config)`; the other `botcore` subcommands don't.
- **Skills.** `build_host` keeps the folders `add_skills_dir` registers on `host.skills`, and `create_host_mcp_server` serves each skill in them over MCP's Skills extension beside Botcore's own (a plugin skill replaces a bundled one of its name). A folder the extension cannot read, such as one with `skill.md` in lower case or a file path with a space, stops construction. A host you assemble from another's commands must copy `host.skills` too. `botcore skill-seed` passes no plugin directories, so clients that do not read MCP skills (`claude -p`, the Agent SDK, Codex) do not get them.

## Serve it through a host

```python
from pathlib import Path
from botcore import ExecutionContext, build_host, create_host_mcp_server
from notes_plugin import host_policies

host = build_host("notes", ExecutionContext(Path.cwd()), plugins=("notes",),
                  policies=host_policies(), core_commands=())  # () leaves out core commands
create_host_mcp_server(host).run()  # afd-* meta-tools + notes-start, notes-call, notes-docs aliases
```

- **Selection fails closed.** A missing, duplicated or failing plugin in `plugins=` stops construction. Legacy discovery also raises on duplicate entry-point names.
- **Policies.** A command without a policy raises `Declare command effects before admission`. Effects come from `EFFECTS` in `host.py`. Effects that depend on arguments need a callable plus `possible_effects`.
- **Profile.** `ExecutionContext` defaults to `inspection`, which denies every effect except `inspect` before the command runs. Writers and subprocesses need `profile="trusted-local"`.
- **Paths.** Arguments named in `paths` resolve inside the target, and escapes are rejected. Only arguments the caller passes are resolved, never a parameter's default, so make path parameters required (a default of `"."` would read the process cwd, outside the target). The host never changes the cwd, so commands use `botcore.context.current_context()` or `botcore.utils.workspace.find_workspace()`.
- **Caller.** A command reads who is calling from `botcore.context.current_call().actor`; outside a host call `current_call()` is `None`. The HTTP surface names the token's actor and the LLM bridge the session's agent name, while the MCP surface gives an agent with no id unless the host sets `CommandHost(actor=...)` or passes `actor=` / `context_hook=` / `auth=` to `create_host_mcp_server`. A command that keys data on the caller must refuse a host call whose actor has no id, never fall back to a shared name. `botcore_memory.access` does this.
- **Identity.** The host name wins: `set_cli_name`/`set_mcp_name` do nothing under a host. On the legacy path, two plugins that set different names raise.
- **Checking.** `host.catalog()` lists what was admitted. `add_middleware` wraps the handler call, after the effect check and path resolution, so middleware never sees a denied call.

## Legacy path: trusted local only

`create_mcp_server(name, *, version=..., extra_commands=..., extra_docs: dict[str, str] | None)`, `build_namespace()` and the `botcore` CLI:
- load every installed plugin and ignore both policies and `host_context_safe`;
- skip, with a log, any plugin that fails to load.

`create_mcp_server` also exposes `{name}-run`, which runs unrestricted Python and bypasses plugin middleware. Use these only on your own machine, never to serve an inspection host. The managed alternative is `create_host_mcp_server(host, raw_python=True)`. It requires `trusted-local`, and its command calls still go through policy, but the Python is unconfined.
