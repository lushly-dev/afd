# Violet system icons: provenance

Every drawing was written from scratch, its coordinates computed from Key's spec by a
generator script, and stored through `icon-save`. No path data was copied from another set.

Checked on 2026-11-25 against Feather 4.29.2 and Lucide 0.460.0: each icon rasterised at 64px
with every stroke set to 1.75, and the best overlap (intersection over union) across the whole of
both sets recorded. For calibration, three of the old seeds that carried Feather geometry scored
0.88 to 1.00 (`warning`, `document`, `settings`). The fourth, `attach`, scored 0.49:
it kept Feather's paperclip path commands and start point with smaller arc radii,
so its outline differed though its path data was derived from Feather's.

Owner's rule (2026-11-25): icons are a standard vocabulary, so judge the set as a whole. Shared
primitives (plus, X, arrows, a check) look alike in every set; what matters is no exact or
feature copy.

```
close            feather: x 0.93                   lucide: x 0.93
dismiss          feather: x 0.88                   lucide: x 0.88
clock            feather: rotate-cw 0.62           lucide: history 0.77
checkmark        feather: check 0.73               lucide: check 0.73
arrow-up         feather: arrow-up 0.71            lucide: arrow-up 0.71
sort-ascending   feather: arrow-up 0.53            lucide: arrow-up 0.53
sort-descending  feather: arrow-down 0.53          lucide: arrow-down 0.53
calendar         feather: cpu 0.43                 lucide: rotate-cw-square 0.51
document         feather: trash-2 0.44             lucide: square-split-vertical 0.50
folder           feather: cloud 0.36               lucide: toy-brick 0.50
chevron-right    feather: chevron-right 0.47       lucide: chevron-right 0.47
warning          feather: navigation-2 0.28        lucide: baseline 0.47
settings         feather: eye 0.34                 lucide: settings 0.46
stop             feather: arrow-down-left 0.43     lucide: arrow-down-left 0.43
attach           feather: skip-back 0.27           lucide: superscript 0.32
search           feather: pen-tool 0.32            lucide: pen-tool 0.31
```
