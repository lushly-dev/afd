# Accordion and Disclosure Pattern Accessibility

Review accordion and disclosure patterns for keyboard interaction, focus behavior, and screen reader support.

## Best Practices

### Semantics and relationships
- Use a native `<button>` for the disclosure trigger.
- Use `aria-expanded="true|false"` on the trigger.
- Use `aria-controls` to point to the controlled panel.
- Give the panel `role="region"` and `aria-labelledby` pointing to the trigger.

### Keyboard behavior
- Tab/Shift+Tab moves between triggers and other focusable content.
- Enter/Space toggles the panel.
- Don't auto-focus into the panel on expand.

### Visibility and focus safety
- When collapsed, panel content must not be focusable.
- When expanded, content must be reachable and stable.

### Multi-panel behavior
- Decide whether multiple panels can be open simultaneously.
- Closing one and opening another should be predictable and not steal focus.

## Common Mistakes
- Non-button elements for disclosure triggers without correct semantics.
- Not exposing expanded/collapsed state (`aria-expanded`) or keeping it out of sync.
- Moving focus unexpectedly when expanding/collapsing.
- Leaving focusable elements reachable when the region is collapsed.

## Example
```html
<button type="button" aria-expanded="false" aria-controls="panel-details" id="btn-details">
  Details
</button>
<div id="panel-details" role="region" aria-labelledby="btn-details" hidden>
  <p>Additional settings...</p>
</div>
```
