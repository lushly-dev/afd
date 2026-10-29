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

## License

MIT
