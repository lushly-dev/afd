# Breadcrumb Navigation Accessibility

Review breadcrumb navigation for accessible labeling, hierarchy, and current location indication.

## Best Practices

### Semantics
- Wrap in `<nav aria-label="Breadcrumb">`.
- Use an ordered list (`<ol>`) with list items.
- Mark the current page with `aria-current="page"` (render as plain text, not a link).

### Labels and clarity
- Use clear, concise labels.
- If labels are truncated visually, ensure full label is available to assistive tech.

### Separators and icons
- Treat separators as decorative (`aria-hidden="true"`).

### Responsive behavior
- If breadcrumbs are collapsed on small screens, keep at minimum Home + current page.
- Provide a predictable alternative (e.g., "Back" link) when shortened.

## Common Mistakes
- Omitting a `nav` label for the breadcrumb region.
- Not indicating the current page (`aria-current="page"`).
- Icons or separators that become noisy for screen readers.
- Making the current page a link when it should be a plain indicator.

## Example
```html
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/home">Home</a></li>
    <li><a href="/reports">Reports</a></li>
    <li aria-current="page">Q1 summary</li>
  </ol>
</nav>
```
