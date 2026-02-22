# ARIA Patterns

Accessible Rich Internet Applications (ARIA) roles, states, and properties.

## When to Use ARIA

> "No ARIA is better than bad ARIA."

1. Use semantic HTML first (`<button>`, `<nav>`, `<dialog>`)
2. Add ARIA only when native semantics are not sufficient
3. Ensure custom controls have proper keyboard support

## Common Roles

| Role | Use For |
|------|---------|
| `button` | Clickable non-button elements |
| `link` | Clickable non-anchor navigation |
| `dialog` | Modal windows |
| `alert` | Important messages |
| `alertdialog` | Modal with alert |
| `menu` / `menuitem` | Application menus |
| `tablist` / `tab` / `tabpanel` | Tab interfaces |
| `listbox` / `option` | Custom selects |
| `tree` / `treeitem` | Hierarchical lists |
| `checkbox` | Custom checkboxes |

## States and Properties

### aria-expanded
```html
<!-- Accordion header -->
<button aria-expanded="false" aria-controls="panel-1">
  Section 1
</button>
<div id="panel-1" hidden>Content...</div>
```

### aria-selected
```html
<!-- Tab -->
<div role="tablist">
  <button role="tab" aria-selected="true" aria-controls="panel-1">Tab 1</button>
  <button role="tab" aria-selected="false" aria-controls="panel-2">Tab 2</button>
</div>
```

### aria-pressed
```html
<!-- Toggle button -->
<button aria-pressed="false">Dark Mode</button>
```

### aria-current
```html
<!-- Current page in nav -->
<nav>
  <a href="/" aria-current="page">Home</a>
  <a href="/about">About</a>
</nav>
```

### aria-live
```html
<!-- Dynamic content announcements -->
<div aria-live="polite">
  <!-- Updates announced after user stops interacting -->
</div>

<div aria-live="assertive">
  <!-- Updates announced immediately (use sparingly) -->
</div>
```

### aria-checked
```html
<!-- Custom checkbox -->
<div role="checkbox" aria-checked="false" tabindex="0">
  Accept terms
</div>
```

## Labeling

### aria-label
```html
<!-- When visible text is not sufficient -->
<button aria-label="Close dialog">x</button>
```

### aria-labelledby
```html
<!-- Reference another element's text -->
<dialog aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Action</h2>
</dialog>
```

### aria-describedby
```html
<!-- Additional description -->
<input aria-describedby="password-hint" type="password">
<p id="password-hint">Must be at least 8 characters</p>
```

## Key WCAG Criteria

- **4.1.2 Name, Role, Value** -- All controls must expose accessible name, role, and state.
- **1.3.1 Info and Relationships** -- Structure must be programmatically determinable.
- **2.5.3 Label in Name** -- Accessible name must contain the visible label text.

## Component Examples

### Modal Dialog
```html
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-desc">
  <h2 id="dialog-title">Confirm Action</h2>
  <p id="dialog-desc">Are you sure you want to proceed?</p>
  <button>Cancel</button>
  <button>Confirm</button>
</div>
```

### Custom Checkbox
```html
<div role="checkbox" aria-checked="false" tabindex="0" onclick="toggle()" onkeydown="handleKeydown(event)">
  <span>Accept terms</span>
</div>
```

### Alert
```html
<!-- Announce to screen readers immediately -->
<div role="alert">Operation completed successfully.</div>
```

## Common Mistakes

- Adding ARIA roles that conflict with native semantics (e.g., `role="button"` on an `<a>` that should just be a link).
- Using `aria-label` when a visible label exists and should be referenced with `aria-labelledby`.
- Setting `aria-expanded` or `aria-pressed` without updating the value when state changes.
- Using `aria-live="assertive"` for non-urgent updates, causing excessive interruptions.
- Overusing ARIA to compensate for poor semantic HTML structure.
