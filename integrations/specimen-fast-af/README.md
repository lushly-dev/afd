# Specimen FAST-AF plugin

**Preview,** like [Specimen](../../foundations/specimen/README.md). Install it with Specimen and the FAST-AF runtime: `npm install @lushly-dev/specimen@preview @lushly-dev/specimen-fast-af@preview @lushly-dev/fast-element@preview zod`.

`@lushly-dev/specimen-fast-af` adds FAST-AF's knowledge to a Specimen bench through two of Specimen's plugin points:

- **Schema source.** It enables FAST's Definition Schema and merges each FAST element's definition into the schema core reads from the custom elements manifest: properties and their finite values, slots, events and CSS properties. Where the manifest already states something, the manifest's statement stays. FAST-AF's runtime has no command system, so the merged schema states that the element has no commands. It no longer supplies a command runner: its `fast-af` runner, which called an element's `@command` method, went with the runtime's command module ([#1385](https://github.com/lushly-dev/afd/issues/1385)).
- **Context provider.** It turns a FAST-AF theme module into named themes for native specimens. A module shaped as `@lushly-dev/violet-elements`' theme exports qualifies: its `presets`, its `apply`, and optionally its `install`.

It also passes a token map through: FAST-AF's private alias registry, composed and validated with the public maps (`composeTokenMaps`).

**Guide source.** `@lushly-dev/specimen-fast-af/guides` is for Specimen's fifth plugin point, which runs in Node. `attributeTaxonomy({ file })` reads an attribute taxonomy shaped as `@lushly-dev/violet-elements`' `attribute-taxonomy.jsonc` and states each entry once as a shared rule, `taxonomy.<attribute>`: its definition and what it is not for, applying to every component with that attribute. When the two do not fit one rule's 240 characters, what it is not for is a rule of its own (`<id>.not-for`); a name the taxonomy defines more than once applies to the tags each entry lists instead (`taxonomy.<attribute>.<first tag>`). Name it from a module the configuration's `guideSources` key lists:

```js
// specimen/guides.mjs
import { attributeTaxonomy } from '@lushly-dev/specimen-fast-af/guides';

export default attributeTaxonomy({ file: 'attribute-taxonomy.jsonc' });
```

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

`pnpm -F @lushly-dev/specimen-fast-af test` runs the browser-free schema and guide source tests. `test:browser` runs the plugin through Specimen's bench on a FAST element; it needs the native host and Chromium, as Specimen's own Chromium suite does.

It is admitted for the npm `preview` prerelease with Specimen, at `0.1.0-preview.0` first, and needs `@lushly-dev/fast-element` from the version it was built against (a `workspace:^` peer); `fast-element`'s versions name the upstream FAST Element line it carries ([FAST-AF versions](../../foundations/fast-af/README.md#versions)). See the [T05 record](../../docs/features/complete/specimens/t05-compatibility.md).
