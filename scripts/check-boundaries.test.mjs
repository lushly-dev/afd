import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkBoundaries } from './check-boundaries.mjs';

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'afd-boundary-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const config = {
		schemaVersion: 1,
		families: ['afd', 'violet', 'specimen', 'fast-af'],
		discoveryRoots: ['foundations', 'integrations', 'endpoints', 'packages'],
		exclude: [],
		quarantine: [],
		units: [],
	};
	for (const dir of config.discoveryRoots) mkdirSync(join(root, dir), { recursive: true });
	function write(path, value) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
	}
	function npm(path, name, fields = {}, source = '') {
		write(`${path}/package.json`, {
			name,
			version: '1.0.0',
			exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
			...fields,
		});
		write(`${path}/src/index.ts`, source);
	}
	return { root, config, write, npm, check: () => checkBoundaries(root, config) };
}

test("dependencies list each unit's direct repository-owned edges", (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet');
	f.npm('endpoints/app', '@x/app', {
		dependencies: { '@x/violet': '^1', 'third-party': '^1' },
		devDependencies: { '@x/tool': '^1' },
	});
	f.npm('endpoints/tool', '@x/tool');
	const result = f.check();
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.dependencies, {
		'@x/app': ['@x/violet'],
		'@x/tool': [],
		'@x/violet': [],
	});
});

test('all foundation families reject runtime, required peer, optional install and transitive coupling', (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet');
	f.npm('foundations/afd/base', '@x/afd', { dependencies: { '@x/bridge': '*' } });
	f.npm('foundations/afd/bridge', '@x/bridge', { peerDependencies: { '@x/violet': '*' } });
	f.npm('foundations/specimen/base', '@x/specimen', { optionalDependencies: { '@x/violet': '*' } });
	f.npm('foundations/fast-af/base', '@x/fast', { dependencies: { '@x/violet': '*' } });
	const errors = f.check().errors.join('\n');
	assert.match(errors, /transitive foundation coupling/);
	for (const name of ['bridge', 'specimen', 'fast'])
		assert.match(errors, new RegExp(`foundation @x/${name} requires foundation @x/violet`));
});

test('integration packages and endpoint DAGs compose native foundations without an AFD requirement', (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet');
	f.npm('foundations/specimen/base', '@x/specimen');
	f.npm(
		'integrations/token-observer',
		'@x/integration',
		{ dependencies: { '@x/violet': '^1', '@x/specimen': '^1' } },
		"export type { Token } from '@x/violet';"
	);
	f.npm('endpoints/library-tool', '@x/tool', { dependencies: { '@x/integration': '^1' } });
	f.npm('endpoints/app', '@x/app', { dependencies: { '@x/tool': '^1' } });
	assert.deepEqual(f.check().errors, []);
	f.npm('endpoints/library-tool', '@x/tool', { dependencies: { '@x/app': '^1' } });
	assert.match(f.check().errors.join('\n'), /Endpoint dependency cycle/);
});

test('type-only coupling, undeclared imports, private subpaths and escaped exports fail', (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet');
	f.npm(
		'foundations/afd/base',
		'@x/afd',
		{ devDependencies: { '@x/violet': '*' } },
		"export type Shape = import('@x/violet/private').Shape;"
	);
	f.npm('foundations/specimen/base', '@x/specimen', {
		exports: { '.': '../violet/dist/index.d.ts' },
	});
	const errors = f.check().errors.join('\n');
	assert.match(errors, /undeclared package import/);
	assert.match(errors, /non-public package import/);
	assert.match(errors, /import\/type reference: foundation/);
	assert.match(errors, /export target escapes package/);
});

test('a bundler query on an exported subpath is a public import; on a private one it is not', (t) => {
	const f = fixture(t);
	f.npm('foundations/afd/theme', '@x/theme', { exports: { './theme.css': './dist/theme.css' } });
	f.npm(
		'endpoints/app',
		'@x/app',
		{ dependencies: { '@x/theme': '*' } },
		"import css from '@x/theme/theme.css?inline';"
	);
	assert.deepEqual(f.check().errors, []);
	f.npm(
		'endpoints/app',
		'@x/app',
		{ dependencies: { '@x/theme': '*' } },
		"import css from '@x/theme/dist/theme.css?inline';"
	);
	assert.match(
		f.check().errors.join('\n'),
		/non-public package import @x\/theme\/dist\/theme\.css\?inline/
	);
});

