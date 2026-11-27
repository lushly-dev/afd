import { defineConfig } from 'vitest/config';

/**
 * The suites that run in Firefox and WebKit as well as Chromium (#706), against the built `dist/index.html`: the mount
 * and its scoped registry (E1, and in Firefox the support floor's case, D174), the sandboxed
 * view in real frames (E2, with 9.7's navigation and WebRTC cases) and phase 4's I8 chord. One project per engine,
 * which sets `LOAM_ENGINE` (`test/browser/harness.ts`): run one with `--project`, as `test:firefox` and `test:webkit`
 * do, after `pnpm build`. Run by `loam.yml`'s Firefox and WebKit jobs.
 */
const engine = (name: 'firefox' | 'webkit') => ({
	extends: true,
	test: { name, env: { LOAM_ENGINE: name } },
});

export default defineConfig({
	test: {
		// Each test's title in the log, as `vitest.browser.config.ts` gives it.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: [
			'test/browser/apps/native.test.ts',
			'test/browser/apps/view.test.ts',
			'test/browser/engines/**/*.test.ts',
		],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
		projects: [engine('firefox'), engine('webkit')],
	},
});
