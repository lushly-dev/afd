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
 * A merge queue asks for the same verdict on the commit it built, under the `merge_group` event.
 * No path filter applies there, so every workflow with that trigger starts a run, and the verdict
 * expects one from each: a workflow that has not started is waited for, and fails the verdict if
 * it never does. A pull request has no such list, since its path filters decide what runs.
 *
 * Usage (in Actions): GITHUB_TOKEN, GITHUB_REPOSITORY and HEAD_SHA set; RUN_EVENT names the event
 * whose runs to read, `pull_request` (the default) or `merge_group`;
 *   node scripts/ci-verdict.mjs
 * Exit 0 passed, 1 a workflow did not pass or the wait timed out, 2 a failed read.
 *
 * Not shared with Lushly's `scripts/ci-verdict.mjs`, which has the same name and another job
 * (#2834): it checks one workflow's `needs` results against its `ci-selection` artifact and a job
 * map, while this one waits on every workflow run a commit started. They share no function, so a
 * single seeded source would hold two programs.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SELF = '.github/workflows/ci-ok.yml';
const PASSED = new Set(['success', 'skipped', 'neutral']);
/** The events whose runs a verdict can read. */
export const EVENTS = ['pull_request', 'merge_group'];
const workflowPath = (run) => run.path?.replace(/@.*$/, '');

/** Whether a workflow's `on:` block, the text above its jobs, has the `merge_group` trigger. */
export const hasMergeGroup = (text) => /^ {2}merge_group:/m.test(text.split(/^jobs:/m)[0]);

/**
 * The workflows a merge group must start a run of: every workflow file with the `merge_group`
 * trigger, this verdict's own left out. Read from the checkout, which is the group's own commit.
 */
export function mergeGroupWorkflows(root) {
	const directory = join(root, '.github/workflows');
	const found = readdirSync(directory)
		.filter((file) => /\.ya?ml$/.test(file))
		.filter((file) => hasMergeGroup(readFileSync(join(directory, file), 'utf8')))
		.map((file) => `.github/workflows/${file}`);
	// This verdict runs on a merge group only because its own workflow has the trigger.
	if (!found.includes(SELF)) throw new Error(`${SELF} has no merge_group trigger in ${directory}`);
	const others = found.filter((path) => path !== SELF).sort();
	// A checkout that left the others out would expect nothing and pass on what happened to start.
	if (others.length === 0)
		throw new Error(`no workflow but ${SELF} has the merge_group trigger in ${directory}`);
	return others;
}

/**
 * The latest run of each workflow, leaving out this verdict's own workflow.
 * @param {{ id: number, path: string, name: string, status: string, conclusion: string | null,
 *   html_url?: string }[]} runs
 */
export function latestRuns(runs) {
	const latest = new Map();
	for (const run of runs) {
		if (workflowPath(run) === SELF) continue;
		const current = latest.get(run.path);
		// Run ids grow with time; a re-run keeps its id and reports its latest attempt.
		if (!current || run.id > current.id) latest.set(run.path, run);
	}
	return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `failure` when a finished run did not pass, `pending` while one runs or an expected workflow
 * has no run yet, otherwise `success`.
 * @param {string[]} [expected] workflow paths that must each have a run
 */
export function verdict(runs, expected = []) {
	const relevant = latestRuns(runs);
	const started = new Set(relevant.map(workflowPath));
	const missing = expected.filter((path) => !started.has(path));
	const failed = relevant.filter(
		(run) => run.status === 'completed' && !PASSED.has(run.conclusion)
	);
	const pending = relevant.filter((run) => run.status !== 'completed');
	return {
		state:
			failed.length > 0 ? 'failure' : pending.length + missing.length > 0 ? 'pending' : 'success',
		failed,
		pending,
		missing,
		passed: relevant.filter((run) => run.status === 'completed' && PASSED.has(run.conclusion)),
	};
}

async function readRuns({ repository, sha, event, token, fetchImpl }) {
	const runs = [];
	for (let page = 1; page <= 10; page++) {
		const response = await fetchImpl(
			`https://api.github.com/repos/${repository}/actions/runs?head_sha=${sha}&event=${event}&per_page=100&page=${page}`,
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
 * that registers late is still waited for. An `expected` workflow with no run after `startMs`
 * fails the verdict: it is not going to start.
 */
export async function waitForVerdict({
	repository,
	sha,
	token,
	event = 'pull_request',
	expected = [],
	fetchImpl = fetch,
	sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
	log = console.log,
	pollMs = 30_000,
	settleMs = 60_000,
	timeoutMs = 110 * 60_000,
	startMs = 15 * 60_000,
	now = Date.now,
}) {
	if (!EVENTS.includes(event)) throw new Error(`unknown event ${event}: ${EVENTS.join(' or ')}`);
	const began = now();
	const deadline = began + timeoutMs;
	await sleep(settleMs);
	let succeededAt = null;
	while (now() < deadline) {
		const result = verdict(await readRuns({ repository, sha, event, token, fetchImpl }), expected);
		if (result.state === 'failure') {
			for (const run of result.failed) log(`FAILED ${line(run)}`);
			return { code: 1, result };
		}
		if (result.missing.length > 0 && now() - began >= startMs) {
			for (const path of result.missing) log(`NOT STARTED ${path}: no ${event} run on ${sha}`);
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
			const waiting = [...result.pending.map((run) => run.name), ...result.missing];
			log(`waiting for ${waiting.join(', ')}`);
		}
		await sleep(pollMs);
	}
	log(`Timed out waiting for the workflows on ${sha}.`);
	return { code: 1, result: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, HEAD_SHA: sha } = process.env;
	const event = process.env.RUN_EVENT || 'pull_request';
	let expected = null;
	try {
		// A merge group's verdict needs the list: an unreadable one is an error, not an empty list.
		expected = event === 'merge_group' ? mergeGroupWorkflows(process.cwd()) : [];
	} catch (error) {
		console.error(`ci-verdict: ${error.message}`);
	}
	if (!token || !repository || !/^[0-9a-f]{40}$/.test(sha ?? '') || !EVENTS.includes(event)) {
		console.error(
			`ci-verdict: GITHUB_TOKEN, GITHUB_REPOSITORY and a 40-character HEAD_SHA are required, and RUN_EVENT is ${EVENTS.join(' or ')}`
		);
		process.exitCode = 2;
	} else if (!expected) {
		process.exitCode = 2;
	} else {
		if (expected.length > 0)
			console.log(
				`expecting a ${event} run of ${expected.length} workflow(s): ${expected.join(', ')}`
			);
		waitForVerdict({ repository, sha, token, event, expected }).then(
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
