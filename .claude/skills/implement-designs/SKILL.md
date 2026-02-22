---
name: implement-designs
source: botcore
description: >
  Guides the Figma design-to-code workflow using MCP integration, token extraction, and structured implementation. Covers Figma MCP setup, authentication, URL parsing, design context retrieval, token translation from Tailwind/Figma output to CSS custom properties, icon identification, asset management, and Code Connect mapping. Use when implementing a design from Figma, setting up the Figma MCP server, extracting design specs, translating design tokens, or converting React/Tailwind output to web components. Triggers: figma, design, design-to-code, implement design, figma link, screenshot, mcp, design tokens, figma mcp.

version: 1.0.0
triggers:
  - figma
  - design
  - design-to-code
  - implement design
  - figma link
  - screenshot
  - design tokens
  - figma mcp
  - token extraction
portable: true
---

# Implementing Designs — Figma Design-to-Code Workflow

Structured workflow for turning Figma designs into production code using the Figma MCP server, design token extraction, and component translation.

## Capabilities

1. Set up and troubleshoot the Figma MCP server (VS Code extension, authentication, Dev Mode)
2. Parse Figma URLs to extract file keys and node IDs for MCP tool calls
3. Retrieve screenshots and design context from Figma nodes via MCP tools
4. Extract design specifications (tokens, dimensions, spacing, typography, shadows) from MCP output
5. Translate Figma/Tailwind token formats into CSS custom properties
6. Map React Code Connect component names to web component equivalents
7. Identify icons from Figma metadata rather than visual guessing
8. Manage image assets extracted from Figma (expiring URLs, system vs sample-data classification)
9. Break large Figma frames into sublayers to work within MCP context limits

## Routing Logic

- For detailed Figma-to-CSS token mapping (colors, typography, spacing, borders, shadows) see [references/figma-token-map.md](references/figma-token-map.md)
- For React-to-web-component Code Connect translation tables see [references/code-connect-map.md](references/code-connect-map.md)
- For image asset organization and Figma extraction workflow see [references/asset-management.md](references/asset-management.md)

## Core Principles

- **Extract specs, never code.** Figma MCP returns React + Tailwind output. Treat it as a design specification source, not as copy-paste code. Pull out the design values (tokens, dimensions, spacing) and implement in your project's component system.
- **Tokens over hardcoded values.** Always convert hex colors, pixel values, and font stacks to semantic design tokens. Hardcoded values break when themes change.
- **Screenshot first, then context.** Always call `get_screenshot` before `get_design_context` so you know what you are building.
- **Navigate to main component.** Figma frame selection often returns the parent layout. Guide the designer to right-click and "Go to main component" for a tightly scoped node with variants and states.
- **Icons from metadata, not screenshots.** Icon layer names in Figma often show "Shape" or "Path" instead of the icon name. Always use `get_metadata` or ask the designer.
- **Download assets immediately.** Figma MCP image URLs expire after 7 days. Download on extraction and reference local paths, never Figma URLs.

## Workflow

### 1. Setup Figma MCP

Install the official Figma MCP server via VS Code Extensions marketplace (search "Figma MCP"). Start the server, authenticate via browser popup, and enable Dev Mode in Figma Desktop. Verify these tools are available:

| Tool                 | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `get_screenshot`     | Visual screenshot of any Figma node            |
| `get_design_context` | Layout, tokens, component structure for a node |
| `get_metadata`       | Instance names, icon names, component refs     |
| `get_variable_defs`  | Design token variable definitions              |

**Troubleshooting quick fixes:**
- Tools keep turning off: Reload VS Code window
- Duplicate installs: Remove all, reinstall in workspace only
- Auth popup missing: Stop/start server, check behind VS Code window
- Calls fail: Verify account access and Dev Mode is enabled

### 2. Get the Right Figma Node

Ask the designer to right-click the component in Figma, select "Go to main component", and share the URL. This gives a scoped node with properties, variants, and states rather than a parent layout frame.

Parse the URL to extract identifiers:

