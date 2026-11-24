---
"@lushly-dev/violet-elements": patch
---

Switch Refined Violet selection, focus ring, accent and light primary-button hover/pressed tokens from mint/green (selection, dark focus, light primary hover/pressed) and blue (light focus, accent) to a unified, saturation-balanced Cerulean 235° ramp (`#28769e` light / `#3d92bf` dark focus ring, `#1b5f80` light / `#a1d4f3` dark accent/selected text, `#dfecf4` / `#c0daeb` light and `#162832` dark selected/accent fills, `#2f383e` / `#262e33` light primary hover/pressed), keeping `color.state.success.*` mint/green so selection and focus no longer share a hue with semantic success. Update `violet-source-citation`'s `.link` to read `var(--_text-link, var(--color-accent-text, #1b5f80))` so link text follows `--color-accent-text` and keeps WCAG AA contrast across light (6.18:1), dark (11.52:1) and high-contrast (9.17:1) themes, and regenerate theme presets, component CSS fallbacks, custom-elements manifest and Specimen pack records.
