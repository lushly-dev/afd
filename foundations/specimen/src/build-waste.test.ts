import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	buildSizeDeltas,
	inspectBuild,
	moduleIdentity,
	TOTAL_TRIPWIRE,
	type WasteChunk,
} from './build-waste.js';

// The static build's waste checks on synthetic Rolldown chunks: each plant fails by its named
// cause, and large legitimate growth, which the old ceilings failed, passes. The real build's
// plant (a preview importing axe-core) is in `static-build.test.ts`.
let modulesRoot: string;
let roots: { packageSource: string; projectRoot: string; siteRoot: string };

async function install(name: string, version: string, under = modulesRoot): Promise<string> {
	const root = join(under, 'node_modules', name);
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'package.json'), JSON.stringify({ name, version }));
	return root;
}

beforeAll(async () => {
	modulesRoot = (await mkdtemp(join(tmpdir(), 'specimen-waste-'))).split('\\').join('/');
	roots = {
		packageSource: `${modulesRoot}/specimen/dist`,
		projectRoot: `${modulesRoot}/project`,
		siteRoot: `${modulesRoot}/site`,
	};
	await install('axe-core', '4.14.0');
	await install('axe-core', '4.11.1', `${modulesRoot}/nested`);
	await install('axe-core', '4.14.0', `${modulesRoot}/twice`);
	await install('@testing-library/dom', '10.4.1');
	await install('aria-query', '5.3.0');
	await install('aria-query', '5.3.2', `${modulesRoot}/jest-dom`);
	// A workspace package linked from outside the project, as pnpm links one; and a manifest with
	// no version.
	await mkdir(`${modulesRoot}/workspace/fast-element/dist`, { recursive: true });
	await writeFile(
		`${modulesRoot}/workspace/fast-element/package.json`,
		JSON.stringify({ name: '@lushly-dev/fast-element', version: '2.1.0' })
	);
	await mkdir(`${modulesRoot}/node_modules/versionless`, { recursive: true });
	await writeFile(
		`${modulesRoot}/node_modules/versionless/package.json`,
		JSON.stringify({ name: 'versionless' })
	);
});
afterAll(async () => {
	await rm(modulesRoot, { recursive: true, force: true });
});

const chunk = (
	fileName: string,
	modules: Record<string, number>,
	options: { isEntry?: boolean; imports?: string[] } = {}
): WasteChunk => ({
	fileName,
	isEntry: options.isEntry ?? false,
	imports: options.imports ?? [],
	modules: Object.fromEntries(
		Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }])
	),
});
const axe = () => `${modulesRoot}/node_modules/axe-core/axe.js`;
const entry = () =>
	chunk(
		'assets/entry.js',
		{ [`${roots.packageSource}/browser/index.js`]: 58_000 },
		{ isEntry: true }
	);
const lazyAxe = (bytes = 659_293) => chunk('assets/axe.js', { [axe()]: bytes });
const categoryOf = (file: string) =>
	file.includes('axe') ? 'accessibility' : file.includes('helpers') ? 'interaction' : 'shell';
const inspect = (chunks: WasteChunk[], total = 1_327_581, alwaysLoaded?: string[]) =>
	inspectBuild(chunks, categoryOf, { ...roots, ...(alwaysLoaded && { alwaysLoaded }) }, total);

