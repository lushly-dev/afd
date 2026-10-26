import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertValidConvexModulePaths, discoverConvexEntryPoints } from './module-paths.mjs';

test('Convex path guard accepts legal identifiers and rejects hyphenated modules', () => {
	assert.deepEqual(assertValidConvexModulePaths(['github_provider.mjs', 'oauth_user.d.ts']), [
		'github_provider.mjs',
		'oauth_user.d.ts',
	]);
	assert.throws(
		() => assertValidConvexModulePaths(['github-provider.mjs']),
		/Convex module path component is not supported/
	);
	assert.throws(
		() => assertValidConvexModulePaths(['nested-folder/auth.js']),
		/Convex module path component is not supported/
	);
});

test('discovery follows the pinned Convex CLI deployable entrypoint filters', async () => {
	const root = await mkdtemp(join(tmpdir(), 'afd-convex-module-paths-'));
	try {
		await mkdir(join(root, '_generated'), { recursive: true });
		await mkdir(join(root, 'nested'), { recursive: true });
		await writeFile(join(root, 'github_provider.mjs'), 'export {};');
		await writeFile(join(root, 'oauth_user.mjs'), 'export {};');
		await writeFile(join(root, 'auth.config.ts'), 'export {};');
		await writeFile(join(root, 'schema.ts'), 'export {};');
		await writeFile(join(root, 'oauth_user.test.mjs'), 'export {};');
		await writeFile(join(root, '_generated', 'api.ts'), 'export {};');
		await writeFile(join(root, 'nested', 'users.ts'), 'export {};');

		assert.deepEqual(await discoverConvexEntryPoints(root), [
			'github_provider.mjs',
			'nested/users.ts',
			'oauth_user.mjs',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('discovery rejects files in the Convex CLI reserved _deps directory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'afd-convex-reserved-deps-'));
	try {
		await mkdir(join(root, '_deps'), { recursive: true });
		await writeFile(join(root, '_deps', 'README.md'), 'reserved by Convex CLI');

		await assert.rejects(
			discoverConvexEntryPoints(root),
			/Convex CLI rejects files in the reserved _deps directory/
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
