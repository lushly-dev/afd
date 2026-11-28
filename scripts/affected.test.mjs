import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { changedImporters, parseLockfile } from './affected/lockfile.mjs';
import { gitPath, OWN_TESTS, readLanes, resolveScope } from './affected/scope.mjs';
import { matchesFilters, readSuiteTrigger, readTrigger, SUITES } from './affected/suites.mjs';
import { readWorkspace, withDependencies, withDependents } from './affected/workspace.mjs';
import {
	checkEnvironment,
	gate,
	laneGate,
	parseArgs,
	plannedTools,
	planSuites,
	pnpmArgs,
	preflightRustVerify,
	stepExecution,
	suiteRemoteOnly,
	workflowTrigger,
} from './affected.mjs';
import { execTool } from './release/exec-tool.mjs';
import { releaseTestFiles, selectToolingTests, testFiles } from './run-tooling-tests.mjs';

const lockfile = ({ zod = '4.6.6', settings = 'autoInstallPeers: true', root = '2.5.14' } = {}) =>
	`lockfileVersion: '9.0'

settings:
  ${settings}

importers:

  .:
    devDependencies:
      '@biomejs/biome':
        specifier: ^2.5.14
        version: ${root}

  packages/core:
    dependencies:
      zod:
        specifier: ^4.6.6
        version: ${zod}

  packages/server:
    dependencies:
      '@lushly-dev/afd-core':
        specifier: workspace:*
        version: link:../core
      string-width-cjs:
        specifier: npm:string-width@4.2.3
        version: string-width@4.2.3

packages:

  '@biomejs/biome@${root}':
    resolution: {integrity: sha512-root}

  string-width@4.2.3:
    resolution: {integrity: sha512-width}

  zod@${zod}:
    resolution: {integrity: sha512-${zod}}

snapshots:

  '@biomejs/biome@${root}': {}

  string-width@4.2.3:
    dependencies:
      zod: ${zod}

  zod@${zod}: {}
`;

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'afd-affected-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (file, value) => {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
	};
	write(
		'pnpm-workspace.yaml',
		'packages:\n  - "packages/*"\n  - "foundations/*/packages/*"\n  # comment\n'
	);
	write('package.json', { name: 'root', private: true });
	write('packages/core/package.json', { name: '@x/core' });
	write('packages/server/package.json', {
		name: '@x/server',
		dependencies: { '@x/core': 'workspace:*', zod: '^4' },
	});
	write('packages/cli/package.json', { name: '@x/cli', devDependencies: { '@x/server': '^1' } });
	write('packages/rust/Cargo.toml', '');
	write('foundations/violet/packages/core/package.json', { name: '@x/violet-core' });
	write('foundations/violet/packages/runtime/package.json', {
		name: '@x/violet-runtime',
		peerDependencies: { '@x/violet-core': '*' },
	});
	return { root, write };
}

test('lockfile changes resolve to the importers whose dependency closure changed', () => {
	assert.deepEqual(changedImporters(lockfile(), lockfile()), { importers: [] });
	// zod is reached by core directly and by server through the string-width alias.
	assert.deepEqual(changedImporters(lockfile(), lockfile({ zod: '4.7.0' })), {
		importers: ['packages/core', 'packages/server'],
	});
	assert.match(changedImporters(lockfile(), lockfile({ root: '2.6.0' })).global, /root importer/);
	assert.match(
		changedImporters(lockfile(), lockfile({ settings: 'autoInstallPeers: false' })).global,
		/settings/
	);
	assert.match(changedImporters(null, lockfile()).global, /added or removed/);
	assert.match(
		changedImporters(lockfile(), lockfile().replace("'9.0'", "'6.0'")).global,
		/could not be compared/
	);
	// pnpm 11 and later lead with a document for the package manager itself.
	const manager = (version) =>
		`---\nlockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    packageManagerDependencies:\n      pnpm:\n        specifier: ${version}\n        version: ${version}\n\n---\n`;
	const withManager = manager('12.22.0') + lockfile();
	assert.deepEqual(changedImporters(withManager, `${manager('12.22.0')}${lockfile()}`), {
		importers: [],
	});
	assert.deepEqual(changedImporters(withManager, manager('12.22.0') + lockfile({ zod: '4.7.0' })), {
		importers: ['packages/core', 'packages/server'],
	});
	assert.match(changedImporters(withManager, manager('12.23.0') + lockfile()).global, /settings/);
	assert.match(changedImporters(lockfile(), withManager).global, /settings/);
	const parsed = parseLockfile(lockfile());
	assert.deepEqual(parseLockfile(withManager).importers, parsed.importers);
	assert.deepEqual(parsed.importers.get('packages/server').dependencies, [
		{ name: '@lushly-dev/afd-core', version: 'link:../core' },
		{ name: 'string-width-cjs', version: 'string-width@4.2.3' },
	]);
});

test('the workspace graph follows every dependency field in both directions', (t) => {
	const { root } = fixture(t);
	const packages = readWorkspace(root);
	assert.deepEqual(
		packages.map((pkg) => [pkg.name, pkg.dir, pkg.dependencies]),
		[
			['@x/cli', 'packages/cli', ['@x/server']],
			['@x/core', 'packages/core', []],
			['@x/server', 'packages/server', ['@x/core']],
			['@x/violet-core', 'foundations/violet/packages/core', []],
			['@x/violet-runtime', 'foundations/violet/packages/runtime', ['@x/violet-core']],
		]
	);
	assert.deepEqual([...withDependents(packages, ['@x/core'])].sort(), [
		'@x/cli',
		'@x/core',
		'@x/server',
	]);
	assert.deepEqual([...withDependencies(packages, ['@x/cli'])].sort(), [
		'@x/cli',
		'@x/core',
		'@x/server',
	]);
});

test('files map to owning packages, unit roots and shared inputs', (t) => {
	const { root, write } = fixture(t);
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const core = scope(['packages/core/src/index.ts']);
	assert.equal(core.mode, 'affected');
	assert.deepEqual(core.changed, ['@x/core']);
	assert.deepEqual(core.affected, ['@x/cli', '@x/core', '@x/server']);
	const cli = scope(['packages/cli/src/main.ts']);
	assert.deepEqual(cli.affected, ['@x/cli']);
	assert.deepEqual(cli.build, ['@x/cli', '@x/core', '@x/server']);
	assert.deepEqual(scope(['foundations/violet/tsconfig.json']).affected, [
		'@x/violet-core',
		'@x/violet-runtime',
	]);
	assert.deepEqual(scope(['foundations/violet/packages/runtime/src/a.ts']).affected, [
		'@x/violet-runtime',
	]);
	// A unit's own docs/ reach none of its packages, unlike its other root files.
	assert.deepEqual(scope(['foundations/violet/docs/STATUS.md']).affected, []);
	assert.deepEqual(scope(['foundations/violet/docs/phases/0/spec.md']).affected, []);
	// A plugin is a unit of its own (Loam's D109): its files reach none of Loam's packages.
	write(
		'pnpm-workspace.yaml',
		'packages:\n  - "packages/*"\n  - "foundations/*/packages/*"\n  - "endpoints/loam/packages/*"\n'
	);
	write('endpoints/loam/packages/kernel/package.json', { name: '@x/loam-kernel' });
	assert.deepEqual(scope(['endpoints/loam/README.md']).changed, ['@x/loam-kernel']);
	assert.deepEqual(scope(['endpoints/loam/plugins/mail/engine/src/lib.rs']).affected, []);
	assert.deepEqual(scope(['endpoints/loam/plugins/mail/README.md']).affected, []);
	assert.deepEqual(scope(['endpoints/loam/plugins/mail/docs/engine.spec.md']).affected, []);
	assert.deepEqual(scope(['foundations/violet/README.md']).affected, [
		'@x/violet-core',
		'@x/violet-runtime',
	]);
	// Non-workspace units, documentation and other languages select nothing.
	assert.deepEqual(scope(['packages/rust/src/lib.rs', 'docs/a.md', 'AGENTS.md']).affected, []);
	assert.equal(scope(['tsconfig.json']).mode, 'all');
	assert.equal(scope(['scripts/affected/scope.mjs']).mode, 'all');
	// The local suite list reaches no package; its own tests run through the tooling tests.
	assert.deepEqual(scope(['scripts/affected/suites.mjs']).affected, []);
	assert.equal(scope(['packages\\core\\a.ts']).changed[0], '@x/core');
});

