#!/usr/bin/env node
import { resolve } from 'node:path';
/**
 * Opens, updates, or closes one tracking issue per scheduled workflow (#1799).
 *
 * Driven by `.github/workflows/scheduled-failure-issue.yml` when a scheduled run completes:
 *   - conclusion === 'failure': finds an existing open issue carrying the workflow's marker
 *     comment and appends a new failure comment, or opens one issue if none is open.
 *   - conclusion === 'success': if an open issue exists for that workflow, posts a recovery
 *     comment and closes it as completed.
 *
 * Uses only Node's built-in `fetch` and `GITHUB_TOKEN`.
 */
import { pathToFileURL } from 'node:url';

export const ISSUE_LABELS = ['area:ci', 'type:bug'];
export const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
export const BOT_AUTHORS = new Set(['github-actions[bot]', 'app/github-actions']);

export function markerFor(workflowName) {
	return `<!-- scheduled-failure: ${workflowName} -->`;
}

export function issueTitleFor(workflowName) {
	return `ci: scheduled ${workflowName} workflow failed`;
}

export function buildIssueBody({ workflowName, conclusion = 'failure', runUrl, sha, date }) {
	const shortSha = (sha ?? '').slice(0, 12) || 'unknown';
	const verb = conclusion === 'timed_out' ? 'timed out' : 'failed';
	return [
		markerFor(workflowName),
		`The scheduled **${workflowName}** workflow ${verb} on \`main\` (\`${conclusion}\`).`,
		'',
		`- **Run:** ${runUrl}`,
		`- **Commit:** \`${shortSha}\``,
		`- **Recorded:** ${date || new Date().toISOString()}`,
		'',
		'Further consecutive failures append to this issue; a passing scheduled run closes it.',
	].join('\n');
}

export function buildUpdateComment({ workflowName, conclusion, runUrl, sha, date }) {
	const shortSha = (sha ?? '').slice(0, 12) || 'unknown';
	if (conclusion === 'success') {
		return [
			`Scheduled **${workflowName}** workflow recovered and passed.`,
			'',
			`- **Run:** ${runUrl}`,
			`- **Commit:** \`${shortSha}\``,
			`- **Recorded:** ${date || new Date().toISOString()}`,
		].join('\n');
	}
	return [
		`Scheduled **${workflowName}** workflow failed again (\`${conclusion}\`).`,
		'',
		`- **Run:** ${runUrl}`,
		`- **Commit:** \`${shortSha}\``,
		`- **Recorded:** ${date || new Date().toISOString()}`,
	].join('\n');
}

/** Decide the exact GitHub API action from existing open issues and the run conclusion. */
export function planIssueAction({ existingIssues, workflowName, conclusion, runUrl, sha, date }) {
	const marker = markerFor(workflowName);
	const title = issueTitleFor(workflowName);
	// Match strictly by marker + GitHub Actions bot author so manually filed issues are never hijacked.
	const match = existingIssues.find(
		(issue) =>
			!issue.pull_request && issue.body?.includes(marker) && BOT_AUTHORS.has(issue.user?.login)
	);

	if (FAILURE_CONCLUSIONS.has(conclusion)) {
		if (match) {
			return {
				action: 'comment',
				issueNumber: match.number,
				body: buildUpdateComment({ workflowName, conclusion, runUrl, sha, date }),
			};
		}
		return {
			action: 'create',
			title,
			labels: ISSUE_LABELS,
			body: buildIssueBody({ workflowName, conclusion, runUrl, sha, date }),
		};
	}

	if (conclusion === 'success' && match) {
		return {
			action: 'close',
			issueNumber: match.number,
			body: buildUpdateComment({ workflowName, conclusion, runUrl, sha, date }),
		};
	}

	return { action: 'noop' };
}

async function githubApi(repository, token, path, options = {}) {
	const url = `https://api.github.com/repos/${repository}${path}`;
	const response = await fetch(url, {
		...options,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			...options.headers,
		},
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`GitHub API ${options.method ?? 'GET'} ${path} failed (${response.status}): ${text}`
		);
	}
	return response.json();
}

export async function run(env = process.env, api = githubApi) {
	const repository = env.GITHUB_REPOSITORY;
	const token = env.GITHUB_TOKEN;
	const workflowName = env.WORKFLOW_NAME;
	const conclusion = env.RUN_CONCLUSION;
	const runUrl = env.RUN_URL ?? '';
	const sha = env.RUN_SHA ?? '';
	const date = env.RUN_DATE ?? new Date().toISOString();

	if (!repository || !token || !workflowName || !conclusion) {
		throw new Error(
			'Missing required environment variables: GITHUB_REPOSITORY, GITHUB_TOKEN, WORKFLOW_NAME, RUN_CONCLUSION'
		);
	}

	const existingIssues = [];
	for (let page = 1; ; page++) {
		const batch = await api(
			repository,
			token,
			`/issues?state=open&labels=${encodeURIComponent('area:ci')}&per_page=100&page=${page}`
		);
		existingIssues.push(...batch);
		if (batch.length < 100) break;
	}
	const plan = planIssueAction({ existingIssues, workflowName, conclusion, runUrl, sha, date });

	if (plan.action === 'create') {
		const created = await api(repository, token, '/issues', {
			method: 'POST',
			body: JSON.stringify({ title: plan.title, body: plan.body, labels: plan.labels }),
		});
		console.log(`Opened scheduled failure issue #${created.number} for ${workflowName}`);
		return { ...plan, issueNumber: created.number };
	}

	if (plan.action === 'comment') {
		await api(repository, token, `/issues/${plan.issueNumber}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body: plan.body }),
		});
		console.log(`Updated scheduled failure issue #${plan.issueNumber} for ${workflowName}`);
		return plan;
	}

	if (plan.action === 'close') {
		await api(repository, token, `/issues/${plan.issueNumber}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body: plan.body }),
		});
		await api(repository, token, `/issues/${plan.issueNumber}`, {
			method: 'PATCH',
			body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
		});
		console.log(
			`Closed recovered scheduled failure issue #${plan.issueNumber} for ${workflowName}`
		);
		return plan;
	}

	console.log(`No scheduled failure issue action needed for ${workflowName} (${conclusion})`);
	return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	run().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
