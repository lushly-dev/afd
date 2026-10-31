import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';
import { type MediaEmulation, providerMedia } from './reference/provider.js';

/**
 * The bench sets media per Playwright context. Inside Vitest one page hosts every test, so a
 * driver must switch media on that page. `null` turns emulation off; it does not restore
 * `providerMedia`, so pass those values to return to the provider's condition.
 */
const emulateMedia: BrowserCommand<[MediaEmulation]> = async (context, media) => {
	if (context.provider.name !== 'playwright')
		throw new Error('emulateMedia needs the Playwright provider');
	await context.page.emulateMedia(media);
};

/**
 * Reference driver: the Specimen runtime inside Vitest browser mode, the harness the
 * consumers' Storybook Vitest addon runs stories in. Locale is a browser-context option here,
 * fixed for the whole run.
 */
export default defineConfig({
	test: {
		globals: false,
		include: ['reference/**/*.test.ts'],
		testTimeout: 30000,
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({
				contextOptions: { ...providerMedia, locale: 'en-US', deviceScaleFactor: 1 },
			}),
			instances: [{ browser: 'chromium' }],
			commands: { emulateMedia },
			screenshotFailures: false,
		},
	},
});
