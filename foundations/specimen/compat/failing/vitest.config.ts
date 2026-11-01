import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// The incumbent runner over the deliberately failing fixtures.
export default defineConfig({
	plugins: [storybookTest({ configDir: '.storybook' })],
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
