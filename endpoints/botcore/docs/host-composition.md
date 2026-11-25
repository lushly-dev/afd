# Explicit host composition

`CommandHost` is an opt-in composition API for repository hosts such as Alfred.
Existing `create_mcp_server`, `build_namespace`, global `get_client`, and the
`botcore` CLI retain their trusted local compatibility behavior. They do not
provide restricted execution profiles. In particular, the legacy MCP factory
still exposes its unrestricted Python `-run` tool. Do not use that factory to
serve an inspection profile.

```python
from pathlib import Path
from botcore import ExecutionContext, build_host, create_host_cli, create_host_mcp_server

host = build_host("alfred", ExecutionContext(Path("/path/to/worktree")))
cli = create_host_cli(host)
server = create_host_mcp_server(host)
client = host.direct_client()
```

The host owns CLI/MCP names. `create_host_mcp_server(host)` serves the host
through `afd.server.create_server`, exposing AFD's five standard meta-tools
(`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`) and dual-era
MCP (`2026-07-28` `server/discover` and `2025` `initialize`), while keeping the
legacy `{name}-start`, `{name}-call`, and `{name}-docs` tools as compatibility
aliases (deprecated; planned for retirement in a later release; omitted when a
host named `afd` would collide with an AFD built-in). Host policy, execution
profiles and path bounds run as AFD middleware
(`create_host_policy_middleware(host)`) before downstream AFD middleware and
handlers, and every admitted call enters `host.execute`. Additional AFD server
options (`skills`, `resources`, `auth`, `context_hook`, `context_fields`,
`middleware`, `tool_strategy`, `first_class_tools`, `default_timeout_ms`) may
be passed directly to `create_host_mcp_server` (`default_timeout_ms` defaults
to `None` so long-running commands are not cut off unless configured); the
returned MCP SDK server also exposes `.afd_server` for inspecting the
underlying AFD server (call transport methods such as `run` and
`streamable_http_app` on the returned server). The CLI offers `catalog` and
`call NAME JSON`. All surfaces enter `host.execute`. `host.direct_client()`
returns the AFD DirectClient, including its normal pipeline support. Quality
verdicts live in `result.metadata.quality` with `status`, `target`, and
`evidence`. `CommandResult.success` keeps its original execution meaning. CLI
exit status also rejects nonpassing quality verdicts. Use `aggregate_quality`
for required check plans; empty plans and required skipped/unavailable checks
never pass.

Host plugins are explicitly selected by entry-point name (`plugins=("alfred",)`).
Missing, duplicate, or failing selections reject construction. Registration
rejects duplicate command names and documentation topics, including collisions
with core commands/docs. Plugins cannot override host branding. Every plugin
command needs an explicit policy, and plugins must declare
`host_context_safe = True` after a per-host state audit. The connectors plugin
has: its configuration, connectors and credential cache live on the instance each
host discovers, and every GitHub command declares only the `service` effect
(credentials come from the environment, never from `gh auth token`), so a
`remote-caller` or `trusted-local` host admits its calls. `build_host` keeps the
selected plugin instances on `host.plugins`, and `await host.aclose()` calls each
one's `close()` (the connectors' HTTP clients). The bundled optional LLM, agents, memory and Teams
distributions remain preserved; this change does not claim their stateful
implementations are admitted to a managed multi-worktree host. In particular,
their module-global configuration needs adapters before such admission. The LLM
plugin is not itself served by a host, but the tools it bridges into a model's
session are: every tool call enters a managed host's `execute` (see
`botcore_llm`'s README). No optional plugin is auto-installed or
auto-enabled by `build_host`. A host validates the `[plugins.<name>]` sections of
the plugins it selects and leaves the others alone, without a warning: they
configure other hosts' plugins, which may be installed in another environment.

