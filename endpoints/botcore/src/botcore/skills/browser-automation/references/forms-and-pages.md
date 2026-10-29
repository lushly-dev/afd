# Forms and Page Management Reference

## cdp_fill()

```python
async def cdp_fill(
    selector: str,
    value: str,
    deep: bool = False,
) -> CommandResult[dict]
```

Fills an input, textarea, or select element with a value. Clears existing content first.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `selector` | (required) | CSS selector for the form field |
| `value` | (required) | Value to fill |
| `deep` | False | Shadow DOM traversal |

**Return data:** `selector`, `value`, `filled` (bool)

**Difference from cdp_type:** `cdp_fill()` clears the field first and sets the value directly. `cdp_type()` sends individual keystrokes without clearing.

## cdp_fill_form()

```python
async def cdp_fill_form(fields: dict[str, str]) -> CommandResult[dict]
```

Fills multiple form fields at once.

**Parameters:**
- `fields` — Dict mapping CSS selectors to values

**Return data:** `filled` (list of selectors), `count`

**Example:**
```python
cdp_fill_form({
    "#first-name": "John",
    "#last-name": "Doe",
    "#email": "john@example.com",
    "#phone": "+1-555-0100",
    "select#country": "US",
})
```

## cdp_upload()

```python
async def cdp_upload(
    selector: str,
    file_path: str,
    deep: bool = False,
) -> CommandResult[dict]
```

Uploads a file through a file input element.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `selector` | (required) | CSS selector for `<input type="file">` |
| `file_path` | (required) | Absolute path to the file to upload |
| `deep` | False | Shadow DOM traversal |

**Note:** Validates that the file exists before attempting upload.

## cdp_handle_dialog()

```python
async def cdp_handle_dialog(
    action: str = "accept",
    prompt_text: str | None = None,
) -> CommandResult[dict]
```

Sets up a handler for the next browser dialog (alert, confirm, prompt).

**Important:** Must be called BEFORE the action that triggers the dialog.

**Parameters:**
| Parameter | Default | Description |
|---|---|---|
| `action` | "accept" | "accept" or "dismiss" |
| `prompt_text` | None | Text to enter in prompt dialogs |

**Workflow:**
```
1. cdp_handle_dialog(action="accept")        — set up handler
2. cdp_click("#delete-button")               — triggers confirm dialog
   → handler automatically accepts the dialog
```

## Page Management

### cdp_list_pages()

```python
async def cdp_list_pages() -> CommandResult[dict]
```

Lists all open pages/tabs.

**Return data:** `pages` (list of `{index, url, title, context}`), `count`

### cdp_select_page()

```python
async def cdp_select_page(index: int) -> CommandResult[dict]
```

Selects a page by index for subsequent commands. Index from `cdp_list_pages()`.

### cdp_new_page()

```python
async def cdp_new_page(url: str | None = None) -> CommandResult[dict]
```

Opens a new page/tab, optionally navigating to a URL.

**Return data:** `created` (bool), `url`, `pages_count`

### cdp_close_page()

```python
async def cdp_close_page(index: int = 0) -> CommandResult[dict]
```

Closes a page by index. Cannot close the last remaining page.

**Return data:** `closed` (index), `remaining` (count)

### cdp_resize()

```python
async def cdp_resize(width: int, height: int) -> CommandResult[dict]
```

Resizes the browser viewport to specified dimensions.

**Return data:** `width`, `height`, `resized` (bool)

## Multi-Page Workflow

```
1. cdp_launch(url="https://app.example.com")
2. cdp_new_page(url="https://admin.example.com")   — open admin in tab 2
3. cdp_list_pages()                                  — see both tabs
4. cdp_select_page(1)                                — switch to admin tab
5. ... interact with admin ...
6. cdp_select_page(0)                                — switch back to app
7. ... interact with app ...
8. cdp_close_page(1)                                 — close admin tab
```

## Form Filling Strategy

### Simple Forms

Use `cdp_fill_form()` for straightforward input fields:

```python
cdp_fill_form({"#name": "Alice", "#email": "alice@test.com"})
cdp_click("#submit")
```

### Complex Forms

For forms with dynamic behavior, fill fields individually with waits:

```
1. cdp_fill("#country", "US")
2. cdp_wait(selector="#state")         — state dropdown loads after country
3. cdp_fill("#state", "CA")
4. cdp_wait(selector="#city")          — city loads after state
5. cdp_fill("#city", "San Francisco")
```

### Forms with File Uploads

```
1. cdp_fill_form({"#name": "Report", "#description": "Monthly"})
2. cdp_upload("#file-input", "/path/to/report.pdf")
3. cdp_click("#submit")
```
