# Interaction Commands Reference

## cdp_click()

```python
async def cdp_click(
    selector: str,
    x: int | None = None,
    y: int | None = None,
    button: str = "left",
    double: bool = False,
    ctrl: bool = False,
    shift: bool = False,
    alt: bool = False,
    deep: bool = False,
) -> CommandResult[dict]
```

Clicks an element with extended options.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `selector` | (required) | CSS selector for element |
| `x`, `y` | None | Offset from element center (pixels) |
| `button` | "left" | "left", "right", or "middle" |
| `double` | False | Double-click |
| `ctrl` | False | Hold Ctrl during click |
| `shift` | False | Hold Shift during click |
| `alt` | False | Hold Alt during click |
| `deep` | False | Traverse Shadow DOM to find element |

**Examples:**
```
cdp_click("#submit")                          — standard click
cdp_click(".item", button="right")            — right-click context menu
cdp_click(".link", ctrl=True)                 — Ctrl+click (new tab)
cdp_click(".item", double=True)               — double-click
cdp_click("my-component::shadow .btn", deep=True)  — Shadow DOM click
```

## cdp_hover()

```python
async def cdp_hover(selector: str, deep: bool = False) -> CommandResult[dict]
```

Moves mouse over element to trigger hover states, tooltips, and dropdown menus.

## cdp_scroll()

```python
async def cdp_scroll(
    selector: str | None = None,
    x: int | None = None,
    y: int | None = None,
    deep: bool = False,
) -> CommandResult[dict]
```

Scrolls element into view OR scrolls page by pixel offset.

**Modes:**
- `selector` provided → scrolls that element into view
- `x`/`y` provided → scrolls page by that offset (positive y = down)

**Examples:**
```
cdp_scroll(selector="#section-5")   — scroll element into view
cdp_scroll(y=500)                   — scroll down 500px
cdp_scroll(y=-300)                  — scroll up 300px
```

## cdp_drag()

```python
async def cdp_drag(
    selector: str,
    to: str | None = None,
    dx: int | None = None,
    dy: int | None = None,
) -> CommandResult[dict]
```

Drags element to a target or by pixel offsets.

**Modes:**
- `to` provided → drags to target selector's position
- `dx`/`dy` provided → drags by pixel offsets

**Examples:**
```
cdp_drag(".card", to=".drop-zone")    — drag to target
cdp_drag(".slider", dx=100, dy=0)     — drag right 100px
```

## cdp_type()

```python
async def cdp_type(
    text: str,
    selector: str | None = None,
    delay_ms: int = 0,
    deep: bool = False,
) -> CommandResult[dict]
```

Types text character by character into the focused element or a specific element.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `text` | (required) | Text to type |
| `selector` | None | Element to focus first (None = currently focused) |
| `delay_ms` | 0 | Delay between characters (ms) — mimics human typing |
| `deep` | False | Shadow DOM traversal |

**Note:** `cdp_type` sends individual keystrokes. For filling form fields with a value (clearing first), use `cdp_fill()` instead.

## cdp_press()

```python
async def cdp_press(
    key: str,
    selector: str | None = None,
    deep: bool = False,
) -> CommandResult[dict]
```

Presses a key or key combination.

**Key names:** `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `F1`-`F12`

**Combinations:** Use `+` for modifier combinations:
```
cdp_press("Enter")              — press Enter
cdp_press("Control+a")          — select all
cdp_press("Control+c")          — copy
cdp_press("Control+v")          — paste
cdp_press("Control+Shift+i")    — open DevTools
cdp_press("Alt+F4")             — close window
```

## Shadow DOM Traversal

When `deep=True`, interaction commands use JavaScript injection to find elements inside Shadow DOM trees:

1. Starting from `document`, walk through all shadow roots
2. Query each shadow root for the selector
3. Return the first match found at any depth

For explicit traversal, use `::shadow` syntax:
```
cdp_click("my-app::shadow nav-bar::shadow .menu-item", deep=True)
```

This targets `.menu-item` inside `nav-bar`'s shadow root, which is inside `my-app`'s shadow root.
