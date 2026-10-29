# Supply Chain Security

Securing the software supply chain through SLSA, Sigstore, SBOMs, provenance verification, and registry hardening.

## Threat Landscape

Software supply chain attacks exploit trust in dependencies to inject malicious code. Key attack vectors:

| Attack Vector | Description | Example |
|---|---|---|
| **Typosquatting** | Malicious package with similar name | `lodahs` vs `lodash` |
| **Dependency confusion** | Private package name claimed on public registry | Internal `@company/utils` published by attacker to npmjs |
| **Account takeover** | Compromised maintainer credentials | Event-stream incident (2018) |
| **Malicious update** | Legitimate package ships malicious new version | ua-parser-js hijack (2021) |
| **Build system compromise** | CI/CD pipeline tampered to inject code | SolarWinds (2020) |
| **Slopsquatting** | AI hallucinates a package name; attacker registers it | AI suggests `flask-caching-utils` (does not exist) |
| **Protestware** | Maintainer adds intentionally destructive code | node-ipc (2022) |

## SLSA Framework (Supply-chain Levels for Software Artifacts)

SLSA (pronounced "salsa") provides a security framework with progressive levels of supply chain integrity.

### SLSA Levels

| Level | Requirements | Protection |
|---|---|---|
| **SLSA 0** | No guarantees | None |
| **SLSA 1** | Provenance exists (documents how artifact was built) | Mistakes, tampering after build |
| **SLSA 2** | Hosted build platform, authenticated provenance | Tampering during build |
| **SLSA 3** | Hardened build platform, unforgeable provenance | Sophisticated tampering |

### Key Concepts

- **Provenance**: Metadata describing how an artifact was built (source, builder, build process, dependencies)
- **Attestation**: Signed statement about a software artifact (uses in-toto format)
- **Builder**: The service or system that builds the artifact (e.g., GitHub Actions, Cloud Build)

### Achieving SLSA Levels

**SLSA 1 (achievable in days):**

```yaml
# GitHub Actions: generate SLSA provenance
- uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.0.0
  with:
    base64-subjects: "${{ needs.build.outputs.digests }}"
```

**SLSA 2 (achievable in weeks):**

- Use a hosted CI/CD system (GitHub Actions, Cloud Build, etc.)
- Generate authenticated provenance using platform-native features
- Store provenance alongside artifacts

**SLSA 3 (ongoing effort):**

- Isolated, ephemeral build environments
- Two-person review for build configuration changes
- Hermetic builds (no network access during build)

## Sigstore

Sigstore provides keyless code signing and verification for software artifacts.

### Components

| Component | Purpose |
|---|---|
| **Cosign** | Sign and verify container images and artifacts |
| **Fulcio** | Issues short-lived signing certificates tied to OIDC identity |
| **Rekor** | Public transparency log for signatures (tamper-evident) |

### Using Cosign

```bash
# Sign a container image (keyless, uses OIDC identity)
cosign sign ghcr.io/org/image:tag

# Verify a signed image
cosign verify ghcr.io/org/image:tag \
  --certificate-identity=user@org.com \
  --certificate-oidc-issuer=https://accounts.google.com

# Sign a blob (file, SBOM, etc.)
cosign sign-blob --output-signature sig.json artifact.tar.gz

# Verify npm package provenance (npm v9.5+)
npm audit signatures
```

### npm Provenance (built-in)

npm supports native provenance starting with v9.5:

```bash
# Publish with provenance (from GitHub Actions)
npm publish --provenance

# Verify package provenance
npm audit signatures

# Check a specific package
npm view <package> --json | jq '.dist.attestations'
```

## Software Bill of Materials (SBOM)

An SBOM is a nested inventory of all components in a software artifact.

### SBOM Formats

| Format | Maintained By | Use Case |
|---|---|---|
| **SPDX** (v3.0) | Linux Foundation | License compliance + security |
| **CycloneDX** (v1.6) | OWASP | Security-focused, lightweight |

### Generating SBOMs

```bash
# Using Syft (supports many ecosystems)
syft dir:. -o spdx-json > sbom.spdx.json
syft dir:. -o cyclonedx-json > sbom.cdx.json

# Using CycloneDX CLI
cyclonedx-npm --output-file sbom.cdx.json
cyclonedx-py poetry --output sbom.cdx.json

# npm (built-in, basic)
npm sbom --sbom-format cyclonedx

# Docker / container images
syft ghcr.io/org/image:tag -o spdx-json > sbom.spdx.json
```

### SBOM in CI/CD

```yaml
# GitHub Actions: generate and attach SBOM to release
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    format: spdx-json
    output-file: sbom.spdx.json

- name: Upload SBOM as release artifact
  uses: softprops/action-gh-release@v2
  with:
    files: sbom.spdx.json
```

### SBOM Requirements

As of 2025, SBOMs are required or recommended by:

- **US Executive Order 14028**: Federal software suppliers must provide SBOMs
- **EU Cyber Resilience Act**: Products with digital elements must include SBOMs
- **CISA 2025 Minimum Elements**: Nine data fields per component (supplier, name, version, identifiers, dependency relationships, author, timestamp, hash, component type)
- **FedRAMP**: SBOMs required for cloud service offerings to government

## Registry Hardening

### npm

```ini
# .npmrc -- restrict to trusted registries
registry=https://registry.npmjs.org/
@yourorg:registry=https://npm.pkg.github.com/

# Enforce integrity checks
package-lock=true

# Prevent install scripts from running (security-sensitive projects)
ignore-scripts=true
```

### Preventing Dependency Confusion

1. **Scope all private packages**: Use `@yourorg/package-name` to prevent public registry claims
2. **Configure registry per scope**: Map private scopes to private registries
3. **Reserve names on public registry**: Publish placeholder packages for internal names
4. **Use `.npmrc` or `pip.conf`** to restrict resolution order

```ini
# .npmrc -- scope mapping
@yourorg:registry=https://npm.yourorg.com/
# All other packages come from public npm
registry=https://registry.npmjs.org/
```

```ini
# pip.conf -- restrict to private index
[global]
index-url = https://pypi.yourorg.com/simple/
extra-index-url = https://pypi.org/simple/
```

### GitHub Actions Security

Pin actions to commit SHAs, not tags (tags can be reassigned):

```yaml
# Bad: tag can be moved to malicious commit
- uses: actions/checkout@v4

# Good: pinned to specific commit SHA
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
```

Renovate can manage these pins automatically with `"pinDigests": true`.

## Incident Response Checklist

When a supply chain compromise is suspected:

1. **Identify affected packages** -- Check lockfile for the compromised version
2. **Pin to last known good version** -- Immediately update lockfile
3. **Audit install scripts** -- Check `preinstall`, `postinstall`, `prepare` scripts
4. **Check for data exfiltration** -- Review network logs from CI/CD and development machines
5. **Rotate credentials** -- Any secrets accessible during `npm install` / `pip install`
6. **Generate SBOM** -- Document exactly what was in the compromised build
7. **Notify stakeholders** -- Security team, affected users, upstream maintainers
8. **Report to registry** -- `npm unpublish` request, PyPI report, crates.io yank
9. **Post-incident review** -- Document lessons learned, update prevention controls
