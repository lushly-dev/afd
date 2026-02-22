# Code Connect — React to Web Component Mapping

When `get_design_context` returns Code Connect snippets, they use React component names. Map each to the web component equivalent for your project.

## Component Mapping

| Code Connect (React)   | Web Component Tag              | Notes                          |
| ---------------------- | ------------------------------ | ------------------------------ |
| `<Button>`             | `<fabric-button>`              |                                |
| `<CompoundButton>`     | `<fabric-compound-button>`     |                                |
| `<ToggleButton>`       | `<fabric-toggle-button>`       |                                |
| `<MenuButton>`         | `<fabric-menu-button>`         |                                |
| `<SplitButton>`        | `<fabric-menu split>`          | Composition, not standalone    |
| `<LoadingButton>`      | `<fabric-loading-button>`      |                                |
| `<FilterPill>`         | `<fabric-filter-pill>`         | Toggleable chip                |
| `<Tag>`                | `<fabric-tag>`                 |                                |
| `<Badge>`              | `<fabric-badge>`               |                                |
| `<CounterBadge>`       | `<fabric-counter-badge>`       |                                |
| `<Dropdown>`           | `<fabric-dropdown>`            |                                |
| `<Input>`              | `<fabric-text-input>`          | Tag name differs from React    |
| `<Textarea>`           | `<fabric-textarea>`            |                                |
| `<Checkbox>`           | `<fabric-checkbox>`            |                                |
| `<RadioGroup>`         | `<fabric-radio-group>`         |                                |
| `<Radio>`              | `<fabric-radio>`               |                                |
| `<Switch>`             | `<fabric-switch>`              |                                |
| `<Slider>`             | `<fabric-slider>`              |                                |
| `<TabList>`            | `<fabric-tablist>`             |                                |
| `<Tab>`                | `<fabric-tab>`                 |                                |
| `<Dialog>`             | `<fabric-dialog>`              |                                |
| `<Drawer>`             | `<fabric-drawer>`              |                                |
| `<Menu>`               | `<fabric-menu>`                |                                |
| `<MenuItem>`           | `<fabric-menu-item>`           |                                |
| `<Tree>`               | `<fabric-tree>`                |                                |
| `<TreeItem>`           | `<fabric-tree-item>`           |                                |
| `<Accordion>`          | `<fabric-accordion>`           |                                |
| `<Avatar>`             | `<fabric-avatar>`              |                                |
| `<Spinner>`            | `<fabric-spinner>`             |                                |
| `<ProgressBar>`        | `<fabric-progress-bar>`        |                                |
| `<MessageBar>`         | `<fabric-message-bar>`         |                                |
| `<Tooltip>`            | `<fabric-tooltip>`             |                                |
| `<Card>`               | `<fabric-card>`                |                                |
| `<Popover>`            | `<fabric-popover>`             |                                |
| `<TeachingBubble>`     | `<fabric-teaching-bubble>`     |                                |
| `<Carousel>`           | `<fabric-carousel>`            |                                |
| `<Wizard>`             | `<fabric-wizard>`              |                                |
| `<Field>`              | `<fabric-field>`               |                                |
| `<Image>`              | `<fabric-image>`               |                                |
| `<Link>`               | `<fabric-link>`                |                                |
| `<Text>`               | `<fabric-text>`                |                                |
| `<Divider>`            | `<fabric-divider>`             |                                |
| `<RatingDisplay>`      | `<fabric-rating-display>`      |                                |

## Prop to Attribute Mapping

React props map to HTML attributes with these transformations:

| React Pattern            | Web Component Pattern                        |
| ------------------------ | -------------------------------------------- |
| camelCase props          | kebab-case attributes (`iconOnly` -> `icon-only`) |
| `className`              | Ignored — use Shadow DOM scoped styles       |
| `onClick`                | `@click` event binding or `addEventListener` |
| `children`               | Default slot content                         |
| `icon` prop              | Icon element in `start` or `end` slot        |
| Boolean props (`disabled`)| Presence attributes (`disabled`)             |

## General Translation Pattern

For any design system using Code Connect, apply this pattern:

1. Identify the React component name from the Code Connect snippet
2. Find its web component equivalent in your project's component library
3. Convert camelCase props to kebab-case attributes
4. Replace `className` styling with scoped CSS using design tokens
5. Convert React event handlers to native DOM events
6. Map `children` to slot content

The component props/attributes in Code Connect snippets are accurate for the design system and should be preserved even when changing the component syntax.
