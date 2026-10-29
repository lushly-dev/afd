import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fragmentOperation } from './fragments.mjs';

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'afd-fragments-'));
	const units = ['a', 'b'].map((id) => ({
		id,
		protocol: 'npm-changesets',
		distributions: [{ name: `@fixture/${id}`, manifest: `packages/${id}/package.json` }],
	}));
	const inventory = {
		schemaVersion: 1,
		units,
		storages: [{ path: '.changeset', protocol: 'npm-changesets' }],
	};
	for (const [file, text] of Object.entries({
		'package.json': '{"name":"fixture","private":true,"workspaces":["packages/*"]}',
		'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
		'packages/a/package.json': '{"name":"@fixture/a","version":"1.0.0"}',
		'packages/b/package.json': '{"name":"@fixture/b","version":"1.0.0"}',
		'.changeset/config.json':
			'{"changelog":false,"commit":false,"fixed":[],"linked":[],"access":"public","baseBranch":"main","updateInternalDependencies":"patch","ignore":[]}',
		'.changeset/held-b.md': '---\n"@fixture/b": patch\n---\nHeld unit intent\n',
	})) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), text);
	}
	execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
	execFileSync('git', ['add', '.'], { cwd: root });
	execFileSync(
		'git',
		[
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'--no-verify',
			'-m',
			'Fixture',
		],
		{ cwd: root, stdio: 'pipe' }
	);
	return { root, inventory, selectedUnits: ['a'], protocol: 'npm-changesets' };
}
test('scoped npm adapter creates official Changesets-compatible intent, status and delete preserve B', () => {
	const f = fixture();
	const held = readFileSync(join(f.root, '.changeset/held-b.md'), 'utf8');
	fragmentOperation({
		...f,
		operation: 'create',
		intent: { id: 'a-change', changes: [{ name: '@fixture/a', type: 'patch' }], summary: 'A fix' },
		execute: true,
	});
	const official = spawnSync(
		resolve('node_modules/.bin/changeset'),
		['status', '--output', join(f.root, 'status.json')],
		{ cwd: f.root, encoding: 'utf8' }
	);
	assert.equal(official.status, 0, official.stderr || official.stdout);
	assert.equal(
		JSON.parse(readFileSync(join(f.root, 'status.json'), 'utf8')).changesets.some(
			(entry) => entry.id === 'a-change'
		),
		true
	);
	assert.deepEqual(fragmentOperation({ ...f, operation: 'status' }).files, [
		'.changeset/a-change.md',
	]);
	fragmentOperation({ ...f, operation: 'delete', execute: true });
	assert.equal(existsSync(join(f.root, '.changeset/a-change.md')), false);
	assert.equal(readFileSync(join(f.root, '.changeset/held-b.md'), 'utf8'), held);
});
test('unknown format, partial coordinated selection and foreign create reject before writes', () => {
	const f = fixture();
	assert.throws(
		() =>
			fragmentOperation({
				...f,
				operation: 'create',
				intent: {
					id: 'foreign',
					changes: [{ name: '@fixture/b', type: 'major' }],
					summary: 'Wrong owner',
				},
				execute: true,
			}),
		/exactly/
	);
	writeFileSync(
		join(f.root, '.changeset/held-b.md'),
		'---\n"@fixture/a": patch\n"@fixture/b": patch\n---\nCoordinated\n'
	);
	assert.throws(
		() => fragmentOperation({ ...f, operation: 'consume', execute: true }),
		/coordinated/
	);
	writeFileSync(join(f.root, '.changeset/wrong.json'), '{}');
	assert.throws(() => fragmentOperation({ ...f, operation: 'delete', execute: true }), /format/);
	assert.equal(existsSync(join(f.root, '.changeset/held-b.md')), true);
});