A plugin declares the policy of each command it registers, keyed by the command
function's name: `registry.add_policy("lane_status", CommandPolicy())` or
`registry.add_policies({...})`. `build_host` refuses a policy for a command the
declaring plugin did not register (another plugin's included), and still refuses
a command that neither its plugin nor the host gives a policy. The host's
`policies` argument keeps working for commands whose plugin declares none.
Where both declare one, the host's may only narrow the plugin's:

- its effects must be among the plugin's possible effects;
- it must keep every path argument the plugin confines, and may confine more;
- it may not leave out an effect the command always has (a plugin's static
  effects), since that would understate what every call does.

Anything else refuses construction, so a conflict never silently widens what a
profile admits. Within those limits the plugin's per-argument effects still
decide each call, and a call whose effects fall outside the host's set is
refused with `EFFECT_DENIED` before the handler runs: a host that admits only
`subprocess` for a lint command whose `fix` adds `source-write` serves lint and
denies `fix`. The host's capabilities, quality field and output scope replace
the plugin's where the host sets them; an unset host field keeps the plugin's,
so a host cannot drop a plugin's quality verdict. Legacy surfaces ignore
declared policies.

`ExecutionContext(workspace, target, profile)` resolves an existing target
inside one worktree, rejects symlink/path escapes, and never changes process
cwd. A task-local context makes `find_workspace()` return that invocation's
target, restoring the previous value even on errors. A target is the operation
root; its own Botcore config is read there. Root-host policy and target policy
are not implicitly merged. Host histories, when used, resolve under the
worktree instead of the legacy home-directory history. Managed commands must
use explicit paths or the context-aware workspace helpers; calling arbitrary
legacy Python directly is outside this policy boundary.

The initial core admission is deliberately bounded: workspace info, native
lint/test/build wrappers, specs, and category release commands. Other core and
specialist commands need reviewed policies before admission. The existing bare
Python commands remain available to trusted callers. An ordinary application
needs no AFD runtime dependency in its manifest to be inspected by an isolated
Botcore installation. Native lint/test/build wrappers use their existing
language tools; they do not impose AFD architectural rules.

The `inspection` profile permits pure declared inspection. It rejects writers,
subprocesses, browsers, and service access before execution. `trusted-local`
permits the admitted effects, including explicitly selected remediation.
`remote-caller` is for callers a surface authenticated over the network: it
admits `inspect`, `service` and `history-write` and refuses everything else
(subprocesses, source, config and release writes, browsers), so a remote caller
gets none of the local trust `trusted-local` implies; raw Python stays
`trusted-local` only. A host narrows it further per command with its policies.
`botcore.context.PROFILE_EFFECTS` lists what each profile admits. There
is no report-artifact exception or output-only profile in this initial API.
Conditional effects (such as lint `fix`) are evaluated against bound arguments
before invocation; effects a call computes beyond its declared set are
`EFFECT_DENIED`.

`host.catalog()`, which the CLI `catalog` command prints and the MCP `start`
tool returns as `commands`, carries what a model needs to call each command
without a skill installed: `name`, `description` (the docstring's first line),
`input_schema`, and the policy fields `effects`, `effects_depend_on_arguments`,
`capabilities`, `paths`, `quality` and `output_scope`. `input_schema` is a JSON
Schema object derived from the handler's signature and type hints, one
parameter at a time with Pydantic's `TypeAdapter`. `required` lists the inputs
without defaults; optional inputs carry their default. `Literal` becomes
`enum`, `X | None` an `anyOf` with `null`, lists and dicts `array` and
`object`, and Pydantic models their object schemas, with nested definitions
under `$defs`. A Google-style `Args:` entry or a Sphinx `:param name:` field
supplies an input's description, an `Annotated[..., Field(description=...)]`
wins over both, and each description is capped at 200 characters; no other
docstring prose reaches the catalog. Path
arguments the host resolves are ordinary inputs, also named in `paths`.
`additionalProperties` is false unless the handler takes `**kwargs`. Limits:
an unannotated parameter, a hint that does not resolve at runtime, or one
Pydantic cannot describe (a callable, say) gives `{}`, any value; a default
with no JSON form is left out; other docstring styles give no descriptions;
and those inputs are not type-checked before the call. `DirectClient.list_commands()`
reports the same one-line descriptions.

A host serves each command under the name it was registered with, and a call
may use the other spelling too (`issue_claim` for `issue-claim`, and back);
registering both spellings of one name is refused as a duplicate.
`build_host(..., kebab_names=True)` registers every command under AFD's
kebab-case name (`info-workspace`) instead of its Python function's
(`info_workspace`), so the catalog, the journal and middleware see the
kebab-case name; without it, existing hosts keep their names. An unknown name is
`COMMAND_NOT_FOUND`, whose message and suggestion name the closest served
command (the same name in another case or separator convention, else by
`difflib`; `details.suggestedCommand`) and point at the catalog.

Every surface (CLI `call`, MCP `call`, DirectClient) enters `host.execute`,
which checks argument names before binding the handler and before any policy,
path or effect check. An argument the handler does not take, or a missing
required one, is refused with `VALIDATION_ERROR`, the code AFD's shared error
catalog (`spec/error-codes.md`) gives input that fails a command's schema, which
the host catalog now publishes. Its `details` carry the `expectedFields`,
`unexpectedFields` and `missingFields` AFD's engines use, plus
`suggestedFields`, mapping each unknown key to the input
it most likely meant: the same name in another case or separator convention
(`timeoutMs`, `TimeoutMs` and `timeout-ms` all mean `timeout_ms`), else the
closest name by `difflib`. The suggestion says the same in words, for example
`Use timeout_ms instead of timeoutMs. Expected fields: lane, timeout_ms`, or
names the missing input (`Pass lane.`). A wrong key is refused, never renamed,
so the caller learns the convention. A handler taking `**kwargs` accepts any
key.

Inputs are then validated against their type hints, the same hints the catalog's
`input_schema` describes, with Pydantic's lax mode: a handler annotated with a
Pydantic model receives the model, a `list[int]` input sent as `["101"]`
arrives as `[101]`, and `fix: "false"` as `False`. A value that fails is
refused with `VALIDATION_ERROR` before any policy check (so a `str` input sent
a number is refused before path confinement), and `details.invalidFields` names
each bad field by its path (`holder.machine`, `numbers[1]`) with what is wrong.
A hint Pydantic cannot build a validator for, or one naming something it cannot
resolve, leaves that input unchecked.

Each call has an AFD `CommandContext`: the one a surface passes to
`host.execute(name, args, context)`, carrying the caller it verified as `actor`,
or else a fresh one with the host's `actor` (`CommandHost(..., actor=...)`). It
gets a trace ID, AFD's system clock and random source when it has none. The MCP
`call` tool calls as the host's actor, else as `Actor(kind="agent")`; the CLI
`call` as the host's actor; DirectClient sends its own context, whose actor is
`human` unless its caller sets one. Middleware receives it, so AFD's journal
middleware (`afd.server.journal.create_journal_middleware`) runs behind the host
and records the actor, and a handler reads it with
`botcore.context.current_call()` instead of taking the caller as an input.

`create_host_mcp_server(host, command_tools=True)` maps to AFD's
`tool_strategy="individual"` (`command_tools=False` uses `"lazy"`), serving each
command as its own MCP tool, named as the host serves it, beside AFD's five
meta-tools and the compatibility `start`, `call` and `docs` aliases. Callers
may also pass `tool_strategy="grouped"` or `tool_strategy="hybrid"` (with
`first_class_tools`). Each command tool publishes the catalog's `input_schema`
as AFD's `advertised_input_schema` (so the host stays the sole validator) and
carries annotations from the command's declared effects: `readOnlyHint` when
every possible effect is `inspect`, otherwise `destructiveHint`, so a client's
permission rules can tell a write from a read. A `**kwargs` handler is served,
and an unknown or ill-typed input is refused with AFD's `VALIDATION_ERROR` and
its `suggestedFields` instead of being dropped or refused by the SDK. A command
named like a compatibility meta-tool (`start`, `call`, `docs`, or `run` even
when raw Python is off) or a reserved AFD meta-tool (`afd-discover`,
`afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`) is refused when the server is
built. Commands are synced on each request, so one registered later is listed
and called alike (late commands colliding with reserved names are skipped). Only
the served spelling is a command tool (`issue_claim` returns `COMMAND_NOT_FOUND`
rather than reaching `issue-claim`).

The annotations are hints for a client's own rules, not a boundary: `afd-call`,
`afd-batch`, `afd-pipe`, `<host>-call`, and `<host>-run` when raw Python is on,
still reach every command, so a rule that denies `pr-merge` must deny those too.
A host's profile still decides: an `inspection` host lists its write commands,
marked destructive, and refuses each call with `EFFECT_DENIED` in
`create_host_policy_middleware`, as `afd-discover` and `<host>-start` list them.

Managed raw Python requires BOTH `raw_python=True` and an explicit
`ExecutionContext(..., profile="trusted-local")`. It adds `alfred-run` and is
absent from inspection hosts. Supplied command functions still dispatch through
the host, including positional argument calls. Arbitrary Python, installed
plugins, project tool configuration and subprocesses remain trusted local code.
These checks do not provide adversarial confinement or a sandbox.

Category release operations reject npm projects with `RELEASE_PROTOCOL_REQUIRED`
before reading/modifying their fragments. Use the host's approved npm release
unit/protocol workflow. Category fragments retain their existing format in
non-npm projects, but foreign/mixed headers and unowned deletion paths fail
before mutation. This is safe denial, not an npm release-protocol adapter.

Source relocation does not transfer publication authority. The root Botcore
adaptation is versioned 0.6.0 for the additive host API; optional distributions
retain upstream versions. Registry dependency floors and bundled skill assets
remain preserved. `lushly-botcore` publishes from AFD (`publish-botcore.yml`); the
other distributions remain quarantined until a separately approved release plan. The agents package declares its optional `connectors`
extra for wildcard discovery; requesting that integration while unavailable
returns actionable INTEGRATION_UNAVAILABLE before creating an LLM session.

The local-source bootstrap uses Python AFD 0.13 and MCP SDK 2.3. Managed hosts
(`create_host_mcp_server`) require the `mcp` extra (`afd[server]>=0.13.0` and
`mcp>=2.3,<3`). Legacy `create_mcp_server` keeps its small lazy import adapter
supporting MCP SDK 1 and 2 while retaining tool names and wire payloads.
SDK-level Python `call_tool` return objects follow the installed SDK version;
clients should use that SDK's supported content access API. Register host
commands before serving with `auth` so initial scope views cover every command.

## Serving hosts over HTTP

`botcore.host_http.create_host_http_app({"lane": host, ...}, tokens, uploads=...)`
remains Botcore's multi-host HTTP and upload gateway, serving several hosts from
one process under `/<route>` with the `mcp` extra's Starlette (for standard
single-host MCP over Streamable HTTP — including `2026-07-28` `server/discover`,
Skills, resources and OAuth bearer verification — use
`create_host_mcp_server(host).streamable_http_app(...)` instead). Under `/<route>` it answers `POST call`
(`{"command", "arguments"?, "onBehalfOf"?}`), `GET catalog`, `GET docs/<topic>`
and, when given an upload handler, `POST uploads` (raw bytes; the handler also
receives the query string's parameters). Every answer is a CommandResult: a
command's own refusal is HTTP 200, and the surface's refusals carry their status
and an AFD error with a suggestion: `UNAUTHORIZED` (401, no valid bearer token),
`FORBIDDEN` (403, a route this token does not open), `NOT_FOUND` (404),
`VALIDATION_ERROR` (400, a body without a command), `TIMEOUT` (408),
`PAYLOAD_TOO_LARGE` (413) and `RATE_LIMITED` (429). The token is checked first,
so a caller without one learns no route's name. A call's body is capped at
`max_call_bytes` (1 MiB), an upload at `max_upload_bytes` and
`upload_read_seconds` (120); at most `max_concurrent_uploads` (2) are received at
once, and one per token, so a slow caller cannot hold every slot. The caps hold
for chunked bodies too. The upload handler's parameters are the caller's claims,
like `onBehalfOf`, never its identity or route.

A token opens one route and names one actor. `botcore.host_tokens.TokenStore`
keeps them in a file holding each token's SHA-256 and never the token, in a
directory it creates private (`0700` on Unix). The operator issues, lists and revokes
them with `botcore host-token issue|list|revoke --store <file>` on the serving
machine, never over a route. Each change holds an OS lock on `<store>.lock`,
writes a new temporary file, syncs it and renames it into place, so concurrent
runs lose nothing and a reader never sees a partial file. The server re-reads the
file when it changes, so a revocation applies from the next call. A call runs
with an AFD `CommandContext` whose actor is the token's (`kind`, `id`, `label`);
`onBehalfOf` is what the caller says, capped at 200 characters, and is passed on
as such. Hosts served this way use the `remote-caller` profile.

On Windows, creation gives the directory, temporary file and lock a protected ACL
allowing only the operator account, SYSTEM and Administrators. Existing store
files, locks and holding directories must have a trusted owner and no grants to
other principals; `OWNER RIGHTS` is checked as the object's owner. Unreadable
ACLs, unsupported ACL entries and reparse points anywhere in the path are refused.
Ancestors must not let other principals redirect the path; the directory chain
is held open against replacement throughout the operation. Choose a private
directory for `--store`; Botcore does not change permissions on existing paths.
These rules are stricter than Loam's host check (#1134): the owner must be the
operator account, SYSTEM or Administrators; any allow entry for another
principal refuses a store file, whatever its rights; and an ancestor may grant
others reading or adding a subdirectory, but not writing data or attributes,
deleting, or changing its ACL or owner.
Windows readers take the same byte-range lock as writers, polling for up to ten
seconds before the operation fails, so a read cannot obstruct replacement. Unix keeps `flock` and its existing
file-mode protections. Neither platform needs an optional package for locking.

`serve_hosts(app, address, port)` runs it with Uvicorn and binds only to
loopback or a tailnet address (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`):
a wildcard, LAN or public address, or a host name, is refused unless
`allow_any=True`. The check is by range, and `100.64.0.0/10` is also
carrier-grade NAT space, so pass the address `tailscale ip -4` prints. Loopback
suits a server behind `tailscale serve`, which adds HTTPS.

`botcore.host_client.HostClient(url, route, token)` calls it with the standard
library only (`call`, `catalog`, `docs`, `upload` with optional parameters) and
returns CommandResults as dicts. It never follows a redirect and never sends its
token to one. A server it cannot reach is an error with `unavailable_code`
(`HOST_UNAVAILABLE` unless the caller names its own), never an exception, so a
script never falls back to another way of writing. `details.outcomeKnown` says
whether the request could have arrived: a refused connection is `true` (nothing
was sent), while a timeout or a proxy's 502, 503 or 504 is `false`, and the
suggestion says to read the state or retry the same call.
`create_remote_cli(name, env_prefix=...)` wraps it as a click CLI reading
`<PREFIX>_URL`, `_ROUTE` and `_TOKEN` (or `_TOKEN_FILE`); it prints the result
as JSON and exits 0 on success, 1 on a refusal and 2 when the server cannot be
reached.
