# Keyboard / Tab Order Spec Review

Deep-dive specialist for reviewing keyboard/tab-order annotation layers in design specs.

## Core Review Checklist

### Tab stops and focus order
- Every interactive element has a numbered tab stop annotation.
- Tab order follows logical reading flow (left-to-right, top-to-bottom within groups).
- Focus order matches logical grouping of related controls.
- No skipped or unreachable interactive elements.
- No surprising or disorienting focus jumps.

### Key interactions per stop
- Key interactions specified per tab stop, matching the APG pattern for the widget type.
- Composite widgets (tablists, toolbars, menubars, radio groups, grids) use a single Tab stop with arrow-key navigation.
- Long lists include Home, End, Page Up, Page Down where appropriate.

### Mode activation and shortcuts
- Mode-activation shortcuts document: shortcut key, focus on entry, how to exit, fallback for conflicts.
- Keyboard shortcuts for secondary or destructive actions are specified.

### State transitions and dynamic content
- Both collapsed and expanded states documented for popups/disclosures.
- Focus destination after dynamic changes (add, remove, reorder, delete) specified.
- Focus behavior defined for dialogs, popovers, menus (initial focus, trap, restoration).
- Error states specify where focus moves when errors appear.

## Supplemental Checks
- Disabled state behavior (disabled controls stay focusable, annotated in both states).
- Extended keyboarding (grid navigation, multi-select equivalents).
- Focus indicator styling meets WCAG 2.2 focus appearance requirements.
- Scrollbar keyboard navigation behavior.
- Clearing/resetting state shortcuts.

## Common Mistakes
- Only one state shown without the other (collapsed vs expanded, enabled vs disabled).
- Individual tab stops on items that should be a single roving-tabindex composite widget.
- Tab order specified without focus management details.
- Overusing positive `tabindex` values instead of native order + roving patterns.
- Complex widget keyboard behavior left unspecified for engineers.
- Missing escape routes (Escape key, close buttons, cancel flows).
- Undocumented focus destination after dynamic content changes.
