import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertOverridesApplied } from './pnpm.mjs';

function makeConsumer(t, { entries = [], lockfile = '' }) {
	const root = mkdtempSync(join(tmpdir(), 'afd-pnpm-overrides-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const store = join(root, 'node_modules', '.pnpm');
	mkdirSync(store, { recursive: true });
	for (const { dir, pkg } of entries) {
		mkdirSync(join(store, dir, 'node_modules', pkg), { recursive: true });
	}
	if (lockfile !== null) {
		writeFileSync(join(root, 'pnpm-lock.yaml'), lockfile);
	}
	return root;
}

test('rejects Windows hash-truncated registry copy ending at @_<md5>', (t) => {
	const root = makeConsumer(t, {
		entries: [
			{
				dir: '@better-auth+mongo-adapter@_4e630d758b5ee920c0d23beb5a3b5a59',
				pkg: '@better-auth/mongo-adapter',
			},
		],
		lockfile: [
			"lockfileVersion: '9.0'",
			'packages:',
			"  '@better-auth/mongo-adapter@1.7.26':",
			'    resolution: {integrity: sha512-abc}',
		].join('\n'),
	});

	assert.throws(
		() =>
			assertOverridesApplied(root, {
				'@better-auth/mongo-adapter': 'file:never-installed.tgz',
			}),
		/should resolve to the packed tarball/
	);
});

test('rejects Windows hash-truncated registry copy clipped before @', (t) => {
	const root = makeConsumer(t, {
		entries: [
			{
				dir: '@better-auth+drizzle-adapte_1f4b230beec8eb9fe565d15e7af554b6',
				pkg: '@better-auth/drizzle-adapter',
			},
		],
		lockfile: [
			"lockfileVersion: '9.0'",
			'packages:',
			"  '@better-auth/drizzle-adapter@1.7.26':",
			'    resolution: {integrity: sha512-def}',
		].join('\n'),
	});

	assert.throws(
		() =>
			assertOverridesApplied(root, {
				'@better-auth/drizzle-adapter': 'file:never-installed.tgz',
			}),
		/should resolve to the packed tarball/
	);
});

test('accepts a Windows hash-truncated file tarball cut right after @file, without a lockfile', (t) => {
	const root = makeConsumer(t, {
		entries: [
			{
				dir: '@lushly-dev+afd-server@file_3974bcf2c8672c228d10543bfb81b424',
				pkg: '@lushly-dev/afd-server',
			},
		],
		lockfile: null,
	});

	assertOverridesApplied(root, { '@lushly-dev/afd-server': 'file:../tarballs/server.tgz' });
});

test('rejects a file-like store entry with an invalid hash', (t) => {
	const root = makeConsumer(t, {
		entries: [{ dir: '@lushly-dev+afd-server@file_not-a-hash', pkg: '@lushly-dev/afd-server' }],
		lockfile: null,
	});

	assert.throws(
		() => assertOverridesApplied(root, { '@lushly-dev/afd-server': 'file:../tarballs/server.tgz' }),
		/should resolve to the packed tarball/
	);
});

test('accepts Windows hash-truncated file tarball when lockfile confirms file: resolution', (t) => {
	const root = makeConsumer(t, {
		entries: [
			{
				dir: '@lushly-dev+specimen-win32-x64@fi_0123456789abcdef0123456789abcdef',
				pkg: '@lushly-dev/specimen-win32-x64',
			},
		],
		lockfile: [
			"lockfileVersion: '9.0'",
			'packages:',
			"  '@lushly-dev/specimen-win32-x64@file:../tarballs/specimen-win32-x64.tgz':",
			'    resolution: {tarball: file:../tarballs/specimen-win32-x64.tgz}',
		].join('\n'),
	});

	assertOverridesApplied(root, {
		'@lushly-dev/specimen-win32-x64': 'file:../tarballs/specimen-win32-x64.tgz',
	});
});

test('verifies scoped a>b overrides against snapshots when b is truncated and coexists with registry b', (t) => {
	const root = makeConsumer(t, {
		entries: [
			{ dir: 'parent@1.0.0', pkg: 'parent' },
			{
				dir: '@scope+very-long-pkg-name@fi_0123456789abcdef0123456789abcdef',
				pkg: '@scope/very-long-pkg-name',
			},
		],
		lockfile: [
			"lockfileVersion: '9.0'",
			'packages:',
			"  '@scope/very-long-pkg-name@1.0.0':",
			'    resolution: {integrity: sha512-reg}',
			"  '@scope/very-long-pkg-name@file:../tarballs/pkg.tgz':",
			'    resolution: {tarball: file:../tarballs/pkg.tgz}',
			'snapshots:',
			'  parent@1.0.0:',
			'    dependencies:',
			"      '@scope/very-long-pkg-name': 1.0.0",
		].join('\n'),
	});

	const parentDeps = join(root, 'node_modules', '.pnpm', 'parent@1.0.0', 'node_modules', '@scope');
	mkdirSync(parentDeps, { recursive: true });
	symlinkSync(
		join(
			root,
			'node_modules',
			'.pnpm',
			'@scope+very-long-pkg-name@fi_0123456789abcdef0123456789abcdef',
			'node_modules',
			'@scope',
			'very-long-pkg-name'
		),
		join(parentDeps, 'very-long-pkg-name'),
		'junction'
	);

	assert.throws(
		() =>
			assertOverridesApplied(root, {
				'parent>@scope/very-long-pkg-name': 'file:../tarballs/pkg.tgz',
			}),
		/should resolve to the packed tarball/
	);
});
