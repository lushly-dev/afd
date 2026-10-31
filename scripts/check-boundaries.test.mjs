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
		exclude: ['packages/examples'],
		quarantine: [],
		units: [],
	};
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
