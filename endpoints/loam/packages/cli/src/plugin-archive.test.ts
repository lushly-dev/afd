/**
 * @fileoverview `.loam-plugin` archives in `loam plugin check` and `loam plugin pack` (phase 5 no-terminal amendment,
 * 4.4's archive rules and 10; step 9a2): the shared archive cases in `loam-plugin-cases.json`, which loam-desktop's
 * Rust inspect (9c) runs too, and an archive `pack` writes, which checks as the directory bundle it holds, to the
 * same digest. Nothing an archive holds is run.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { bundlePathProblem } from '@lushly-dev/loam-manifest/plugin';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import {
	archiveAllowance,
	checkPluginArchive,
	entryRefusals,
	PLUGIN_ARCHIVE_EXTENSION,
	readBounded,
} from './plugin-archive.js';
import { PLUGIN_BUNDLE_LIMITS, pluginCheck } from './plugin-check.js';
import { packLockOf, packRecordOf, pluginPack, pluginPackWithHooks } from './plugin-pack.js';
import { temporaryDirectory } from './test-support.js';
import { readZip, writeZip } from './zip.js';
import { type CraftedArchive, type CraftedEntry, craft } from './zip-test-support.js';

const CASES = join(import.meta.dirname, '../../manifest/test/fixtures/loam-plugin-cases.json');

interface ArchiveCase {
	name: string;
	entries?: CraftedEntry[];
	remove?: string[];
	repeat?: CraftedEntry & { count: number; path: string };
	all?: CraftedEntry;
	base?: 'engine';
	set?: Record<string, CraftedEntry>;
	archive?: CraftedArchive;
	sha256: string;
	refusals?: Array<{ code: string; key: string; reason: string }>;
}

const { archives } = JSON.parse(readFileSync(CASES, 'utf8')) as {
	archives: {
		base: CraftedEntry[];
		engineBase: CraftedEntry[];
		valid: ArchiveCase[];
		refused: ArchiveCase[];
	};
};

/** One of the case's entries: deflated unless its method says otherwise, its deflate given as hex. */
function caseEntry(entry: CraftedEntry): CraftedEntry {
	if ((entry.method ?? 8) === 8 && entry.bodyHex === undefined)
		throw new Error(`A case's deflated entry carries its body: ${entry.path}`);
	return entry;
}

/** The case's archive, built as the cases' description says. */
function archiveOf(entry: ArchiveCase): Buffer {
	const { repeat } = entry;
	const repeated: CraftedEntry[] = repeat
		? Array.from({ length: repeat.count }, (_, n) => {
				const { count: _count, path, ...fields } = repeat;
				return { ...fields, path: path.replace('{n}', String(n)) };
			})
		: [];
	const base = entry.base === 'engine' ? archives.engineBase : archives.base;
	const entries = [
		...base
			.filter(({ path }) => !entry.remove?.includes(path ?? ''))
			.map((each) => ({ ...each, ...(entry.set?.[each.path ?? ''] ?? {}) })),
		...(entry.entries ?? []),
		...repeated,
	].map((each) => caseEntry({ ...each, ...(entry.all ?? {}) }));
	return craft(entries, entry.archive);
}

async function written(bytes: Buffer): Promise<string> {
	const path = join(await temporaryDirectory(), `case${PLUGIN_ARCHIVE_EXTENSION}`);
	await writeFile(path, bytes);
	return path;
}

const codes = (report: { refusals: { code: string; key: string }[] }) =>
	report.refusals.map(({ code, key }) => `${code} ${key}`);

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

