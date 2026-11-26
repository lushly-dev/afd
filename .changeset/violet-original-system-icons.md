---
"@lushly-dev/violet-elements": patch
---

Redraw the 16 `system/*` icons as an original set ([#2567](https://github.com/lushly-dev/afd/issues/2567)). Four of the first seed icons (`warning`, `attach`, `document`, `settings`) carried Feather's geometry while credited as hand-authored ([#2542](https://github.com/lushly-dev/afd/issues/2542)). Every icon is now drawn from scratch on one grid: a 1.75 line on 24 units with round caps and joins, where the seed mixed 24-unit icons at 2 with 16-unit ones at 1.25 (`calendar`, `clock`). Names, registration and the MIT license are unchanged; the shapes differ. The set's sources now keep each icon's metadata and review record beside its drawing (`icons/sources/system/icons/<name>/`), and `icons:build` reads that layout as well as `raw/`.
