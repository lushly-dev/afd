---
name: browser-automation
description: >
  Drives Chromium with botcore's cdp_* commands (botcore.commands.cdp): sessions,
  shadow DOM selectors, console capture, screenshots and DevTools performance
  traces. Use when automating or debugging a page with these commands or
  capturing a Chrome trace.
metadata:
  source: botcore
  version: 2.0.0
  portable: true
---

# Browser automation with botcore CDP

The `cdp_*` functions in `botcore.commands.cdp` are async and return a `CommandResult`, so failures (including unreachable browsers and invalid regex patterns) come back as `success=False` with a structured error and suggestion. They need `lushly-botcore[cdp]` (Playwright, httpx, Perfetto) and `playwright install chromium`. `cdp_launch` starts Playwright's Chromium, not a system Chrome.

They are exposed through:
- `botcore cdp <subcommand>` on the CLI (for example `botcore cdp launch --headless`, `botcore cdp list-pages`, `botcore cdp close`)
- `botcore.commands` (`__all__`, which `build_namespace()` and `botcore serve` load)
- `CDP_POLICIES` in `botcore.host` (pass `core_commands=(*CORE_POLICIES, *CDP_POLICIES)` to `build_host()` to admit them with their `"browser"` effect and confined paths)

Parameters are documented in `botcore cdp <subcommand> --help` and in `src/botcore/commands/cdp/`.

| Area | Commands |
|---|---|
| Session | `cdp_launch`, `cdp_attach`, `cdp_close` |
| Navigation | `cdp_navigate`, `cdp_wait` |
| Input | `cdp_click`, `cdp_hover`, `cdp_scroll`, `cdp_drag`, `cdp_type`, `cdp_press` |
| DOM | `cdp_query`, `cdp_inspect`, `cdp_snapshot` (ARIA snapshot) |
| Forms and tabs | `cdp_fill`, `cdp_fill_form`, `cdp_upload`, `cdp_handle_dialog`, `cdp_list_pages`, `cdp_select_page`, `cdp_new_page`, `cdp_close_page`, `cdp_resize` |
| Diagnostics | `cdp_screenshot`, `cdp_console`, `cdp_get_console_message`, `cdp_eval`, `cdp_emulate`, `cdp_list_network`, `cdp_get_network` |
| Traces | `cdp_trace_capture`, `cdp_trace_summary`, `cdp_trace_query` |

## Session file and directories

- The session is `.botcore/cdp-session.json` in the workspace root. That is the nearest directory at or above the working directory holding `pnpm-workspace.yaml`, `Cargo.toml`, `pyproject.toml`, `package.json` or `.git`. A nested package with its own manifest therefore has a different session, or none.
- `cdp_launch` and `cdp_attach` return `CDP_SESSION_EXISTS` while that file exists, unless `force=True` (`--force`). `force` overwrites the file without closing the old browser. If Chrome has died, `cdp_close` fails with `CDP_CLOSE_FAILED` and keeps the file, so relaunch with `force=True`.
- Defaults under `.botcore/` are `chrome-profile/` (cookies and logins persist between launches), `screenshots/screenshot-<timestamp>.png` and `traces/<name>-<timestamp>.json`. On Windows, the profile moves to `%LOCALAPPDATA%\botcore\` when the workspace is on another drive.

## Every command is a new connection

Each command connects over CDP, acts on the selected tab (`selected_page` in `.botcore/cdp-session.json`, default 0) and disconnects. Page JavaScript state and persisted session settings survive:

- **Tabs:** `cdp_select_page(index)` validates the index against open tabs and stores `selected_page` and its CDP `selected_target_id` in the session file so subsequent commands and `cdp_trace_capture` target that exact tab even if earlier tabs close; if the selected tab closes externally, commands fail with `CDP_SELECTED_PAGE_CLOSED`. `cdp_close_page` updates selection when closing tabs.
- **Emulation and viewport:** `cdp_resize` and `cdp_emulate` (`color_scheme`, `viewport`, `offline`, `user_agent`, `cpu_throttle`) apply via Playwright and CDP `Emulation.*` and persist their settings in the session file so subsequent commands, `cdp_new_page`, and `cdp_trace_capture` re-apply them automatically. Pass `reset=True` (`--reset`) to `cdp_emulate` to clear persisted overrides.
- **Console:** messages are captured only while a command runs, then appended to the session file for `cdp_console` (`level`, `grep`, `tail`, `clear=True`). Anything logged between commands is lost, as is load-time output from `cdp_launch(url=...)`. Load the page with `cdp_navigate` to capture it. Invalid `grep` regexes return `CDP_INVALID_PATTERN`.
- **Dialogs:** the `cdp_handle_dialog` handler ends with its call, so Playwright dismisses a dialog that a later `cdp_click` opens. Stub it first instead: `cdp_eval("window.confirm = () => true")`.

## Shadow DOM

Leave `deep` off. Without it, commands use Playwright CSS selectors, which wait for the element and pierce open shadow roots, even across a descendant combinator such as `my-app .save`. `deep=True` (on `cdp_click`, `cdp_hover`, `cdp_scroll`, `cdp_type`, `cdp_press`, `cdp_fill` and `cdp_upload`; default off) uses a script instead. It matches the selector inside one root at a time and doesn't wait. A deep `cdp_click` clicks at coordinates, with `x`/`y` as offsets from the centre.

`cdp_query` always uses that script and ignores its `deep` argument (default `True`). So `cdp_query("my-app .save")` can find nothing while `cdp_click("my-app .save")` works. `::shadow` paths (`my-app::shadow .save`) work only in `cdp_query`. Other commands reject them as invalid selectors.

## Network and traces

`cdp_list_network(resource_type=..., limit=50)` and `cdp_get_network(url_pattern)` read the page's Performance Resource Timing API (`performance.getEntriesByType('navigation')` and `'resource'`), returning URL, resource type, timing, sizes, protocol and response status. Invalid regexes in `cdp_get_network` return `CDP_INVALID_PATTERN`.

`cdp_trace_capture` records a real DevTools trace within one call: an optional navigation (`url`, `wait_until`), then `settle_ms` of idle time. It can't span other commands, so it traces page loads, not clicks. `cdp_trace_summary(path)` returns fixed-shape JSON, in which `signals.hasMainThreadJank` and `slices.primaryThreadLongTasks` (50 ms threshold by default) are the strongest regression signal. `cdp_trace_query(path, sql, limit=100)` runs PerfettoSQL over tables such as `slice`, `thread` and `process`, returning 1 to 5,000 rows. Perfetto downloads its pinned `trace_processor_shell` on first use, so the first summary or query needs network access.

In `botcore.commands.cdp_perf`, `perf_trace_start` and `perf_trace_stop` return `CDP_TRACE_UNSUPPORTED` directing callers to `cdp_trace_capture` / `cdp_trace_summary` / `cdp_trace_query` (a CDP tracing session cannot span separate stateless connections).

## Example

```python
from botcore.commands.cdp import cdp_click, cdp_close, cdp_console, cdp_launch, cdp_navigate, cdp_wait

async def smoke(url: str) -> list[dict]:
    launched = await cdp_launch(headless=True)
    if not launched.success:                # e.g. CDP_SESSION_EXISTS
        raise RuntimeError(launched.error.message)
    await cdp_navigate(url)                 # captures load-time console output
    await cdp_click("shop-cart .add")       # pierces the open shadow root
    await cdp_wait(selector="cart-line")
    errors = (await cdp_console(level="error")).data["entries"]
    await cdp_close()
    return errors
```
