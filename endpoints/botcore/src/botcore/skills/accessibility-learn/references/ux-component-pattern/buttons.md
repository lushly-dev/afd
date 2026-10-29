# Button and Toggle Button Accessibility

Review buttons and toggles for accessible labeling, focus, states, and interaction patterns.

## Best Practices

### Use native semantics first
- Prefer `<button type="button">` for actions.
- Use `<a href>` for navigation. Don't use a button to navigate unless you also provide `href` semantics.
- Avoid adding roles/ARIA to native buttons unless implementing a specific pattern (toggle, switch).

### Accessible name and purpose
- Every button must have a discernible text label.
- For icon-only buttons, provide `aria-label` or `aria-labelledby`.
- Keep the programmatic name aligned with the visible label (important for speech input users).

### States and feedback
- **Disabled**: Use the native `disabled` attribute when truly unavailable.
- **Toggle buttons**: Use `aria-pressed="true|false"`.
- **Switch-like toggles**: Use a real checkbox, or a button with `role="switch"` and `aria-checked`.

### Keyboard and focus
- Native buttons activate with Enter and Space.
- Maintain a strong visible focus indicator that is not clipped.

### Visual and touch target considerations
- Target size at least 24x24 CSS px minimum.
- Don't use color alone to convey pressed/selected/disabled state.

## Common Mistakes
- Implementing buttons as clickable `<div>`/`<span>` without keyboard and semantic behavior.
- Icon-only buttons without an accessible name.
- Relying on color alone to convey state.
- Disabled buttons without an accessible explanation of what dependency must be resolved.

## Example
```html
<button type="button">Save</button>
<button type="button" aria-label="Close">x</button>
<button type="button" aria-pressed="true">Bold</button>
```
