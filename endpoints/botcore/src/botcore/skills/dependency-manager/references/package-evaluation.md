# Package Evaluation

Comprehensive framework for assessing the health, security, and fitness of candidate dependencies before adoption.

## Package Health Assessment Framework

Before adding any dependency, evaluate it across these dimensions. Score each dimension and use the aggregate to make an informed decision.

### 1. Maintenance Activity

| Metric | How to Check | Healthy | Warning | Reject |
|---|---|---|---|---|
| Last commit date | GitHub/GitLab activity | < 3 months | 3-12 months | > 24 months with open bugs |
| Issue response time | Check recent issues | < 7 days median | 7-30 days | > 90 days or no response |
| PR merge cadence | Check merged PRs | Regular merges | Sporadic | Stale PRs accumulating |
| Release frequency | Release page / changelog | Quarterly or faster | 1-2x per year | None in 12+ months |
| CI status | Badges, recent runs | Passing | Flaky | Failing or absent |

**How to check:**

```bash
# GitHub: quick maintenance overview
gh repo view <owner>/<repo> --json pushedAt,updatedAt,openIssuesCount,stargazerCount

# npm: package metadata
npm view <package> time.modified maintainers dist-tags

# Check last 20 commits
gh api repos/<owner>/<repo>/commits --jq '.[0:20] | .[] | .commit.author.date + " " + .commit.message' 2>/dev/null | head -20
```

### 2. Security Posture

| Metric | How to Check | Healthy | Warning | Reject |
|---|---|---|---|---|
| Known CVEs | `npm audit`, Snyk, OSV | 0 high/critical | Patched within 30 days | Unpatched high/critical |
| OpenSSF Scorecard | scorecard.dev | Score 7+ | Score 4-6 | Score < 4 |
| Security policy | SECURITY.md in repo | Present with disclosure process | Present but outdated | Absent |
| Branch protection | OpenSSF check | Enabled | Partial | None |
| Signed releases | Release artifacts | Signed and verifiable | Unsigned but trusted | Unknown provenance |

**How to check:**

```bash
# OpenSSF Scorecard (install: go install github.com/ossf/scorecard/v5/cmd/scorecard@latest)
scorecard --repo=github.com/<owner>/<repo>

# Check for security policy
gh api repos/<owner>/<repo>/contents/SECURITY.md --jq '.name' 2>/dev/null

# npm audit for a specific package
npm audit --package-lock-only

# OSV database lookup
curl -s "https://api.osv.dev/v1/query" -d '{"package":{"name":"<pkg>","ecosystem":"npm"}}'
```

### 3. Community and Adoption

| Metric | How to Check | Healthy | Moderate | Risky |
|---|---|---|---|---|
| Weekly downloads | npm/PyPI stats | > 100K | 10K-100K | < 1K |
| GitHub stars | Repository page | > 1K | 100-1K | < 100 |
| Dependent repos | npm dependents, GitHub used-by | > 100 | 10-100 | < 10 |
| Bus factor | Contributors page | 3+ active | 2 active | 1 maintainer |
| Download trend | npm-stat.com, pypistats.org | Stable or growing | Flat | Declining |
| Corporate backing | README, sponsors | Company-backed | Community-backed | Solo hobby project |

### 4. Technical Fitness

| Metric | How to Check | Ideal | Acceptable | Concern |
|---|---|---|---|---|
| Transitive deps | `npm ls`, `cargo tree` | < 10 | 10-30 | > 50 |
| Bundle size (frontend) | bundlephobia.com, `pkg-size` | < 50KB gzipped | 50-200KB | > 200KB |
| TypeScript support | Package exports | Native TS or @types | DefinitelyTyped | No types |
| Tree-shaking | ESM exports | Full ESM | Partial | CJS only |
| Node/Python/Rust version | package.json engines | Supports current LTS | 1 version behind | Unsupported runtime |
| API stability | Changelog, semver | Follows semver strictly | Mostly follows semver | Frequent breaking changes |
| Test coverage | CI badges, repo | > 80% | 50-80% | < 50% or unknown |
| Documentation | README, docs site | Comprehensive | Basic README | Minimal or outdated |

### 5. License Compatibility

| License | Commercial Use | Copyleft Risk | Notes |
|---|---|---|---|
| MIT, ISC, BSD-2, BSD-3 | Yes | None | Maximally permissive |
| Apache-2.0 | Yes | None | Patent grant included |
| MPL-2.0 | Yes | File-level | Modified files must stay MPL |
| LGPL-2.1, LGPL-3.0 | Yes (with care) | Library-level | Dynamic linking generally safe |
| GPL-2.0, GPL-3.0 | Restricted | Strong | Entire work must be GPL |
| AGPL-3.0 | Restricted | Network-level | Server use triggers copyleft |
| SSPL, BSL, ELv2 | Restricted | Varies | Not OSI-approved; read terms carefully |
| Unlicensed / No License | No | Unknown | **Do not use** -- no rights granted |

**Always verify:**

```bash
# npm: check license
npm view <package> license

# Check full license text
gh api repos/<owner>/<repo>/license --jq '.license.spdx_id'

# Bulk license check (Node projects)
npx license-checker --summary
```

## Evaluation Scorecard Template

Use this template when evaluating a candidate package:

```markdown
## Package Evaluation: <package-name>

**Date:** YYYY-MM-DD
**Evaluator:** <name or agent>
**Purpose:** <why this package is being considered>

### Scores (1-5, where 5 = excellent)

| Dimension | Score | Notes |
|---|---|---|
| Maintenance Activity | /5 | |
| Security Posture | /5 | |
| Community & Adoption | /5 | |
| Technical Fitness | /5 | |
| License Compatibility | /5 | |
| **Overall** | **/25** | |

### Recommendation

- [ ] **Adopt** -- Score 20+, no red flags
- [ ] **Adopt with conditions** -- Score 15-19, address noted concerns
- [ ] **Defer** -- Score 10-14, significant concerns
- [ ] **Reject** -- Score < 10 or any critical blocker

### Alternatives Considered

| Package | Score | Why not chosen |
|---|---|---|
| | | |

### Conditions / Action Items

- [ ] <condition 1>
- [ ] <condition 2>
```

## Red Flags -- Immediate Disqualifiers

These findings should halt adoption regardless of other scores:

1. **No license** -- No rights are granted; using it is legally risky
2. **Unpatched critical CVE** -- Active vulnerability with no fix or workaround
3. **Typosquatting indicators** -- Package name suspiciously similar to a popular package, very recent publish date, low downloads
4. **Install scripts with network calls** -- `preinstall`/`postinstall` scripts that download or execute remote code
5. **Obfuscated source** -- Minified or encoded source in a package that should be readable
6. **Maintainer account compromise** -- Recent reports of account takeover
7. **Incompatible license** -- GPL/AGPL in a proprietary project without legal review

## Comparing Alternatives

When multiple packages solve the same problem, create a comparison matrix:

```markdown
| Criteria | Package A | Package B | Package C |
|---|---|---|---|
| Weekly downloads | | | |
| Last release | | | |
| Transitive deps | | | |
| Bundle size | | | |
| TypeScript support | | | |
| OpenSSF score | | | |
| License | | | |
| API ergonomics | | | |
| Migration effort | | | |
| **Winner** | | | |
```

Weight criteria based on project priorities:
- **Security-critical project:** Weight security posture and OpenSSF score heavily
- **Frontend project:** Weight bundle size, tree-shaking, and TypeScript support
- **Startup/MVP:** Weight API ergonomics and documentation
- **Enterprise:** Weight license compatibility, maintenance, and corporate backing
