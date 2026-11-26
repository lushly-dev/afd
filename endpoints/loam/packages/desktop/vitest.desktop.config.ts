import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Phase 6's desktop suite, P6-D1 to P6-D4 (specification, 10.7), and phase 5's P5-A2 on the desktop: Vitest with
 * `webdriverio` as its WebDriver client, driving the app under `tauri-driver`, one app at a time. Run by
 * `test:desktop` after `build:app`. P5-A9 (`test/mail.test.ts`) runs on Linux alone: on Windows the mail engine's
 * `test-world` is refused (the mail plugin's specification, 12.4), and macOS runs `test:macos`.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 6 specification, 19).
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/**/*.test.ts'],
		exclude: [
			...configDefaults.exclude,
			'test/macos/**',
			'test/installers/**',
			...(process.platform === 'win32' ? ['test/mail.test.ts'] : []),
		],
		environment: 'node',
		testTimeout: 120_000,
		hookTimeout: 180_000,
		fileParallelism: false,
	},
});
