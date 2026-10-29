# Plan: Typed Connectors

> **Status:** Complete — Phase 1 shipped; Phases 2-4 deferred
> **Date:** 2026-02-25
> **Updated:** 2026-02-26 — Phase 1 (specs 01-05) implemented: connector base, auth, config/plugin, security model, GitHub connector (248 tests)
> **Scope:** External system integrations as typed botcore commands — no raw API calls, no filesystem, no shell. Separate botcore plugin package (`botcore-connectors`).
> **Depends on:** botcore core, [LLM Runtime](../llm-runtime/00-overview.plan.md) (`botcore-llm` plugin, for tool bridging), `afd` Python package (middleware, validation, batch execution, telemetry)

---

## Summary

Connectors are botcore commands that provide typed, validated access to external systems. Each connector is a set of `CommandResult`-returning async functions with Pydantic input schemas. Agents interact with the outside world exclusively through connectors — never raw HTTP, shell, or filesystem.

This is the primary security boundary: the attack surface is the connector's input schema, not the entire system.

---

## Architecture

```
Agent (via Copilot session)
    ↓ tool call
Command-Tool Bridge (from LLM Runtime)
    ↓ validated args
Connector Command (Pydantic input → CommandResult output)
    ↓ typed API call
External System (GitHub API, Microsoft Graph, Azure, etc.)
```

### Why Connectors, Not Raw Access

| OpenClaw pattern | Connector pattern |
|-----------------|-------------------|
| Agent calls `bash("curl https://api.github.com/...")` | Agent calls `github_issue_create(repo, title, body)` |
| Shell injection, SSRF, credential leak | Pydantic validates input, SDK handles auth, no shell |
| 30+ exec bypass GHSAs | Zero exec surface — the command IS the API |

---

## Connector Design Pattern

Each connector follows a consistent structure:

```python
# src/botcore/connectors/github.py

async def github_issue_create(
    repo: str,
    title: str,
    body: str = "",
    labels: list[str] | None = None,
    assignees: list[str] | None = None,
) -> CommandResult[dict]:
    """Create a GitHub issue. Returns issue number and URL."""
    # Validate repo format
    if "/" not in repo:
        return error("INVALID_REPO", f"Expected owner/repo format, got: {repo}",
                      suggestion="Use format: owner/repo (e.g., lushly-dev/botcore)")
    
    result = await _gh_api("POST", f"/repos/{repo}/issues", json={
        "title": title, "body": body,
        "labels": labels or [], "assignees": assignees or [],
    })
    
    return success(
        data={"number": result["number"], "url": result["html_url"]},
        reasoning=f"Created issue #{result['number']} in {repo}",
    )
```

### Auth Strategy

Connectors authenticate through **environment variables or Azure Entra ID** — credentials never appear in botcore.toml or agent config:

```python
# src/botcore/connectors/auth.py

class ConnectorAuth:
    """Resolve auth for connector APIs. Never exposes tokens to agents."""
    
    @staticmethod
    async def github_token() -> str:
        """GH_TOKEN or gh auth token."""
    
    @staticmethod
    async def graph_token(scope: str) -> str:
        """Azure Entra ID token for Microsoft Graph. Uses managed identity or device code."""
    
    @staticmethod
    async def azure_token(resource: str) -> str:
        """Azure resource token via DefaultAzureCredential chain."""
```

### AFD Middleware for Connector Base

The connector `_api_call` helper composes AFD's middleware stack for retry, rate limiting, logging, and telemetry rather than hand-rolling these cross-cutting concerns:

```python
from afd.middleware import compose_middleware, default_middleware
from afd.middleware import create_retry_middleware, create_rate_limit_middleware
from afd.telemetry import TelemetrySink, create_telemetry_event

# Connector middleware stack — applied to every API call
_connector_middleware = compose_middleware([
    *default_middleware(),                              # auto trace ID + logging + timing
    create_retry_middleware(max_retries=3, backoff_factor=2.0),  # Exponential backoff
    create_rate_limit_middleware(requests_per_second=10),        # Per-connector rate limiting
])
```

### AFD Validation Schemas

Connector input validation uses AFD's pattern types from the validation module (#143) for common field formats:

```python
from afd.validation import EmailStr, UuidStr, validate_input_enhanced
from afd.validation import PaginationParams, SearchParams

# Email connector uses EmailStr for format validation
async def email_send(to: EmailStr, subject: str, body: str) -> CommandResult[dict]: ...

# List commands use PaginationParams for consistent pagination
async def github_issue_list(
    repo: str, pagination: PaginationParams = PaginationParams()
) -> CommandResult[list[dict]]: ...
```

### AFD Batch Execution for Bulk Operations

