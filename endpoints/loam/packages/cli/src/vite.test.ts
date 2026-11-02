import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { temporaryDirectory } from './test-support.js';
import { singleFileHtml } from './vite.js';

const PAGE =
	'<html><head><script type="module" crossorigin src="./assets/index-1.js"></script>\n<link rel="modulepreload" crossorigin href="./assets/index-1.js">\n<link rel="stylesheet" crossorigin href="./assets/index-1.css"></head><body></body></html>';

type Item = {
	type: string;
	fileName: string;
	source?: string;
	code?: string;
	imports?: string[];
	dynamicImports?: string[];
};

function bundle(code = 'console.log("$&");', css = 'body{margin:0}'): Record<string, Item> {
	return {
		'index.html': { type: 'asset', fileName: 'index.html', source: PAGE },
		'assets/index-1.js': {
			type: 'chunk',
			fileName: 'assets/index-1.js',
			code,
			imports: [],
			dynamicImports: [],
		},
		'assets/index-1.css': { type: 'asset', fileName: 'assets/index-1.css', source: css },
	};
}

const run = (files: Record<string, Item>) =>
	(singleFileHtml().generateBundle as unknown as (options: unknown, bundle: unknown) => void)(
		{},
		files
	);

describe('singleFileHtml', () => {
	it('inlines the script and stylesheet where they were, with no CSP of its own', () => {
		const files = bundle();
		run(files);
		expect(Object.keys(files)).toEqual(['index.html']);
		const page = String(files['index.html']?.source);
		expect(page).toContain('<script type="module">console.log("$&");</script>');
		expect(page).toContain('<style>body{margin:0}</style>');
		expect(page).not.toContain('assets/');
		expect(page).not.toContain('Content-Security-Policy');
	});

	it('takes a page with no stylesheet', () => {
		const files = bundle();
		delete files['assets/index-1.css'];
		files['index.html'] = {
			type: 'asset',
			fileName: 'index.html',
			source: PAGE.replace(/<link rel="stylesheet"[^>]*>/, ''),
		};
		run(files);
		expect(Object.keys(files)).toEqual(['index.html']);
	});

	it.each([
		['"</script>"', /closing script/],
		['"<!--<script>"', /closing script/],
	])('refuses code that would end the inline element early: %s', (code, message) => {
		expect(() => run(bundle(code))).toThrow(message);
	});

	it('refuses a stylesheet that would end the inline element early', () => {
		expect(() => run(bundle(undefined, '</style>'))).toThrow(/closing script or style/);
	});

	it('refuses a chunk with imports, a missing reference and anything left beside the page', () => {
		const shared = bundle();
		(shared['assets/index-1.js'] as Item).imports = ['assets/shared.js'];
		expect(() => run(shared)).toThrow(/imports other chunks/);

		const lost = bundle();
		delete lost['assets/index-1.js'];
		expect(() => run(lost)).toThrow(/not in the bundle/);

		const beside = bundle();
		beside['assets/logo.svg'] = { type: 'asset', fileName: 'assets/logo.svg', source: '<svg/>' };
		expect(() => run(beside)).toThrow(/assets\/logo\.svg/);

		expect(() => run({})).toThrow(/HTML page/);
	});

	it('builds one real page with Vite', async () => {
		const root = await temporaryDirectory();
		const src = join(root, 'src');
		await mkdir(src);
		await writeFile(join(src, 'style.css'), 'h1 { color: var(--color-text-primary); }\n');
		await writeFile(join(src, 'helper.ts'), "export const answer = (): string => 'the answer';\n");
		await writeFile(
			join(src, 'main.html'),
			`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Page</title>
		<link rel="stylesheet" href="./style.css" />
	</head>
	<body>
		<h1 id="out">Page</h1>
		<script type="module">
			import { answer } from './helper.ts';
			document.getElementById('out').textContent = answer();
		</script>
	</body>
</html>
`
		);
		await build({
			root: src,
			configFile: false,
			logLevel: 'silent',
			plugins: [singleFileHtml()],
			build: {
				outDir: '../dist',
				emptyOutDir: true,
				rollupOptions: { input: join(src, 'main.html') },
			},
		});
		expect(readdirSync(join(root, 'dist'))).toEqual(['main.html']);
		const page = readFileSync(join(root, 'dist/main.html'), 'utf8');
		expect(page).toContain('the answer');
		expect(page).toMatch(/<style>[^<]*--color-text-primary/);
		expect(page).not.toMatch(/<script[^>]*\bsrc=/);
		expect(page).not.toMatch(/<link[^>]*stylesheet/);
	});
});
