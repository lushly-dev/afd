# Agentic Review Workflow

How to design safe, evidence-based automated security review workflows using AI agents.

## Design Principles for Safe Agentic Reviews

1. **No exploit attempts** -- Agents must not run active exploitation, brute force, or production traffic generation. DAST constrained to safe scan profiles against staging with explicit authorization.
2. **Read-only first** -- Agents use read-only repo access; tools run in isolated CI runners with no production secrets.
3. **Evidence-first outputs** -- Every finding must cite: file path, line range, config key, or tool output snippet, plus a reasoning chain a human can verify.
4. **Deterministic checklists** -- Agents follow checklists mapped to threat model and vulnerability classes, not free-form exploration.
5. **Separation of duties** -- One agent proposes findings; another validates; human reviews escalations.
6. **Strict data handling** -- Redact secrets/PII from outputs; avoid copying large code blocks; store sensitive evidence in controlled artifacts.

## Reference Workflow

```
Intake (repo + architecture + environment)
    |
Scope & Objectives Gate
    |
Threat Model Agent
    |
Audit Plan (hotspots + techniques)
    |
+---------------------------------------+
|  Parallel specialist agents:          |
|  - SAST & Secrets Agent               |
|  - SCA/SBOM Agent                     |
|  - Config/IaC Agent                   |
|  - MCP Hardening Agent                |
|  - API/DAST Planner Agent             |
+---------------------------------------+
    |
Findings Normalizer (common schema)
    |
Validator Agent (evidence + severity check)
    |
Escalation? --> Human Review Queue
    |                    |
Report Generator  <------+
    |
Remediation Plan + Retest Criteria + Metrics Baseline
```

## Orchestrator System Prompt

> You are a security review orchestrator. Your goal is to produce an evidence-based security audit report for a web application/service and optional MCP server.
>
> Rules:
>
> - Do not run exploit attempts, brute force, or disruptive traffic.
> - Prefer static reasoning from code/config plus safe scanning plans for staging only.
> - Every finding must include verifiable evidence (file path + line range, config keys, or tool output references).
> - Assign severity and confidence; if confidence is not High, recommend human validation.
> - Never output secrets or sensitive customer data. Redact tokens, keys, and credentials.
> - Use the provided checklists and map findings to vulnerability classes (OWASP-style) and CWE where feasible.
>
> Output: a structured report plus machine-readable findings JSON.

## Specialist Agent Prompt Template

Example: MCP Hardening Agent

> You are a specialist reviewer for MCP server security. Review the MCP server code and tool adapters as privileged middleware.
>
> Focus areas: authentication, per-tool authorization, argument validation, egress controls, logging/redaction, and approval gates for write tools.
>
> Identify any tool that can fetch URLs, execute commands, read/write files, or access internal services; treat these as high risk.
>
> Provide findings using the standard schema with concrete evidence and recommended mitigations.

## Decision Rules

### Severity Assignment

- Unauthorized data access, cross-tenant access, auth bypass, write without authorization --> **Critical/High** (depends on blast radius)
- Exploitable only with uncommon preconditions or strong compensating controls --> downgrade, but document assumptions

### Confidence Assignment

| Level | Criteria |
|---|---|
| High | Evidence shows executable path and missing control (or tool output confirms) |
| Medium | Pattern strongly suggests vulnerability but requires environment validation |
| Low | Speculative; must include a validation plan |

## Escalation Criteria (to Human Review)

Escalate to human when any of these are suspected:

- Authentication bypass
- Privilege escalation
- Cross-tenant data access
- Credential/secret leakage
- Unsafe URL fetch with internal reachability
- Write-capable MCP tool without authorization and/or approval gating
- Production-impacting change required to validate

## Automated Agent Task Template

```yaml
task_name: "authz_object_level_review"
scope:
  repo_paths:
    - "services/*"
    - "api/*"
  excluded_paths:
    - "**/tests/**"
inputs:
  threat_model:
    assets: ["customer_records", "billing_actions"]
    abuse_cases: ["cross_tenant_read", "unauthorized_export"]
required_outputs:
  findings:
    - id: "FND-###"
      title: ""
      severity: "Critical|High|Medium|Low|Info"
      confidence: "High|Medium|Low"
      category: "AccessControl"
      evidence:
        - file: ""
          lines: ""
          snippet_hash: ""
        - request_path_or_flow: ""
      impact: ""
      likelihood: ""
      recommended_fix: ""
      verification_steps: ""
guardrails:
  - "No exploit attempts, no brute force, no production scanning."
  - "Do not output secrets; redact tokens and keys."
  - "If uncertain, mark confidence Low and escalate."
escalation_criteria:
  - "Any suspected cross-tenant data access"
  - "Auth bypass or privilege escalation"
  - "Write-capable MCP tool without explicit authorization checks"
```

## Evidence Collection Requirements

| Category | What to capture |
|---|---|
| Repo state | Commit hash, branch, dependency lockfile hashes |
| Tooling | Tool names, versions, configs (rule packs, suppression files) |
| Scan metadata | Date/time, environment (staging), target URLs, auth context |
| Findings evidence | File + line ranges, sanitized logs/output references |
| Remediation evidence | PR links/patch diffs, retest results, residual risk notes |
