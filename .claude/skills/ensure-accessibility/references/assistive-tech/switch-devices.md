# Switch Device Accessibility Review

Evaluate UI structure, timing, and feedback for users who navigate and activate controls through switch devices and scanning interfaces.

## Scope

- Hierarchy and grouping of focusable elements.
- Number of steps required to reach key actions.
- Time-sensitive interactions that may conflict with scanning.

## Key WCAG Criteria

- **2.1.1 Keyboard** -- Switch devices rely on keyboard semantics, so full keyboard operability is required.
- **2.1.2 No Keyboard Trap** -- Focus traps prevent scanning from progressing.
- **2.2.1 Timing Adjustable** -- Time limits must be adjustable for slow scanning speeds.
- **2.4.3 Focus Order** -- Predictable, grouped focus order minimizes scan steps.
- **2.5.5 Target Size (Enhanced) / 2.5.8 Target Size (Minimum)** -- Larger targets reduce scanning precision demands.

## What to Check

- Are focusable elements logically grouped to minimize scan steps for core tasks?
- Are there time limits or auto-advancing UI that conflict with scanning speed?
- Is the focus order predictable and free of unexpected jumps?
- Can complex widgets (dialogs, menus) be exited with a simple switch sequence?

## Common Mistakes

- Exposing too many focusable elements, forcing excessive scan steps for core tasks.
- Introducing time limits or transient controls that conflict with scanning speed.
- Designing focus order that jumps unpredictably between regions.
- Missing an efficient way to exit complex widgets using a simple switch sequence.
