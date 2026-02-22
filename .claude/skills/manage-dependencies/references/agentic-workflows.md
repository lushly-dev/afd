# Agentic Workflows for Dependency Management

Guidelines for AI agents performing dependency evaluation, installation, upgrades, and security operations.

## Core Safety Rules

AI agents operating on dependencies must follow these rules without exception:

### 1. Never Install Unverified Packages

Before running any install command, verify the package exists on the target registry:

```bash
# npm: verify package exists and is not suspicious
npm view <package-name> name version description maintainers time.created time.modified --json

# pip: verify on PyPI
pip index versions <package-name>

# cargo: verify on crates.io
cargo search <package-name>
```

**Why:** AI models can hallucinate package names (slopsquatting). An attacker may register the hallucinated name with malicious code. Always verify before installing.

### 2. Never Run Arbitrary Install Scripts Without Review

Check for install scripts before installing unfamiliar packages:

```bash
# npm: check for install scripts
npm view <package-name> scripts --json | grep -E '"(pre|post)?install"'

# If install scripts exist, review them before proceeding
npm pack <package-name> && tar -tf <package-name>-*.tgz | grep -i install
```

### 3. Always Use Lockfiles

Never modify dependencies without updating the lockfile:

```bash
# npm: use npm install (updates lockfile) not manual edits to package.json
npm install <package-name>
# NOT: manually editing package.json then running npm install

# pip: use pip-compile to regenerate lockfile
pip-compile requirements.in

# cargo: lockfile updates automatically
cargo add <package-name>
```

### 4. Always Run Tests After Changes

After any dependency modification, run the project's test suite:

```bash
# Check for test commands in package.json / Makefile / pyproject.toml
npm test
pytest
cargo test
go test ./...
```

### 5. Never Auto-Approve Major Version Upgrades

Major version upgrades require human review. The agent should:
1. Identify the upgrade as major
2. List breaking changes from the changelog
3. Estimate impact on the codebase
4. Present the information for human decision

## Agent Workflow: Adding a Dependency

### Step 1: Validate the Request

```
User asks: "Add package X for Y functionality"

Agent checklist:
- [ ] Does the project already have a dependency that provides this functionality?
- [ ] Is the standard library sufficient?
- [ ] Is the package name spelled correctly?
- [ ] Does the package actually exist on the registry?
```

### Step 2: Evaluate the Package

Run the Package Health Assessment (see `references/package-evaluation.md`):

```bash
# Quick health check sequence
npm view <package> name version license maintainers time.modified --json
# Check downloads: https://api.npmjs.org/downloads/point/last-month/<package>
# Check OpenSSF: scorecard --repo=github.com/<owner>/<repo>
# Check vulnerabilities: npm audit
```

Report findings to the user before proceeding:

```
Package: <name> v<version>
License: MIT
Weekly downloads: 500K
Last updated: 2 weeks ago
Maintainers: 3
Transitive dependencies: 7
Known vulnerabilities: 0
OpenSSF Scorecard: 7.2/10

Recommendation: ADOPT -- package meets all health criteria.
Proceed with installation? [waiting for confirmation]
```

### Step 3: Install

```bash
# Install with exact version
npm install <package>@<version> --save-exact

# Or with semver range
npm install <package>

# Verify lockfile was updated
git diff --stat  # Should show lockfile changes
```

### Step 4: Validate

```bash
# Run tests
npm test

# Run build
npm run build

# Check for new vulnerabilities
npm audit

# Check bundle impact (frontend)
npx pkg-size
```

### Step 5: Report

```
Dependency added: <package>@<version>
Files modified: package.json, package-lock.json
Test suite: PASS (42 tests)
Build: SUCCESS
New vulnerabilities: 0
Bundle size impact: +12KB gzipped
```

## Agent Workflow: Upgrading Dependencies

### Routine Updates (Patch/Minor)

```
1. Check for outdated dependencies:
   npm outdated

2. For each update:
   a. Check if it's patch or minor (safe for auto-update)
   b. Read changelog for unexpected changes
   c. Update: npm update <package>
   d. Run tests
   e. Report results

3. Present summary:
   Updated 5 packages (3 patch, 2 minor)
   All tests pass. No new vulnerabilities.
```

### Major Updates (Requires Human Approval)

```
1. Identify major update available:
   <package> 2.3.1 -> 3.0.0

2. Research breaking changes:
   a. Read CHANGELOG.md / migration guide
   b. List breaking changes relevant to this codebase
   c. Estimate files affected

3. Present to human:
   Major upgrade available: <package> v2 -> v3
   Breaking changes:
   - API X renamed to Y (affects 3 files)
   - Config option Z removed (affects 1 file)
   Estimated effort: ~30 minutes

   Shall I proceed? [waiting for confirmation]

4. If approved:
   a. Create a dedicated branch
   b. Apply upgrade and code changes
   c. Run tests and fix failures
   d. Present PR for review
```

## Agent Safety Boundaries

### Actions Agents MAY Take Autonomously

- Query registry for package information
- Run `npm outdated`, `npm audit`, `pip-audit`, `cargo audit`
- Apply patch updates when CI passes and package is well-known
- Run tests and report results
- Generate SBOMs
- Read changelogs and migration guides

### Actions Agents MUST Confirm With Human

- Installing a new dependency (first time in project)
- Major version upgrades
- Removing a dependency
- Modifying `.npmrc`, `pip.conf`, or registry configuration
- Vendoring or forking a dependency
- Adding dependencies with install scripts
- Adding dependencies with fewer than 10K weekly downloads
- Any action when the package name was AI-generated (not from user input)

### Actions Agents MUST NEVER Take

- Install a package that does not exist on the registry
- Override or bypass security audit failures
- Modify lockfiles manually (always use package manager commands)
- Push dependency changes directly to main/production branch
- Disable security features (ignore-scripts, require-hashes)
- Auto-merge dependency updates without CI validation

## Slopsquatting Prevention

AI-generated package names are a specific supply chain risk. When an agent suggests a package:

1. **Verify existence**: Query the registry API before any install command
2. **Check age**: Be suspicious of packages created very recently (< 30 days)
3. **Check downloads**: Very low downloads (< 100/week) on a supposedly popular package is a red flag
4. **Cross-reference**: Verify the package is referenced in official documentation, Stack Overflow, or reputable sources
5. **Check publisher**: Verify the npm/PyPI publisher matches the expected maintainer

```bash
# npm: quick verification
npm view <package-name> 2>/dev/null
if [ $? -ne 0 ]; then
  echo "WARNING: Package does not exist on npm registry!"
fi

# Check creation date and download count
npm view <package-name> time.created --json
```

## Error Handling

### When Package Installation Fails

1. Check if the package name is spelled correctly
2. Check if the package exists on the registry
3. Check if the version constraint is satisfiable
4. Check for peer dependency conflicts: `npm ls` or `npm explain <package>`
5. Report the error to the user with suggested fixes

### When Security Audit Fails

1. Report the vulnerabilities found
2. Check if updated versions fix the vulnerabilities
3. If no fix available, check for alternative packages
4. If the vulnerability is in a transitive dependency, check if the direct dependency has a fix
5. Escalate to human if no automated resolution is possible

### When Tests Fail After Dependency Change

1. Identify which tests failed and why
2. Check if the failure is related to the dependency change
3. If it is a breaking change, revert and report
4. If it is a test that needs updating, present the situation to the human
5. Never silently skip or disable failing tests
