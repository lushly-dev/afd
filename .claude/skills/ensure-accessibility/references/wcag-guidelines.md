# WCAG 2.1+ Guidelines Quick Reference

Key WCAG 2.1 AA success criteria for web applications, with notes on WCAG 2.2 additions.

## Perceivable

### 1.1 Text Alternatives
- All images need `alt` text
- Decorative images: `alt=""`
- Complex images: link to long description
- Icon-only controls need `aria-label` or visible text

### 1.3 Adaptable
- Use semantic HTML (headings, lists, tables, form groups)
- Reading order matches visual order
- Don't rely on sensory characteristics alone

### 1.4 Distinguishable

| Requirement | Threshold |
|-------------|-----------|
| Color contrast (normal text) | 4.5:1 |
| Color contrast (large text 18px+ or bold 14px+) | 3:1 |
| Color contrast (UI components) | 3:1 |
| Focus indicator | 3:1 against adjacent |
| Don't use color alone | Add icons or text |
| Text resize | Up to 200% without loss |
| Reflow | Single column at 320px width (400% zoom) |
| Text spacing | Tolerate increased letter/word/line/paragraph spacing |

## Operable

### 2.1 Keyboard Accessible
- All functionality via keyboard
- No keyboard traps
- Shortcuts can be disabled or remapped

### 2.4 Navigable
- Skip links for main content
- Descriptive page titles
- Focus order matches visual order
- Link purpose clear from text
- Focus visible (2.4.7)
- Focus not obscured -- minimum (2.4.11, WCAG 2.2)

### 2.5 Input Modalities
- Touch/pointer targets 24x24px minimum (2.5.8, WCAG 2.2)
- Motion-based input has alternatives
- Pointer cancellation supported (up-event activation or undo)
- Label in name -- accessible name contains visible label (2.5.3)

## Understandable

### 3.1 Readable
- Page language set (`lang="en"`)
- Unusual words explained

### 3.2 Predictable
- Consistent navigation across pages
- Consistent identification of controls
- No context change on focus
- Consistent help location (3.2.6, WCAG 2.2)

### 3.3 Input Assistance
- Error messages clear and specific
- Labels for all inputs
- Error prevention for important actions (legal, financial, data)
- Redundant entry -- don't ask for same info twice (3.3.7, WCAG 2.2)
- Accessible authentication -- no cognitive function test for login (3.3.8, WCAG 2.2)

## Robust

### 4.1 Compatible
- Valid HTML
- Unique IDs
- Custom controls have name, role, value
- Status messages conveyed without focus change (4.1.3)

## WCAG Version Mapping to Laws

| Framework | WCAG Version Referenced |
|-----------|------------------------|
| ADA Title II (2024 rule) | WCAG 2.1 AA |
| Section 508 | WCAG 2.0 AA (agencies may track 2.1) |
| EN 301 549 / EAA | WCAG 2.1 AA |
| Accessible Canada Act | WCAG AA (aligning with 2.1) |

This mapping is **informational only** and does not constitute legal advice.

## Common Mistakes

- Treating WCAG mapping as a conformance claim rather than informational guidance.
- Listing criteria without explaining user impact and specific failure behavior.
- Assuming failures without evidence (e.g., calling contrast a failure without measured values).
- Focusing on criteria IDs while omitting concrete remediation steps.
