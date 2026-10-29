# Inspection Commands Reference

## cdp_query()

```python
async def cdp_query(
    selector: str,
    deep: bool = True,
) -> CommandResult[dict]
```

Queries elements matching a CSS selector, with automatic Shadow DOM traversal.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `selector` | (required) | CSS selector |
| `deep` | True | Auto-traverse Shadow DOM (default on) |

**Return data:**
- `selector` — The selector used
- `mode` — "explicit" (if `::shadow` syntax used) or "deep"
- `count` — Total matches found
- `elements` — Up to 10 matching elements, each with:
  - `tagName` — Element tag
  - `id` — Element ID (if any)
  - `className` — CSS classes
  - `textContent` — Text content (truncated)
  - `attributes` — All attributes as key-value pairs

**Examples:**
```
cdp_query("button")                    — find all buttons
cdp_query(".card", deep=True)          — find cards in/outside Shadow DOM
cdp_query("my-app::shadow .item")      — explicit shadow traversal
```

### Shadow DOM Syntax

Use `::shadow` to explicitly traverse shadow boundaries:

```
host-element::shadow child-selector
```

Chain for nested shadow roots:
```
outer-host::shadow inner-host::shadow .target
```

## cdp_inspect()

```python
async def cdp_inspect(
    selector: str,
    prop: str | None = None,
    attr: str | None = None,
    style: str | None = None,
    text: bool = False,
    visible: bool = False,
    enabled: bool = False,
    focused: bool = False,
) -> CommandResult[dict]
```

Inspects detailed properties of a single element.

**Query modes** (use one at a time):

| Mode | Parameter | Returns |
|---|---|---|
| Default | (none) | Full element overview: tagName, id, className, textContent, value, checked, visible, disabled |
| Property | `prop="value"` | Specific DOM property value |
| Attribute | `attr="data-id"` | Specific HTML attribute value |
| Style | `style="color"` | Computed CSS property value |
| Text | `text=True` | Text content only |
| Visibility | `visible=True` | Boolean: is element visible? |
| Enabled | `enabled=True` | Boolean: is element enabled? |
| Focus | `focused=True` | Boolean: is element focused? |

**Examples:**
```
cdp_inspect("#email")                         — full overview
cdp_inspect("#email", prop="value")           — current input value
cdp_inspect(".btn", attr="data-action")       — custom attribute
cdp_inspect(".heading", style="font-size")    — computed CSS
cdp_inspect("#submit", enabled=True)          — check if clickable
```

## cdp_snapshot()

```python
async def cdp_snapshot(
    root_selector: str | None = None,
) -> CommandResult[dict]
```

Takes an accessibility tree snapshot of the page or a subtree.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `root_selector` | None | Root element for subtree (None = full page) |

**Return data:**
- `snapshot` — Simplified accessibility tree showing roles, names, and hierarchy
- `root` — The root selector used (or "document")

**Use cases:**
- Understanding page structure without visual rendering
- Verifying accessibility labels and roles
- Finding interactive elements by their accessible names
- Working in headless mode where screenshots aren't helpful

**Example output structure:**
```
- document "Page Title"
  - navigation "Main Navigation"
    - link "Home"
    - link "About"
  - main
    - heading "Welcome" (level 1)
    - form "Login"
      - textbox "Email"
      - textbox "Password"
      - button "Sign In"
```

## Inspection Strategy

### Finding Elements

1. **Start with `cdp_query()`** to see what matches a selector
2. **Narrow with `cdp_inspect()`** to check specific properties
3. **Use `cdp_snapshot()`** when you need the full page structure

### Debugging Missing Elements

1. Check if the element is in Shadow DOM → try `deep=True`
2. Check if the element is in an iframe → not yet supported
3. Check if the element is dynamically loaded → use `cdp_wait()` first
4. Check visibility → `cdp_inspect(selector, visible=True)`
