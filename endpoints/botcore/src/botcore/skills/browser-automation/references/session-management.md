# Session Management Reference

## cdp_launch()

```python
async def cdp_launch(
    url: str | None = None,
    headless: bool = False,
    port: int | None = None,
    profile_dir: str | None = None,
    force: bool = False,
) -> CommandResult[dict]
```

Launches a new Chromium instance with CDP enabled.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `url` | None | URL to navigate to after launch |
| `headless` | False | Run in headless mode (no visible window) |
| `port` | None | CDP port (auto-assigned if not specified) |
| `profile_dir` | None | Chrome profile directory (auto-created if not specified) |
| `force` | False | Force launch even if a session already exists |

**Return data:** `cdp_endpoint`, `profile_dir`, `pid`, `headless`

**Behavior:**
1. Checks for existing session (errors unless `force=True`)
2. Gets Playwright's bundled Chromium executable
3. Assigns a free port if none specified
4. Creates default profile directory if none specified
5. Spawns Chrome process with `--remote-debugging-port`
6. Probes the CDP endpoint until ready (retries with delay)
7. Saves session to `.botcore/cdp-session.json`

### Profile Directories

Default: `{workspace}/.botcore/chrome-profile/`

Profiles persist cookies, localStorage, and browser state across sessions. Useful for maintaining logged-in state.

**Cross-drive handling (Windows):** If the workspace is on a different drive than LOCALAPPDATA, the profile is created in LOCALAPPDATA to avoid Chrome's path length issues.

## cdp_attach()

```python
async def cdp_attach(
    endpoint: str | None = None,
    port: int | None = None,
    profile_dir: str | None = None,
    force: bool = False,
) -> CommandResult[dict]
```

Attaches to an existing Chrome instance with CDP enabled.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `endpoint` | None | Full CDP WebSocket endpoint URL |
| `port` | None | CDP port (constructs endpoint from port) |
| `profile_dir` | None | Profile directory to record in session |
| `force` | False | Force attach even if a session already exists |

**Use cases:**
- Attaching to Chrome launched manually with `--remote-debugging-port`
- Reconnecting to a Chrome instance from a previous session
- Attaching to Chrome in a Docker container

## cdp_close()

```python
async def cdp_close() -> CommandResult[dict]
```

Closes the active CDP session.

**Behavior depends on how the session was started:**
- **Launched by botcore:** Kills the Chrome process, clears session file
- **Attached externally:** Gracefully closes browser pages, clears session file

**Return data:** `closed` (bool), `pid` (optional)

## Session Storage

Sessions are stored at: `{workspace}/.botcore/cdp-session.json`

```json
{
  "cdp_endpoint": "ws://127.0.0.1:9222/devtools/browser/abc123",
  "profile_dir": "/path/to/.botcore/chrome-profile",
  "launched_at": "2025-01-15T10:30:00Z",
  "pid": 12345,
  "console_log": [
    {"timestamp": "...", "level": "log", "text": "Page loaded"}
  ]
}
```

All CDP commands check for an active session before executing. If no session exists, they return an error with a suggestion to call `cdp_launch()` first.

## Constants

| Constant | Value | Description |
|---|---|---|
| `SESSION_DIRNAME` | `.botcore` | Session directory name |
| `SESSION_FILENAME` | `cdp-session.json` | Session file name |
| `PROFILE_DIRNAME` | `chrome-profile` | Default profile directory |
| `SCREENSHOTS_DIRNAME` | `screenshots` | Default screenshots directory |
| `DEFAULT_TIMEOUT_MS` | 30000 | Default timeout (30 seconds) |

## Headless vs Headed

| Mode | Flag | Use Case |
|---|---|---|
| Headed | `headless=False` | Debugging, visual verification |
| Headless | `headless=True` | CI/CD, automated testing, scraping |

Headless mode runs Chrome without a visible window. All CDP commands work identically in both modes.
