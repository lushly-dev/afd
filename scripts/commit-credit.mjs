#!/usr/bin/env node
/**
 * Keeps the owner the credited contributor: no commit names an AI agent as its author, its
 * committer or a co-author, and no commit on main names a co-author at all.
 *
 * GitHub's contributor graph credits a commit to its author and to every `Co-authored-by:`
 * trailer whose email it can match to an account, so an agent named either way is credited in
 * full. An agent that helped is listed with an `Assisted-by:` trailer that carries no email
 * (`Assisted-by: Claude Code`), which GitHub does not count.
 *
 * Usage:
 *   node scripts/commit-credit.mjs --message <file>   the commit-msg hook: this message, and the
 *                                                     author and committer git will record
 *   node scripts/commit-credit.mjs                    Actions (ci-ok): every commit in the pull
 *                                                     request; GITHUB_TOKEN, GITHUB_REPOSITORY
 *                                                     and PR_NUMBER set
 *   node scripts/commit-credit.mjs --push-event       Actions (main-credit.yml): every commit a
 *                                                     push to main brought, from the event at
 *                                                     GITHUB_EVENT_PATH; any Co-authored-by line
 *                                                     fails, since GitHub writes one into a squash
 *                                                     message after ci-ok has checked the branch
 *   node scripts/commit-credit.mjs --merge-group      Actions (ci-ok, on a merge queue's commit):
 *                                                     every commit the merge group adds to its
 *                                                     base, with the squash GitHub wrote; any
 *                                                     Co-authored-by line fails. GITHUB_TOKEN,
 *                                                     GITHUB_REPOSITORY, BASE_SHA and HEAD_SHA set
 * Exit 0 clean, 1 an agent or co-author is credited, 2 a failed read.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Emails that belong to an AI agent's account rather than a person's. */
export const AGENT_EMAILS = [/@anthropic\.com$/i, /@openai\.com$/i, /^codex@/i];

const CO_AUTHOR = /^co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/gim;
/**
 * Any co-author line, however its value is written: git's trailer parser also takes a space before
 * the colon, and an indented line counts here too, though git reads it as a continuation.
 */
const ANY_CO_AUTHOR = /^[ \t]*co-authored-by[ \t]*:.*$/gim;
/** The most commits a push event lists; past it, GitHub leaves the rest out. */
export const PUSH_EVENT_LIMIT = 2048;

export function isAgentEmail(email) {
	return AGENT_EMAILS.some((pattern) => pattern.test(email.trim()));
}

/** Agents a commit message credits as co-authors: [{ name, email }]. */
export function agentCoAuthors(message) {
	return [...message.matchAll(CO_AUTHOR)]
		.map(([, name, email]) => ({ name, email }))
		.filter(({ email }) => isAgentEmail(email));
}

/**
 * Every way one commit credits an agent.
 * @param {{ sha?: string, message: string, author?: { name: string, email: string },
 *   committer?: { name: string, email: string } }} commit
 */
export function problems(commit) {
	const found = agentIdentities(commit);
	for (const { name, email } of agentCoAuthors(commit.message)) {
		found.push(`Co-authored-by names ${name} <${email}>`);
	}
	return found;
}

/** An agent as a commit's author or committer. */
function agentIdentities(commit) {
	const found = [];
	for (const role of ['author', 'committer']) {
		const person = commit[role];
		if (person && isAgentEmail(person.email))
			found.push(`${role} is ${person.name} <${person.email}>`);
	}
	return found;
}

/**
 * Every way one commit on main credits anyone but its author: an agent as its author or
 * committer, and any co-author line, a person's included.
 */
export function mainProblems(commit) {
	const found = agentIdentities(commit);
	for (const [line] of commit.message.matchAll(ANY_CO_AUTHOR)) {
		found.push(`has the line "${line.trim()}"`);
	}
	return found;
}

export const MAIN_FIX = [
	'A commit on main credits a co-author. Main is not rewritten, so fix the path that wrote it:',
	"  a squash merge given no body: GitHub's default message adds a Co-authored-by line for every",
	"  commit author whose address isn't the merging account's. Merge with --body-file as",
	"  prepare-pr's step 9 does (the Factory's merges use botcore_factory/squash.py), and correct",
	'  that author address',
	'  a merge commit or a rebase merge: it carries the branch commits onto main as they are, so',
	'  squash instead, with that body',
	'  a commit made with the line: replace it with an email-free "Assisted-by: <agent>" trailer',
].join('\n');

/**
 * The commits a push event lists, in the shape `problems` reads. A list that may be cut short
 * is refused rather than checked in part: GitHub lists at most `PUSH_EVENT_LIMIT`, oldest first,
 * so the last must be the pushed head.
 */
export function pushedCommits(event) {
	if (!Array.isArray(event.commits))
		throw new Error('the event lists no commits: not a push event');
	const commits = event.commits.map((item) => ({
		sha: item.id,
		message: item.message ?? '',
		author: item.author,
		committer: item.committer,
	}));
	if (commits.length === 0) {
		throw new Error('the push event lists no commits: main was rewound, which nothing should do');
	}
	if (commits.length >= PUSH_EVENT_LIMIT || (event.after && commits.at(-1).sha !== event.after)) {
		throw new Error(
			`the push event may not list every commit (${commits.length}, ending at ${commits.at(-1).sha}` +
				` for ${event.after}): check the pushed range by hand with git log`
		);
	}
	return commits;
}

