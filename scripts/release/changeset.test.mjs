import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runChangeset } from './changeset.mjs';
import { parseFragments } from './control.mjs';

const require = createRequire(import.meta.url);
function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'afd-changeset-guard-'));
	const inventory = {
		schemaVersion: 1,
		units: [
			{
				id: 'a',
				family: 'a',
				protocol: 'npm-changesets',
				sourceRevision: 'fixture',
				authority: 'fixture',
				state: 'admitted',
				routes: ['npm-main'],
				gates: ['fixture'],
				distributions: [
					{
						registry: 'npm',
						name: '@fixture/a',
						format: 'npm',
						manifest: 'packages/a/package.json',
					},
				],
			},
		],
	};
	const files = {
		'package.json': '{"name":"fixture","private":true,"workspaces":["packages/*"]}',
		'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
		'packages/a/package.json': '{"name":"@fixture/a","version":"1.0.0"}',
		'scripts/release/inventory.json': JSON.stringify(inventory),
		'.changeset/config.json':
			'{"changelog":false,"commit":false,"fixed":[],"linked":[],"access":"public","baseBranch":"main","updateInternalDependencies":"patch","ignore":[]}',
		'.changeset/existing.md': '---\n"@fixture/a": patch\n---\nExisting approved intent\n',
		'alfred/pyproject.toml': 'not a valid native project; npm command must not inspect it',
	};
	for (const [file, text] of Object.entries(files)) {
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
	return { root, inventory };
}
const installed = (args, root) =>
	execFileSync(process.execPath, [require.resolve('@changesets/cli'), ...args], {
		cwd: root,
		stdio: 'pipe',
	});
const fragmentBytes = (root) =>
	Object.fromEntries(
		readdirSync(join(root, '.changeset')).map((name) => [
			name,
			readFileSync(join(root, '.changeset', name), 'utf8'),
		])
	);

test('mixed npm/category formats reject before invoking installed CLI', () => {
	const { root } = fixture();
	writeFileSync(join(root, '.changeset/foreign.md'), '---\ntype: fixed\n---\nWrong protocol\n');
	let calls = 0;
	assert.throws(
		() => runChangeset({ root, args: ['add', '--empty'], execute: () => calls++ }),
		/Incompatible npm fragment/
	);
	assert.equal(calls, 0);
});
test('actual status is read-only and native unknown Alfred does not block npm intent', () => {
	const { root } = fixture();
	const before = fragmentBytes(root);
	runChangeset({ root, args: ['status', '--verbose'], execute: installed });
	assert.deepEqual(fragmentBytes(root), before);
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});
test('actual --empty creation remains valid npm intent and preserves existing fragments', () => {
	const { root, inventory } = fixture();
	const before = fragmentBytes(root);
	runChangeset({ root, args: ['--empty'], execute: installed });
	const after = fragmentBytes(root);
	assert.equal(after['existing.md'], before['existing.md']);
	const fragments = parseFragments(root, inventory);
	assert.equal(fragments.length, 2);
	assert.equal(
		fragments.some((fragment) => fragment.packages.length === 0),
		true
	);
});
test('raw publishers/versioners and flag-position command bypasses cannot run', () => {
	const { root } = fixture();
	let calls = 0;
	for (const args of [['publish'], ['version'], ['--empty', 'publish'], ['add', 'publish']])
		assert.throws(
			() => runChangeset({ root, args, execute: () => calls++ }),
			/alias supports|Unsupported add/
		);
	assert.equal(calls, 0);
});
test('unknown npm identities need declared ownership before interactive package choice', () => {
	const { root } = fixture();
	mkdirSync(join(root, 'packages/import'), { recursive: true });
	writeFileSync(
		join(root, 'packages/import/package.json'),
		' {"name":"@fixture/import","version":"1.0.0"}'
	);
	let calls = 0;
	assert.throws(
		() => runChangeset({ root, args: [], execute: () => calls++ }),
		/Declare npm protocol ownership and quarantine/
	);
	assert.equal(calls, 0);
});
