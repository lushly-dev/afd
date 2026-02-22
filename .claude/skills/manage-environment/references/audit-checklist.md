# Environment Audit Checklist

Systematic checks across Python, Node.js, PATH, and system tooling.
Run these when onboarding to a new machine, after major tooling changes,
or when something "works on my machine but not yours."

## Quick Health Check (2 minutes)

Run these first — they catch the most common drift:

```bash
# Python
python --version                     # Should be managed version (3.11+)
uv --version                         # Should resolve (uv installed)

# Node
node --version                       # Should be even-numbered LTS (22, 24)
pnpm --version                       # Should match repo packageManager fields

# PATH
# Windows
$env:PATH -split ';' | Group-Object | Where-Object { $_.Count -gt 1 }
# macOS
echo $PATH | tr ':' '\n' | sort | uniq -d
```

If any fail, proceed to the detailed sections below.

## Python Audit

### 1. Which Python?

```bash
# What resolves?
python --version          # Expected: 3.11+ from uv
which python              # macOS/Linux
Get-Command python        # Windows — check Source path
```

**Red flags:**
- Resolves to `C:\Python3XX\` (global installer, no version manager)
- Resolves to `WindowsApps\python.exe` (Windows Store stub)
- Resolves to `/usr/bin/python` (system Python on macOS — DO NOT modify)

### 2. Global Package Pollution

```bash
# Check for packages outside a venv
pip list 2>/dev/null | wc -l     # macOS/Linux — should be ≤5
pip list 2>$null | Measure-Object # Windows — should be ≤5

# Safe globals: pip, setuptools, wheel, uv (that's it)
```

If count is >10, you have global pollution. See the cleanup playbook.

### 3. Venv Health Per Project

For each project that uses Python:

```bash
cd <project>
# Does .venv exist?
ls .venv/                         # Should exist

# What Python does it use?
.venv/Scripts/python.exe --version    # Windows
.venv/bin/python --version            # macOS/Linux

# Is it the right version?
cat .venv/pyvenv.cfg | grep version   # Check Python version

# Are deps installed?
.venv/Scripts/pip list                # Windows
.venv/bin/pip list                    # macOS/Linux
```

### 4. Editable Install Check

```bash
pip list --format=columns | grep -i "editable"    # In each venv
pip show <package> | grep Location                  # Should point to source
```

### 5. MCP Config Audit

Search all MCP configs for bare `python`:

```bash
# PowerShell
Get-ChildItem -Recurse -Include "mcp.json" |
  Select-String '"command".*"python[^.]' |
  Select-Object Path, Line
```

Every match is a bug — should use full venv path.

## Node.js Audit

### 1. Which Node?

```bash
node --version            # Should be even LTS (22, 24)
Get-Command node          # Windows — check path
which node                # macOS/Linux
```

**Red flags:**
- Odd-numbered version (19, 21, 23) — not LTS
- Resolves to `C:\Program Files\nodejs\` without a version manager
- No `.node-version` file in project roots

### 2. Version Manager

```bash
fnm --version             # Preferred
nvm --version             # Acceptable but slower (nvm-windows)
volta --version           # Also acceptable
```

If none installed, Node version is unmanaged — a risk.

### 3. npm Global Packages

```bash
npm list -g --depth=0
```

Count the packages. Typical healthy count: 2-5.

**Should be global:** pnpm (if not using corepack), fnm (if not via winget)
**Should NOT be global:** typescript, eslint, cypress, framework CLIs

### 4. pnpm Version Drift

```bash
# Check what's pinned in package.json across repos
# PowerShell
Get-ChildItem -Path D:\Github -Recurse -Filter package.json -Depth 2 |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  ForEach-Object {
    $pkg = Get-Content $_.FullName -Raw | ConvertFrom-Json
    if ($pkg.packageManager) {
      "$($pkg.packageManager)  $($_.Directory.Name)"
    }
  } | Sort-Object
```

Flag any repos on different major versions (e.g., 9.x vs 10.x).

### 5. Lockfile Conflicts

```bash
# Find repos with multiple lockfiles
# PowerShell
Get-ChildItem -Path D:\Github -Recurse -Depth 3 `
  -Include "package-lock.json","pnpm-lock.yaml","yarn.lock","bun.lockb" |
  Group-Object { Split-Path $_.FullName -Parent } |
  Where-Object { $_.Count -gt 1 } |
  ForEach-Object { "$($_.Count) lockfiles in $($_.Name)" }
```

Each repo should have exactly one lockfile type.

### 6. corepack Status

```bash
corepack --version        # Should resolve if Node is installed
corepack enable           # Enable if not already
```

## PATH Audit

### 1. Duplicate Check

```powershell
# Windows
$all = ($env:PATH -split ';') | Where-Object { $_ -ne '' }
$dupes = $all | Group-Object | Where-Object { $_.Count -gt 1 }
$dupes | ForEach-Object { "$($_.Count)x  $($_.Name)" }
```

```bash
# macOS/Linux
echo $PATH | tr ':' '\n' | sort | uniq -d
```

### 2. Stale Entry Check

```powershell
# Windows — find PATH entries that don't exist
$env:PATH -split ';' | Where-Object { $_ -ne '' -and -not (Test-Path $_) }
```

```bash
# macOS/Linux
echo $PATH | tr ':' '\n' | while read p; do [ ! -d "$p" ] && echo "MISSING: $p"; done
```

### 3. Priority Order Check

Verify that version manager shims come before system paths:

```powershell
# Python — uv shim should come before system Python
$env:PATH -split ';' | Select-String -Pattern 'python|local.bin|uv' | Select-Object -First 5
```

## System Tooling Audit

### Versions Check

```bash
git --version              # ≥2.40
docker --version           # If needed
gh --version               # GitHub CLI
```

### Git Configuration

```bash
git config --global user.name     # Should be set
git config --global user.email    # Should be set
git config --global core.autocrlf # Windows: true or input
```

## Summary Scorecard

After running the audit, score each area:

| Area | Status | Notes |
|------|--------|-------|
| Python version | ✅/⚠️/❌ | |
| Python globals clean | ✅/⚠️/❌ | |
| All venvs healthy | ✅/⚠️/❌ | |
| MCP configs explicit | ✅/⚠️/❌ | |
| Node version (LTS) | ✅/⚠️/❌ | |
| Version manager installed | ✅/⚠️/❌ | |
| npm globals minimal | ✅/⚠️/❌ | |
| pnpm versions aligned | ✅/⚠️/❌ | |
| No dual lockfiles | ✅/⚠️/❌ | |
| PATH no duplicates | ✅/⚠️/❌ | |
| PATH no stale entries | ✅/⚠️/❌ | |
| PATH correct priority | ✅/⚠️/❌ | |
