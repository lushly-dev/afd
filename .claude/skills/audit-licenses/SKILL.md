---
name: audit-licenses
source: botcore
description: >
  Performs OSS license compliance audits, dependency license analysis, and SBOM generation. Covers license categorization (permissive, copyleft, public domain), compatibility matrices, per-ecosystem audit tooling (Node.js, Python, Go), CI/CD license gate integration, required attribution files, and red-flag detection. Use when adding dependencies, auditing existing licenses, checking compatibility, generating SBOMs, preparing for release, or setting up license enforcement in CI. Triggers: license, licensing, OSS compliance, SBOM, GPL, MIT, Apache, copyleft, dependency audit, license check, attribution, SPDX, CycloneDX, bill of materials.

version: 1.0.0
triggers:
  - license
  - licensing
  - OSS compliance
  - SBOM
  - GPL
  - MIT
  - Apache
  - copyleft
  - dependency audit
  - license check
  - attribution
  - SPDX
  - CycloneDX
  - bill of materials
  - permissive license
  - license compatibility
portable: true
---

# License Auditing

Expert guidance for open-source license compliance, dependency auditing, and software bill of materials generation.

## Capabilities

1. **Categorize licenses** -- Classify dependencies as permissive, weak copyleft, strong copyleft, or public domain and assess commercial-use risk
2. **Audit dependency licenses** -- Run per-ecosystem audit commands (Node.js, Python, Go) to enumerate and validate licenses across a project
3. **Evaluate compatibility** -- Determine whether combining libraries under different licenses is legally safe for the target project license
4. **Generate SBOMs** -- Produce CycloneDX, SPDX, or Syft-based Software Bills of Materials for release artifacts
5. **Enforce in CI/CD** -- Set up automated license-check and SBOM-generation gates in GitHub Actions or other pipelines
6. **Detect red flags** -- Identify GPL in proprietary code, missing license files, UNLICENSED packages, and license mismatches
7. **Manage attribution files** -- Ensure LICENSE, NOTICE, and THIRD-PARTY-LICENSES files are correct and complete

## Core Principles

### 1. Know Before You Add

Every new dependency must have its license identified and categorized before merging. Unknown or missing licenses are blockers, not warnings.

### 2. Compatibility Over Convenience

A useful library under an incompatible license is not usable. Always check the compatibility matrix against your project's license before adoption.

### 3. Automate Enforcement

Manual license checks do not scale. Integrate license-checker or equivalent tools into CI so violations are caught on every pull request.

### 4. SBOM as Release Artifact

Every release should include a machine-readable SBOM (CycloneDX or SPDX). Treat it as a required build output, not optional documentation.

### 5. Attribution Is Non-Negotiable

Permissive licenses still require attribution. Maintain NOTICE and THIRD-PARTY-LICENSES files and keep them current with every dependency change.

## Quick Reference

### License Categories

| Category | Examples | Commercial Use |
|----------|----------|----------------|
| **Permissive** | MIT, Apache-2.0, BSD-2, BSD-3, ISC | Safe |
| **Weak Copyleft** | LGPL-2.1, LGPL-3.0, MPL-2.0 | Safe if dynamically linked; modifications to the library must be shared |
| **Strong Copyleft** | GPL-2.0, GPL-3.0, AGPL-3.0 | Derivative work must use the same license |
| **Public Domain** | Unlicense, CC0-1.0, 0BSD | Safe |
| **No License / UNLICENSED** | -- | Cannot use; all rights reserved by default |

### Common Licenses at a Glance

| License | Key Requirements | Compatibility Notes |
|---------|-----------------|---------------------|
| **MIT** | Include copyright + license text | Most permissive; compatible with nearly everything |
| **Apache-2.0** | Attribution + patent grant + NOTICE file | Permissive; incompatible with GPL-2.0 (compatible with GPL-3.0) |
| **BSD-3-Clause** | Attribution; no endorsement clause | Permissive; broadly compatible |
| **LGPL-2.1/3.0** | Dynamic linking OK; share modifications to library | Safe for proprietary apps if linked dynamically |
| **MPL-2.0** | File-level copyleft; modified files must be shared | Compatible with Apache-2.0 and GPL |
| **GPL-2.0/3.0** | All derivative work must be GPL | Viral; output project becomes GPL |
| **AGPL-3.0** | GPL + network interaction triggers distribution | Very viral; SaaS use triggers copyleft |

