import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseWorkflow } from './ci/parse-workflow.mjs';
import { resolveWorkflowPaths, WORKFLOW_GRAPH } from './ci/workflow-graph.mjs';
import { rewriteWorkflowPaths, syncCi } from './sync-ci.mjs';

const repoRoot = join(import.meta.dirname, '..');

test('parseWorkflow extracts triggers, paths, jobs, timeouts, working directories and gates', () => {
	const wf = parseWorkflow(`name: Sample
on:
  push:
    branches: [main]
    paths:
      - 'a/**'
      - '!a/docs/**'
  pull_request:
    branches: [main]
    paths: ['a/**', '!a/docs/**']
  schedule:
    - cron: '0 6 * * *'
jobs:
  queue:
    uses: ./.github/workflows/queue.yml
    with:
      workflow: sample.yml
  scope:
    timeout-minutes: 5
    needs: queue
    if: needs.queue.outputs.run == 'true'
    steps:
      - id: run
        run: node scripts/affected.mjs gate --path a/ --except a/docs/
  check:
    timeout-minutes: 20
    needs: [scope]
    defaults:
      run:
        working-directory: packages/a
    steps:
      - name: Test
        run: |
          cargo fmt --check
          cargo test --locked
`);
	assert.equal(wf.name, 'Sample');
	assert.deepEqual(wf.triggers.push.paths, ['a/**', '!a/docs/**']);
	assert.deepEqual(wf.triggers.pull_request.paths, ['a/**', '!a/docs/**']);
	assert.ok(wf.triggers.schedule);
	assert.equal(wf.jobs.queue.uses, './.github/workflows/queue.yml');
	assert.equal(wf.jobs.scope.timeoutMinutes, 5);
	assert.equal(wf.jobs.check.timeoutMinutes, 20);
	assert.equal(wf.jobs.check.defaultWorkingDirectory, 'packages/a');
	assert.deepEqual(wf.gates.get('run'), ['--path', 'a/', '--except', 'a/docs/']);
	assert.equal(wf.jobs.check.steps[0].run, 'cargo fmt --check\ncargo test --locked');
});

test('resolveWorkflowPaths includes own workflow, queue.yml, and setup action when enabled', () => {
	const rustPaths = resolveWorkflowPaths('rust.yml');
	assert.ok(rustPaths.includes('.github/workflows/rust.yml'));
	assert.ok(rustPaths.includes('.github/workflows/queue.yml'));
	assert.ok(!rustPaths.includes('.github/actions/setup-node-pnpm/**'));

	const loamPaths = resolveWorkflowPaths('loam.yml');
	assert.ok(loamPaths.includes('.github/workflows/loam.yml'));
	assert.ok(loamPaths.includes('.github/workflows/queue.yml'));
	assert.ok(loamPaths.includes('.github/actions/setup-node-pnpm/**'));
	// Negation order must be preserved after its parent glob.
	assert.ok(loamPaths.indexOf('endpoints/loam/**') < loamPaths.indexOf('!endpoints/loam/docs/**'));
	assert.ok(
		loamPaths.indexOf('!endpoints/loam/docs/**') <
			loamPaths.indexOf('endpoints/loam/docs/phases/*/scenarios/**')
	);
});

test('rewriteWorkflowPaths replaces push and pull_request paths without altering jobs', () => {
	const before = `name: Demo
on:
  push:
    branches: [main]
    paths:
      - 'old/**'
  merge_group:
  pull_request:
    branches: [main]
    paths:
      - 'old/**'
jobs:
  check:
    runs-on: ubuntu-latest
`;
	const after = rewriteWorkflowPaths(before, ['new/**', '.github/workflows/demo.yml']);
	const parsed = parseWorkflow(after);
	assert.deepEqual(parsed.triggers.push.paths, ['new/**', '.github/workflows/demo.yml']);
	assert.deepEqual(parsed.triggers.pull_request.paths, ['new/**', '.github/workflows/demo.yml']);
	assert.ok(after.includes('  merge_group:\n'));
	assert.ok(after.includes('jobs:\n  check:\n'));

	// Inline YAML comments on trigger or paths lines do not duplicate old paths.
	const commented = `name: Demo\non:\n  push: # main\n    paths: # inputs\n      - 'old/**'\n  pull_request:\n    paths: # pr\n      - 'old/**'\njobs:\n  check:\n    runs-on: ubuntu-latest\n`;
	const rewritten = rewriteWorkflowPaths(commented, ['new/**']);
	assert.equal(rewriteWorkflowPaths(rewritten, ['new/**']), rewritten);
	assert.deepEqual(parseWorkflow(rewritten).triggers.push.paths, ['new/**']);
});

