import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// The incumbent runner: Storybook's Vitest addon over the fixture stories, in Chromium.
export default defineConfig({
	plugins: [storybookTest({ configDir: '.storybook', tags: { skip: ['skip-me'] } })],
	test: {
		name: 'storybook',
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: 'chromium' }],
		},
	},
});
