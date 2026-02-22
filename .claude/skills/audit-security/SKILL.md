---
name: audit-security
source: botcore
description: >
  Performs comprehensive security audits of web applications, APIs, MCP servers, and AI agent systems. Covers OWASP/CWE vulnerability discovery, threat modeling, SAST/DAST/SCA tooling, MCP server hardening, agentic review orchestration, supply chain security, secret management, risk prioritization, and structured reporting. Use when performing security audits, reviewing code for vulnerabilities, hardening MCP servers, designing agent permission models, building CI/CD security gates, or generating audit reports. Triggers: security audit, vulnerability, OWASP, CWE, threat model, injection, XSS, SSRF, MCP security, agent security, SAST, DAST, SCA, secrets scanning, supply chain, SBOM, penetration test, security checklist, access control, authentication, sanitize.

version: 1.0.0
triggers:
  - security audit
  - vulnerability
  - OWASP
  - CWE
  - threat model
  - injection
  - XSS
  - SSRF
  - MCP security
  - agent security
  - SAST
  - DAST
  - SCA
  - secrets scanning
  - supply chain
  - SBOM
  - security checklist
  - access control
  - authentication
  - sanitize
portable: true
---

# Security Audit

Expert guidance for comprehensive security audits of web applications, services, MCP servers, and AI agent systems.

## Capabilities

1. **Scope and plan audits** -- Define review targets, set objectives, and establish definition of done
2. **Threat model** -- Identify assets, trust boundaries, abuse cases, and route audit effort to high-risk paths
3. **Vulnerability discovery** -- Apply OWASP/CWE-mapped checklists across injection, auth, XSS, SSRF, and more
4. **Secure coding review** -- Evaluate code against defense-in-depth principles (least privilege, complete mediation, fail securely)
5. **Tooling guidance** -- Select and integrate SAST, DAST, SCA, secrets scanning, and fuzzing into CI/CD pipelines
6. **MCP server hardening** -- Audit MCP-specific risks: tool authorization, prompt injection, egress controls, sandbox policy
7. **Agent security** -- Review permission models, subagent inheritance, `--dangerously-skip-permissions` usage, and supply chain threats
8. **Risk prioritization** -- Combine CVSS with contextual risk, exploit likelihood, and MCP severity multipliers
9. **Reporting** -- Generate findings with standard schemas, executive summaries, remediation plans, and metrics

## Routing Logic

| Request type | Load reference |
|---|---|
| Audit scope, objectives, definition of done | [references/scope-and-objectives.md](references/scope-and-objectives.md) |
| Threat modeling, STRIDE, abuse cases, trust boundaries | [references/threat-modeling.md](references/threat-modeling.md) |
| Secure coding principles, defense in depth | [references/secure-coding-principles.md](references/secure-coding-principles.md) |
| Vulnerability classes, OWASP, CWE, injection, XSS, SSRF | [references/vulnerability-classes.md](references/vulnerability-classes.md) |
| SAST, DAST, SCA, secrets scanning, CI/CD security gates | [references/tooling-and-cicd.md](references/tooling-and-cicd.md) |
| MCP server security, tool authorization, prompt injection, sandbox | [references/mcp-server-security.md](references/mcp-server-security.md) |
| Agent security, permissions, subagents, supply chain, secrets | [references/agent-and-supply-chain.md](references/agent-and-supply-chain.md) |
| Agentic review, automated audit workflow, agent safety | [references/agentic-review-workflow.md](references/agentic-review-workflow.md) |
| Manual review checklists, web app checklist, MCP checklist | [references/checklists.md](references/checklists.md) |
| Findings schema, report templates, metrics, KPIs | [references/reporting-and-metrics.md](references/reporting-and-metrics.md) |
| Risk prioritization, CVSS, severity rubric, remediation SLAs | [references/risk-prioritization.md](references/risk-prioritization.md) |
| OWASP Top 10 quick reference | [references/owasp-top-10.md](references/owasp-top-10.md) |

## Core Principles

### 1. Risk-Driven Scope

Threat model first, then route effort to high-risk code paths. Never "review everything" -- prioritize hotspots identified by the threat model.

### 2. Evidence-Based Findings

Every finding must cite file path, line range, config key, or tool output. Assign severity and confidence; if confidence is not High, recommend human validation.

### 3. Layered Discovery

Combine automated tools (SAST/DAST/SCA) with targeted manual review. No single technique catches everything.

### 4. No Exploit Attempts

Agents must not run active exploitation, brute force, or production traffic generation. Use static reasoning and safe scanning only.

### 5. Consistent Severity

Use CVSS as baseline, adjust with contextual risk (exposure, blast radius, compensating controls). Apply MCP severity multipliers for write-capable tools.

### 6. Actionable Output

Findings include recommended fixes, verification steps, remediation SLAs, and owner assignments. Reports serve both executives and engineers.

### 7. Never Expose Secrets

