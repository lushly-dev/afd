# Violet Theme Roadmap

This file tracks the Violet runtime theming work so the next steps stay
explicit for both humans and agents.

## Current Direction

Violet is moving toward:

- registry-driven tokens as source of truth
- a generated runtime token layer installed once per app/docs shell
- optional scoped theme hosts for subtree overrides
- no required provider wrapper for ordinary component usage

## Completed

- semantic token registry remains the source of truth
- generated runtime theme module exists
- Storybook installs the shared runtime theme once at the shell
- validation now checks the generated runtime theme artifact
- scoped root mechanism exists via `data-violet-theme-root`
- optional `violet-theme` host exists as the first scoped wrapper
- generated light and dark runtime theme presets now exist
- Storybook can switch Violet runtime theme presets through a dedicated toolbar control
- shared token-default style modules now cover the button/icon-button family
- shared token-default style modules now cover the text-field/text-area family
- checkbox now builds on the shared field-token defaults
- direct Vitest coverage now verifies runtime theme install and scoped root behavior

## Next

- reduce the remaining duplicated component fallback values in components that
  still diverge more, especially checkbox and data-grid
- document CDN usage with explicit examples
- document app-shell usage in the main repo docs, not only package README
- verify `display: contents` is the right long-term host behavior for `violet-theme`

## Later

- expand the preset family beyond the current light/dark pair only if the semantic model stays coherent
- expose AFD-friendly theme commands for inspect/apply/diff flows
- split neutral Violet defaults from Lushly-branded overrides
- support scoped token patching on `violet-theme` instead of only the base runtime theme
- evaluate whether runtime theme output should also emit a plain CSS artifact for non-JS delivery
