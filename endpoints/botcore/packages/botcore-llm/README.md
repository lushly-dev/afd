# botcore-llm

LLM runtime plugin for Botcore: Copilot SDK sessions whose tools are Botcore commands.
The `llm` documentation topic (`LLM_DOCS` in `botcore_llm/__init__.py`) lists the commands.

## Tools follow host policy

`llm_session_create(tools=[...])` serves the named commands to the model through a managed
Botcore host (`botcore.host.CommandHost`). Every tool call enters `host.execute`, the path a
host's CLI and MCP `call` take, as an agent: argument checks, command policies, the execution
profile and path confinement apply. A call the host refuses reaches the model as the host's
error and suggestion, for example `EFFECT_DENIED`. A name the host does not serve is refused
with `UNKNOWN_COMMAND` when the session is created.

A model's calls always run as an agent. A supplied host with no actor or an agent actor is
used as is; one whose actor is a human with an id makes the model call on that human's
behalf (`on_behalf_of`); any other actor (a service, a script, a human without an id) is
refused with `TOOL_HOST_ACTOR_REFUSED` when the session is created. The session's
`agent_name` (a `botcore-agents` agent's configured key) is that agent's id wherever the
host's actor gives none, so commands that key data on the caller, such as `botcore-memory`,
tell agents apart; a host whose agent actor has an id keeps it.

`agent_name` is an identity only for a local, trusted caller, such as the `botcore-agents`
orchestrator. When `llm_session_create` itself runs inside any host call, the name only
labels the session, and the tool host's actor decides who the tool calls run as.
The name says which agent, not for whom: two people whose tool hosts run the same agent name
(the agent calls on behalf of each) share that agent's memory.

The host covers the current workspace. Two settings shape it:

| Setting | Default | Meaning |
|---|---|---|
| `tool_profile` | `"inspection"` | The execution profile: which declared effects a tool call may have (`botcore.context.PROFILE_EFFECTS`) |
| `tool_plugins` | installed plugins among `connectors` | The host-context-safe plugins whose commands may be bridged, besides the admitted core commands |

The default `inspection` profile admits only read-only commands (`info_workspace`,
`spec_status`, `spec_validate`, `changeset_status` and the like). Linting, testing, writes and
connector calls are refused.

### Letting agents use connectors: `remote-caller`

An agent that only needs the connectors runs under `remote-caller`, which admits inspection,
service calls and history writes, and no subprocess or local source write. Its connector calls
act on GitHub with the token's permissions: they can create issues and pull requests and post
reviews. Give the host its GitHub token in the environment (`GH_TOKEN`), since connectors never
run `gh auth token`, and enable the GitHub connector, which registers no commands otherwise.
In `pyproject.toml`:

```toml
[tool.botcore.plugins.llm]
default_model = "<model-id>"
tool_profile = "remote-caller"   # connector calls; no subprocesses or local source writes
tool_plugins = ["connectors"]    # optional; the default when connectors is installed

[tool.botcore.plugins.connectors]
enabled = ["github"]
```

In a standalone `botcore.toml` the same sections are `[plugins.llm]` and `[plugins.connectors]`.
`remote-caller` admits history writes from any plugin `tool_plugins` selects, not only the
connectors: add a plugin there only if its agents may run its history-writing commands.

### Opting a local setup into `trusted-local`

A setup on your own machine, where the model may run the commands you would, sets
`tool_profile = "trusted-local"`, which admits every effect a command declares: subprocesses
(`dev_lint`, `dev_test`, `dev_build`), source, config and release writes, and the connectors. A Python
embedder can instead pass a host of its own to `botcore_llm.commands.set_tool_host(host)`, for
example one built with `botcore.build_host` and narrower policies.

`tool_profile` and `tool_plugins` belong to the LLM plugin, so they apply to every agent
and session it creates: one agent cannot run under `trusted-local` while another stays on
`inspection` (a known limit). A Python embedder that needs that passes a host per session.

A session built this way owns its host and closes the host's plugins (the connectors' HTTP
client, for example) in `llm_session_destroy`; a host passed to `set_tool_host` stays open
for its owner to close.

## Session tools and MCP

Each session sets the runtime's `available_tools`, so the model sees only the bridged
tools, the runtime's session-local built-ins (`BUILTIN_TOOLS_ISOLATED`: `ask_user`, `task`
and the like) and the read-only `lsp`, the shell built-ins when `allow_shell` is set (never
one that types input into a running process) and the file built-ins, `apply_patch` among
them, when `allow_filesystem` is. Any other tool the runtime provides, such as one from an MCP server in
the user's Copilot configuration, is hidden. MCP tools are offered only when `allow_mcp`
holds and `mcp_servers` names servers, and the permission handler then approves calls only
to those servers:

```toml
[plugins.agents.agents.researcher.permissions]
mcp_servers = ["github"]   # default []: no MCP tools
```

## Shell permissions

With `allow_shell` and a `shell_allowlist` (per agent, in `botcore-agents`), each shell command
is approved on its own. The command line must be one simple command: a line break, `;`, `&`,
`&&`, `|`, `||`, a redirection, a subshell, `$` or backtick substitution, a backslash, a glob,
`~` or `#` outside quotes refuses it, as does `$`, a backtick or a backslash inside double
quotes. Quoted arguments may hold any other text. On Windows, `&`, `|`, `<`, `>`, `^`, `%`
and `!` are refused anywhere, quoted or not, because `.cmd` shims such as `npm` and `pnpm`
re-read their arguments through `cmd /c`. The runtime's own parse of the request must agree:
exactly one command, the same program and arguments, and no redirection; a request without
that parse, or on a platform whose shell Botcore cannot check, is refused.

The program (the pattern's first word) must equal the command's literally; a pattern whose
first word holds `*`, `?` or `[` is refused when the configuration loads. The rest of the
pattern is an `fnmatch` glob over the parsed arguments, so `prog *` admits every option the
program has: `git *` is effectively unrestricted (`git -c alias.x=!cmd x`, `git log
--output=<file>`), as is `python *` (`python -c`). Pin patterns to subcommands instead:

```toml
[plugins.agents.agents.coder.permissions]
allow_shell = true
shell_allowlist = ["git status", "git status *", "git diff *", "pytest tests/*"]
# "git status --short" yes; "git status && git diff" no; "git push" no
```

Even these patterns can write: `git diff *` admits `git diff --output=<file>`, and
`pytest tests/*` admits `--basetemp=<dir>` and runs the project's `conftest.py` code. Pin each
pattern as tightly as the task allows (`git diff --stat`, `pytest tests/unit -q`), and treat
any pattern ending in `*` as admitting every option of that subcommand.

Botcore never runs the command: the Copilot runtime runs the approved text in its own shell,
so the check judges that raw text. These checks bound what a model can ask for; they are not
a sandbox. A refusal says what refused it and how to recover.
