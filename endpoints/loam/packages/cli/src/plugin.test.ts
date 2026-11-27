/**
 * @fileoverview `loam plugin check` and `loam plugin pack` (phase 5 no-terminal amendment, 4.4, 7.1 and 10; P5-S9-2's
 * CLI rows): a source and a directory bundle, each engine's SHA-256, regular files only, the bounds, the digest and
 * `--out`'s safety. Nothing a plugin holds is run.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import {
	bundleDigest,
	collisionRefusals,
	PLUGIN_BUNDLE_LIMITS,
	pluginCheck,
} from './plugin-check.js';
import { pluginPack } from './plugin-pack.js';
import { temporaryDirectory } from './test-support.js';

const CASES = join(import.meta.dirname, '../../manifest/test/fixtures/loam-plugin-cases.json');
/** A program that would leave a mark if anything ran it. */
const SENTINEL = (mark: string) => `#!/bin/sh\necho ran > "${mark}"\n`;

const PLUGIN = { version: '0.1.0', description: 'An app, for the tests of plugin pack.' };
const mounted = {
	manifest_version: 1,
	protocol: 1,
	plugin: { ...PLUGIN, title: 'Mail', id: 'mail', kind: 'mounted', domains: ['mail'] },
	mount: { prefix: 'mail', transport: 'http' },
};
const native = {
	manifest_version: 1,
	protocol: 1,
	plugin: { ...PLUGIN, title: 'Mail app', id: 'mailapp', kind: 'native', domains: ['mailapp'] },
	native: { entry: 'dist/native.js' },
};

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

async function write(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

const tomlOf = (engine: string, extra = '') => `plugin_manifest_version = 1

[plugin]
id = "mail"
title = "Mail"
version = "0.1.0"
description = "Local mail sync, search, drafts and reply sets."
${extra}
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
mode = "approver"

[engine.mount]
labels = "per-part"
approvals = "shell"

[engine.mount.commands."mail-draft-send"]
expose = { agent = true, apps = true }
preview = { command = "mail-draft-show", input = ["draft", "revision"] }
`;

/** A Mail-shaped source: two packed apps and one engine, whose bytes would leave a mark if run. */
async function source(): Promise<{ dir: string; mark: string; engine: string }> {
	const dir = join(await temporaryDirectory(), 'mail-plugin');
	const mark = join(dir, '..', 'ran');
	const engine = SENTINEL(mark);
	await write(dir, 'loam-plugin.toml', tomlOf(engine));
	await write(dir, 'apps/mail/app-manifest.json', JSON.stringify(mounted));
	await write(dir, 'apps/mailapp/app-manifest.json', JSON.stringify(native));
	await write(dir, 'apps/mailapp/dist/native.js', 'export default {};\n');
	await write(dir, 'engines/linux-x64/loam-mail', engine);
	await chmod(join(dir, 'engines/linux-x64/loam-mail'), 0o755);
	await write(dir, 'README.md', 'A source may hold what it likes; a bundle may not.\n');
	return { dir, mark, engine };
}

const codes = (report: { refusals: { code: string; key: string }[] }) =>
	report.refusals.map(({ code, key }) => `${code} ${key}`);

function listed(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) =>
			join(entry.parentPath, entry.name)
				.slice(dir.length + 1)
				.split('\\')
				.join('/')
		)
		.sort();
}

describe('the bundle digest (7.1)', () => {
	it('is the vector computed apart from this code', () => {
		const { bundleDigest: vector } = JSON.parse(readFileSync(CASES, 'utf8')) as {
			bundleDigest: { files: { path: string; sha256: string }[]; digest: string };
		};
		expect(bundleDigest(vector.files)).toBe(vector.digest);
		// The order is the paths' bytes, not a locale's or the list's.
		expect(bundleDigest([...vector.files].reverse())).toBe(vector.digest);
	});
});

