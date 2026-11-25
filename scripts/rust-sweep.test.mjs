import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	defaultTargets,
	parseSweepArgs,
	processListCommand,
	rustBuildRunning,
	sweep,
	sweepTarget,
} from './rust-sweep.mjs';

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

test("Cargo 1.100's layout is swept too: one build per build/<package>/<hash>/, and no deps/", (t) => {
	const root = target(t, {
		// Read today through its fingerprint: stays.
		'debug/build/umbel/0123456789abcdef/fingerprint/invoked.timestamp': [0],
		'debug/build/umbel/0123456789abcdef/out/libumbel-0123456789abcdef.rmeta': [9],
		// Unread for a week: the whole <hash> directory goes.
		'debug/build/umbel/fedcba9876543210/fingerprint/invoked.timestamp': [7],
		'debug/build/umbel/fedcba9876543210/out/plugin_component-fedcba9876543210': [7],
		'debug/incremental/umbel-1x2y3z/s-abc/dep-graph.bin': [0],
		'wasm32-wasip2/release/build/hello/aaaaaaaaaaaaaaaa/out/hello-aaaaaaaaaaaaaaaa.wasm': [8],
		// Integration tests' scratch (CARGO_TARGET_TMPDIR) is not a profile.
		'tmp/scratch/build/x/bbbbbbbbbbbbbbbb/file': [9],
		'debug/umbel': [7],
	});
	const result = sweepTarget(root, { days: 3, now: NOW });
	assert.equal(result.evicted, 2);
	assert.ok(existsSync(join(root, 'debug/build/umbel/0123456789abcdef/out')));
	for (const gone of [
		'debug/build/umbel/fedcba9876543210',
		'debug/incremental',
		'wasm32-wasip2/release/build/hello/aaaaaaaaaaaaaaaa',
	])
		assert.ok(!existsSync(join(root, gone)), gone);
	assert.ok(existsSync(join(root, 'tmp/scratch/build/x/bbbbbbbbbbbbbbbb/file')));
	assert.ok(existsSync(join(root, 'debug/umbel')));

	const capped = target(t, { 'debug/build/afd/0123456789abcdef/out/libafd.rmeta': [0, 64 * 1024] });
	assert.equal(sweepTarget(capped, { days: 3, maxGb: 0, now: NOW }).wiped, true);
	assert.ok(!existsSync(join(capped, 'debug')), 'the wipe reaches a profile with no deps/');
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
	assert.equal(
		rustBuildRunning(() => ''),
		null
	);

	// Windows tasklist /FO CSV /NH output (no header line, quoted image name with .exe, CRLF).
	const tasklist = (names) => () =>
		`${names.map((name, index) => `"${name}","${index + 1}","Console","1","10,000 K"`).join('\r\n')}\r\n`;
	assert.equal(rustBuildRunning(tasklist(['System Idle Process', 'node.exe'])), false);
	assert.equal(rustBuildRunning(tasklist(['cargo.exe'])), true);
	assert.equal(rustBuildRunning(tasklist(['node.exe', 'RUSTC.EXE'])), true);
	assert.equal(rustBuildRunning(tasklist(['clippy-driver.exe', 'node.exe'])), true);

	assert.deepEqual(processListCommand('linux'), { file: 'ps', args: ['-Ao', 'comm'] });
	// portability-ok: tests Windows SystemRoot path handling.
	const systemRoot = `${'X:'}\\Windows`;
	assert.deepEqual(processListCommand('win32', { SystemRoot: systemRoot }), {
		file: `${systemRoot}\\System32\\tasklist.exe`,
		args: ['/FO', 'CSV', '/NH'],
	});
	assert.deepEqual(processListCommand('win32', {}), {
		file: 'tasklist.exe',
		args: ['/FO', 'CSV', '/NH'],
	});
	// Live check on the host platform: must return a boolean, never null (catches ps -A failing on Windows).
	assert.equal(typeof rustBuildRunning(), 'boolean');

	const options = parseSweepArgs(['--dir', 'a', '--days', '1', '--max-gb', '20', '--dry-run']);
	assert.equal(options.days, 1);
	assert.equal(options.maxGb, 20);
	assert.equal(options.dryRun, true);
	assert.throws(() => parseSweepArgs(['--days', 'soon']), /takes a number/);
	assert.throws(() => parseSweepArgs(['--wipe']), /unknown option/);

	const targets = defaultTargets(tmpdir(), {
		CARGO_TARGET_DIR: join(tmpdir(), 'a'),
		CARGO_BUILD_TARGET_DIR: join(tmpdir(), 'b'),
		UMBEL_TARGET_DIR: join(tmpdir(), 'c'),
		LOAM_UMBEL_TARGET_DIR: join(tmpdir(), 'd'),
	});
	for (const name of ['a', 'b', 'c', 'd']) {
		assert.ok(targets.includes(join(tmpdir(), name)), `defaultTargets includes ${name}`);
	}
});

test('defaultTargets resolves workspace [build] target-dir configured only via .cargo/config.toml (#2241)', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'rust-sweep-config-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const repo = join(root, 'repo');
	const ws = join(repo, 'endpoints', 'umbel');
	const external = join(root, 'external-target');
	mkdirSync(join(ws, '.cargo'), { recursive: true });
	writeFileSync(join(ws, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n');
	writeFileSync(
		join(ws, '.cargo', 'config.toml'),
		`[build]\ntarget-dir = ${JSON.stringify(external)}\n`
	);
	const cleanEnv = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	execFileSync('git', ['init', '-q'], { cwd: repo, env: cleanEnv });
	execFileSync('git', ['add', 'endpoints/umbel/Cargo.toml'], { cwd: repo, env: cleanEnv });

	const targets = defaultTargets(repo, {}, { homeDir: null });
	assert.ok(targets.includes(external), `expected ${external} in ${JSON.stringify(targets)}`);
	assert.ok(targets.includes(join(ws, 'target')));
});
