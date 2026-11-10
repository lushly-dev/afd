import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseSweepArgs, rustBuildRunning, sweep, sweepTarget } from './rust-sweep.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-08T12:00:00Z');

/** A Cargo target directory: `files` maps a path to its age in days and its size in bytes. */
function target(t, files, { tag = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'rust-sweep-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	if (tag)
		writeFileSync(join(root, 'CACHEDIR.TAG'), 'Signature: 8a477f597d28d172789f06886806bc55\n');
	for (const [path, [age, size = 4096]] of Object.entries(files)) {
		const file = join(root, path);
		mkdirSync(join(file, '..'), { recursive: true });
		writeFileSync(file, Buffer.alloc(size));
		const when = new Date(NOW - age * DAY);
		utimesSync(file, when, when);
		utimesSync(join(file, '..'), when, when);
	}
	return root;
}

test('a sweep evicts the builds no build has read, by hash, and incremental data', (t) => {
	const root = target(t, {
		// Read today through its fingerprint: an old rlib in a live build graph stays.
		'debug/deps/libumbel-0123456789abcdef.rlib': [9],
		'debug/.fingerprint/umbel-0123456789abcdef/lib-umbel': [0],
		// Another worktree's copy, unread for a week: every file of its hash goes.
		'debug/deps/libumbel-fedcba9876543210.rlib': [7],
		'debug/deps/umbel-fedcba9876543210.d': [7],
		'debug/deps/umbel-fedcba9876543210.umbel.abc-cgu.0.rcgu.o': [7],
		'debug/.fingerprint/umbel-fedcba9876543210/lib-umbel': [7],
		'debug/build/ring-fedcba9876543210/output': [7],
		'debug/incremental/umbel-1x2y3z/s-abc/dep-graph.bin': [0],
		'wasm32-wasip2/release/deps/hello-aaaaaaaaaaaaaaaa.wasm': [8],
		// The uplifted binary has no hash and is left for Cargo to overwrite.
		'debug/umbel': [7],
	});
	const dry = sweepTarget(root, { days: 3, now: NOW, dryRun: true });
	assert.equal(dry.evicted, 2);
	assert.ok(existsSync(join(root, 'debug/deps/libumbel-fedcba9876543210.rlib')));

	const result = sweepTarget(root, { days: 3, now: NOW });
	assert.equal(result.evicted, 2);
	assert.equal(result.wiped, false);
	assert.ok(result.freed > 0);
	assert.ok(existsSync(join(root, 'debug/deps/libumbel-0123456789abcdef.rlib')));
	for (const gone of [
		'debug/deps/libumbel-fedcba9876543210.rlib',
		'debug/deps/umbel-fedcba9876543210.d',
		'debug/deps/umbel-fedcba9876543210.umbel.abc-cgu.0.rcgu.o',
		'debug/.fingerprint/umbel-fedcba9876543210',
		'debug/build/ring-fedcba9876543210',
		'debug/incremental',
		'wasm32-wasip2/release/deps/hello-aaaaaaaaaaaaaaaa.wasm',
	])
		assert.ok(!existsSync(join(root, gone)), gone);
	assert.ok(existsSync(join(root, 'debug/umbel')));
});

test('a target directory still over the cap is wiped, keeping its tag', (t) => {
	const root = target(t, { 'debug/deps/libafd-0123456789abcdef.rlib': [0, 64 * 1024] });
	const result = sweepTarget(root, { days: 3, maxGb: 0, now: NOW });
	assert.equal(result.wiped, true);
	assert.ok(!existsSync(join(root, 'debug')));
	assert.ok(existsSync(join(root, 'CACHEDIR.TAG')));
});

test('only Cargo target directories are swept, and none while a Rust build runs', (t) => {
	const plain = target(t, { 'debug/deps/libafd-0123456789abcdef.rlib': [9] }, { tag: false });
	assert.match(sweepTarget(plain, { now: NOW }).skipped, /CACHEDIR\.TAG/);
	assert.ok(existsSync(join(plain, 'debug/deps/libafd-0123456789abcdef.rlib')));

	const root = target(t, { 'debug/deps/libafd-0123456789abcdef.rlib': [9] });
	const absent = join(root, 'missing');
	assert.match(sweep([root, absent], { now: NOW }, () => true)[0], /process is running/);
	assert.match(sweep([root], { now: NOW }, () => null)[0], /cannot tell/);
	assert.ok(existsSync(join(root, 'debug/deps/libafd-0123456789abcdef.rlib')));
	const lines = sweep([root, absent], { days: 3, now: NOW }, () => false);
	assert.equal(lines.length, 1, 'an absent directory is not reported');
	assert.match(lines[0], /freed .* \(1 unused build/);
	assert.ok(!existsSync(join(root, 'debug/deps/libafd-0123456789abcdef.rlib')));
});

test('process names and options are read as Cargo and the command line give them', () => {
	const ps = (names) => () => `COMM\n${names.join('\n')}\n`;
	assert.equal(rustBuildRunning(ps(['/sbin/launchd', 'node'])), false);
	assert.equal(rustBuildRunning(ps(['/opt/rustup/toolchains/x/bin/rustc'])), true);
	assert.equal(rustBuildRunning(ps(['cargo'])), true);
	assert.equal(
		rustBuildRunning(() => {
			throw new Error('no ps');
		}),
		null
	);
	const options = parseSweepArgs(['--dir', 'a', '--days', '1', '--max-gb', '20', '--dry-run']);
	assert.equal(options.days, 1);
	assert.equal(options.maxGb, 20);
	assert.equal(options.dryRun, true);
	assert.throws(() => parseSweepArgs(['--days', 'soon']), /takes a number/);
	assert.throws(() => parseSweepArgs(['--wipe']), /unknown option/);
});
