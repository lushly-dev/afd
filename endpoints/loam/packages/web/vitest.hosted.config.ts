import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Places P6-H1's cold-start suite (`test/hosted/profile.test.ts`) ahead of every other hosted spec,
 * preserving the relative order of the rest (#2239).
 */
export function orderHostedSpecs<T extends { readonly moduleId: string }>(
	specs: readonly T[]
): T[] {
	const isProfile = (spec: T) =>
		/(?:^|\/)test\/hosted\/profile\.test\.ts$/.test(spec.moduleId.replace(/\\/g, '/'));
	return [...specs.filter(isProfile), ...specs.filter((spec) => !isProfile(spec))];
}

/**
 * Runs P6-H1's cold-start suite (`profile.test.ts`) first, before the Chromium, provider and relay
 * suites warm up or leave teardown churn behind (#2239).
 */
export class ProfileFirstSequencer extends BaseSequencer {
	override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
		return orderHostedSpecs(await super.sort(files));
	}
}

/**
 * The hosted criterion (phase 6 specification, section 19's "Hosted" place): Chromium against the built
 * shell served by `loam-host dev` in a child process, through `startDevHost`. Build the web host and
 * `loam-host` first. Run by `loam.yml`'s "Hosted development profile" job; one file at a time, since each
 * starts a server child beside Chromium. Part of the frozen hosted lane (Loam's D162; `architecture.json`'s
 * `lanes`), with `test/hosted/`, whose `cold-start-budget.test.ts` is a unit of P6-H1's ceiling and runs here too.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads. Naming a reporter drops the annotations
		// Vitest adds by default on GitHub, so they are named too.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/hosted/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
		sequence: {
			sequencer: ProfileFirstSequencer,
		},
	},
});