export const FIX = [
	'An agent is credited as a contributor. List it with an email-free trailer instead,',
	'such as "Assisted-by: Claude Code", and make the owner the author:',
	'  git config user.name / user.email   set to the owner (a cloud session sets an agent)',
	"  git rebase <base> --exec 'git commit --amend --no-edit --reset-author'   re-author",
	'  replace each "Co-authored-by: <agent> <email>" line with "Assisted-by: <agent>"',
	'Claude Code writes the trailer from settings.json: "attribution": { "commit": "Assisted-by: Claude Code" }.',
].join('\n');

function ident(variable) {
	const value = execFileSync('git', ['var', variable], { encoding: 'utf8' });
	const match = value.match(/^(.*?)\s*<([^>]*)>/);
	return match ? { name: match[1], email: match[2] } : undefined;
}

async function pullRequestCommits() {
	const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER } = process.env;
	const commits = [];
	for (let page = 1; ; page++) {
		const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/commits?per_page=100&page=${page}`;
		const response = await fetch(url, {
			headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
		});
		if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
		const batch = await response.json();
		for (const item of batch) {
			commits.push({
				sha: item.sha,
				message: item.commit.message,
				author: item.commit.author,
				committer: item.commit.committer,
			});
		}
		if (batch.length < 100) return commits;
	}
}

export const QUEUE_FIX = [
	'A commit the merge queue built credits a co-author, and main would receive it. GitHub writes the',
	"queue's squash message itself: it adds a Co-authored-by line for a branch commit's author it",
	"does not take to be the squash commit's author, and keeps the lines the branch commits carry.",
	'The pull request has left the queue. Before queueing it again:',
	'  a line a branch commit carries: replace it with an email-free "Assisted-by: <agent>" trailer',
	'  a line GitHub added for a commit author: re-author those commits with the address of the',
	"  account that opened the pull request (git rebase <base> --exec 'git commit --amend --no-edit",
	"  --reset-author'), so the squash has one author",
].join('\n');

/**
 * The commits a merge group adds to its base, oldest first, in the shape `mainProblems` reads:
 * the squash GitHub wrote for each queued pull request, which exists nowhere before the queue
 * builds it. A list that may be partial, or a group that is not its base plus commits, is
 * refused rather than checked in part.
 */
export async function mergeGroupCommits({
	repository,
	base,
	head,
	token,
	api = 'https://api.github.com',
	fetchImpl = fetch,
}) {
	for (const [name, sha] of [
		['BASE_SHA', base],
		['HEAD_SHA', head],
	])
		if (!/^[0-9a-f]{40}$/.test(sha ?? ''))
			throw new Error(`${name} must be a 40-character commit, the merge group's`);
	const commits = [];
	let total = null;
	for (let page = 1; page <= 30; page++) {
		const url = `${api}/repos/${repository}/compare/${base}...${head}?per_page=100&page=${page}`;
		const response = await fetchImpl(url, {
			headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
		});
		if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
		const body = await response.json();
		// `ahead` is the base plus commits; anything else means the base is not an ancestor.
		if (body.status !== 'ahead' || body.behind_by !== 0)
			throw new Error(
				`the merge group ${head} is not its base ${base} plus commits (status ${body.status}): check the range by hand with git log`
			);
		total = body.total_commits;
		const batch = body.commits ?? [];
		for (const item of batch) {
			commits.push({
				sha: item.sha,
				message: item.commit.message,
				author: item.commit.author,
				committer: item.commit.committer,
			});
		}
		if (batch.length === 0 || commits.length >= total) break;
	}
	if (
		!Number.isInteger(total) ||
		total < 1 ||
		commits.length !== total ||
		commits.at(-1).sha !== head
	)
		throw new Error(
			`the comparison may not list every commit of the merge group (${commits.length} of ${total}, ending at ${commits.at(-1)?.sha} for ${head}): check the range by hand with git log`
		);
	return commits;
}

async function main(argv) {
	const at = argv.indexOf('--message');
	const inQueue = argv.includes('--merge-group');
	// Both read what main receives, so both refuse any co-author line, a person's included.
	const onMain = argv.includes('--push-event') || inQueue;
	let commits;
	try {
		const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, BASE_SHA, HEAD_SHA } = process.env;
		commits = inQueue
			? await mergeGroupCommits({
					repository: GITHUB_REPOSITORY,
					base: BASE_SHA,
					head: HEAD_SHA,
					token: GITHUB_TOKEN,
					api: GITHUB_API_URL || undefined,
				})
			: onMain
				? pushedCommits(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')))
				: at >= 0
					? [
							{
								message: readFileSync(argv[at + 1], 'utf8'),
								author: ident('GIT_AUTHOR_IDENT'),
								committer: ident('GIT_COMMITTER_IDENT'),
							},
						]
					: await pullRequestCommits();
	} catch (error) {
		console.error(`commit-credit: ${error.message}`);
		return 2;
	}
	let failed = false;
	for (const commit of commits) {
		for (const problem of (onMain ? mainProblems : problems)(commit)) {
			failed = true;
			console.error(`commit-credit: ${commit.sha ? `${commit.sha.slice(0, 8)} ` : ''}${problem}`);
		}
	}
	if (failed) console.error(inQueue ? QUEUE_FIX : onMain ? MAIN_FIX : FIX);
	else if (onMain)
		console.log(`commit-credit: ${commits.length} commit(s) credit only their authors`);
	else console.log(`commit-credit: ${commits.length} commit(s) credit only people`);
	return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(2));
}
