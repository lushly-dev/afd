import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readManifest } from '@lushly-dev/loam-manifest/validate';
import { describe, expect, it } from 'vitest';
import { appNew } from './app-new.js';
import { appPack } from './app-pack.js';
import { temporaryDirectory } from './test-support.js';

async function write(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

async function builtNative(): Promise<string> {
	const dir = join(await temporaryDirectory(), 'demo');
	await appNew({ id: 'demo', kind: 'native', dir });
	await write(dir, 'dist/native.js', "export default import('./chunk.js');\n");
	await write(dir, 'dist/chunk.js', 'export default {};\n');
	return dir;
}

describe('loam app pack', () => {
	it('inlines the schemas and copies the entry with its chunks', async () => {
		const dir = await builtNative();
		const out = join(dir, 'dist/package');
		const { report, files } = await appPack({ dir, out });
		expect(report.refusals).toEqual([]);
		expect(files).toEqual(['app-manifest.json', 'dist/chunk.js', 'dist/native.js']);
		const packed = JSON.parse(readFileSync(join(out, 'app-manifest.json'), 'utf8'));
		expect(packed.commands[0].input_schema).toMatchObject({ type: 'object' });
		// What it wrote is what the kernel reads.
		expect(readManifest(packed).ok).toBe(true);
		expect(existsSync(join(out, 'dist/package'))).toBe(false);
	});

	it('writes the manifest version its source has (D76)', async () => {
		for (const version of [1, 2]) {
			const dir = await builtNative();
			const source = join(dir, 'loam-app.toml');
			await writeFile(
				source,
				readFileSync(source, 'utf8').replace(
					'manifest_version = 1',
					`manifest_version = ${version}`
				)
			);
			const out = join(dir, 'dist/package');
			const { report } = await appPack({ dir, out });
			expect(report.refusals).toEqual([]);
			const packed = JSON.parse(readFileSync(join(out, 'app-manifest.json'), 'utf8'));
			expect(packed.manifest_version).toBe(version);
			expect(readManifest(packed).ok).toBe(true);
		}
	});

	it('replaces an earlier package, and keeps no stale file', async () => {
		const dir = await builtNative();
		const out = join(dir, 'dist/package');
		await appPack({ dir, out });
		await write(out, 'stale.txt', 'old');
		const { files } = await appPack({ dir, out });
		expect(files).not.toContain('stale.txt');
		expect(existsSync(join(out, 'stale.txt'))).toBe(false);
	});

	it('copies a view and a skill, and packs one source by another manifest', async () => {
		const dir = await temporaryDirectory();
		await write(
			dir,
			'manifests/view.toml',
			`manifest_version = 1
protocol = 1

[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "A view app, for the tests of app pack."
kind = "view"
domains = ["hello"]

[view]
handlers = "dist/handlers.html"

[[commands]]
name = "hello-list"
description = "List the names greeted, as a sidebar list."
category = "hello"
effects = ["inspect"]
input_schema = "schemas/list.json"

[[skills]]
name = "hello-guide"
path = "skills/hello-guide"

[[ui.resources]]
uri = "ui://hello/main"
path = "dist/main.html"
`
		);
		await write(dir, 'schemas/list.json', '{"type":"object","additionalProperties":false}');
		await write(dir, 'skills/hello-guide/SKILL.md', '# Guide\n');
		await write(dir, 'dist/handlers.html', '<!doctype html><script type="module">1</script>');
		await write(dir, 'dist/main.html', '<!doctype html><h1>Hi</h1>');
		await write(dir, 'dist/other.html', 'not named');
		const out = join(await temporaryDirectory(), 'package');
		const { files, report } = await appPack({ dir, manifest: 'manifests/view.toml', out });
		expect(report.refusals).toEqual([]);
		expect(files).toEqual([
			'app-manifest.json',
			'dist/handlers.html',
			'dist/main.html',
			'skills/hello-guide/SKILL.md',
		]);
	});

	it('takes a link that stays inside the root as its content', async () => {
		const dir = await builtNative();
		await write(dir, 'assets/shared.js', 'export const a = 1;\n');
		await symlink('../assets/shared.js', join(dir, 'dist/shared.js'));
		const out = join(await temporaryDirectory(), 'package');
		const { files } = await appPack({ dir, out });
		expect(files).toContain('dist/shared.js');
		expect(statSync(join(out, 'dist/shared.js')).isFile()).toBe(true);
	});

	it('refuses a symlink leaving the root, and writes nothing', async () => {
		const dir = await builtNative();
		const secret = join(await temporaryDirectory(), 'secret.txt');
		await writeFile(secret, 'hunter2');
		await symlink(secret, join(dir, 'dist/secret.txt'));
		const out = join(await temporaryDirectory(), 'package');
		const { report } = await appPack({ dir, out });
		expect(report.ok).toBe(false);
		expect(report.refusals[0]).toMatchObject({
			code: 'MANIFEST_PATH_ESCAPE',
			key: 'dist/secret.txt',
		});
		expect(existsSync(out)).toBe(false);
	});

	it('refuses a schema link leaving the root', async () => {
		const dir = await builtNative();
		const outside = join(await temporaryDirectory(), 'in.json');
		await writeFile(outside, '{"type":"object"}');
		const schema = join(dir, 'schemas/demo-ping.input.json');
		await rm(schema);
		await symlink(outside, schema);
		const { report } = await appPack({ dir, out: join(dir, 'dist/package') });
		expect(report.refusals[0]).toMatchObject({
			code: 'MANIFEST_PATH_ESCAPE',
			key: 'commands[0].input_schema',
		});
	});

	it('refuses a link loop, rather than following it for ever', async () => {
		const dir = await builtNative();
		await symlink('.', join(dir, 'dist/loop'));
		const { report } = await appPack({ dir, out: join(dir, 'dist/package') });
		expect(report.refusals[0]).toMatchObject({ code: 'MANIFEST_PATH_ESCAPE', key: 'dist/loop' });
	});

	it('leaves out an earlier package for another manifest', async () => {
		const dir = await builtNative();
		await appPack({ dir, out: join(dir, 'dist/view-package') });
		const { files } = await appPack({ dir, out: join(dir, 'dist/package') });
		expect(files).toEqual(['app-manifest.json', 'dist/chunk.js', 'dist/native.js']);
	});

	it('refuses an --out holding what is being packed', async () => {
		const dir = await builtNative();
		await write(dir, 'dist/.loam-output', 'marked');
		const { report } = await appPack({ dir, out: join(dir, 'dist') });
		expect(report.refusals[0]?.code).toBe('APP_PACK_OUT_INVALID');
		expect(existsSync(join(dir, 'dist/native.js'))).toBe(true);
	});

	it('refuses an entry that is not built', async () => {
		const dir = join(await temporaryDirectory(), 'demo');
		await appNew({ id: 'demo', kind: 'native', dir });
		const { report, files } = await appPack({ dir, out: join(dir, 'dist/package') });
		expect(report.refusals[0]?.code).toBe('ENTRY_NOT_BUILT');
		expect(files).toEqual([]);
	});

	it('refuses an entry directly in the root', async () => {
		const dir = await builtNative();
		const path = join(dir, 'loam-app.toml');
		await writeFile(path, (await readFile(path, 'utf8')).replace('dist/native.js', 'native.js'));
		await write(dir, 'native.js', 'export default {};\n');
		const { report } = await appPack({ dir, out: join(dir, 'dist/package') });
		expect(report.refusals[0]?.code).toBe('APP_ENTRY_AT_ROOT');
	});

	it('will not delete the source or files it did not write', async () => {
		const dir = await builtNative();
		expect((await appPack({ dir, out: dir })).report.refusals[0]?.code).toBe(
			'APP_PACK_OUT_INVALID'
		);
		expect((await appPack({ dir, out: dirname(dir) })).report.refusals[0]?.code).toBe(
			'APP_PACK_OUT_INVALID'
		);
		const other = await temporaryDirectory();
		await writeFile(join(other, 'keep.txt'), 'mine');
		// A file with a common name is not leave to delete the rest.
		await writeFile(join(other, 'app-manifest.json'), '{}');
		expect((await appPack({ dir, out: other })).report.refusals[0]?.code).toBe(
			'APP_PACK_OUT_INVALID'
		);
		expect(readdirSync(other).sort()).toEqual(['app-manifest.json', 'keep.txt']);
		expect(existsSync(join(dir, 'loam-app.toml'))).toBe(true);
	});
});