describe('loam plugin check', () => {
	it('checks a source, runs none of it, and reports the digest pack will write', async () => {
		const { dir, mark, engine } = await source();
		const report = await pluginCheck({ dir });
		expect(codes(report)).toEqual([]);
		expect(report.form).toBe('source');
		expect(report.engines).toEqual([
			{ target: 'linux-x64', path: 'engines/linux-x64/loam-mail', sha256: sha256(engine) },
		]);
		expect(report.files?.map(({ path }) => path)).toEqual([
			'apps/mail/app-manifest.json',
			'apps/mailapp/app-manifest.json',
			'apps/mailapp/dist/native.js',
			'engines/linux-x64/loam-mail',
		]);
		expect(report.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(existsSync(mark)).toBe(false);
	});

	it('refuses an engine whose bytes are not the pinned ones, naming the digest it found', async () => {
		const { dir } = await source();
		await write(dir, 'engines/linux-x64/loam-mail', 'another build');
		const report = await pluginCheck({ dir });
		expect(codes(report)).toEqual(['PLUGIN_HASH_MISMATCH engine.artifacts["linux-x64"].sha256']);
		expect(report.refusals[0]?.suggestion).toContain(sha256('another build'));
	});

	it('refuses a missing engine, a missing app and an app that is not packed', async () => {
		const { dir } = await source();
		await rm(join(dir, 'engines'), { recursive: true });
		await rm(join(dir, 'apps/mailapp'), { recursive: true });
		await write(dir, 'apps/mail/app-manifest.json', 'not json');
		const report = await pluginCheck({ dir });
		expect(codes(report).sort()).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[0].path',
			'PLUGIN_MANIFEST_INVALID apps[1].path',
			'PLUGIN_MANIFEST_INVALID engine.artifacts["linux-x64"].path',
		]);
	});

	it("refuses an app manifest the kernel refuses, and one that is not the engine's mount", async () => {
		const { dir } = await source();
		await write(
			dir,
			'apps/mail/app-manifest.json',
			JSON.stringify({ ...mounted, mount: { prefix: 'mail', transport: 'stdio' } })
		);
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount_app']);
		await write(dir, 'apps/mail/app-manifest.json', JSON.stringify({ manifest_version: 1 }));
		const refused = await pluginCheck({ dir });
		expect(codes(refused)).toEqual(['PLUGIN_MANIFEST_INVALID apps[0].path']);
		expect(refused.refusals[0]?.message).toMatch(/is refused: /);
	});

	it('refuses a link anywhere: an app directory, a file in one and an engine', async () => {
		const { dir } = await source();
		const elsewhere = await temporaryDirectory();
		await write(elsewhere, 'secret.txt', 'outside the plugin');
		await symlink(join(elsewhere, 'secret.txt'), join(dir, 'apps/mailapp/dist/secret.txt'));
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_PATH_ESCAPE apps[1].path']);

		await rm(join(dir, 'apps/mailapp/dist/secret.txt'));
		await rm(join(dir, 'engines/linux-x64/loam-mail'));
		await write(elsewhere, 'loam-mail', 'x');
		await symlink(join(elsewhere, 'loam-mail'), join(dir, 'engines/linux-x64/loam-mail'));
		expect(codes(await pluginCheck({ dir }))).toEqual([
			'PLUGIN_PATH_ESCAPE engine.artifacts["linux-x64"].path',
		]);

		await rm(join(dir, 'engines/linux-x64/loam-mail'));
		await rm(join(dir, 'apps/mail'), { recursive: true });
		await mkdir(join(elsewhere, 'mail'));
		await symlink(join(elsewhere, 'mail'), join(dir, 'apps/mail'));
		expect(codes(await pluginCheck({ dir }))).toContain('PLUGIN_PATH_ESCAPE apps[0].path');
	});

	it('reads a source through a link to it', async () => {
		const { dir } = await source();
		const link = join(dir, '..', 'linked');
		await symlink(dir, link);
		expect(codes(await pluginCheck({ dir: link }))).toEqual([]);
	});

	it('refuses a FIFO, where the file system has one', async () => {
		// Windows has no FIFO in its file system (its named pipes live under `\\.\pipe\`), and the
		// `mkfifo` found there is Git Bash's, which writes a regular file Node reads as one (#2790).
		// Loam's exit tests refuse skipIf, so this case claims nothing on Windows instead.
		if (process.platform === 'win32') return;
		const { dir } = await source();
		execFileSync('mkfifo', [join(dir, 'apps/mailapp/dist/pipe')]);
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_PATH_ESCAPE apps[1].path']);
	});

	it("leaves out the mark `loam app pack` writes, which is the source's", async () => {
		const { dir } = await source();
		await write(dir, 'apps/mailapp/.loam-output', 'Written by loam app pack.\n');
		const report = await pluginCheck({ dir });
		expect(codes(report)).toEqual([]);
		expect(report.files?.map(({ path }) => path)).not.toContain('apps/mailapp/.loam-output');
	});

	it('refuses what the manifest alone refuses, with its key', async () => {
		const { dir, engine } = await source();
		await write(
			dir,
			'loam-plugin.toml',
			tomlOf(engine).replace('service_mode = "login"', 'service_mode = "login"\nport = 7461')
		);
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_MANIFEST_INVALID engine.port']);
		await write(dir, 'loam-plugin.toml', 'plugin_manifest_version = ');
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_MANIFEST_INVALID loam-plugin.toml']);
	});

	it('refuses two paths a case-insensitive system makes one', () => {
		expect(
			collisionRefusals(['apps/mail/A.txt', 'apps/mail/a.txt']).map(({ code }) => code)
		).toEqual(['PLUGIN_PATH_ESCAPE']);
		expect(collisionRefusals(['apps/mail/a', 'apps/mail/b'])).toEqual([]);
		// At every segment, not only between neighbours once sorted.
		for (const paths of [
			['apps/Mail/a', 'apps/mail/b'],
			['apps/a', 'apps/a.txt', 'apps/A/b'],
			['apps/a', 'apps/a/b'],
			['apps/mail/A', 'apps/mail/a.txt', 'apps/mail/a/b'],
			// Folded fully: a final sigma and a sigma, a long s and an s, and ẞ, ß and ss. NTFS upper-cases simply and keeps ß
			// and ss apart; APFS folds them to one name, so a bundle may hold only one of them.
			['apps/mail/a\u03a3', 'apps/mail/a\u03c3'],
			['apps/mail/s', 'apps/mail/\u017f'],
			['apps/mail/stra\u00dfe', 'apps/mail/STRASSE'],
			['apps/mail/\u1e9e', 'apps/mail/\u00df'],
		]) {
			expect(collisionRefusals(paths), paths.join(' ')).toHaveLength(1);
		}
	});

	it('refuses an engine inside an app, which the bundle would hold twice', async () => {
		const { dir, engine } = await source();
		// The mounted app's package is `engines/`, so it holds the engine's artifact too.
		await write(
			dir,
			'loam-plugin.toml',
			tomlOf(engine).replace('path = "apps/mail"', 'path = "engines"')
		);
		await write(dir, 'engines/app-manifest.json', JSON.stringify(mounted));
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_MANIFEST_INVALID apps']);
	});

	it('holds the bounds: 2,000 files with the manifest, one more refused; a manifest past 1 MiB', async () => {
		const { dir, engine } = await source();
		// The source's bundle is five files: the manifest, two app manifests, an entry and the engine.
		for (let index = 0; index < PLUGIN_BUNDLE_LIMITS.files - 5; index++)
			await write(dir, `apps/mailapp/dist/f${index}.js`, '');
		const at = await pluginCheck({ dir });
		expect(codes(at)).toEqual([]);
		expect((at.files?.length ?? 0) + 1).toBe(PLUGIN_BUNDLE_LIMITS.files);
		// A bundle at the bound with one file its manifest does not name, sorted last, is refused, and not replaced.
		const out = join(dir, '..', 'bundle');
		expect(codes((await pluginPack({ dir, out })).report)).toEqual([]);
		await write(out, 'zz-unnamed.sh', 'mine');
		expect(codes(await pluginCheck({ dir: out }))).toEqual(['PLUGIN_BUNDLE_TOO_LARGE (root)']);
		expect(codes((await pluginPack({ dir, out })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);
		expect(readFileSync(join(out, 'zz-unnamed.sh'), 'utf8')).toBe('mine');
		await write(dir, 'apps/mailapp/dist/one-more.js', '');
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_BUNDLE_TOO_LARGE (root)']);

		await rm(join(dir, 'apps/mailapp/dist'), { recursive: true });
		await write(dir, 'apps/mailapp/dist/native.js', 'export default {};\n');
		const padding = `# ${'x'.repeat(1024)}\n`.repeat(1024);
		await write(dir, 'loam-plugin.toml', `${padding}${tomlOf(engine)}`);
		expect(codes(await pluginCheck({ dir }))).toEqual(['PLUGIN_BUNDLE_TOO_LARGE loam-plugin.toml']);
	}, 120_000);

	it('reads a bundle manifest strictly: UTF-8 only, and a document that looks like a refusal is still a document', async () => {
		const root = await temporaryDirectory();
		await writeFile(
			join(root, 'plugin-manifest.json'),
			Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])
		);
		expect(codes(await pluginCheck({ dir: root }))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin-manifest.json',
		]);
		// A byte-order mark is kept, so JSON refuses it, as a Rust reader does.
		await writeFile(
			join(root, 'plugin-manifest.json'),
			Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])
		);
		const bom = await pluginCheck({ dir: root });
		expect(codes(bom)).toEqual(['PLUGIN_MANIFEST_INVALID plugin-manifest.json']);
		expect(bom.refusals[0]?.message).toMatch(/is not JSON/);
		await write(
			root,
			'plugin-manifest.json',
			JSON.stringify({ code: 'ALL_CLEAR', key: 'x', message: 'fine', suggestion: 'install it' })
		);
		const spoof = await pluginCheck({ dir: root });
		expect(spoof.refusals.map(({ code }) => code)).not.toContain('ALL_CLEAR');
		expect(spoof.refusals[0]?.code).toBe('PLUGIN_MANIFEST_INVALID');
	});

	it('says what is missing: no directory, a file, neither manifest and both', async () => {
		const root = await temporaryDirectory();
		expect(codes(await pluginCheck({ dir: join(root, 'gone') }))[0]).toMatch(
			/^PLUGIN_MANIFEST_MISSING/
		);
		// A `.loam-plugin` file is read as an archive (step 9a2), and refused when it is not one; another file is no bundle.
		await write(root, 'mail.loam-plugin', 'PK');
		expect(codes(await pluginCheck({ dir: join(root, 'mail.loam-plugin') }))).toEqual([
			'PLUGIN_MANIFEST_INVALID (archive)',
		]);
		await write(root, 'mail.zip', 'PK');
		const file = await pluginCheck({ dir: join(root, 'mail.zip') });
		expect(codes(file)[0]).toMatch(/^PLUGIN_MANIFEST_MISSING/);
		expect(file.refusals[0]?.message).toMatch(/not a directory or a `\.loam-plugin` archive/);
		expect(codes(await pluginCheck({ dir: root }))[0]).toMatch(/^PLUGIN_MANIFEST_MISSING/);
		await write(root, 'loam-plugin.toml', '');
		await write(root, 'plugin-manifest.json', '{}');
		expect(codes(await pluginCheck({ dir: root }))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin-manifest.json',
		]);
	});
});

