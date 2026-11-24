import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-file-size.mjs');

function fixture(lines, head = '') {
	return `${head}${Array.from({ length: lines }, (_, index) => `export const value${index} = ${index};`).join('\n')}\n`;
}

function makeRoot(t) {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function runCheck(root, args = [], extraEnv = {}) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'AFD_BASE')
	);
	return spawnSync(process.execPath, [script, ...args], {
		cwd: root,
		encoding: 'utf8',
		env: { ...env, ...extraEnv },
	});
}

test('no-argument mode discovers and rejects oversized source files across TS, Rust, Python and C++', (t) => {
	const root = makeRoot(t);
	for (const rel of [
		'packages/demo/src/large.ts',
		'packages/rust/src/large.rs',
		'python/src/afd/large.py',
		'packages/cpp/src/large.cpp',
		'packages/cpp/include/large.hpp',
	]) {
		mkdirSync(join(root, dirname(rel)), { recursive: true });
		writeFileSync(join(root, rel), fixture(1501));
	}

	const result = runCheck(root);
	assert.equal(result.status, 1);
	for (const name of ['large.ts', 'large.rs', 'large.py', 'large.cpp', 'large.hpp']) {
		assert.match(result.stderr, new RegExp(name.replace('.', '\\.')));
	}
	assert.match(result.stderr, /5 file size violation/);
});

test('a file up to 1,500 lines only warns: the bloat sweep, not the commit, splits it', (t) => {
	const root = makeRoot(t);
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'busy.ts'), fixture(1500));

	const result = runCheck(root);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /busy\.ts/);
	assert.match(result.stderr, /1500 lines/);
	assert.match(result.stderr, /the sweep-bloat skill ranks it/);
});

test('authored JS files outside scripts/ are checked while *.generated.* files are skipped', (t) => {
	const root = makeRoot(t);
	mkdirSync(join(root, 'endpoints/loam/packages/web/public/sandbox'), { recursive: true });
	mkdirSync(join(root, 'scripts/affected'), { recursive: true });
	writeFileSync(join(root, 'endpoints/loam/packages/web/public/sandbox/proxy.js'), fixture(1501));
	writeFileSync(join(root, 'scripts/affected/suites.generated.mjs'), fixture(1600));

	const result = runCheck(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /proxy\.js/);
	assert.doesNotMatch(result.stderr, /suites\.generated\.mjs/);
	assert.match(result.stderr, /1 file size violation/);
});

test('discovery skips language-specific tests and generated output, and an override comment changes nothing', (t) => {
	const root = makeRoot(t);
	const files = [
		'packages/demo/src/large.test.ts',
		'packages/demo/src/_generated/types.ts',
		'packages/rust/tests/integration.rs',
		'packages/rust/src/approval/tests.rs',
		'packages/rust/src/foo_test.rs',
		'python/tests/test_big.py',
		'python/src/afd/big_test.py',
		'packages/cpp/tests/big_test.cpp',
		'packages/cpp/src/helper_test.hpp',
		'packages/demo/src/old.ts',
	];
	for (const rel of files) {
		mkdirSync(join(root, dirname(rel)), { recursive: true });
		const head = rel.endsWith('old.ts') ? '// afd-override: max-lines=1700\n' : '';
		writeFileSync(join(root, rel), fixture(1600, head));
	}

	const result = runCheck(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /old\.ts/);
	assert.doesNotMatch(
		result.stderr,
		/large\.test\.ts|types\.ts|integration\.rs|tests\.rs|foo_test\.rs|test_big\.py|big_test\.py|big_test\.cpp|helper_test\.hpp/
	);
	assert.match(result.stderr, /1 file size violation/);
});

test('a file between the thresholds warns without failing', (t) => {
	const root = makeRoot(t);
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'growing.ts'), fixture(600));

	const result = runCheck(root);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /growing\.ts/);
	assert.match(result.stderr, /Over the 500-line review threshold/);
	assert.match(result.stderr, /1 file size warning/);
});

