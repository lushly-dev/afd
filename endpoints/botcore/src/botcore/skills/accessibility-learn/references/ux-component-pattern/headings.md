# Headings and Structure Accessibility

Review heading structure and page organization for clear hierarchy and assistive technology compatibility.

## Best Practices

### Use headings to encode structure
- Represent information hierarchy, not just visual styling.
- Keep heading text descriptive and scannable.

### Maintain a logical outline
- Don't skip levels (e.g., H2 directly to H4) for visual sizing.
- Use consistent patterns across similar pages/dialogs.

### Combine with landmarks and regions
- Pair headings with semantic regions (`<main>`, `<nav>`, `<aside>`, labeled `<section>`).

### Dialogs and panels
- Ensure dialogs and major panels have a clear title heading.
- Avoid conflicting multiple H1 elements unless the design system supports it.

## Common Mistakes
- Using headings purely for styling or skipping levels.
- Multiple competing top-level headings without clear structure.
- Bold text or large text instead of proper heading elements.
- Sections with no headings, making long pages hard to navigate.

## Example
```html
<h1>Workspace settings</h1>
<h2>Networking</h2>
<h3>Outbound access</h3>
<h2>Notifications</h2>
```
