# Risk Prioritization

How to combine CVSS-style technical severity with contextual risk for actionable prioritization.

## Severity Dimensions

### 1. Technical Severity (CVSS Baseline)

Use CVSS v3.1/v4.0 as the standardized baseline for exploitability and impact. Covers:

- Attack vector (network, adjacent, local, physical)
- Attack complexity (low, high)
- Privileges required (none, low, high)
- User interaction (none, required)
- Impact to confidentiality, integrity, availability

### 2. Contextual Risk

Adjust based on deployment context:

| Factor | Higher risk | Lower risk |
|---|---|---|
| Exposure | Internet-facing | Internal-only, VPN-gated |
| Privilege required | None (unauthenticated) | Admin-only |
| Compensating controls | None | WAF, egress restrictions, strong auth |
| Blast radius | Cross-tenant, all users | Single user, single session |
| Detectability | No logging/alerts | Strong monitoring in place |

### 3. Exploit Likelihood

| Signal | Weight |
|---|---|
| Known-exploited (CISA KEV catalog) | Highest -- treat as active threat |
| Public exploit available | High |
| Exploit prediction score (EPSS) > 10% | High |
| Trivially exploitable (simple injection, default creds) | High |
| Requires chained conditions | Medium |
| Only theoretical, no PoC | Lower |

### 4. Confidence Level

| Level | Criteria |
|---|---|
| High | Executable path demonstrated, missing control confirmed |
| Medium | Strong pattern match, needs environment validation |
| Low | Speculative; requires validation plan |

## Priority Rubric

| Priority | Criteria | Remediation SLA |
|---|---|---|
| P0 (Emergency) | Remote auth bypass, RCE, credential leakage, signing key exposure, cross-tenant data access, write operations without authorization -- especially if internet-reachable | 24-72 hours |
| P1 (High) | Injection in reachable paths, SSRF with internal reachability, stored XSS in shared surfaces, IDOR, missing rate limits on sensitive workflows, dangerous deserialization | 7-14 days |
| P2 (Medium) | Reflected XSS with mitigations, misconfigs reducing defense-in-depth, weak crypto not directly exploitable, verbose errors | 30-60 days |
| P3 (Low) | Best-practice gaps, hardening recommendations, informational | Next cycle / backlog |

## MCP Severity Multiplier

For MCP servers, apply a **severity multiplier** when:

| Condition | Multiplier effect |
|---|---|
| Tool has write access (deploy, code changes, financial) | Upgrade one level |
| Tool accesses PII or sensitive data at scale | Upgrade one level |
| Missing per-tool authorization | Treat as P0/P1 regardless of CVSS |
| Missing approval gate on destructive actions | Treat as P1 minimum |

**Rationale:** Prompt/tool injection against write-capable MCP tools can cause operational damage (deployments, data changes, exfiltration) without classic memory-corruption primitives.

## Practical Triage Workflow

1. **Score with CVSS** as starting point
2. **Adjust for context** -- exposure, compensating controls, asset criticality
3. **Check exploit signals** -- CISA KEV, EPSS, public PoCs
4. **Assign priority** using the rubric above
5. **Set SLA** based on priority
6. **Document rationale** -- especially for downgrades

### Downgrade Justification Template

```markdown
## Severity Adjustment: [Finding ID]

- **Original CVSS:** [Score]
- **Adjusted priority:** [P2 instead of P1]
- **Justification:** [Compensating controls, limited exposure, etc.]
- **Compensating controls:** [Specific controls in place]
- **Re-evaluation trigger:** [When to reassess -- e.g., if exposure changes]
- **Approved by:** [Name/role]
```

## Reference Sources

- FIRST CVSS: https://www.first.org/cvss/
- CISA Known Exploited Vulnerabilities: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- EPSS (Exploit Prediction Scoring): https://www.first.org/epss/
- OWASP Risk Rating Methodology: https://owasp.org/www-community/OWASP_Risk_Rating_Methodology

## Common Prioritization Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Using CVSS alone | Ignores deployment context | Always apply contextual adjustment |
| Treating all Highs equally | Not all Highs are urgent | Differentiate by exposure and exploit likelihood |
| Ignoring known-exploited status | Active threats need immediate action | Check CISA KEV for every Critical/High |
| No SLA enforcement | Findings age indefinitely | Set and enforce SLAs with escalation |
| Accepting risk without documentation | Untracked residual risk | Require formal justification and review dates |
