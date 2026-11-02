/**
 * The `path-inside-root` and `files` cases of spec/plugin-manifest.json (phase 1 specification, 2.4),
 * over the map `checkApp` takes and over a real disk read by `readAppTree`.
 */
import { readFileSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { keyOf, readCoreManifest } from '@lushly-dev/loam-manifest/validate';
import { describe, expect, it } from 'vitest';
import {
	type AppTree,
	builtFileFindings,
	DOT_DOT_SEGMENT,
	inlineSchemas,
	JSON_PATH,
} from './file-rules.js';
import { temporaryDirectory } from './test-support.js';
import { readAppTree } from './tree.js';

interface RuleCase {
	id: string;
	rule: string;
	manifest: unknown;
	accepted: boolean;
	pointer?: string;
	suggestion?: string;
	files?: Record<string, string>;
	symlinks?: Record<string, string>;
}

const { rules } = JSON.parse(
	readFileSync(new URL('../../../../../spec/plugin-manifest.json', import.meta.url), 'utf8')
) as { rules: RuleCase[] };

const onDisk = rules.filter(({ rule }) => rule === 'path-inside-root' || rule === 'files');

/** What the rule answers: the file rules, then the reader, which runs an inlined schema's own rule. */
function refusalsOf(manifest: unknown, tree: AppTree) {
	const { inlined, findings } = inlineSchemas(manifest, tree);
	const read = readCoreManifest(inlined);
	return [
		...findings.map(({ pointer, ...finding }) => ({ ...finding, key: keyOf(pointer) })),
		...(read.ok ? [] : read.refusals),
	];
}

function expectAnswer(item: RuleCase, tree: AppTree): void {
	const refusals = refusalsOf(item.manifest, tree);
	if (item.accepted) {
		expect(refusals).toEqual([]);
		return;
	}
	expect(refusals.map(({ key }) => key)).toEqual([keyOf(item.pointer as string)]);
	const [refusal] = refusals;
	if (item.rule === 'path-inside-root') {
		expect(refusal?.code).toBe('MANIFEST_PATH_ESCAPE');
		expect(refusal?.suggestion).toBe(item.suggestion);
	} else if (refusal?.code === 'MANIFEST_FILE_MISSING') {
		expect(refusal.suggestion).toBe(item.suggestion);
	} else {
		// The file's content broke the rule its key has when written inline.
		expect(['MANIFEST_INPUT_SCHEMA_INVALID', 'MANIFEST_CONFIG_SCHEMA_INVALID']).toContain(
			refusal?.code
		);
		expect(refusal?.suggestion).not.toBe('');
	}
}

describe('spec/plugin-manifest.json, the rules that need files', () => {
	it('has the cases', () => {
		expect(onDisk.length).toBeGreaterThanOrEqual(15);
	});

	for (const item of onDisk) {
		it(`${item.rule}: ${item.id}, as a map`, () => {
			expectAnswer(item, { files: item.files ?? {}, symlinks: item.symlinks ?? {} });
		});

		it(`${item.rule}: ${item.id}, on a disk`, async () => {
			const root = join(await temporaryDirectory(), 'nested', 'root');
			await mkdir(root, { recursive: true });
			for (const [path, text] of Object.entries(item.files ?? {})) {
				const target = join(root, path);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, text);
			}
			for (const [path, target] of Object.entries(item.symlinks ?? {})) {
				await mkdir(dirname(join(root, path)), { recursive: true });
				await symlink(target, join(root, path));
			}
			expectAnswer(item, await readAppTree(root));
		});
	}
});

