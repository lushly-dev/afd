import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	EVENTS,
	latestRuns,
	mergeGroupWorkflows,
	SELF,
	verdict,
	waitForVerdict,
} from './ci-verdict.mjs';

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

	it('waits for an expected workflow that has no run, however the others ended', () => {
		const result = verdict([run(1, CI), run(6, SELF, 'in_progress')], [CI, RUST]);
		assert.equal(result.state, 'pending');
		assert.deepEqual(result.missing, [RUST]);
		// The run's path can carry a ref; an older failed run of an expected workflow still fails.
		assert.equal(
			verdict([run(1, CI), run(2, `${RUST}@refs/heads/x`)], [CI, RUST]).state,
			'success'
		);
		assert.equal(verdict([run(1, CI, 'completed', 'failure')], [CI, RUST]).state, 'failure');
		// Its own workflow is never expected of itself.
		assert.deepEqual(verdict([run(1, CI)], [CI]).missing, []);
	});
});

describe('mergeGroupWorkflows', () => {
	const repository = (files) => {
		const root = mkdtempSync(join(tmpdir(), 'ci-verdict-'));
		mkdirSync(join(root, '.github/workflows'), { recursive: true });
		for (const [name, text] of Object.entries(files))
			writeFileSync(join(root, '.github/workflows', name), text);
		return root;
	};
	const on = (...triggers) =>
		`on:\n${triggers.map((name) => `  ${name}:\n`).join('')}jobs:\n  a:\n    runs-on: x\n`;

	it('lists every workflow with the trigger but its own', (t) => {
		const root = repository({
			'ci-ok.yml': on('pull_request', 'merge_group'),
			'ci.yml': on('push', 'merge_group'),
			'rust.yaml': on('merge_group'),
			'release.yml': on('push'),
			// A job of that name is not a trigger.
			'odd.yml': 'on:\n  push:\njobs:\n  merge_group:\n    runs-on: x\n',
			'notes.txt': on('merge_group'),
		});
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.deepEqual(mergeGroupWorkflows(root), [
			'.github/workflows/ci.yml',
			'.github/workflows/rust.yaml',
		]);
	});

	it('refuses a checkout where its own workflow lacks the trigger, or with no workflows', (t) => {
		const root = repository({ 'ci-ok.yml': on('pull_request'), 'ci.yml': on('merge_group') });
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.throws(() => mergeGroupWorkflows(root), /ci-ok\.yml has no merge_group trigger/);
		assert.throws(() => mergeGroupWorkflows(join(root, 'absent')), /ENOENT/);
	});

	it("reads this repository's workflows: CI and the path-filtered ones", () => {
		const found = mergeGroupWorkflows(join(import.meta.dirname, '..'));
		assert.ok(found.includes(CI) && found.includes(RUST), found.join(', '));
		assert.ok(!found.includes(SELF));
		assert.ok(found.length >= 15, `${found.length} workflows`);
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

	it("reads a merge group's runs under its own event, and no other event's", async () => {
		const h = harness([[run(1, CI)]]);
		await waitForVerdict({ ...h.options, event: 'merge_group' });
		assert.ok(h.urls.length > 0);
		for (const url of h.urls) assert.match(url, /head_sha=a{40}&event=merge_group&/);
		assert.deepEqual(EVENTS, ['pull_request', 'merge_group']);
		await assert.rejects(
			waitForVerdict({ ...harness([[run(1, CI)]]).options, event: 'push' }),
			/unknown event push/
		);
	});

	it('does not pass a merge group while an expected workflow has not started', async () => {
		// Everything that started has passed, and stays passed for longer than the settle time.
		const h = harness([[run(1, CI)], [run(1, CI)], [run(1, CI)], [run(1, CI), run(2, RUST)]]);
		const { code, result } = await waitForVerdict({
			...h.options,
			event: 'merge_group',
			expected: [CI, RUST],
		});
		assert.equal(code, 0);
		assert.ok(h.urls.length >= 5, 'the late workflow is waited for, then success is confirmed');
		assert.deepEqual(result.missing, []);
	});

	it('fails a merge group whose expected workflow never starts, and names it', async () => {
		const h = harness([[run(1, CI)]]);
		const lines = [];
		const { code, result } = await waitForVerdict({
			...h.options,
			event: 'merge_group',
			expected: [CI, RUST],
			startMs: 300,
			log: (line) => lines.push(line),
		});
		assert.equal(code, 1);
		assert.deepEqual(result.missing, [RUST]);
		assert.ok(lines.includes(`NOT STARTED ${RUST}: no merge_group run on ${'a'.repeat(40)}`));
		assert.ok(lines.includes(`waiting for ${RUST}`));
	});

	it('expects nothing of a pull request, whose path filters decide what runs', async () => {
		const h = harness([[run(1, CI)]]);
		assert.equal((await waitForVerdict(h.options)).code, 0);
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
