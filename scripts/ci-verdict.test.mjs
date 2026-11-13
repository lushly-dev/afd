import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { latestRuns, SELF, verdict, waitForVerdict } from './ci-verdict.mjs';

const run = (id, path, status = 'completed', conclusion = 'success') => ({
	id,
	path,
	name: path.replace('.github/workflows/', ''),
	status,
	conclusion: status === 'completed' ? conclusion : null,
	html_url: `https://example.invalid/runs/${id}`,
});
const CI = '.github/workflows/ci.yml';
const RUST = '.github/workflows/rust.yml';

describe('verdict', () => {
	it('passes when every run passed, was skipped or was neutral', () => {
		const result = verdict([
			run(1, CI),
			run(2, RUST, 'completed', 'skipped'),
			run(3, '.github/workflows/cpp.yml', 'completed', 'neutral'),
		]);
		assert.equal(result.state, 'success');
		assert.equal(result.passed.length, 3);
	});

	it('fails on any other conclusion, even while others still run', () => {
		for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'stale']) {
			const result = verdict([run(1, CI, 'completed', conclusion), run(2, RUST, 'in_progress')]);
			assert.equal(result.state, 'failure', conclusion);
			assert.deepEqual(
				result.failed.map((r) => r.id),
				[1]
			);
		}
	});

	it('waits while a run is queued or in progress', () => {
		assert.equal(verdict([run(1, CI), run(2, RUST, 'queued')]).state, 'pending');
	});

	it('ignores its own workflow and judges only the latest run of each workflow', () => {
		const runs = [
			run(1, CI, 'completed', 'failure'),
			run(5, CI),
			run(6, SELF, 'in_progress'),
			run(7, `${SELF}@refs/pull/1/merge`, 'completed', 'failure'),
		];
		assert.deepEqual(
			latestRuns(runs).map((r) => r.id),
			[5]
		);
		assert.equal(verdict(runs).state, 'success');
	});

	it('passes a pull request no other workflow ran on', () => {
		assert.equal(verdict([run(6, SELF, 'in_progress')]).state, 'success');
	});
});

/** A fake GitHub whose answers change with each read, and a clock that sleeping advances. */
function harness(reads) {
	let clock = 0;
	const urls = [];
	let index = 0;
	return {
		urls,
		options: {
			repository: 'example/repo',
			sha: 'a'.repeat(40),
			token: 'token',
			pollMs: 30,
			settleMs: 60,
			timeoutMs: 1_000,
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
			log: () => {},
			fetchImpl: async (url) => {
				urls.push(url);
				const answer = reads[Math.min(index++, reads.length - 1)];
				if (answer instanceof Error) return { ok: false, status: 502, json: async () => ({}) };
				return { ok: true, json: async () => ({ workflow_runs: answer }) };
			},
		},
	};
}

describe('waitForVerdict', () => {
	it('reads only pull-request runs of the head commit', async () => {
		const h = harness([[run(1, CI)]]);
		await waitForVerdict(h.options);
		assert.match(
			h.urls[0],
			/repos\/example\/repo\/actions\/runs\?head_sha=a{40}&event=pull_request/
		);
	});

	it('passes once success holds for the settle time', async () => {
		const h = harness([[run(1, CI, 'in_progress')], [run(1, CI)], [run(1, CI)], [run(1, CI)]]);
		const { code } = await waitForVerdict(h.options);
		assert.equal(code, 0);
		assert.ok(h.urls.length >= 3, 'success is confirmed by a later read');
	});

	it('waits for a workflow that registers after an early success', async () => {
		const h = harness([
			[run(1, CI)],
			[run(1, CI), run(2, RUST, 'queued')],
			[run(1, CI), run(2, RUST, 'completed', 'failure')],
		]);
		const { code, result } = await waitForVerdict(h.options);
		assert.equal(code, 1);
		assert.deepEqual(
			result.failed.map((r) => r.id),
			[2]
		);
	});

	it('fails at the first failed run without waiting for the rest', async () => {
		const h = harness([[run(1, CI, 'completed', 'failure'), run(2, RUST, 'in_progress')]]);
		const { code } = await waitForVerdict(h.options);
		assert.equal(code, 1);
		assert.equal(h.urls.length, 1);
	});

	it('times out rather than passing while runs never finish', async () => {
		const h = harness([[run(1, CI, 'in_progress')]]);
		assert.equal((await waitForVerdict(h.options)).code, 1);
	});

	it('treats a failed read as an error, never a verdict', async () => {
		const h = harness([new Error('502')]);
		await assert.rejects(waitForVerdict(h.options), /GitHub returned 502/);
	});
});
