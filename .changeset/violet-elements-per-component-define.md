---
"@lushly-dev/violet-elements": minor
---

Each element now has its own entries, so one import registers one element ([#1785](https://github.com/lushly-dev/afd/issues/1785)). `@lushly-dev/violet-elements/<name>` (the tag without `violet-`) exports the class and its FAST definition and registers nothing; `@lushly-dev/violet-elements/<name>/define` registers the element, and the elements it uses, when imported, and exports `define<Class>(registry = customElements)` to define them in a scoped registry. `sideEffects` now lists only the define modules, `all.js` and the root, so a bundler keeps only what a product imports: `button/define` bundles `violet-button` alone. The root import still registers every element. New entries also cover the icons (`icons/system-<name>`, `icon-registry`), the theme barrel (`theme`, with `VioletTheme`) and the built-in set (`theme-builtin`).

- **Breaking (preview minor):** `./dist/*` is no longer exported, so deep imports of the build layout stop resolving. Move them to the subpaths:

  | Before | After |
  | --- | --- |
  | `import "@lushly-dev/violet-elements/dist/button/violet-button.js"` | `import "@lushly-dev/violet-elements/button/define"` |
  | `import "@lushly-dev/violet-elements/dist/conversation/violet-message.js"` | `import "@lushly-dev/violet-elements/message/define"` |
  | `import type { VioletListbox } from "@lushly-dev/violet-elements/dist/listbox/violet-listbox.js"` | `import type { VioletListbox } from "@lushly-dev/violet-elements/listbox"` |
  | `import "@lushly-dev/violet-elements/dist/theme/violet-theme.js"` | `import "@lushly-dev/violet-elements/theme/define"` |
  | `import { registerSystemCloseIcon } from "@lushly-dev/violet-elements/dist/icon/generated/icons/system-close.js"` | `import { registerSystemCloseIcon } from "@lushly-dev/violet-elements/icons/system-close"` |
  | `import { registerVioletIcon } from "@lushly-dev/violet-elements/dist/icon/icon-registry.js"` | `import { registerVioletIcon } from "@lushly-dev/violet-elements/icon-registry"` |
  | `import { violetThemeCssText } from "@lushly-dev/violet-elements/dist/theme/violet-theme-builtin.js"` | `import { violetThemeCssText } from "@lushly-dev/violet-elements/theme-builtin"` |

- **Breaking (preview minor):** a class module no longer registers its element. Code that imported a class by name (`import { VioletButton } from …`) from an element module and relied on the import to register it imports `<name>/define` as well. The dialog, teaching tip, carousel, tree item, date, date-range, time and color pickers, file explorer, data grid and attachment cell register their system icons when defined, not when their module loads.
- A scoped registry holds the element defined into it, but the elements that element creates in its own shadow root are still created in the global registry; full isolation is a follow-up ([#2437](https://github.com/lushly-dev/afd/issues/2437)).
