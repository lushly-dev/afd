# Play Function Patterns

Complete reference for writing play function interaction tests in Storybook stories for web components.

## Overview

Play functions turn stories into executable tests. They run in two modes:
- **Interactive:** In the Storybook UI Interactions panel (click "Interactions" tab)
- **Headless:** Via `npm run test:stories` using addon-vitest in browser mode

## Imports

All test utilities come from `storybook/test`:

```ts
import { expect, userEvent, fn, within } from "storybook/test";
```

| Utility | Purpose |
| --- | --- |
| `expect` | Jest-compatible assertions (`toBeTruthy`, `toBe`, `toContain`, etc.) |
| `userEvent` | Simulate user interactions (`click`, `type`, `keyboard`, `hover`) |
| `fn` | Create mock/spy functions for event handlers |
| `within` | Scoped queries via Testing Library (`getByRole`, `getByText`) |

**Important:** Import from `storybook/test`, not from `@testing-library/dom` or `vitest` directly.

## Basic Assertion Patterns

### Verify element renders

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-element");
  await expect(el).toBeTruthy();
},
```

### Check shadow DOM content

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-element");
  await expect(el).toBeTruthy();

  const label = el?.shadowRoot?.querySelector(".label");
  await expect(label?.textContent).toContain("Expected text");
},
```

### Verify child count

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-element");
  const items = el?.shadowRoot?.querySelectorAll(".item");
  await expect(items?.length).toBe(3);
},
```

### Check attribute values

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-element");
  await expect(el?.getAttribute("aria-label")).toBe("Close dialog");
},
```

## User Interaction Patterns

### Click

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-element");
  const button = el?.shadowRoot?.querySelector("button") as HTMLElement;
  await userEvent.click(button);

  const updated = el?.shadowRoot?.querySelector(".active");
  await expect(updated).toBeTruthy();
},
```

### Type text

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-input");
  const input = el?.shadowRoot?.querySelector("input") as HTMLElement;
  await userEvent.type(input, "Hello World");

  await expect((input as HTMLInputElement).value).toBe("Hello World");
},
```

### Keyboard navigation

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-element");
  const firstItem = el?.shadowRoot?.querySelector(".item") as HTMLElement;
  firstItem.focus();

  await userEvent.keyboard("{ArrowDown}");
  const focused = el?.shadowRoot?.querySelector(".item:focus");
  await expect(focused?.textContent).toContain("Second item");
},
```

### Hover

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-tooltip-trigger");
  await userEvent.hover(el as HTMLElement);

  // Wait for tooltip to appear
  await new Promise((r) => setTimeout(r, 200));
  const tooltip = document.querySelector("my-tooltip");
  await expect(tooltip).toBeTruthy();
},
```

## Mock / Spy Functions

Use `fn()` to create spies for event handlers:

```ts
const meta = {
  // ...
  args: {
    onChange: fn(),
  },
} satisfies Meta;

export const FiresEvent: Story = {
  play: async ({ canvasElement, args }) => {
    const el = canvasElement.querySelector("my-select");
    const option = el?.shadowRoot?.querySelector(".option") as HTMLElement;
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledTimes(1);
  },
};
```

## Toggle / Sort Verification

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-data-grid");
  const sortButton = el?.shadowRoot?.querySelector(
    ".sort-header"
  ) as HTMLElement;

  await userEvent.click(sortButton);
  const ascending = el?.shadowRoot?.querySelector('[aria-sort="ascending"]');
  await expect(ascending).toBeTruthy();

  await userEvent.click(sortButton);
  const descending = el?.shadowRoot?.querySelector('[aria-sort="descending"]');
  await expect(descending).toBeTruthy();
},
```

## Handling Async Rendering

Some components load content asynchronously (icons, lazy-loaded data). Add explicit waits:

```ts
play: async ({ canvasElement }) => {
  const el = canvasElement.querySelector("my-icon-button");
  await expect(el).toBeTruthy();

  // Wait for async icon SVG to load
  await new Promise((r) => setTimeout(r, 200));

  const svg = el?.shadowRoot?.querySelector("svg");
  await expect(svg).toBeTruthy();
},
```

**Guideline:** Use short timeouts (100-300ms) only when necessary for genuinely async operations. Avoid arbitrary waits for synchronous rendering.

## Anti-Patterns

### Do NOT throw errors instead of using expect

```ts
// BAD -- old pattern
if (!el) throw new Error("Expected element");

// GOOD -- use expect
await expect(el).toBeTruthy();
```

### Do NOT use Testing Library queries for shadow DOM

```ts
// BAD -- Testing Library cannot pierce shadow boundaries
const canvas = within(canvasElement);
const button = canvas.getByRole("button");

// GOOD -- use shadowRoot.querySelector
const el = canvasElement.querySelector("my-button");
const button = el?.shadowRoot?.querySelector("button");
```

### Do NOT import from wrong packages

```ts
// BAD -- wrong import source
import { expect } from "vitest";
import { userEvent } from "@testing-library/user-event";

// GOOD -- single import source
import { expect, userEvent } from "storybook/test";
```

### Do NOT skip the play function

```ts
// BAD -- story with no test coverage
export const Default: Story = {
  args: { title: "Hello" },
};

// GOOD -- every story verifies its rendering
export const Default: Story = {
  args: { title: "Hello" },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("my-element");
    await expect(el).toBeTruthy();
  },
};
```

## Shadow DOM: The Key Limitation

Testing Library's `within()`, `getByRole()`, `getByText()`, and similar queries **cannot pierce shadow DOM boundaries**. This is the most common source of bugs in web component story tests.

**Always use this pattern:**

```ts
// 1. Find the host element on the light DOM
const el = canvasElement.querySelector("my-element");

// 2. Traverse into shadow root
const inner = el?.shadowRoot?.querySelector(".target");

// 3. For nested web components, chain shadow root access
const nested = el?.shadowRoot
  ?.querySelector("my-inner-component")
  ?.shadowRoot?.querySelector(".deep-target");
```

`within()` is only useful for querying light DOM content (e.g., slotted content or non-shadow-DOM containers).
