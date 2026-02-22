# Figma-to-CSS Token Rosetta Stone

When converting Figma designs via MCP `get_design_context`, use this reference to map Figma's resolved values and Tailwind utility syntax to CSS custom properties.

## Color Mapping

### From Figma Make CSS Variables

Figma Make exports use a generic semantic token system. Map each to the design system equivalent:

| Figma Make Variable          | Intent                        | Typical Design Token                 |
| ---------------------------- | ----------------------------- | ------------------------------------ |
| `--background`               | Application background        | `--colorNeutralBackground1`          |
| `--foreground`               | Primary text on background    | `--colorNeutralForeground1`          |
| `--card`                     | Card/container background     | `--colorNeutralBackground1` or `2`   |
| `--card-foreground`          | Text on cards                 | `--colorNeutralForeground1`          |
| `--popover`                  | Dropdown/tooltip background   | `--colorNeutralBackground1`          |
| `--primary`                  | Primary buttons, accents      | `--colorBrandBackground`             |
| `--primary-foreground`       | Text on primary surfaces      | `--colorNeutralForegroundOnBrand`    |
| `--secondary`                | Secondary buttons              | `--colorNeutralBackground3`          |
| `--muted`                    | Disabled/subtle backgrounds   | `--colorNeutralBackground3`          |
| `--muted-foreground`         | Disabled/placeholder text     | `--colorNeutralForegroundDisabled`   |
| `--accent`                   | Highlight accents             | `--colorBrandForeground1`            |
| `--destructive`              | Error, delete actions         | `--colorStatusDangerBackground3`     |
| `--border`                   | Default borders               | `--colorNeutralStroke1`              |
| `--ring`                     | Focus ring color              | `--colorStrokeFocus2`                |
| `--sidebar`                  | Sidebar/nav background        | `--colorNeutralBackground3`          |

### From Common Hardcoded Hex Values

Figma raw exports often contain hardcoded values. Always use the semantic token, never the hex:

| Hex / RGBA                           | Token (Light Theme)                    | Context          |
| ------------------------------------ | -------------------------------------- | ---------------- |
| `#242424` / `rgba(36, 36, 36, 1)`   | `--colorNeutralForeground1`            | Primary text     |
| `#424242` / `rgba(66, 66, 66, 1)`   | `--colorNeutralForeground2`            | Secondary text   |
| `#616161` / `rgba(97, 97, 97, 1)`   | `--colorNeutralForeground3`            | Tertiary text    |
| `#FFFFFF`                            | `--colorNeutralBackground1`            | Page background  |
| `#FAFAFA`                            | `--colorNeutralBackground2`            | Card background  |
| `#F5F5F5` / `#F0F0F0`               | `--colorNeutralBackground3`            | Recessed surface |
| `#E0E0E0` / `#D1D1D1`               | `--colorNeutralStroke1`                | Default border   |
| `#BDBDBD`                            | `--colorNeutralForegroundDisabled`     | Disabled text    |
| `#0078D4`                            | `--colorBrandBackground`               | Brand (Fluent)   |
| `#B10E1C`                            | `--colorStatusDangerBackground3`       | Error            |
| `#107C10`                            | `--colorStatusSuccessBackground3`      | Success          |

## Typography Mapping

| Figma Make Variable / Pixel Value | Design Token            |
| --------------------------------- | ----------------------- |
| `--text-xs` / 10px               | `--fontSizeBase100`     |
| `--text-sm` / 12px               | `--fontSizeBase200`     |
| `--text-base` / 14px             | `--fontSizeBase300`     |
| `--text-lg` / 16px               | `--fontSizeBase400`     |
| `--text-xl` / 20-24px            | `--fontSizeBase500` / `600` |
| `--text-2xl` / 28-32px           | `--fontSizeHero800`     |
| `--font-weight-normal` / 400     | `--fontWeightRegular`   |
| `--font-weight-medium` / 600     | `--fontWeightSemibold`  |
| `--font-weight-bold` / 700       | `--fontWeightBold`      |