test('every gated workflow using setup-node-pnpm names the setup action in its scope gates', () => {
	for (const [file, spec] of Object.entries(WORKFLOW_GRAPH)) {
		const wf = parseWorkflow(readFileSync(join(repoRoot, '.github/workflows', file), 'utf8'));
		const callsSetupAction = Object.values(wf.jobs).some((job) =>
			job.steps.some((step) => step.uses === './.github/actions/setup-node-pnpm')
		);
		assert.equal(
			Boolean(spec.usesSetupAction),
			callsSetupAction,
			`${file}: WORKFLOW_GRAPH.usesSetupAction must match whether the workflow calls setup-node-pnpm`
		);
		if (!spec.usesSetupAction || wf.gates.size === 0) continue;
		for (const [gateId, args] of wf.gates) {
			const gateRef = new RegExp(`\\bneeds\\.scope\\.outputs\\.${gateId}\\b`);
			const gatedUsesSetup = Object.values(wf.jobs).some(
				(job) =>
					job.if &&
					gateRef.test(job.if) &&
					job.steps.some((step) => step.uses === './.github/actions/setup-node-pnpm')
			);
			if (!gatedUsesSetup) continue;
			assert.ok(
				args.includes('.github/actions/setup-node-pnpm/'),
				`${file}: gate "${gateId}" is missing --path .github/actions/setup-node-pnpm/`
			);
		}
	}
});

test('repository workflows and generated suites are in sync with workflow-graph.mjs', () => {
	const result = syncCi(repoRoot, { write: false });
	assert.deepEqual(result.drifted, []);
	assert.equal(result.workflows, Object.keys(WORKFLOW_GRAPH).length);
	assert.equal(result.suites, Object.keys(WORKFLOW_GRAPH).length);
});

test('syncCi detects workflow path drift and suites.generated.mjs drift and repairs both with --write', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'afd-sync-ci-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, '.github'), { recursive: true });
	mkdirSync(join(dir, 'scripts/affected'), { recursive: true });
	cpSync(join(repoRoot, '.github/workflows'), join(dir, '.github/workflows'), { recursive: true });
	cpSync(
		join(repoRoot, 'scripts/affected/suites.generated.mjs'),
		join(dir, 'scripts/affected/suites.generated.mjs')
	);

	// Plant drift in one workflow path filter and in suites.generated.mjs.
	const rustPath = join(dir, '.github/workflows/rust.yml');
	const rustOrig = readFileSync(rustPath, 'utf8');
	writeFileSync(rustPath, rustOrig.replace("      - '.cargo/config.toml'\n", ''), 'utf8');

	const suitesPath = join(dir, 'scripts/affected/suites.generated.mjs');
	writeFileSync(suitesPath, `${readFileSync(suitesPath, 'utf8')}\n// drifted\n`, 'utf8');

	const check = syncCi(dir, { write: false });
	assert.deepEqual(check.drifted, [
		'.github/workflows/rust.yml',
		'scripts/affected/suites.generated.mjs',
	]);

	const fixed = syncCi(dir, { write: true });
	assert.deepEqual(fixed.drifted, [
		'.github/workflows/rust.yml',
		'scripts/affected/suites.generated.mjs',
	]);
	assert.deepEqual(syncCi(dir, { write: false }).drifted, []);

	// Removing push.paths completely is rejected instead of passing silently.
	const rustNoPushPaths = readFileSync(rustPath, 'utf8').replace(
		/ {2}push:\r?\n {4}branches: \[main\]\r?\n {4}paths:\r?\n(?: {6}- .+\r?\n)+/,
		'  push:\n    branches: [main]\n'
	);
	writeFileSync(rustPath, rustNoPushPaths, 'utf8');
	assert.throws(
		() => syncCi(dir, { write: false }),
		/missing or unreadable push\/pull_request paths/
	);
	writeFileSync(rustPath, rustOrig, 'utf8');

	// Changing a C++ workflow ctest flag causes suites.generated.mjs drift.
	const cppPath = join(dir, '.github/workflows/cpp.yml');
	const cppOrig = readFileSync(cppPath, 'utf8');
	writeFileSync(
		cppPath,
		cppOrig.replace(
			'run: ctest --preset ${{ matrix.preset }}',
			'run: ctest --preset ${{ matrix.preset }} --timeout 120'
		),
		'utf8'
	);
	assert.deepEqual(syncCi(dir, { write: false }).drifted, [
		'scripts/affected/suites.generated.mjs',
	]);
});
