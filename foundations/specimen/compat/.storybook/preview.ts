import type { Preview } from '@storybook/web-components-vite';

// Vite's glob imports, as Lushly's preview loads its manifest: eagerly as a URL, eagerly as a
// value and lazily. The Glob Import story checks what each produced.
(globalThis as { __fixtureGlob?: unknown }).__fixtureGlob = {
	urls: import.meta.glob<string>('../data/*.json', {
		eager: true,
		import: 'default',
		query: '?url',
	}),
	values: import.meta.glob('../data/*.json', { eager: true, import: 'default' }),
	lazy: Object.keys(import.meta.glob('../data/*.json')),
};

// Project annotations as the consumers write them: a theme global applied by a decorator,
// accessibility failures as test failures, and a project tag.
const preview: Preview = {
	tags: ['fixture-project'],
	initialGlobals: { theme: 'light' },
	globalTypes: {
		theme: {
			description: 'Fixture theme',
			toolbar: {
				items: [
					{ value: 'light', title: 'Light' },
					{ value: 'dark', title: 'Dark' },
				],
			},
		},
	},
	parameters: { a11y: { test: 'error' } },
	decorators: [
		(story, context) => {
			document.documentElement.dataset.fixtureTheme =
				context.globals.theme === 'dark' ? 'dark' : 'light';
			return story();
		},
	],
};

export default preview;
