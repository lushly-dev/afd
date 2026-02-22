# Environment Cleanup Playbook

Step-by-step procedures for fixing environment issues found during audit.
Each section is independent — jump to the relevant one.

---

## Python: Clean Global Pollution

**Symptom:** `pip list` outside a venv shows >5 packages.

### Step 1: Document What's There

```bash
pip list --format=columns > ~/global-python-packages-backup.txt
```

### Step 2: Identify Safe Packages

Keep only: `pip`, `setuptools`, `wheel`, `uv` (if installed globally).

### Step 3: Remove Everything Else

```bash
# Generate uninstall list (excludes pip, setuptools, wheel)
pip list --format=freeze | grep -v -E '^(pip|setuptools|wheel|uv)==' > /tmp/to-remove.txt

# Review first
cat /tmp/to-remove.txt

# Uninstall all
pip uninstall -y -r /tmp/to-remove.txt
```

Windows PowerShell equivalent:

```powershell
pip list --format=freeze |
  Where-Object { $_ -notmatch '^(pip|setuptools|wheel|uv)==' } |
  Set-Content $env:TEMP\to-remove.txt

pip uninstall -y -r $env:TEMP\to-remove.txt
```

### Step 4: Verify

```bash
pip list    # Should show ≤4 packages
```

### Step 5: Recreate Project Venvs

After cleaning global scope, recreate each project's venv:

```bash
cd <project>
rm -rf .venv                              # Delete old venv
uv venv .venv --python 3.13              # Create fresh
source .venv/bin/activate                 # Activate (macOS/Linux)
# .venv\Scripts\activate                  # Windows
uv pip install -e ".[dev]"               # Install deps
```

---

## Python: Fix MCP Configs

**Symptom:** MCP config uses `"command": "python"` instead of explicit venv path.

### Step 1: Find All Bare Python Configs

```powershell
Get-ChildItem -Recurse -Include "mcp.json" |
  Select-String '"command".*"python[^.]' |
  Select-Object Path, LineNumber
```

### Step 2: Replace With Explicit Path

Each server's `command` should point to the venv Python:

```json
{
  "command": "D:/Github/project-name/.venv/Scripts/python.exe"
}
```

For cross-platform repos (Mac + Windows), use the platform where the config
will be consumed. VS Code resolves at runtime on the current OS.

### Step 3: Remove Unnecessary `cwd`

If the command path is absolute, `cwd` is usually not needed. Remove it
unless the server specifically requires it for relative file resolution.

---

## Node.js: Install Version Manager

**Symptom:** Node installed from nodejs.org, no `fnm`/`nvm`/`volta`.

### Step 1: Install fnm

```bash
# Windows
winget install Schniz.fnm

# macOS
brew install fnm
```

### Step 2: Configure Shell

```powershell
# PowerShell — add to $PROFILE
fnm env --use-on-cd | Out-String | Invoke-Expression
```

```bash
# bash/zsh — add to .bashrc or .zshrc
eval "$(fnm env --use-on-cd)"
```

### Step 3: Install LTS Node

```bash
fnm install 22
fnm default 22
```

### Step 4: Uninstall System Node

- **Windows**: Settings → Apps → Node.js → Uninstall
- **macOS**: `brew uninstall node` or remove from `/usr/local/`

### Step 5: Verify

```bash
node --version     # Should be 22.x from fnm
which node         # Should point to fnm directory
```

---

## Node.js: Clean npm Globals

**Symptom:** `npm list -g --depth=0` shows >5 packages.

### Step 1: List Current Globals

```bash
npm list -g --depth=0
```

### Step 2: Identify What to Remove

Keep: `npm`, `pnpm` (if not using corepack), `corepack`
Remove: everything else (frameworks, linters, heavy tools)

### Step 3: Remove Each Package

```bash
npm uninstall -g <package-name>
```

### Step 4: Verify

```bash
npm list -g --depth=0    # Should show 2-3 packages
```

---

## Node.js: Fix Dual Lockfiles

**Symptom:** Both `package-lock.json` and `pnpm-lock.yaml` exist in the same directory.

### Step 1: Determine the Correct Package Manager

Check `package.json` for `packageManager` field. If none, check for
`pnpm-workspace.yaml` (means pnpm) or CI config.

### Step 2: Delete the Wrong Lockfile

If the project uses pnpm:

```bash
rm package-lock.json      # macOS/Linux
Remove-Item package-lock.json  # Windows
```

If the project uses npm:

```bash
rm pnpm-lock.yaml
```

### Step 3: Regenerate

```bash
pnpm install    # Regenerates pnpm-lock.yaml
# or
npm install     # Regenerates package-lock.json
```

---

## Node.js: Align pnpm Versions

**Symptom:** Different repos pin different pnpm major versions.

### Step 1: Decide on Target Version

Pick the latest stable major version (e.g., `pnpm@10.x`).

### Step 2: Update `packageManager` Field

In each repo's root `package.json`:

```json
{
  "packageManager": "pnpm@10.26.2"
}
```

### Step 3: Regenerate Lockfile

```bash
rm pnpm-lock.yaml
pnpm install
```

> **Note:** pnpm 9→10 changes lockfile format. Test after upgrading.

### Step 4: Enable corepack

```bash
corepack enable
```

---

## PATH: Remove Duplicates

**Symptom:** Multiple identical PATH entries.

### Windows

```powershell
# User PATH
$current = [Environment]::GetEnvironmentVariable('PATH', 'User') -split ';' |
           Where-Object { $_ -ne '' }
$deduped = $current | Select-Object -Unique

# Preview changes
Compare-Object $current $deduped

# Apply
[Environment]::SetEnvironmentVariable('PATH', ($deduped -join ';'), 'User')
```

For Machine PATH (requires elevated shell):

```powershell
$current = [Environment]::GetEnvironmentVariable('PATH', 'Machine') -split ';' |
           Where-Object { $_ -ne '' }
$deduped = $current | Select-Object -Unique
[Environment]::SetEnvironmentVariable('PATH', ($deduped -join ';'), 'Machine')
```

### macOS/Linux

Edit `~/.zprofile` or `~/.bash_profile` and remove duplicate `export PATH` lines.

---

## PATH: Remove Stale Entries

**Symptom:** PATH contains directories that no longer exist.

### Windows

```powershell
# User scope
$current = [Environment]::GetEnvironmentVariable('PATH', 'User') -split ';' |
           Where-Object { $_ -ne '' }
$valid = $current | Where-Object { Test-Path $_ }
$removed = $current | Where-Object { -not (Test-Path $_) }

# Show what will be removed
$removed

# Apply
[Environment]::SetEnvironmentVariable('PATH', ($valid -join ';'), 'User')
```

---

## Post-Cleanup Verification

After any cleanup, verify the full stack:

```bash
# Python
python --version
pip list                    # Should be minimal outside venv

# Node
node --version              # Should be even LTS
npm list -g --depth=0       # Should be minimal

# PATH
# No duplicates, no stale entries (re-run audit checks)

# Project venvs
cd <each-project>
.venv/Scripts/python --version   # Should resolve
pnpm install                      # Should succeed
```

Restart your terminal after PATH changes to ensure the new values take effect.
