import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readTrigger } from './affected/suites.mjs';
import { hasMergeGroup } from './ci-verdict.mjs';
import {
	AFD_BASE,
	AFD_SCOPE,
	GATE,
	mergeGroupProblems,
	queueJob,
	readWorkflow,
	readWorkflows,
} from './merge-group-contract.mjs';

const root = join(import.meta.dirname, '..');

/** A path-filtered workflow that holds the contract: a scope job behind `queue`, a suite behind it. */
const filtered = (file = 'unit.yml') => `name: Unit

on:
  push:
    branches: [main]
    paths: ['unit/**']
  # The merge queue.
  merge_group:
  pull_request:
    branches: [main]
    paths:
      - 'unit/**'
  workflow_dispatch:

concurrency:
  group: \${{ github.workflow }}-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
${queueJob(file)}

  scope:
    name: Affected units
    needs: queue
    if: ${GATE}
    runs-on: ubuntu-latest
    env:
      ${AFD_BASE}
      ${AFD_SCOPE}
    steps:
      - id: run
        run: node scripts/affected.mjs gate --path unit/

  suite:
    needs: scope
    if: needs.scope.outputs.run == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: make test

  nightly:
    needs: queue
    if: ${GATE} && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')
    runs-on: ubuntu-latest
    steps:
      - run: make slow
`;

/** A workflow with no path filter, as ci.yml is. */
const unfiltered = `on:
  pull_request:
    branches: [main]
  merge_group:

concurrency:
  group: \${{ github.workflow }}-\${{ github.event.pull_request.number || github.sha }}

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: make check
`;

const problems = (text, file = 'unit.yml') => mergeGroupProblems({ [file]: text });
/** Replaces exactly one occurrence, so a fixture that stops matching fails its test. */
const edit = (text, from, to) => {
	assert.equal(text.split(from).length - 1, 1, `the fixture has one "${from}"`);
	return text.replace(from, to);
};

