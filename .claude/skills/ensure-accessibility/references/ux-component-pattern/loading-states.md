# Loading and Status Indicator Accessibility

Review loading indicators and status communication patterns for clarity, timing, and assistive technology support.

## Best Practices

### Provide meaningful status text
- Pair spinners/skeletons with a short status message (e.g., "Loading results...").
- Use consistent language for start vs completion ("Saving..." then "Saved.").

### Announcements
- Use `aria-live="polite"` for non-urgent updates.
- Use assertive announcements sparingly (critical failures only).
- Prefer a start + completion message; don't announce progress too frequently.

### Busy states
- Use `aria-busy="true"` on the region that is updating.
- If controls are disabled while busy, communicate why.

### Avoid focus disruption
- Don't move focus to loading indicators.
- Preserve focus and scroll position as content updates.

### Reduced motion
- Respect `prefers-reduced-motion` settings.
- Ensure skeletons don't create a flashing effect.

## Common Mistakes
- Spinners without text/status explaining what is happening.
- Overusing live regions, creating noisy screen reader output.
- Blocking interaction without a cancel/escape route for long operations.
- Visual-only status updates not exposed programmatically.

## Example
```html
<div aria-live="polite" id="status">Saving...</div>

<section aria-busy="true" aria-label="Results">
  <!-- content loading -->
</section>
```
