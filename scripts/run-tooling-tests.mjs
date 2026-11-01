#!/usr/bin/env node
/**
 * Runs the repository tooling tests. Git hooks export repository-local variables; fixtures must
 * never inherit them.
 *
 * The release-tooling suites exercise release scripts against temporary fixture repositories and
 * read only release inputs, so they are skipped when the change since the merge base with
 * origin/main (or AFD_BASE) touches none of RELEASE_INPUTS. `--all` or AFD_SCOPE=all runs them all.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASES, resolveScope } from './affected/scope.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const testFiles = [
	'scripts/check-file-size.test.mjs',
	'scripts/check-versions.test.mjs',
	'scripts/repository-contract.test.mjs',
	'scripts/check-boundaries.test.mjs',
	'scripts/skill-profiles.test.mjs',
	'scripts/specimen-provenance.test.mjs',
	'scripts/fast-af-provenance.test.mjs',
	'scripts/violet-provenance.test.mjs',
	'scripts/release-control.test.mjs',
	'scripts/release/changeset.test.mjs',
	'scripts/release/control.test.mjs',
	'scripts/release/fragments.test.mjs',
	'scripts/release/language.test.mjs',
	'scripts/release/manifest-requirements.test.mjs',
	'scripts/release-native.test.mjs',
	'scripts/release-finalize.test.mjs',
	'scripts/release-claim.test.mjs',
	'scripts/release-readback.test.mjs',
	'scripts/registry-readback.test.mjs',
	'scripts/release-recovery-approval.test.mjs',
	'scripts/run-tooling-tests.test.mjs',
	'scripts/affected.test.mjs',
];

/** Suites that test the release tooling with fixture repositories. */
export const releaseTestFiles = testFiles.filter((file) =>
	/^scripts\/(release[-/]|registry-readback)/.test(file)
);

/** Repository paths the release-tooling suites read; a change to any of them runs the suites. */
export const RELEASE_INPUTS = [
	'.changeset/',
	'.github/workflows/',
	'.nvmrc',
	'.release/',
	'package.json',
	'pnpm-lock.yaml',
	'scripts/',
];

/** The test files to run for a resolved scope, and the reason any were skipped. */
export function selectToolingTests(scope, files = testFiles) {
	if (scope.mode === 'all') return { files };
	if (scope.files.some((file) => RELEASE_INPUTS.some((input) => file.startsWith(input))))
		return { files };
	return {
		files: files.filter((file) => !releaseTestFiles.includes(file)),
		skipped: `release-tooling suites skipped: no change to ${RELEASE_INPUTS.join(', ')}`,
	};
}

export function fixtureEnvironment(environment = process.env) {
	return Object.fromEntries(
		Object.entries(environment).filter(
			([name]) => !name.startsWith('GIT_') && name !== 'NODE_TEST_CONTEXT'
		)
	);
}

export function runToolingTests({
	directory = root,
	files = testFiles,
	environment = process.env,
} = {}) {
	return execFileSync(process.execPath, ['--test', ...files], {
		cwd: directory,
		env: fixtureEnvironment(environment),
		stdio: 'inherit',
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const scope = resolveScope({
			root,
			all: process.argv.includes('--all') || process.env.AFD_SCOPE === 'all',
			bases: process.env.AFD_BASE ? [process.env.AFD_BASE] : DEFAULT_BASES,
		});
		const { files, skipped } = selectToolingTests(scope);
		if (skipped) console.error(`[affected] ${skipped}`);
		runToolingTests({ files });
	} catch (error) {
		process.exitCode = error.status || 1;
	}
}