test('spec prose reaches no package; the files beside it reach their readers', () => {
	const root = join(import.meta.dirname, '..');
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	// Package tests read spec JSON, vectors, wire fixtures and VERSION; only repository-wide
	// checks, which always run, read the Markdown.
	assert.deepEqual(scope(['spec/authorization.md', 'spec/CHANGELOG.md']).affected, []);
	assert.deepEqual(scope(['spec/plugin-manifest.md']).affected, []);
	// The release tracks' private stubs (scripts/release/tracks.mjs) are workspace packages that own
	// none of the files beside them: a Python or Botcore change selects no package, as before.
	assert.deepEqual(
		scope([
			'python/src/afd/__init__.py',
			'endpoints/botcore/src/botcore/__init__.py',
			'endpoints/botcore/uv.lock',
		]).affected,
		[]
	);
	assert.deepEqual(scope(['spec/authorization.json']).changed, [
		'@lushly-dev/afd-cli',
		'@lushly-dev/afd-core',
		'@lushly-dev/afd-server',
	]);
	assert.deepEqual(scope(['spec/vectors/error-codes.json']).changed, [
		'@lushly-dev/afd-cli',
		'@lushly-dev/afd-core',
		'@lushly-dev/afd-server',
	]);
	assert.ok(scope(['spec/plugin-manifest.json']).changed.includes('@lushly-dev/loam-manifest'));
	assert.ok(scope(['spec/VERSION']).changed.includes('@lushly-dev/loam-manifest'));
});

test("the todo example's scenarios and commands reach afd-testing's own tests, not its dependents", () => {
	const root = join(import.meta.dirname, '..');
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	// src/runner/todo-example.test.ts imports the commands and runs the scenario files by path
	for (const file of [
		'packages/examples/todo/scenarios/filter-by-priority.scenario.yaml',
		'packages/examples/todo/backends/typescript/src/commands/create.ts',
	]) {
		const { changed, affected } = scope([file]);
		assert.ok(changed.includes('@lushly-dev/afd-testing'), file);
		assert.ok(
			!affected.includes('@lushly-dev/afd-cli'),
			`${file} selects afd-testing's dependents`
		);
	}
});

test("the bench's results and tasks reach the seed library, and its other prose none", () => {
	const root = join(import.meta.dirname, '..');
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const bench = 'docs/features/complete/agent-first-design/bench';
	for (const file of [
		`${bench}/results/t1-lend-a-packet/lent.json`,
		`${bench}/tasks/t3-a-variety.md`,
	]) {
		assert.deepEqual(scope([file]).changed, ['@afd/example-seed-library'], file);
	}
	assert.deepEqual(scope([`${bench}/seed-library.md`]).affected, []);
});

test("violet-elements sources reach specimen-fast-af's own tests via EXTRA_INPUTS", () => {
	const root = join(import.meta.dirname, '..');
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const result = scope(['foundations/fast-af/packages/violet-elements/src/violet-select.ts']);
	assert.ok(result.changed.includes('@lushly-dev/specimen-fast-af'));
	assert.ok(result.affected.includes('@lushly-dev/specimen-fast-af'));
	// Prose beside the sources does not select specimen-fast-af through EXTRA_INPUTS.
	assert.ok(
		!scope(['foundations/fast-af/packages/violet-elements/src/README.md']).changed.includes(
			'@lushly-dev/specimen-fast-af'
		)
	);
});

test('a test file reaches its package and not the dependents', (t) => {
	const { root } = fixture(t);
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const tests = scope(['packages/core/src/a.test.ts']);
	assert.deepEqual(tests.changed, ['@x/core']);
	assert.deepEqual(tests.affected, ['@x/core']);
	assert.deepEqual(tests.build, ['@x/core']);
	assert.equal(tests.reasons.get('@x/core'), `packages/core/src/a.test.ts (${OWN_TESTS})`);
	assert.equal(gate(tests, { packages: ['@x/server'], paths: [] }).run, false);
	assert.deepEqual(gate(tests, { packages: ['@x/core'], paths: [] }), {
		run: true,
		reason: `@x/core is affected (packages/core/src/a.test.ts (${OWN_TESTS}))`,
	});
	for (const file of ['a.spec.ts', 'a.pw.spec.ts', 'a.test.mjs', 'ui/a.test.tsx', 'a.e2e.test.ts'])
		assert.deepEqual(scope([`packages/core/${file}`]).affected, ['@x/core'], file);

	// A source file beside it selects the dependents, and is the reason shown for them.
	const mixed = scope(['packages/core/src/a.test.ts', 'packages/core/src/index.ts']);
	assert.deepEqual(mixed.affected, ['@x/cli', '@x/core', '@x/server']);
	assert.equal(mixed.reasons.get('@x/core'), 'packages/core/src/index.ts');
	// Each package is judged alone: server's test file adds nothing to what core's source selects.
	assert.deepEqual(
		scope(['packages/server/src/a.test.ts', 'foundations/violet/packages/core/a.ts']).affected,
		['@x/server', '@x/violet-core', '@x/violet-runtime']
	);

	// What tests share, and files only named like tests, still reach the dependents.
	for (const file of [
		'src/a.test-support.ts',
		'src/test.ts',
		'test/fixtures/a.json',
		'src/__snapshots__/a.test.ts.snap',
		'a.spec.md',
		'a.test.yml',
	])
		assert.deepEqual(
			scope([`packages/core/${file}`]).affected,
			['@x/cli', '@x/core', '@x/server'],
			file
		);
	// Outside any package a test file is a unit file like any other.
	assert.deepEqual(scope(['foundations/violet/a.test.ts']).affected, [
		'@x/violet-core',
		'@x/violet-runtime',
	]);
});

