# Reporting and Metrics

Standard reporting formats, findings schemas, and metrics for measuring audit effectiveness.

## Finding Record Schema

Every finding should conform to this portable schema:

| Field | Description | Required |
|---|---|---|
| ID | Unique identifier (e.g., FND-001) | Yes |
| Title | Concise vulnerability description | Yes |
| Severity | CVSS base + contextual priority (Critical/High/Medium/Low/Info) | Yes |
| Confidence | High / Medium / Low | Yes |
| Category | Vulnerability class (e.g., AccessControl, Injection, XSS) | Yes |
| CWE | CWE identifier(s) where applicable | Recommended |
| Affected component(s) | Service, module, endpoint | Yes |
| Description and impact | What's wrong and what could happen | Yes |
| Evidence | File/line, configs, tool output references | Yes |
| Risk rationale | Exposure, exploitability, business impact | Yes |
| Recommended fix | Code, config, test changes | Yes |
| Verification steps | How to confirm the fix works | Yes |
| Owner | Person/team responsible | Yes |
| SLA | Deadline based on severity | Yes |
| Status | Open / In progress / Fixed / Accepted risk | Yes |

## Executive Report Outline

Short, high-signal format for leadership:

```markdown
## Security Audit Executive Summary

### System Overview

[System name, business context, scope]

### Top Risks (3-7 Items)

1. [Risk title] -- [Business impact] -- [Remediation theme]
2. ...

### Risk Posture Summary

| Severity | Count | Known-exploited | Trend |
|---|---|---|---|

### Required Decisions

- [Deploy gate decisions]
- [Tool authorization changes]
- [Resourcing needs]
```

## Technical Report Outline

Detailed format for engineering teams:

```markdown
## Security Audit Technical Report

### Scope and Exclusions

[Components reviewed, out-of-scope items, commit hash, date range]

### Threat Model Summary

[Assets, trust boundaries, key abuse cases]

### Tooling and Methods

[Tools used, configs, versions, environments]

### Findings

[Full findings table using the schema above]

### Root Cause Themes

[Systemic patterns: e.g., "missing authz middleware," "no egress controls"]

### Systemic Recommendations

[Guardrails, libraries, pipeline gates to adopt]

### Remediation Plan

| Finding | Owner | SLA | Retest Criteria |
|---|---|---|---|

### Appendix

- Evidence bundle index
- Scan outputs and configs
- Suppression justifications
```

## Audit Health Metrics

### Coverage and Hygiene

| Metric | Target |
|---|---|
| % repos with SAST/SCA/secrets scanning | 100% |
| SBOM generation coverage | 100% of release builds |
| Mean time to triage (MTTT) | < 2 business days |
| Mean time to remediate (MTTR) Critical | < 72 hours |
| MTTR High | < 14 days |
| Vulnerability aging (Critical/High > 30d) | 0 |
| Secrets detected per month | Trend down |
| Time-to-revoke for detected secrets | < 4 hours |

### Quality Metrics

| Metric | What it measures |
|---|---|
| False positive rate per tool/rule | Noise level; tune rules when high |
| Reopened findings rate | Fix quality; fixes that regress |
| Repeat class rate | Root cause recurrence; indicates systemic gaps |

### Agentic Workflow Metrics

| Metric | What it measures | Watch for |
|---|---|---|
| Escalation rate to humans | Signal quality | Too low = missed risk; too high = noise |
| Agent-validator agreement rate | Finding accuracy | Low = agent rules need tuning |
| Evidence completeness score | % findings with all evidence fields | Should be > 95% |

## Findings Status Workflow

```
Open --> In progress --> Fixed --> Verified (retest pass)
                     \-> Accepted risk (with justification and review date)
```

Every "Accepted risk" must include:

- Written justification
- Compensating controls documented
- Review date (re-evaluate at next audit cycle)
- Approval from security lead or equivalent
