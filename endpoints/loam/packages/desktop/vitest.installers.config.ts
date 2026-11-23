import { defineConfig } from 'vitest/config';

/**
 * Phase 6's P6-D5 installer and updater suite (specification, 10.6, 11.3, 14 and 19):
 * verifies each platform's unsigned installers and SHA-256 sums, records their sizes, and drives
 * `tauri-plugin-updater` over HTTPS with an ephemeral test CA and key (signed install, tamper
 * refusal, and zero update requests without a key). Runs in `Build the installers` on Linux,
 * Windows and macOS.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 6 specification, 19).
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/installers/**/*.test.ts'],
		environment: 'node',
		testTimeout: 180_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