Never include actual secret values in audit output. Report that secrets exist and their location, but redact values. Redact tokens, keys, and credentials from all outputs.

## Workflow

### Security Audit Protocol

#### 1. Pre-Audit Checks

- [ ] Verify `.claudeignore` exists (protects secrets from agent access)
- [ ] Check `.gitignore` includes `.env`, credentials
- [ ] Verify `.env` files are NOT readable by agents
- [ ] Note any existing security documentation

#### 2. Threat Model

- Identify assets (credentials, PII, business-critical workflows)
- Map trust boundaries (browser, edge, app, services, data stores, MCP client/server)
- Enumerate entry points (endpoints, file uploads, webhooks, tool adapters)
- Develop abuse cases using STRIDE or equivalent framework
- Route audit effort to high-risk paths

#### 3. Automated Scanning

- Run SAST with high-confidence rules
- Run SCA for known vulnerable dependencies
- Run secrets scanning
- Triage results, set baselines, reduce false positives

#### 4. Manual Review

Use checklists from `references/checklists.md` covering:

- Authentication and session management
- Authorization and access control
- Input validation and injection
- Output encoding and XSS
- SSRF and network safety
- Cryptography and secrets
- MCP tool authorization and argument safety
- Agent permission models

#### 5. Report and Remediate

Output findings using the standard report format below.

### Output Format -- Full Audit

```markdown
## Security Audit Report

### Scope
[Components reviewed, exclusions, commit hash, date]

### Threat Model Summary
[Key assets, trust boundaries, top abuse cases]

### Findings

| ID | Severity | Confidence | Category | Title | Location | Fix |
|---|---|---|---|---|---|---|
| FND-001 | Critical | High | AccessControl | [Title] | [file:line] | [Remediation] |

### Systemic Recommendations
- [Patterns to adopt, guardrails to add, pipeline gates to enforce]

### Remediation Plan

| Finding | Owner | SLA | Retest Criteria |
|---|---|---|---|
```

### Output Format -- Quick Security Check

```markdown
## Security Check: [Component]

### CRITICAL (Immediate Action Required)
[List or "None"]

### WARNINGS (Review Required)
[List or "None"]

### INFORMATIONAL
[List or "None"]

### Summary
[2-3 sentence assessment]
```

## Quick Reference -- OWASP Top 10

| Risk | Prevention |
|---|---|
| Injection | Parameterized queries, input validation, strict allowlists |
| Broken Auth | Strong sessions, MFA, secure tokens, rotation |
| XSS | Output encoding, CSP, DOMPurify, sanitization |
| Insecure Design | Threat modeling, secure defaults, rate limiting |
| Security Misconfiguration | Hardened defaults, least privilege, remove debug |
| Vulnerable Components | Regular updates, dependency audits, slopsquatting checks |
| Auth Failures | MFA, strong password policy, secure session flags |
| Integrity Failures | Sign commits, verify CI artifacts, use SRI |
| Logging Failures | Log auth events, centralize logs, monitor anomalies |
| SSRF | URL allowlists, block private IPs, DNS pinning, timeouts |

## Checklist

### Traditional Security

- [ ] **Auth**: Backend access control enforced on every object access
- [ ] **Input**: All input validated against schema at trust boundaries
- [ ] **Output**: User content sanitized with contextual encoding
- [ ] **Secrets**: No hardcoded secrets; `.env` protected; ephemeral credentials preferred
- [ ] **Deps**: No high/critical vulnerabilities; slopsquatting checks done
- [ ] **Logs**: No sensitive data logged; security events captured with context
- [ ] **Crypto**: Standard libraries, correct parameters, strong password hashing

### Agent and MCP Security

- [ ] **Agent Access**: `.claudeignore` protects secrets from agent access
- [ ] **MCP Input**: All tool inputs validated with strict JSON schemas
- [ ] **MCP Output**: External data wrapped/sanitized against prompt injection
- [ ] **MCP Auth**: Per-tool authorization enforced server-side; user identity propagated
- [ ] **Permissions**: Subagents use least privilege; write tools require elevated auth
- [ ] **Supply Chain**: New packages verified before install; SBOM generated
- [ ] **Approval Gates**: Human approval required for high-impact actions

### CI/CD Security Gates

- [ ] **PR merge**: No new Critical/High SAST findings; no detected secrets
- [ ] **Release**: No known-exploited vulnerabilities; SBOM generated and signed
- [ ] **Deploy**: DAST clean on Critical; no unresolved P0/P1 from manual review

## When to Escalate

Escalate to human review immediately when any of these are suspected:

- Authentication bypass or credential leakage
- Cross-tenant data access
- Remote code execution
- Write-capable MCP tool without authorization checks
- Suspected supply chain compromise (slopsquatting, typosquatting, compromised packages)
- Findings requiring production access to validate
- Signing key exposure
- Missing per-tool authorization in MCP servers
