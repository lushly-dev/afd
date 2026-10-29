# Tooltip Accessibility

Review tooltips for accessible triggering, content, timing, and compatibility with keyboard and screen reader users.

## Best Practices

### Choose the right pattern
- Use tooltips for short, non-interactive supplemental text only.
- If the content is interactive or longer than a sentence, use a popover/dialog instead.

### Triggering and dismissal
- Must appear on hover AND keyboard focus of the trigger.
- Should dismiss on blur, Escape, or when focus moves away.
- Use reasonable show/hide delays to avoid flicker.

### Screen reader support
- Use `aria-describedby` on the trigger pointing to tooltip text.
- Use `role="tooltip"` on the tooltip content.

### Touch and mobile
- Provide an alternative to hover for touch (e.g., an explicit "Info" button).

### Content guidance
- Keep text concise and specific.
- Don't use tooltips as the only way to convey required instructions.

## Common Mistakes
- Tooltips only on hover (no keyboard focus equivalent).
- Interactive controls inside tooltips.
- Using tooltip text as a substitute for a real label.
- Tooltips that persist with no dismissal or disappear too quickly.

## Example
```html
<button type="button" aria-describedby="tip-privacy">i</button>
<div id="tip-privacy" role="tooltip">We use this to personalize recommendations.</div>
```
