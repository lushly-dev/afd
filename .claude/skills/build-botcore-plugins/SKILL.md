---
name: build-botcore-plugins
description: >
  Builds Botcore plugins: commands that return AFD CommandResults, registration,
  entry points, and serving them through a managed host with command policies.
  Use when writing or changing a Botcore plugin or exposing its commands over
  MCP or a CLI.
metadata:
  source: botcore
  version: 2.1.0
  portable: true
---

<!-- Generated from skills/exports.json; edit the canonical plugin-builder skill. -->

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
- **Skills.** `add_skills_dir` only records a path. Nothing in Botcore reads `registry.skills_dirs`, and `botcore skill-seed` passes no plugin directories.

## Serve it through a host

```python
from pathlib import Path
from botcore import ExecutionContext, build_host, create_host_mcp_server
from notes_plugin import host_policies

host = build_host("notes", ExecutionContext(Path.cwd()), plugins=("notes",),
                  policies=host_policies(), core_commands=())  # () leaves out core commands
create_host_mcp_server(host).run()  # notes-start, notes-call, notes-docs
```

- **Selection fails closed.** A missing, duplicated or failing plugin in `plugins=` stops construction. Legacy discovery also raises on duplicate entry-point names.
- **Policies.** A command without a policy raises `Declare command effects before admission`. Effects come from `EFFECTS` in `host.py`. Effects that depend on arguments need a callable plus `possible_effects`.
- **Profile.** `ExecutionContext` defaults to `inspection`, which denies every effect except `inspect` before the command runs. Writers and subprocesses need `profile="trusted-local"`.
- **Paths.** Arguments named in `paths` resolve inside the target, and escapes are rejected. Only arguments the caller passes are resolved, never a parameter's default, so make path parameters required (a default of `"."` would read the process cwd, outside the target). The host never changes the cwd, so commands use `botcore.context.current_context()` or `botcore.utils.workspace.find_workspace()`.
- **Identity.** The host name wins: `set_cli_name`/`set_mcp_name` do nothing under a host. On the legacy path, two plugins that set different names raise.
- **Checking.** `host.catalog()` lists what was admitted. `add_middleware` wraps the handler call, after the effect check and path resolution, so middleware never sees a denied call.

## Legacy path: trusted local only

`create_mcp_server(name, *, version=..., extra_commands=..., extra_docs: dict[str, str] | None)`, `build_namespace()` and the `botcore` CLI:
- load every installed plugin and ignore both policies and `host_context_safe`;
- skip, with a log, any plugin that fails to load.

`create_mcp_server` also exposes `{name}-run`, which runs unrestricted Python and bypasses plugin middleware. Use these only on your own machine, never to serve an inspection host. The managed alternative is `create_host_mcp_server(host, raw_python=True)`. It requires `trusted-local`, and its command calls still go through policy, but the Python is unconfined.
