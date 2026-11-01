import type { Preview } from '@storybook/web-components-vite';

const preview: Preview = {
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
};

export default preview;
