# Storybook Configuration for Web Components

Reference for Storybook 10 setup, addons, CEM integration, and headless testing configuration.

## Framework Setup

Storybook for web components uses the `@storybook/web-components-vite` framework:

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/web-components-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  framework: "@storybook/web-components-vite",
  addons: [
    "@storybook/addon-docs",     // Required for autodocs
    "@storybook/addon-a11y",     // Accessibility panel
    "@storybook/addon-vitest",   // Headless story tests
  ],
};

export default config;
```

### Critical addon notes

- **`@storybook/addon-docs` must be explicitly listed.** Without it, the Docs tab renders blank even when stories have `tags: ["autodocs"]`.
- **Addon order matters.** List `addon-docs` before other addons that depend on documentation features.

## Custom Elements Manifest (CEM)

CEM provides automatic prop tables, slot documentation, and event listings in Storybook autodocs.

### Generation

```bash
npm run cem:analyze
```

This produces `custom-elements.json` at the project root. Regenerate after any component API changes (new properties, events, slots, or CSS custom properties).

### How CEM feeds Storybook

Storybook reads `custom-elements.json` to:
- Populate the **Args Table** on autodocs pages with property names, types, defaults, and descriptions
- List **slots**, **events**, and **CSS custom properties**
- Generate **controls** automatically based on property types

### JSDoc placement for CEM

JSDoc comments must be placed **above the decorator**, not between the decorator and the class:

```ts
// CORRECT -- JSDoc above decorator
/**
 * A card component that displays content in a contained layout.
 *
 * @slot header - Card header content
 * @slot - Default slot for card body
 * @fires change - Fired when card selection changes
 * @csspart container - The outer card container
 * @cssprop --card-padding - Internal padding
 */
@customElement("my-card")
export class MyCard extends FASTElement {
  /** The card title displayed in the header */
  @attr title: string = "";
}
```

```ts
// WRONG -- JSDoc between decorator and class (CEM won't pick it up)
@customElement("my-card")
/**
 * This description will NOT appear in CEM output.
 */
export class MyCard extends FASTElement {}
```

## Headless Story Testing

### Vitest configuration

Story tests run via Vitest in browser mode using `vitest.storybook.config.ts`:

```ts
// vitest.storybook.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      name: "chromium",
      provider: "playwright",
    },
    coverage: {
      provider: "v8",
    },
  },
});
```

### Commands

```bash
# Run all story tests headlessly
npm run test:stories

# Run with coverage
npx vitest run --config vitest.storybook.config.ts --coverage

# Run specific story file tests
npx vitest run --config vitest.storybook.config.ts src/components/my-element/my-element.stories.ts
```

### CI integration

Story tests typically gate on:
- **Pre-push hooks** (e.g., Lefthook `test-stories` task)
- **CI pipeline** as part of `npm run check` or equivalent

## Accessibility Testing with addon-a11y

### In Storybook UI

1. Open the test widget in the sidebar
2. Check the **Accessibility** checkbox
3. Run tests -- violations appear in the Accessibility panel

### In headless mode

addon-a11y rules run automatically during `npm run test:stories` when configured. Violations are reported as test failures.

### Scoping

To test accessibility of a specific component, use the Storybook UI's component-level Accessibility panel rather than page-level scans.

## Coverage Reporting

### In Storybook UI

1. Expand the test widget sidebar
2. Check **Coverage**
3. Run tests -- coverage report is generated

### CLI

```bash
npx vitest run --config vitest.storybook.config.ts --coverage
```

Coverage uses the v8 provider configured in `vitest.storybook.config.ts`.

## Agent Discovery

When agents need to inspect component metadata programmatically:

- **CEM data:** Read `custom-elements.json` directly or use a CEM-reading MCP tool
- **Storybook MCP:** When Storybook is running, an MCP endpoint is available at `http://localhost:6006/mcp` for story discovery and interaction

## Guardrails

### Framework boundary

- Component source files must use the project's component framework (e.g., FAST Element, native Web Components)
- **Lit is allowed only in `*.stories.ts`** for Storybook render templates
- Git hooks or linters should flag `from 'lit'` imports in non-story source files

### File co-location

Stories live next to their component source:

```
src/components/my-element/
  my-element.ts           # Component source
  my-element.styles.ts    # Styles
  my-element.stories.ts   # Stories (Lit allowed here)
  my-element.test.ts      # Unit tests (optional)
```
