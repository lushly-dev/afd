import type { Preview } from '@storybook/web-components-vite';

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
