# Keyboard Accessibility Review

Evaluate keyboard-only operability including tab order, focus management, keyboard shortcuts, and visible focus indicators.

## Scope

- Tab order and logical navigation.
- Focus trapping and restoration.
- Keyboard shortcuts and activation behavior.
- Visible focus indicators.

## Key WCAG Criteria

- **2.1.1 Keyboard** -- All functionality must be operable via keyboard.
- **2.1.2 No Keyboard Trap** -- Keyboard focus must not become trapped.
- **2.4.3 Focus Order** -- Focus sequence must be logical and predictable.
- **2.4.7 Focus Visible** -- Keyboard focus indicator must be visible.
- **2.4.11 Focus Not Obscured (Minimum)** -- Focused element must not be entirely hidden.
- **3.2.1 On Focus** -- Receiving focus must not trigger unexpected context changes.

## What to Check

- Can every interactive element be reached and activated with keyboard alone?
- Does the tab order follow a logical sequence matching the visual layout?
- Are focus indicators visible with sufficient contrast (3:1)?
- Do modals and popups trap focus appropriately and restore it on close?
- Are there any keyboard traps with no escape route?

## Common Mistakes

- Assuming "keyboard support" only means Tab/Shift+Tab, forgetting Enter/Space, arrows, and Escape.
- Using `tabindex` values greater than 0 instead of a predictable focus model.
- Omitting visible focus requirements (indicator strength, contrast, not clipped).
- Trapping focus without a clear escape route and explicit focus restoration.
