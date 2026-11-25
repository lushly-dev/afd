#!/usr/bin/env node
/**
 * Evicts what Rust builds no longer use from Cargo target directories, so a target directory
 * shared by many worktrees (CARGO_TARGET_DIR) does not grow without bound.
 *
 *   node scripts/rust-sweep.mjs [--dir <target>...] [--days <n>] [--max-gb <n>] [--dry-run] [--force]
 *
 * Cargo names each build of a crate or test binary `<name>-<hash>` in `deps/`, `build/` and
 * `.fingerprint/` (to Rust 1.99), or keeps it in its own `build/<package>/<hash>/` (from Cargo
 * 1.100, which has no `deps/` or `.fingerprint/`), and the hash covers the source path, so every
 * worktree, feature set and toolchain adds its own copies and nothing removes them. A sweep, per
 * profile directory:
 *   - deletes `incremental/` (the repository's .cargo/config.toml turns incremental off);
 *   - deletes every `<hash>` group none of whose files a build has read for `--days` (default 3):
 *     Cargo reads a group's fingerprint on every build that includes it, so a group still in
 *     some worktree's build graph stays;
 *   - wipes the profile directories if the target directory is still over `--max-gb`
 *     (default 60), and the next build starts clean.
 * Without `--dir` it sweeps $CARGO_TARGET_DIR, $CARGO_BUILD_TARGET_DIR, $UMBEL_TARGET_DIR,
 * $LOAM_UMBEL_TARGET_DIR, each Cargo workspace's resolved `[build] target-dir` (`.cargo/config[.toml]`
 * or `$CARGO_HOME/config[.toml]`), and the `target/` beside each workspace. It touches only
 * directories holding Cargo's CACHEDIR.TAG, and none while a cargo, rustc or clippy-driver process
 * runs, unless `--force`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCargoTargetDir } from './cargo-target.mjs';

const DAY = 24 * 60 * 60 * 1000;
const GIB = 1024 ** 3;
/** Cargo's per-build hash: 16 hex digits after a dash, ending the name or before an extension. */
const HASH = /-([0-9a-f]{16})(?=\.|$)/;
/** Cargo 1.100's per-build directory name under `build/<package>/`. */
const HASH_DIR = /^[0-9a-f]{16}$/;
const HASHED = ['deps', 'build', '.fingerprint'];
/** What only a profile directory holds, in either layout. */
const PROFILE_MARKERS = ['deps', 'build', '.fingerprint', 'incremental'];
const BUILDERS = new Set(['cargo', 'rustc', 'clippy-driver']);

export function parseSweepArgs(argv) {
	const options = { dirs: [], days: 3, maxGb: 60, dryRun: false, force: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const number = () => {
			const value = Number(argv[++index]);
			if (!Number.isFinite(value) || value < 0) throw new Error(`${arg} takes a number`);
			return value;
		};
		if (arg === '--dir') options.dirs.push(resolve(argv[++index]));
		else if (arg === '--days') options.days = number();
		else if (arg === '--max-gb') options.maxGb = number();
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--force') options.force = true;
		else throw new Error(`unknown option ${arg}`);
	}
	return options;
}

/** Process-listing command for this platform: `tasklist` on Windows (Git Bash's `ps` has no `-A`), `ps` elsewhere (#2171). */
export function processListCommand(platform = process.platform, env = process.env) {
	if (platform === 'win32') {
		const root = env.SystemRoot ?? env.windir;
		return {
			file: root ? win32.join(root, 'System32', 'tasklist.exe') : 'tasklist.exe',
			args: ['/FO', 'CSV', '/NH'],
		};
	}
	return { file: 'ps', args: ['-Ao', 'comm'] };
}

function processName(line) {
	const trimmed = line.trim();
	if (!trimmed) return '';
	const csv = /^"([^"]+)",/.exec(trimmed);
	const raw = csv ? csv[1] : trimmed;
	const base = raw.split(/[\\/]/).at(-1) ?? '';
	return base.toLowerCase().replace(/\.exe$/, '');
}

/** Whether a Rust build is running on this machine; `null` when that cannot be told. */
export function rustBuildRunning(
	list = () => {
		const { file, args } = processListCommand();
		return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	}
) {
	let output;
	try {
		output = list();
	} catch {
		return null;
	}
	const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
	if (lines.length === 0) return null;
	return lines.some((line) => BUILDERS.has(processName(line)));
}

/** The default target directories: the environment's, each workspace's resolved Cargo target-dir, and each workspace's own `target/`. */
export function defaultTargets(root, env = process.env, { homeDir } = {}) {
	let manifests = [];
	try {
		manifests = execFileSync('git', ['ls-files', '*Cargo.toml', 'Cargo.toml'], {
			cwd: root,
			encoding: 'utf8',
		})
			.split('\n')
			.filter(Boolean);
	} catch {}
	const resolveOpts = homeDir !== undefined ? { env, homeDir } : { env };
	const workspaces = manifests.map((manifest) => join(root, dirname(manifest)));
	const dirs = [
		env.CARGO_TARGET_DIR,
		env.CARGO_BUILD_TARGET_DIR,
		env.UMBEL_TARGET_DIR,
		env.LOAM_UMBEL_TARGET_DIR,
		...workspaces.flatMap((ws) => [resolveCargoTargetDir(ws, resolveOpts), join(ws, 'target')]),
	].filter(Boolean);
	return [...new Set(dirs.map((dir) => resolve(root, dir)))];
}

