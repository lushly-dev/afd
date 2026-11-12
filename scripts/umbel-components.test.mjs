import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BINARY,
	binaryCandidates,
	exportPack,
	findBinary,
	overrideDirectory,
	PACK_TOML,
	prepareWorkspace,
	UMBEL_TOML,
} from './umbel-components.mjs';

function scratch(t) {
	const root = mkdtempSync(join(tmpdir(), 'umbel-components-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test('an explicit binary is the only candidate', () => {
	assert.deepEqual(binaryCandidates({ UMBEL_FIRST_PARTY: '/opt/umbel/umbel-first-party' }, '/r'), [
		'/opt/umbel/umbel-first-party',
	]);
});

test('release builds come before debug, the shared target before the checkout', () => {
	assert.deepEqual(binaryCandidates({ CARGO_TARGET_DIR: '/cache/target' }, '/r'), [
		`/cache/target/release/${BINARY}`,
		`/r/endpoints/umbel/target/release/${BINARY}`,
		`/cache/target/debug/${BINARY}`,
		`/r/endpoints/umbel/target/debug/${BINARY}`,
	]);
	assert.deepEqual(binaryCandidates({}, '/r'), [
		`/r/endpoints/umbel/target/release/${BINARY}`,
		`/r/endpoints/umbel/target/debug/${BINARY}`,
	]);
});

test('a release binary wins over a newer debug one, and the newest release wins', () => {
	const file = (mtimeMs) => ({ isFile: () => true, mtimeMs });
	const stats = {
		'/a/release/x': file(1),
		'/b/release/x': file(2),
		'/a/debug/x': file(9),
	};
	const stat = (path) => stats[path] ?? null;
	assert.equal(findBinary(['/a/release/x', '/b/release/x', '/a/debug/x'], stat), '/b/release/x');
	assert.equal(findBinary(['/c/release/x', '/a/debug/x'], stat), '/a/debug/x');
	assert.equal(findBinary(['/c/release/x'], stat), null);
});

test('the workspace serves the components plugin alone, and keeps a deployer pack.toml', (t) => {
	const workspace = scratch(t);
	const override = prepareWorkspace(workspace);
	assert.equal(override, overrideDirectory(workspace));
	assert.equal(readFileSync(join(workspace, 'umbel.toml'), 'utf8'), UMBEL_TOML);
	assert.match(UMBEL_TOML, /enabled = \["components"\]/);
	assert.equal(readFileSync(join(override, 'pack.toml'), 'utf8'), PACK_TOML);
	writeFileSync(join(override, 'pack.toml'), 'pack_version = 1\nid = "mine"\n');
	writeFileSync(join(workspace, 'umbel.toml'), 'edited');
	prepareWorkspace(workspace);
	assert.equal(
		readFileSync(join(override, 'pack.toml'), 'utf8'),
		'pack_version = 1\nid = "mine"\n'
	);
	assert.equal(readFileSync(join(workspace, 'umbel.toml'), 'utf8'), UMBEL_TOML);
});

test('an export with no Specimen CLI fails with a suggestion, and starts nothing', (t) => {
	const root = scratch(t);
	const result = exportPack(join(root, 'override'), root);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'SPECIMEN_CLI_NOT_BUILT');
	assert.match(result.error.suggestion, /pnpm build/);
});
