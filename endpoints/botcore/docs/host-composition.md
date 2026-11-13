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

The host owns CLI/MCP names. The managed MCP tools are `alfred-start`,
`alfred-docs`, and `alfred-call`; the CLI offers `catalog` and `call NAME JSON`.
All three surfaces enter `host.execute`. `host.direct_client()` returns the AFD
DirectClient, including its normal pipeline support. Quality verdicts live in
`result.metadata.quality` with `status`, `target`, and `evidence`.
`CommandResult.success` keeps its original execution meaning. CLI exit status
also rejects nonpassing quality verdicts. Use `aggregate_quality` for required
check plans; empty plans and required skipped/unavailable checks never pass.

Host plugins are explicitly selected by entry-point name (`plugins=("alfred",)`).
Missing, duplicate, or failing selections reject construction. Registration
rejects duplicate command names and documentation topics, including collisions
with core commands/docs. Plugins cannot override host branding. Every plugin
command needs an explicit policy, and plugins must declare
`host_context_safe = True` after a per-host state audit. The bundled optional
LLM, agents, memory, connectors, and Teams distributions remain preserved;
this change does not claim their stateful implementations are admitted to a
managed multi-worktree host. In particular, their module-global configuration
needs adapters before such admission. No optional plugin is auto-installed or
auto-enabled by `build_host`.

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
permits the admitted effects, including explicitly selected remediation. There
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
and the schema is published, not enforced, so values are not type-checked
before the call. `DirectClient.list_commands()` reports the same one-line
descriptions.

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

The local-source bootstrap uses Python AFD 0.10 and MCP SDK 2.3. A small lazy
import adapter supports MCP SDK 1 and 2 while retaining tool names and wire
payloads. SDK-level Python `call_tool` return objects follow the installed SDK
version; clients should use that SDK's supported content access API.
