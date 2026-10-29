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
with core commands/docs. Plugins cannot override host branding. Plugin command
policies must be provided explicitly and plugins must declare
`host_context_safe = True` after a per-host state audit. The bundled optional
LLM, agents, memory, connectors, and Teams distributions remain preserved;
this change does not claim their stateful implementations are admitted to a
managed multi-worktree host. In particular, their module-global configuration
needs adapters before such admission. No optional plugin is auto-installed or
auto-enabled by `build_host`.

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
Effects, capabilities, path arguments and artifact output scope are discoverable
in `host.catalog()`. Conditional effects (such as lint `fix`) are evaluated
against bound arguments before invocation.

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
remain preserved. All distributions remain quarantined until a separately
approved release plan. The agents package declares its optional `connectors`
extra for wildcard discovery; requesting that integration while unavailable
returns actionable INTEGRATION_UNAVAILABLE before creating an LLM session.

The local-source bootstrap uses Python AFD 0.10 and MCP SDK 2.3. A small lazy
import adapter supports MCP SDK 1 and 2 while retaining tool names and wire
payloads. SDK-level Python `call_tool` return objects follow the installed SDK
version; clients should use that SDK's supported content access API.
