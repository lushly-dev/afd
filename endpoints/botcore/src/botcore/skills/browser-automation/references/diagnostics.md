# Diagnostics Commands Reference

## cdp_screenshot()

```python
async def cdp_screenshot(
    path: str | None = None,
    full_page: bool = False,
) -> CommandResult[dict]
```

Captures a screenshot of the current page.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `path` | None | Save path (auto-generated with timestamp if not specified) |
| `full_page` | False | Capture full scrollable page vs visible viewport |

**Default path:** `{workspace}/.botcore/screenshots/{timestamp}.png`

**Return data:** `path` (saved file path), `full_page` (bool)

**Tips:**
- Take screenshots after navigation to verify the page loaded correctly
- Use `full_page=True` for long pages to capture everything
- Screenshots are saved as PNG files

## cdp_console()

```python
async def cdp_console(
    tail: int | None = None,
    level: str | None = None,
    grep: str | None = None,
    clear: bool = False,
) -> CommandResult[dict]
```

Shows captured console log entries with filtering options.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `tail` | None | Show only the last N entries |
| `level` | None | Filter by level (comma-separated: "log,error,warning") |
| `grep` | None | Regex pattern to search in message text |
| `clear` | False | Clear the console log after returning entries |

**Return data:**
- `entries` — List of `ConsoleEntry` objects with: `timestamp`, `level`, `text`, `url`
- `count` — Number of entries returned

**Examples:**
```
cdp_console()                            — all entries
cdp_console(tail=10)                     — last 10 entries
cdp_console(level="error")               — errors only
cdp_console(level="error,warning")       — errors and warnings
cdp_console(grep="TypeError")            — search for TypeErrors
cdp_console(clear=True)                  — return all and clear
```

## cdp_get_console_message()

```python
async def cdp_get_console_message(index: int) -> CommandResult[dict]
```

Gets a specific console message by index.

**Return data:** `index`, `timestamp`, `level`, `text`, `url`

## cdp_eval()

```python
async def cdp_eval(expression: str) -> CommandResult[dict]
```

Evaluates a JavaScript expression in the current page context.

**Return data:** `expression`, `result` (the JavaScript return value)

**Examples:**
```
cdp_eval("document.title")                        — get page title
cdp_eval("window.location.href")                  — get current URL
cdp_eval("document.querySelectorAll('a').length")  — count links
cdp_eval("localStorage.getItem('token')")          — read storage
cdp_eval("JSON.stringify(performance.timing)")      — performance data
```

**Tips:**
- Return values are serialized to JSON-compatible types
- For complex queries, return a JSON-serializable object
- Use for browser APIs not covered by dedicated CDP commands

## cdp_emulate()

```python
async def cdp_emulate(
    color_scheme: str | None = None,
    viewport: str | None = None,
    user_agent: str | None = None,
    offline: bool = False,
    cpu_throttle: float | None = None,
) -> CommandResult[dict]
```

Emulates device and browser features.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `color_scheme` | None | "light", "dark", or "no-preference" |
| `viewport` | None | "WIDTHxHEIGHT" (e.g., "1920x1080") |
| `user_agent` | None | Custom user agent string |
| `offline` | False | Simulate offline mode |
| `cpu_throttle` | None | CPU throttle factor (e.g., 4.0 = 4x slower) |

**Return data:** `emulated` (list of changes), `count`

**Common viewport presets:**
| Device | Viewport |
|---|---|
| iPhone 14 | "390x844" |
| iPad | "820x1180" |
| Desktop HD | "1920x1080" |
| Desktop 4K | "3840x2160" |

## cdp_list_network() / cdp_get_network()

These are placeholder commands that suggest using `cdp_eval()` with the Performance API:

```
cdp_eval("JSON.stringify(performance.getEntriesByType('resource'))")
```

## Diagnostic Workflow

### Debugging a Page Issue

```
1. cdp_screenshot()                     — visual state
2. cdp_console(level="error")           — JS errors
3. cdp_eval("document.readyState")      — page load state
4. cdp_snapshot()                       — accessibility tree
5. cdp_eval("window.location.href")     — verify URL
```

### Performance Investigation

```
1. cdp_emulate(cpu_throttle=4.0)        — simulate slow CPU
2. cdp_navigate(url, wait_until="load")
3. cdp_eval("JSON.stringify(performance.timing)")
4. cdp_eval("JSON.stringify(performance.getEntriesByType('resource'))")
5. cdp_screenshot()                     — visual verification
```