test('explicit staged-file mode still checks only supplied paths', (t) => {
	const root = makeRoot(t);
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'large.ts'), fixture(1501));
	writeFileSync(join(source, 'small.ts'), fixture(20));

	const result = runCheck(root, [join(source, 'small.ts')]);
	assert.equal(result.status, 0);
	assert.doesNotMatch(result.stderr, /large\.ts/);
});

test('both modes check site/, spec/ and .claude/ scripts but skip the vendored site bundles and docs/', (t) => {
	const root = makeRoot(t);
	const files = {
		vendored: 'site/js/vendor/bundle.js',
		prototype: 'docs/features/demo/prototype/large.mjs',
		site: 'site/js/large.js',
		spec: 'spec/vectors/large.mjs',
		skill: '.claude/skills/demo/scripts/large.mjs',
	};
	for (const rel of Object.values(files)) {
		mkdirSync(join(root, dirname(rel)), { recursive: true });
		writeFileSync(join(root, rel), fixture(1501));
	}

	for (const rel of [files.vendored, files.prototype]) {
		const skipped = runCheck(root, [rel]);
		assert.equal(skipped.status, 0, `${rel}: ${skipped.stderr}`);
	}
	for (const rel of [files.site, files.spec, files.skill]) {
		const checked = runCheck(root, [rel]);
		assert.equal(checked.status, 1, rel);
	}
	const full = runCheck(root);
	assert.equal(full.status, 1);
	assert.match(full.stderr, /3 file size violation/);
	assert.doesNotMatch(full.stderr, /bundle\.js|prototype/);
});

test('a full scan skips nested checkouts under .claude/worktrees and the .agents/skills link', (t) => {
	const root = makeRoot(t);
	const nested = '.claude/worktrees/x/packages/demo/src/large.ts';
	mkdirSync(join(root, dirname(nested)), { recursive: true });
	writeFileSync(join(root, nested), fixture(1501));
	const skill = '.claude/skills/demo/scripts/large.mjs';
	mkdirSync(join(root, dirname(skill)), { recursive: true });
	writeFileSync(join(root, skill), fixture(1501));
	mkdirSync(join(root, '.agents'), { recursive: true });
	symlinkSync(join(root, '.claude', 'skills'), join(root, '.agents', 'skills'), 'dir');

	const full = runCheck(root);
	assert.equal(full.status, 1);
	assert.match(full.stderr, /1 file size violation/);
	assert.doesNotMatch(full.stderr, /worktrees/);
	assert.equal(runCheck(root, [nested]).status, 0);
});

test('a grandfathered entry outside the checked roots fails a full scan', (t) => {
	const root = makeRoot(t);
	mkdirSync(join(root, 'docs'), { recursive: true });
	writeFileSync(join(root, 'docs', 'big.mjs'), fixture(1600));
	mkdirSync(join(root, 'scripts', 'policy'), { recursive: true });
	writeFileSync(
		join(root, 'scripts', 'policy', 'file-size-limits.json'),
		JSON.stringify({
			warn: 500,
			limit: 1500,
			grandfathered: [{ file: 'docs/big.mjs', lines: 1600, reason: 'Outside the roots' }],
		})
	);
	const result = runCheck(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /docs\/big\.mjs/);
});

test('upstream fast-element is skipped while AFD-authored code in imported families is checked', (t) => {
	const root = makeRoot(t);
	const upstream = 'foundations/fast-af/packages/element/packages/fast-element/src/di.ts';
	const authored = [
		'foundations/fast-af/packages/violet-elements/src/grid.ts',
		'foundations/violet/packages/core/src/large.ts',
		'integrations/violet-afd/src/large.ts',
		'endpoints/violet-cli/src/large.ts',
		'foundations/specimen/src/large.ts',
		'endpoints/botcore/src/botcore/large.py',
	];
	for (const rel of [upstream, ...authored]) {
		mkdirSync(join(root, dirname(rel)), { recursive: true });
		writeFileSync(join(root, rel), fixture(1501));
	}

	const skipped = runCheck(root, [upstream]);
	assert.equal(skipped.status, 0, skipped.stderr);
	const checked = runCheck(root);
	assert.equal(checked.status, 1);
	assert.doesNotMatch(checked.stderr, /fast-element\/src\/di\.ts/);
	assert.match(checked.stderr, /6 file size violation/);
});

