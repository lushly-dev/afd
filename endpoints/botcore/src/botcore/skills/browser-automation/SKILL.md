---
name: browser-automation
source: botcore
description: >
  Drives Chromium with botcore's cdp_* commands (botcore.commands.cdp): sessions,
  shadow DOM selectors, console capture, screenshots and DevTools performance
  traces. Use when automating or debugging a page with these commands or
  capturing a Chrome trace.
version: "2.0.0"
portable: true
---

# Browser automation with botcore CDP

The `cdp_*` functions in `botcore.commands.cdp` are async and return a `CommandResult`, so failures come back as `success=False`, not exceptions. They need `lushly-botcore[cdp]` (Playwright, httpx, Perfetto) and `playwright install chromium`. `cdp_launch` starts Playwright's Chromium, not a system Chrome.

Botcore core doesn't expose them. There is no `botcore cdp` command, and neither the MCP namespace (`botcore.commands.__all__`) nor `build_host` includes them. Call them from Python or register them in a plugin. An error suggestion that says "re-run with --force" means `force=True`. Parameters are documented only in the signatures and docstrings in `src/botcore/commands/cdp/`.

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
- `cdp_launch` and `cdp_attach` return `CDP_SESSION_EXISTS` while that file exists, unless `force=True`. `force` overwrites the file without closing the old browser. If Chrome has died, `cdp_close` fails with `CDP_CLOSE_FAILED` and keeps the file, so relaunch with `force=True`.
- Defaults under `.botcore/` are `chrome-profile/` (cookies and logins persist between launches), `screenshots/screenshot-<timestamp>.png` and `traces/<name>-<timestamp>.json`. On Windows, the profile moves to `%LOCALAPPDATA%\botcore\` when the workspace is on another drive.

## Every command is a new connection

Each command connects over CDP, acts on the first tab (index 0 in `cdp_list_pages`) and disconnects. Page JavaScript state survives, but per-connection state doesn't:

- **Console:** messages are captured only while a command runs, then appended to the session file for `cdp_console` (`level`, `grep`, `tail`, `clear=True`). Anything logged between commands is lost, as is load-time output from `cdp_launch(url=...)`. Load the page with `cdp_navigate` to capture it.
- **Emulation:** `cdp_resize` and `cdp_emulate` last only for their own call. `cdp_emulate` never applies `user_agent` or `cpu_throttle`; it only echoes them back.
- **Dialogs:** the `cdp_handle_dialog` handler ends with its call, so Playwright dismisses a dialog that a later `cdp_click` opens. Stub it first instead: `cdp_eval("window.confirm = () => true")`.
- **Tabs:** `cdp_select_page` reports "Page selection stored" but stores nothing. To work in another tab, close the tabs before it with `cdp_close_page`.

## Shadow DOM

Leave `deep` off. Without it, commands use Playwright CSS selectors, which wait for the element and pierce open shadow roots, even across a descendant combinator such as `my-app .save`. `deep=True` (on `cdp_click`, `cdp_hover`, `cdp_scroll`, `cdp_type`, `cdp_press`, `cdp_fill` and `cdp_upload`; default off) uses a script instead. It matches the selector inside one root at a time and doesn't wait. A deep `cdp_click` clicks at coordinates, with `x`/`y` as offsets from the centre.

`cdp_query` always uses that script and ignores its `deep` argument (default `True`). So `cdp_query("my-app .save")` can find nothing while `cdp_click("my-app .save")` works. `::shadow` paths (`my-app::shadow .save`) work only in `cdp_query`. Other commands reject them as invalid selectors.

## Network and traces

`cdp_list_network` and `cdp_get_network` capture nothing. They return success with a `note` suggesting `cdp_eval` with `performance.getEntriesByType('resource')`.

`cdp_trace_capture` records a real DevTools trace within one call: an optional navigation (`url`, `wait_until`), then `settle_ms` of idle time. It can't span other commands, so it traces page loads, not clicks. `cdp_trace_summary(path)` returns fixed-shape JSON, in which `signals.hasMainThreadJank` and `slices.primaryThreadLongTasks` (50 ms threshold by default) are the strongest regression signal. `cdp_trace_query(path, sql, limit=100)` runs PerfettoSQL over tables such as `slice`, `thread` and `process`, returning 1 to 5,000 rows. Perfetto downloads its pinned `trace_processor_shell` on first use, so the first summary or query needs network access.

Ignore `botcore.commands.cdp_perf`. It isn't exported, and its `perf_trace_start`/`perf_trace_stop` pair holds a CDP session that closes when the first call returns.

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
