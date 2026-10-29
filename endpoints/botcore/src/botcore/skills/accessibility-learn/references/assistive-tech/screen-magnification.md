# Screen Magnification Accessibility Review

Evaluate how layouts, content, and interactions remain usable at high zoom levels and with screen magnification tools.

## Scope

- Behavior at high zoom levels (content reflow, scrolling, clipping).
- Preservation of relationships between labels, inputs, and messages.
- Visibility of key controls and status information.

## Key WCAG Criteria

- **1.4.4 Resize Text** -- Text must be resizable to 200% without loss of content or functionality.
- **1.4.10 Reflow** -- Content must reflow to a single column at 320 CSS px width (400% zoom) without horizontal scrolling.
- **1.4.12 Text Spacing** -- Content must tolerate increased letter, word, line, and paragraph spacing.
- **1.4.3 Contrast (Minimum)** -- Sufficient contrast helps users who zoom maintain readability.

## What to Check

- Does content reflow properly at 200% and 400% zoom?
- Is there unnecessary horizontal scrolling at high zoom levels?
- Are labels, inputs, and error messages still visually associated when zoomed?
- Do fixed-size containers cause clipping or overlap?

## Common Mistakes

- Using fixed heights/widths that cause clipping or hidden controls at 200-400% zoom.
- Creating unnecessary two-dimensional scrolling instead of allowing reflow.
- Relying on hover-only reveal patterns or tiny hit targets that become hard to operate under magnification.
- Separating instructions, errors, and controls so far apart that users lose context when zoomed.
