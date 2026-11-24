#!/usr/bin/env node
/**
 * Sets the git identity the version pull request's commit is made with to that pull request's
 * author, so the commit and the pull request have one author.
 *
 * `main` merges through a merge queue, and however it merges, the commit and the pull request
 * must name one author: a rebasing queue (#1809) lands the commit as it is, so its author is who
 * `main` credits, and a squashing one adds a `Co-authored-by:` line for a branch commit whose
 * author is not the pull request's, which `ci-ok` refuses (`scripts/commit-credit.mjs
 * --merge-group`). `scripts/release-version-pr.mjs` uses `resolveAuthor` before committing and
 * `verifyAuthor` afterwards for each route's branch (`changeset-release/npm-main` and
 * `changeset-release/npm-prerelease`). Even when they match, a squash gains a line naming the bot
 * author itself (#1590's squash, 2026-11-20), which credits nobody else and which
 * `commit-credit.mjs` allows.
 *
 * The identity follows the pull request, not the token: the release workflow force-pushes a new
 * commit to each open version pull request on every push to `main`, and that pull request keeps
 * the author it was opened by, whichever token updates it.
 *
 *   node scripts/release-pr-author.mjs             reads the open version pull request, or the
 *                                                  App's bot user when there is none and APP_SLUG
 *                                                  is set, then sets user.name and user.email in
 *                                                  this checkout
 *   node scripts/release-pr-author.mjs --verify    reads the pull request back and fails if GitHub
 *                                                  credits a commit on it to anyone but its author
 *
 * Exit 0 set or agreed, 1 a commit is by someone else, 2 a failed read (the identity is left as it
 * was, and the step fails).
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The account GITHUB_TOKEN acts as. */
export const ACTIONS_BOT = { login: 'github-actions[bot]', id: 41898282, type: 'Bot' };

/** The branch the release workflow pushes the version pull request from. */
export const releaseBranch = (base, route = '') => `changeset-release/${route || base}`;

/** The address GitHub ties to an account: a commit made with it is that account's. */
export function identity({ login, id }) {
	if (!login || !Number.isInteger(id) || id <= 0) {
		throw new Error(`No git identity for ${JSON.stringify({ login, id })}`);
	}
	return { name: login, email: `${id}+${login}@users.noreply.github.com` };
}

/**
 * Whose identity the commit takes, and why.
 *
 * @param {{ openPr?: { number: number, login: string, id: number, type: string } | null,
 *           app?: { login: string, id: number } | null }} facts
 *   openPr: the open version pull request's author; app: the release App's bot user, when its
 *   token will open the pull request.
 * @returns {{ name: string, email: string, reason: string, warning?: string }}
 */
export function chooseAuthor({ openPr = null, app = null }) {
	if (openPr && openPr.type === 'Bot') {
		return {
			...identity(openPr),
			reason: `pull request #${openPr.number} was opened by ${openPr.login}`,
		};
	}
	if (openPr) {
		// A person's commits are theirs to make. The author check refuses this pull request; the
		// message says how to get one this workflow opened.
		return {
			...identity(ACTIONS_BOT),
			reason: `pull request #${openPr.number} was opened by ${openPr.login}, not by a bot`,
			warning: `Version pull request #${openPr.number} was opened by ${openPr.login}. Its commit is made as ${ACTIONS_BOT.login}, not as the pull request's author, so this workflow's author check fails it (a squashing queue would also add a Co-authored-by line, which ci-ok refuses). Close that pull request and delete its branch; the next push to main opens one this workflow authors.`,
		};
	}
	if (app) {
		return {
			...identity(app),
			reason: `the release App (${app.login}) will open the pull request`,
		};
	}
	return { ...identity(ACTIONS_BOT), reason: 'GITHUB_TOKEN will open the pull request' };
}

