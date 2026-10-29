# Modal Dialog Accessibility

Review modal dialogs for focus management, keyboard interaction, and screen reader behavior.

## Best Practices

### Semantics and labeling
- Use `role="dialog"` (or `role="alertdialog"` for urgent confirmations).
- Use `aria-modal="true"` when background content is truly inert.
- Provide `aria-labelledby` pointing to a visible title. Use `aria-describedby` for supporting text.

### Focus management (must-have)
- **On open**: Move focus to the dialog container, title, or first meaningful control.
- **While open**: Keep focus within the dialog (focus trap).
- **On close**: Restore focus to the trigger that opened it.
- Ensure a keyboard-operable way to dismiss (Close button and/or Escape).

### Keyboard interaction
- Tab/Shift+Tab cycles through focusable controls.
- Escape closes the dialog (for destructive confirmations, Escape should cancel).

### Background behavior
- Prevent background scroll and interaction.
- Make the rest of the page inert (`inert` attribute or equivalent).

## Common Mistakes
- Not setting initial focus meaningfully.
- Trapping focus incorrectly or not trapping when truly modal.
- Missing Escape-to-close or failing to restore focus.
- Using ARIA dialog roles incorrectly instead of starting with native `<dialog>`.

## Example
```html
<div role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc">
  <h2 id="dlg-title">Delete report?</h2>
  <p id="dlg-desc">This cannot be undone.</p>
  <button type="button">Delete</button>
  <button type="button">Cancel</button>
</div>
```
