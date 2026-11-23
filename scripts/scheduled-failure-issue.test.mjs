import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ISSUE_LABELS,
	issueTitleFor,
	markerFor,
	planIssueAction,
	run,
} from './scheduled-failure-issue.mjs';

test('opens one issue on first failure, comments on repeat failure, and closes on recovery', () => {
	const base = {
		workflowName: 'Rust',
		runUrl: 'https://github.com/lushly-dev/afd/actions/runs/1',
		sha: 'abcdef1234567890',
		date: '2026-11-23T06:30:00Z',
	};

	const created = planIssueAction({ ...base, existingIssues: [], conclusion: 'failure' });
	assert.equal(created.action, 'create');
	assert.equal(created.title, issueTitleFor('Rust'));
	assert.deepEqual(created.labels, ISSUE_LABELS);
	assert.ok(created.body.includes(markerFor('Rust')));
	assert.ok(created.body.includes('abcdef123456'));

	// Repeat failure (including timed_out and startup_failure) updates the existing open issue.
	const existing = [
		{
			number: 42,
			title: created.title,
			body: created.body,
			user: { login: 'github-actions[bot]' },
		},
	];
	const repeated = planIssueAction({ ...base, existingIssues: existing, conclusion: 'timed_out' });
	assert.equal(repeated.action, 'comment');
	assert.equal(repeated.issueNumber, 42);
	assert.match(repeated.body, /failed again \(`timed_out`\)/);

	// A manually filed issue with the same title or even marker is ignored unless bot-authored.
	const humanIssue = [
		{
			number: 55,
			title: created.title,
			body: `${markerFor('Rust')}\nManual report`,
			user: { login: 'maintainer' },
		},
		{
			number: 56,
			title: created.title,
			body: markerFor('Rust'),
		},
	];
	assert.equal(
		planIssueAction({ ...base, existingIssues: humanIssue, conclusion: 'failure' }).action,
		'create'
	);
	assert.equal(
		planIssueAction({ ...base, existingIssues: humanIssue, conclusion: 'success' }).action,
		'noop'
	);

	// Passing scheduled run closes the bot-owned open issue.
	const recovered = planIssueAction({ ...base, existingIssues: existing, conclusion: 'success' });
	assert.equal(recovered.action, 'close');
	assert.equal(recovered.issueNumber, 42);
	assert.match(recovered.body, /recovered and passed/);

	// Passing run with no open issue is a no-op.
	assert.equal(
		planIssueAction({ ...base, existingIssues: [], conclusion: 'success' }).action,
		'noop'
	);

	// Pull requests returned by /issues are ignored.
	const prOnly = [{ number: 99, title: created.title, body: created.body, pull_request: {} }];
	assert.equal(
		planIssueAction({ ...base, existingIssues: prOnly, conclusion: 'failure' }).action,
		'create'
	);
});

test('run drives the GitHub API client for create, comment and close transitions', async () => {
	const calls = [];
	const makeApi =
		(existingIssues) =>
		async (_repo, _token, path, options = {}) => {
			calls.push({
				method: options.method ?? 'GET',
				path,
				body: options.body ? JSON.parse(options.body) : null,
			});
			if (path.startsWith('/issues?')) return existingIssues;
			if (path === '/issues' && options.method === 'POST') return { number: 77 };
			return {};
		};
	const env = {
		GITHUB_REPOSITORY: 'lushly-dev/afd',
		GITHUB_TOKEN: 'tok',
		WORKFLOW_NAME: 'Python',
		RUN_CONCLUSION: 'failure',
		RUN_URL: 'https://example.invalid/run/1',
		RUN_SHA: '1234567890abcdef',
		RUN_DATE: '2026-11-23T07:00:00Z',
	};

	const created = await run(env, makeApi([]));
	assert.equal(created.issueNumber, 77);
	assert.equal(calls[1].method, 'POST');
	assert.equal(calls[1].path, '/issues');

	calls.length = 0;
	await run(
		{ ...env, RUN_CONCLUSION: 'success' },
		makeApi([
			{
				number: 77,
				title: issueTitleFor('Python'),
				body: markerFor('Python'),
				user: { login: 'github-actions[bot]' },
			},
		])
	);
	assert.deepEqual(
		calls.map((c) => `${c.method} ${c.path}`),
		[
			'GET /issues?state=open&labels=area%3Aci&per_page=100&page=1',
			'POST /issues/77/comments',
			'PATCH /issues/77',
		]
	);
	assert.equal(calls[2].body.state, 'closed');

	// Pagination: finds a tracking issue on page 2 when page 1 is full (100 issues).
	const pageCalls = [];
	await run({ ...env, RUN_CONCLUSION: 'success' }, async (_repo, _token, path, options = {}) => {
		pageCalls.push(`${options.method ?? 'GET'} ${path}`);
		if (path.endsWith('page=1')) {
			return Array.from({ length: 100 }, (_, index) => ({
				number: index + 1,
				title: 'other',
				body: 'other',
			}));
		}
		if (path.endsWith('page=2')) {
			return [
				{
					number: 205,
					title: issueTitleFor('Python'),
					body: markerFor('Python'),
					user: { login: 'github-actions[bot]' },
				},
			];
		}
		return {};
	});
	assert.ok(pageCalls.includes('GET /issues?state=open&labels=area%3Aci&per_page=100&page=2'));
	assert.ok(pageCalls.includes('PATCH /issues/205'));
});
