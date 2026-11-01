# @lushly-dev/violet-runtime

Web SDK for Violet Design tokens: load a node's resolved tokens from the Violet API, cache them, apply them as CSS custom properties, and switch themes at runtime.

```bash
npm install @lushly-dev/violet-runtime
```

```ts
import { ThemeManager, VioletRuntime } from '@lushly-dev/violet-runtime';

const violet = new VioletRuntime({
	nodeId: 'brand-light',
	apiUrl: 'https://violet.example.com', // your Violet deployment
	apiKey: 'your-api-key',
});
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

## Preloaded tokens

A static build can apply a theme with no token server: pass the resolved tokens as `source` in place of `apiUrl`. The two are either/or: the types refuse both, and so does the constructor.

```ts
import themes from './theme.json'; // { nodes: { 'brand-dark': [{ id, value }, ...], ... } }

const violet = new VioletRuntime({
	nodeId: 'brand-dark',
	source: { tokens: themes.nodes['brand-dark'] },
});
await violet.load(); // no request; applies the tokens as custom properties

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
