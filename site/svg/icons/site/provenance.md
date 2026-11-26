# AFD site icons: provenance

Drawn from scratch, with no third-party path data, by the same geometry generator as Violet's
system icons. MIT, by Lushly Dev. They replace the site's Lucide icons (`site/svg/lucide/`, ISC),
which are removed.

Checked on 2026-11-26 against Feather 4.29.2 and Lucide 0.460.0, as Violet's system set was: each
icon rasterised at 64px with every stroke set to 1.75, and its best overlap (intersection over
union) with any icon in either set.

| Icon | Closest Feather | Closest Lucide |
|------|-----------------|----------------|
| plus | plus 0.93 | plus 0.93 |
| close | x 0.93 | x 0.93 |
| arrow-right | arrow-right 0.71 | arrow-right 0.71 |
| board | cpu 0.49 | map 0.62 |
| list | menu 0.49 | menu 0.53 |
| arrow-up-right | arrow-up-right 0.50 | move-up-right 0.51 |
| copy | layout 0.48 | panels-top-left 0.48 |
| terminal | terminal 0.34 | terminal 0.34 |
| return | align-right 0.28 | beaker 0.26 |

Owner's rule (2026-11-25): icons are a standard vocabulary, so judge the set as a whole; shared
primitives are fine, copies are not. `plus` and `close` are the primitives every set draws alike.
`return`'s first drawing followed Lucide's `corner-down-left` (the same commands, start corner
and radius-4 bend, every point within a unit; overlap 0.54), so it was redrawn before release from
Key's own numbers: a 2.5 bend and a 4.5-unit head. It keeps the hook-and-head shape every Return
key glyph shares.