test('the rule for test files holds in this repository', () => {
	const root = join(import.meta.dirname, '..');
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	assert.deepEqual(scope(['packages/server/src/execution-controls.test.ts']).affected, [
		'@lushly-dev/afd-server',
	]);

	// No package imports a test file of another, so none reaches another package's build or suite.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const imported = /['"]([^'"]*\.(?:test|spec)(?:\.[cm]?[jt]sx?)?)['"]/;
	// git grep takes the same expression in POSIX form, which has no `(?:`.
	let hits = '';
	try {
		hits = execFileSync(
			'git',
			[
				'grep',
				'-nIE',
				`(from|import|require)[[:space:]]*\\(?[[:space:]]*${imported.source.replaceAll('(?:', '(')}`,
				'--',
				...['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].map((kind) => `*.${kind}`),
			],
			{ cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		);
	} catch (error) {
		// git grep exits 1 when nothing matches.
		if (error.status !== 1) throw error;
	}
	const workspace = readWorkspace(root);
	const owners = (file) => workspace.filter((pkg) => file.startsWith(`${pkg.dir}/`));
	const crossing = hits.split('\n').filter((hit) => {
		if (!hit) return false;
		const [file, , ...text] = hit.split(':');
		const [, specifier] = text.join(':').match(imported);
		if (!specifier.startsWith('.')) return true;
		const target = posix.join(dirname(file), specifier);
		return owners(target).some((pkg) => !file.startsWith(`${pkg.dir}/`));
	});
	assert.deepEqual(
		crossing,
		[],
		'a test file of another package is imported; move what is shared to a helper (a.test-support.ts), which selects dependents'
	);

	// The suites that scan another package's files, tests included, declare them (EXTRA_INPUTS).
	const reached = (file) => scope([file]).affected;
	for (const file of [
		'packages/examples/todo/backends/typescript/src/commands/index.ts',
		'packages/examples/todo/scenarios/filter-by-priority.scenario.yaml',
		'packages/examples/todo/fixtures/seeded-todos.json',
	]) {
		assert.ok(reached(file).includes('@lushly-dev/afd-testing'), file);
	}
	assert.ok(!reached('packages/examples/todo/README.md').includes('@lushly-dev/afd-testing'));
	const kernel = reached('endpoints/loam/packages/kernel/src/a.test.ts');
	assert.ok(
		kernel.includes('@lushly-dev/loam-web') && kernel.includes('@lushly-dev/loam-identity')
	);
	const chrome = reached('endpoints/loam/packages/chrome/src/a.test.ts');
	assert.ok(
		chrome.includes('@lushly-dev/loam-web') && chrome.includes('@lushly-dev/loam-identity')
	);
	// A workflow whose jobs run a unit's suites names every package of the unit in its gates: a
	// test-only change reaches no dependent, so a package left out would skip its own workflow.
	// Plugins under endpoints/loam/plugins/ are units of their own (D109) owned by loam-plugins.yml.
	const loam = workspace.filter(
		(pkg) => pkg.dir.startsWith('endpoints/loam/') && !pkg.dir.startsWith('endpoints/loam/plugins/')
	);
	assert.ok(loam.length >= 16);
	const pluginPackages = workspace.filter((pkg) => pkg.dir.startsWith('endpoints/loam/plugins/'));
	const pluginGates = readTrigger(
		readFileSync(join(root, '.github/workflows/loam-plugins.yml'), 'utf8')
	).gates;
	const pluginNamed = [...pluginGates.values()].flatMap(
		(args) => parseArgs(['gate', ...args], {}).packages
	);
	for (const pkg of pluginPackages) {
		assert.equal(pluginNamed.includes(pkg.name), true, `loam-plugins.yml gate: ${pkg.name}`);
	}
	const gates = readTrigger(readFileSync(join(root, '.github/workflows/loam.yml'), 'utf8')).gates;
	// The frozen hosted lane's packages are its own gate's, through `--lane`, and in no other (D162).
	const lane = new Set(readLanes(root).flatMap((entry) => entry.packages));
	assert.ok(lane.has('@lushly-dev/loam-host'));
	const hosted = laneGate(scope([]), parseArgs(['gate', ...gates.get('hosted')], {})).packages;
	for (const id of ['run', 'mounted']) {
		const named = parseArgs(['gate', ...gates.get(id)], {}).packages;
		for (const pkg of loam)
			assert.equal(
				(lane.has(pkg.name) ? hosted : named).includes(pkg.name),
				true,
				`loam.yml gate ${lane.has(pkg.name) ? 'hosted' : id}: ${pkg.name}`
			);
		for (const name of lane) assert.ok(!named.includes(name), `loam.yml gate ${id}: ${name}`);
	}
	// Its `theme:check` step scans violet-elements' source, specs included: a path of the gate, as
	// no package's suite runs the check.
	const spec = scope(['foundations/fast-af/packages/violet-elements/src/button/a.spec.ts']);
	assert.deepEqual(spec.affected, ['@lushly-dev/violet-elements']);
	assert.equal(gate(spec, parseArgs(['gate', ...gates.get('run')], {})).run, true);
});

test("a lane's files reach only its packages, and its packages reach no dependent outside it", (t) => {
	const { root, write } = fixture(t);
	write('architecture.json', {
		lanes: [
			{
				name: 'hosted',
				packages: ['@x/host'],
				paths: ['packages/host/', 'packages/web/test/hosted/', 'packages/web/hosted.json'],
			},
		],
	});
	write('packages/host/package.json', { name: '@x/host', dependencies: { '@x/core': '*' } });
	write('packages/web/package.json', {
		name: '@x/web',
		dependencies: { '@x/core': '*' },
		devDependencies: { '@x/host': '*' },
	});
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const lane = (files) => gate(scope(files), parseArgs(['gate', '--lane', 'hosted'], {})).run;
	const web = (files) => gate(scope(files), parseArgs(['gate', '--package', '@x/web'], {})).run;

	// The server's own change: the lane alone, though the web host lists it as a devDependency.
	assert.deepEqual(scope(['packages/host/src/a.ts']).affected, ['@x/host']);
	assert.equal(lane(['packages/host/src/a.ts']), true);
	assert.equal(web(['packages/host/src/a.ts']), false);
	// A lane path inside another package's directory (and a helper there, not only a test file) is the lane's.
	for (const file of ['packages/web/test/hosted/support.ts', 'packages/web/hosted.json']) {
		assert.deepEqual(scope([file]).affected, [], file);
		assert.equal(lane([file]), true, file);
		assert.equal(web([file]), false, file);
	}
	// What the lane imports: both lanes run.
	assert.deepEqual(scope(['packages/core/src/a.ts']).affected.sort(), [
		'@x/cli',
		'@x/core',
		'@x/host',
		'@x/server',
		'@x/web',
	]);
	assert.equal(lane(['packages/core/src/a.ts']), true);
	// A local change the lane does not import: the lane waits for nothing and is not run.
	assert.equal(lane(['packages/web/src/a.ts']), false);
	assert.equal(lane(['packages/web/test/unit/a.ts']), false);
	assert.equal(web(['packages/web/src/a.ts']), true);

	// The TypeScript gate (`affected.mjs run`) leaves the lane out, even as the web host's devDependency.
	assert.equal(pnpmArgs(scope(['packages/host/src/a.ts']), 'test'), null);
	assert.deepEqual(pnpmArgs(scope(['packages/web/src/a.ts']), 'build'), [
		'-r',
		'--filter',
		'@x/core...',
		'--filter',
		'@x/web...',
		'--filter',
		'!@x/host',
		'run',
		'--if-present',
		'build',
	]);
	const all = resolveScope({ root, all: true });
	// The whole workspace (a global file, check:all, the daily run) checks the lane too: no lane job reads those files.
	assert.deepEqual(pnpmArgs(all, 'test'), ['-r', 'run', '--if-present', 'test']);
	assert.equal(gate(all, parseArgs(['gate', '--lane', 'hosted'], {})).run, true);
	assert.throws(
		() => gate(all, parseArgs(['gate', '--lane', 'nowhere'], {})),
		/architecture.json has no lane named nowhere/
	);
	// No architecture.json: no lane, and the scope is as it was.
	assert.deepEqual(readLanes(join(root, 'packages')), []);
});

test("this repository's hosted lane is gated apart from Loam's local lane (D162)", () => {
	const root = join(import.meta.dirname, '..');
	const workflow = readFileSync(join(root, '.github/workflows/loam.yml'), 'utf8');
	const { gates } = readTrigger(workflow);
	const runs = (id, files) =>
		gate(resolveScope({ root, files, git: () => '' }), parseArgs(['gate', ...gates.get(id)], {}))
			.run;
	const cases = [
		// [file, the local gate, the hosted gate]
		['endpoints/loam/packages/host/src/host.ts', false, true],
		['endpoints/loam/packages/web/test/hosted/support.ts', false, true],
		['endpoints/loam/packages/web/test/hosted/relay.test.ts', false, true],
		['endpoints/loam/packages/web/vitest.hosted.config.ts', false, true],
		['endpoints/loam/packages/chrome/src/a.ts', true, false],
		['endpoints/loam/packages/web/src/host.ts', true, false],
		['endpoints/loam/packages/web/test/browser/accessibility.test.ts', true, false],
		// The lane's inputs, which it imports or reads: both run.
		['endpoints/loam/packages/web/test/browser/harness.ts', true, true],
		['endpoints/loam/packages/web/test/mounted/umbel-fixture.ts', true, true],
		['endpoints/loam/packages/web/package.json', true, true],
		['endpoints/loam/apps/notes/src/a.ts', true, false],
		['endpoints/loam/packages/console/src/a.ts', true, false],
		['endpoints/loam/packages/desktop/test/a.ts', true, false],
		// What the hosted server imports runs both.
		['endpoints/loam/packages/kernel/src/kernel.ts', true, true],
		['endpoints/loam/packages/identity/src/a.ts', true, true],
		['endpoints/loam/packages/cli/src/a.ts', true, true],
		// The theme too, through the CLI the server imports.
		['endpoints/loam/packages/theme/src/a.ts', true, true],
		['packages/server/src/a.ts', true, true],
		['.github/workflows/loam.yml', true, true],
	];
	for (const [file, local, hosted] of cases) {
		assert.equal(runs('run', [file]), local, `run gate: ${file}`);
		assert.equal(runs('hosted', [file]), hosted, `hosted gate: ${file}`);
	}
});

test("only the hosted job and its steps build or test the lane's packages (D162)", () => {
	const root = join(import.meta.dirname, '..');
	const lane = readLanes(root).flatMap((entry) => entry.packages);
	assert.ok(lane.length > 0);
	// A pnpm command whose filters can reach a lane package: a dependency closure (`x...`) or a folder glob.
	const reaches = (command) => /^pnpm\b/.test(command) && /-F "[^"]*(?:\.\.\.|\*)"/.test(command);
	const leavesOut = (command) => lane.every((name) => command.includes(`-F "!${name}"`));
	// Every workflow: a closure such as `loam-desktop...` reaches the lane through the web host's devDependency.
	let checked = 0;
	for (const file of readdirSync(join(root, '.github/workflows'))) {
		const workflow = readFileSync(join(root, '.github/workflows', file), 'utf8');
		for (const job of workflow.split(/\n(?= {2}[a-z][\w-]*:\n)/).slice(1)) {
			const id = job.match(/^ {2}([\w-]+):/)[1];
			const commands = [...job.matchAll(/^\s+(?:run: )?(pnpm [^\n]+)$/gm)].map((match) => match[1]);
			for (const command of commands.filter(
				(candidate) => reaches(candidate) && /loam/.test(candidate)
			)) {
				checked++;
				const where = `${file} ${id}: ${command}`;
				if (file === 'loam.yml' && id === 'hosted') assert.ok(!leavesOut(command), where);
				else assert.ok(leavesOut(command), `builds or tests the frozen lane: ${where}`);
			}
		}
	}
	assert.ok(checked >= 7, `only ${checked} pnpm commands read`);
	// And every local suite: a closure over Loam leaves the lane out, but in loam.yml's hosted steps.
	for (const suite of SUITES)
		for (const step of suite.steps.filter(
			(candidate) => reaches(candidate.run) && /loam/.test(candidate.run)
		))
			assert.equal(
				leavesOut(step.run),
				!(suite.workflow === 'loam.yml' && step.gate === 'hosted'),
				`suites.mjs ${suite.workflow} ${step.gate}: ${step.run}`
			);
	const loam = SUITES.find((suite) => suite.workflow === 'loam.yml');
	assert.ok(loam.steps.some((step) => step.gate === 'hosted' && /test:hosted/.test(step.run)));
});

test('provenance records reach no package', (t) => {
	const { root, write } = fixture(t);
	// Specimen's shape: the family's root is itself a package, and holds the records.
	write(
		'pnpm-workspace.yaml',
		'packages:\n  - "packages/*"\n  - "foundations/*"\n  - "foundations/*/packages/*"\n'
	);
	write('foundations/specimen/package.json', { name: '@x/specimen' });
	write('packages/cli/package.json', { name: '@x/cli', dependencies: { '@x/specimen': '*' } });
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	assert.deepEqual(scope(['foundations/specimen/src/a.ts']).affected, ['@x/cli', '@x/specimen']);
	assert.deepEqual(scope(['foundations/specimen/provenance/adaptations.json']).affected, []);
	// FAST-AF's and Violet's: beside the packages, where a unit file selects them all.
	assert.deepEqual(scope(['foundations/violet/provenance/provenance.json']).affected, []);
	assert.deepEqual(scope(['foundations/violet/tsconfig.json']).affected, [
		'@x/violet-core',
		'@x/violet-runtime',
	]);
	// Only a family's records directory: the same name elsewhere is an ordinary file.
	assert.deepEqual(scope(['packages/cli/provenance/a.json']).affected, ['@x/cli']);

	// The records select nothing because the tests that read them run for every change.
	for (const family of ['specimen', 'fast-af', 'violet']) {
		const suite = `scripts/${family}-provenance.test.mjs`;
		assert.ok(testFiles.includes(suite), suite);
		assert.ok(!releaseTestFiles.includes(suite), suite);
	}
	const repository = join(import.meta.dirname, '..');
	const real = (files) => resolveScope({ root: repository, files, git: () => '' }).affected;
	assert.deepEqual(real(['foundations/specimen/provenance/adaptations.json']), []);
	assert.deepEqual(
		real([
			'foundations/fast-af/packages/element/packages/fast-element/src/a.pw.spec.ts',
			'foundations/fast-af/provenance/adaptations.json',
		]),
		['@lushly-dev/fast-element']
	);
});

test('the diff runs against the merge base and the lockfile is compared by importer', (t) => {
	const { root, write } = fixture(t);
	write('pnpm-lock.yaml', lockfile({ zod: '4.7.0' }));
	const calls = [];
	const git = (args) => {
		calls.push(args.join(' '));
		if (args[0] === 'merge-base') {
			if (args[1] === 'origin/main') throw new Error('missing');
			return 'abc123\n';
		}
		if (args[0] === 'diff') return 'pnpm-lock.yaml\npackages/cli/README.md\n';
		if (args[0] === 'ls-files') return 'packages/new/file.ts\n';
		if (args[0] === 'show') return lockfile();
		throw new Error(`unexpected git ${args}`);
	};
	const scope = resolveScope({ root, git });
	assert.deepEqual(calls.slice(0, 3), [
		'merge-base origin/main HEAD',
		'merge-base main HEAD',
		'diff --name-only --no-renames abc123',
	]);
	assert.ok(calls.includes('show abc123:pnpm-lock.yaml'));
	assert.equal(scope.base, 'abc123');
	assert.deepEqual(scope.changed, ['@x/cli', '@x/core', '@x/server']);
	assert.equal(scope.reasons.get('@x/core'), 'pnpm-lock.yaml (resolved dependencies changed)');

	const unresolved = resolveScope({
		root,
		bases: ['0000000000000000000000000000000000000000'],
		git: () => {
			throw new Error('unreachable');
		},
	});
	assert.equal(unresolved.mode, 'all');
	assert.match(unresolved.reason, /no base/);
	assert.equal(resolveScope({ root, all: true, git }).mode, 'all');
});

test('a pull request is compared with main as merged, not with the base it recorded', (t) => {
	const { root, write } = fixture(t);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const git = (args) =>
		execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@example.invalid', ...args], {
			cwd: root,
			encoding: 'utf8',
			env,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	const commit = (message) => {
		git(['add', '.']);
		git(['commit', '-m', message]);
	};
	git(['init', '-b', 'main']);
	commit('base');
	const recorded = git(['rev-parse', 'HEAD']).trim();
	git(['switch', '-c', 'docs-only']);
	write('docs/guide.md', 'guide');
	commit('docs');
	git(['switch', 'main']);
	write('package.json', { name: 'root', private: true, version: '1.0.0' });
	commit('main moves on');
	// GitHub's merge ref: main as it is now, then the pull request.
	git(['switch', '--detach']);
	git(['merge', '--no-ff', '-m', 'merge ref', 'docs-only']);

	const stale = resolveScope({ root, bases: [recorded], git });
	assert.equal(stale.mode, 'all');
	const merged = resolveScope({ root, bases: ['HEAD^1'], git });
	assert.notEqual(merged.mode, 'all');
	assert.deepEqual(merged.files, ['docs/guide.md']);
	assert.deepEqual(merged.affected, []);

	const workflows = join(import.meta.dirname, '../.github/workflows');
	const bases = readdirSync(workflows).flatMap(
		(file) => readFileSync(join(workflows, file), 'utf8').match(/^\s*AFD_BASE: .*$/gm) ?? []
	);
	assert.ok(bases.length >= 8);
	for (const base of bases)
		assert.equal(
			base.trim(),
			"AFD_BASE: ${{ github.event_name == 'pull_request' && 'HEAD^1' || github.event.merge_group.base_sha || github.event.before }}"
		);
});

test('a merge group is compared with the commit the queue built it on', (t) => {
	const { root, write } = fixture(t);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const git = (args) =>
		execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@example.invalid', ...args], {
			cwd: root,
			encoding: 'utf8',
			env,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	const commit = (message) => {
		git(['add', '.']);
		git(['commit', '-m', message]);
	};
	git(['init', '-b', 'main']);
	commit('base');
	// The queue's branch: the commit of one pull request, then of the next.
	git(['switch', '-c', 'queue']);
	write('packages/core/src/index.ts', 'export const first = 1;');
	commit('first in the queue (#1)');
	const base = git(['rev-parse', 'HEAD']).trim();
	write('docs/guide.md', 'guide');
	commit('second in the queue (#2)');

	// The second group changes the guide alone, though its commit holds the first's code too.
	const group = resolveScope({ root, bases: [base], git });
	assert.deepEqual(group.files, ['docs/guide.md']);
	assert.deepEqual(group.affected, []);
	const trigger = (scope, paths) => workflowTrigger(scope, { paths, gates: new Map() });
	assert.deepEqual(trigger(group, ['packages/**', 'spec/**']), {
		run: false,
		reason: 'none of the 1 changed file(s) matches its pull_request.paths',
	});
	assert.deepEqual(trigger(group, ['packages/**', 'docs/**']), {
		run: true,
		reason: 'docs/guide.md changed',
	});
	assert.equal(trigger(group, ['docs/**', '!docs/guide.md']).run, false);
	// No path filter: every pull request starts it, so every merge group does.
	assert.equal(trigger(group, null).run, true);
	// Against main, the group would show both pull requests: the base is what narrows it.
	assert.deepEqual(resolveScope({ root, bases: ['main'], git }).files, [
		'docs/guide.md',
		'packages/core/src/index.ts',
	]);
	// A base that cannot be found is unknown, not unaffected: the workflow runs.
	const unknown = resolveScope({ root, bases: ['f'.repeat(40)], git });
	assert.deepEqual(unknown.files, []);
	assert.equal(trigger(unknown, ['packages/**']).run, true);
	assert.equal(trigger(resolveScope({ root, all: true, git }), ['x/**']).run, true);
	// A whole-workspace scope that still lists its files is matched by them (ci.yml selects it).
	write('lefthook.yml', 'changed');
	commit('third in the queue (#3)');
	const whole = resolveScope({ root, bases: ['HEAD^1'], git });
	assert.equal(whole.mode, 'all');
	assert.equal(trigger(whole, ['packages/**']).run, false);
	assert.equal(trigger(whole, ['lefthook.yml']).run, true);
	assert.throws(() => workflowTrigger(group, null), /no pull_request trigger/);
});

test('the trigger command answers for a workflow by its own pull_request.paths', () => {
	const script = join(import.meta.dirname, 'affected.mjs');
	const run = (...args) => {
		const output = join(mkdtempSync(join(tmpdir(), 'affected-trigger-')), 'output');
		writeFileSync(output, '');
		const { GITHUB_OUTPUT, AFD_BASE, AFD_SCOPE, ...environment } = process.env;
		const done = spawnSync(process.execPath, [script, 'trigger', ...args], {
			encoding: 'utf8',
			env: { ...environment, GITHUB_OUTPUT: output },
		});
		const written = readFileSync(output, 'utf8');
		rmSync(dirname(output), { recursive: true, force: true });
		return { status: done.status, stdout: done.stdout, stderr: done.stderr, written };
	};
	const off = run('rust.yml', '--files', 'docs/guide.md');
	assert.equal(off.status, 0, off.stderr);
	assert.equal(off.written, 'run=false\n');
	assert.match(off.stdout, /^run=false: none of the 1 changed file\(s\) matches/);
	const on = run('rust.yml', '--files', 'docs/guide.md', 'packages/rust/src/lib.rs');
	assert.equal(on.written, 'run=true\n');
	assert.match(on.stdout, /^run=true: packages\/rust\/src\/lib\.rs changed/);
	// Its own file is one of its paths, so a change to the workflow runs it.
	assert.equal(run('rust.yml', '--files', '.github/workflows/rust.yml').written, 'run=true\n');
	assert.equal(run('ci.yml', '--files', 'docs/guide.md').written, 'run=true\n');
	// Nothing is written for a workflow it cannot answer for, and the job fails.
	for (const [args, message] of [
		[['release.yml'], /release\.yml has no pull_request trigger/],
		[['absent.yml'], /ENOENT/],
		[['../ci.yml'], /needs a workflow file name/],
		[[], /needs a workflow file name/],
	]) {
		const refused = run(...args, '--files', 'docs/guide.md');
		assert.equal(refused.status, 1, args.join(' '));
		assert.match(refused.stderr, message);
		assert.equal(refused.written, '');
	}
});

test('pnpm arguments, gates and options follow the scope', (t) => {
	const { root } = fixture(t);
	const scope = resolveScope({ root, files: ['packages/server/src/a.ts'], git: () => '' });
	assert.deepEqual(pnpmArgs(scope, 'test'), [
		'-r',
		'--filter',
		'@x/cli',
		'--filter',
		'@x/server',
		'run',
		'--if-present',
		'test',
	]);
	assert.deepEqual(pnpmArgs(scope, 'build').slice(0, 7), [
		'-r',
		'--filter',
		'@x/cli...',
		'--filter',
		'@x/core...',
		'--filter',
		'@x/server...',
	]);
	assert.deepEqual(
		pnpmArgs(scope, 'test', { noBail: true, passthrough: ['--coverage'] }).slice(-5),
		['--no-bail', 'run', '--if-present', 'test', '--coverage']
	);
	const all = resolveScope({ root, all: true });
	assert.deepEqual(pnpmArgs(all, 'build'), ['-r', 'run', '--if-present', 'build']);
	const none = resolveScope({ root, files: ['docs/a.md'], git: () => '' });
	assert.equal(pnpmArgs(none, 'test'), null);

	assert.equal(gate(scope, { packages: ['@x/cli'], paths: [] }).run, true);
	assert.equal(gate(scope, { packages: ['@x/violet-core'], paths: [] }).run, false);
	assert.equal(gate(none, { packages: ['@x/violet-core'], paths: ['docs/'] }).run, true);
	assert.equal(gate(all, { packages: ['@x/violet-core'], paths: [] }).run, true);
	// An --except prefix inside a gated path (a unit's docs/) opens nothing on its own.
	const docs = resolveScope({ root, files: ['endpoints/umbel/docs/STATUS.md'], git: () => '' });
	const umbel = parseArgs(
		['gate', '--path', 'endpoints/umbel/', '--except', 'endpoints/umbel/docs/'],
		{}
	);
	assert.deepEqual(umbel.except, ['endpoints/umbel/docs/']);
	assert.equal(gate(docs, umbel).run, false);
	const mixed = resolveScope({
		root,
		files: ['endpoints/umbel/docs/STATUS.md', 'endpoints/umbel/src/lib.rs'],
		git: () => '',
	});
	assert.deepEqual(gate(mixed, umbel), { run: true, reason: 'endpoints/umbel/src/lib.rs changed' });

	const options = parseArgs(
		['run', 'test', '--no-bail', '--files', 'a.ts', 'b.ts', '--base', 'dev', '--', '--coverage'],
		{}
	);
	assert.deepEqual(
		[options.positional, options.noBail, options.files, options.bases, options.passthrough],
		[['test'], true, ['a.ts', 'b.ts'], ['dev'], ['--coverage']]
	);
	assert.equal(parseArgs(['list'], { AFD_SCOPE: 'all' }).all, true);
	assert.deepEqual(parseArgs(['list'], { AFD_BASE: 'abc' }).bases, ['abc']);
	assert.throws(() => parseArgs(['list', '--nope'], {}), /unknown option/);
});

test('release-tooling suites run only when release inputs change', () => {
	const scope = (files) => ({ mode: 'affected', files });
	assert.ok(releaseTestFiles.length > 0);
	assert.ok(releaseTestFiles.every((file) => testFiles.includes(file)));
	assert.ok(!releaseTestFiles.includes('scripts/repository-contract.test.mjs'));
	const skipped = selectToolingTests(scope(['packages/core/src/a.ts']));
	assert.deepEqual(
		skipped.files,
		testFiles.filter((file) => !releaseTestFiles.includes(file))
	);
	assert.match(skipped.skipped, /release-tooling suites skipped/);
	assert.deepEqual(selectToolingTests(scope(['scripts/release/control.mjs'])).files, testFiles);
	assert.deepEqual(selectToolingTests(scope(['.changeset/a.md'])).files, testFiles);
	assert.deepEqual(selectToolingTests({ mode: 'all', files: [] }).files, testFiles);
});

test('every local cargo and multi-package test step runs to the end', () => {
	// The lane ejects with every failing test only if no suite stops at its first failing binary
	// (lushly-dev/afd#1607); `pnpm verify --keep-going` runs the suites after a failed one.
	const cargo = SUITES.flatMap((suite) => suite.steps).filter((step) =>
		/\bcargo test\b/.test(step.run)
	);
	assert.ok(cargo.length > 0);
	for (const step of cargo) assert.match(step.run, /--no-fail-fast/, step.run);
	// A test script over several packages runs in each after one fails.
	const packages = SUITES.flatMap((suite) => suite.steps).filter((step) =>
		/^pnpm (?:--no-bail )?-F .* -F [^&]* test\b/.test(step.run)
	);
	assert.ok(packages.length > 0);
	for (const step of packages) assert.match(step.run, /^pnpm --no-bail /, step.run);
});

test('workflow path filters are read and matched like GitHub Actions', () => {
	const filters = ['endpoints/umbel/**', '!endpoints/umbel/docs/**', 'scripts/release-*.mjs'];
	assert.equal(matchesFilters(filters, 'endpoints/umbel/src/main.rs'), true);
	assert.equal(matchesFilters(filters, 'endpoints/umbel/docs/STATUS.md'), false);
	assert.equal(matchesFilters(filters, 'scripts/release-claim.mjs'), true);
	assert.equal(matchesFilters(filters, 'scripts/release/claim.mjs'), false);
	assert.equal(matchesFilters(['.agents/skills'], '.agents/skills'), true);

	const block = `on:
  push:
    paths: ['ignored/**']
  pull_request:
    branches: [main]
    paths:
      # a comment
      - 'a/**'
      - "b.yml" # trailing
  workflow_dispatch:
jobs:
  scope:
    steps:
      - id: host
        run: node scripts/affected.mjs gate --path a/host/ --path b.yml
`;
	const trigger = readTrigger(block);
	assert.deepEqual(trigger.paths, ['a/**', 'b.yml']);
	assert.deepEqual(trigger.gates.get('host'), ['--path', 'a/host/', '--path', 'b.yml']);
	assert.deepEqual(
		readTrigger(block.replace(/paths:\n[\s\S]*?(?= {2}workflow)/, "paths: ['c/**', 'd']\n")).paths,
		['c/**', 'd']
	);
	assert.equal(readTrigger(block.replace(/^ {2}pull_request:.*$/m, '  release:')), null);
	assert.equal(readTrigger('on:\n  pull_request:\n    branches: [main]\njobs:\n').paths, null);
});

test('every pull-request workflow has a local suite, bound to its gates', () => {
	const root = join(import.meta.dirname, '..');
	// ci.yml is `pnpm check` itself; ci-ok.yml runs nothing locally, it waits for the others.
	const notSuites = new Set(['ci.yml', 'ci-ok.yml']);
	const workflows = readdirSync(join(root, '.github/workflows')).filter(
		(file) =>
			!notSuites.has(file) &&
			readTrigger(readFileSync(join(root, '.github/workflows', file), 'utf8'))
	);
	assert.deepEqual(SUITES.map((suite) => suite.workflow).sort(), workflows.sort());
	for (const suite of SUITES) {
		const trigger = readSuiteTrigger(root, suite);
		assert.ok(trigger.paths?.length > 0, suite.workflow);
		for (const step of suite.steps.filter((candidate) => candidate.gate))
			assert.ok(trigger.gates.has(step.gate), `${suite.workflow} gate ${step.gate}`);
		// Every gate the workflow has binds at least one local step.
		for (const id of trigger.gates.keys())
			assert.ok(
				suite.steps.some((step) => step.gate === id),
				`${suite.workflow} gate ${id}`
			);
	}
});

test('verify plans the triggered suites and their passing gates', (t) => {
	const { root } = fixture(t);
	const suites = [
		{
			workflow: 'gated.yml',
			tools: [],
			steps: [
				{ gate: 'web', run: 'web' },
				{ gate: 'host', run: 'host' },
			],
		},
		{ workflow: 'plain.yml', tools: [], steps: [{ run: 'plain' }] },
	];
	const triggers = {
		'gated.yml': {
			paths: ['foundations/violet/**', 'docs/**'],
			gates: new Map([
				['web', ['--package', '@x/violet-runtime']],
				['host', ['--path', 'foundations/violet/host/']],
			]),
		},
		'plain.yml': { paths: ['packages/rust/**'], gates: new Map() },
	};
	const plan = (files, all = false) =>
		planSuites(resolveScope({ root, files, all, git: () => '' }), {
			root,
			suites,
			read: (_root, suite) => triggers[suite.workflow],
		}).map((entry) => entry.step.run);
	assert.deepEqual(plan(['foundations/violet/packages/core/src/a.ts']), ['web']);
	assert.deepEqual(plan(['foundations/violet/host/src/main.rs']), ['web', 'host']);
	assert.deepEqual(plan(['docs/a.md']), []);
	assert.deepEqual(plan(['packages/rust/src/lib.rs']), ['plain']);
	assert.deepEqual(plan([], true), ['web', 'host', 'plain']);
	// A file that selects the whole workspace triggers only the workflows it matches.
	assert.deepEqual(plan(['tsconfig.json']), []);
	assert.deepEqual(plan(['tsconfig.json', 'docs/a.md']), ['web', 'host']);
});

test('verify needs only the tools of the steps it plans (#781)', () => {
	const suite = { workflow: 'mixed.yml', tools: ['uv', 'cargo', 'cmake'] };
	const entry = (step) => ({ suite, step, reason: '' });
	const plan = [entry({ run: 'build', tools: [] }), entry({ run: 'py', tools: ['uv'] })];
	assert.deepEqual([...plannedTools(plan).keys()], ['uv']);
	// A step without tools of its own needs its suite's.
	const whole = [...plannedTools([entry({ run: 'all' })]).keys()];
	assert.deepEqual(whole, ['uv', 'cargo', 'cmake']);
	const other = { workflow: 'other.yml', tools: ['uv'] };
	assert.deepEqual(
		plannedTools([...plan, { suite: other, step: { run: 'x' }, reason: '' }]).get('uv'),
		['mixed.yml', 'other.yml']
	);
});

test("a step's tools are some of its suite's", () => {
	for (const suite of SUITES)
		for (const step of suite.steps)
			for (const tool of step.tools ?? [])
				assert.ok(suite.tools.includes(tool), `${suite.workflow}: ${step.run} needs ${tool}`);
});

test('the check gate runs even where LEFTHOOK=0 turns the git hooks off', () => {
	// Release sets LEFTHOOK=0 for Changesets' push; lefthook then skips `run check` too and exits 0.
	const environment = checkEnvironment(true, {
		LEFTHOOK: '0',
		LEFTHOOK_EXCLUDE: 'test',
		PATH: '/bin',
	});
	assert.deepEqual(environment, { PATH: '/bin', AFD_SCOPE: 'all' });
	assert.equal(checkEnvironment(false, { AFD_SCOPE: 'affected' }).AFD_SCOPE, 'affected');
	const lefthook = join(dirname(import.meta.dirname), 'node_modules/.bin/lefthook');
	const silent = execTool(lefthook, ['run', 'check'], {
		cwd: dirname(import.meta.dirname),
		env: { ...process.env, LEFTHOOK: '0' },
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	assert.equal(
		silent.trim(),
		'',
		'LEFTHOOK=0 no longer silences lefthook; revisit checkEnvironment'
	);
});

test('a path git quotes is read as the file it names', (t) => {
	assert.equal(gitPath('packages/rust/src/lib.rs'), 'packages/rust/src/lib.rs');
	assert.equal(gitPath('"packages/rust/tests/caf\\303\\251.rs"'), 'packages/rust/tests/café.rs');
	assert.equal(gitPath('"docs/a \\"b\\"\\\\c\\td.md"'), 'docs/a "b"\\c\td.md');
	assert.equal(gitPath('"docs/\\346\\227\\245\\346\\234\\254.md"'), 'docs/日本.md');
	// Not a quoted path: a lone quote, or a name that only starts with one.
	// With core.quotepath off git still quotes a name holding a quote, and leaves the rest raw.
	assert.equal(gitPath('"docs/\\"🙂\\".md"'), 'docs/"🙂".md');
	assert.equal(gitPath('"'), '"');
	assert.equal(gitPath('"half'), '"half');

	// With git itself, quoting as it does by default whatever this machine's configuration says.
	const { root, write } = fixture(t);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const git = (args) =>
		execFileSync(
			'git',
			[
				'-c',
				'user.name=F',
				'-c',
				'user.email=f@example.invalid',
				'-c',
				'core.quotepath=true',
				...args,
			],
			{
				cwd: root,
				encoding: 'utf8',
				env,
				stdio: ['ignore', 'pipe', 'ignore'],
			}
		);
	git(['init', '-b', 'main']);
	git(['add', '.']);
	git(['commit', '-m', 'base']);
	const base = git(['rev-parse', 'HEAD']).trim();
	write('packages/core/tests/café.ts', 'export {};');
	git(['add', '.']);
	git(['commit', '-m', 'queued (#1)']);
	assert.match(git(['diff', '--name-only', base]), /^"packages\/core\/tests\/caf\\303\\251\.ts"$/m);
	write('docs/日本.md', 'untracked');
	const scope = resolveScope({ root, bases: [base], git });
	assert.deepEqual(scope.files, ['docs/日本.md', 'packages/core/tests/café.ts']);
	assert.deepEqual(scope.changed, ['@x/core']);
	const trigger = (paths) => workflowTrigger(scope, { paths, gates: new Map() }).run;
	assert.equal(trigger(['packages/core/**']), true);
	assert.equal(trigger(['packages/server/**']), false);
});

test('`**/` matches no directory as well as many, and a list survives a blank line', () => {
	for (const [filter, file, expected] of [
		['docs/**/*.md', 'docs/guide.md', true],
		['docs/**/*.md', 'docs/a/b/guide.md', true],
		['docs/**/*.md', 'docs/guide.txt', false],
		['docs/**/*.md', 'other/docs/guide.md', false],
		['**/README.md', 'README.md', true],
		['**/README.md', 'packages/core/README.md', true],
		['**/README.md', 'packages/core/NOTREADME.md', false],
		['docs/**', 'docs/a/b.md', true],
		['docs/**', 'docs', false],
		['scripts/release*/**', 'scripts/release/claim.mjs', true],
		['a**/b', 'ax/y/b', true],
	])
		assert.equal(matchesFilters([filter], file), expected, `${filter} against ${file}`);

	const block = `on:
  pull_request:
    branches: [main]
    paths:
      - 'a/**'

      # the rest
      - 'docs/**'
  workflow_dispatch:
jobs:
  a:
    runs-on: x
`;
	assert.deepEqual(readTrigger(block).paths, ['a/**', 'docs/**']);
	// The list ends where the trigger does, not at the next list in the file.
	assert.deepEqual(
		readTrigger(
			block.replace('  workflow_dispatch:\n', "\n  push:\n    paths:\n      - 'other/**'\n")
		).paths,
		['a/**', 'docs/**']
	);
});

test('stepExecution launches Windows bash steps directly via resolved non-WSL bash (#2171)', () => {
	const script = 'bash endpoints/umbel/tests/scripts/external-clients.sh';
	assert.deepEqual(stepExecution(script, { platform: 'linux' }), {
		kind: 'shell',
		command: script,
	});
	assert.deepEqual(
		stepExecution('pnpm test', {
			platform: 'win32',
			bash: () => {
				throw new Error('should not resolve bash for non-bash steps');
			},
		}),
		{ kind: 'shell', command: 'pnpm test' }
	);
	assert.deepEqual(
		stepExecution('bashful --check', {
			platform: 'win32',
			bash: () => {
				throw new Error('should not match prefix of another command');
			},
		}),
		{ kind: 'shell', command: 'bashful --check' }
	);
	// Simple `bash <script>` launches bash.exe directly via execFileSync (never through cmd.exe),
	// so spaces and cmd.exe metacharacters (`&`, `$`) in the resolved path are safe.
	for (const resolved of [
		'Program Files\\Git\\bin\\bash.exe',
		'Git\\bin\\bash.exe',
		'tools\\$&\\bash.exe',
	]) {
		assert.deepEqual(
			stepExecution(script, {
				platform: 'win32',
				bash: () => resolved,
			}),
			{
				kind: 'execFile',
				file: resolved,
				args: ['endpoints/umbel/tests/scripts/external-clients.sh'],
			}
		);
	}
	// Compound shell lines quote the resolved executable for cmd.exe and avoid `$&` replacement.
	assert.deepEqual(
		stepExecution(`${script} && echo ok`, {
			platform: 'win32',
			bash: () => 'tools\\$&\\bash.exe',
		}),
		{
			kind: 'shell',
			command: '"tools\\$&\\bash.exe" endpoints/umbel/tests/scripts/external-clients.sh && echo ok',
		}
	);
	assert.throws(
		() =>
			stepExecution(`${script} && echo ok`, {
				platform: 'win32',
				bash: () => 'tools\\%TEMP%\\bash.exe',
			}),
		/Refusing to pass/
	);
});

test('loam-plugins.yml violet gate opens on transitive workspace dependency changes and declares specimen tools', () => {
	const repoRoot = dirname(import.meta.dirname);
	const suite = SUITES.find((entry) => entry.workflow === 'loam-plugins.yml');
	assert.ok(suite, 'loam-plugins.yml suite exists');
	const trigger = readSuiteTrigger(repoRoot, suite);
	assert.ok(trigger, 'loam-plugins.yml has pull_request trigger');

	for (const depFile of ['packages/local-db/src/index.ts', 'packages/auth/src/index.ts']) {
		const scope = resolveScope({ root: repoRoot, files: [depFile], git: () => '' });
		assert.equal(workflowTrigger(scope, trigger).run, true, `${depFile} triggers loam-plugins.yml`);
		const plan = planSuites(scope, { root: repoRoot, suites: [suite] });
		assert.ok(
			plan.some((entry) => entry.step.gate === 'violet'),
			`${depFile} opens violet gate`
		);
		assert.equal(
			plan.some((entry) => entry.step.gate === 'mail'),
			false,
			`${depFile} does not open mail gate`
		);
		const specimenStep = plan.find((entry) => entry.step.run.includes('test:specimen'));
		assert.ok(specimenStep, 'violet plan includes test:specimen');
		assert.deepEqual(specimenStep.step.tools, ['cargo', 'chromium']);
		const nonSpecimen = plan.filter((entry) => !entry.step.run.includes('test:specimen'));
		assert.deepEqual(
			[...plannedTools(nonSpecimen).keys()],
			[],
			`non-specimen violet steps for ${depFile} need no cargo or chromium`
		);
		assert.deepEqual(
			[...plannedTools(plan).keys()].sort(),
			['cargo', 'chromium'],
			`full violet plan for ${depFile} declares cargo and chromium for Specimen`
		);
	}

	const docsOnly = resolveScope({
		root: repoRoot,
		files: ['endpoints/loam/plugins/violet/docs/spec.md'],
		git: () => '',
	});
	assert.deepEqual(planSuites(docsOnly, { root: repoRoot, suites: [suite] }), []);
});

test('loam-desktop.yml runs on mail engine, mail mount, mail app and packages/rust changes (#1997, P5-A9)', () => {
	const root = join(import.meta.dirname, '..');
	const workflow = readFileSync(join(root, '.github/workflows/loam-desktop.yml'), 'utf8');
	const { paths, gates } = readTrigger(workflow);
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const desktopGate = (files) =>
		gate(scope(files), parseArgs(['gate', ...gates.get('run')], {})).run;

	for (const file of [
		'endpoints/loam/plugins/mail/engine/src/lib.rs',
		'endpoints/loam/plugins/mail/mount/loam-app.toml',
		'endpoints/loam/plugins/mail/app/src/reply.ts',
		'packages/rust/src/lib.rs',
	]) {
		assert.equal(
			workflowTrigger(scope([file]), { paths, gates }).run,
			true,
			`loam-desktop.yml trigger should match ${file}`
		);
		assert.equal(desktopGate([file]), true, `loam-desktop.yml scope gate should run for ${file}`);
	}
	for (const file of [
		'endpoints/loam/plugins/mail/docs/plugin.spec.md',
		'endpoints/loam/plugins/other/src/index.ts',
	]) {
		assert.equal(
			workflowTrigger(scope([file]), { paths, gates }).run,
			false,
			`loam-desktop.yml trigger should skip ${file}`
		);
		assert.equal(desktopGate([file]), false, `loam-desktop.yml scope gate should skip ${file}`);
	}
});

test("loam-desktop.yml runs on the slice's scenario files, p4-base's calls and afd-testing, which its runner reads (P5-A1)", () => {
	const root = join(import.meta.dirname, '..');
	const workflow = readFileSync(join(root, '.github/workflows/loam-desktop.yml'), 'utf8');
	const { paths, gates } = readTrigger(workflow);
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const desktopGate = (files) =>
		gate(scope(files), parseArgs(['gate', ...gates.get('run')], {})).run;

	for (const file of [
		'endpoints/loam/docs/phases/5-copilot/scenarios/stop-the-copilot.scenario.yaml',
		'endpoints/loam/docs/phases/4-settings/scenarios/p4-base.seed.json',
		'endpoints/loam/packages/kernel/scenarios/runner.ts',
		'packages/testing/src/index.ts',
	]) {
		assert.equal(
			workflowTrigger(scope([file]), { paths, gates }).run,
			true,
			`loam-desktop.yml trigger should match ${file}`
		);
		assert.equal(desktopGate([file]), true, `loam-desktop.yml scope gate should run for ${file}`);
	}
	// The rest of the specification's folder is prose no suite reads.
	for (const file of ['endpoints/loam/docs/phases/5-copilot/spec.md']) {
		assert.equal(
			workflowTrigger(scope([file]), { paths, gates }).run,
			false,
			`loam-desktop.yml trigger should skip ${file}`
		);
	}
});

test("loam.yml runs the web host's units on the decision log, which ceiling-raises reads, and on no other Loam doc (#2926)", () => {
	const root = join(import.meta.dirname, '..');
	const { paths, gates } = readTrigger(
		readFileSync(join(root, '.github/workflows/loam.yml'), 'utf8')
	);
	const scope = (files) => resolveScope({ root, files, git: () => '' });
	const decisions = scope(['endpoints/loam/docs/decisions.md']);
	assert.deepEqual(decisions.affected, ['@lushly-dev/loam-web']);
	assert.equal(workflowTrigger(decisions, { paths, gates }).run, true);
	assert.equal(gate(decisions, parseArgs(['gate', ...gates.get('run')], {})).run, true);
	for (const file of [
		'endpoints/loam/docs/STATUS.md',
		'endpoints/loam/docs/phases/5-copilot/spec.md',
	]) {
		assert.deepEqual(scope([file]).affected, [], `scope of ${file}`);
		assert.equal(workflowTrigger(scope([file]), { paths, gates }).run, false, `trigger: ${file}`);
	}
});

test('loam.yml gates test:webkit to darwin and reports it as remote only on win32 and linux (#2366)', () => {
	const repoRoot = join(import.meta.dirname, '..');
	const suite = SUITES.find((entry) => entry.workflow === 'loam.yml');
	assert.ok(suite, 'loam.yml suite exists');
	const webkitStep = suite.steps.find((step) => step.run.includes('test:webkit'));
	assert.ok(webkitStep, 'loam.yml has a test:webkit step');
	assert.equal(webkitStep.platform, 'darwin');

	const scope = resolveScope({
		root: repoRoot,
		files: ['endpoints/loam/packages/chrome/src/elements/styles.ts'],
		git: () => '',
	});
	const runsOn = (platform) =>
		planSuites(scope, { root: repoRoot, suites: [suite], platform }).map((entry) => entry.step.run);

	assert.ok(
		runsOn('darwin').some((run) => run.includes('test:webkit')),
		'darwin runs test:webkit'
	);
	assert.equal(suiteRemoteOnly(suite, 'darwin'), '');

	for (const platform of ['win32', 'linux']) {
		assert.equal(
			runsOn(platform).some((run) => run.includes('test:webkit')),
			false,
			`${platform} skips test:webkit`
		);
		assert.ok(
			runsOn(platform).some((run) => run.includes('test:firefox')),
			`${platform} still runs test:firefox`
		);
		assert.match(suiteRemoteOnly(suite, platform), /test:webkit \(darwin only\)/);
	}
});

test('stepExecution expands cargo fmt --all --check per crate on Windows (#1636)', () => {
	const crates = ['umbel', 'umbel-sdk', 'umbel-store'];
	const win = stepExecution('cargo fmt --all --check', {
		platform: 'win32',
		cwd: '/fake/umbel',
		workspaceCrates: (dir) => {
			assert.equal(dir, '/fake/umbel');
			return crates;
		},
	});
	assert.deepEqual(win, {
		kind: 'execFiles',
		commands: [
			{ file: 'cargo', args: ['fmt', '-p', 'umbel', '--check'] },
			{ file: 'cargo', args: ['fmt', '-p', 'umbel-sdk', '--check'] },
			{ file: 'cargo', args: ['fmt', '-p', 'umbel-store', '--check'] },
		],
	});
	// Non-Windows keeps the single workspace invocation.
	assert.deepEqual(
		stepExecution('cargo fmt --all --check', {
			platform: 'linux',
			workspaceCrates: () => {
				throw new Error('should not query metadata on linux');
			},
		}),
		{ kind: 'shell', command: 'cargo fmt --all --check' }
	);
	// Single-crate cargo fmt --check is untouched on Windows.
	assert.deepEqual(
		stepExecution('cargo fmt --check', {
			platform: 'win32',
			workspaceCrates: () => {
				throw new Error('should not query metadata without --all');
			},
		}),
		{ kind: 'shell', command: 'cargo fmt --check' }
	);
	// Empty workspace metadata fails loudly rather than silently passing.
	assert.throws(
		() =>
			stepExecution('cargo fmt --all --check', {
				platform: 'win32',
				cwd: '/fake/empty',
				workspaceCrates: () => [],
			}),
		/no workspace crates/
	);
});

test('preflightRustVerify sweeps first, then refuses Rust steps below AFD_VERIFY_MIN_DISK_GB (#2241)', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'afd-verify-disk-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const plan = [
		{
			suite: { workflow: 'umbel.yml', tools: ['cargo'] },
			step: { cwd: 'endpoints/umbel', run: 'cargo test --no-fail-fast --locked' },
		},
	];
	const order = [];
	const streamed = [];
	const stat = (gb) => ({ bavail: Math.round((gb * 1024 ** 3) / 4096), bsize: 4096 });

	assert.throws(
		() =>
			preflightRustVerify(plan, {
				root,
				env: { AFD_VERIFY_MIN_DISK_GB: '15' },
				homeDir: null,
				onMessage: (line) => {
					order.push('message');
					streamed.push(line);
				},
				runSweep: () => {
					order.push('sweep');
					return ['freed 1.0 GB'];
				},
				statfs: () => {
					order.push('statfs');
					return stat(4.5);
				},
			}),
		/refusing to start Rust verify steps[\s\S]*4\.5 GiB free \(floor 15 GiB\)/
	);
	assert.deepEqual(order, ['sweep', 'message', 'statfs']);
	assert.deepEqual(streamed, ['[verify] rust-sweep: freed 1.0 GB']);

	// When the sweep recovers enough free space, preflight passes and reports the sweep line.
	let freeGb = 4.5;
	const lines = preflightRustVerify(plan, {
		root,
		env: { AFD_VERIFY_MIN_DISK_GB: '15' },
		homeDir: null,
		runSweep: () => {
			freeGb = 25;
			return ['freed 20.5 GB'];
		},
		statfs: () => stat(freeGb),
	});
	assert.deepEqual(lines, ['[verify] rust-sweep: freed 20.5 GB']);

	// Non-cargo plans and TS-only steps inside cargo-bearing workflows skip both sweep and disk floor.
	const nonCargo = [
		{ suite: { workflow: 'python.yml', tools: ['uv'] }, step: { run: 'uv run pytest' } },
		{
			suite: { workflow: 'loam.yml', tools: ['cargo'] },
			step: { cwd: 'endpoints/loam', run: 'pnpm -F @lushly-dev/loam-web typecheck:hosted' },
		},
	];
	assert.deepEqual(
		preflightRustVerify(nonCargo, {
			root,
			env: {},
			homeDir: null,
			runSweep: () => {
				throw new Error('should not sweep');
			},
			statfs: () => {
				throw new Error('should not check disk');
			},
		}),
		[]
	);
});

test('scripts/affected.mjs and its local imports use only node: built-ins so queue.yml runs without node_modules', () => {
	const stripJsComments = (source) => {
		let out = '';
		let i = 0;
		while (i < source.length) {
			const ch = source[i];
			const next = source[i + 1];
			if (ch === "'" || ch === '"' || ch === '`') {
				const quote = ch;
				out += ch;
				i += 1;
				while (i < source.length) {
					if (source[i] === '\\') {
						out += source.slice(i, i + 2);
						i += 2;
						continue;
					}
					out += source[i];
					if (source[i] === quote) {
						i += 1;
						break;
					}
					i += 1;
				}
			} else if (ch === '/' && next === '/') {
				while (i < source.length && source[i] !== '\n') i += 1;
			} else if (ch === '/' && next === '*') {
				i += 2;
				while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
				i += 2;
			} else {
				out += ch;
				i += 1;
			}
		}
		return out;
	};

	const seen = new Set();
	const queue = [fileURLToPath(new URL('./affected.mjs', import.meta.url))];
	const external = [];
	const specifiers = [
		/\b(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
		/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	];

	while (queue.length > 0) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		const text = stripJsComments(readFileSync(file, 'utf8'));
		for (const re of specifiers) {
			for (const match of text.matchAll(re)) {
				const spec = match[1];
				if (spec.startsWith('node:')) continue;
				if (spec.startsWith('./') || spec.startsWith('../')) {
					queue.push(resolve(dirname(file), spec));
				} else {
					external.push(`${file}: ${spec}`);
				}
			}
		}
	}
	assert.deepEqual(external, []);
});
