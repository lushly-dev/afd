#!/usr/bin/env node
/**
 * One verdict for a pull request: every workflow that ran on its head commit passed.
 *
 * AFD's workflows are path-filtered, so most of them never run on a given pull request and no
 * fixed list of required checks can work. The `ci-ok` job (.github/workflows/ci-ok.yml) runs on
 * every pull request, waits for the workflow runs the same head commit started, and passes only
 * when each finished as success, skipped or neutral. A failure ends the wait at once.
 *
 * Re-running a failed workflow does not re-run this one: re-run `ci-ok` after it.
 *
 * Usage (in Actions): GITHUB_TOKEN, GITHUB_REPOSITORY and HEAD_SHA set;
 *   node scripts/ci-verdict.mjs
 * Exit 0 passed, 1 a workflow did not pass or the wait timed out, 2 a failed read.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SELF = '.github/workflows/ci-ok.yml';
const PASSED = new Set(['success', 'skipped', 'neutral']);

/**
 * The latest run of each workflow, leaving out this verdict's own workflow.
 * @param {{ id: number, path: string, name: string, status: string, conclusion: string | null,
 *   html_url?: string }[]} runs
 */
export function latestRuns(runs) {
	const latest = new Map();
	for (const run of runs) {
		if (run.path?.replace(/@.*$/, '') === SELF) continue;
		const current = latest.get(run.path);
		// Run ids grow with time; a re-run keeps its id and reports its latest attempt.
		if (!current || run.id > current.id) latest.set(run.path, run);
	}
	return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `failure` when a finished run did not pass, `pending` while one runs, otherwise `success`. */
export function verdict(runs) {
	const relevant = latestRuns(runs);
	const failed = relevant.filter(
		(run) => run.status === 'completed' && !PASSED.has(run.conclusion)
	);
	const pending = relevant.filter((run) => run.status !== 'completed');
	return {
		state: failed.length > 0 ? 'failure' : pending.length > 0 ? 'pending' : 'success',
		failed,
		pending,
		passed: relevant.filter((run) => run.status === 'completed' && PASSED.has(run.conclusion)),
	};
}

async function readRuns({ repository, sha, token, fetchImpl }) {
	const runs = [];
	for (let page = 1; page <= 10; page++) {
		const response = await fetchImpl(
			`https://api.github.com/repos/${repository}/actions/runs?head_sha=${sha}&event=pull_request&per_page=100&page=${page}`,
			{
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: `Bearer ${token}`,
					'X-GitHub-Api-Version': '2022-11-28',
				},
			}
		);
		if (!response.ok) throw new Error(`GitHub returned ${response.status} for the workflow runs`);
		const body = await response.json();
		runs.push(...body.workflow_runs);
		if (body.workflow_runs.length < 100) return runs;
	}
	throw new Error('More than 1,000 workflow runs for one commit; the list may be cut short');
}

const line = (run) => `${run.name}: ${run.conclusion ?? run.status} ${run.html_url ?? ''}`.trim();

/**
 * Poll until the runs settle. Success must hold across two reads `settleMs` apart, so a workflow
 * that registers late is still waited for.
 */
export async function waitForVerdict({
	repository,
	sha,
	token,
	fetchImpl = fetch,
	sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
	log = console.log,
	pollMs = 30_000,
	settleMs = 60_000,
	timeoutMs = 110 * 60_000,
	now = Date.now,
}) {
	const deadline = now() + timeoutMs;
	await sleep(settleMs);
	let succeededAt = null;
	while (now() < deadline) {
		const result = verdict(await readRuns({ repository, sha, token, fetchImpl }));
		if (result.state === 'failure') {
			for (const run of result.failed) log(`FAILED ${line(run)}`);
			return { code: 1, result };
		}
		if (result.state === 'success') {
			succeededAt ??= now();
			if (now() - succeededAt >= settleMs) {
				for (const run of result.passed) log(`passed ${line(run)}`);
				log(`${result.passed.length} workflow(s) passed on ${sha}.`);
				return { code: 0, result };
			}
		} else {
			succeededAt = null;
			log(`waiting for ${result.pending.map((run) => run.name).join(', ')}`);
		}
		await sleep(pollMs);
	}
	log(`Timed out waiting for the workflows on ${sha}.`);
	return { code: 1, result: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, HEAD_SHA: sha } = process.env;
	if (!token || !repository || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
		console.error(
			'ci-verdict: GITHUB_TOKEN, GITHUB_REPOSITORY and a 40-character HEAD_SHA are required'
		);
		process.exitCode = 2;
	} else {
		waitForVerdict({ repository, sha, token }).then(
			({ code }) => {
				process.exitCode = code;
			},
			(error) => {
				console.error(`ci-verdict: ${error.message}`);
				process.exitCode = 2;
			}
		);
	}
}
