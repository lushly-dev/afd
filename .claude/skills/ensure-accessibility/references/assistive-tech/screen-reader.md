# Screen Reader Accessibility Review

Evaluate how screen reader users perceive, navigate, and operate an experience.

## Scope

- Focus order and logical navigation.
- Roles, names, states, and relationships.
- Announcement timing and verbosity.
- Error, status, and help messaging.

## Key WCAG Criteria

- **1.1.1 Non-text Content** -- Images, icons, and controls need text alternatives.
- **1.3.1 Info and Relationships** -- Structure (headings, lists, tables, form groups) must be programmatically determinable.
- **1.3.2 Meaningful Sequence** -- Reading/navigation order must match visual intent.
- **2.4.3 Focus Order** -- Focus sequence must be logical and operable.
- **2.4.6 Headings and Labels** -- Descriptive headings and labels for orientation.
- **4.1.2 Name, Role, Value** -- All controls must expose accessible name, role, and state.
- **4.1.3 Status Messages** -- Status changes must be programmatically available without receiving focus.

## What to Check

- Do all interactive controls have accessible names that match their purpose?
- Are headings, lists, and tables used semantically (not just for visual styling)?
- Is the reading order logical when navigating linearly?
- Are errors, validation, and async updates announced via live regions or focus movement?
- Are decorative elements hidden from the accessibility tree?

## Common Mistakes

- Treating visible labels as sufficient without confirming a correct accessible name.
- Overusing ARIA or adding roles that conflict with native semantics, creating confusing or duplicate announcements.
- Failing to define how errors, validation, and async updates are announced.
- Designing focus order based on visuals without ensuring DOM/reading order is logical.