async function read(path, token) {
	// Actions sets GITHUB_API_URL; the tests point it at a server of their own.
	const api = process.env.GITHUB_API_URL || 'https://api.github.com';
	const response = await fetch(`${api}${path}`, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'x-github-api-version': '2022-11-28',
		},
	});
	if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${response.statusText}`);
	return response.json();
}

/** The open version pull request's author, or null when none is open. */
export async function openVersionPr(
	{ repository, base, branch = releaseBranch(base), token },
	get = read
) {
	const owner = repository.split('/')[0];
	const head = encodeURIComponent(`${owner}:${branch}`);
	const found = await get(
		`/repos/${repository}/pulls?state=open&base=${encodeURIComponent(base)}&head=${head}`,
		token
	);
	if (!Array.isArray(found)) throw new Error('The pull request list is not a list');
	if (found.length === 0) return null;
	const [{ number, user }] = found;
	return { number, login: user.login, id: user.id, type: user.type };
}

/** The bot user an App acts as: `<slug>[bot]`. */
export async function appBot({ slug, token }, get = read) {
	const login = `${slug}[bot]`;
	const user = await get(`/users/${encodeURIComponent(login)}`, token);
	return { login: user.login, id: user.id };
}

/** The commits GitHub lists on a pull request: the account it credits each to, or none. */
export async function prCommits({ repository, number, token }, get = read) {
	const found = await get(`/repos/${repository}/pulls/${number}/commits?per_page=100`, token);
	if (!Array.isArray(found)) throw new Error('The commit list is not a list');
	return found.map(({ sha, author, commit }) => ({
		sha,
		login: author?.login ?? null,
		written: `${commit.author.name} <${commit.author.email}>`,
	}));
}

function flagValue(args, name) {
	const index = args.indexOf(name);
	if (index < 0) return '';
	const value = args[index + 1];
	if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
	return value;
}

function facts(env, args = []) {
	const {
		GH_TOKEN,
		GITHUB_REPOSITORY,
		GITHUB_REF_NAME,
		APP_SLUG,
		RELEASE_PR_BRANCH,
		RELEASE_ROUTE,
	} = env;
	if (!GH_TOKEN || !GITHUB_REPOSITORY || !GITHUB_REF_NAME) {
		throw new Error('GH_TOKEN, GITHUB_REPOSITORY and GITHUB_REF_NAME must be set');
	}
	const explicitBranch = flagValue(args, '--branch') || RELEASE_PR_BRANCH || '';
	const route = flagValue(args, '--route') || RELEASE_ROUTE || '';
	return {
		repository: GITHUB_REPOSITORY,
		base: GITHUB_REF_NAME,
		branch: explicitBranch || releaseBranch(GITHUB_REF_NAME, route),
		token: GH_TOKEN,
		appSlug: APP_SLUG || '',
	};
}

/** Reads what decides the identity, then chooses it. The App is asked for only when it will open the pull request. */
export async function resolveAuthor(
	{ repository, base, branch = releaseBranch(base), token, appSlug },
	get = read
) {
	const openPr = await openVersionPr({ repository, base, branch, token }, get);
	const app = !openPr && appSlug ? await appBot({ slug: appSlug, token }, get) : null;
	return chooseAuthor({ openPr, app });
}

const gitConfig = (key, value) => execFileSync('git', ['config', key, value], { stdio: 'inherit' });

/** Sets the identity in this checkout. A failed read throws before anything is set. */
export async function setAuthor(
	env,
	{ args = [], get = read, git = gitConfig, log = console.log } = {}
) {
	const chosen = await resolveAuthor(facts(env, args), get);
	if (chosen.warning) log(`::warning::${chosen.warning}`);
	git('user.name', chosen.name);
	git('user.email', chosen.email);
	log(`release-pr-author: ${chosen.name} <${chosen.email}> (${chosen.reason})`);
	return chosen;
}

/**
 * Every commit on the open version pull request that GitHub credits to anyone but its author: a
 * rebase would land them under someone who did not open it, and a squash would name them in a
 * Co-authored-by line.
 */
export async function verifyAuthor(env, { args = [], get = read, log = console.log } = {}) {
	const { repository, base, branch, token } = facts(env, args);
	const openPr = await openVersionPr({ repository, base, branch, token }, get);
	if (!openPr) {
		log('release-pr-author: no version pull request is open; nothing to check');
		return [];
	}
	const commits = await prCommits({ repository, number: openPr.number, token }, get);
	const problems = commits
		.filter((commit) => commit.login !== openPr.login)
		.map(
			(commit) =>
				`commit ${commit.sha.slice(0, 8)} is by ${commit.login ?? `${commit.written}, which GitHub ties to no account`}, and pull request #${openPr.number} was opened by ${openPr.login}`
		);
	if (problems.length === 0) {
		log(
			`release-pr-author: pull request #${openPr.number} and its ${commits.length} commit(s) are by ${openPr.login}`
		);
	}
	return problems;
}

const VERIFY_FIX = [
	'Each would land under an author who did not open the pull request (a squashing queue adds a',
	'Co-authored-by line for each, which ci-ok refuses).',
	'The next push to main rewrites the commit with the identity this workflow reads then; if it',
	'still differs, the version PR script no longer commits with the resolved identity, or a',
	'person opened the pull request (close it, delete its branch, and let this workflow open one).',
].join('\n');

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	try {
		if (args.includes('--verify')) {
			const problems = await verifyAuthor(process.env, { args });
			if (problems.length > 0) {
				for (const problem of problems) console.log(`::error::${problem}`);
				console.error(`release-pr-author: ${problems.join('\n')}\n${VERIFY_FIX}`);
				process.exitCode = 1;
			}
		} else {
			await setAuthor(process.env, { args });
		}
	} catch (error) {
		console.error(`release-pr-author: ${error.message}`);
		process.exitCode = 2;
	}
}
