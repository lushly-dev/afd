# Token reference

Source of truth: `site/css/tokens-m2.css`. Rendered live at `site/styleguide.html`.

## Layers

1. **Primitives (`--afd-*`)**: the raw palette. Use only for component-internal detail
   with no role of its own (demo chrome, chip borders).
2. **Semantic tokens**: what a value is for. Section and component CSS uses these first.

## Colour roles

| Token | Primitive | Role |
|-------|-----------|------|
| `--color-page` | paper | Page background |
| `--color-surface` | paper-bright | Light panels |
| `--color-text` | ink | Text on light |
| `--color-text-muted` | stone-600 | Secondary text on light |
| `--color-text-subtle` | stone-500 | Tertiary text |
| `--color-line` | stone-200 | Hairlines on light |
| `--color-rule` | ink | Heavy rules |
| `--color-on-dark` | paper | Text on ink and deep green |
| `--color-on-dark-muted` | green-200 | Secondary text on dark |
| `--color-on-dark-line` | paper at 18% | Hairlines on dark |
| `--color-on-color-line` | ink at 22% | Hairlines on red, salmon, mint |
| `--accent-human` / `--accent-human-text` | red / red-ink | People and UI; small red text |
| `--accent-agent` / `--accent-agent-text` | mint / mint-ink | Agents; mint-coloured text on light |
| `--color-code-bg` / `--color-code-text` | ink / paper | Code and terminal panels |

## Fields and numerals

| Field | Primitive | Numeral / slash fill |
|-------|-----------|----------------------|
| `--field-signal` | red `#f74431` | `--numeral-on-signal` red-700 |
| `--field-rule` | salmon `#f96e5b` | `--numeral-on-rule` salmon-700 |
| `--field-agent` | mint `#a3ebcd` | `--numeral-on-agent` mint-600 |
| `--field-deep` | green-800 `#252e29` | `--numeral-on-deep` green-700 |
| `--field-ink` | ink `#181b1a` | `--numeral-on-ink` ink-raised |
| `--field-rest` | paper `#f4f0ea` | none |

Set a section's numeral fill with `--numeral-fill: var(--numeral-on-*)` on the section.

## Type

| Token | Value |
|-------|-------|
| `--font-display` | Archivo Black |
| `--font-sans` | Space Grotesk (300–700) |
| `--font-mono` | IBM Plex Mono |
| `--t-label` | 11px |
| `--t-code` | 12px |
| `--t-small` | 14px |
| `--t-body` | 17px |
| `--t-lead` | 19 → 23px |
| `--t-title` | 26 → 40px |
| `--t-statement` | 34 → 96px |
| `--t-display` | 40 → 150px (fixed breakpoint sizes) |
| `--t-honesty` | 30 → 118px (fixed breakpoint sizes) |
| `--t-command` | 26 → 64px (fixed breakpoint sizes) |
| `--weight-thin` … `--weight-strong` | 300, 400, 500, 600 |
| `--leading-tight` / `--leading-body` | 0.95 / 1.55 |
| `--tracking-display` / `--tracking-thin` / `--tracking-label` | -0.025em / -0.04em / 0.06em |

## Space, structure, motion, layers

| Token | Value |
|-------|-------|
| `--space-1` … `--space-9` | 4, 8, 12, 16, 24, 32, 48, 64, 96px |
| `--section-pad` | 64 → 112px (supporting sections) |
| `--statement-pad` | 96 → 144px (major story beats) |
| `--heading-gap` | 24 → 64px |
| `--wrap-max` | 1280px |
| `--rule-thin` / `--rule` / `--rule-heavy` | 1 / 2 / 3px |
| `--radius` | 4px (controls only) |
| `--shadow-offset` | 8px 8px 0 |
| `--ease-out` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-fast` / `--motion-base` / `--motion-enter` | 0.3s / 0.6s / 1.1s |
| `--motion-rest-opacity` | 0.65 (words waiting for scroll emphasis) |
| `--layer-art` … `--layer-dialog` | 0, 1, 2, 100, 13000 |

## Legacy aliases

`manifesto-2.css` keeps the original manifesto variable names as aliases, so older
rules still resolve: `--ink`, `--paper`, `--red`, `--mint`, `--muted`, `--line`,
`--mono`, `--display`. Prefer the semantic names in new CSS.
