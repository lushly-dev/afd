/**
 * The skill catalog (`spec/mcp-resources.md`, S2, S3, S5, S6): its checks, orders, MIME types and
 * directory listing, and reading a skill from disk. The cases follow the Rust catalog's
 * (`packages/rust/src/server/skills.rs`).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	MAX_SKILL_BYTES,
	MAX_SKILL_FILES,
	SkillCatalog,
	skillFromDirectory,
	skillMimeType,
} from './skills.js';

const skillMd = (name: string) => `---\nname: ${name}\ndescription: Does ${name}.\n---\n\nBody.\n`;
const one = (path: string, text: string | Uint8Array) =>
	new SkillCatalog([{ path, files: { 'SKILL.md': text } }]);

describe('skillMimeType', () => {
	it.each([
		['SKILL.md', 'text/markdown'],
		['a/B.MD', 'text/markdown'],
		['a.txt', 'text/plain'],
		['a.json', 'application/json'],
		['a.yaml', 'application/yaml'],
		['a.YML', 'application/yaml'],
		['a.toml', 'application/toml'],
		['a.csv', 'text/csv'],
		['a.html', 'text/html'],
		['a.css', 'text/css'],
		['a.js', 'text/javascript'],
		['a.mjs', 'text/javascript'],
		['a.ts', 'text/x-typescript'],
		['a.py', 'text/x-python'],
		['a.sh', 'text/x-shellscript'],
		['a.svg', 'image/svg+xml'],
		['a.png', 'image/png'],
		['a.jpg', 'image/jpeg'],
		['a.JPEG', 'image/jpeg'],
		['a.gif', 'image/gif'],
		['a.pdf', 'application/pdf'],
		['a.bin', 'application/octet-stream'],
		['noext', 'application/octet-stream'],
		['dir.md/file', 'application/octet-stream'],
		['constructor', 'application/octet-stream'],
		['.md', 'text/markdown'],
	])('%s is %s', (path, expected) => {
		expect(skillMimeType(path)).toBe(expected);
	});
});

describe('SkillCatalog checks', () => {
	it('counts files and bytes against the extension limits', () => {
		const files = Object.fromEntries(
			Array.from({ length: MAX_SKILL_FILES }, (_, index) => [`f${index}.txt`, 'x'])
		);
		expect(
			() => new SkillCatalog([{ path: 'a', files: { 'SKILL.md': skillMd('a'), ...files } }])
		).toThrow('files');
		const atLimit = Object.fromEntries(
			Array.from({ length: MAX_SKILL_FILES - 1 }, (_, i) => [`f${i}`, 'x'])
		);
		expect(
			() => new SkillCatalog([{ path: 'a', files: { 'SKILL.md': skillMd('a'), ...atLimit } }])
		).not.toThrow();
		expect(
			() =>
				new SkillCatalog([
					{
						path: 'a',
						files: { 'SKILL.md': skillMd('a'), 'big.bin': new Uint8Array(MAX_SKILL_BYTES) },
					},
				])
		).toThrow('bytes');
	});

	it.each(['', '/a', 'a/', 'a//b', './a', 'a/./b', 'a/../b', '../a'])(
		'refuses the file path %j',
		(bad) => {
			expect(
				() => new SkillCatalog([{ path: 'a', files: { 'SKILL.md': skillMd('a'), [bad]: 'x' } }])
			).toThrow();
		}
	);

	it('refuses a file and a directory at one URI', () => {
		expect(
			() =>
				new SkillCatalog([{ path: 'a', files: { 'SKILL.md': skillMd('a'), x: '1', 'x/y': '2' } }])
		).toThrow();
	});

	it('refuses file text that is not well-formed', () => {
		expect(
			() =>
				new SkillCatalog([{ path: 'a', files: { 'SKILL.md': skillMd('a'), 'lone.txt': '\ud800' } }])
		).toThrow('lone.txt');
	});

	it('checks names, paths and descriptions', () => {
		const longName = 'a'.repeat(65);
		expect(() => one(longName, skillMd(longName))).toThrow();
		const longest = 'a'.repeat(64);
		expect(() => one(longest, skillMd(longest))).not.toThrow();
		for (const bad of ['-a', 'a-', 'A', 'a_b', 'a b'])
			expect(() => one(bad, skillMd(bad)), bad).toThrow();
		expect(() => one('Acme/a', skillMd('a'))).toThrow();
		expect(() => one('a', '---\nname: a\ndescription: ""\n---\n')).toThrow('description');
		expect(() => one('a', `---\nname: a\ndescription: ${'é'.repeat(1025)}\n---\n`)).toThrow(
			'description'
		);
		expect(() => one('a', `---\nname: a\ndescription: ${'é'.repeat(1024)}\n---\n`)).not.toThrow();
		expect(() => one('a', `---\nname: a\ndescription: ${'😀'.repeat(1024)}\n---\n`)).not.toThrow();
		expect(() => one('a', '---\nname: 7\ndescription: x\n---\n')).toThrow('name');
		expect(() => one('a', new Uint8Array([0xff, 0xfe]))).toThrow('UTF-8');
		expect(
			() =>
				new SkillCatalog([
					{ path: 'a', files: { 'SKILL.md': skillMd('a') } },
					{ path: 'a', files: { 'SKILL.md': skillMd('a') } },
				])
		).toThrow('used twice');
	});

	it('keeps frontmatter other than name and description as the author wrote it', () => {
		const text =
			'---\nname: a\ndescription: d\nupdated: 2026-11-01\nmetadata:\n  version: "1.0"\n---\n';
		expect(
			new SkillCatalog([{ path: 'a', files: { 'SKILL.md': text } }]).entries()[0]?.frontmatter
		).toEqual({
			name: 'a',
			description: 'd',
			updated: '2026-11-01',
			metadata: { version: '1.0' },
		});
	});
});

describe('SkillCatalog orders', () => {
	it('lists skills in catalog order and manifests SKILL.md first, then by UTF-8 bytes', () => {
		const catalog = new SkillCatalog([
			{
				path: 'p/b',
				files: { 'z.md': 'z', 'A.md': 'a', 'SKILL.md': skillMd('b'), 'm/n.txt': 'n', 'é.md': 'e' },
			},
			{ path: 'a', files: { 'SKILL.md': skillMd('a') } },
		]);
		expect(catalog.entries().map((entry) => entry.uri)).toEqual([
			'skill://p/b/SKILL.md',
			'skill://a/SKILL.md',
		]);
		const manifest = ((catalog.entries()[0]?.resources ?? []) as Array<{ uri: string }>).map(
			(file) => file.uri
		);
		expect(manifest).toEqual([
			'skill://p/b/SKILL.md',
			'skill://p/b/A.md',
			'skill://p/b/m/n.txt',
			'skill://p/b/z.md',
			'skill://p/b/é.md',
		]);
		expect(catalog.resources().map((resource) => resource.uri)).toEqual([
			...manifest,
			'skill://a/SKILL.md',
		]);
		expect(catalog.size).toBe(2);
	});

	it('lists directory children in byte order of their own names', () => {
		const catalog = new SkillCatalog([
			{
				path: 'b',
				files: {
					'SKILL.md': skillMd('b'),
					'references/one.md': '1',
					'references/deep/two.md': '2',
					'assets/x.bin': 'x',
					'z.txt': 'z',
				},
			},
		]);
		const names = (uri: string) => catalog.directory(uri)?.map((child) => child.uri);
		expect(names('skill://b')).toEqual([
			'skill://b/SKILL.md',
			'skill://b/assets',
			'skill://b/references',
			'skill://b/z.txt',
		]);
		expect(names('skill://b/references')).toEqual([
			'skill://b/references/deep',
			'skill://b/references/one.md',
		]);
		expect(catalog.directory('skill://b')?.[1]).toEqual({
			uri: 'skill://b/assets',
			name: 'assets',
			mimeType: 'inode/directory',
		});
		expect(names('skill://b/')).toBeUndefined();
		expect(names('skill://b/missing')).toBeUndefined();
		expect(names('skill://b/z.txt')).toBeUndefined();
		expect(names('skill://c')).toBeUndefined();
	});
});

describe('skillFromDirectory', () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it('reads a directory, follows links inside it and refuses links that leave it', async () => {
		const temp = mkdtempSync(join(tmpdir(), 'afd-skill-'));
		roots.push(temp);
		const skill = join(temp, 'hello');
		mkdirSync(join(skill, 'references'), { recursive: true });
		writeFileSync(join(skill, 'SKILL.md'), skillMd('hello'));
		writeFileSync(join(skill, 'references/STYLE.md'), '# Style\n');
		writeFileSync(join(temp, 'outside.md'), 'secret');

		const loaded = await skillFromDirectory('hello', skill);
		const catalog = new SkillCatalog([loaded]);
		expect(catalog.resources()).toHaveLength(2);
		expect(
			Buffer.from(catalog.file('skill://hello/references/STYLE.md')?.bytes ?? []).toString()
		).toBe('# Style\n');

		symlinkSync('SKILL.md', join(skill, 'alias.md'));
		expect(Object.keys((await skillFromDirectory('hello', skill)).files)).toHaveLength(3);

		symlinkSync(join(temp, 'outside.md'), join(skill, 'leak.md'));
		await expect(skillFromDirectory('hello', skill)).rejects.toThrow(/leak\.md.*leaves/);
		rmSync(join(skill, 'leak.md'));

		symlinkSync(temp, join(skill, 'up'));
		await expect(skillFromDirectory('hello', skill)).rejects.toThrow();
		await expect(skillFromDirectory('hello', join(temp, 'missing'))).rejects.toThrow('hello');
	});
});
