---
name: build-stories
source: botcore
description: >
  Guides creation of Storybook 10 stories using CSF3 format, Custom Elements Manifest (CEM) integration, play function interaction tests, visual testing, and accessibility checks for web components. Covers story file structure, naming conventions, autodocs configuration, addon-vitest headless test loops, addon-a11y, coverage reporting, and shadow DOM assertion patterns. Use when writing stories, adding interaction tests to stories, configuring Storybook for web components, debugging play functions, or setting up story-based visual and accessibility testing. Triggers: storybook, story, stories, csf3, cem, custom elements manifest, play function, interaction test, visual testing, addon-vitest, autodocs.

version: 1.0.0
triggers:
  - storybook
  - story
  - stories
  - csf3
  - cem
  - custom elements manifest
  - play function
  - interaction test
  - visual testing
  - addon-vitest
  - autodocs
portable: true
---

# Building Stories

Storybook 10 story authoring with CSF3, Custom Elements Manifest autodocs, play function interaction tests, and headless visual testing for web components.

## Capabilities

1. **CSF3 story authoring** -- Write Component Story Format 3 stories for web components using the `@storybook/web-components` framework
2. **Custom Elements Manifest (CEM)** -- Generate and use `custom-elements.json` for automatic prop tables and autodocs
3. **Play function testing** -- Turn stories into executable interaction tests using `storybook/test` utilities
4. **Headless story tests** -- Run story play functions headlessly via Vitest browser mode with addon-vitest
5. **Accessibility testing** -- Validate WCAG compliance within Storybook using addon-a11y
6. **Coverage reporting** -- Generate code coverage from story tests via Vitest v8 provider
7. **Shadow DOM assertions** -- Test web components with encapsulated shadow roots using correct query patterns

## Routing Logic

| Request type | Load reference |
| --- | --- |
| CSF3 meta, render functions, args, argTypes | [references/csf3-patterns.md](references/csf3-patterns.md) |
| Play functions, assertions, userEvent, shadow DOM queries | [references/play-functions.md](references/play-functions.md) |
| Storybook configuration, addons, CEM setup | [references/configuration.md](references/configuration.md) |

## Core Principles

### 1. Every component gets a story

Each component should have a co-located `*.stories.ts` file. Stories serve triple duty: visual documentation, interactive examples, and automated tests via play functions.

### 2. CSF3 is the only format

All stories use Component Story Format 3. Each file exports a default `meta` object and named story exports. The `satisfies Meta` pattern provides type safety.

```ts
import type { Meta, StoryObj } from "@storybook/web-components";

const meta = { /* ... */ } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { /* ... */ } };
```

### 3. Play functions are tests

Every story should include a `play` function with `expect` assertions. Play functions run in the browser -- both interactively in Storybook UI and headlessly via `npm run test:stories`.

### 4. Shadow DOM requires direct queries

Testing Library's `within()` and `getByRole()` cannot pierce shadow boundaries. Always use `el?.shadowRoot?.querySelector()` for web components. This is the single most common mistake in story tests.

### 5. CEM drives autodocs

The Custom Elements Manifest (`custom-elements.json`) provides prop tables, slot documentation, and event listings in autodocs pages. Always regenerate CEM after changing component APIs.

## Workflow

### Writing a new story

1. Create `{component-name}.stories.ts` next to the component source
2. Import the component side-effect style (`import "./my-element.js"`)
3. Define meta with `title`, `component` (tag name string), and `tags: ["autodocs"]`
4. Add `parameters.docs.description.component` for the autodocs page
5. Write a `render` function using `html` tagged template from `lit`
6. Export named stories with `args` and `play` functions
7. Run `npm run test:stories` to verify play functions pass

### Testing loop

```bash
# 1. Generate/update Custom Elements Manifest
npm run cem:analyze

# 2. Start Storybook for interactive development
npm run storybook

# 3. Run story tests headlessly (fast CI feedback)
npm run test:stories

# 4. Generate coverage report
npx vitest run --config vitest.storybook.config.ts --coverage
```

Story tests run as part of pre-push hooks and CI checks.

### Quick story template

```ts
import type { Meta, StoryObj } from "@storybook/web-components";
import { html } from "lit";
import { expect, userEvent } from "storybook/test";

import "./my-element.js";

const meta = {
  title: "Category/My Element",
  component: "my-element",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: "Brief description of the component.",
      },
    },
  },
  render: (args) => html`<my-element .title=${args.title}></my-element>`,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "Hello" },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("my-element");
    await expect(el).toBeTruthy();

    const heading = el?.shadowRoot?.querySelector("h2");
    await expect(heading?.textContent).toContain("Hello");
  },
};
```

See [references/csf3-patterns.md](references/csf3-patterns.md) for full patterns including argTypes, decorators, and multi-variant stories.

### Play function quick reference

```ts
import { expect, userEvent, fn, within } from "storybook/test";

// Verify element renders
const el = canvasElement.querySelector("my-element");
await expect(el).toBeTruthy();

// Check shadow DOM content
const label = el?.shadowRoot?.querySelector(".label");
await expect(label?.textContent).toContain("Expected text");

// Click and verify state change
const button = el?.shadowRoot?.querySelector("button") as HTMLElement;
await userEvent.click(button);
const updated = el?.shadowRoot?.querySelector(".active");
await expect(updated).toBeTruthy();
```

See [references/play-functions.md](references/play-functions.md) for complete assertion patterns, event simulation, and anti-patterns.

## Checklist

- [ ] Story file is co-located with the component (`*.stories.ts`)
- [ ] Meta uses `satisfies Meta` for type safety
- [ ] `component` field is the custom element tag name (string)
- [ ] `tags: ["autodocs"]` is set for documentation generation
- [ ] `parameters.docs.description.component` provides a description
- [ ] Every exported story has a `play` function with `expect` assertions
- [ ] Shadow DOM is queried via `shadowRoot?.querySelector()`, not Testing Library
- [ ] `npm run test:stories` passes with no failures
- [ ] CEM is regenerated after API changes (`npm run cem:analyze`)
- [ ] Imports use `storybook/test` (not `@testing-library/dom` directly)
- [ ] Async renders (icons, lazy content) include appropriate waits before assertions

## When to Escalate

- Play functions pass in Storybook UI but fail headlessly (check timing, async rendering, or browser-specific APIs)
- CEM does not pick up new properties or events (verify JSDoc placement is above the decorator, not between decorator and class)
- Autodocs page is blank despite `tags: ["autodocs"]` (ensure `@storybook/addon-docs` is in `.storybook/main.ts` addons)
- Shadow DOM structure changes after a web component library upgrade (update all `shadowRoot?.querySelector` selectors)
- Testing Library queries silently return null instead of finding shadow DOM elements (switch to direct `shadowRoot` queries)
- Story tests are flaky due to async icon loading or animation timing
