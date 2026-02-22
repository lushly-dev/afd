# PATH Management

Rules and procedures for keeping the system PATH clean and correct across platforms.

## Why PATH Matters

When an agent runs `python`, `node`, or `pnpm`, the OS resolves the command via
PATH. Wrong PATH ordering causes:

- Wrong Python version picked up (global instead of venv)
- Wrong Node version (system install overrides version manager)
- Windows Store stubs intercepting real binaries
- Stale entries pointing to uninstalled tools

## PATH Ordering Principles

1. **Version manager shims first** — fnm, uv, pyenv directories before system paths
2. **User tools before system tools** — `~/.local/bin` before `/usr/local/bin`
3. **No duplicates** — Each directory appears exactly once
4. **No stale entries** — Every entry points to an existing directory
5. **No Windows Store stubs** — Remove or reorder WindowsApps for Python/Node

## Windows PATH

### Two Scopes

Windows has **Machine PATH** and **User PATH**. The effective PATH is:

```
[Machine entries] + [User entries]
```

Machine PATH is shared across all users (requires admin to change).
User PATH is per-user and takes effect after Machine entries.

### Viewing PATH

```powershell
# Combined (what commands actually see)
$env:PATH -split ';'

# Machine scope only
[Environment]::GetEnvironmentVariable('PATH', 'Machine') -split ';'

# User scope only
[Environment]::GetEnvironmentVariable('PATH', 'User') -split ';'
```

### Finding Duplicates

```powershell
$machine = [Environment]::GetEnvironmentVariable('PATH', 'Machine') -split ';' |
           Where-Object { $_ -ne '' }
$user = [Environment]::GetEnvironmentVariable('PATH', 'User') -split ';' |
        Where-Object { $_ -ne '' }
$all = $machine + $user

$all | Group-Object | Where-Object { $_.Count -gt 1 } |
  ForEach-Object { "$($_.Count)x  $($_.Name)" }
```

### Removing Stale Entries

```powershell
# Read current User PATH
$current = [Environment]::GetEnvironmentVariable('PATH', 'User') -split ';' |
           Where-Object { $_ -ne '' }

# Filter to only existing directories
$clean = $current | Where-Object { Test-Path $_ }

# Show what would be removed
$current | Where-Object { -not (Test-Path $_) }

# Apply (CAREFUL — verify first)
[Environment]::SetEnvironmentVariable('PATH', ($clean -join ';'), 'User')
```

### Deduplicating User PATH

```powershell
$current = [Environment]::GetEnvironmentVariable('PATH', 'User') -split ';' |
           Where-Object { $_ -ne '' }
$deduped = $current | Select-Object -Unique
[Environment]::SetEnvironmentVariable('PATH', ($deduped -join ';'), 'User')
```

> **Warning**: Deduplicating Machine PATH requires admin. Open elevated PowerShell.

### Windows Store Python Stubs

Windows installs `python.exe` and `python3.exe` stubs in:
```
%LOCALAPPDATA%\Microsoft\WindowsApps\
```

These open the Microsoft Store instead of running Python. To fix:
1. Settings → Apps → Advanced app execution aliases → Turn off Python
2. Or ensure your real Python (e.g., `~/.local/bin`) appears earlier in PATH

### Recommended User PATH Order (Windows)

```
%USERPROFILE%\.local\bin          # uv shims, custom tools
%USERPROFILE%\.cargo\bin          # Rust tools
%USERPROFILE%\AppData\Roaming\npm # npm global binaries
%LOCALAPPDATA%\fnm_multishells    # fnm-managed Node (if using fnm)
%LOCALAPPDATA%\Microsoft\WindowsApps  # LAST — Windows Store stubs
```

## macOS/Linux PATH

### Shell Initialization Order

| Shell | Per-session | Login |
|-------|-------------|-------|
| bash | `~/.bashrc` | `~/.bash_profile` or `~/.profile` |
| zsh | `~/.zshrc` | `~/.zprofile` |

**Put PATH modifications in the login file** (`.zprofile` / `.bash_profile`)
so they apply once per session, not per subshell.

### Viewing and Modifying

```bash
# View
echo $PATH | tr ':' '\n'

# Add to front (takes priority)
export PATH="$HOME/.local/bin:$PATH"

# Add to end (lowest priority)
export PATH="$PATH:/opt/tools/bin"
```

### Recommended PATH Order (macOS)

```bash
$HOME/.local/bin           # uv shims, custom tools
$HOME/.cargo/bin           # Rust tools
# fnm adds its own entries via eval
/opt/homebrew/bin          # Homebrew (Apple Silicon)
/usr/local/bin             # Homebrew (Intel) / system tools
/usr/bin                   # System binaries
```

### Homebrew Doctor

```bash
brew doctor    # Checks for PATH issues, outdated tools, broken symlinks
```

## Verifying PATH Resolution

After any PATH changes, verify that the right binary is found:

```bash
# macOS/Linux
which python && python --version
which node && node --version
which pnpm && pnpm --version

# Windows PowerShell
Get-Command python | Select-Object Source
Get-Command node | Select-Object Source
Get-Command pnpm | Select-Object Source
```

## Common PATH Problems

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `python` opens Microsoft Store | WindowsApps stub before real Python | Reorder PATH or disable alias |
| Wrong Node version despite fnm | System Node in Machine PATH (higher priority) | Uninstall system Node or move fnm shim earlier |
| `pnpm: command not found` | npm global dir not in PATH | Add `AppData\Roaming\npm` to User PATH |
| Duplicated tool output | Same dir listed multiple times | Deduplicate PATH |
| `command not found` after install | New PATH not loaded in current shell | Restart terminal or source config |