test('grandfathered policy allows frozen files, blocks growth, fails on recovery or deletion, and only tightens', (t) => {
	const root = makeRoot(t);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const git = (...args) =>
		execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
			cwd: root,
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	git('init', '-b', 'main');

	const policyFile = 'scripts/policy/file-size-limits.json';
	const write = (rel, text) => {
		mkdirSync(join(root, dirname(rel)), { recursive: true });
		writeFileSync(join(root, rel), text);
	};
	const policy = (entries, limit = 1500) =>
		JSON.stringify({ warn: 500, limit, grandfathered: entries }, null, '\t');

	// Baseline: one grandfathered Rust file at 1,800 lines.
	write('packages/rust/src/big.rs', fixture(1799));
	write(
		policyFile,
		policy([{ file: 'packages/rust/src/big.rs', lines: 1800, reason: 'Pre-existing' }])
	);
	git('add', '-A');
	git('commit', '-m', 'base');
	git('switch', '-c', 'work');

	// At ceiling -> pass.
	assert.equal(runCheck(root).status, 0);

	// Grows past ceiling -> fail.
	write('packages/rust/src/big.rs', fixture(1805));
	const grew = runCheck(root);
	assert.equal(grew.status, 1);
	assert.match(grew.stderr, /grew past its frozen ceiling of 1800 lines/);

	// Shrinks below 1,500 without removing grandfathered entry -> fail.
	write('packages/rust/src/big.rs', fixture(1400));
	const recovered = runCheck(root);
	assert.equal(recovered.status, 1);
	assert.match(recovered.stderr, /within the 1500-line limit\); delete its entry/);

	// Trying to add a new file to grandfathered since base -> fail.
	write('packages/rust/src/big.rs', fixture(1799));
	write('python/src/afd/new_big.py', fixture(1600));
	write(
		policyFile,
		policy([
			{ file: 'packages/rust/src/big.rs', lines: 1800, reason: 'Pre-existing' },
			{ file: 'python/src/afd/new_big.py', lines: 1601, reason: 'Attempted grandfather' },
		])
	);
	const added = runCheck(root);
	assert.equal(added.status, 1);
	assert.match(added.stderr, /was added to "grandfathered" since the merge base/);

	// Trying to raise an existing ceiling -> fail.
	rmSync(join(root, 'python/src/afd/new_big.py'));
	write('packages/rust/src/big.rs', fixture(1805));
	write(
		policyFile,
		policy([{ file: 'packages/rust/src/big.rs', lines: 1810, reason: 'Pre-existing' }])
	);
	const raised = runCheck(root);
	assert.equal(raised.status, 1);
	assert.match(raised.stderr, /grandfathered ceiling for packages\/rust\/src\/big\.rs rose/);

	// Trying to raise warn threshold -> fail.
	write('packages/rust/src/big.rs', fixture(1800));
	write(
		policyFile,
		JSON.stringify(
			{
				warn: 900,
				limit: 1500,
				grandfathered: [{ file: 'packages/rust/src/big.rs', lines: 1800, reason: 'Pre-existing' }],
			},
			null,
			'\t'
		)
	);
	const warnRaised = runCheck(root);
	assert.equal(warnRaised.status, 1);
	assert.match(warnRaised.stderr, /"warn" rose from 500 to 900/);

	// Deleting the policy file when the merge base had one -> fail.
	rmSync(join(root, policyFile));
	const deleted = runCheck(root);
	assert.equal(deleted.status, 1);
	assert.match(deleted.stderr, /policy file was removed since the merge base/);
});
