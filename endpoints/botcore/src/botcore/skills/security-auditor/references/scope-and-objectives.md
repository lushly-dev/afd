# Audit Scope and Objectives

How to define what's in scope, set success criteria, and establish a clear definition of done.

## Scope Definition for Web Applications and Services

Explicitly enumerate all components -- web systems spread security-relevant logic across code, config, and pipelines.

### In-Scope Components (Recommended Default)

| Component | What to include |
|---|---|
| Application source code | Request routing, controllers/handlers, auth/session logic, templating, serialization, business logic, background jobs, admin/debug routes |
| API surfaces | REST, GraphQL, WebSocket handlers, RPC endpoints, webhooks, queue consumers |
| Data access layers | ORM/query builders, raw SQL, caching, object storage, search indexes |
| Configuration and deployment | Environment variables, config files, feature flags, IaC, container definitions, K8s manifests, reverse proxy config, CORS/CSP policies |
| Dependencies and supply chain | Direct and transitive dependencies, lockfiles, vendored code, build scripts, artifact repos, container images |
| CI/CD pipelines | Build/test workflows, secrets handling, release automation, artifact signing, provenance, deployment gating |
| Observability | Security logging, audit logs, metrics, alerts, error handling paths that may leak data |

### Additional Scope for MCP Servers

| Component | What to include |
|---|---|
| MCP server implementation | Transport, session handling, tool registry |
| Tool adapters (connectors) | Bridges to DBs, ticketing, CI, cloud APIs |
| Authorization model | Per-user identity propagation, per-tool permissions, tenant separation |
| Resource exposure | Documents, knowledge bases, file systems, APIs the server reads/writes |
| Network topology | Inbound exposure, egress permissions, internal network access |
| Logging and monitoring | Tool invocation logs, input/output redaction, correlation IDs |
| Protocol conformance | Where the deployment deviates from the MCP spec; which security properties are out-of-band |

## Audit Objectives

Set objectives that are testable:

1. **Identify vulnerabilities** with reproducible evidence (code locations, execution paths, configs)
2. **Validate security controls** -- authentication, authorization, session security, input validation, output encoding, secrets management, crypto, SSRF controls, logging
3. **Quantify risk** and prioritize remediation using CVSS + contextual risk
4. **Produce actionable remediations** -- code-level fixes, config changes, pipeline controls, retest criteria
5. **Improve systemic posture** -- recommend guardrails, standard libraries, and CI/CD gates to prevent recurrence

## Definition of Done

An audit is complete when:

- [ ] Threat model completed and reviewed
- [ ] Automated scan results triaged (false positives reduced, baselines set)
- [ ] Manual review completed for all high-risk zones identified by threat model
- [ ] Findings report delivered with agreed severities, owners, deadlines, and retest plan
- [ ] Evidence bundle archived (tool outputs, versions/configs, commit hashes, scan timestamps)

## Scoping Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| "Review everything" | Unbounded effort, shallow coverage | Threat-model to prioritize hotspots |
| Excluding CI/CD and config | Misses deployment-level vulns | Always include pipeline and config |
| Ignoring dependencies | Supply chain risk is real | SCA + SBOM are mandatory |
| Skipping MCP tool adapters | Largest MCP risks live here | Treat tool adapters as privileged code |
