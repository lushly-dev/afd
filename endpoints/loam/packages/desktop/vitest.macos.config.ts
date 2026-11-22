import { defineConfig } from 'vitest/config';

/**
 * Loam desktop's macOS WKWebView suite (#1779, D153, P6-D4): launches the built `loam-desktop` binary
 * directly on macOS (where no WKWebView WebDriver exists) and measures the frame-to-IPC barrier across the
 * proxy, opaque view and copilot frames with a main-frame control. Run by `test:macos` after `build:app`.
 */
export default defineConfig({
	test: {
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/macos/**/*.test.ts'],
		environment: 'node',
		testTimeout: 120_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