test('relative and tsconfig alias paths cannot bypass declared public contracts', (t) => {
	const f = fixture(t);
	f.npm('foundations/afd/base', '@x/base');
	f.npm(
		'foundations/afd/other',
		'@x/other',
		{ dependencies: { '@x/base': '*' } },
		"import '../../base/src/index.js';\nimport 'hidden';"
	);
	f.write('foundations/afd/other/tsconfig.json', {
		compilerOptions: { baseUrl: '.', paths: { hidden: ['../base/src/index.ts'] } },
	});
	const errors = f.check().errors.join('\n');
	assert.match(errors, /cross-package source\/alias bypass .*base\/src/);
	assert.match(errors, /cross-package source\/alias bypass hidden/);
});

test('installation hooks and required configuration cannot couple foundations', (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet');
	f.npm('endpoints/tool', '@x/tool');
	f.npm('foundations/afd/base', '@x/base', {
		scripts: { postinstall: 'node ../../../endpoints/tool/setup.js' },
		config: { engine: '@x/violet' },
	});
	const errors = f.check().errors.join('\n');
	assert.match(errors, /postinstall hook/);
	assert.match(errors, /config: foundation @x\/base requires/);
});

test('tests, dev dependencies and excluded examples do not become runtime edges', (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet');
	f.npm('foundations/afd/base', '@x/base', {
		devDependencies: { '@x/violet': '*' },
		peerDependencies: { '@x/violet': '*' },
		peerDependenciesMeta: { '@x/violet': { optional: true } },
	});
	f.write('foundations/afd/base/src/unit.test.ts', "import '@x/violet/private';");
	f.write('foundations/afd/base/src/unit.stories.ts', "import '@x/violet/private';");
	f.npm('packages/examples/demo', '@x/example', { dependencies: { '@x/base': '*' } });
	assert.deepEqual(f.check().errors, []);
	f.npm('packages/unknown', '@x/unknown');
	assert.match(f.check().errors.join('\n'), /Unclassified distribution/);
	f.config.quarantine = [{ path: 'packages/unknown', reason: 'Source review pending' }];
	assert.deepEqual(f.check().errors, []);
});

test('Python dependencies and static type imports follow the same family rules', (t) => {
	const f = fixture(t);
	f.write(
		'foundations/violet/python/pyproject.toml',
		'[project]\nname = "violet"\nversion = "1.0"\n'
	);
	f.write(
		'foundations/specimen/python/pyproject.toml',
		'[project]\nname = "specimen"\nversion = "1.0"\n'
	);
	f.write(
		'foundations/specimen/python/src/specimen/__init__.py',
		'if TYPE_CHECKING:\n    from violet import Token\n'
	);
	assert.match(f.check().errors.join('\n'), /undeclared Python import violet/);
	f.write(
		'foundations/specimen/python/pyproject.toml',
		'[project]\nname = "specimen"\nversion = "1.0"\ndependencies = ["violet>=1"]\n'
	);
	assert.match(f.check().errors.join('\n'), /foundation specimen requires foundation violet/);
});

test('coverage enumerates every export condition and native surface without execution claims', (t) => {
	const f = fixture(t);
	f.npm('foundations/violet/base', '@x/violet', {
		exports: {
			'.': {
				types: './index.d.ts',
				node: { import: './node.js', require: './node.cjs' },
				default: './web.js',
			},
			'./css': './theme.css',
		},
	});
	f.write(
		'foundations/violet/python/pyproject.toml',
		'[project]\nname = "violet"\nversion = "1.0"\n'
	);
	f.config.units.push({
		manifest: 'foundations/violet/python/pyproject.toml',
		family: 'violet',
		layer: 'foundation',
		publicSurfaces: ['wheel', 'violet'],
	});
	const result = f.check();
	assert.deepEqual(result.errors, []);
	const npm = result.coverage.find((item) => item.name === '@x/violet');
	assert.equal(npm.surfaces.length, 5);
	assert.deepEqual(npm.surfaces.find((item) => item.target === './node.cjs').conditions, [
		'node',
		'require',
	]);
	assert.equal(result.coverage.find((item) => item.name === 'violet').surfaces.length, 2);
	assert.match(npm.evidence, /pending/);
});

