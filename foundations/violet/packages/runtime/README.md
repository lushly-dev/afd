# @lushly-dev/violet-runtime

Web SDK for Violet Design tokens: load a node's resolved tokens from the Violet API, cache them, adopt them as a stylesheet of CSS custom properties, and switch themes at runtime.

```bash
npm install @lushly-dev/violet-runtime@preview
```

```ts
import { ThemeManager, VioletRuntime } from '@lushly-dev/violet-runtime';

const violet = new VioletRuntime({
	nodeId: 'brand-light',
	apiUrl: 'https://violet.example.com', // your Violet deployment
	apiKey: 'your-api-key',
});
violet.adopt(document);
await violet.load();

const themes = new ThemeManager(violet, {
	themes: [
		{ nodeId: 'brand-light', name: 'Light' },
		{ nodeId: 'brand-dark', name: 'Dark' },
	],
	defaultTheme: 'brand-light',
});
await themes.switch('brand-dark');
```

`apiUrl` is required whenever you pass `apiKey`: there is no default host, so the constructor throws rather than send your key somewhere you did not choose. Without a key, `apiUrl` defaults to the page's own origin.

## Adopting a stylesheet

`adopt(target?)` adopts one constructed stylesheet holding the loaded tokens into the document, or into a shadow root, through `adoptedStyleSheets`, and returns it. A repeated call adds nothing, a document and its shadow roots share one sheet, and every `load()` and `switchNode()` rewrites it, so every root that adopted it changes at once. `unadopt(target?)` takes it out again.

- The selectors are `@lushly-dev/violet-elements`' theme contract: the tokens apply on `:root` and on every element marked `data-violet-theme-root`. `adopt(target, { preset: 'dark' })` narrows them to where `data-violet-theme="dark"` is selected; one runtime adopts as one preset, so create a runtime per preset.
- No `<style>` element or inline style is written, so a page whose Content Security Policy forbids inline styles needs no exception.
- Adopted sheets come after the page's own `<style>` and `<link>` sheets in the cascade, so a page rule overriding a token on `:root` needs a more specific selector. `adopt()` appends after the sheets already adopted there, so a page's own adopted override sheet must be adopted after it, or use more specific selectors.
- The sheet sets the tokens on every `[data-violet-theme-root]` too, so a token set on `body` is overridden again inside such a descendant.
- In a shadow root, the root's `<style>` elements come before its adopted sheets, so a host's `<style>` that overrides a token on a `[data-violet-theme-root]` child with equal specificity loses to the runtime's sheet. Raise its specificity, or adopt the override after the runtime's sheet.
- The returned sheet belongs to the runtime: every `load()` and `switchNode()` rewrites it, so an edit made to it lasts until then, and a repeated `adopt()` does not undo it.
- `adopt()` throws a `TypeError` for a target that is neither a document nor a shadow root, and for a document with no window (one made by `createHTMLDocument` or `DOMParser`, or an iframe's once the iframe is removed). A refused call changes nothing. A sheet that can no longer be rewritten is reported with `console.error` and dropped; the others are still rewritten.
- Values are written through the CSSOM, as inline properties are, so a value cannot end the rule.
- Once `adopt()` is called, `autoApply` no longer writes inline properties, and those this runtime's `applyToDocument()` wrote are removed, since they would override the sheet. `removeFromDocument()` undoes only the inline properties the runtime wrote that still hold its value, restoring the value the page had before the first write; a property the page changed since is left as it is.

`applyToDocument()`, `removeFromDocument()` and the `autoApply` option, which write inline properties on the root element, are deprecated in favour of `adopt()` and will be removed in a later release. `autoApply` still defaults to `true` until then, so a runtime that is never adopted keeps its present behaviour.

## Custom property names

A token's property is `--`, the runtime's `cssPrefix` and `-` when it has one, then the id with each `.` replaced by `-`. The default prefix is empty (`color.surface.page` is `--color-surface-page`). `@lushly-dev/violet-elements` reads its interface's ids under the prefix `violet` (token interface version 4), so a runtime that themes those components passes it:

```ts
import { VIOLET_CSS_PREFIX, VioletRuntime } from '@lushly-dev/violet-runtime';

const violet = new VioletRuntime({ nodeId: 'brand-dark', source, cssPrefix: VIOLET_CSS_PREFIX });
violet.adopt(document); // --violet-color-surface-page, ..., on violet-elements' selectors
```

`tokenCustomProperty(id, prefix)` is the rule itself, from the root or from `@lushly-dev/violet-runtime/property`, which imports nothing. It is the one rule every Violet writer uses: this runtime, `@lushly-dev/violet-core`'s CSS exporter (`prefix: 'violet'` writes the same names), Loam's theme, and violet-elements, which copies the file at build time since it takes no Violet dependency.

## Preloaded tokens

A static build can apply a theme with no token server: pass the resolved tokens as `source` in place of `apiUrl`. The two are either/or: the types refuse both, and so does the constructor.

```ts
import themes from './theme.json'; // { nodes: { 'brand-dark': [{ id, value }, ...], ... } }

const violet = new VioletRuntime({
	nodeId: 'brand-dark',
	source: { tokens: themes.nodes['brand-dark'] },
});
violet.adopt(document);
await violet.load(); // no request; writes the tokens into the adopted sheet

await violet.switchNode('brand-light', { tokens: themes.nodes['brand-light'] });
```

- A token needs a non-empty `id` and a string, finite number or object `value`; `resolvedAt` defaults to the node the source was given for. The runtime copies the array and each token's top level, so adding, removing or replacing tokens in your array later does not reach it; nested values are shared.
- `load()` applies the current source. `switchNode(nodeId, source)` takes the new node's tokens; without a source it can only reapply the node the runtime already holds. An HTTP runtime refuses a source.
- Nothing is cached and `preload()` has nothing to do: `cacheEnabled` and `timeout` are ignored.
- Give each `ThemeManager` theme its `source`, and the manager passes it to `switchNode`:

```ts
const manager = new ThemeManager(violet, {
	themes: [
		{ nodeId: 'brand-light', name: 'Light', source: { tokens: themes.nodes['brand-light'] } },
		{ nodeId: 'brand-dark', name: 'Dark', source: { tokens: themes.nodes['brand-dark'] } },
	],
	defaultTheme: 'brand-dark',
});
```

## System preference and high contrast

`useSystemPreference(light, dark)` follows `(prefers-color-scheme: dark)`. Pass a third theme to choose it whenever `(prefers-contrast: more)` or `(forced-colors: active)` matches, whatever the color scheme:

```ts
const stop = manager.useSystemPreference('brand-light', 'brand-dark', 'brand-contrast');
// later
stop(); // removes the listeners on every query
```

The manager follows changes to each query until you call the returned function. Without a third theme it reads only the color scheme.

## License

MIT