### Compatibility Matrix

| Your Project License | Can Safely Use |
|---------------------|---------------|
| MIT | MIT, BSD, ISC, Apache-2.0, Public Domain |
| Apache-2.0 | MIT, BSD, ISC, Apache-2.0, Public Domain |
| GPL-3.0 | Anything (but output is GPL-3.0) |
| Proprietary | MIT, BSD, ISC, Apache-2.0, LGPL (dynamic link), MPL (file-level), Public Domain |

## Workflow

### License Audit Protocol

#### 1. Enumerate Dependencies

Run ecosystem-specific commands to list all dependency licenses.

```bash
# Node.js
npx license-checker --summary
npx license-checker --csv --out licenses.csv

# Python
pip-licenses --format=markdown
pip-licenses --format=json --output-file licenses.json

# Go
go-licenses report ./...
go-licenses csv ./...
```

#### 2. Validate Against Allowlist

Fail the check if any dependency uses a license outside the approved list.

```bash
# Node.js -- fail on anything not in allowlist
npx license-checker --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;Unlicense;CC0-1.0"

# Python -- fail on copyleft
pip-licenses --fail-on="GPL-2.0-only;GPL-3.0-only;AGPL-3.0-only"
```

#### 3. Check for Red Flags

| Issue | Risk Level | Action |
|-------|-----------|--------|
| GPL/AGPL in proprietary app | Critical | Remove dependency or replace with permissive alternative |
| AGPL in SaaS backend | Critical | Remove dependency or open-source the service |
| No license file in dependency | High | Contact author or find alternative; cannot assume permissive |
| `UNLICENSED` in package.json | High | Cannot use; all rights reserved |
| License field mismatch (package.json vs LICENSE file) | Medium | Verify actual license at source repository |
| Transitive dependency with copyleft | Medium | Audit full dependency tree, not just direct deps |

#### 4. Generate SBOM

```bash
# CycloneDX -- Node.js
npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json

# CycloneDX -- Python
cyclonedx-py environment --output sbom.cdx.json

# SPDX -- universal via Syft
syft . -o spdx-json > sbom.spdx.json

# CycloneDX -- universal via Syft
syft . -o cyclonedx-json > sbom.cdx.json
```

#### 5. Verify Attribution Files

Ensure the following files exist and are up to date.

| File | Purpose | When Required |
|------|---------|---------------|
| `LICENSE` | Your project's license | Always |
| `NOTICE` | Third-party attributions | Required by Apache-2.0; recommended for all |
| `THIRD-PARTY-LICENSES` | Full license texts of dependencies | Recommended for distribution |

#### 6. Integrate into CI/CD

```yaml
# GitHub Actions example
name: License Compliance
on: [pull_request]

jobs:
  license-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: npm ci

      - name: License allowlist check
        run: npx license-checker --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;Unlicense;CC0-1.0"

      - name: Generate SBOM
        run: npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json

      - name: Upload SBOM
        uses: actions/upload-artifact@v4
        with:
          name: sbom
          path: sbom.cdx.json
```

## Checklist

- [ ] All direct and transitive dependencies have identified licenses
- [ ] No GPL/AGPL dependencies in proprietary or closed-source code
- [ ] No dependencies with missing or `UNLICENSED` license designation
- [ ] License compatibility verified against project license
- [ ] `LICENSE` file present in repository root
- [ ] `NOTICE` file present if using Apache-licensed dependencies
- [ ] `THIRD-PARTY-LICENSES` file generated and current
- [ ] SBOM generated for every release
- [ ] License allowlist check integrated into CI pipeline
- [ ] SBOM generation integrated into CI pipeline
- [ ] Transitive dependencies audited (not just direct deps)

## When to Escalate

Escalate to legal or human review when any of these apply:

- A critical dependency uses GPL/AGPL and no permissive alternative exists
- A dependency has no license file and the author is unresponsive
- License text is custom, modified, or ambiguous (not a standard SPDX identifier)
- Dual-licensed dependency requires choosing between commercial and open-source terms
- Government, healthcare, or regulated-industry compliance requirements apply
- Conflicting license obligations exist in the dependency tree (e.g., GPL-2.0-only vs Apache-2.0)
- Preparing for acquisition, IPO, or other due-diligence event requiring license audit sign-off
