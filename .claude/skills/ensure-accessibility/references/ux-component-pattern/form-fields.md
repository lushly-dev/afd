# Form Field Accessibility

Review form fields for labels, grouping, validation, and error messaging accessibility.

## Best Practices

### Labels and names
- Provide a visible `<label>` for each input and associate via `for`/`id`.
- Don't use placeholder text as the only label.

### Instructions and help text
- Put requirements and constraints before the field.
- Associate help text with `aria-describedby`.

### Required and optional
- Indicate required fields with text (not color alone).
- Use native `required` where appropriate; keep `aria-required` aligned.

### Grouping
- Use `<fieldset>`/`<legend>` for radio/checkbox groups.

### Input types and autocomplete
- Use correct input types (`email`, `tel`, `number`) and `autocomplete` tokens.

### Validation and errors
- Use `aria-invalid` and associate error messages to the correct field.
- Ensure error messaging is announced and persistent.

## Common Mistakes
- Placeholder-only labels.
- No group labels for radio/checkbox groups.
- Required fields marked only with color/asterisks.
- Validation errors not programmatically associated or announced.

## Example
```html
<label for="name">Display name <span aria-hidden="true">(required)</span></label>
<input id="name" required aria-required="true" aria-describedby="name-help" />
<p id="name-help">Use the name shown to other users.</p>

<fieldset>
  <legend>Notification frequency</legend>
  <label><input type="radio" name="freq" value="daily" /> Daily</label>
  <label><input type="radio" name="freq" value="weekly" /> Weekly</label>
</fieldset>
```
