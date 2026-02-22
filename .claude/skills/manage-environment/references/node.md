# Node.js Environment

Rules, patterns, and tooling for Node.js environment management in agentic development.

## Golden Rules

1. **Use a version manager** — Never install Node.js from nodejs.org installer directly
2. **Pin the Node version per project** — `.node-version` or `engines` field
3. **Pin the package manager** — `packageManager` field in `package.json`
4. **One lockfile per project** — Never mix `package-lock.json` + `pnpm-lock.yaml`
5. **Minimize global packages** — Almost nothing belongs in global scope

## Version Management

### Recommended: fnm (Fast Node Manager)

```bash
# Install
# Windows (winget)
winget install Schniz.fnm

# macOS (brew)
brew install fnm

# Configure shell
fnm env --use-on-cd | Out-String | Invoke-Expression  # PowerShell profile
eval "$(fnm env --use-on-cd)"                          # bash/zsh

# Use
fnm install 22          # Install Node 22 LTS
fnm use 22              # Switch to it
fnm default 22          # Set as default
fnm list                # List installed versions
```

### Pin Node Version

Create `.node-version` in project root:

```
22
```

This ensures fnm auto-switches when entering the directory (with `--use-on-cd`).

Also set `engines` in `package.json`:

```json
{
  "engines": {
    "node": ">=22"
  }
}
```

### Avoid

- **nodejs.org installer** — Installs to `C:\Program Files\nodejs\`, no version switching
- **Odd-numbered Node versions** (19, 21, 23) — Not LTS, shorter support
- **nvm-windows** — Requires admin, slower than fnm, less maintained
- **Multiple installers** — Pick one (fnm) and remove the rest

## Package Managers

### pnpm (Preferred for Monorepos)

```bash
# Install via corepack (ships with Node)
corepack enable
corepack prepare pnpm@latest --activate

# Or standalone
npm install -g pnpm
```

**Pin version** in `package.json`:

```json
{
  "packageManager": "pnpm@10.26.2"
}
```

With corepack enabled, running `pnpm` will auto-download the pinned version.

### Version Drift Detection

When `packageManager` differs across repos, agents see inconsistent behavior.
Check for drift:

```bash
# PowerShell — scan all repos
Get-ChildItem -Path D:\Github -Recurse -Filter package.json -Depth 2 |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  ForEach-Object {
    $pkg = Get-Content $_.FullName | ConvertFrom-Json
    if ($pkg.packageManager) {
      [PSCustomObject]@{ Path = $_.FullName; Manager = $pkg.packageManager }
    }
  }
```

### Lockfile Hygiene

Each project should have exactly ONE lockfile:

| Package Manager | Lockfile |
|----------------|----------|
| npm | `package-lock.json` |
| pnpm | `pnpm-lock.yaml` |
| yarn | `yarn.lock` |
| bun | `bun.lockb` |

**Stale lockfiles**: If you switch from npm to pnpm, delete `package-lock.json`.
Dual lockfiles confuse agents, CI, and other developers.

Find dual lockfiles:

```bash
# PowerShell
Get-ChildItem -Path . -Recurse -Depth 2 -Include "package-lock.json","pnpm-lock.yaml","yarn.lock" |
  Group-Object { Split-Path $_.FullName -Parent } |
  Where-Object { $_.Count -gt 1 } |
  ForEach-Object { $_.Name }
```

## npm Global Packages

### What Belongs Globally

Almost nothing. These are acceptable:

| Package | Reason |
|---------|--------|
| `pnpm` | Package manager (if not using corepack) |
| `fnm` | Node version manager (if not using winget/brew) |

### What Does NOT Belong Globally

| Package | Where It Should Be | Why |
|---------|-------------------|-----|
| `typescript` | devDependency per project | Version matters per project |
| `eslint` | devDependency per project | Config differs per project |
| `cypress` | devDependency per project | Heavy, version-sensitive |
| `@azure/functions-core-tools` | Project-specific | Version-sensitive |
| `create-*` / `@scope/create-*` | Use `npx` instead | One-time scaffolding |

### Audit Global Packages

```bash
npm list -g --depth=0     # npm globals
pnpm list -g              # pnpm globals (if using pnpm global)
```

### Clean Up Globals

```bash
npm uninstall -g <package-name>
```

## corepack

Node.js ships with corepack, which manages package manager versions per project.

```bash
# Enable corepack (one-time)
corepack enable

# After enabling, pnpm/yarn versions are managed by packageManager field
```

**Benefits:**
- No `npm install -g pnpm` needed
- Each project uses the exact pinned version
- CI uses the same version as local dev

## Workspace Configuration

### pnpm Workspaces (`pnpm-workspace.yaml`)

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### Package Naming

```json
{
  "name": "@scope/package-name",
  "private": true
}
```

### Cross-References

```json
{
  "dependencies": {
    "@scope/other-package": "workspace:*"
  }
}
```

## Troubleshooting

### "command not found: pnpm"

1. Check if corepack is enabled: `corepack --version`
2. Check if `packageManager` is set in `package.json`
3. Fall back: `npm install -g pnpm`

### Different pnpm behavior across repos

Check the `packageManager` field — repos may pin different major versions.
pnpm 9.x → 10.x has breaking changes in lockfile format.

### "ENOENT: no such file or directory" on npm install

Usually stale `node_modules`. Delete and reinstall:

```bash
Remove-Item -Recurse -Force node_modules    # Windows
rm -rf node_modules                          # macOS/Linux
pnpm install
```
