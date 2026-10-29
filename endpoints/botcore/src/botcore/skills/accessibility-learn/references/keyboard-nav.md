# Keyboard Navigation Patterns

Common keyboard patterns for interactive components and focus management.

## Standard Keys

| Key | Action |
|-----|--------|
| Tab | Move to next focusable element |
| Shift+Tab | Move to previous focusable element |
| Enter | Activate button or link |
| Space | Activate button, toggle checkbox |
| Escape | Close modal, menu, or popup |
| Arrow keys | Navigate within a composite widget |
| Home | Jump to first item |
| End | Jump to last item |

## Key WCAG Criteria

- **2.1.1 Keyboard** -- All functionality must be operable via keyboard.
- **2.1.2 No Keyboard Trap** -- Keyboard focus must not become trapped without an escape route.
- **2.4.3 Focus Order** -- Focus sequence must be logical and predictable.
- **2.4.7 Focus Visible** -- Keyboard focus indicator must be visible.
- **2.4.11 Focus Not Obscured (Minimum)** -- Focused element must not be entirely hidden.
- **3.2.1 On Focus** -- Receiving focus must not trigger unexpected context changes.

## Component Patterns

### Button
```typescript
handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    this.activate();
  }
}
```

### Menu
```typescript
handleKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      this.focusNext();
      break;
    case 'ArrowUp':
      e.preventDefault();
      this.focusPrevious();
      break;
    case 'Home':
      e.preventDefault();
      this.focusFirst();
      break;
    case 'End':
      e.preventDefault();
      this.focusLast();
      break;
    case 'Escape':
      this.close();
      break;
  }
}
```

### Modal / Dialog -- Focus Trapping
```typescript
class Modal {
  private focusableElements: HTMLElement[];

  open() {
    this.focusableElements = this.getFocusableElements();
    this.addEventListener('keydown', this.handleKeydown);
    this.focusFirst();
  }

  handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      this.trapFocus(e);
    }
  }

  trapFocus(e: KeyboardEvent) {
    const first = this.focusableElements[0];
    const last = this.focusableElements[this.focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
```

### Tabs -- Arrow Key Navigation
```typescript
handleKeydown(e: KeyboardEvent) {
  const tabs = this.getTabs();
  const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      const prev = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
      tabs[prev].focus();
      this.selectTab(prev);
      break;
    case 'ArrowRight':
      e.preventDefault();
      const next = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
      tabs[next].focus();
      this.selectTab(next);
      break;
  }
}
```

## Focus Management

```typescript
// Restore focus after action
const previousFocus = document.activeElement as HTMLElement;
this.doAction();
previousFocus?.focus();

// Set focus and scroll into view
this.myElement.focus();
this.myElement.scrollIntoView({ block: 'nearest' });
```

## Common Mistakes

- Assuming "keyboard support" only means Tab/Shift+Tab, forgetting Enter/Space, arrow keys, and Escape.
- Using `tabindex` values greater than 0 instead of a predictable, maintainable focus model.
- Omitting visible focus indicator requirements (contrast, not clipped).
- Trapping focus without a clear escape route and explicit focus restoration rules.
- Changing focus order based on visuals without ensuring DOM order is logical.
