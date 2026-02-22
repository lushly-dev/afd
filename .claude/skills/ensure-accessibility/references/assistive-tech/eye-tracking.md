# Eye Tracking Accessibility Review

Evaluate layout, target sizes, and interaction patterns for users relying on eye tracking or gaze-based input.

## Scope

- Target sizes, spacing, and placement.
- Path of gaze for common tasks.
- Interactions that may be hard to trigger or cancel using gaze.

## Key WCAG Criteria

- **2.5.5 Target Size (Enhanced) / 2.5.8 Target Size (Minimum)** -- Interactive targets must be large enough for reliable gaze selection.
- **2.5.2 Pointer Cancellation** -- Activation must support cancel/undo to prevent accidental dwell triggers.
- **2.5.1 Pointer Gestures** -- Complex gestures must have single-point alternatives.
- **2.2.1 Timing Adjustable** -- Time-limited interactions must be adjustable for slower input.

## What to Check

- Are interactive targets large enough and spaced well for gaze selection?
- Can activations be cancelled or undone to prevent accidental triggers?
- Are there alternatives to complex gestures?
- Are time-limited interactions adjustable?

## Common Mistakes

- Using small or tightly packed targets difficult to select with gaze.
- Requiring dwell activation without a cancel/undo path.
- Relying on hover-only interactions or moving targets that make selection unstable.
- Placing critical actions near screen edges demanding long, precise gaze travel.
