/**
 * P5-S9-2's TypeScript side (phase 5's no-terminal amendment, 4.1, 4.4 and 13.1): `loam plugin check` and `loam plugin
 * pack` over a source, a packed folder and a `.loam-plugin` archive. The manifest's own cases are
 * `@lushly-dev/loam-manifest`'s plugin.test.ts; inspecting staged bytes in Rust is step 9c's.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PLUGIN_BUNDLE_LIMITS_V1 } from '@lushly-dev/loam-manifest/plugin';
import { stringify } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { type CliIO, runCli } from './cli.js';
import { checkPluginBundle, type PluginBundleLimits, packPlugin } from './plugin-bundle.js';
import { temporaryDirectory } from './test-support.js';
import { readZip, writeZip } from './zip.js';

const ENGINE = Buffer.from('Not an engine: the tests stand in for one and never run it.\n');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const APP = { version: '0.1.0', description: 'An app a plugin bundles, for the tests.' };
const mountedApp = {
	manifest_version: 1,
	protocol: 1,
	plugin: { ...APP, id: 'mail', title: 'Mail engine', kind: 'mounted', domains: ['mail'] },
	mount: { prefix: 'mail', transport: 'http' },
};
const nativeApp = {
	manifest_version: 1,
	protocol: 1,
	plugin: { ...APP, id: 'mailapp', title: 'Mail', kind: 'native', domains: ['mailapp'] },
	native: { entry: 'dist/native.js' },
};

/** A Mail-shaped `loam-plugin.toml`, its apps where `loam app pack` left them. */
const mailToml = (engine: Buffer = ENGINE): Record<string, unknown> => ({
	plugin_manifest_version: 1,
	plugin: {
		id: 'mail',
		title: 'Mail',
		version: '0.1.0',
		description: 'Local mail sync, search, drafts and reply sets.',
	},
	apps: [
		{ id: 'mail', path: 'engine-app/package' },
		{ id: 'mailapp', path: 'app/dist/package' },
	],
	engine: {
		id: 'loam-mail',
		kind: 'http-service',
		mount_app: 'mail',
		service_mode: 'login',
		artifacts: {
			'linux-x64': { path: 'engines/linux-x64/loam-mail', sha256: sha(engine) },
			'windows-x64': { path: 'engines/windows-x64/loam-mail.exe', sha256: sha(engine) },
		},
		auth: { mode: 'approver' },
		mount: {
			audience: 'person',
			labels: 'per-part',
			approvals: 'shell',
			commands: {
				'mail-draft-send': {
					expose: { agent: true, apps: true },
					preview: { command: 'mail-draft-show', input: ['draft'] },
				},
			},
		},
	},
});

async function put(root: string, path: string, data: string | Buffer): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), data);
}

/** A plugin's source: the manifest, two packed apps (each with `app pack`'s mark) and the engine for two targets. */
async function source(
	manifest: Record<string, unknown> = mailToml(),
	change?: (root: string) => Promise<void>
): Promise<string> {
	const root = join(await temporaryDirectory(), 'mail');
	await put(root, 'loam-plugin.toml', stringify(manifest));
	await put(root, 'engine-app/package/app-manifest.json', JSON.stringify(mountedApp));
	await put(root, 'engine-app/package/.loam-output', 'Written by loam app pack.\n');
	await put(root, 'app/dist/package/app-manifest.json', JSON.stringify(nativeApp));
	await put(root, 'app/dist/package/dist/native.js', 'export default {};\n');
	await put(root, 'app/dist/package/.loam-output', 'Written by loam app pack.\n');
	await put(root, 'engines/linux-x64/loam-mail', ENGINE);
	await put(root, 'engines/windows-x64/loam-mail.exe', ENGINE);
	// Beside the source, never packed.
	await put(root, 'README.md', 'A plugin.\n');
	await change?.(root);
	return root;
}

const codes = (report: { ok: boolean; refusals?: Array<{ code: string; key: string }> }) =>
	report.ok ? [] : (report.refusals ?? []).map(({ code, key }) => `${code} ${key}`);