Connectors that operate on multiple items (e.g., uploading multiple blobs) use AFD's `execute_batch()` for structured batch semantics:

```python
from afd.batch import execute_batch, BatchResult

async def azure_blob_upload_batch(
    files: list[dict],  # [{"path": ..., "content": ...}]
    on_failure: str = "continue",  # "continue" or "stop"
) -> CommandResult[BatchResult]:
    """Upload multiple files. Returns per-file success/failure."""
    return await execute_batch(
        [azure_blob_upload(**f) for f in files],
        on_failure=on_failure,
    )
```

---

## Connector Inventory

### Tier 1 — Core (ship with botcore)

| Prefix | System | Commands | Auth |
|--------|--------|----------|------|
| `github_` | GitHub API | `issue_create`, `issue_list`, `issue_comment`, `pr_create`, `pr_list`, `pr_review`, `search_code`, `search_issues` | `GH_TOKEN` / `gh` CLI |
| `azure_blob_` | Azure Blob Storage | `upload`, `download`, `list`, `delete` | `DefaultAzureCredential` |
| `azure_queue_` | Azure Service Bus | `send`, `receive`, `peek`, `complete` | `DefaultAzureCredential` |

### Tier 2 — Microsoft Graph (for Teams integration)

| Prefix | System | Commands | Auth |
|--------|--------|----------|------|
| `email_` | Outlook (Graph) | `send`, `search`, `read`, `reply` | Entra ID (delegated) |
| `calendar_` | Calendar (Graph) | `create_event`, `list_events`, `update_event`, `find_availability` | Entra ID (delegated) |
| `teams_` | Teams (Graph) | `send_message`, `read_messages`, `create_channel`, `list_channels` | Entra ID (app) |

### Tier 3 — DevOps

| Prefix | System | Commands | Auth |
|--------|--------|----------|------|
| `ado_` | Azure DevOps | `work_item_create`, `work_item_update`, `pipeline_run`, `pr_create` | PAT or Entra ID |
| `devops_` | Generic CI/CD | `pipeline_status`, `artifact_download` | Per-provider |

---

## Configuration

```toml
# botcore.toml

[connectors]
enabled = ["github", "azure_blob", "email"]   # Only these connectors are loaded

[connectors.github]
default_repo = "lushly-dev/botcore"            # Optional default for repo arg
api_version = "2022-11-28"

[connectors.azure_blob]
account_name = "myteamstorage"
container = "agent-artifacts"

[connectors.email]
from_address = "agent@contoso.com"             # Sender for outbound
```

### Agent Connector Scoping

From the agent orchestration config — each agent declares which connectors it can use:

```toml
[agents.developer]
connectors = ["github"]           # Can ONLY call github_* commands

[agents.coordinator]
connectors = ["github", "email", "calendar"]  # Broader access
```

The LLM Runtime bridge only exposes tools for the agent's declared connectors. An agent configured with `connectors = ["github"]` will never see `email_send` as an available tool.

---

## Package Structure

Shipped as a standalone pip-installable plugin — **not** inside `src/botcore/`.

```
botcore-connectors/
├── pyproject.toml                # entry-point: [project.entry-points."botcore.plugins"]
├── src/
│   └── botcore_connectors/
│       ├── __init__.py               # BotCorePlugin implementation
│       ├── auth.py                   # Auth resolution (env vars, Entra ID, managed identity)
│       ├── base.py                   # _api_call helper, retry, error mapping
│       ├── github.py                 # github_* commands
│       ├── azure_blob.py             # azure_blob_* commands
│       ├── azure_queue.py            # azure_queue_* commands
│       ├── email.py                  # email_* commands (Microsoft Graph)
│       ├── calendar.py               # calendar_* commands (Microsoft Graph)
│       └── teams.py                  # teams_* commands (Microsoft Graph)
└── tests/
    └── ...
```

### Plugin Registration

```toml
# botcore-connectors/pyproject.toml
[project]
name = "botcore-connectors"
dependencies = ["botcore", "httpx", "azure-identity", "afd"]

[project.optional-dependencies]
github = []                           # gh CLI only, no extra deps
azure = ["azure-storage-blob", "azure-servicebus"]
graph = ["msgraph-sdk"]

[project.entry-points."botcore.plugins"]
connectors = "botcore_connectors:ConnectorsPlugin"
```

