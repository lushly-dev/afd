# Specimen FAST-AF plugin

`@lushly-dev/specimen-fast-af` adds FAST-AF's knowledge to a Specimen bench through three of Specimen's plugin points:

- **Schema source.** It enables FAST's Definition Schema and merges each FAST element's definition into the schema core reads from the custom elements manifest: properties and their finite values, slots, events, CSS properties and `@command` commands. Where the manifest already states something, the manifest's statement stays.
- **Command runner `fast-af`.** It calls an element's `@command` method by command id, for explicit command steps: `{ command: { runner: 'fast-af', name: 'editor.save', target: 'control' } }`. A command the element does not declare fails with the commands it does.
- **Context provider.** It turns a FAST-AF theme module into named themes for native specimens. A module shaped as `@lushly-dev/violet-elements`' theme exports qualifies: its `presets`, its `apply`, and optionally its `install`.

It also passes a token map through: FAST-AF's private alias registry, composed and validated with the public maps (`composeTokenMaps`).

Wire it from a plugins module the bench configuration names:

```ts
// specimen.plugins.ts
import { fastAf } from '@lushly-dev/specimen-fast-af';
import * as theme from './src/theme/index.js';

export default fastAf({
	themes: { presets: theme.violetThemePresets, apply: theme.applyVioletThemePreset, install: theme.installVioletTheme },
});
```

```json
{ "specimens": [], "plugins": ["./specimen.plugins.ts"], "manifest": "./custom-elements.json" }
```

The bench installs plugins before any specimen or story module loads. Elements defined later therefore record their Definition Schema.

`pnpm -F @lushly-dev/specimen-fast-af test` runs the browser-free schema tests. `test:browser` runs the plugin through Specimen's bench on a FAST element with an `@command`; it needs the native host and Chromium, as Specimen's own Chromium suite does.

This unit is private and quarantined: it cannot publish. See the [T05 record](../../docs/features/active/specimens/t05-compatibility.md).
