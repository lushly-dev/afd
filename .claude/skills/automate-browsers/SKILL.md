---
name: automate-browsers
source: botcore
description: >
  Guides browser automation via botcore's CDP (Chrome DevTools Protocol) command suite. Covers session management (launch/attach/close), navigation and waiting, element interaction (click/type/fill/drag), DOM inspection with Shadow DOM traversal, diagnostics (screenshot/console/network/eval), form filling, multi-page management, and device emulation. Use when automating browsers, scraping web pages, testing web UIs, filling forms, taking screenshots, debugging frontend issues, or working with Shadow DOM components. Triggers: CDP, browser, Chrome, Chromium, automation, screenshot, click, fill form, Shadow DOM, console log, navigate, scrape, headless.

version: 1.0.0
triggers:
  - CDP
  - browser
  - Chrome
  - Chromium
  - automation
  - screenshot
  - click
  - fill form
  - Shadow DOM
  - console log
  - navigate
  - scrape
  - headless
  - browser automation
  - web testing
  - cdp launch
  - cdp close
  - DevTools Protocol
portable: true
---

# Automating Browsers

Expert guidance for browser automation using botcore's CDP command suite — 28+ commands for controlling Chromium via the Chrome DevTools Protocol.

## Capabilities

1. **Manage Browser Sessions** -- Launch, attach to, and close Chromium instances with persistent profiles
2. **Navigate and Wait** -- Load pages and wait for selectors, text, or custom conditions
3. **Interact with Elements** -- Click, hover, scroll, drag, type, and press keys with modifier support
4. **Inspect the DOM** -- Query elements, read properties/attributes/styles, and traverse Shadow DOM
5. **Fill Forms** -- Fill individual fields, batch-fill forms, upload files, and handle dialogs
6. **Capture Diagnostics** -- Take screenshots, read console logs, evaluate JavaScript, and emulate devices
7. **Manage Pages** -- Open, close, list, and switch between browser tabs

## Routing Logic

| Request Type | Load Reference |
|---|---|
| Launching, attaching, closing sessions, profile directories | [references/session-management.md](references/session-management.md) |
| Click, hover, scroll, drag, type, press, modifier keys | [references/interaction.md](references/interaction.md) |
| Query elements, inspect properties, Shadow DOM, accessibility snapshot | [references/inspection.md](references/inspection.md) |
| Screenshot, console, eval, emulate, network | [references/diagnostics.md](references/diagnostics.md) |
| Form filling, file upload, dialogs, page management | [references/forms-and-pages.md](references/forms-and-pages.md) |

## Core Principles

### 1. Session-First Workflow

<rules>
Always launch or attach before any other CDP command.
Always close when done to avoid orphaned Chrome processes.
The workflow is: launch → interact → close.
</rules>

Sessions are persisted to `.botcore/cdp-session.json`. If a session file exists, commands connect to the existing session automatically.

### 2. Selectors and Shadow DOM

<rules>
Use CSS selectors for element targeting.
Set `deep=True` to traverse Shadow DOM boundaries automatically.
Use `::shadow` syntax for explicit shadow root traversal: `host-element::shadow .inner`.
</rules>

Most modern web components use Shadow DOM. If a selector doesn't match, try `deep=True` before assuming the element doesn't exist.

### 3. Wait Before Interacting

<rules>
After navigation, wait for the target element before interacting with it.
Use `cdp_wait(selector=...)` for elements, `cdp_wait(text=...)` for content, or `cdp_wait(ms=...)` for timed delays.
</rules>

### 4. Console Logs Are Accumulated

<rules>
Console messages are captured throughout the session and saved to the session file.
Use `cdp_console()` to review them. Use `cdp_console(clear=True)` to reset.
</rules>

## Command Quick Reference

### Session Lifecycle

| Command | Purpose |
|---|---|
| `cdp_launch(url, headless, port, profile_dir)` | Launch new Chromium instance |
| `cdp_attach(endpoint, port)` | Attach to existing Chrome |
| `cdp_close()` | Close session and optionally kill process |

### Navigation

| Command | Purpose |
|---|---|
| `cdp_navigate(url, wait_until)` | Navigate to URL |
| `cdp_wait(selector, ms, text, hidden)` | Wait for condition |

### Interaction

| Command | Purpose |
|---|---|
| `cdp_click(selector, button, double, ctrl, shift, deep)` | Click element |
| `cdp_hover(selector, deep)` | Hover over element |
| `cdp_scroll(selector, x, y, deep)` | Scroll to element or by offset |
| `cdp_drag(selector, to, dx, dy)` | Drag element |
| `cdp_type(text, selector, delay_ms, deep)` | Type text |
| `cdp_press(key, selector, deep)` | Press key combination |

### Inspection

| Command | Purpose |
|---|---|
| `cdp_query(selector, deep)` | Find elements (returns up to 10) |
| `cdp_inspect(selector, prop, attr, style, text, visible)` | Read element details |
| `cdp_snapshot(root_selector)` | Accessibility tree snapshot |

### Forms and Pages

| Command | Purpose |
|---|---|
| `cdp_fill(selector, value, deep)` | Fill input/select |
| `cdp_fill_form(fields)` | Batch fill `{selector: value}` |
| `cdp_upload(selector, file_path, deep)` | Upload file |
| `cdp_handle_dialog(action, prompt_text)` | Handle alert/confirm/prompt |
| `cdp_list_pages()` | List open tabs |
| `cdp_select_page(index)` | Switch to tab |
| `cdp_new_page(url)` | Open new tab |
| `cdp_close_page(index)` | Close tab |
| `cdp_resize(width, height)` | Resize viewport |

### Diagnostics

| Command | Purpose |
|---|---|
| `cdp_screenshot(path, full_page)` | Capture screenshot |
| `cdp_console(tail, level, grep, clear)` | Read/filter console logs |
| `cdp_eval(expression)` | Execute JavaScript |
| `cdp_emulate(color_scheme, viewport, user_agent, offline)` | Emulate device |

## Typical Workflow

```
1. cdp_launch(url="https://example.com")
2. cdp_wait(selector="#main-content")
3. cdp_screenshot()                        — verify page loaded
4. cdp_fill_form({"#email": "user@test.com", "#password": "pass"})
5. cdp_click("#submit-button")
6. cdp_wait(selector=".success-message")
7. cdp_screenshot()                        — verify result
8. cdp_console(level="error")              — check for JS errors
9. cdp_close()
```

## Checklist

- [ ] Session launched or attached before first interaction
- [ ] `cdp_wait()` used after navigation and before interaction
- [ ] Shadow DOM traversal enabled where needed (`deep=True`)
- [ ] Screenshots taken at key checkpoints for verification
- [ ] Console logs checked for JavaScript errors
- [ ] Session closed when done (`cdp_close()`)