/** Size in bytes and latest access time of a file or directory tree, counting hard links once. */
function measure(path, seen) {
	let bytes = 0;
	let used = 0;
	const visit = (entry) => {
		let stat;
		try {
			stat = lstatSync(entry);
		} catch {
			return;
		}
		// Only files: listing a directory, as this sweep does, can refresh the directory's own time.
		if (!stat.isDirectory()) used = Math.max(used, stat.atimeMs, stat.mtimeMs);
		if (!seen.has(stat.ino)) {
			seen.add(stat.ino);
			bytes += stat.blocks * 512;
		}
		if (stat.isDirectory()) for (const child of readdirSync(entry)) visit(join(entry, child));
	};
	visit(path);
	return { bytes, used };
}

const isProfile = (dir) => PROFILE_MARKERS.some((marker) => existsSync(join(dir, marker)));

/**
 * Profile directories (`debug`, `release`, `<triple>/debug`, ...): those holding `deps/`,
 * `build/`, `.fingerprint/` or `incremental/`. `tmp/` is integration tests' scratch
 * (`CARGO_TARGET_TMPDIR`), never a profile.
 */
function profiles(target) {
	const found = [];
	for (const name of readdirSync(target)) {
		const dir = join(target, name);
		if (name === 'tmp' || !lstatSync(dir).isDirectory()) continue;
		if (isProfile(dir)) found.push(dir);
		else
			for (const inner of readdirSync(dir)) {
				const nested = join(dir, inner);
				if (lstatSync(nested).isDirectory() && isProfile(nested)) found.push(nested);
			}
	}
	return found;
}

/** A profile's builds as `[hash, path]`: `<name>-<hash>` entries, and `build/<package>/<hash>/`. */
function hashedEntries(profile) {
	const entries = [];
	for (const kind of HASHED) {
		const dir = join(profile, kind);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const hash = HASH.exec(name)?.[1];
			if (hash) entries.push([hash, path]);
			else if (kind === 'build' && lstatSync(path).isDirectory())
				for (const inner of readdirSync(path))
					if (HASH_DIR.test(inner)) entries.push([inner, join(path, inner)]);
		}
	}
	return entries;
}

/** Sweeps one target directory and reports what it freed, or why it touched nothing. */
export function sweepTarget(
	target,
	{ days = 3, maxGb = 60, dryRun = false, now = Date.now() } = {}
) {
	if (!existsSync(target)) return { target, skipped: 'absent' };
	if (!existsSync(join(target, 'CACHEDIR.TAG')))
		return { target, skipped: 'not a Cargo target directory (no CACHEDIR.TAG)' };
	const remove = (path) => {
		if (!dryRun) rmSync(path, { recursive: true, force: true });
	};
	const before = measure(target, new Set()).bytes;
	// rustc hard-links object files between incremental/ and deps/, so what a removal frees is
	// counted once per inode across the whole sweep.
	const counted = new Set();
	let freed = 0;
	let evicted = 0;
	const cutoff = now - days * DAY;
	for (const profile of profiles(target)) {
		const incremental = join(profile, 'incremental');
		if (existsSync(incremental)) {
			freed += measure(incremental, counted).bytes;
			remove(incremental);
		}
		const groups = new Map();
		for (const [hash, path] of hashedEntries(profile)) {
			const group = groups.get(hash) ?? { paths: [], used: 0 };
			group.paths.push(path);
			group.used = Math.max(group.used, measure(path, new Set()).used);
			groups.set(hash, group);
		}
		for (const group of groups.values()) {
			if (group.used >= cutoff) continue;
			for (const path of group.paths) {
				freed += measure(path, counted).bytes;
				remove(path);
			}
			evicted++;
		}
	}
	let wiped = false;
	if (before - freed > maxGb * GIB) {
		for (const profile of profiles(target)) remove(profile);
		wiped = true;
	}
	// A real sweep reports what the directory lost; a dry run, its estimate.
	if (!dryRun) freed = before - measure(target, new Set()).bytes;
	else if (wiped) freed = before;
	return { target, before, freed, evicted, wiped, dryRun };
}

const gb = (bytes) => `${(bytes / GIB).toFixed(1)} GB`;

export function describeSweep(result) {
	if (result.skipped) return `${result.target}: skipped, ${result.skipped}`;
	const verb = result.dryRun ? 'would free' : 'freed';
	const how = result.wiped
		? `over the cap, so every profile was wiped`
		: `${result.evicted} unused build(s) and incremental data`;
	return `${result.target}: ${verb} ${gb(result.freed)} of ${gb(result.before)} (${how})`;
}

/** Sweeps every target unless a Rust build is running; returns one line per target. */
export function sweep(targets, options, running = rustBuildRunning) {
	if (!options.force) {
		const busy = running();
		if (busy !== false)
			return [
				busy
					? 'skipped: a cargo, rustc or clippy-driver process is running (rerun later, or --force)'
					: 'skipped: cannot tell whether a Rust build is running (rerun with --force)',
			];
	}
	return targets
		.map((target) => sweepTarget(target, options))
		.filter((result) => result.skipped !== 'absent')
		.map(describeSweep);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	try {
		const options = parseSweepArgs(process.argv.slice(2));
		const targets = options.dirs.length > 0 ? options.dirs : defaultTargets(root);
		for (const line of sweep(targets, options)) console.log(line);
	} catch (error) {
		console.error(`rust-sweep: ${error.message}`);
		process.exitCode = 1;
	}
}