describe('the merge-group contract', () => {
	it('holds for a gated path-filtered workflow, an unfiltered one and one pull requests never start', () => {
		assert.deepEqual(problems(filtered()), []);
		assert.deepEqual(problems(unfiltered, 'ci.yml'), []);
		assert.deepEqual(
			problems('on:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: x\n', 'release.yml'),
			[]
		);
		// A pull request into another branch is not what the queue for main merges.
		assert.deepEqual(
			problems('on:\n  pull_request:\n    branches: [next]\njobs:\n  a:\n    runs-on: x\n'),
			[]
		);
	});

	it('names a pull-request workflow without the trigger, and the trigger without pull requests', () => {
		assert.deepEqual(problems(edit(unfiltered, '  merge_group:\n', '')), [
			'unit.yml: runs on pull requests to main but has no merge_group trigger, so a merge queue would not run it',
		]);
		// No `branches` means every branch, main included; a block list does too.
		const everyBranch = 'on:\n  pull_request:\njobs:\n  a:\n    runs-on: x\n';
		assert.match(problems(everyBranch)[0], /has no merge_group trigger/);
		const listed =
			'on:\n  pull_request:\n    branches:\n      - next\n      - main\njobs:\n  a:\n    runs-on: x\n';
		assert.match(problems(listed)[0], /has no merge_group trigger/);
		assert.deepEqual(
			problems(edit(unfiltered, '  pull_request:\n    branches: [main]\n', '  push:\n')),
			[
				'unit.yml: has the merge_group trigger without a pull_request trigger on main to take its paths from',
			]
		);
		assert.match(
			problems(edit(unfiltered, 'branches: [main]', 'branches: [next]'))[0],
			/without a pull_request trigger on main/
		);
		assert.match(
			problems(edit(unfiltered, '  merge_group:\n', '  merge_group:\n    branches: [next]\n'))[0],
			/filters merge_group by branch/
		);
	});

	it('names a path-filtered workflow whose queue job is missing, altered, misnamed or not first', () => {
		const missing = edit(filtered(), `${queueJob('unit.yml')}\n\n`, '');
		assert.ok(
			problems(missing).includes(
				'unit.yml: its `queue` job is missing or differs from the one scripts/merge-group-contract.mjs gives'
			)
		);
		// Another workflow's file name would read another workflow's paths.
		assert.match(problems(filtered('other.yml'))[0], /`queue` job is missing or differs/);
		// The job must run on every event: skipped, it would skip what needs it.
		const conditional = edit(
			filtered(),
			'    name: Merge queue paths\n',
			"    name: Merge queue paths\n    if: github.event_name == 'merge_group'\n"
		);
		assert.match(problems(conditional)[0], /`queue` job is missing or differs/);
		const moved = filtered().replace(`${queueJob('unit.yml')}\n\n`, '');
		assert.deepEqual(problems(`${moved}\n${queueJob('unit.yml')}\n`), [
			'unit.yml: `queue` is not its first job',
		]);
	});

	it('names each job that would run for every merge group', () => {
		const ungated = (text) =>
			problems(text).map((problem) => /job (\S+) runs for every merge group/.exec(problem)?.[1]);
		// A root job with no needs at all.
		assert.deepEqual(
			ungated(
				edit(filtered(), `    name: Affected units\n    needs: queue\n    if: ${GATE}\n`, '')
			),
			['scope', 'suite']
		);
		// It needs queue but does not read its answer.
		assert.deepEqual(
			ungated(
				edit(
					filtered(),
					`    needs: queue\n    if: ${GATE}\n    runs-on`,
					'    needs: queue\n    runs-on'
				)
			),
			['scope', 'suite']
		);
		// The gate beside an `or` is no gate.
		assert.deepEqual(
			ungated(
				edit(
					filtered(),
					`${GATE} && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')`,
					`${GATE} && github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'`
				)
			),
			['nightly']
		);
		assert.deepEqual(
			ungated(
				edit(filtered(), `    if: ${GATE}\n    runs-on`, `    if: ${GATE} || always()\n    runs-on`)
			),
			['scope', 'suite']
		);
		// A status function runs a job although the job it needs was skipped.
		for (const call of ['always()', '!cancelled()', 'success() || failure()'])
			assert.deepEqual(
				ungated(
					edit(
						filtered(),
						"if: needs.scope.outputs.run == 'true'",
						`if: \${{ ${call} && needs.scope.outputs.run == 'true' }}`
					)
				),
				['suite'],
				call
			);
		// Folded onto the next lines, it is read all the same.
		assert.deepEqual(
			ungated(
				edit(
					filtered(),
					"if: needs.scope.outputs.run == 'true'",
					"if: >-\n      always() &&\n      needs.scope.outputs.run == 'true'"
				)
			),
			['suite']
		);
		// A job that needs only an ungated job is ungated; one that also needs a gated job is not.
		const extra = `${filtered()}\n  loose:\n    runs-on: x\n\n  after:\n    needs: [loose]\n    runs-on: x\n\n  both:\n    needs:\n      - loose\n      - suite\n    runs-on: x\n`;
		assert.deepEqual(ungated(extra), ['loose', 'after']);
	});

	it('names an unfiltered workflow with a queue job, and a filter the queue job cannot read', () => {
		const withQueue = edit(unfiltered, 'jobs:\n', `jobs:\n${queueJob('ci.yml')}\n\n`);
		assert.deepEqual(problems(withQueue, 'ci.yml'), [
			'ci.yml: has a `queue` job but no pull_request.paths for it to read',
		]);
		assert.deepEqual(
			problems(
				edit(unfiltered, 'branches: [main]\n', "branches: [main]\n    paths-ignore: ['docs/**']\n")
			),
			[
				'unit.yml: filters pull requests with paths-ignore, which the queue job cannot read: use paths',
			]
		);
	});

	it('names a concurrency group every merge group would share', () => {
		for (const group of [
			'${{ github.workflow }}-${{ github.event.pull_request.number }}',
			'${{ github.workflow }}-${{ github.ref }}',
			'verdict',
		])
			assert.deepEqual(
				problems(
					edit(
						unfiltered,
						'${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}',
						group
					)
				),
				[
					'unit.yml: its concurrency group is the same for every merge group: fall back to github.sha where there is no pull request number',
				],
				group
			);
		assert.deepEqual(
			problems(
				edit(unfiltered, 'concurrency:\n  group: ', 'concurrency: ').replace(
					'|| github.sha }}',
					'}}'
				)
			),
			[
				'unit.yml: its concurrency group is the same for every merge group: fall back to github.sha where there is no pull request number',
			]
		);
		// No concurrency at all is no collision.
		assert.deepEqual(problems(unfiltered.replace(/concurrency:\n.*\n\n/, '')), []);
	});

	it('names an AFD_BASE or AFD_SCOPE that leaves the merge group without its base', () => {
		const old =
			"AFD_BASE: ${{ github.event_name == 'pull_request' && 'HEAD^1' || github.event.before }}";
		assert.deepEqual(problems(filtered().replaceAll(AFD_BASE, old)), [
			'unit.yml: its `queue` job is missing or differs from the one scripts/merge-group-contract.mjs gives',
			`unit.yml: AFD_BASE is not \`${AFD_BASE}\``,
			`unit.yml: AFD_BASE is not \`${AFD_BASE}\``,
		]);
		assert.deepEqual(
			problems(
				edit(filtered(), " || github.event_name == 'merge_group') && 'affected'", ") && 'affected'")
			),
			[`unit.yml: AFD_SCOPE is not \`${AFD_SCOPE}\``]
		);
	});

	it('reports a workflow it cannot read instead of passing it', () => {
		assert.deepEqual(problems('on: [push, pull_request]\njobs:\n  a:\n    runs-on: x\n'), [
			'unit.yml: unreadable (`on:` is not a block of triggers)',
		]);
		assert.deepEqual(problems('on:\n  pull_request:\n'), ['unit.yml: unreadable (no jobs)']);
		assert.throws(() => readWorkflow('name: x\n'), /`on:` is not a block/);
	});
});