test('native families classify without AFD envelopes; Cargo build paths cannot hide foreign ownership', (t) => {
	const f = fixture(t);
	f.write(
		'foundations/violet/rust/Cargo.toml',
		'[package]\nname = "violet"\nversion = "1.0.0"\n[features]\ndefault = []\n'
	);
	f.write('foundations/fast-af/cpp/CMakeLists.txt', 'project(fast_af VERSION 1.0.0)\n');
	assert.deepEqual(f.check().errors, []);
	f.write(
		'foundations/specimen/rust/Cargo.toml',
		'[package]\nname = "specimen"\nversion = "1.0.0"\n[build-dependencies]\nalias = { package = "violet", path = "../../violet/rust", version = "1" }\n'
	);
	assert.match(f.check().errors.join('\n'), /foundation specimen requires foundation violet/);
});

test('build-time edges allow foundation-to-foundation, refuse foundation-to-integration/endpoint, report others, and invalidate stale exemptions', (t) => {
	const f = fixture(t);
	f.npm('foundations/specimen/base', '@x/specimen');
	f.npm('integrations/specimen-fast', '@x/specimen-fast', {
		dependencies: { '@x/specimen': '^1' },
	});
	f.npm('endpoints/tool', '@x/tool');
	// Foundation dev-depending on another family's foundation is allowed and reported.
	f.npm('foundations/fast-af/elements', '@x/elements', {
		devDependencies: { '@x/specimen': '^1' },
	});
	f.write('foundations/fast-af/elements/scripts/build.mjs', "import '@x/specimen';\n");
	const ok = f.check();
	assert.deepEqual(ok.errors, []);
	assert.deepEqual(ok.buildTimeDependencies['@x/elements'], ['@x/specimen']);

	// Foundation build-time edge to an integration or endpoint is refused.
	f.write('foundations/fast-af/elements/specimen/plugins.ts', "import '@x/specimen-fast';\n");
	f.npm('foundations/fast-af/elements', '@x/elements', {
		devDependencies: { '@x/specimen': '^1', '@x/tool': '^1' },
	});
	const bad = f.check().errors.join('\n');
	assert.match(
		bad,
		/build-time edge from foundation @x\/elements to integration @x\/specimen-fast/
	);
	assert.match(bad, /build-time edge from foundation @x\/elements to endpoint @x\/tool/);

	// An exemption allows the named edge and fails loudly once the edge disappears.
	f.config.buildTimeExemptions = [
		{ from: '@x/elements', to: '@x/specimen-fast', reason: 'Tracked', issue: '#1' },
		{ from: '@x/elements', to: '@x/tool', reason: 'Tracked', issue: '#2' },
	];
	assert.deepEqual(f.check().errors, []);
	f.npm('foundations/fast-af/elements', '@x/elements', {
		devDependencies: { '@x/specimen': '^1' },
	});
	assert.match(f.check().errors.join('\n'), /Stale buildTimeExemption @x\/elements -> @x\/tool/);
});

test('endpoint family sub-layers enforce intra-family direction and refuse unclassified units', (t) => {
	const f = fixture(t);
	f.config.familyRules = {
		umbel: {
			allowed: { base: ['base'], host: ['base'], plugin: ['base', 'host'] },
			assign: [
				{ match: 'umbel-sdk', sublayer: 'base' },
				{ match: 'umbel', sublayer: 'host' },
				{ prefix: 'umbel-plugin-', sublayer: 'plugin' },
			],
		},
	};
	f.write('endpoints/umbel/sdk/Cargo.toml', '[package]\nname = "umbel-sdk"\nversion = "1.0.0"\n');
	f.write(
		'endpoints/umbel/Cargo.toml',
		'[package]\nname = "umbel"\nversion = "1.0.0"\n[dependencies]\numbel-sdk = { path = "sdk" }\n'
	);
	f.write(
		'endpoints/umbel/plugins/a/Cargo.toml',
		'[package]\nname = "umbel-plugin-a"\nversion = "1.0.0"\n[dependencies]\numbel = { path = "../.." }\numbel-sdk = { path = "../../sdk" }\n'
	);
	assert.deepEqual(f.check().errors, []);

	// Host depending on a plugin violates the sub-layer rule.
	f.write(
		'endpoints/umbel/Cargo.toml',
		'[package]\nname = "umbel"\nversion = "1.0.0"\n[dependencies]\numbel-plugin-a = { path = "plugins/a" }\n'
	);
	assert.match(
		f.check().errors.join('\n'),
		/umbel sublayer "host" \(umbel\) may not depend on "plugin" \(umbel-plugin-a\)/
	);

	// Host dev-depending on a forbidden plugin violates build-time sub-layer rules too.
	f.write(
		'endpoints/umbel/Cargo.toml',
		'[package]\nname = "umbel"\nversion = "1.0.0"\n[dev-dependencies]\numbel-plugin-a = { path = "plugins/a" }\n'
	);
	assert.match(
		f.check().errors.join('\n'),
		/build-time edge violates umbel sublayer "host" \(umbel\) -> "plugin" \(umbel-plugin-a\)/
	);

	// An unclassified crate inside a family with familyRules fails.
	f.write(
		'endpoints/umbel/mystery/Cargo.toml',
		'[package]\nname = "umbel-mystery"\nversion = "1.0.0"\n'
	);
	assert.match(
		f.check().errors.join('\n'),
		/Unclassified sublayer for umbel-mystery in family umbel/
	);
});

