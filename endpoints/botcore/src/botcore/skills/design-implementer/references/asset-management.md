# Asset Management — Images and Visual Resources from Figma

Guide for organizing and extracting images when implementing designs from Figma.

## Asset Structure

Organize extracted assets into two categories that map to the engineering handoff boundary:

```
src/assets/
├── system/                    <- Template infrastructure (permanent)
│   ├── logos/                 <- Product logos, branding marks
│   └── illustrations/        <- Empty state, onboarding visuals
│
├── sample-data/               <- Mock content (REPLACE with real data)
│   ├── avatars/               <- User photos for personas
│   ├── thumbnails/            <- Document/item preview images
│   └── charts/                <- Chart/dashboard placeholders
```

| Category        | What happens at handoff          | Examples                                     |
| --------------- | -------------------------------- | -------------------------------------------- |
| **system/**     | Engineering keeps these          | Logos, empty state illustrations, branding    |
| **sample-data/**| Engineering replaces with API data | Avatars, document previews, chart screenshots |

## Extracting Images from Figma MCP

1. Call `get_design_context` on the node containing the image
2. Find the image URL in the output (format: `https://www.figma.com/api/mcp/asset/{id}`)
3. Download immediately — URLs expire after 7 days

```bash
# Download a Figma MCP asset
curl -o src/assets/sample-data/avatars/name.png "https://www.figma.com/api/mcp/asset/{asset-id}"
```

**Critical:** Never reference Figma URLs directly in component code. Always download first and use local paths.

## Classification Decision Tree

| Question                                  | If yes              | If no              |
| ----------------------------------------- | ------------------- | ------------------ |
| Does every instance of the app need this? | `system/`           | `sample-data/`     |
| Would engineering keep this image?        | `system/`           | `sample-data/`     |
| Does it represent user-generated content? | `sample-data/`      | `system/`          |
| Is it product branding?                   | `system/logos/`     | --                 |
| Is it an empty/error state visual?        | `system/illustrations/` | --             |
| Is it a person's photo?                   | `sample-data/avatars/`  | --             |
| Is it a document preview?                 | `sample-data/thumbnails/` | --           |

## Naming Conventions

| Type          | Pattern                       | Example                   |
| ------------- | ----------------------------- | ------------------------- |
| Avatars       | `{first}-{last}.png`          | `mona-kane.png`           |
| Logos         | `{product}-logo.{ext}`        | `contoso-logo.png`        |
| Illustrations | `{context}-{description}.svg` | `empty-state-no-data.svg` |
| Thumbnails    | `{item-type}-preview.png`     | `report-preview.png`      |
| Charts        | `{chart-type}-sample.png`     | `bar-chart-sample.png`    |

## Using Assets in Components

Reference images via local paths relative to the project root or through the build tool's alias system:

```typescript
// Reference via project path
<img class="avatar" src="/src/assets/sample-data/avatars/mona-kane.png" alt="Mona Kane" />

// Or via configurable attribute for reusable components
@attr avatarSrc = '/src/assets/sample-data/avatars/default.png';
```

## Privacy and Legal Compliance

Do not use real employee photos or names in prototypes or demos. Use only approved persona names and images from the design kit. Check your organization's legal requirements for demo personas.
