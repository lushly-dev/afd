---
name: security-auditor
description: >
  Audits MCP servers, AFD and Botcore command surfaces and agent setups for
  security: tool authorization, approval gates, code-execution tools, agent
  permissions and supply chain. Use for a security audit or a security review
  lane on a server, command, agent or dependency change.
metadata:
  source: botcore
  version: 2.1.0
  portable: true
---

# Security audit of MCP servers and agent systems

Every AFD command is an MCP tool, so any command surface counts as an MCP server here. For each tool, ask what it can do, who or what content can reach it, and what stops misuse at call time. Calibrate findings to those answers, not to a generic score. A repository's review lane sets the output format.

- **Evidence.** Cite file and line, a config key or command output for every finding, with a severity and a confidence. Mark anything below high confidence for human validation.
- **Secrets.** Report where a secret is, never its value.
- **No live attacks.** Don't run exploits, brute force or traffic against live systems.

## Classify every tool

| | Low sensitivity | High sensitivity |
|---|---|---|
| Read | Standard user auth | Elevated scope plus audit logging |
| Write | User auth plus confirmation | Elevated auth plus human approval |

High sensitivity means PII, credentials or audit logs; high impact means deployments, code changes, money or bulk operations. A tool that fetches URLs (check private ranges and cloud metadata endpoints are blocked), runs commands, touches files, reaches internal services or takes free-form command or path arguments is high-risk until shown otherwise.

## Calibrate severity

Severity runs from P0 (emergency) to P3 (low); in a review lane that uses BLOCKER and IMPROVEMENT, P0 and P1 are BLOCKERs unless the repository's lane defines blockers by impact (then follow it). Start from the usual rating, then apply these rules:
- **Write-capable tool:** raise one level. Injection against it does operational damage without any memory-corruption primitive.
- **Sensitive data at scale:** raise one level.
- **No per-tool authorization enforced server-side on every call:** P0 or P1, whatever the CVSS says.
- **Destructive action with no approval gate:** P1 at least.

Before rating a sandbox escape, ask three questions:
- **Trackable:** is the action logged with the caller's identity?
- **Recoverable:** is the worst case restorable content, rather than credentials or lateral movement?
- **Proportionate:** does the defence match the threat model?

For an identity-authenticated, audit-logged internal tool whose worst case is recoverable content, a theoretical escape is Low or Medium with those controls noted, not Critical. This never excuses missing authorization.

## Check declarations against enforcement

Metadata that nothing checks at call time is not a control.

- **AFD `requires`** is metadata only.
- **AFD `mutation` and `destructive`** become MCP `readOnlyHint` and `destructiveHint`. These are hints to the client, not gates.
- **AFD `approval: 'required'`** is enforced only where `createApprovalMiddleware` from `@lushly-dev/afd-server` is installed. Without it, the approval gate is missing.
- **Client prompts** don't count as the server's gate. Claude Code's permission modes bind only that client.
- **Botcore hosts** deny every effect except `inspect` before execution under the `inspection` profile, and undeclared commands fail closed (`botcore/host.py`). This is cooperative policy: installed plugins and their subprocesses are trusted code, so a hostile plugin is a supply-chain finding.

## Code-execution tools

Botcore's execute tools are unconfined by design ([`host-composition.md`](https://github.com/lushly-dev/afd/blob/main/endpoints/botcore/docs/host-composition.md)):
- **Legacy `create_mcp_server`.** Its `{name}-run` executes any Python, checked only for syntax and a 32,000-character limit.
- **Managed hosts.** `create_host_mcp_server(host, raw_python=True)` requires the `trusted-local` profile. Command calls go through policy, but the code can still `import os`.

They are fine for the local user who could run the code anyway. Rate one as RCE (P0/P1) when another user or a network transport can reach it, when the legacy factory serves an inspection host, or when the agent calling it also reads untrusted content (web pages, issues, third-party tool output).

If code execution must face untrusted input, require all of the following:
- **Import allowlist.** Use an allowlist, not a blocklist, enforced by a `__import__` wrapper.
- **AST validation before execution.** Reject dunder attribute access, dynamic `__import__`, nested `exec`/`eval`/`compile`, and `getattr` on blocked names. Namespace functions expose their module through `__globals__`, so without the dunder rule the allowlist confines nothing.
- **Curated builtins.** Remove `open`, `eval`, `exec`, `compile`, `__import__`, `globals`, `vars`, `breakpoint` and `input`. An `exec` namespace without `__builtins__` gets them all, as Botcore's do.
- **No `asyncio` on the allowlist,** even in an async runtime. `asyncio.create_subprocess_shell` and `create_subprocess_exec` start processes and bypass every builtins restriction.
- **Limits** on code length, run time and output.

These raise the cost of an escape. They don't isolate: adversarial input needs a separate process, container or VM.

## Agent permissions (Claude Code)

- **`--dangerously-skip-permissions`** is `bypassPermissions` mode, which skips permission prompts, including for writes to `.git` and `.claude`. Intentional use in an isolated container, VM or CI runner is informational; default-on, user-facing, or on a host with credentials and network access, it is critical. Managed settings can forbid it with `permissions.disableBypassPermissionsMode: "disable"`.
- **Subagents** inherit every tool of the main conversation, MCP tools included, unless `tools` or `disallowedTools` narrows them.
  - A parent in `bypassPermissions`, `acceptEdits` or auto mode overrides the subagent's `permissionMode`. A "read-only" reviewer spawned from a bypass session can therefore write unless its tool list stops it.
  - Plugin subagents ignore `permissionMode`, `hooks` and `mcpServers`.
- **Secret files.** Claude Code ignores `.claudeignore`; check `permissions.deny` rules such as `Read(./.env)`. They cover the built-in file tools and recognized Bash file commands such as `cat`, not a script that opens the file itself; only the sandbox enforces access at the OS level.

## Supply chain

Models invent plausible package names, and attackers register them (slopsquatting). Before an agent-suggested dependency goes in, confirm it exists, has a release history and a maintainer, and isn't a near-typo of a popular package. Give third-party MCP servers and skills the same scrutiny: their descriptions reach the model and their code runs with the user's permissions.
