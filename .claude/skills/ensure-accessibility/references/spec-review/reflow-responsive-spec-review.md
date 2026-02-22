# Reflow and Responsive Behavior Spec Review

Review responsive layout and reflow specifications for accessibility risks at high zoom levels and varying viewport sizes.

## Scope
- Behavior at high zoom levels (200-400%) including scrolling directions and content clipping.
- Preservation of reading order and relationships between labels, inputs, and messages.
- Behavior of complex regions (tables, cards, multi-column layouts) as they stack or collapse.

## Key WCAG Criteria
- **1.4.4 Resize Text** -- Text resizable to 200% without loss of content.
- **1.4.10 Reflow** -- Content reflows to single column at 320 CSS px (400% zoom) without horizontal scrolling.
- **1.4.12 Text Spacing** -- Content tolerates increased spacing.

## What to Check
- Does the spec define behavior at 200% and 400% zoom?
- Are breakpoints specified with stacking rules and reading order?
- Are fixed pixel sizes avoided in favor of flexible units?
- Do errors and help text remain connected to their fields during reflow?

## Common Mistakes
- Omitting explicit behavior at 200-400% zoom.
- Defining breakpoints visually but not specifying reading order and relationship preservation.
- Fixed pixel sizes that break with text resizing or localization.
- Errors/help text disconnected from fields during reflow.