/** An archive of a packed Mail bundle with `extra` entries, for the archive's own cases. */
async function packedEntries(): Promise<Array<{ path: string; data: Buffer }>> {
	const root = await source();
	const out = join(await temporaryDirectory(), 'bundle');
	expect(await packPlugin({ dir: root, out })).toMatchObject({ ok: true });
	const paths = (await readdir(out, { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) =>
			join(entry.parentPath, entry.name)
				.slice(out.length + 1)
				.split('\\')
				.join('/')
		);
	return Promise.all(
		paths.sort().map(async (path) => ({ path, data: await readFile(join(out, path)) }))
	);
}

async function archive(entries: Parameters<typeof writeZip>[0]): Promise<string> {
	const path = join(await temporaryDirectory(), 'mail.loam-plugin');
	await writeFile(path, writeZip(entries));
	return path;
}

describe('loam plugin check and pack (4.1, 10)', () => {
	it('checks a source: its apps, its engine and what it would pack, never the rest of the folder', async () => {
		const report = await checkPluginBundle(await source());
		expect(codes(report)).toEqual([]);
		expect(report).toMatchObject({
			ok: true,
			kind: 'source',
			plugin: { id: 'mail', title: 'Mail', version: '0.1.0' },
			apps: [
				{ id: 'mail', kind: 'mounted', title: 'Mail engine' },
				{ id: 'mailapp', kind: 'native', title: 'Mail' },
			],
			engine: { id: 'loam-mail', auth: 'approver', approvals: 'shell', labels: 'per-part' },
			// plugin-manifest.json, three app files and two engines.
			files: 6,
		});
	});

	it('packs a folder and an archive that each check as the source did', async () => {
		const root = await source();
		const folder = join(await temporaryDirectory(), 'bundle');
		const packed = await packPlugin({ dir: root, out: folder });
		expect(packed.ok ? [] : packed.refusals).toEqual([]);
		expect(packed).toMatchObject({
			kind: 'folder',
			written: [
				'apps/mail/app-manifest.json',
				'apps/mailapp/app-manifest.json',
				'apps/mailapp/dist/native.js',
				'engines/linux-x64/loam-mail',
				'engines/windows-x64/loam-mail.exe',
				'plugin-manifest.json',
			],
		});
		const manifest = JSON.parse(await readFile(join(folder, 'plugin-manifest.json'), 'utf8'));
		expect(manifest.apps).toEqual([
			{ id: 'mail', path: 'apps/mail' },
			{ id: 'mailapp', path: 'apps/mailapp' },
		]);
		expect(manifest.engine).toEqual((mailToml() as { engine: unknown }).engine);
		expect(await checkPluginBundle(folder)).toMatchObject({ ok: true, kind: 'folder', files: 6 });

		const file = join(await temporaryDirectory(), 'dist/mail.loam-plugin');
		expect(await packPlugin({ dir: root, out: file })).toMatchObject({ ok: true, kind: 'archive' });
		expect(await checkPluginBundle(file)).toMatchObject({ ok: true, kind: 'archive', files: 6 });
		const zip = readZip(await readFile(file), PLUGIN_BUNDLE_LIMITS_V1.totalBytes, 2000);
		expect(zip.ok && zip.entries.map(({ path }) => path)).toEqual(packed.ok && packed.written);
		// The archive's bytes are its files', and the clock is not among them.
		const again = join(await temporaryDirectory(), 'again.loam-plugin');
		await packPlugin({ dir: root, out: again });
		expect((await readFile(again)).equals(await readFile(file))).toBe(true);
	});

	it('packs a pure-app plugin, with no engine', async () => {
		const toml = mailToml();
		delete toml.engine;
		toml.apps = [{ id: 'mailapp', path: 'app/dist/package' }];
		const out = join(await temporaryDirectory(), 'notes.loam-plugin');
		const packed = await packPlugin({ dir: await source(toml), out });
		expect(packed.ok ? [] : packed.refusals).toEqual([]);
		expect(await checkPluginBundle(out)).toMatchObject({ ok: true, files: 3 });
	});

	it('P5-S9-2 (T23): runs nothing it checks or packs', async () => {
		const marker = join(await temporaryDirectory(), 'ran');
		const script = Buffer.from(`#!/bin/sh\ntouch '${marker}'\n`);
		const root = await source(mailToml(script), async (dir) => {
			for (const path of ['engines/linux-x64/loam-mail', 'engines/windows-x64/loam-mail.exe']) {
				await put(dir, path, script);
				await chmod(join(dir, path), 0o755);
			}
		});
		expect(await checkPluginBundle(root)).toMatchObject({ ok: true });
		const out = join(await temporaryDirectory(), 'mail.loam-plugin');
		expect(await packPlugin({ dir: root, out })).toMatchObject({ ok: true });
		expect(await checkPluginBundle(out)).toMatchObject({ ok: true });
		expect(existsSync(marker)).toBe(false);
	});

	it('runs from the loam bin with JSON and an exit code', async () => {
		let text = '';
		const io: CliIO = {
			stdout(chunk) {
				text += chunk;
			},
		};
		const root = await source();
		expect(await runCli(['plugin', 'check', root], io)).toBe(0);
		expect(JSON.parse(text)).toMatchObject({ success: true, data: { kind: 'source' } });
		text = '';
		const out = join(await temporaryDirectory(), 'mail.loam-plugin');
		expect(await runCli(['plugin', 'pack', root, '--out', out], io)).toBe(0);
		expect(JSON.parse(text)).toMatchObject({ success: true, data: { kind: 'archive', files: 6 } });
		text = '';
		await put(root, 'engines/linux-x64/loam-mail', 'another build\n');
		expect(await runCli(['plugin', 'check', root], io)).toBe(1);
		const failed = JSON.parse(text);
		expect(failed.error.code).toBe('PLUGIN_HASH_MISMATCH');
		expect(failed.error.suggestion).toContain(sha(Buffer.from('another build\n')));
		text = '';
		expect(await runCli(['plugin', 'pack', root], io)).toBe(1);
		expect(JSON.parse(text).error.code).toBe('CLI_USAGE');
	});
});

describe('P5-S9-2: what a bundle may not hold (4.4)', () => {
	it('refuses a command line, location or credential in loam-plugin.toml', async () => {
		const toml = mailToml() as { engine: Record<string, unknown> };
		toml.engine.command = ['./loam-mail', 'serve'];
		expect(codes(await checkPluginBundle(await source(toml)))).toEqual([
			'PLUGIN_MANIFEST_INVALID engine.command',
		]);
	});

	it('P5-S9-2: refuses an artifact whose SHA-256 is not the one pinned, or that is missing', async () => {
		const root = await source(undefined, (dir) =>
			put(dir, 'engines/windows-x64/loam-mail.exe', 'swapped\n')
		);
		expect(codes(await checkPluginBundle(root))).toEqual([
			'PLUGIN_HASH_MISMATCH engine.artifacts["windows-x64"].sha256',
		]);
		const out = join(await temporaryDirectory(), 'mail.loam-plugin');
		expect(codes(await packPlugin({ dir: root, out }))).toEqual([
			'PLUGIN_HASH_MISMATCH engine.artifacts["windows-x64"].sha256',
		]);
		expect(existsSync(out)).toBe(false);
		const missing = await source(undefined, async (dir) => {
			const { rm } = await import('node:fs/promises');
			await rm(join(dir, 'engines/linux-x64/loam-mail'));
		});
		expect(codes(await checkPluginBundle(missing))).toEqual([
			'PLUGIN_MANIFEST_INVALID engine.artifacts["linux-x64"].path',
		]);
	});

	it('P5-S9-2: refuses a .bat or .cmd engine and an artifact under another target', async () => {
		for (const path of [
			'engines/windows-x64/loam-mail.bat',
			'engines/windows-x64/loam-mail.cmd',
			'engines/linux-x64/loam-mail.exe',
		]) {
			const toml = mailToml() as { engine: { artifacts: Record<string, { path: string }> } };
			(toml.engine.artifacts['windows-x64'] as { path: string }).path = path;
			expect(codes(await checkPluginBundle(await source(toml))), path).toEqual([
				'PLUGIN_MANIFEST_INVALID engine.artifacts["windows-x64"].path',
			]);
		}
	});

	it('P5-S9-2 (T22): refuses a symbolic link in a source, as an entry or on the way to one, and a FIFO', async () => {
		// Directory links, as junctions on Windows, which need no privilege there.
		const linked = await source(undefined, (dir) =>
			symlink(join(dir, 'engines'), join(dir, 'app/dist/package/notes'), 'junction')
		);
		expect(codes(await checkPluginBundle(linked))).toEqual([
			'PLUGIN_PATH_ESCAPE app/dist/package/notes',
		]);
		const through = await source(undefined, async (dir) => {
			await rename(join(dir, 'engines'), join(dir, 'built'));
			await symlink(join(dir, 'built'), join(dir, 'engines'), 'junction');
		});
		expect(codes(await checkPluginBundle(through))).toEqual([
			'PLUGIN_PATH_ESCAPE engine.artifacts["linux-x64"].path',
			'PLUGIN_PATH_ESCAPE engine.artifacts["windows-x64"].path',
		]);
		// Windows has no FIFO to make; elsewhere one is refused as not a regular file.
		if (process.platform === 'win32') return;
		const piped = await source(undefined, async (dir) => {
			execFileSync('mkfifo', [join(dir, 'app/dist/package/pipe')]);
		});
		expect(codes(await checkPluginBundle(piped))).toEqual([
			'PLUGIN_PATH_ESCAPE app/dist/package/pipe',
		]);
	});

	it('P5-S9-2 (T22): refuses an archive with a duplicate, a case collision, a `..` entry or a symbolic link', async () => {
		const entries = await packedEntries();
		const native = entries.find(({ path }) => path.endsWith('native.js')) as {
			path: string;
			data: Buffer;
		};
		const cases: Array<[string, Parameters<typeof writeZip>[0], string]> = [
			['a duplicate', [...entries, native], 'PLUGIN_PATH_ESCAPE apps/mailapp/dist/native.js'],
			[
				'a case collision',
				[...entries, { path: 'apps/mailapp/dist/Native.js', data: native.data }],
				'PLUGIN_PATH_ESCAPE apps/mailapp/dist/Native.js',
			],
			[
				'a `..` entry',
				[...entries, { path: 'apps/../evil.js', data: native.data }],
				'PLUGIN_PATH_ESCAPE apps/../evil.js',
			],
			[
				'an absolute entry',
				[...entries, { path: '/etc/evil', data: native.data }],
				'PLUGIN_PATH_ESCAPE /etc/evil',
			],
			[
				'a symbolic link',
				[
					...entries,
					{ path: 'apps/mailapp/link', data: Buffer.from('/etc/passwd'), mode: 0o120777 },
				],
				'PLUGIN_PATH_ESCAPE apps/mailapp/link',
			],
			[
				'a file inside a file',
				[...entries, { path: 'apps/mailapp/dist/native.js/x', data: native.data }],
				'PLUGIN_PATH_ESCAPE apps/mailapp/dist/native.js/x',
			],
		];
		for (const [name, zip, expected] of cases) {
			expect(codes(await checkPluginBundle(await archive(zip))), name).toEqual([expected]);
		}
	});

	it('P5-S9-2: refuses a bundle past its file count or its size, and a zip bomb while it inflates', async () => {
		const small = (overrides: Partial<PluginBundleLimits>): PluginBundleLimits => ({
			...PLUGIN_BUNDLE_LIMITS_V1,
			...overrides,
		});
		const root = await source();
		expect(codes(await checkPluginBundle(root, small({ files: 5 })))[0]).toMatch(
			/^PLUGIN_BUNDLE_TOO_LARGE /
		);
		expect(codes(await checkPluginBundle(root, small({ totalBytes: 100 })))[0]).toMatch(
			/^PLUGIN_BUNDLE_TOO_LARGE /
		);
		expect(codes(await checkPluginBundle(root, small({ manifestBytes: 64 })))).toEqual([
			'PLUGIN_BUNDLE_TOO_LARGE loam-plugin.toml',
		]);
		const entries = await packedEntries();
		const bomb = await archive([
			...entries,
			{ path: 'apps/mailapp/dist/zeros.bin', data: Buffer.alloc(4 * 1024 * 1024) },
		]);
		expect(codes(await checkPluginBundle(bomb, small({ totalBytes: 1024 * 1024 })))).toEqual([
			'PLUGIN_BUNDLE_TOO_LARGE (archive)',
		]);
		const many = await archive([
			...entries,
			...Array.from({ length: 10 }, (_, index) => ({
				path: `apps/mailapp/f${index}`,
				data: Buffer.from(''),
			})),
		]);
		expect(codes(await checkPluginBundle(many, small({ files: 12 })))).toEqual([
			'PLUGIN_BUNDLE_TOO_LARGE (archive)',
		]);
		expect(PLUGIN_BUNDLE_LIMITS_V1).toEqual({
			totalBytes: 256 * 1024 * 1024,
			files: 2000,
			manifestBytes: 1024 * 1024,
		});
	});

	it('refuses an archive it cannot read, a file that is no archive, and nothing at all', async () => {
		const broken = join(await temporaryDirectory(), 'broken.loam-plugin');
		await writeFile(broken, 'not a zip');
		expect(codes(await checkPluginBundle(broken))).toEqual(['PLUGIN_MANIFEST_INVALID (archive)']);
		const entries = await packedEntries();
		const cut = await archive(entries);
		const bytes = await readFile(cut);
		// A flipped byte in a file's data fails its CRC-32.
		const flipped = Buffer.from(bytes);
		const at = 30 + Buffer.byteLength((entries[0] as { path: string }).path) + 2;
		flipped[at] = (flipped[at] as number) ^ 0xff;
		await writeFile(cut, flipped);
		expect(codes(await checkPluginBundle(cut))).toEqual(['PLUGIN_MANIFEST_INVALID (archive)']);
		// A name that is not UTF-8, which `pack` never writes.
		const named = Buffer.from(await readFile(await archive(entries)));
		const central = named.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		named[central + 46] = 0xff;
		const latin = join(await temporaryDirectory(), 'latin.loam-plugin');
		await writeFile(latin, named);
		expect(codes(await checkPluginBundle(latin))).toEqual(['PLUGIN_MANIFEST_INVALID (archive)']);
		const plain = join(await temporaryDirectory(), 'mail.zip');
		await writeFile(plain, writeZip(entries));
		expect(codes(await checkPluginBundle(plain))).toEqual(['PLUGIN_MANIFEST_INVALID (bundle)']);
		expect(codes(await checkPluginBundle(join(plain, 'nothing')))).toEqual([
			'PLUGIN_MANIFEST_INVALID (bundle)',
		]);
		const empty = await temporaryDirectory();
		expect(codes(await checkPluginBundle(empty))).toEqual([
			'PLUGIN_MANIFEST_INVALID loam-plugin.toml',
		]);
	});

	it('refuses an --out inside what it packs, or one holding other files, and packing a packed bundle', async () => {
		const root = await source();
		expect(
			codes(await packPlugin({ dir: root, out: join(root, 'app/dist/package/x.loam-plugin') }))
		).toEqual(['PLUGIN_PACK_OUT_INVALID --out']);
		const full = await temporaryDirectory();
		await put(full, 'keep.txt', 'mine\n');
		expect(codes(await packPlugin({ dir: root, out: full }))).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);
		const folder = join(await temporaryDirectory(), 'bundle');
		await packPlugin({ dir: root, out: folder });
		expect(codes(await packPlugin({ dir: folder, out: join(folder, '..', 'again') }))).toEqual([
			'PLUGIN_MANIFEST_INVALID (bundle)',
		]);
	});
});
