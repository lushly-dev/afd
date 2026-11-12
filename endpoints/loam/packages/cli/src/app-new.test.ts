import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appNew } from './app-new.js';
import { scaffold } from './templates.js';
import { temporaryDirectory } from './test-support.js';

describe('loam app new', () => {
	it.each(['native', 'view'] as const)('scaffolds a %s app that passes app check', async (kind) => {
		const dir = join(await temporaryDirectory(), 'demo');
		const { report, files } = await appNew({ id: 'demo', kind, dir });
		expect(report.refusals).toEqual([]);
		expect(report.ok).toBe(true);
		// Everything the surface validator says of a scaffold is something its author should fix.
		expect(report.warnings.map(({ code }) => code)).toEqual(['ENTRY_NOT_BUILT']);
		expect(files).toContain('loam-app.toml');
		expect(files).toContain('schemas/demo-ping.input.json');
		expect(files).toContain('src/app.ts');
		expect(files).toContain('test/app.test.ts');
		expect(files).toContain('vite.config.ts');
		expect(existsSync(join(dir, 'tsconfig.json'))).toBe(true);
		const toml = readFileSync(join(dir, 'loam-app.toml'), 'utf8');
		expect(toml).not.toMatch(/^\[ui/m);
		expect(toml).toContain('name = "demo-ping"');
		expect(report.exposure).toEqual({
			'demo-ping': { palette: true, agent: true, mcp: false, cli: false },
		});
		const readme = readFileSync(join(dir, 'README.md'), 'utf8');
		expect(readme).toContain(report.trust?.line);
	});

	it.each(['native', 'view'] as const)(
		"type-checks a %s app's browser code without Node's types (#926)",
		async (kind) => {
			const files = scaffold('demo', kind, 'workspace:*');
			expect(JSON.parse(files['package.json'] as string).scripts.typecheck).toBe(
				'tsc && tsc -p tsconfig.browser.json'
			);
			expect(JSON.parse(files['tsconfig.browser.json'] as string)).toEqual({
				extends: './tsconfig.json',
				compilerOptions: { types: [] },
				include: ['src'],
				exclude: ['**/*.test.ts'],
			});
		}
	);

	it('refuses Node globals in src under the browser project and allows them in test', async () => {
		// Inside this package, so the scaffold's `types: ['node']` resolves @types/node.
		const base = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.cache');
		await mkdir(base, { recursive: true });
		const dir = await mkdtemp(join(base, 'scaffold-types-'));
		try {
			const files = scaffold('demo', 'native', 'workspace:*');
			await writeFile(join(dir, 'tsconfig.json'), files['tsconfig.json'] as string);
			await writeFile(join(dir, 'tsconfig.browser.json'), files['tsconfig.browser.json'] as string);
			await mkdir(join(dir, 'src'));
			await mkdir(join(dir, 'test'));
			await writeFile(join(dir, 'src/probe.ts'), 'export const mode = process.env.MODE;\n');
			await writeFile(join(dir, 'test/probe.ts'), 'export const mode = process.env.MODE;\n');
			const tsc = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));
			const run = (...args: string[]) => {
				try {
					execFileSync(tsc, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
					return '';
				} catch (error) {
					// tsc writes its diagnostics to stdout; a failure to start it has none.
					const { stdout } = error as { stdout?: string };
					if (typeof stdout !== 'string') throw error;
					return stdout;
				}
			};
			expect(run('-p', 'tsconfig.json')).toBe('');
			const browser = run('-p', 'tsconfig.browser.json');
			expect(browser).toMatch(/src\/probe\.ts.*process/);
			expect(browser).not.toContain('test/probe.ts');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('gives a view its pages and the single-file plugin', async () => {
		const dir = join(await temporaryDirectory(), 'demo');
		const { files } = await appNew({ id: 'demo', kind: 'view', dir });
		expect(files).toEqual(
			expect.arrayContaining(['src/handlers.ts', 'src/handlers.html', 'src/main.html'])
		);
		expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toContain(
			"import { singleFileHtml } from '@lushly-dev/loam-cli/vite';"
		);
		expect(readFileSync(join(dir, 'src/handlers.ts'), 'utf8')).toContain('serveHandlers(app)');
	});

	it('scaffolds a mounted app with no command, and D55 in its check', async () => {
		const dir = join(await temporaryDirectory(), 'demo');
		const { report, files } = await appNew({ id: 'demo', kind: 'mounted', dir });
		expect(report.ok).toBe(true);
		expect(files).toEqual(['README.md', 'loam-app.toml', 'package.json']);
		expect(report.warnings).toEqual([]);
		expect(report.trust?.notices.map(({ code }) => code)).toContain(
			'TEAM_INSTANCE_SINGLE_PRINCIPAL'
		);
	});

	it('uses the dependency spec it is given, and `workspace:*` otherwise', async () => {
		const root = await temporaryDirectory();
		await appNew({ id: 'one', kind: 'native', dir: join(root, 'one') });
		await appNew({ id: 'two', kind: 'native', dir: join(root, 'two'), depSpec: 'link:../sdk' });
		await appNew({
			id: 'three',
			kind: 'native',
			dir: join(root, 'three'),
			depSpec: 'link:/repo/packages/{unit}',
		});
		const read = (name: string) =>
			JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8'));
		expect(read('one').dependencies['@lushly-dev/loam-sdk']).toBe('workspace:*');
		expect(read('two').dependencies['@lushly-dev/loam-sdk']).toBe('link:../sdk');
		// A path names one package, so each unit fills in its own.
		const three = read('three');
		expect(three.dependencies['@lushly-dev/loam-sdk']).toBe('link:/repo/packages/sdk');
		expect(three.devDependencies['@lushly-dev/loam-cli']).toBe('link:/repo/packages/cli');
		expect(three.devDependencies['@lushly-dev/loam-testing']).toBe('link:/repo/packages/testing');
	});

	it('writes into `./<id>` when no directory is named', async () => {
		const root = await temporaryDirectory();
		const before = process.cwd();
		process.chdir(root);
		try {
			const { dir } = await appNew({ id: 'demo', kind: 'mounted' });
			expect(dir).toBe(join(root, 'demo'));
		} finally {
			process.chdir(before);
		}
	});

	it.each([
		['layout', 'MANIFEST_ID_RESERVED'],
		['afd', 'MANIFEST_ID_RESERVED'],
		['Bad', 'MANIFEST_INVALID'],
		['../escape', 'MANIFEST_INVALID'],
		['quo"te', 'MANIFEST_INVALID'],
	])('refuses the id %s and writes nothing', async (id, code) => {
		const root = await temporaryDirectory();
		const { report, dir } = await appNew({ id, kind: 'native', dir: join(root, 'demo') });
		expect(report.ok).toBe(false);
		expect(report.refusals.map((refusal) => refusal.code)).toContain(code);
		expect(dir).toBeUndefined();
		expect(readdirSync(root)).toEqual([]);
	});

	it('overwrites nothing', async () => {
		const dir = await temporaryDirectory();
		await writeFile(join(dir, 'keep.txt'), 'mine');
		const { report } = await appNew({ id: 'demo', kind: 'native', dir });
		expect(report.refusals[0]?.code).toBe('APP_DIR_NOT_EMPTY');
		expect(readdirSync(dir)).toEqual(['keep.txt']);
	});
});