test('examples are checked with their own rule and stale discoveryRoots fail', (t) => {
	const f = fixture(t);
	f.npm('foundations/afd/core', '@x/core');
	f.npm('endpoints/umbel', 'umbel');
	f.npm('packages/examples/todo', '@x/todo', {
		dependencies: { '@x/core': '^1' },
	});
	assert.deepEqual(f.check().errors, []);

	// Example depending on an endpoint (runtime or build-time script) fails.
	f.npm('packages/examples/todo', '@x/todo', {
		dependencies: { '@x/core': '^1' },
		scripts: { 'test:umbel': 'cd ../../../endpoints/umbel && cargo test' },
	});
	assert.match(
		f.check().errors.join('\n'),
		/build-time edge from example @x\/todo to endpoint umbel/
	);

	// Non-example depending on an example (runtime or build-time) fails unless runtime-exempted.
	f.npm('endpoints/umbel', 'umbel', {
		dependencies: { '@x/todo': '^1' },
		devDependencies: { '@x/todo': '^1' },
	});
	const toExample = f.check().errors.join('\n');
	assert.match(toExample, /endpoint umbel requires example @x\/todo/);
	assert.match(toExample, /build-time edge from endpoint umbel to example @x\/todo/);
	f.config.runtimeExemptions = [
		{ from: 'umbel', to: '@x/todo', reason: 'Conformance', issue: '#1' },
	];
	f.config.buildTimeExemptions = [
		{ from: '@x/todo', to: 'umbel', reason: 'Conformance', issue: '#1' },
		{ from: 'umbel', to: '@x/todo', reason: 'Conformance', issue: '#1' },
	];
	assert.deepEqual(f.check().errors, []);
	f.npm('endpoints/umbel', 'umbel');
	assert.match(f.check().errors.join('\n'), /Stale runtimeExemption umbel -> @x\/todo/);

	// Python test imports outside src/ are checked as build-time edges.
	f.write('foundations/afd-py/pyproject.toml', '[project]\nname = "afd"\nversion = "0.1.0"\n');
	f.write('foundations/afd-py/tests/test_bad.py', 'import botcore\n');
	f.write('endpoints/botcore/pyproject.toml', '[project]\nname = "botcore"\nversion = "0.1.0"\n');
	f.config.units.push(
		{
			manifest: 'foundations/afd-py/pyproject.toml',
			family: 'afd',
			layer: 'foundation',
			pythonModules: ['afd'],
		},
		{
			manifest: 'endpoints/botcore/pyproject.toml',
			family: 'botcore',
			layer: 'endpoint',
			pythonModules: ['botcore'],
		}
	);
	assert.match(
		f.check().errors.join('\n'),
		/build-time Python import: build-time edge from foundation afd to endpoint botcore/
	);

	// Stale discoveryRoot fails.
	f.config.discoveryRoots.push('nonexistent-tools');
	assert.match(f.check().errors.join('\n'), /Stale discoveryRoot "nonexistent-tools"/);
});

function laneFixture(t) {
	const f = fixture(t);
	f.config.lanes = [
		{
			name: 'hosted',
			state: 'frozen',
			reason: 'test',
			packages: ['@x/host'],
			paths: [
				'endpoints/app/host/',
				'endpoints/app/web/test/hosted/',
				'endpoints/app/web/hosted.json',
			],
		},
	];
	f.npm('endpoints/app/host', '@x/host', {
		exports: { '.': './dist/index.js', './testing': './dist/testing.js' },
	});
	f.npm('endpoints/app/web', '@x/web', { devDependencies: { '@x/host': '*' } });
	f.write('endpoints/app/web/test/hosted/a.test.ts', "import { start } from '@x/host/testing';\n");
	f.write('endpoints/app/web/test/hosted/budget.ts', 'export const b = 1;\n');
	f.write('endpoints/app/web/hosted.json', '{}');
	return f;
}

