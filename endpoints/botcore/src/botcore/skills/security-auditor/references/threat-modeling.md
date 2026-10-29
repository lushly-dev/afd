# Threat Modeling

How to build threat models that produce concrete audit guidance.

## Threat Modeling Process

1. **Identify assets** -- Credentials, tokens, PII, payment data, business-critical workflows, admin functions, signing keys, internal APIs
2. **Map trust boundaries** -- Browser to edge to app to internal services to data stores; third-party integration boundaries
3. **Enumerate entry points** -- Endpoints, file uploads, webhooks, background job payloads, deserialization paths, management ports
4. **Develop abuse cases** -- What a capable attacker would try given typical constraints
5. **Route audit effort** -- Focus manual review on critical workflows (authn/z, money movement, tenancy, data export, tool execution)

## Threat Modeling Frameworks

| Framework | Focus | Best for |
|---|---|---|
| STRIDE | Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation | General software threat categories |
| LINDDUN | Linkability, Identifiability, Non-repudiation, Detectability, Disclosure, Unawareness, Non-compliance | Privacy-focused analysis |
| PASTA | Process for Attack Simulation and Threat Analysis | Process-centric, risk-driven models |
| ATT&CK | Adversary tactics, techniques, procedures | Adversary TTP mapping |

**Best practice:** Keep the model small and auditable -- a single trust boundary diagram plus an abuse-case list that maps to code modules and tests.

## MCP Server Threat Model

MCP servers introduce distinct threats because untrusted, model-generated text can become structured tool invocations.

### MCP-Specific Threat Categories

| Threat | Description | Example |
|---|---|---|
| Prompt injection | Malicious inputs influence tool use | User input causes unauthorized tool call |
| Tool injection | Cross-tool contamination via retrieved content | Malicious document triggers data export |
| Data exfiltration | Overbroad data access via model requests | "Export all customer records" |
| Privilege escalation | Tools run with server-level instead of user-level permissions | Shared service account bypasses user scopes |
| SSRF | Tools coerced into scanning internal networks | URL-fetch tool reaches metadata service |
| Integrity threats | Unauthorized writes or subtle record manipulation | Ticket creation, code changes, deployments |
| Availability threats | Expensive tool calls, large payloads, runaway loops | Rate-limit bypass, recursive agent loops |
| Authorization confusion | Model conflates "user intent" with "authorized action" | Data access beyond user's rights |

## Abuse Case Template

```markdown
## Abuse Case: [Name]

- **Attacker profile:** [External user / Insider / Compromised service]
- **Target asset:** [What they want to access or modify]
- **Attack path:** [How they would attempt it]
- **Preconditions:** [What must be true for the attack to work]
- **Impact:** [What happens if successful]
- **Affected code:** [Modules, endpoints, tools]
- **Current controls:** [What defenses exist today]
- **Gaps:** [What's missing or weak]
```

## Trust Boundary Diagram Guidance

At minimum, diagram these boundaries:

- Client (browser/mobile) to Edge/CDN/WAF
- Edge to Application tier
- Application to Internal services
- Application/Services to Data stores
- Application to Third-party APIs
- MCP client (LLM) to MCP server
- MCP server to Tool adapters to Backend systems

Mark each boundary with: authentication method, data sensitivity, and directionality of trust.
