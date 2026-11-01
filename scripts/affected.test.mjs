import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { changedImporters, parseLockfile } from './affected/lockfile.mjs';
import { resolveScope } from './affected/scope.mjs';
import { matchesFilters, readSuiteTrigger, readTrigger, SUITES } from './affected/suites.mjs';
import { readWorkspace, withDependencies, withDependents } from './affected/workspace.mjs';
import { gate, parseArgs, planSuites, pnpmArgs } from './affected.mjs';
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
	const parsed = parseLockfile(lockfile());
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
	const { root } = fixture(t);
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
	// Non-workspace units, documentation and other languages select nothing.
	assert.deepEqual(scope(['packages/rust/src/lib.rs', 'docs/a.md', 'AGENTS.md']).affected, []);
	assert.equal(scope(['tsconfig.json']).mode, 'all');
	assert.equal(scope(['scripts/affected/scope.mjs']).mode, 'all');
	assert.equal(scope(['packages\\core\\a.ts']).changed[0], '@x/core');
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

test('workflow path filters are read and matched like GitHub Actions', () => {
	const filters = ['endpoints/umbel/**', '!endpoints/umbel/docs/**', 'scripts/release-*.mjs'];
	assert.equal(matchesFilters(filters, 'endpoints/umbel/src/main.rs'), true);
	assert.equal(matchesFilters(filters, 'endpoints/umbel/docs/STATUS.md'), false);
	assert.equal(matchesFilters(filters, 'scripts/release-claim.mjs'), true);
	assert.equal(matchesFilters(filters, 'scripts/release/claim.mjs'), false);
	assert.equal(matchesFilters(['.codex/skills'], '.codex/skills'), true);

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
	const workflows = readdirSync(join(root, '.github/workflows')).filter(
		(file) =>
			file !== 'ci.yml' && readTrigger(readFileSync(join(root, '.github/workflows', file), 'utf8'))
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
