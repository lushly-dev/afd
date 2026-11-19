---
"@lushly-dev/violet-elements": patch
---

Content slotted into `violet-alert`, `violet-card` and `violet-dialog` takes the system colours under forced colours (#1575). Each surface set `forced-color-adjust: none`, which is inherited, so slotted text kept the theme's colours: with a dark contrast theme (Windows "Night sky") it was dark on the black surface and could not be read. The surfaces still paint their own frame, edge and leading icon; what is slotted into them is now coloured by the system, `CanvasText` on `Canvas`, with links in `LinkText`. `violet-toast`, `violet-snackbar`, `violet-approval-card`, `violet-tool-call-card` and `violet-tool-result-card`, which are drawn in a `violet-card`, had the same defect: they keep what they paint opted out, and what is slotted into them now takes the system colours too, the toast's title included. The workaround stylesheet that set `forced-color-adjust: auto` on the components' children can go.
