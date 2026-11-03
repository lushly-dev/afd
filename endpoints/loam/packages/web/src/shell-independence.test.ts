/**
 * No file of the kernel, the chrome or the web host names the project-scoped app (phase 2 specification,
 * section 1, step 6), as phase 1's E5 holds for its second app: it lands from a deployment entry alone. The kernel's
 * own tests and its scoped fixture name a fixture app of that name since step 4, which is not the package,
 * so they, and this file, are left out of the scan.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
/** Built from parts, so this file holds no whole word to find. */
const NAME = new RegExp(`\\b${['ta', 'sks'].join('')}\\b`, 'i');

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (name === 'node_modules' || name === 'dist' || name === 'coverage') return [];
		return statSync(path).isDirectory() ? sources(path) : [path];
	});
}

describe('the shell names no app', () => {
	it('names the project-scoped app nowhere in the kernel, the chrome or the host', () => {
		const kernelFixture = (path: string) =>
			path.endsWith('.test.ts') || path.endsWith(join('scope', 'fixtures.ts'));
		const offenders = [
			...sources(join(PACKAGES, 'kernel/src')).filter((path) => !kernelFixture(path)),
			...sources(join(PACKAGES, 'chrome')),
			...sources(join(PACKAGES, 'web/src')).filter((path) => path !== SELF),
		]
			.filter((path) => NAME.test(readFileSync(path, 'utf8')))
			.map((path) => relative(PACKAGES, path));
		expect(offenders).toEqual([]);
	});

	it('names its package, directory or element nowhere, fixtures, tests and manifests included', () => {
		// Built from parts too, and with no exclusion but this file.
		const app = ['ta', 'sks'].join('');
		const named = new RegExp(`loam-app-${app}|apps/${app}|${app}-main`);
		const offenders = [
			...sources(join(PACKAGES, 'kernel')),
			...sources(join(PACKAGES, 'chrome')),
			...sources(join(PACKAGES, 'web/src')),
		]
			.filter((path) => path !== SELF && named.test(readFileSync(path, 'utf8')))
			.map((path) => relative(PACKAGES, path));
		expect(offenders).toEqual([]);
	});
});
