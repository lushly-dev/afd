# Error State Accessibility

Review error states and recovery flows for clear communication and accessible interaction.

## Best Practices

### Message content
- Use clear, specific error messages: what went wrong + how to fix it.
- Avoid blaming language; keep tone neutral and actionable.

### Programmatic association
- Field-level errors: associate via `aria-describedby` (or `aria-errormessage`).
- Mark invalid fields with `aria-invalid="true"`.

### Announcement strategy
- On submit-time validation: error summary near the top with `role="alert"` or focus to the summary.
- For inline real-time validation: use polite updates, avoid interrupting typing.

### Visual design
- Don't rely on color alone; pair with text and optionally an icon.
- Ensure error text meets contrast requirements.

### Recovery and persistence
- Preserve user input when showing errors.
- Keep error visible until resolved.

## Common Mistakes
- Indicating errors only with color, icons, or placement.
- Not associating errors with the relevant field.
- Not defining how errors are announced dynamically.
- Clearing user input on error.

## Example
```html
<label for="email">Email</label>
<input id="email" aria-describedby="email-error" aria-invalid="true" />
<p id="email-error">Enter an email address in the format name@example.com.</p>

<!-- Error summary for submit-time validation -->
<div role="alert" aria-label="There are 2 errors">
  <p>Please fix the following:</p>
  <ul>
    <li><a href="#email">Email: enter a valid email address.</a></li>
  </ul>
</div>
```
