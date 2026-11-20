#!/usr/bin/env node
/**
 * Keeps the owner the credited contributor: no commit names an AI agent as its author, its
 * committer or a co-author, and no commit on main names a co-author at all, other than its own
 * author by the same address, which credits nobody else.
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
 *                                                     but the author's own fails, since GitHub
 *                                                     writes one into a squash message after
 *                                                     ci-ok has checked the branch
 *   node scripts/commit-credit.mjs --merge-group      Actions (ci-ok, on a merge queue's commit):
 *                                                     every commit the merge group holds that
 *                                                     its target branch does not, the squash
 *                                                     GitHub wrote for it and for each pull
 *                                                     request queued ahead; any Co-authored-by
 *                                                     line but the author's own fails.
 *                                                     GITHUB_TOKEN, GITHUB_REPOSITORY, BASE_REF
 *                                                     (refs/heads/main) and HEAD_SHA set
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
 * committer, and any co-author line, a person's included, except one that names the commit's own
 * author by the same address. That line credits nobody else, and GitHub writes it into the
 * queue's squash of a pull request `github-actions` opened, whose commit `github-actions[bot]`
 * authored (#1590 on 2026-11-20).
 */
export function mainProblems(commit) {
	const found = agentIdentities(commit);
	for (const [line] of commit.message.matchAll(ANY_CO_AUTHOR)) {
		if (namesOwnAuthor(line, commit.author)) continue;
		found.push(`has the line "${line.trim()}"`);
	}
	return found;
}

/**
 * A co-author line in the form GitHub writes, `Co-authored-by: <name> <<address>>`, with a name
 * and one address, and that address the commit author's, compared without case.
 */
function namesOwnAuthor(line, author) {
	const match = /^co-authored-by: ([^<>\s][^<>]*) <([^<>\s]+)>[ \t]*$/i.exec(line);
	const own = author?.email?.trim().toLowerCase();
	return Boolean(match && own && match[2].toLowerCase() === own);
}

export const MAIN_FIX = [
	'A commit on main credits a co-author. Main is not rewritten, so fix the path that wrote it:',
	'  a squash GitHub wrote: it adds a Co-authored-by line for a commit whose author is not the',
	"  pull request's. The merge queue's ci-ok refuses such a squash before it lands (prepare-pr's",
	'  step 9), so this one went around the queue or landed while the queue was off: correct that',
	"  author's identity, and never merge with --admin",
	'  a merge commit or a rebase merge: it carries the branch commits onto main as they are, so',
	'  squash instead, through the queue',
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
 * The commits a merge group holds that its target branch does not, oldest first, in the shape
 * `mainProblems` reads: the squash GitHub wrote for each queued pull request, which exists
 * nowhere before the queue builds it. The base is the branch (`refs/heads/main`), not the commit
 * the group was built on: a group is built on the groups ahead of it, and a queue set to merge
 * past a failing entry would land those squashes on this group's verdict. A list that may be
 * partial, or a group that is not the branch plus commits, is refused rather than checked in part.
 */
export async function mergeGroupCommits({
	repository,
	base,
	head,
	token,
	api = 'https://api.github.com',
	fetchImpl = fetch,
}) {
	const branch = /^refs\/heads\/([\w.-]+(?:\/[\w.-]+)*)$/.exec(base ?? '')?.[1];
	if (!branch)
		throw new Error("BASE_REF must be the merge group's target branch, as refs/heads/main");
	if (!/^[0-9a-f]{40}$/.test(head ?? ''))
		throw new Error("HEAD_SHA must be a 40-character commit, the merge group's");
	const commits = [];
	let total = null;
	let compared = null;
	for (let page = 1; page <= 30; page++) {
		const url = `${api}/repos/${repository}/compare/${encodeURIComponent(branch)}...${head}?per_page=100&page=${page}`;
		const response = await fetchImpl(url, {
			headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
		});
		if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
		const body = await response.json();
		// `ahead` is the branch plus commits; anything else means the branch has moved elsewhere.
		if (body.status !== 'ahead' || body.behind_by !== 0)
			throw new Error(
				`the merge group ${head} is not ${branch} plus commits (status ${body.status}): check the range by hand with git log`
			);
		// Every page compares with the branch afresh. If the branch moved between two pages,
		// the pages are of different comparisons and commits could fall between them.
		const mergeBase = body.merge_base_commit?.sha;
		if (!mergeBase || (page > 1 && mergeBase !== compared))
			throw new Error(
				`${branch} moved while the merge group ${head} was being read (${compared} then ${mergeBase}): run the check again`
			);
		compared = mergeBase;
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
	// Both read what main receives, so both refuse any co-author line, a person's included, but
	// one naming the commit's own author.
	const onMain = argv.includes('--push-event') || inQueue;
	let commits;
	try {
		const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, BASE_REF, HEAD_SHA } = process.env;
		commits = inQueue
			? await mergeGroupCommits({
					repository: GITHUB_REPOSITORY,
					base: BASE_REF,
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
