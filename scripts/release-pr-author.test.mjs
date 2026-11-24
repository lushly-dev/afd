import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import {
	ACTIONS_BOT,
	appBot,
	chooseAuthor,
	identity,
	openVersionPr,
	releaseBranch,
	setAuthor,
	verifyAuthor,
} from './release-pr-author.mjs';
import { fixtureEnvironment } from './run-tooling-tests.mjs';

const execFileAsync = promisify(execFile);

const root = join(import.meta.dirname, '..');
const APP = { login: 'afd-release[bot]', id: 987654 };
const ACTIONS_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const APP_EMAIL = '987654+afd-release[bot]@users.noreply.github.com';

describe('identity', () => {
	it("is the address GitHub ties to the account, so the commit is the account's", () => {
		assert.deepEqual(identity(ACTIONS_BOT), { name: 'github-actions[bot]', email: ACTIONS_EMAIL });
		assert.deepEqual(identity(APP), { name: 'afd-release[bot]', email: APP_EMAIL });
	});

	it('refuses an account it cannot address', () => {
		assert.throws(() => identity({ login: 'afd-release[bot]', id: undefined }), /No git identity/);
		assert.throws(() => identity({ login: '', id: 5 }), /No git identity/);
		assert.throws(() => identity({ login: 'x', id: 0 }), /No git identity/);
	});
});

