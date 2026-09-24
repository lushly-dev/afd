import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_PACKAGE_DIR, staleOutputs, WORKSPACE_DEPENDENCIES } from '../vitest.global-setup.js';

describe('staleOutputs (e2e build freshness)', () => {
	let pkg: string;

	async function file(path: string, mtimeSeconds: number): Promise<void> {
		const full = join(pkg, path);
		await mkdir(join(full, '..'), { recursive: true });
		await writeFile(full, '');
		await utimes(full, mtimeSeconds, mtimeSeconds);
	}

	beforeEach(async () => {
		pkg = await mkdtemp(join(tmpdir(), 'afd-cli-freshness-'));
	});

	afterEach(async () => {
		await rm(pkg, { recursive: true, force: true });
	});

	it('reports sources whose output is missing or older, ignoring tests and declarations', async () => {
		await file('src/fresh.ts', 1000);
		await file('dist/fresh.js', 2000);
		await file('src/same-time.ts', 1000);
		await file('dist/same-time.js', 1000);
		await file('src/nested/edited.ts', 3000);
		await file('dist/nested/edited.js', 2000);
		await file('src/added.ts', 1000);
		await file('src/added.test.ts', 9000);
		await file('src/types.d.ts', 9000);

		expect(staleOutputs(pkg).sort()).toEqual(['added.ts', join('nested', 'edited.ts')]);
	});

	it('treats a package without src as fresh', () => {
		expect(staleOutputs(pkg)).toEqual([]);
	});

	it('checks the CLI and the workspace packages it runs on', () => {
		expect(
			WORKSPACE_DEPENDENCIES.map((dir) => join(dir, '..') === join(CLI_PACKAGE_DIR, '..'))
		).toEqual([true, true, true, true]);
		expect(WORKSPACE_DEPENDENCIES.map((dir) => dir.split(/[\\/]/).at(-1))).toEqual([
			'core',
			'client',
			'server',
			'testing',
		]);
	});
});
