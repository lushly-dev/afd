# Tooling and CI/CD Security Integration

How to select, configure, and integrate security analysis tools into development pipelines.

## Analysis Technique Comparison

| Technique | Analyzes | Strengths | Limits | Pipeline placement |
|---|---|---|---|---|
| SAST | Source code / AST / dataflow | Finds injection/authz patterns early | False positives; misses runtime config | PR checks + nightly deep scans |
| DAST | Running app via HTTP/API | Runtime issues: auth, headers, misconfig | Needs deployed env; may miss deep paths | Scheduled against staging; pre-release |
| IAST | Instrumented runtime + tests | High signal; ties findings to code paths | Requires instrumentation; depends on test coverage | CI integration tests; staging |
| SCA | Dependencies and containers | Fast; identifies known vulnerable libs | Doesn't find custom logic flaws | Every build/PR; release gates |
| Secrets scanning | Code + commits + artifacts | Prevents credential leaks; high ROI | False positives; needs good allowlists | Pre-commit + PR + continuous |
| IaC scanning | Terraform/K8s/Bicep | Prevents insecure deployments | Needs org-specific policies | PR checks; release gates |
| Fuzzing | APIs/parsers | Finds edge-case crashes and validation flaws | Requires harnessing; time-intensive | Targeted routines, continuous for parsers |
| Manual review | Code + architecture | Finds logic flaws, authz, misuse patterns | Time-intensive; requires expertise | Threat-model-driven hotspots |

## Tooling Landscape

| Category | Open-source | Commercial | Selection criteria |
|---|---|---|---|
| SAST | Semgrep, CodeQL | Checkmarx, Veracode, Fortify | Rule quality, customization, CI integration, language coverage |
| DAST | OWASP ZAP | Burp Suite | Auth scripting, scan safety, API support |
| SCA/SBOM | OWASP Dependency-Check, Trivy | Snyk, Mend | Vuln DB quality, reachability analysis, SBOM support |
| Secrets scanning | Gitleaks, TruffleHog | GitHub Advanced Security, platform scanners | Pre-commit support, entropy rules, allowlists |
| Container scanning | Trivy, Grype | Various | Base image coverage, OS/package detection, speed |
| IaC scanning | Checkov, tfsec | Various | Policy-as-code support, org baseline alignment |

### Selection Best Practices

- Prefer tools with **baseline management** (suppressions with justification) and **incremental scanning** (diff-aware PR checks)
- Require **exportable evidence** (SARIF, JSON, signed reports) for archival and correlation
- Validate CI integration and issue tracker connectivity for frictionless remediation

## CI/CD Security Architecture

### Layered Pipeline Model

#### On Every Change (Fast Gates)

- Secrets scanning (block on detection)
- SCA with known-exploited vulnerability check
- Lightweight SAST with high-confidence rules
- Linting for security-sensitive patterns (unsafe eval, missing authz decorators)

#### Nightly or Scheduled (Deep Scans)

- Full SAST with complete rule packs
- DAST against staging environment
- IAST during integration test runs
- Fuzzing for critical parsers/endpoints
- Container and IaC scans

#### Pre-Release (Risk Gates)

- SBOM generation and signing
- Final dependency vulnerability check
- Full DAST on release candidate environment
- Evidence bundle generation (tool outputs, configs, commit hashes)

#### Post-Deploy (Monitoring)

- WAF and log alerts for anomalous patterns
- Dependency drift detection
- Periodic re-scans
- Runtime anomaly detection

### Policy Thresholds

| Gate | Policy |
|---|---|
| PR merge | No new Critical/High SAST findings; no detected secrets |
| Release | No known-exploited vulnerabilities in dependencies; SBOM generated |
| Deploy | DAST clean on Critical; no unresolved P0/P1 from manual review |

### Operational Practices

- Maintain a **human triage loop** with clear SLAs
- Suppressions require written justification and periodic review
- Track false positive rates per tool/rule to tune over time
- Generate SBOM on every release build (CycloneDX or SPDX format)

## SARIF Integration

Use SARIF (Static Analysis Results Interchange Format) as the standard output format:

- Most SAST/SCA tools support SARIF export
- GitHub, Azure DevOps, and VS Code consume SARIF natively
- Enables tool-agnostic findings aggregation and trending