describe("the shared archive cases (4.4's archive rules)", () => {
	it('builds each archive to the bytes its SHA-256 names, as a builder apart from this one did', () => {
		for (const entry of [...archives.valid, ...archives.refused])
			expect(sha256(archiveOf(entry)), entry.name).toBe(entry.sha256);
	});

	it.each(archives.valid.map((entry) => [entry.name, entry] as const))(
		'reads %s',
		async (_name, entry) => {
			const report = await pluginCheck({ dir: await written(archiveOf(entry)) });
			expect(codes(report)).toEqual([]);
			expect(report.form).toBe('archive');
			expect(report.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
		}
	);

	it.each(archives.refused.map((entry) => [entry.name, entry] as const))(
		'refuses %s',
		async (_name, entry) => {
			const report = await pluginCheck({ dir: await written(archiveOf(entry)) });
			expect(report.ok).toBe(false);
			// Each refusal by code, key and the stable reason 9c must give too.
			expect(
				report.refusals.map(({ code, key, reason }) => `${code} ${key} ${reason}`).sort()
			).toEqual(
				(entry.refusals ?? []).map(({ code, key, reason }) => `${code} ${key} ${reason}`).sort()
			);
		}
	);

	it('reads the base case as the bundle pack writes from the same files, to the same digest', async () => {
		const files = archives.base.map(({ path, text }) => ({
			path: path as string,
			data: Buffer.from(text ?? ''),
		}));
		const packed = await pluginCheck({ dir: await written(writeZip(files)) });
		const base = archives.valid.find(({ entries = [] }) => entries.length === 0) as ArchiveCase;
		const crafted = await pluginCheck({ dir: await written(archiveOf(base)) });
		expect(packed.bundleSha256).toBe(crafted.bundleSha256);
		expect(packed.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it('refuses an engine at mode 100644, and accepts it at 100755, by the manifest it names', async () => {
		const engine = archives.engineBase.find(({ executable }) => executable) as CraftedEntry;
		const at755 = await pluginCheck({ dir: await written(craft(archives.engineBase)) });
		expect(codes(at755)).toEqual([]);
		expect(at755.engines?.map(({ path }) => path)).toEqual([engine.path]);
		const at644 = await pluginCheck({
			dir: await written(
				craft(
					archives.engineBase.map((each) =>
						each === engine ? { ...each, executable: false } : each
					)
				)
			),
		});
		expect(at644.refusals).toEqual([
			expect.objectContaining({
				code: 'PLUGIN_MANIFEST_INVALID',
				key: engine.path,
				reason: 'mode-engine',
				message: expect.stringContaining('is an engine artifact and has mode 100644'),
			}),
		]);
		expect(at644.files).toBeUndefined();
		expect(at644.engines).toBeUndefined();
		expect(at644.bundleSha256).toBeUndefined();
	});

	it('refuses \u1e9e and \u00df by the fold, before anything is staged on a volume that might fold them itself', () => {
		const refusals = entryRefusals([
			{ path: 'apps/sketch/\u00df.js', data: Buffer.alloc(0), executable: false },
			{ path: 'apps/sketch/\u1e9e.js', data: Buffer.alloc(0), executable: false },
		]);
		expect(refusals).toEqual([
			expect.objectContaining({
				code: 'PLUGIN_PATH_ESCAPE',
				key: 'apps/sketch/\u1e9e.js',
				message: expect.stringContaining('fold to one name'),
			}),
		]);
	});
});

const PLUGIN = { version: '0.1.0', description: 'An app, for the tests of plugin pack.' };
/** A program that would leave a mark if anything ran it. */
const SENTINEL = (mark: string) => `#!/bin/sh\necho ran > "${mark}"\n`;

async function write(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

/** A Mail-shaped source, as plugin.test.ts makes one: two packed apps and an engine that would leave a mark if run. */
async function source(): Promise<{ dir: string; mark: string }> {
	const dir = join(await temporaryDirectory(), 'mail-plugin');
	const mark = join(dir, '..', 'ran');
	const engine = SENTINEL(mark);
	await write(
		dir,
		'loam-plugin.toml',
		`plugin_manifest_version = 1

[plugin]
id = "mail"
title = "Mail"
version = "0.1.0"
description = "Local mail sync, search, drafts and reply sets."

[[apps]]
id = "mail"
path = "apps/mail"

[[apps]]
id = "mailapp"
path = "apps/mailapp"

[engine]
id = "loam-mail"
kind = "http-service"
mount_app = "mail"
service_mode = "login"

[engine.artifacts."linux-x64"]
path = "engines/linux-x64/loam-mail"
sha256 = "${sha256(engine)}"

[engine.auth]
mode = "agent"
`
	);
	await write(
		dir,
		'apps/mail/app-manifest.json',
		JSON.stringify({
			manifest_version: 1,
			protocol: 1,
			plugin: { ...PLUGIN, title: 'Mail', id: 'mail', kind: 'mounted', domains: ['mail'] },
			mount: { prefix: 'mail', transport: 'http' },
		})
	);
	await write(
		dir,
		'apps/mailapp/app-manifest.json',
		JSON.stringify({
			manifest_version: 1,
			protocol: 1,
			plugin: { ...PLUGIN, title: 'Mail app', id: 'mailapp', kind: 'native', domains: ['mailapp'] },
			native: { entry: 'dist/native.js' },
		})
	);
	await write(dir, 'apps/mailapp/dist/native.js', 'export default {};\n');
	await write(dir, 'engines/linux-x64/loam-mail', engine);
	await chmod(join(dir, 'engines/linux-x64/loam-mail'), 0o755);
	return { dir, mark };
}

describe("an archive's size allowance (4.4, rule 3)", () => {
	it("covers the reviewer's case at the real bounds: 2,000 incompressible files of 216-byte names at 256 MiB", () => {
		const allowance = archiveAllowance({
			bytes: PLUGIN_BUNDLE_LIMITS.bytes,
			files: PLUGIN_BUNDLE_LIMITS.files,
		});
		// That archive packed to 1 MiB and 55,767 bytes past the cap; the allowance holds every name at 1,024 bytes.
		expect(allowance).toBeGreaterThan(1024 * 1024 + 55_767);
		expect(allowance).toBeGreaterThanOrEqual(2000 * (30 + 46 + 2 * 1024) + 22);
	});

	it('reads an archive of incompressible files at the byte cap with the longest names, refusing it for nothing', async () => {
		const limits = { bytes: 640 * 1024, files: 20 };
		const manifest = Buffer.from(
			`${JSON.stringify(
				{
					plugin_manifest_version: 1,
					plugin: { id: 'sketch', title: 'Sketch', version: '1.0.0', description: 'Draw.' },
					apps: [{ id: 'sketch', path: 'apps/sketch' }],
				},
				null,
				'\t'
			)}\n`
		);
		const app = Buffer.from(
			`${JSON.stringify({ manifest_version: 1, protocol: 1, plugin: { id: 'sketch', title: 'Sketch', version: '1.0.0', description: 'Draw.', kind: 'view', domains: ['sketch'] }, view: {} }, null, '\t')}\n`
		);
		const fixed = manifest.length + app.length;
		const count = limits.files - 2;
		const each = Math.floor((limits.bytes - fixed) / count);
		// Names at the 1,024-byte bound, each segment within 255 (the last is 208 bytes).
		const name = (n: number) => {
			const stem = `apps/sketch/${['s', 't', 'u', 'v'].map((c) => c.repeat(200)).join('/')}/`;
			return `${stem}${`${n}`.padStart(1024 - Buffer.byteLength(stem), 'f')}`;
		};
		const files = [
			{ path: 'plugin-manifest.json', data: manifest },
			{ path: 'apps/sketch/app-manifest.json', data: app },
			...Array.from({ length: count }, (_, n) => ({ path: name(n), data: randomBytes(each) })),
		];
		const bytes = writeZip(files);
		expect(Buffer.byteLength(name(0))).toBe(1024);
		expect(bundlePathProblem(name(0))).toBeUndefined();
		// Past the bytes it holds by more than headers alone, and within the allowance.
		expect(bytes.length).toBeGreaterThan(limits.bytes);
		expect(bytes.length).toBeLessThanOrEqual(limits.bytes + archiveAllowance(limits));
		const report = await checkPluginArchive(await written(bytes), pluginCheck, limits);
		// Staged under a temporary directory, a 1,024-byte name is past macOS's 1,024-byte path limit, so there each
		// file is refused for staging, and for nothing else; on Linux and Windows the archive checks as the bundle it is.
		if (process.platform === 'darwin') {
			expect(new Set(report.refusals.map(({ reason }) => reason))).toEqual(new Set(['staging']));
		} else expect(codes(report)).toEqual([]);
	});
});

describe('staging an archive', () => {
	it('refuses a name this system cannot hold, keyed by the entry, rather than throwing', async () => {
		// Within the 1,024-byte bundle path, and past macOS's 1,024-byte path once under the staging directory.
		const deep = `apps/sketch/${Array.from({ length: 5 }, (_, n) => `${n}`.padStart(200, 'd')).join('/')}`;
		expect(Buffer.byteLength(deep)).toBeLessThanOrEqual(1024);
		const bytes = craft([
			...archives.base,
			{ path: deep, text: 'x\n', bodyHex: deflateRawSync(Buffer.from('x\n')).toString('hex') },
		]);
		const report = await pluginCheck({ dir: await written(bytes) });
		if (process.platform === 'darwin') {
			expect(report.refusals).toEqual([
				expect.objectContaining({
					code: 'PLUGIN_PATH_ESCAPE',
					key: deep,
					reason: 'staging',
					message: expect.stringMatching(/could not be staged/),
				}),
			]);
		} else {
			// Linux and Windows hold a longer path; the archive then checks as the bundle it is, and nothing threw.
			expect(report.refusals.every(({ reason }) => reason === 'staging')).toBe(true);
		}
	});
});

describe('loam plugin pack --out <name>.loam-plugin', () => {
	it('writes an archive that checks as the directory bundle does, to the same digest, running nothing', async () => {
		const { dir, mark } = await source();
		const source_ = await pluginCheck({ dir });
		const out = join(await temporaryDirectory(), 'dist', `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		const packed = await pluginPack({ dir, out });
		expect(codes(packed.report)).toEqual([]);
		expect(packed.out).toBe(out);
		expect(packed.bundleSha256).toBe(source_.bundleSha256);
		const folder = await pluginPack({ dir, out: join(dirname(out), 'mail-bundle') });
		expect(folder.bundleSha256).toBe(packed.bundleSha256);

		const checked = await pluginCheck({ dir: out });
		expect(codes(checked)).toEqual([]);
		expect(checked).toMatchObject({ form: 'archive', bundleSha256: packed.bundleSha256 });
		expect(checked.files?.map(({ source }) => source)).toEqual(
			checked.files?.map(({ path }) => `${out}!${path}`)
		);
		// Every file, sorted by its path's bytes, no directory entry; the engine executable and the rest not.
		const zip = readZip(readFileSync(out), 256 * 1024 * 1024, 4000);
		expect(
			zip.ok && zip.entries.map(({ path, executable }) => `${executable ? 'x' : '-'} ${path}`)
		).toEqual([
			'- apps/mail/app-manifest.json',
			'- apps/mailapp/app-manifest.json',
			'- apps/mailapp/dist/native.js',
			'x engines/linux-x64/loam-mail',
			'- plugin-manifest.json',
		]);
		const bytes = readFileSync(out);
		const central = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
		const modes: string[] = [];
		for (let at = bytes.indexOf(central); at >= 0; at = bytes.indexOf(central, at + 4))
			modes.push((bytes.readUInt32LE(at + 38) >>> 16).toString(8));
		expect(modes).toEqual(['100644', '100644', '100644', '100755', '100644']);
		expect(existsSync(mark)).toBe(false);
	});

	it('packs one source to the same bytes twice', async () => {
		const { dir } = await source();
		const root = await temporaryDirectory();
		const one = join(root, `one${PLUGIN_ARCHIVE_EXTENSION}`);
		const two = join(root, `two${PLUGIN_ARCHIVE_EXTENSION}`);
		await pluginPack({ dir, out: one });
		await pluginPack({ dir, out: two });
		expect(readFileSync(one).equals(readFileSync(two))).toBe(true);
	});

	it('replaces an archive it wrote, and refuses one it did not, one that changed, or a directory at that name', async () => {
		const { dir } = await source();
		const root = await temporaryDirectory();
		const out = join(root, `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		expect(codes((await pluginPack({ dir, out })).report)).toEqual([]);
		expect(existsSync(packRecordOf(out))).toBe(true);
		expect(codes((await pluginPack({ dir, out })).report)).toEqual([]);

		const before = readFileSync(out);
		await writeFile(out, Buffer.concat([before, Buffer.from('x')]));
		expect(codes((await pluginPack({ dir, out })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);

		const foreign = join(root, `foreign${PLUGIN_ARCHIVE_EXTENSION}`);
		await writeFile(foreign, before);
		expect(codes((await pluginPack({ dir, out: foreign })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);
		const directory = join(root, `folder${PLUGIN_ARCHIVE_EXTENSION}`);
		await mkdir(directory);
		await writeFile(join(directory, 'keep.txt'), 'mine\n');
		expect(codes((await pluginPack({ dir, out: directory })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);
		expect(readFileSync(join(directory, 'keep.txt'), 'utf8')).toBe('mine\n');
	});

	it('follows a link at --out to the archive it names, and refuses one that names nothing', async () => {
		const { dir } = await source();
		const root = await temporaryDirectory();
		const target = join(root, `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		expect(codes((await pluginPack({ dir, out: target })).report)).toEqual([]);
		const link = join(root, `link${PLUGIN_ARCHIVE_EXTENSION}`);
		await symlink(target, link);
		const through = await pluginPack({ dir, out: link });
		expect(codes(through.report)).toEqual([]);
		expect(through.out).toBe(target);
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		const dangling = join(root, `dangling${PLUGIN_ARCHIVE_EXTENSION}`);
		await symlink(join(root, `gone${PLUGIN_ARCHIVE_EXTENSION}`), dangling);
		expect(codes((await pluginPack({ dir, out: dangling })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);
		expect(lstatSync(dangling).isSymbolicLink()).toBe(true);
		expect(existsSync(join(root, `gone${PLUGIN_ARCHIVE_EXTENSION}`))).toBe(false);
	});

	it('runs from the loam bin: pack to an archive, then check it', async () => {
		const { dir } = await source();
		const out = join(await temporaryDirectory(), `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		let text = '';
		const io = {
			stdout(chunk: string) {
				text += chunk;
			},
		};
		expect(await runCli(['plugin', 'pack', dir, '--out', out], io)).toBe(0);
		const packed = JSON.parse(text);
		text = '';
		expect(await runCli(['plugin', 'check', out], io)).toBe(0);
		expect(JSON.parse(text).data.bundleSha256).toBe(packed.data.bundleSha256);
		await writeFile(out, 'PK');
		text = '';
		expect(await runCli(['plugin', 'check', out], io)).toBe(1);
		expect(JSON.parse(text).error.code).toBe('PLUGIN_MANIFEST_INVALID');
	});

	it('enforces the archive byte cap on the opened descriptor and returns structured boundary errors', async () => {
		const root = await temporaryDirectory();
		const file = join(root, `grow${PLUGIN_ARCHIVE_EXTENSION}`);
		await writeFile(file, Buffer.alloc(128, 0x41));
		const exact = await open(file, 'r');
		try {
			expect(await readBounded(exact, 128)).toEqual({ ok: true, bytes: Buffer.alloc(128, 0x41) });
		} finally {
			await exact.close();
		}
		const capped = await open(file, 'r');
		try {
			expect(await readBounded(capped, 64)).toEqual({ ok: false, readBytes: 65 });
		} finally {
			await capped.close();
		}

		// Missing archive path at checkPluginArchive boundary returns structured archive-file refusal, never throws.
		const gone = await checkPluginArchive(
			join(root, `gone${PLUGIN_ARCHIVE_EXTENSION}`),
			pluginCheck,
			PLUGIN_BUNDLE_LIMITS
		);
		expect(gone).toMatchObject({
			ok: false,
			form: 'archive',
			refusals: [
				expect.objectContaining({
					code: 'PLUGIN_PATH_ESCAPE',
					key: '(archive)',
					reason: 'archive-file',
				}),
			],
		});

		// Unwritable TMPDIR at mkdtemp boundary returns structured staging refusal, never throws.
		const validArchive = await written(archiveOf(archives.valid[0] as ArchiveCase));
		const prevTmpdir = process.env.TMPDIR;
		const prevTmp = process.env.TMP;
		const prevTemp = process.env.TEMP;
		const badTmp = join(root, 'missing-tmp-dir');
		process.env.TMPDIR = badTmp;
		process.env.TMP = badTmp;
		process.env.TEMP = badTmp;
		try {
			const staged = await checkPluginArchive(validArchive, pluginCheck, PLUGIN_BUNDLE_LIMITS);
			expect(staged).toMatchObject({
				ok: false,
				form: 'archive',
				refusals: [
					expect.objectContaining({
						code: 'PLUGIN_PATH_ESCAPE',
						key: '(archive)',
						reason: 'staging',
					}),
				],
			});
		} finally {
			if (prevTmpdir === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = prevTmpdir;
			if (prevTmp === undefined) delete process.env.TMP;
			else process.env.TMP = prevTmp;
			if (prevTemp === undefined) delete process.env.TEMP;
			else process.env.TEMP = prevTemp;
		}
	});

	it('detects an in-bounds asset whose archive metadata spells a ZIP signature and suggests directory output', async () => {
		const { dir } = await source();
		const asset = 'apps/mailapp/dist/sig-size.bin';
		// 0x02014b50 = 33,639,248 bytes: well under 256 MiB, compresses to ~32 KiB, spells PK\x01\x02 in declared size.
		await writeFile(join(dir, asset), Buffer.alloc(0x02014b50));
		const parent = await temporaryDirectory();
		const out = join(parent, `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		const packed = await pluginPack({ dir, out });
		expect(packed.out).toBeUndefined();
		expect(packed.report.ok).toBe(false);
		expect(packed.report.refusals).toEqual([
			expect.objectContaining({
				code: 'PLUGIN_PACK_FAILED',
				key: asset,
				reason: 'signature-in-directory',
				suggestion: expect.stringContaining('directory bundle'),
			}),
		]);
		expect(packed.report.refusals.map(({ code }) => code)).not.toContain('PLUGIN_HASH_MISMATCH');
		expect(readdirSync(parent)).toEqual([]);

		// Directory bundle output still succeeds for the exact same source.
		const dirOut = join(parent, 'mail-bundle');
		const dirPacked = await pluginPack({ dir, out: dirOut });
		expect(codes(dirPacked.report)).toEqual([]);
		expect(dirPacked.out).toBe(dirOut);
	});

	it('refuses a fresh output with a pre-existing sidecar, serializes concurrent packs, prevents clobbering, and preserves archive+record on rename failure', async () => {
		const { dir } = await source();
		const root = await temporaryDirectory();

		// 1. Fresh output with a pre-existing sibling sidecar is refused without deleting the sidecar.
		const freshOut = join(root, `fresh${PLUGIN_ARCHIVE_EXTENSION}`);
		await writeFile(packRecordOf(freshOut), '{"foreign":true}\n');
		const withSidecar = await pluginPack({ dir, out: freshOut });
		expect(codes(withSidecar.report)).toEqual(['PLUGIN_PACK_OUT_INVALID --out']);
		expect(readFileSync(packRecordOf(freshOut), 'utf8')).toBe('{"foreign":true}\n');
		expect(existsSync(freshOut)).toBe(false);

		// 2. Fresh output where a file appears during staging is never clobbered.
		const racedOut = join(root, `raced${PLUGIN_ARCHIVE_EXTENSION}`);
		const raced = await pluginPackWithHooks(
			{ dir, out: racedOut },
			{
				async beforeCommit() {
					await writeFile(racedOut, 'appeared-mid-pack');
				},
			}
		);
		expect(codes(raced.report)).toEqual(['PLUGIN_PACK_OUT_INVALID --out']);
		expect(readFileSync(racedOut, 'utf8')).toBe('appeared-mid-pack');
		expect(existsSync(packRecordOf(racedOut))).toBe(false);

		// 3. Existing archive modified during staging is refused at commit time and preserved.
		const out = join(root, `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		const first = await pluginPack({ dir, out });
		expect(codes(first.report)).toEqual([]);
		const originalArchive = readFileSync(out);
		const originalRecord = readFileSync(packRecordOf(out), 'utf8');

		// 3a. Concurrent pack lock refuses a competing pack without touching archive or record.
		await writeFile(packLockOf(out), '');
		const locked = await pluginPack({ dir, out });
		expect(codes(locked.report)).toEqual(['PLUGIN_PACK_OUT_INVALID --out']);
		expect(readFileSync(out).equals(originalArchive)).toBe(true);
		expect(readFileSync(packRecordOf(out), 'utf8')).toBe(originalRecord);
		await rm(packLockOf(out));

		// 3b. Failed rename during replacement leaves the previous archive AND record intact for an ordinary retry.
		const failedRename = await pluginPackWithHooks(
			{ dir, out },
			{
				async rename(_oldPath, newPath) {
					if (newPath === out) {
						const err = Object.assign(new Error('simulated rename failure'), { code: 'EACCES' });
						throw err;
					}
				},
			}
		);
		expect(codes(failedRename.report)).toEqual(['PLUGIN_PACK_FAILED --out']);
		expect(readFileSync(out).equals(originalArchive)).toBe(true);
		expect(readFileSync(packRecordOf(out), 'utf8')).toBe(originalRecord);
		// Ordinary retry succeeds immediately because the previous archive+record pair remained intact.
		const retried = await pluginPack({ dir, out });
		expect(codes(retried.report)).toEqual([]);
		expect(retried.bundleSha256).toBe(first.bundleSha256);

		// 3c. Existing archive altered during staging before commit is refused and preserved.
		const tampered = await pluginPackWithHooks(
			{ dir, out },
			{
				async beforeCommit() {
					await writeFile(out, Buffer.concat([originalArchive, Buffer.from('x')]));
				},
			}
		);
		expect(codes(tampered.report)).toEqual(['PLUGIN_PACK_OUT_INVALID --out']);
		expect(readFileSync(out).equals(Buffer.concat([originalArchive, Buffer.from('x')]))).toBe(true);
	});
});