```
URL pattern: https://www.figma.com/design/{fileKey}/{fileName}?node-id={nodeId}&m=dev
- fileKey: alphanumeric string after /design/
- nodeId:  value after node-id= (replace - with : for the MCP API)
```

### 3. Retrieve Design Specs

1. Call `get_screenshot` to see the target visual
2. Call `get_design_context` on the focused node
3. If the response is too large, call on the root first to get child node IDs, then call on each sublayer individually
4. For icons, call `get_metadata` on the icon node to get the exact instance name

### 4. Extract and Translate Tokens

Pull design values from MCP output. Convert Tailwind utility syntax to CSS custom properties:

| MCP Output Pattern                             | CSS Custom Property                          |
| ---------------------------------------------- | -------------------------------------------- |
| `bg-[var(--colorNeutralBackground1,white)]`    | `background: var(--colorNeutralBackground1)` |
| `text-[color:var(--colorNeutralForeground1)]`  | `color: var(--colorNeutralForeground1)`      |
| `font-[family-name:var(--font-family/base)]`   | `font-family: var(--fontFamilyBase)`         |
| `text-[length:var(--font-size/300)]`           | `font-size: var(--fontSizeBase300)`          |
| `gap-[var(--horizontal/s,8px)]`                | `gap: var(--spacingHorizontalS)`             |
| `rounded-[var(--x-large,8px)]`                 | `border-radius: var(--borderRadiusXLarge)`   |
| `shadow-[var(--shadow4)]`                      | `box-shadow: var(--shadow4)`                 |

**Conversion rule:** Strip the Tailwind utility prefix, remove the fallback value after the comma, convert the slash-separated path to camelCase CSS custom property name.

See [references/figma-token-map.md](references/figma-token-map.md) for the full token rosetta stone (color, typography, spacing, elevation, border radius).

### 5. Translate Components

If Figma MCP returns React component names (from Code Connect), map each to the project's web component equivalent. Common pattern: `<ReactName>` becomes `<prefix-kebab-name>`.

Key translation rules:
- React camelCase props become kebab-case HTML attributes (`iconOnly` becomes `icon-only`)
- `className` is ignored (use scoped styles instead)
- `onClick` becomes a `@click` event binding or native event listener
- `children` becomes default slot content
- `icon` prop becomes an icon element in a named slot

See [references/code-connect-map.md](references/code-connect-map.md) for the full component mapping table.

### 6. Handle Assets

- Download image URLs from MCP output immediately (they expire in 7 days)
- Classify images: system assets (logos, illustrations) vs sample data (avatars, thumbnails)
- Reference local paths, never Figma URLs, in component code
- For icons, search the project icon packages rather than extracting raster images

See [references/asset-management.md](references/asset-management.md) for the full asset workflow.

## Checklist

- [ ] Figma MCP server installed, authenticated, and all four tools available
- [ ] Designer navigated to main component (not parent frame) and shared URL
- [ ] Screenshot retrieved to confirm visual target
- [ ] Design context retrieved (sublayered if too large)
- [ ] All hardcoded values converted to semantic design tokens
- [ ] Tailwind utility syntax converted to CSS custom properties
- [ ] React components mapped to web component equivalents
- [ ] Icons identified via `get_metadata`, not guessed from screenshots
- [ ] Image assets downloaded locally, not referenced by Figma URL
- [ ] Implementation reviewed for design fidelity against screenshot

## When to Escalate

- **Icon cannot be identified:** Figma layers show only "Shape" or "Path" and `get_metadata` returns generic names. Ask the designer for the specific icon name.
- **MCP context limit exceeded:** Even sublayering does not reduce the response size enough. Ask the designer to provide a more focused Figma node or break the design into smaller components.
- **Token not found in design system:** A Figma value does not map to any known design token. Flag the value, use the nearest token with a comment noting the deviation, and raise with the design team.
- **Custom non-standard styling:** Elements use data visualization color slots, custom gradients, or other non-standard values that do not map to component appearances. Implement as custom-styled plain elements and document the decision.
- **Code Connect snippet mismatch:** A Code Connect snippet references a component that does not exist in the project's component library. Check for recent additions or ask the design system team.