describe('the waste checks', () => {
	it('pass the bench as it is built today', () => {
		expect(inspect([entry(), lazyAxe()]).waste).toEqual([]);
	});

	it('pass large legitimate growth that the old ceilings failed', () => {
		// The old accessibility ceiling was 650,000 and the total 1,345,000: an engine twice
		// axe-core 4.14.0's size, loaded only by the cases that check, is growth, not waste.
		const { waste } = inspect([entry(), lazyAxe(1_318_586)], 2_000_000);
		expect(waste).toEqual([]);
	});

	it('fail one module copied into two chunks, naming it and both chunks', () => {
		const copied = `${roots.projectRoot}/src/shared.ts`;
		const { waste } = inspect([
			entry(),
			chunk('assets/a.js', { [copied]: 900 }),
			chunk('assets/b.js', { [copied]: 900 }),
		]);
		expect(waste).toEqual(['duplicated-module: src/shared.ts is in assets/a.js, assets/b.js']);
	});

	it('fail one version of a package bundled from two installs', () => {
		const { waste, advisories } = inspect([
			entry(),
			lazyAxe(),
			chunk('assets/axe-again.js', {
				[`${modulesRoot}/twice/node_modules/axe-core/axe.js`]: 659_293,
			}),
		]);
		expect(waste).toEqual([
			'duplicated-package: axe-core@4.14.0 is bundled from 2 installs; dedupe it to one',
		]);
		expect(advisories).toEqual([]);
	});

	it('fail two versions of one package, unless every copy is interaction support', () => {
		const { waste, advisories } = inspect([
			entry(),
			lazyAxe(),
			chunk('assets/axe-again.js', {
				[`${modulesRoot}/nested/node_modules/axe-core/axe.js`]: 600_000,
			}),
		]);
		expect(waste).toEqual([
			"multiple-versions: axe-core is bundled at 4.11.1, 4.14.0; align its dependents' ranges to share one",
		]);
		expect(advisories).toEqual([]);
		// Testing Library's own ranges split aria-query in the helpers, which no consumer can fix.
		const helpers = inspect([
			entry(),
			chunk('assets/helpers.js', {
				[`${modulesRoot}/node_modules/aria-query/lib/index.js`]: 9_000,
				[`${modulesRoot}/jest-dom/node_modules/aria-query/lib/index.js`]: 9_100,
			}),
		]);
		expect(helpers.waste).toEqual([]);
		expect(helpers.advisories).toEqual([
			"multiple-versions: aria-query is bundled at 5.3.0, 5.3.2; align its dependents' ranges to share one",
		]);
		// One version in the helpers and another in consumer code is the helpers' split too.
		const shared = inspect([
			entry(),
			chunk('assets/helpers.js', {
				[`${modulesRoot}/node_modules/aria-query/lib/index.js`]: 9_000,
			}),
			chunk('assets/consumer.js', {
				[`${modulesRoot}/jest-dom/node_modules/aria-query/lib/index.js`]: 9_100,
			}),
		]);
		expect(shared.waste).toEqual([]);
		expect(shared.advisories).toHaveLength(1);
	});

	it('fail the accessibility engine in an entry chunk', () => {
		const eager = chunk(
			'assets/entry.js',
			{ [`${roots.packageSource}/browser/index.js`]: 58_000, [axe()]: 659_293 },
			{ isEntry: true }
		);
		expect(inspect([eager]).waste).toEqual([
			'eager-accessibility: axe-core loads with every case, in assets/entry.js; import it only where a case checks accessibility',
		]);
	});

	it('fail the accessibility engine an entry imports statically, but not one it loads lazily', () => {
		const statically = chunk(
			'assets/entry.js',
			{ [`${roots.packageSource}/browser/index.js`]: 58_000 },
			{ isEntry: true, imports: ['assets/axe.js'] }
		);
		expect(inspect([statically, lazyAxe()]).waste).toEqual([
			'eager-accessibility: axe-core loads with every case, in assets/axe.js; import it only where a case checks accessibility',
		]);
		expect(inspect([entry(), lazyAxe()]).waste).toEqual([]);
	});

	it('fail the accessibility engine a retained preview imports, since every case loads it', () => {
		const preview = `${roots.projectRoot}/.storybook/preview.ts`;
		const chunks = [
			entry(),
			chunk('assets/preview.js', { [preview]: 150 }, { imports: ['assets/axe.js'] }),
			lazyAxe(),
		];
		expect(inspect(chunks, 1_327_581, [preview]).waste).toEqual([
			'eager-accessibility: axe-core loads with every case, in assets/axe.js; import it only where a case checks accessibility',
		]);
		// The same graph with no preview named is a story's own lazy import.
		expect(inspect(chunks).waste).toEqual([]);
	});

	it('fail the accessibility engine a plugin imports, since a plugin loads before every case', () => {
		const plugin = `${roots.projectRoot}/plugins/theme.plugin.ts`;
		const chunks = [
			entry(),
			chunk('assets/plugin.js', { [plugin]: 300 }, { imports: ['assets/axe.js'] }),
			lazyAxe(),
		];
		expect(inspect(chunks, 1_327_581, [plugin]).waste).toEqual([
			'eager-accessibility: axe-core loads with every case, in assets/axe.js; import it only where a case checks accessibility',
		]);
	});

	it('ignore an accessibility module that renders no code', () => {
		const shaken = chunk(
			'assets/entry.js',
			{ [`${roots.packageSource}/browser/index.js`]: 58_000, [axe()]: 0 },
			{ isEntry: true }
		);
		expect(inspect([shaken]).waste).toEqual([]);
	});

	it('fail a total past the distant tripwire, and only past it', () => {
		expect(TOTAL_TRIPWIRE).toBeGreaterThanOrEqual(2 * 1_327_581);
		expect(inspect([entry(), lazyAxe()], TOTAL_TRIPWIRE).waste).toEqual([]);
		expect(inspect([entry(), lazyAxe()], TOTAL_TRIPWIRE + 1).waste).toEqual([
			`total-tripwire: bench JavaScript is ${TOTAL_TRIPWIRE + 1} bytes, past ${TOTAL_TRIPWIRE}, about twice what it measures; look for a dependency imported whole or a data file the bench's own code imports`,
		]);
	});

	it('lists every rendered module with its package, chunk and category, and skips empty ones', () => {
		const { modules } = inspect([
			entry(),
			lazyAxe(),
			chunk('assets/helpers.js', {
				[`${modulesRoot}/node_modules/@testing-library/dom/dist/index.js`]: 77_162,
				[`${roots.projectRoot}/src/empty.ts`]: 0,
			}),
		]);
		expect(modules).toEqual([
			{
				id: '@lushly-dev/specimen/browser/index.js',
				chunk: 'assets/entry.js',
				category: 'shell',
				renderedBytes: 58_000,
			},
			{
				id: '@testing-library/dom@10.4.1/dist/index.js',
				chunk: 'assets/helpers.js',
				category: 'interaction',
				renderedBytes: 77_162,
				package: { name: '@testing-library/dom', version: '10.4.1' },
			},
			{
				id: 'axe-core@4.14.0/axe.js',
				chunk: 'assets/axe.js',
				category: 'accessibility',
				renderedBytes: 659_293,
				package: { name: 'axe-core', version: '4.14.0' },
			},
		]);
	});
});

