#!/usr/bin/env node
/**
 * FAST-AF packed-artifact consumers (platform migration Phase 3).
 *
 * Packs the built @lushly-dev/fast-element and @lushly-dev/violet-elements workspace packages,
 * then installs them in temporary projects outside the workspace's dependency resolution:
 * runtime only (every export path type-imported under NodeNext and runtime-imported under the
 * production and development conditions), components with the runtime (bundler-mode types,
 * metadata and token assets), components with the runtime peer missing, and a browser render and
 * registration smoke. No other platform family is installed. Local tarballs only: this is not
 * registry installation evidence.
 *
 * Usage: pnpm -F "@lushly-dev/violet-elements..." build
 *        node tests/consumers/fast-af/verify-artifacts.mjs [--browser chromium|firefox|webkit|none]
 *                                                          [--output <directory>]
 * The browser smoke uses the workspace's Vite and Playwright from violet-elements' dev
 * dependencies to serve and drive the consumer; the consumer resolves only its own installation.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argument = (name, fallback) => {
	const index = process.argv.indexOf(name);
	return index > 0 ? process.argv[index + 1] : fallback;
};
const browserName = argument('--browser', 'chromium');
assert(
	['chromium', 'firefox', 'webkit', 'none'].includes(browserName),
	`bad --browser ${browserName}`
);
const consumers = await realpath(await mkdtemp(join(tmpdir(), 'afd-fast-af-consumers-')));
const output = resolve(argument('--output', consumers));
const artifacts = join(consumers, 'artifacts');
await mkdir(artifacts, { recursive: true });
await mkdir(output, { recursive: true });
const tsc = join(repository, 'node_modules/typescript/bin/tsc');
const runtimeSource = 'foundations/fast-af/packages/element/packages/fast-element';
const componentSource = 'foundations/fast-af/packages/violet-elements';
const runtimeName = '@lushly-dev/fast-element';
const componentName = '@lushly-dev/violet-elements';
// AFD, Specimen and Violet's token engine/runtime/tooling must never enter either closure.
const forbidden = /^@lushly-dev\/(?:afd-|local-db|specimen|violet-(?:core|runtime|server|cli))/;
const checks = [];
const passed = (name) => {
	checks.push(name);
	console.log(`ok - ${name}`);
};

const packs = {};
for (const path of [runtimeSource, componentSource]) {
	const manifest = JSON.parse(await readFile(join(repository, path, 'package.json'), 'utf8'));
	assert(existsSync(join(repository, path, 'dist')), `${path} is not built`);
	execFileSync('pnpm', ['pack', '--pack-destination', artifacts], {
		cwd: join(repository, path),
		stdio: 'pipe',
	});
	packs[manifest.name] = join(
		artifacts,
		`${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
	);
	assert(existsSync(packs[manifest.name]), `missing tarball for ${manifest.name}`);
}
const packedManifest = (name) =>
	JSON.parse(
		execFileSync('tar', ['-xzOf', packs[name], 'package/package.json'], { encoding: 'utf8' })
	);
const packedFiles = (name) =>
	execFileSync('tar', ['-tzf', packs[name]], { encoding: 'utf8' }).split('\n').filter(Boolean);
const edges = (manifest) =>
	Object.keys({
		...manifest.dependencies,
		...manifest.peerDependencies,
		...manifest.optionalDependencies,
	});

// Packed manifests: identities, portable ranges, licenses and no cross-family edges.
const runtime = packedManifest(runtimeName);
const component = packedManifest(componentName);
assert.equal(runtime.version, '3.0.1');
assert.equal(component.version, '0.1.0');
assert.equal(component.private, true, 'violet-elements keeps its upstream private flag');
assert.equal(Object.keys(runtime.exports).length, 38);
assert.deepEqual(Object.keys(component.exports), [
	'.',
	'./dist/*',
	'./custom-elements.json',
	'./tokens/*',
	'./package.json',
]);
assert.deepEqual(edges(runtime), ['@webcomponents/scoped-custom-element-registry']);
assert.deepEqual(component.peerDependencies, { [runtimeName]: '3.0.1' });
assert.deepEqual(Object.keys(component.dependencies).sort(), ['@tanstack/virtual-core', 'tslib']);
for (const manifest of [runtime, component]) {
	assert(!JSON.stringify(manifest).includes('workspace:'), `${manifest.name} leaks workspace:`);
	assert(!edges(manifest).some((name) => forbidden.test(name)), `${manifest.name} cross-family`);
	assert(
		!Object.keys(manifest.scripts ?? {}).some((key) => /^(pre|post)?install$|^prepare$/.test(key)),
		`${manifest.name} has an install hook`
	);
	assert(packedFiles(manifest.name).includes('package/LICENSE'), `${manifest.name} LICENSE`);
}
const license = (name) =>
	execFileSync('tar', ['-xzOf', packs[name], 'package/LICENSE'], { encoding: 'utf8' });
assert.match(license(runtimeName), /Copyright \(c\) Microsoft Corporation/);
assert.match(license(componentName), /Copyright \(c\) 2026 Lushly Dev/);
passed('packed manifests: identities, 38 runtime exports, portable ranges, licenses, no hooks');

async function install(name, dependencies, { expected = true } = {}) {
	const root = join(consumers, name);
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, 'package.json'),
		`${JSON.stringify({ name, private: true, type: 'module', dependencies }, null, 2)}\n`
	);
	const result = spawnSync(
		'pnpm',
		[
			'install',
			'--ignore-scripts',
			'--prefer-offline',
			'--strict-peer-dependencies',
			'--config.auto-install-peers=false',
		],
		{ cwd: root, encoding: 'utf8' }
	);
	const log = `${result.stdout}${result.stderr}`;
	await writeFile(join(root, 'install.log'), log);
	assert.equal(result.status === 0, expected, `${name} install outcome:\n${log}`);
	return { root, log };
}
const installed = (root) =>
	readdirSync(join(root, 'node_modules/.pnpm')).filter((entry) => entry.startsWith('@lushly-dev+'));
async function typecheck(cwd, resolution) {
	const compilerOptions = {
		noEmit: true,
		strict: true,
		skipLibCheck: false,
		module: resolution === 'bundler' ? 'ESNext' : 'NodeNext',
		moduleResolution: resolution,
		target: 'ES2022',
		lib: ['ES2022', 'DOM', 'DOM.Iterable'],
		types: [],
	};
	await writeFile(
		join(cwd, 'tsconfig.json'),
		`${JSON.stringify({ compilerOptions, include: ['consumer.ts'] }, null, 2)}\n`
	);
	execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd, stdio: 'inherit' });
}

// Runtime only: every export path for types and both runtime conditions.
const runtimeOnly = await install('runtime-only', { [runtimeName]: `file:${packs[runtimeName]}` });
const runtimeClosure = installed(runtimeOnly.root);
assert.equal(runtimeClosure.length, 1, `only the runtime is installed: ${runtimeClosure}`);
assert(runtimeClosure[0].startsWith('@lushly-dev+fast-element@'), runtimeClosure[0]);
const specifiers = Object.keys(runtime.exports)
	.filter((path) => path !== './package.json')
	.map((path) => (path === '.' ? runtimeName : `${runtimeName}/${path.slice(2)}`));
await writeFile(
	join(runtimeOnly.root, 'consumer.ts'),
	`${specifiers.map((specifier, index) => `type Export${index} = typeof import(${JSON.stringify(specifier)});`).join('\n')}\nexport type All = [${specifiers.map((_, index) => `Export${index}`).join(', ')}];\n`
);
await typecheck(runtimeOnly.root, 'NodeNext');
passed(`runtime-only: ${specifiers.length} export paths type-import under strict NodeNext`);
const smoke = await readFile(
	join(repository, runtimeSource, 'scripts/smoke-package-exports.js'),
	'utf8'
);
const retargeted = smoke.replace(
	'const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");',
	`const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "node_modules", "@lushly-dev", "fast-element");`
);
assert.notEqual(retargeted, smoke, 'cannot retarget the export smoke to the installed package');
await writeFile(join(runtimeOnly.root, 'runtime-consumer.mjs'), retargeted);
for (const condition of ['production', 'development']) {
	const result = execFileSync(
		process.execPath,
		[`--conditions=${condition}`, 'runtime-consumer.mjs'],
		{ cwd: runtimeOnly.root, encoding: 'utf8' }
	);
	assert.match(result, /Imported 38 package exports successfully/);
	passed(`runtime-only: 38 exports runtime-import under the ${condition} condition (Node shims)`);
}

// Components without the required runtime peer fail at installation.
const missing = await install(
	'components-missing-runtime',
	{ [componentName]: `file:${packs[componentName]}` },
	{ expected: false }
);
assert.match(missing.log, /fast-element/);
passed('components without @lushly-dev/fast-element: strict peer installation rejects');

// Components with the runtime: bundler types, assets, closure.
const components = await install('components', {
	[runtimeName]: `file:${packs[runtimeName]}`,
	[componentName]: `file:${packs[componentName]}`,
});
assert.equal(installed(components.root).length, 2, 'only the FAST-AF family is installed');
assert(!installed(components.root).some((entry) => forbidden.test(entry.replace('+', '/'))));
await writeFile(
	join(components.root, 'consumer.ts'),
	[
		`import * as components from ${JSON.stringify(componentName)};`,
		`import * as runtime from ${JSON.stringify(runtimeName)};`,
		'export const elements: typeof components = components;',
		'export const fast: typeof runtime = runtime;',
		'',
	].join('\n')
);
await typecheck(components.root, 'bundler');
passed('components: root and runtime type-check in strict bundler mode');
const resolveFrom = createRequire(join(components.root, 'package.json'));
const assets = {};
for (const asset of [
	'custom-elements.json',
	'tokens/master-semantic.tokens.jsonc',
	'tokens/theme-presets.jsonc',
	'tokens/raw-palette.proposal.jsonc',
	'package.json',
]) {
	const bytes = await readFile(resolveFrom.resolve(`${componentName}/${asset}`));
	assert(bytes.length > 0, asset);
	assets[asset] = createHash('sha256').update(bytes).digest('hex');
}
const cem = JSON.parse(
	await readFile(resolveFrom.resolve(`${componentName}/custom-elements.json`))
);
assert.equal(cem.schemaVersion, '1.0.0');
const declared = cem.modules.flatMap((module) =>
	(module.declarations ?? []).filter((item) => item.customElement && item.tagName)
);
assert(declared.length > 0);
passed(`components: manifest, package.json and 3 token assets resolve (${declared.length} tags)`);

// Vite treats port 0 as its default 5173, which other local suites use; reserve a free port.
const freePort = () =>
	new Promise((done, reject) => {
		const probe = createNetServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => done(port));
		});
	});
let browser = { status: 'not-run' };
if (browserName !== 'none') {
	const tools = createRequire(join(repository, componentSource, 'package.json'));
	const { createServer } = await import(pathToFileURL(tools.resolve('vite')).href);
	const playwright = (await import(pathToFileURL(tools.resolve('playwright')).href)).default;
	await writeFile(
		join(components.root, 'index.html'),
		'<!doctype html><html><body><script type="module" src="/browser.ts"></script></body></html>\n'
	);
	await writeFile(
		join(components.root, 'browser.ts'),
		[
			`import * as components from ${JSON.stringify(componentName)};`,
			`import cem from ${JSON.stringify(`${componentName}/custom-elements.json`)};`,
			'(globalThis as Record<string, unknown>).__consumer = { components, cem };',
			'',
		].join('\n')
	);
	const server = await createServer({
		root: components.root,
		configFile: false,
		logLevel: 'warn',
		server: { host: '127.0.0.1', port: await freePort(), strictPort: true },
	});
	await server.listen();
	const launched = await playwright[browserName].launch({ headless: true });
	try {
		const page = await launched.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(server.resolvedUrls.local[0]);
		await page.waitForFunction(() => '__consumer' in globalThis, null, { timeout: 30000 });
		const result = await page.evaluate(async () => {
			const { components, cem } = globalThis.__consumer;
			const items = cem.modules.flatMap((module) =>
				(module.declarations ?? []).filter((item) => item.customElement && item.tagName)
			);
			const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
			const button = document.createElement('violet-button');
			button.textContent = 'Artifact consumer';
			const field = document.createElement('violet-text-field');
			field.setAttribute('value', 'consumer-value');
			const control = document.createElement('violet-segmented-control');
			control.innerHTML =
				'<violet-segment value="a" checked>A</violet-segment><violet-segment value="b">B</violet-segment>';
			document.body.append(button, field, control);
			await frame();
			await frame();
			control.querySelectorAll('violet-segment')[1].shadowRoot.querySelector('.button').click();
			await frame();
			const inner = button.shadowRoot?.querySelector('button');
			const slot = button.shadowRoot?.querySelector('slot:not([name])');
			return {
				exports: Object.keys(components).length,
				tags: items.length,
				unregistered: items.map((item) => item.tagName).filter((tag) => !customElements.get(tag)),
				unexported: items.map((item) => item.name).filter((name) => !(name in components)),
				buttonRendered: (inner?.getBoundingClientRect().width ?? 0) > 0,
				buttonSlotted: (slot?.assignedNodes() ?? []).some((node) =>
					node.textContent.includes('Artifact consumer')
				),
				field: field.value,
				selected: control.value,
			};
		});
		assert.deepEqual(errors, []);
		assert.deepEqual(result.unregistered, []);
		assert.deepEqual(result.unexported, []);
		assert(result.buttonRendered && result.buttonSlotted, 'button renders slotted text');
		assert.equal(result.field, 'consumer-value');
		assert.equal(result.selected, 'b');
		browser = { status: 'passed', name: browserName, version: launched.version(), ...result };
		passed(
			`components (${browserName} ${launched.version()}): ${result.tags} tags registered and exported, ${result.exports} root exports, render/value/selection`
		);
	} finally {
		await launched.close();
		await server.close();
	}
}

const receipt = {
	repository: execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: repository,
		encoding: 'utf8',
	}).trim(),
	node: process.version,
	artifacts: Object.fromEntries(
		await Promise.all(
			Object.entries(packs).map(async ([name, path]) => [
				name,
				createHash('sha256')
					.update(await readFile(path))
					.digest('hex'),
			])
		)
	),
	assets,
	browser,
	checks,
};
await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`${checks.length} checks passed; receipt ${join(output, 'receipt.json')}`);
