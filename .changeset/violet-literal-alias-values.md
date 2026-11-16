---
"@lushly-dev/violet-elements": patch
---

The custom elements manifest writes out literal-union type aliases, so an attribute typed `VioletButtonAppearance` reads `"primary" | "secondary" | "quiet" | "transparent" | "danger"`. Tools that read the manifest, and the component pack, now see each such attribute's allowed values (about 40 attributes, including `violet-button`'s `appearance` and `violet-tabs`' `appearance` and `orientation`).
