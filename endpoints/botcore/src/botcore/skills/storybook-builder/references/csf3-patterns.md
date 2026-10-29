# CSF3 Patterns for Web Components

Complete reference for Component Story Format 3 with `@storybook/web-components`.

## Meta Object

The meta (default export) configures the story group:

```ts
import type { Meta, StoryObj } from "@storybook/web-components";
import { html } from "lit";

import "./my-element.js"; // side-effect import registers the custom element

const meta = {
  title: "Category/My Element",
  component: "my-element",           // custom element tag name (string)
  tags: ["autodocs"],                 // enables automatic documentation page
  parameters: {
    docs: {
      description: {
        component: "A brief description shown on the autodocs page.",
      },
    },
  },
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["primary", "secondary", "outline"],
      description: "Visual variant of the component",
    },
    disabled: {
      control: { type: "boolean" },
      description: "Whether the component is disabled",
    },
    size: {
      control: { type: "radio" },
      options: ["small", "medium", "large"],
    },
  },
  args: {
    variant: "primary",
    disabled: false,
    size: "medium",
  },
  render: (args) => html`
    <my-element
      variant=${args.variant}
      ?disabled=${args.disabled}
      size=${args.size}
    ></my-element>
  `,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
```

### Key fields

| Field | Required | Notes |
| --- | --- | --- |
| `title` | Yes | Determines sidebar placement. Use `/` for grouping. |
| `component` | Yes | Must be the custom element tag name as a string. |
| `tags` | Recommended | `["autodocs"]` generates a Docs page automatically. |
| `parameters.docs.description.component` | Recommended | WC renderer cannot extract JSDoc from tag names, so add explicitly. |
| `render` | Yes | Returns a Lit `html` tagged template. |
| `argTypes` | Optional | Controls panel configuration. CEM provides defaults. |
| `args` | Optional | Default values applied to all stories. |

### Why `satisfies Meta`

Using `satisfies Meta` instead of `as Meta` preserves the literal types of `component`, `args`, and `argTypes` so that `StoryObj<typeof meta>` can infer correct story arg types. This provides autocomplete and type checking on story `args`.

## Render Functions

### Property binding with Lit

Lit templates in `render` use specific binding syntax:

```ts
render: (args) => html`
  <my-element
    .title=${args.title}           <!-- property binding (JS property) -->
    variant=${args.variant}         <!-- attribute binding (string) -->
    ?disabled=${args.disabled}      <!-- boolean attribute binding -->
    @click=${args.onClick}          <!-- event binding -->
  ></my-element>
`,
```

| Prefix | Binding type | Use for |
| --- | --- | --- |
| `.` | Property | Objects, arrays, complex types |
| (none) | Attribute | Strings, enums |
| `?` | Boolean attribute | Booleans (adds/removes attribute) |
| `@` | Event listener | Event handlers, spy functions |

### Slotted content

```ts
render: (args) => html`
  <my-card>
    <span slot="header">${args.headerText}</span>
    <p>${args.bodyText}</p>
    <my-button slot="actions">Action</my-button>
  </my-card>
`,
```

## Story Exports

### Basic story with args

```ts
export const Default: Story = {
  args: { title: "Hello World" },
};
```

### Story with custom render

```ts
export const WithSlots: Story = {
  render: () => html`
    <my-card>
      <h2 slot="header">Card Title</h2>
      <p>Card body content goes here.</p>
    </my-card>
  `,
};
```

### Story with play function

```ts
export const Interactive: Story = {
  args: { title: "Click me" },
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector("my-element");
    await expect(el).toBeTruthy();
  },
};
```

### Multiple variants

```ts
export const Primary: Story = {
  args: { variant: "primary", label: "Primary" },
};

export const Secondary: Story = {
  args: { variant: "secondary", label: "Secondary" },
};

export const Disabled: Story = {
  args: { variant: "primary", label: "Disabled", disabled: true },
};
```

## Story Naming Conventions

Organize story titles to create a logical sidebar hierarchy:

| Pattern | Example |
| --- | --- |
| Single category | `Components/Button` |
| Nested category | `Components/Forms/Text Input` |
| Prototype / WIP | `Prototype/Shell/Suite Header` |
| Library demos | `Fabric Components/SVG Icon` |

Use forward slashes to create nesting in the Storybook sidebar.

## Decorators

Decorators wrap stories to provide context (theme, layout, providers):

```ts
const meta = {
  // ...
  decorators: [
    (story) => html`
      <div style="padding: 2rem; background: var(--background);">
        ${story()}
      </div>
    `,
  ],
} satisfies Meta;
```

### Per-story decorator

```ts
export const DarkTheme: Story = {
  decorators: [
    (story) => html`
      <div data-theme="dark">${story()}</div>
    `,
  ],
  args: { title: "Dark mode" },
};
```

## Gotchas

- **`component` must be a string tag name.** The WC renderer does not accept class references.
- **Always add `parameters.docs.description.component`.** The renderer cannot trace tag names back to source JSDoc.
- **`@storybook/addon-docs` must be in the addons array.** Without it, the Docs tab renders blank even with `["autodocs"]`.
- **Lit is for story templates only.** Component source files should use the project's component framework (FAST, etc.). Lit `html` is allowed exclusively in `*.stories.ts`.
- **JSDoc must be above decorators.** Place JSDoc comments above `@customElement('...')` for CEM analyzer compatibility, not between the decorator and the class.
