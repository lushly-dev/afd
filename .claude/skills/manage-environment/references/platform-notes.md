# Platform Notes

Cross-cutting differences between Windows and macOS for environment management.
Reference this when writing scripts, configs, or docs that must work on both.

## File System

| Aspect | Windows | macOS/Linux |
|--------|---------|-------------|
| Path separator | `\` (backslash) | `/` (forward slash) |
| Drive letters | `C:\`, `D:\` | No drives — `/` root |
| Case sensitivity | Case-insensitive | Case-sensitive (Linux), case-insensitive (macOS default) |
| Home directory | `%USERPROFILE%` (`C:\Users\name`) | `$HOME` (`/Users/name` or `/home/name`) |
| Config directory | `%APPDATA%` | `~/.config/` (XDG) |
| Executable extension | `.exe`, `.cmd`, `.ps1` | No extension required |
| Line endings | CRLF (`\r\n`) | LF (`\n`) |

## Python Paths

| Item | Windows | macOS/Linux |
|------|---------|-------------|
| Venv Python | `.venv\Scripts\python.exe` | `.venv/bin/python` |
| Venv pip | `.venv\Scripts\pip.exe` | `.venv/bin/pip` |
| Venv activate | `.venv\Scripts\Activate.ps1` | `source .venv/bin/activate` |
| uv binary | `~\.local\bin\uv.exe` | `~/.local/bin/uv` |
| Site packages | `.venv\Lib\site-packages\` | `.venv/lib/python3.X/site-packages/` |
| pyvenv.cfg | `.venv\pyvenv.cfg` | `.venv/pyvenv.cfg` |

### MCP Config Portability

For repos used on both platforms, MCP configs need platform awareness:

**Option A: Platform-specific paths (current approach)**

Each developer maintains their own config. The `.vscode/mcp.json` uses the
path for the current OS. Don't commit machine-specific paths.

**Option B: Relative executable paths**

```json
{
  "command": "proto/.venv/bin/fastmcp",
  "args": ["run", "proto/src/fabux_proto/mcp_server.py"]
}
```

On Windows, VS Code can resolve `proto/.venv/Scripts/fastmcp.exe` from this.
This works when the tool supports cross-platform resolution.

## Node.js Paths

| Item | Windows | macOS/Linux |
|------|---------|-------------|
| System Node | `C:\Program Files\nodejs\` | `/usr/local/bin/node` |
| fnm shims | `%LOCALAPPDATA%\fnm_multishells\` | `~/.local/share/fnm/` |
| npm global dir | `%APPDATA%\npm\` | `/usr/local/lib/node_modules/` |
| pnpm store | Configurable (`D:\.pnpm-store\`) | `~/.local/share/pnpm/store/` |
| `node_modules/.bin` | Uses `.cmd` wrappers | Uses symlinks |

## Shell Configuration

### Windows (PowerShell)

```powershell
# Profile location
$PROFILE    # Usually: ~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1

# Add to PATH for current session
$env:PATH = "C:\new\path;$env:PATH"

# Add permanently (User scope)
[Environment]::SetEnvironmentVariable('PATH',
  "C:\new\path;$([Environment]::GetEnvironmentVariable('PATH', 'User'))", 'User')
```

### macOS/Linux (zsh/bash)

```bash
# Profile location
# zsh: ~/.zprofile (login), ~/.zshrc (interactive)
# bash: ~/.bash_profile (login), ~/.bashrc (interactive)

# Add to PATH
export PATH="$HOME/.local/bin:$PATH"
```

## PATH Scope Differences

| Concept | Windows | macOS/Linux |
|---------|---------|-------------|
| System-wide PATH | Machine scope (admin required) | `/etc/paths`, `/etc/paths.d/` |
| Per-user PATH | User scope | Shell profile (`~/.zprofile`) |
| Session-only | `$env:PATH = ...` | `export PATH=...` |
| Effective order | Machine + User (concatenated) | Whatever shell config produces |
| Separator | `;` (semicolon) | `:` (colon) |

## Common Cross-Platform Gotchas

### 1. Git Line Endings

Without `core.autocrlf`, Windows may commit CRLF which breaks Unix scripts:

```bash
# Recommended global setting on Windows
git config --global core.autocrlf true

# Or per-repo via .gitattributes (preferred)
* text=auto
*.sh text eol=lf
*.ps1 text eol=crlf
```

### 2. Script Shebangs

Unix scripts start with `#!/usr/bin/env python3`. Windows ignores this.
Always use `python -m module` or explicit paths in configs instead of
relying on shebangs.

### 3. Environment Variables

```bash
# Unix: set inline
MY_VAR=value python script.py

# Windows PowerShell: set then run
$env:MY_VAR = "value"
python script.py
```

### 4. npm Scripts

npm scripts run in `cmd.exe` on Windows by default. Use `cross-env` for
environment variables in scripts, or configure npm to use PowerShell:

```bash
npm config set script-shell "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
```

### 5. Docker Path Mounting

```bash
# Windows (PowerShell)
docker run -v "${PWD}:/app" image

# macOS/Linux
docker run -v "$(pwd):/app" image
```

## Dual-Platform Development Checklist

When a repo is used on both Windows and macOS:

- [ ] `.gitattributes` with `* text=auto` for line ending normalization
- [ ] No hardcoded absolute paths in source code
- [ ] MCP configs use approach that works on both (or are gitignored)
- [ ] npm scripts don't use Unix-only commands (`rm -rf` → `rimraf`)
- [ ] Python scripts use `pathlib.Path`, not string concatenation
- [ ] CI tests on both platforms (or at least the primary one)
