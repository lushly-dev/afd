# Accessibility Annotations / Spec Review

Parse and validate accessibility annotation layers in design specs: keyboard/tab order and screen reader labels.

## Purpose

This file is the entry point for reviewing accessibility specs. It provides instructions for parsing visual annotation conventions and validates the two required layers (keyboard and screen reader). For deep dives into each layer, see the specialized references below.

## Required Layers

### 1. Keyboard / Tab Order

May be titled "Keyboard navigation", "Keyboard", or "Keyboarding / Tab order". For the full checklist, see `keyboard-tab-order-spec-review.md`. At a high level, confirm:

- Every interactive element has a numbered tab stop in logical reading order.
- Key interactions are specified per stop and match the APG pattern for the widget type.
- Composite widgets use a single Tab stop with arrow-key navigation.
- Both states are documented for controls with popups or disclosures.
- Focus destination after dynamic changes is specified.

### 2. Screen Reader Labels

May be titled "Accessibility annotations", "Screenreader", or "Screen-reader labels". For the full checklist, see `screen-reader-annotations-spec-review.md`. At a high level, confirm:

- Every annotated element has an accessible name matching the visible label or a meaningful equivalent.
- Roles match the widget's actual behavior per APG.
- State annotations are present for any control that changes state.
- Grouped controls document their relationship.
- Overlays annotate both the trigger and overlay contents.

## Annotation Visual Conventions

Common visual markers in design specs:

- **Numbered markers** -- Purple/pink circles or magenta diamonds marking tab stops or annotation points in sequential order.
- **Key badges** -- Purple rectangles with key names (Space, Enter, Esc, Tab, Arrow keys).
- **Action labels** -- Short descriptions near key badges.
- **Arrow span indicators** -- Arrows showing arrow-key navigation range (roving tabindex).
- **Side-by-side state pairs** -- Two states showing focus/annotation behavior across interaction lifecycle.

## Common Mistakes

- Inconsistent numbering within a layer or ambiguous numbering across visual regions.
- Showing only one state without documenting the other (collapsed vs expanded, enabled vs disabled).
- Missing focus management details (initial focus, trap rules, restoration on close).