test('a lane: its own paths may import it, and a package holding them may list it as a devDependency', (t) => {
	const f = laneFixture(t);
	assert.deepEqual(f.check().errors, []);
});

test('a lane: code outside its paths may not import its packages or reach into its paths, tests included', (t) => {
	const f = laneFixture(t);
	f.write('endpoints/app/web/test/unit/a.test.ts', "import { start } from '@x/host/testing';\n");
	f.write('endpoints/app/web/test/unit/b.test.ts', "import { b } from '../hosted/budget';\n");
	f.write('endpoints/app/web/src/deep/c.ts', "export type { H } from '@x/host';\n");
	const errors = f.check().errors.join('\n');
	assert.match(
		errors,
		/web\/test\/unit\/a\.test\.ts: imports @x\/host\/testing, of the lane hosted/
	);
	assert.match(
		errors,
		/web\/test\/unit\/b\.test\.ts: imports \.\.\/hosted\/budget, a path of the lane hosted/
	);
	assert.match(errors, /web\/src\/deep\/c\.ts: imports @x\/host, of the lane hosted/);
});

test("a lane: no manifest outside it lists its packages, but a holder's devDependency", (t) => {
	const f = laneFixture(t);
	f.npm('endpoints/app/chrome', '@x/chrome', { devDependencies: { '@x/host': '*' } });
	f.npm('endpoints/app/kernel', '@x/kernel', { dependencies: { '@x/host': '*' } });
	const errors = f.check().errors.join('\n');
	assert.match(errors, /chrome\/package\.json: devDependencies lists @x\/host, of the lane hosted/);
	assert.match(errors, /kernel\/package\.json: dependencies lists @x\/host, of the lane hosted/);
	assert.doesNotMatch(errors, /web\/package\.json/);
});

test('a lane: an empty path, a package that is no distribution or sits outside it, and a malformed lane fail', (t) => {
	const f = laneFixture(t);
	f.config.lanes[0].paths.push('endpoints/app/gone/');
	f.config.lanes[0].packages.push('@x/missing', '@x/web');
	f.config.lanes.push({ name: 'empty', packages: [], paths: [] });
	const errors = f.check().errors.join('\n');
	assert.match(errors, /lane hosted: its path endpoints\/app\/gone\/ holds no file/);
	assert.match(errors, /lane hosted: @x\/missing is not a classified npm distribution/);
	assert.match(
		errors,
		/lane hosted: @x\/web \(endpoints\/app\/web\/package\.json\) is outside the lane's paths/
	);
	assert.match(errors, /lane empty: needs a name, at least one package and at least one path/);
});

test('a lane: every relative import that leaves it, followed through what it reaches, is among its inputs', (t) => {
	const f = laneFixture(t);
	f.write('endpoints/app/web/test/hosted/c.test.ts', "import { h } from '../browser/harness';\n");
	f.write(
		'endpoints/app/web/test/browser/harness.ts',
		"import { r } from '../mounted/relay';\nexport const h = 1;\n"
	);
	f.write('endpoints/app/web/test/mounted/relay.ts', 'export const r = 1;\n');
	const errors = f.check().errors.join('\n');
	assert.match(
		errors,
		/web\/test\/hosted\/c\.test\.ts: imports \.\.\/browser\/harness \(endpoints\/app\/web\/test\/browser\/harness\.ts\), outside the lane hosted and not among its inputs/
	);
	assert.match(
		errors,
		/web\/test\/browser\/harness\.ts: imports \.\.\/mounted\/relay .* not among its inputs/
	);
	f.write('endpoints/app/web/test/hosted/d.test.ts', "import page from '../../index.html?raw';\n");
	f.write('endpoints/app/web/index.html', '<!doctype html>');
	assert.match(
		f.check().errors.join('\n'),
		/web\/test\/hosted\/d\.test\.ts: imports \.\.\/\.\.\/index\.html\?raw .* not among its inputs/
	);
	f.config.lanes[0].inputs = [
		'endpoints/app/web/test/browser/harness.ts',
		'endpoints/app/web/test/mounted/',
		'endpoints/app/web/index.html',
	];
	assert.deepEqual(f.check().errors, []);
	f.config.lanes[0].inputs.push('endpoints/app/web/gone.json');
	assert.match(
		f.check().errors.join('\n'),
		/lane hosted: its input endpoints\/app\/web\/gone\.json holds no file/
	);
});