describe('module identity', () => {
	it('names a module the same way on any machine', () => {
		expect(moduleIdentity('\0specimen-catalog', roots).id).toBe('virtual:specimen-catalog');
		expect(moduleIdentity(`${roots.projectRoot}/stories/a.stories.ts`, roots).id).toBe(
			'stories/a.stories.ts'
		);
		expect(moduleIdentity(`${roots.siteRoot}/index.html?html-proxy&index=0.js`, roots).id).toBe(
			'site:index.html?html-proxy&index=0.js'
		);
		expect(moduleIdentity(`${roots.packageSource}/browser/page.css?url`, roots).id).toBe(
			'@lushly-dev/specimen/browser/page.css?url'
		);
		expect(moduleIdentity(`${modulesRoot}/node_modules/left-pad/index.js`, roots)).toEqual({
			id: 'left-pad@unknown/index.js',
			package: {
				name: 'left-pad',
				version: 'unknown',
				root: `${modulesRoot}/node_modules/left-pad`,
			},
		});
		expect(moduleIdentity(`${modulesRoot}/node_modules/versionless/index.js`, roots).id).toBe(
			'versionless@unknown/index.js'
		);
		expect(moduleIdentity(`\0${roots.projectRoot}/src/a.ts?commonjs-proxy`, roots).id).toBe(
			'virtual:src/a.ts?commonjs-proxy'
		);
	});

	it('stops at a workspace root rather than name a file after its manifest', async () => {
		await mkdir(`${modulesRoot}/repo/tools`, { recursive: true });
		await writeFile(`${modulesRoot}/repo/pnpm-workspace.yaml`, 'packages: []\n');
		await writeFile(
			`${modulesRoot}/repo/package.json`,
			JSON.stringify({ name: 'the-workspace', version: '1.0.0' })
		);
		const identity = moduleIdentity(`${modulesRoot}/repo/tools/helper.js`, roots);
		expect(identity.package).toBeUndefined();
		expect(identity.id).toBe(`${modulesRoot}/repo/tools/helper.js`);
	});

	it('names a workspace package linked from outside the project by its manifest', () => {
		expect(moduleIdentity(`${modulesRoot}/workspace/fast-element/dist/index.js`, roots)).toEqual({
			id: '@lushly-dev/fast-element@2.1.0/dist/index.js',
			package: {
				name: '@lushly-dev/fast-element',
				version: '2.1.0',
				root: `${modulesRoot}/workspace/fast-element`,
			},
		});
	});
});

describe('size deltas between two builds', () => {
	const module = (id: string, renderedBytes: number, name?: string) => ({
		id,
		chunk: 'assets/x.js',
		category: 'interaction',
		renderedBytes,
		...(name && { package: { name, version: '1.0.0' } }),
	});

	it('report each module that moved, largest first, and leave unchanged ones out', () => {
		const before = {
			modules: [module('a.ts', 100), module('dep@1.0.0/x.js', 5_000, 'dep'), module('same.ts', 7)],
		};
		const after = {
			modules: [module('a.ts', 140), module('same.ts', 7), module('new@1.0.0/y.js', 9_000, 'new')],
		};
		expect(buildSizeDeltas(before, after)).toEqual([
			{
				id: 'new/y.js',
				category: 'interaction',
				package: 'new',
				versions: { after: '1.0.0' },
				before: 0,
				after: 9_000,
				delta: 9_000,
			},
			{
				id: 'dep/x.js',
				category: 'interaction',
				package: 'dep',
				versions: { before: '1.0.0' },
				before: 5_000,
				after: 0,
				delta: -5_000,
			},
			{ id: 'a.ts', category: 'interaction', before: 100, after: 140, delta: 40 },
		]);
	});

	it('match a package across an upgrade, as one row naming both versions', () => {
		const at = (version: string, renderedBytes: number) => ({
			id: `axe-core@${version}/axe.js`,
			chunk: 'assets/axe.js',
			category: 'accessibility',
			renderedBytes,
			package: { name: 'axe-core', version },
		});
		expect(
			buildSizeDeltas(
				{ modules: [at('4.14.0', 1_425_375)] },
				{ modules: [at('4.15.0', 1_470_000)] }
			)
		).toEqual([
			{
				id: 'axe-core/axe.js',
				category: 'accessibility',
				package: 'axe-core',
				versions: { before: '4.14.0', after: '4.15.0' },
				before: 1_425_375,
				after: 1_470_000,
				delta: 44_625,
			},
		]);
	});

	it('read a report from before modules were listed as empty', () => {
		expect(buildSizeDeltas({}, { modules: [module('a.ts', 10)] })).toEqual([
			{ id: 'a.ts', category: 'interaction', before: 0, after: 10, delta: 10 },
		]);
	});
});
