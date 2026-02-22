# Screen Reader Annotation Spec Review

Deep-dive specialist for reviewing screen-reader annotation layers in design specs.

## Core Review Checklist

### Accessible name
- Every annotated element has an accessible name.
- Name matches visible label or provides a meaningful equivalent.
- Dynamic text uses placeholder tokens for runtime values.
- Names are consistent for the same control across screens/states.

### Role
- Every annotated element has a role matching the widget's actual behavior per APG.
- Roles use valid ARIA values (e.g., dropdown = `combobox` not `button`; toggle = `switch` not `checkbox` if on/off).

### State
- Every control that changes state has state annotations.
- State values differ between side-by-side state pairs.
- Disabled controls document how they are announced.

### Helper text and value
- Positional context (e.g., "position of total") provided where helpful.
- Controls with current values (sliders, spinbuttons, progress bars) document the value and announcement.

### Relationships and grouping
- Grouped controls document their relationship (group label, role).
- Overlays annotate both trigger and overlay contents.
- Table structures document row/column headers.
- Error messages document association to the relevant field.

### Naming from external UI
- When a name comes from external UI, the source is documented.
- A default/fallback name is specified for unavailable sources.

## Supplemental Checks
- Live region announcements: text, politeness level, trigger event.
- Implementation notes: grouping patterns (`fieldset`/`legend` or `role="group"`).
- Dynamic update announcements: how additions, removals, reordering are announced.

## Common Mistakes
- Mixing up accessible name vs description.
- Roles that don't match intended widget behavior.
- Inconsistent accessible names across screens/states.
- Missing state annotations for toggles, expand/collapse, selection, disabled.
- Missing relationships (group labels, table headers, error associations).
- Not specifying how dynamic updates are announced.
- ARIA over-specification when native HTML semantics suffice.