describe('loam plugin pack', () => {
	it('writes the bundle and nothing else, checks it again, and reports the same digest', async () => {
		const { dir, mark } = await source();
		const out = join(dir, '..', 'bundle');
		const checked = await pluginCheck({ dir });
		const packed = await pluginPack({ dir, out });
		expect(codes(packed.report)).toEqual([]);
		expect(packed.out).toBe(out);
		expect(packed.bundleSha256).toBe(checked.bundleSha256);
		expect(listed(out)).toEqual([
			'apps/mail/app-manifest.json',
			'apps/mailapp/app-manifest.json',
			'apps/mailapp/dist/native.js',
			'engines/linux-x64/loam-mail',
			'plugin-manifest.json',
		]);
		expect(packed.files).toEqual(listed(out));
		const manifest = JSON.parse(readFileSync(join(out, 'plugin-manifest.json'), 'utf8'));
		expect(manifest.engine.artifacts['linux-x64'].path).toBe('engines/linux-x64/loam-mail');
		expect(manifest).not.toHaveProperty('README');

		// The digest is 7.1's over the bundle as written: each file's own SHA-256, as `sha256sum` would print it.
		const lines = listed(out).map((path) => ({
			path,
			sha256: sha256(readFileSync(join(out, ...path.split('/')))),
		}));
		expect(bundleDigest(lines)).toBe(packed.bundleSha256);

		const bundle = await pluginCheck({ dir: out });
		expect(codes(bundle)).toEqual([]);
		expect(bundle.form).toBe('bundle');
		expect(bundle.bundleSha256).toBe(packed.bundleSha256);
		if (process.platform !== 'win32')
			expect(statSync(join(out, 'engines/linux-x64/loam-mail')).mode & 0o777).toBe(0o755);
		expect(existsSync(mark)).toBe(false);
	});

	it('packs a plugin with no engine', async () => {
		const dir = join(await temporaryDirectory(), 'notes');
		await write(
			dir,
			'loam-plugin.toml',
			'plugin_manifest_version = 1\n\n[plugin]\nid = "mailapp"\ntitle = "Mail app"\nversion = "0.1.0"\ndescription = "A native app alone."\n\n[[apps]]\nid = "mailapp"\npath = "apps/mailapp"\n'
		);
		await write(dir, 'apps/mailapp/app-manifest.json', JSON.stringify(native));
		// The entry its manifest names must be in the package.
		expect(codes((await pluginPack({ dir, out: join(dir, '..', 'out') })).report)).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[0].path',
		]);
		await write(dir, 'apps/mailapp/dist/native.js', 'export default {};\n');
		const packed = await pluginPack({ dir, out: join(dir, '..', 'out') });
		expect(codes(packed.report)).toEqual([]);
		expect(packed.files).toEqual([
			'apps/mailapp/app-manifest.json',
			'apps/mailapp/dist/native.js',
			'plugin-manifest.json',
		]);
	});

	it('refuses a bundle with a file its manifest does not name', async () => {
		const { dir } = await source();
		const out = join(dir, '..', 'bundle');
		await pluginPack({ dir, out });
		await write(out, 'engines/linux-x64/helper', 'x');
		expect(codes(await pluginCheck({ dir: out }))).toEqual([
			'PLUGIN_MANIFEST_INVALID engines/linux-x64/helper',
		]);
		// And a bundle is not packed again.
		expect(codes((await pluginPack({ dir: out, out: join(dir, '..', 'again') })).report)).toContain(
			'PLUGIN_MANIFEST_INVALID engines/linux-x64/helper'
		);
	});

	it('replaces an earlier bundle, and refuses an --out it did not write or that holds the source', async () => {
		const { dir } = await source();
		const out = join(dir, '..', 'bundle');
		expect((await pluginPack({ dir, out })).out).toBe(out);
		expect((await pluginPack({ dir, out })).out).toBe(out);

		const foreign = join(dir, '..', 'documents');
		await write(foreign, 'notes.txt', 'mine');
		await write(foreign, 'plugin-manifest.json', '{}');
		const refused = await pluginPack({ dir, out: foreign });
		expect(codes(refused.report)).toEqual(['PLUGIN_PACK_OUT_INVALID --out']);
		expect(readFileSync(join(foreign, 'notes.txt'), 'utf8')).toBe('mine');

		// A bundle with a file its manifest does not name is not one this command wrote, deep inside or not.
		await write(out, 'apps/mail/notes.txt', 'mine too');
		expect(codes((await pluginPack({ dir, out })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);
		expect(readFileSync(join(out, 'apps/mail/notes.txt'), 'utf8')).toBe('mine too');
		await rm(join(out, 'apps/mail/notes.txt'));
		expect((await pluginPack({ dir, out })).out).toBe(out);

		// Nor is a whole bundle someone else wrote, with no record of this command's beside it.
		const theirs = join(dir, '..', 'theirs');
		await pluginPack({ dir, out: theirs });
		await rm(join(dir, '..', '.theirs.loam-pack.json'));
		expect(codes((await pluginPack({ dir, out: theirs })).report)).toEqual([
			'PLUGIN_PACK_OUT_INVALID --out',
		]);

		for (const inside of [join(dir, 'dist/bundle'), dir, join(dir, '..')]) {
			expect(codes((await pluginPack({ dir, out: inside })).report)).toEqual([
				'PLUGIN_PACK_OUT_INVALID --out',
			]);
		}
		expect(existsSync(join(dir, 'loam-plugin.toml'))).toBe(true);
	});

	it('leaves no staging directory behind, and an earlier bundle as it was when the write fails', async () => {
		const { dir } = await source();
		const parent = join(dir, '..', 'shelf');
		const out = join(parent, 'bundle');
		const first = await pluginPack({ dir, out });
		expect(readdirSync(parent).sort()).toEqual(['.bundle.loam-pack.json', 'bundle']);
		if (process.platform === 'win32' || process.getuid?.() === 0) return;
		await write(dir, 'apps/mailapp/dist/native.js', 'export default { changed: true };\n');
		await chmod(parent, 0o500);
		try {
			const failed = await pluginPack({ dir, out });
			expect(codes(failed.report)).toEqual(['PLUGIN_PACK_FAILED --out']);
		} finally {
			await chmod(parent, 0o700);
		}
		expect(readdirSync(parent).sort()).toEqual(['.bundle.loam-pack.json', 'bundle']);
		expect((await pluginCheck({ dir: out })).bundleSha256).toBe(first.bundleSha256);
	});

	it('refuses to pack a packed bundle', async () => {
		const { dir } = await source();
		const out = join(dir, '..', 'bundle');
		await pluginPack({ dir, out });
		expect(codes((await pluginPack({ dir: out, out: join(dir, '..', 'again') })).report)).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin-manifest.json',
		]);
	});
});

describe('the loam bin', () => {
	it('runs plugin check and plugin pack, exiting 0 on success and 1 on a refusal', async () => {
		const { dir } = await source();
		const out = join(dir, '..', 'bundle');
		let text = '';
		const stdout = (chunk: string) => {
			text += chunk;
		};
		expect(await runCli(['plugin', 'pack', dir, '--out', out], { stdout })).toBe(0);
		const packed = JSON.parse(text);
		expect(packed.data).toMatchObject({ out, form: 'source', plugin: { id: 'mail' } });
		text = '';
		expect(await runCli(['plugin', 'check', out], { stdout })).toBe(0);
		expect(JSON.parse(text).data.bundleSha256).toBe(packed.data.bundleSha256);
		text = '';
		await write(dir, 'engines/linux-x64/loam-mail', 'changed');
		expect(await runCli(['plugin', 'check', dir], { stdout })).toBe(1);
		expect(JSON.parse(text).error.code).toBe('PLUGIN_HASH_MISMATCH');
	});
});
