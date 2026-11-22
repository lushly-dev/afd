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

The host covers the current workspace. Two settings shape it:

| Setting | Default | Meaning |
|---|---|---|
| `tool_profile` | `"inspection"` | The execution profile: which declared effects a tool call may have (`botcore.context.PROFILE_EFFECTS`) |
| `tool_plugins` | installed plugins among `connectors` | The host-context-safe plugins whose commands may be bridged, besides the admitted core commands |

The default `inspection` profile admits only read-only commands (`info_workspace`,
`spec_status`, `spec_validate`, `changeset_status` and the like). Linting, testing, writes and
connector calls are refused.

### Opting a local setup into `trusted-local`

A setup on your own machine, where the model may run the commands you would, opts in under
the LLM plugin's section of `botcore.toml` (or `[tool.botcore.plugins.llm]` in
`pyproject.toml`):

```toml
[tool.botcore.plugins.llm]
default_model = "<model-id>"
tool_profile = "trusted-local"   # admits every effect a command declares
tool_plugins = ["connectors"]    # optional; the default when connectors is installed
```

`trusted-local` admits subprocesses (`dev_lint`, `dev_test`, `dev_build`), source, config and
release writes, and the GitHub connector commands, which declare `service` and `subprocess`.
`remote-caller` sits between the two: inspection, service calls and history writes. A Python
embedder can instead pass a host of its own to `botcore_llm.commands.set_tool_host(host)`, for
example one built with `botcore.build_host` and narrower policies.

## Shell permissions

With `allow_shell` and a `shell_allowlist` (per agent, in `botcore-agents`), each shell command
is approved on its own. The command line must be one simple command: a line break, `;`, `&`,
`&&`, `|`, `||`, a redirection, a subshell, `$` or backtick substitution, a backslash, a glob,
`~` or `#` outside quotes refuses it, as does `$`, a backtick or a backslash inside double
quotes. Quoted arguments may hold any other text. The program (the pattern's first word) must
equal the command's, and the pattern is an `fnmatch` glob over the parsed arguments:

```toml
[plugins.agents.agents.coder.permissions]
allow_shell = true
shell_allowlist = ["git *", "pytest *"]   # "git status" yes; "git status && git diff" no
```

Botcore never runs the command: the Copilot runtime runs the approved text in its own shell,
so the check judges that raw text. A refusal says what refused it and how to recover.
