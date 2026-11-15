#!/usr/bin/env node
/**
 * Keeps the owner the credited contributor: no commit names an AI agent as its author, its
 * committer or a co-author.
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
 * Exit 0 clean, 1 an agent is credited, 2 a failed read.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Emails that belong to an AI agent's account rather than a person's. */
export const AGENT_EMAILS = [/@anthropic\.com$/i, /@openai\.com$/i, /^codex@/i];

const CO_AUTHOR = /^co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/gim;

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
	const found = [];
	for (const role of ['author', 'committer']) {
		const person = commit[role];
		if (person && isAgentEmail(person.email))
			found.push(`${role} is ${person.name} <${person.email}>`);
	}
	for (const { name, email } of agentCoAuthors(commit.message)) {
		found.push(`Co-authored-by names ${name} <${email}>`);
	}
	return found;
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

async function main(argv) {
	const at = argv.indexOf('--message');
	let commits;
	try {
		commits =
			at >= 0
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
		for (const problem of problems(commit)) {
			failed = true;
			console.error(`commit-credit: ${commit.sha ? `${commit.sha.slice(0, 8)} ` : ''}${problem}`);
		}
	}
	if (failed) console.error(FIX);
	else console.log(`commit-credit: ${commits.length} commit(s) credit only people`);
	return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = await main(process.argv.slice(2));
}
