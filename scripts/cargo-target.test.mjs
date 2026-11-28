import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { SUITES } from './affected/suites.generated.mjs';
import {
	cargoOutputDirs,
	checkRustDiskFloor,
	DEFAULT_VERIFY_MIN_DISK_GB,
	formatRustDiskFloorError,
	loamUmbelTargetDir,
	parseCargoConfigToml,
	resolveCargoBuildDir,
	resolveCargoTargetDir,
	resolveVerifyMinDiskGb,
	rustOutputDirsForPlan,
} from './cargo-target.mjs';

function scratch(t) {
	const root = mkdtempSync(join(tmpdir(), 'cargo-target-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

const GIB = 1024 ** 3;
const fakeStatfs = (gb) => ({ bavail: Math.round((gb * GIB) / 4096), bsize: 4096 });

test('resolveCargoTargetDir follows Cargo precedence: env, nearest config, CARGO_HOME, default', (t) => {
	const root = scratch(t);
	const ws = join(root, 'repo', 'endpoints', 'umbel');
	const home = join(root, 'cargo-home');
	mkdirSync(ws, { recursive: true });
	mkdirSync(home, { recursive: true });

	// Default: <workspace>/target.
	assert.equal(
		resolveCargoTargetDir(ws, { env: {}, homeDir: null, ceiling: root }),
		join(ws, 'target')
	);

	// $CARGO_HOME/config.toml relative paths resolve against the parent of $CARGO_HOME (Cargo rule).
	writeFileSync(join(home, 'config.toml'), '[build]\ntarget-dir = "shared-target"\n');
	assert.equal(
		resolveCargoTargetDir(ws, { env: { CARGO_HOME: home }, homeDir: null, ceiling: root }),
		join(root, 'shared-target')
	);

	// Ancestor .cargo/config.toml overrides CARGO_HOME; relative path resolves against its parent.
	mkdirSync(join(root, 'repo', '.cargo'), { recursive: true });
	writeFileSync(
		join(root, 'repo', '.cargo', 'config.toml'),
		'[build]\ntarget-dir = "repo-target"\n'
	);
	assert.equal(
		resolveCargoTargetDir(ws, { env: { CARGO_HOME: home }, homeDir: null, ceiling: root }),
		join(root, 'repo', 'repo-target')
	);

	// Included .toml files apply before the file's own keys; nearer `.cargo/config` beats `config.toml`.
	mkdirSync(join(ws, '.cargo'), { recursive: true });
	writeFileSync(join(ws, '.cargo', 'base.toml'), '[build]\ntarget-dir = "from-include"\n');
	writeFileSync(join(ws, '.cargo', 'config'), 'include = ["base.toml"]\n');
	assert.equal(
		resolveCargoTargetDir(ws, { env: { CARGO_HOME: home }, homeDir: null, ceiling: root }),
		join(ws, 'from-include')
	);

	// CARGO_BUILD_TARGET_DIR overrides config files; CARGO_TARGET_DIR beats both.
	const envBuildTarget = join(root, 'env-build-target');
	const envTarget = join(root, 'env-target');
	assert.equal(
		resolveCargoTargetDir(ws, {
			env: { CARGO_HOME: home, CARGO_BUILD_TARGET_DIR: envBuildTarget },
			homeDir: null,
			ceiling: root,
		}),
		envBuildTarget
	);
	assert.equal(
		resolveCargoTargetDir(ws, {
			env: {
				CARGO_HOME: home,
				CARGO_BUILD_TARGET_DIR: envBuildTarget,
				CARGO_TARGET_DIR: envTarget,
			},
			homeDir: null,
			ceiling: root,
		}),
		envTarget
	);
});

test('resolveCargoBuildDir expands Cargo templates and cargoOutputDirs returns both dirs', (t) => {
	const root = scratch(t);
	const ws = join(root, 'work', 'endpoints', 'umbel');
	const home = join(root, 'home', '.cargo');
	const dev = join(root, 'dev', 'cargo-build');
	mkdirSync(ws, { recursive: true });
	mkdirSync(home, { recursive: true });

	assert.equal(resolveCargoBuildDir(ws, { env: {}, homeDir: null, ceiling: root }), null);

	writeFileSync(
		join(home, 'config.toml'),
		`[build]\nbuild-dir = ${JSON.stringify(join(dev, '{workspace-path-hash}'))}\n`
	);
	assert.equal(
		resolveCargoBuildDir(ws, { env: { CARGO_HOME: home }, homeDir: null, ceiling: root }),
		dev
	);
	assert.deepEqual(
		cargoOutputDirs(ws, { env: { CARGO_HOME: home }, homeDir: null, ceiling: root }),
		[join(ws, 'target'), dev]
	);

	// {cargo-cache-home} and {workspace-root} templates expand cleanly.
	assert.equal(
		resolveCargoBuildDir(ws, {
			env: {
				CARGO_HOME: home,
				CARGO_BUILD_BUILD_DIR: '{cargo-cache-home}/builds/{workspace-path-hash}',
			},
			homeDir: null,
			ceiling: root,
		}),
		join(home, 'builds')
	);
	assert.equal(
		resolveCargoBuildDir(ws, {
			env: { CARGO_BUILD_BUILD_DIR: '{workspace-root}/custom-build' },
			homeDir: null,
			ceiling: root,
		}),
		join(ws, 'custom-build')
	);
});

test('rustOutputDirsForPlan matches real launcher target rules, build-dir, cwd, and skips TS-only steps', (t) => {
	const root = scratch(t);
	const external = join(root, 'external-target');
	const loamTarget = join(root, 'loam-umbel-target');
	const buildDir = join(root, 'intermediate');

	// Real loam.yml mounted steps (including the TS build step) with LOAM_UMBEL_TARGET_DIR set:
	// only LOAM_UMBEL_TARGET_DIR is returned, never <root>/target or endpoints/umbel/target.
	const loamSuite = SUITES.find((s) => s.workflow === 'loam.yml');
	assert.ok(loamSuite);
	const mountedPlan = loamSuite.steps
		.filter((step) => step.gate === 'mounted')
		.map((step) => ({ suite: loamSuite, step }));
	assert.equal(mountedPlan.length >= 2, true);
	assert.deepEqual(
		rustOutputDirsForPlan(mountedPlan, {
			root,
			env: { LOAM_UMBEL_TARGET_DIR: loamTarget },
			homeDir: null,
			ceiling: root,
		}),
		[resolve(loamTarget)]
	);

	// With only CARGO_BUILD_TARGET_DIR set, loam's build-umbel.mjs still pins CARGO_TARGET_DIR=target
	// in endpoints/umbel, so preflight checks endpoints/umbel/target (not CARGO_BUILD_TARGET_DIR).
	assert.equal(
		loamUmbelTargetDir(join(root, 'endpoints/umbel'), { CARGO_BUILD_TARGET_DIR: external }),
		resolve(root, 'endpoints/umbel/target')
	);
	assert.deepEqual(
		rustOutputDirsForPlan(mountedPlan, {
			root,
			env: { CARGO_BUILD_TARGET_DIR: external },
			homeDir: null,
			ceiling: root,
		}),
		[resolve(root, 'endpoints/umbel/target')]
	);

	// Loam hosted-only steps (typecheck:hosted, test:hosted, etc.) invoke no Cargo.
	const hostedPlan = loamSuite.steps
		.filter((step) => step.gate === 'hosted')
		.map((step) => ({ suite: loamSuite, step }));
	assert.deepEqual(
		rustOutputDirsForPlan(hostedPlan, { root, env: {}, homeDir: null, ceiling: root }),
		[]
	);

	// Specimen pinned-target steps (test:stories and loam test:browser) include both the pinned
	// target and any Cargo build-dir for intermediate artifacts.
	const storiesPlan = [
		{
			suite: { workflow: 'specimen.yml', tools: ['chromium', 'cargo'] },
			step: { run: 'pnpm test:stories' },
		},
	];
	assert.deepEqual(
		rustOutputDirsForPlan(storiesPlan, {
			root,
			env: { CARGO_BUILD_BUILD_DIR: buildDir },
			homeDir: null,
			ceiling: root,
		}),
		[resolve(root, 'foundations/specimen/host/target'), resolve(buildDir)]
	);

	const loamBrowserPlan = [
		{
			suite: loamSuite,
			step: loamSuite.steps.find((step) => step.run.includes('test:browser')),
		},
	];
	assert.deepEqual(
		rustOutputDirsForPlan(loamBrowserPlan, {
			root,
			env: { CARGO_BUILD_BUILD_DIR: buildDir },
			homeDir: null,
			ceiling: root,
		}),
		[resolve(root, 'foundations/specimen/host/target'), resolve(buildDir)]
	);

	// Todo conformance invokes Cargo from packages/examples/todo with --manifest-path backends/rust/Cargo.toml,
	// so relative CARGO_TARGET_DIR=../cache resolves to packages/examples/cache, not todo/backends/cache.
	const todoRsPlan = [
		{
			suite: { workflow: 'conformance.yml', tools: ['cargo'] },
			step: { run: 'pnpm --dir packages/examples/todo test:conformance:rs' },
		},
	];
	assert.deepEqual(
		rustOutputDirsForPlan(todoRsPlan, {
			root,
			env: { CARGO_TARGET_DIR: '../cache' },
			homeDir: null,
			ceiling: root,
		}),
		[resolve(root, 'packages/examples/cache')]
	);
	const todoUmbelMountedPlan = [
		{
			suite: { workflow: 'umbel.yml', tools: ['cargo'] },
			step: { run: 'pnpm --filter @afd/example-todo test:conformance:umbel-mounted' },
		},
	];
	assert.deepEqual(
		rustOutputDirsForPlan(todoUmbelMountedPlan, {
			root,
			env: { CARGO_TARGET_DIR: '../cache' },
			homeDir: null,
			ceiling: root,
		}),
		[resolve(root, 'endpoints/cache'), resolve(root, 'packages/examples/cache')]
	);
});

test('checkRustDiskFloor blocks low or unreadable volumes, passes above, and honors AFD_VERIFY_MIN_DISK_GB', (t) => {
	const root = scratch(t);
	const external = join(root, 'dev', 'target');
	const plan = [
		{
			suite: { workflow: 'umbel.yml', tools: ['cargo'] },
			step: { cwd: 'endpoints/umbel', run: 'cargo test --locked' },
		},
	];

	assert.equal(resolveVerifyMinDiskGb({}), DEFAULT_VERIFY_MIN_DISK_GB);
	assert.equal(resolveVerifyMinDiskGb({ AFD_VERIFY_MIN_DISK_GB: '0' }), 0);
	assert.throws(() => resolveVerifyMinDiskGb({ AFD_VERIFY_MIN_DISK_GB: 'abc' }), /non-negative/);
	assert.throws(() => resolveVerifyMinDiskGb({ AFD_VERIFY_MIN_DISK_GB: '-5' }), /non-negative/);

	// Below default 15 GiB floor -> refused with actionable message.
	const low = checkRustDiskFloor(plan, {
		root,
		env: { CARGO_TARGET_DIR: external },
		homeDir: null,
		ceiling: root,
		statfs: () => fakeStatfs(4.2),
	});
	assert.equal(low.ok, false);
	assert.equal(low.low.length, 1);
	const message = formatRustDiskFloorError(low);
	assert.match(message, /4\.2 GiB free/);
	assert.match(message, /15 GiB/);
	assert.match(message, /botcore disk-reclaim --apply --pressure/);
	assert.match(message, /CARGO_TARGET_DIR/);

	// Unreadable required volume (statfs error) fails closed instead of silently passing.
	const unreadable = checkRustDiskFloor(plan, {
		root,
		env: { CARGO_TARGET_DIR: external },
		homeDir: null,
		ceiling: root,
		statfs: () => {
			throw new Error('EACCES');
		},
	});
	assert.equal(unreadable.ok, false);
	assert.equal(unreadable.unreadable.length, 1);
	assert.match(formatRustDiskFloorError(unreadable), /EACCES[\s\S]*AFD_VERIFY_MIN_DISK_GB=0/);

	// Above floor -> passes.
	const ok = checkRustDiskFloor(plan, {
		root,
		env: { CARGO_TARGET_DIR: external },
		homeDir: null,
		ceiling: root,
		statfs: () => fakeStatfs(25),
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.low.length, 0);

	// Floor disabled via AFD_VERIFY_MIN_DISK_GB=0 -> skips statfs entirely.
	const disabled = checkRustDiskFloor(plan, {
		root,
		env: { AFD_VERIFY_MIN_DISK_GB: '0' },
		homeDir: null,
		ceiling: root,
		statfs: () => {
			throw new Error('should not be called when disabled');
		},
	});
	assert.equal(disabled.ok, true);

	// Non-cargo plans never fail the disk floor.
	const nonCargo = checkRustDiskFloor(
		[{ suite: { workflow: 'python.yml', tools: ['uv'] }, step: { run: 'uv run pytest' } }],
		{
			root,
			env: {},
			homeDir: null,
			ceiling: root,
			statfs: () => fakeStatfs(0.1),
		}
	);
	assert.equal(nonCargo.ok, true);
});

test('parseCargoConfigToml reads Cargo include and [build] forms without third-party packages', () => {
	const parsed = parseCargoConfigToml(`\uFEFF# comment
include = [
  "base.toml",
  { path = 'extra.toml', optional = true }, # inline comment
]

[target.'cfg(target_os = "windows")']
rustflags = ["-C", "target-cpu=native"]

[build]
jobs = 8 # ignored
target-dir = 'cache\\cargo\\target' # literal string preserves backslashes
build-dir = "cache\\\\cargo\\\\build\\\\{workspace-path-hash}"
`);
	assert.deepEqual(parsed.include, ['base.toml', { path: 'extra.toml', optional: true }]);
	assert.deepEqual(parsed.build, {
		'target-dir': 'cache\\cargo\\target',
		'build-dir': 'cache\\cargo\\build\\{workspace-path-hash}',
	});

	assert.deepEqual(
		parseCargoConfigToml('build.target-dir = "dotted"\nbuild.build-dir = "dotted-build"\n'),
		{ build: { 'target-dir': 'dotted', 'build-dir': 'dotted-build' } }
	);
	assert.deepEqual(
		parseCargoConfigToml('build = { target-dir = "inline", build-dir = "inline-build" }\n'),
		{ build: { 'target-dir': 'inline', 'build-dir': 'inline-build' } }
	);

	// [[include]] array-of-tables, multiline strings with trailing quotes, multiline inline tables,
	// space-separated datetimes, and non-string bare scalars (ignored as non-strings).
	const complex = parseCargoConfigToml(`
[[include]]
path = "a.toml"
optional = true

[[include]]
path = "b.toml"

[alias]
note = """hello "world""""
raw = '''ends with two ''quotes'''''
wrapped = """foo \\
  bar"""
at = 2026-11-24 12:00:00Z
env = {
  # multiline inline table with comment
  FOO = "bar",
}

[build]
target-dir = "from-complex"
build-dir = 123
`);
	assert.deepEqual(complex.include, [{ path: 'a.toml', optional: true }, { path: 'b.toml' }]);
	assert.deepEqual(complex.build, { 'target-dir': 'from-complex', 'build-dir': null });

	// Malformed inputs throw so readConfigFile safely discards corrupt configs.
	assert.throws(() => parseCargoConfigToml('[build\ntarget-dir = "broken"\n'));
	assert.throws(() => parseCargoConfigToml('[build]\ntarget-dir = "unterminated\n'));
	assert.throws(() => parseCargoConfigToml('include = ["unterminated"\n'));
	assert.throws(() => parseCargoConfigToml('build = { target-dir = "unterminated"\n'));
	assert.throws(() => parseCargoConfigToml('[alias]\nbad = """a\\ b"""\n'));
});