```python
# botcore_connectors/__init__.py
from botcore.plugin import BotCorePlugin

class ConnectorsPlugin(BotCorePlugin):
    def register(self, registry):
        from .github import GITHUB_COMMANDS
        from .azure_blob import AZURE_BLOB_COMMANDS
        from .email import EMAIL_COMMANDS
        # Only register connectors that are enabled in config
        registry.add_commands(GITHUB_COMMANDS)
        registry.add_commands(AZURE_BLOB_COMMANDS)
        registry.add_commands(EMAIL_COMMANDS)
        registry.set_mcp_name("connectors")
        registry.add_docs("connectors", CONNECTOR_DOCS)
```
```

---

## Phases

### Phase 1: GitHub Connector ✅ Complete

- [x] Scaffold `botcore-connectors` plugin package with `pyproject.toml` + entry-point
- [x] `ConnectorsPlugin` implementing `BotCorePlugin.register()`
- [x] Connector base: `ConnectorBase` with inlined retry, rate-limiting, backoff, telemetry
- [x] Auth resolution: `GH_TOKEN` env var, `gh auth token` fallback, token caching
- [x] Input validation: `validate_inputs()`, `check_owner_repo()`, `check_max_length()`, `PaginationParams`
- [x] Commands: `github_issue_create`, `github_issue_list`, `github_issue_comment`
- [x] Commands: `github_pr_create`, `github_pr_list`, `github_pr_review`, `github_search_code`, `github_search_issues`
- [x] `ConnectorsConfig` Pydantic model with per-connector sub-models
- [x] `[connectors].enabled` filtering — disabled connectors register zero commands
- [x] 248 unit tests with mocked HTTP responses (respx)
- [x] Security: scope enforcement, audit logging, token redaction, input validation

**Acceptance criteria:** All met
- [x] `github_issue_create(title="Test")` returns `CommandResult` with issue URL
- [x] Invalid repo format returns `INVALID_REPO` error with suggestion
- [x] Connector not in `enabled` list → commands not registered
- [x] Auth failure returns `GITHUB_AUTH_MISSING` with setup suggestion
- [x] Rate limit hit → dual tracking (API vs search), pre-flight check, `X-RateLimit-Reset` backoff

### Phase 2: Azure Connectors

- [ ] `DefaultAzureCredential` integration
- [ ] `azure_blob_upload`, `azure_blob_download`, `azure_blob_list`
- [ ] `azure_blob_upload_batch` using AFD `execute_batch()` for multi-file uploads
- [ ] `azure_queue_send`, `azure_queue_receive`
- [ ] Managed identity support for production deployments

### Phase 3: Microsoft Graph Connectors

- [ ] Entra ID auth (device code flow for dev, managed identity for prod)
- [ ] `email_send`, `email_search`, `email_read`
- [ ] `calendar_create_event`, `calendar_list_events`
- [ ] `teams_send_message`, `teams_read_messages`

### Phase 4: DevOps Connectors

- [ ] Azure DevOps: work items, pipelines, PRs
- [ ] Pipeline status monitoring for CI/CD integration

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| SSRF via connector | Connectors call specific API endpoints. No arbitrary URL construction. |
| Credential exposure to agent | Auth resolved server-side. Tokens never in tool args or results. |
| Over-privileged agent | Per-agent connector scoping in config. Bridge only exposes declared connectors. |
| API abuse / rate limiting | AFD `create_rate_limit_middleware()` + `create_retry_middleware()` with exponential backoff in connector base. Per-connector quotas via middleware config. |
| Data exfiltration | Connectors are the ONLY external access. No raw HTTP, no shell, no filesystem. |

---

## AFD Integration Summary

| AFD Module | Used For | Replaces |
|---|---|---|
| `afd.middleware` | Connector base `_api_call` middleware stack (retry, rate limit, logging, timing) | Hand-rolled retry loops and rate limit handling |
| `afd.validation` | Input validation with `EmailStr`, `UuidStr`, `PaginationParams`, `SearchParams` | Custom Pydantic field validators per connector |
| `afd.batch` | `execute_batch()` for bulk connector operations (multi-file upload, etc.) | Custom batch loops |
| `afd.telemetry` | `TelemetryEvent` for connector call metrics (latency, error rates) | Custom metrics tracking |
| `afd.testing` | JTBD scenario tests for connector workflows | Ad-hoc pytest fixtures |

---

## Error Patterns

Every connector error includes a `suggestion` for LLM self-correction:

```python
# Auth not configured
error("GITHUB_AUTH_MISSING", "No GitHub token found",
      suggestion="Set GH_TOKEN environment variable or run 'gh auth login'")

# Rate limited
error("GITHUB_RATE_LIMITED", "API rate limit exceeded, resets at 14:30 UTC",
      suggestion="Wait 5 minutes or reduce request frequency")

# Not found
error("GITHUB_NOT_FOUND", "Repository 'owner/nonexistent' not found",
      suggestion="Verify the repository name and your access permissions")

# Validation
error("INVALID_INPUT", "Email address format invalid",
      suggestion="Use format: user@domain.com")
```