describe('the path rules beyond the cases', () => {
	const manifest = (input_schema: string) => ({
		commands: [{ name: 'hello-greet', input_schema }],
	});

	it('refuses a cycle of links as a link to nothing', () => {
		const { findings } = inlineSchemas(manifest('schemas/a.json'), {
			files: {},
			symlinks: { 'schemas/a.json': 'b.json', 'schemas/b.json': 'a.json' },
		});
		expect(findings[0]?.code).toBe('MANIFEST_PATH_ESCAPE');
		expect(findings[0]?.suggestion).toMatch(/to nothing/);
	});

	it('refuses a link through a directory that leaves the root', () => {
		const { findings } = inlineSchemas(manifest('schemas/in.json'), {
			files: { '../outside/in.json': '{}' },
			symlinks: { schemas: '../outside' },
		});
		expect(findings[0]?.suggestion).toMatch(/leaves it/);
	});

	it('refuses an absolute link target, a drive prefix and a climbing path', () => {
		const tree = {
			files: { 'schemas/in.json': '{}' },
			symlinks: { 'schemas/a.json': '/etc/passwd' },
		};
		for (const path of ['schemas/a.json', 'C:/schemas/in.json', '../schemas/in.json']) {
			const { findings, inlined } = inlineSchemas(manifest(path), tree);
			expect(findings[0]?.code, path).toBe('MANIFEST_PATH_ESCAPE');
			expect((inlined.commands as { input_schema: object }[])[0]?.input_schema).toEqual({
				type: 'object',
				additionalProperties: false,
			});
		}
	});

	it.each([
		['/schemas/in.json', 'MANIFEST_PATH_ESCAPE'],
		['schemas/../schemas/in.json', 'MANIFEST_PATH_ESCAPE'],
		['schemas/in.txt', 'MANIFEST_INVALID'],
		['schemas\\in.json', 'MANIFEST_INVALID'],
	])(
		"applies the core's path shape, which an inlined schema hides from the reader: %s",
		(path, code) => {
			const { findings } = inlineSchemas(manifest(path), {
				files: { 'schemas/in.json': '{"type":"object"}', 'schemas/in.txt': '{"type":"object"}' },
				symlinks: {},
			});
			expect(findings.map((finding) => finding.code)).toEqual([code]);
		}
	);

	it("holds the path shape equal to the core's", () => {
		const { jsonPath } = (
			JSON.parse(
				readFileSync(
					new URL('../../../../../spec/plugin-manifest.core.v1.json', import.meta.url),
					'utf8'
				)
			) as { $defs: { jsonPath: { pattern: string; not: { pattern: string } } } }
		).$defs;
		const decode = (pattern: string) => new RegExp(pattern).source;
		expect(decode(JSON_PATH.source)).toBe(decode(jsonPath.pattern.replaceAll('\\u0000', '\\0')));
		expect(decode(DOT_DOT_SEGMENT.source)).toBe(decode(jsonPath.not.pattern));
	});

	it('follows a path with `.` segments and a link inside the root', () => {
		const { findings, inlined } = inlineSchemas(manifest('./schemas/./a.json'), {
			files: { 'real/in.json': '{"type":"object"}' },
			symlinks: { 'schemas/a.json': '../real/in.json' },
		});
		expect(findings).toEqual([]);
		expect((inlined.commands as { input_schema: object }[])[0]?.input_schema).toEqual({
			type: 'object',
		});
	});
});

describe("Loam's built files", () => {
	const view = (html?: string): AppTree => ({
		files: html === undefined ? {} : { 'dist/main.html': html },
		symlinks: {},
	});
	const manifest = { ui: { resources: [{ uri: 'ui://hello/main', path: 'dist/main.html' }] } };

	it('warns of a file not built yet', () => {
		const { refusals, warnings } = builtFileFindings(manifest, view());
		expect(refusals).toEqual([]);
		expect(warnings[0]).toMatchObject({
			code: 'ENTRY_NOT_BUILT',
			pointer: '/ui/resources/0/path',
		});
	});

	it('takes one file, even when its inline code mentions a reference', () => {
		const html = `<!doctype html><!-- <script src="x.js"></script> -->
			<style>a{}</style><script type="module">const a = '<script src="y.js">';</script>
			<link rel="icon" href="data:,"><script data-src="x"></script>`;
		expect(builtFileFindings(manifest, view(html))).toEqual({ refusals: [], warnings: [] });
	});

	it.each([
		'<script src="x.js"></script>',
		"<script type='module' src='./x.js'></script>",
		'<link rel="stylesheet" href="x.css">',
		'<link href="x.css" rel=stylesheet>',
		'<link rel="alternate stylesheet" href="x.css">',
		'<style>@import url(x.css);</style>',
	])('refuses an external reference: %s', (html) => {
		const { refusals } = builtFileFindings(manifest, view(html));
		expect(refusals[0]?.code).toBe('VIEW_NOT_SINGLE_FILE');
	});

	it('refuses an entry whose link leaves the root, and does not read a native entry as a page', () => {
		const native = { native: { entry: 'dist/native.js' }, view: { handlers: 'dist/h.html' } };
		const { refusals } = builtFileFindings(native, {
			files: { 'dist/native.js': '<script src="x.js"></script>', '../h.html': '' },
			symlinks: { 'dist/h.html': '../../h.html' },
		});
		expect(refusals.map(({ pointer, code }) => [pointer, code])).toEqual([
			['/view/handlers', 'MANIFEST_PATH_ESCAPE'],
		]);
	});
});