Always use the font family token instead of hardcoding:

```css
/* Correct */
font-family: var(--fontFamilyBase);

/* Never hardcode the font stack */
```

## Elevation Mapping

Map `box-shadow` values by visual weight:

| Shadow Depth   | Design Token  |
| -------------- | ------------- |
| Barely visible | `--shadow2`   |
| Card-level     | `--shadow4`   |
| Menu/dropdown  | `--shadow8`   |
| Dialog         | `--shadow16`  |
| Popover        | `--shadow28`  |

## Spacing Mapping

Figma MCP returns spacing in Tailwind format. Convert:

| Figma MCP Tailwind            | Pixel Value | Design Token                 |
| ----------------------------- | ----------- | ---------------------------- |
| `gap-[2px]`, `p-[2px]`       | 2px         | `--spacingHorizontalXXS`     |
| `gap-[4px]`, `p-[4px]`       | 4px         | `--spacingHorizontalXS`      |
| `gap-[8px]`, `p-[8px]`       | 8px         | `--spacingHorizontalS`       |
| `gap-[12px]`, `p-[12px]`     | 12px        | `--spacingHorizontalM`       |
| `gap-[16px]`, `p-[16px]`     | 16px        | `--spacingHorizontalL`       |
| `gap-[20px]`, `p-[20px]`     | 20px        | `--spacingHorizontalXL`      |
| `gap-[24px]`, `p-[24px]`     | 24px        | `--spacingHorizontalXXL`     |

If a Figma value does not land on the 4px grid (e.g., 6px, 10px), use the nearest token and add a comment noting the deviation.

## Border Radius Mapping

| Figma MCP Tailwind       | Pixel Value | Design Token              |
| ------------------------ | ----------- | ------------------------- |
| `rounded-[2px]`          | 2px         | `--borderRadiusSmall`     |
| `rounded-[4px]`          | 4px         | `--borderRadiusMedium`    |
| `rounded-[6px]`          | 6px         | `--borderRadiusLarge`     |
| `rounded-[8px]`          | 8px         | `--borderRadiusXLarge`    |
| `rounded-full`           | 50%         | `--borderRadiusCircular`  |

## MCP Tailwind to CSS Custom Property Conversion

| Figma MCP Output                                | CSS Custom Property                          |
| ----------------------------------------------- | -------------------------------------------- |
| `bg-[var(--colorNeutralBackground1,white)]`     | `background: var(--colorNeutralBackground1)` |
| `text-[color:var(--colorNeutralForeground1)]`   | `color: var(--colorNeutralForeground1)`      |
| `font-[family-name:var(--font-family/base)]`    | `font-family: var(--fontFamilyBase)`         |
| `text-[length:var(--font-size/300)]`            | `font-size: var(--fontSizeBase300)`          |
| `font-[number:var(--font-weight/regular)]`      | `font-weight: var(--fontWeightRegular)`      |
| `leading-[var(--line-height/300)]`              | `line-height: var(--lineHeightBase300)`      |
| `gap-[var(--horizontal/s,8px)]`                 | `gap: var(--spacingHorizontalS)`             |
| `px-[var(--horizontal/m,12px)]`                 | `padding-inline: var(--spacingHorizontalM)`  |
| `py-[var(--vertical/s,8px)]`                    | `padding-block: var(--spacingVerticalS)`     |
| `rounded-[var(--x-large,8px)]`                  | `border-radius: var(--borderRadiusXLarge)`   |
| `shadow-[var(--shadow4)]`                       | `box-shadow: var(--shadow4)`                 |
| `border-[var(--colorNeutralStroke1)]`            | `border-color: var(--colorNeutralStroke1)`   |
| `w-[var(--stroke-width/thin,1px)]`              | `border-width: var(--strokeWidthThin)`       |

**Conversion pattern:** Strip the Tailwind utility prefix, remove the fallback value after the comma, convert the slash-separated path to camelCase CSS custom property name.
