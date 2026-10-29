# Speech Recognition Accessibility Review

Evaluate control naming, layout, and interaction patterns for users operating the interface through voice commands.

## Scope

- Control naming and discoverability for voice commands.
- Sequences that may be difficult to operate by voice alone.
- Potential conflicts between on-screen text and what speech tools expect.

## Key WCAG Criteria

- **2.5.3 Label in Name** -- The accessible name of controls must contain the visible label text (so "Click [Submit]" works).
- **4.1.2 Name, Role, Value** -- All controls must expose a discoverable accessible name.
- **2.1.1 Keyboard** -- Speech tools use keyboard simulation, so keyboard operability is a prerequisite.
- **2.5.1 Pointer Gestures** -- Complex gestures need single-action alternatives that speech tools can invoke.

## What to Check

- Do accessible names match visible labels so voice users can say what they see?
- Do all controls have unique, discoverable spoken names?
- Are there alternatives to drag, multi-step gestures, or precise pointer actions?
- Do dynamically changing labels keep the accessible name stable and discoverable?

## Common Mistakes

- Using programmatic names that don't match visible labels.
- Building icon-only or ambiguous controls with no clear spoken name.
- Requiring drag or complex gestures without a command-based alternative.
- Changing control labels dynamically without keeping the accessible name stable.
