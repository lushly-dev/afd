#!/usr/bin/env node
/** Git hooks export repository-local variables; fixtures must never inherit them. */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const testFiles = [
	'scripts/check-file-size.test.mjs',
	'scripts/check-versions.test.mjs',
	'scripts/repository-contract.test.mjs',
	'scripts/check-boundaries.test.mjs',
	'scripts/skill-profiles.test.mjs',
	'scripts/release-control.test.mjs',
	'scripts/release/changeset.test.mjs',
	'scripts/release/control.test.mjs',
	'scripts/release/fragments.test.mjs',
	'scripts/release/language.test.mjs',
	'scripts/release/manifest-requirements.test.mjs',
	'scripts/release-native.test.mjs',
	'scripts/release-finalize.test.mjs',
	'scripts/release-claim.test.mjs',
	'scripts/run-tooling-tests.test.mjs',
];

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
		runToolingTests();
	} catch (error) {
		process.exitCode = error.status || 1;
	}
}