describe("this repository's workflows", () => {
	const workflows = readWorkflows(root);
	const names = Object.keys(workflows);

	it('hold the contract', () => {
		assert.deepEqual(mergeGroupProblems(workflows), []);
	});

	it('are the ones expected: the population has not emptied', () => {
		assert.ok(names.length >= 26, `${names.length} workflows read`);
		const queued = names.filter((file) =>
			readWorkflow(workflows[file]).triggers.has('merge_group')
		);
		const gatedOnes = queued.filter((file) => readWorkflow(workflows[file]).jobs.has('queue'));
		assert.ok(queued.length >= 20, `${queued.length} workflows have merge_group`);
		assert.ok(gatedOnes.length >= 18, `${gatedOnes.length} workflows have the queue job`);
		assert.deepEqual(
			queued.filter((file) => !gatedOnes.includes(file)),
			['ci-ok.yml', 'ci.yml']
		);
		// Every gated job is found: a parse that saw no jobs would pass everything.
		for (const file of gatedOnes)
			assert.ok(readWorkflow(workflows[file]).jobs.size >= 2, `${file} has a job behind queue`);
	});

	it('agree with the two other readers of a workflow, in both directions', () => {
		for (const file of names) {
			const { triggers } = readWorkflow(workflows[file]);
			// scripts/ci-verdict.mjs expects a merge-group run of exactly these workflows.
			assert.equal(hasMergeGroup(workflows[file]), triggers.has('merge_group'), file);
			// scripts/affected.mjs trigger reads paths with readTrigger, as `pnpm verify` does.
			const trigger = readTrigger(workflows[file]);
			assert.equal(trigger !== null, triggers.has('pull_request'), file);
			if (trigger) {
				const { jobs } = readWorkflow(workflows[file]);
				assert.equal(trigger.paths !== null, jobs.has('queue'), file);
				if (trigger.paths) assert.ok(trigger.paths.length > 0, file);
			}
		}
	});

	it('name themselves in the queue job, and as a path, so an edit to one runs it in the queue', () => {
		for (const file of names) {
			const { jobs } = readWorkflow(workflows[file]);
			if (!jobs.has('queue')) continue;
			assert.ok(jobs.get('queue').block.includes(`affected.mjs trigger ${file}\n`), file);
			assert.ok(readTrigger(workflows[file]).paths.includes(`.github/workflows/${file}`), file);
		}
	});
});