describe('chooseAuthor', () => {
	it('follows the open pull request, whichever token will update it', () => {
		const opened = { number: 1590, ...ACTIONS_BOT };
		// The App's token is there, and the pull request GITHUB_TOKEN opened still decides.
		const chosen = chooseAuthor({ openPr: opened, app: APP });
		assert.equal(chosen.name, 'github-actions[bot]');
		assert.equal(chosen.email, ACTIONS_EMAIL);
		assert.match(chosen.reason, /#1590 was opened by github-actions\[bot\]/);
		assert.equal(chosen.warning, undefined);
	});

	it("takes the App's identity for a pull request the App opened", () => {
		const chosen = chooseAuthor({ openPr: { number: 1700, ...APP, type: 'Bot' } });
		assert.equal(chosen.name, 'afd-release[bot]');
		assert.equal(chosen.email, APP_EMAIL);
	});

	it("takes the App's identity when the App will open the pull request", () => {
		const chosen = chooseAuthor({ openPr: null, app: APP });
		assert.equal(chosen.name, 'afd-release[bot]');
		assert.match(chosen.reason, /release App \(afd-release\[bot\]\) will open/);
	});

	it('keeps github-actions[bot] when GITHUB_TOKEN will open the pull request', () => {
		const chosen = chooseAuthor({ openPr: null, app: null });
		assert.deepEqual({ name: chosen.name, email: chosen.email }, identity(ACTIONS_BOT));
		assert.match(chosen.reason, /GITHUB_TOKEN will open/);
	});

	it("never commits as a person, and says what the queue will do with that person's pull request", () => {
		const chosen = chooseAuthor({
			openPr: { number: 12, login: 'someone', id: 77, type: 'User' },
			app: APP,
		});
		assert.equal(chosen.name, 'github-actions[bot]');
		assert.match(chosen.warning, /#12 was opened by someone/);
		assert.match(chosen.warning, /Co-authored-by/);
		assert.match(chosen.warning, /this workflow's author check fails it/);
	});
});

describe('the reads', () => {
	it('asks for the open pull request from the release branch into the base', async () => {
		const asked = [];
		const get = async (path, token) => {
			asked.push([path, token]);
			return [{ number: 1590, user: { login: 'github-actions[bot]', id: 41898282, type: 'Bot' } }];
		};
		const found = await openVersionPr(
			{ repository: 'lushly-dev/afd', base: 'main', token: 't' },
			get
		);
		assert.deepEqual(found, { number: 1590, ...ACTIONS_BOT });
		assert.deepEqual(asked, [
			[
				'/repos/lushly-dev/afd/pulls?state=open&base=main&head=lushly-dev%3Achangeset-release%2Fmain',
				't',
			],
		]);
		assert.equal(releaseBranch('main'), 'changeset-release/main');
		assert.equal(releaseBranch('main', 'npm-main'), 'changeset-release/npm-main');
		assert.equal(releaseBranch('main', 'npm-prerelease'), 'changeset-release/npm-prerelease');
	});

	it('answers null when no version pull request is open, and fails on anything but a list', async () => {
		const none = await openVersionPr(
			{ repository: 'lushly-dev/afd', base: 'main', token: 't' },
			async () => []
		);
		assert.equal(none, null);
		await assert.rejects(
			openVersionPr({ repository: 'lushly-dev/afd', base: 'main', token: 't' }, async () => ({
				message: 'Bad credentials',
			})),
			/not a list/
		);
	});

	it("reads the App's bot user by its slug", async () => {
		const asked = [];
		const bot = await appBot({ slug: 'afd-release', token: 't' }, async (path) => {
			asked.push(path);
			return { login: 'afd-release[bot]', id: 987654, type: 'Bot' };
		});
		assert.deepEqual(bot, APP);
		assert.deepEqual(asked, ['/users/afd-release%5Bbot%5D']);
	});
});

const ENV = { GH_TOKEN: 't', GITHUB_REPOSITORY: 'lushly-dev/afd', GITHUB_REF_NAME: 'main' };
const PULLS = '/repos/lushly-dev/afd/pulls?state=open';

/**
 * GitHub as the entry points read it. `open`: the open version pull request's author, or none;
 * `commits`: what GitHub lists on it; `fail`: a path prefix whose read fails.
 */
function github({ open = null, commits = [], fail = null } = {}) {
	const asked = [];
	const get = async (path) => {
		asked.push(path);
		if (fail && path.startsWith(fail)) throw new Error(`GET ${path}: 502 Bad Gateway`);
		if (path.startsWith(PULLS)) return open ? [{ number: open.number, user: open }] : [];
		if (path === '/users/afd-release%5Bbot%5D') return { ...APP, type: 'Bot' };
		if (path === `/repos/lushly-dev/afd/pulls/${open?.number}/commits?per_page=100`) return commits;
		throw new Error(`GET ${path}: 404 Not Found`);
	};
	return { get, asked };
}

/** Runs the entry point the workflow runs, and records what it would set in git. */
async function set(env, world) {
	const set = [];
	const logged = [];
	await setAuthor(
		{ ...ENV, ...env },
		{
			get: world.get,
			git: (key, value) => set.push([key, value]),
			log: (line) => logged.push(line),
		}
	);
	return { set, logged };
}

describe('setAuthor, the step before the Changesets action', () => {
	const actions = [
		['user.name', 'github-actions[bot]'],
		['user.email', ACTIONS_EMAIL],
	];
	const app = [
		['user.name', 'afd-release[bot]'],
		['user.email', APP_EMAIL],
	];

	it('sets github-actions[bot] for the pull request GITHUB_TOKEN opened, App token or not', async () => {
		const open = { number: 1590, ...ACTIONS_BOT };
		assert.deepEqual((await set({}, github({ open }))).set, actions);
		const world = github({ open });
		assert.deepEqual((await set({ APP_SLUG: 'afd-release' }, world)).set, actions);
		assert.equal(world.asked.length, 1, 'the App is not asked for when a pull request is open');
	});

	it("sets the App's identity for the pull request the App opened", async () => {
		const open = { number: 1700, ...APP, type: 'Bot' };
		assert.deepEqual((await set({ APP_SLUG: 'afd-release' }, github({ open }))).set, app);
		// Even on a run whose App token could not be created.
		assert.deepEqual((await set({ APP_SLUG: '' }, github({ open }))).set, app);
	});

	it("sets the App's identity when none is open and the App's token will open one", async () => {
		const world = github();
		const { set: written, logged } = await set({ APP_SLUG: 'afd-release' }, world);
		assert.deepEqual(written, app);
		assert.deepEqual(world.asked.slice(1), ['/users/afd-release%5Bbot%5D']);
		assert.match(logged.at(-1), /afd-release\[bot\] <987654\+afd-release\[bot\]@users/);
	});

	it('sets github-actions[bot] when none is open and GITHUB_TOKEN will open one', async () => {
		assert.deepEqual((await set({}, github())).set, actions);
		assert.deepEqual((await set({ APP_SLUG: '' }, github())).set, actions);
	});

	it('warns, and commits as the bot, when a person opened the pull request', async () => {
		const open = { number: 12, login: 'someone', id: 77, type: 'User' };
		const { set: written, logged } = await set({ APP_SLUG: 'afd-release' }, github({ open }));
		assert.deepEqual(written, actions);
		assert.match(logged[0], /^::warning::Version pull request #12 was opened by someone/);
	});

	it('sets nothing when a read fails', async () => {
		for (const [env, world] of [
			[{}, github({ fail: PULLS })],
			[{ APP_SLUG: 'afd-release' }, github({ fail: '/users/' })],
		]) {
			const written = [];
			await assert.rejects(
				setAuthor(
					{ ...ENV, ...env },
					{ get: world.get, git: (...pair) => written.push(pair), log: () => {} }
				),
				/502 Bad Gateway/
			);
			assert.deepEqual(written, []);
		}
	});

	it('sets nothing without the facts it reads by', async () => {
		const written = [];
		await assert.rejects(
			setAuthor(
				{ GH_TOKEN: 't', GITHUB_REPOSITORY: 'lushly-dev/afd' },
				{ get: github().get, git: (...pair) => written.push(pair), log: () => {} }
			),
			/must be set/
		);
		assert.deepEqual(written, []);
	});
	it('supports --branch, --route, RELEASE_PR_BRANCH, RELEASE_ROUTE, and rejects missing flag values', async () => {
		for (const [args, env, expectedHead] of [
			[['--route', 'npm-prerelease'], {}, 'lushly-dev%3Achangeset-release%2Fnpm-prerelease'],
			[['--branch', 'changeset-release/custom'], {}, 'lushly-dev%3Achangeset-release%2Fcustom'],
			[[], { RELEASE_ROUTE: 'npm-main' }, 'lushly-dev%3Achangeset-release%2Fnpm-main'],
			[
				[],
				{ RELEASE_PR_BRANCH: 'changeset-release/env-branch' },
				'lushly-dev%3Achangeset-release%2Fenv-branch',
			],
		]) {
			const world = github();
			await setAuthor({ ...ENV, ...env }, { args, get: world.get, git: () => {}, log: () => {} });
			assert.equal(
				world.asked[0],
				`/repos/lushly-dev/afd/pulls?state=open&base=main&head=${expectedHead}`
			);
		}
		for (const badArgs of [['--branch'], ['--route'], ['--branch', '--verify']]) {
			await assert.rejects(
				setAuthor(ENV, { args: badArgs, get: github().get, git: () => {}, log: () => {} }),
				/Missing value for/
			);
		}
	});
});

describe('verifyAuthor, the step after it', () => {
	const commit = (login, sha = 'abcdef0123456789') => ({
		sha,
		author: login ? { login } : null,
		commit: { author: { name: 'github-actions[bot]', email: ACTIONS_EMAIL } },
	});
	const verify = (world) => verifyAuthor(ENV, { get: world.get, log: () => {} });

	it('passes when GitHub credits every commit to the pull request author', async () => {
		const open = { number: 1590, ...ACTIONS_BOT };
		assert.deepEqual(await verify(github({ open, commits: [commit('github-actions[bot]')] })), []);
	});

	it('names a commit by another account: the pull request changed hands mid-run', async () => {
		// The App opened the replacement, and the commit was made for the one that was closed.
		const open = { number: 1700, ...APP, type: 'Bot' };
		const problems = await verify(github({ open, commits: [commit('github-actions[bot]')] }));
		assert.deepEqual(problems, [
			'commit abcdef01 is by github-actions[bot], and pull request #1700 was opened by afd-release[bot]',
		]);
	});

	it('names a commit GitHub ties to no account', async () => {
		const open = { number: 1590, ...ACTIONS_BOT };
		const [problem] = await verify(github({ open, commits: [commit(null)] }));
		assert.match(
			problem,
			/is by github-actions\[bot\] <41898282.*>, which GitHub ties to no account/
		);
	});

	it("names the bot's commit on a pull request a person opened", async () => {
		const open = { number: 12, login: 'someone', id: 77, type: 'User' };
		const problems = await verify(github({ open, commits: [commit('github-actions[bot]')] }));
		assert.equal(problems.length, 1);
		assert.match(problems[0], /#12 was opened by someone/);
	});

	it('has nothing to check when no version pull request is open', async () => {
		assert.deepEqual(await verify(github()), []);
	});

	it('fails on a failed read instead of passing', async () => {
		const open = { number: 1590, ...ACTIONS_BOT };
		await assert.rejects(
			verify(github({ open, fail: '/repos/lushly-dev/afd/pulls/1590/' })),
			/502/
		);
		await assert.rejects(verify(github({ fail: PULLS })), /502/);
	});
});

/** Serves `routes` (path prefix to JSON) as GitHub's API for the duration of `use`. */
async function withGithub(routes, use) {
	const server = createServer((request, response) => {
		const hit = Object.entries(routes).find(([prefix]) => request.url.startsWith(prefix));
		response.writeHead(hit ? 200 : 404, { 'content-type': 'application/json' });
		response.end(JSON.stringify(hit ? hit[1] : { message: 'Not Found' }));
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	try {
		return await use(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((done) => server.close(done));
	}
}

/** Runs the script as release.yml does, in a new repository of its own: { code, stdout, stderr, config }. */
async function cli(args, env) {
	const directory = mkdtempSync(join(tmpdir(), 'release-pr-author-'));
	const clean = fixtureEnvironment();
	const git = (...argv) =>
		execFileAsync('git', argv, { cwd: directory, env: clean }).then(
			({ stdout }) => stdout.trim(),
			() => ''
		);
	try {
		await git('init', '--quiet', '.');
		const run = await execFileAsync(
			process.execPath,
			[join(root, 'scripts/release-pr-author.mjs'), ...args],
			{ cwd: directory, env: { ...clean, GH_TOKEN: '', APP_SLUG: '', ...env } }
		).then(
			({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
			({ code, stdout, stderr }) => ({ code, stdout, stderr })
		);
		return {
			...run,
			config: [
				await git('config', '--local', 'user.name'),
				await git('config', '--local', 'user.email'),
			],
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe('the command line release.yml runs', () => {
	const pulls = (user) => ({ '/repos/lushly-dev/afd/pulls?': [{ number: 1700, user }] });
	const opened = { ...APP, type: 'Bot' };
	const commits = (login) => ({
		'/repos/lushly-dev/afd/pulls/1700/commits': [
			{
				sha: 'abcdef0123456789',
				author: { login },
				commit: { author: { name: login, email: 'x@example.invalid' } },
			},
		],
	});

	it('sets the identity in the checkout, and exits 0', async () => {
		const run = await withGithub(pulls(opened), (GITHUB_API_URL) =>
			cli([], { ...ENV, GITHUB_API_URL })
		);
		assert.equal(run.code, 0, run.stderr);
		assert.deepEqual(run.config, ['afd-release[bot]', APP_EMAIL]);
	});

	it("--verify sets nothing: it exits 0 when the commit is the author's and 1 when it is not", async () => {
		const agreed = await withGithub(
			{ ...commits('afd-release[bot]'), ...pulls(opened) },
			(GITHUB_API_URL) => cli(['--verify'], { ...ENV, GITHUB_API_URL })
		);
		assert.equal(agreed.code, 0, agreed.stderr);
		assert.deepEqual(agreed.config, ['', '']);

		const differs = await withGithub(
			{ ...commits('github-actions[bot]'), ...pulls(opened) },
			(GITHUB_API_URL) => cli(['--verify'], { ...ENV, GITHUB_API_URL })
		);
		assert.equal(differs.code, 1);
		assert.match(differs.stdout, /^::error::commit abcdef01 is by github-actions\[bot\]/m);
		assert.match(differs.stderr, /Co-authored-by/);
		assert.match(differs.stderr, /an author who did not open the pull request/);
		assert.deepEqual(differs.config, ['', '']);
	});

	it('exits 2 and sets nothing on a failed read, in either mode', async () => {
		for (const args of [[], ['--verify']]) {
			const run = await withGithub({}, (GITHUB_API_URL) => cli(args, { ...ENV, GITHUB_API_URL }));
			assert.equal(run.code, 2);
			assert.match(run.stderr, /release-pr-author: GET \/repos\/lushly-dev\/afd\/pulls\?.*: 404/);
			assert.deepEqual(run.config, ['', '']);
		}
	});

	it('exits 2 without the facts it reads by', async () => {
		const run = await cli(['--verify'], { GITHUB_REPOSITORY: 'lushly-dev/afd' });
		assert.equal(run.code, 2);
		assert.match(run.stderr, /must be set/);
	});
});

/** The steps of release.yml's `release` job, in order: [{ name, text }]. */
function releaseSteps() {
	const text = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
	const start = text.indexOf('\n  release:\n');
	const end = text.indexOf('\n  recover:\n');
	assert.ok(start > 0 && end > start, 'release.yml has a release job followed by recover');
	return text
		.slice(start, end)
		.split(/\n(?= {6}- )/)
		.slice(1)
		.map((step) => ({ name: /^\s+(?:- )?name: (.+)$/m.exec(step)?.[1] ?? '', text: step }));
}

describe('release.yml', () => {
	const steps = releaseSteps();
	/** A step's place in the job; a missing step fails here, not in a comparison with -1. */
	const at = (name) => {
		const index = steps.findIndex((step) => step.name === name);
		assert.ok(index >= 0, `release.yml has a step named "${name}"`);
		return index;
	};
	const MAIN_PR = 'Update npm-main release PR';
	const PRE_PR = 'Update npm-prerelease release PR';
	const condition = (name) => /^\s+if: (.+)$/m.exec(steps[at(name)].text)?.[1];

	it('updates npm-main and npm-prerelease version PRs after the release PR token and tag push', () => {
		assert.ok(at('Configure release tag author') < at(MAIN_PR));
		assert.ok(at('Push release tags and create GitHub Releases') < at(MAIN_PR));
		assert.ok(at('Create release pull request token') < at(MAIN_PR));
		assert.ok(at('Create release pull request token') < at(PRE_PR));
	});

	it('gates each route on its own selection output, runs npm-prerelease independently of npm-main, and lets neither fail quietly', () => {
		assert.equal(condition(MAIN_PR), "steps.selection.outputs.npm_main == 'true'");
		assert.equal(
			condition(PRE_PR),
			"${{ !cancelled() && steps.selection.outcome == 'success' && steps.selection.outputs.npm_prerelease == 'true' }}"
		);
		for (const name of [MAIN_PR, PRE_PR]) {
			assert.doesNotMatch(steps[at(name)].text, /continue-on-error/);
		}
	});

	it("passes the App token and slug to each route's version PR step", () => {
		for (const [name, route] of [
			[MAIN_PR, 'npm-main'],
			[PRE_PR, 'npm-prerelease'],
		]) {
			const step = steps[at(name)].text;
			assert.match(
				step,
				new RegExp(`run: node scripts/release-version-pr\\.mjs --route ${route}\\n`)
			);
			assert.match(
				step,
				/APP_SLUG: \$\{\{ steps\.pr-token\.outputs\.token != '' && steps\.pr-token\.outputs\.app-slug \|\| '' \}\}/
			);
			assert.match(step, /PR_TOKEN: \$\{\{ steps\.pr-token\.outputs\.token \}\}/);
		}
	});
});
