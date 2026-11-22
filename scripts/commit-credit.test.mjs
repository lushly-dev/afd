import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	agentCoAuthors,
	isAgentEmail,
	MAIN_FIX,
	MAIN_REBASE_FIX,
	mainProblems,
	mergeGroupCommits,
	onMainFix,
	PUSH_EVENT_LIMIT,
	problems,
	pushedCommits,
	QUEUE_FIX,
	QUEUE_REBASE_FIX,
	queueMergeMethod,
	rebaseProblems,
} from './commit-credit.mjs';

const owner = { name: 'Owner', email: 'owner@example.com' };

describe('isAgentEmail', () => {
	it('matches Anthropic and OpenAI agent addresses', () => {
		assert.ok(isAgentEmail('noreply@anthropic.com'));
		assert.ok(isAgentEmail('Codex@users.noreply.github.com'));
		assert.ok(isAgentEmail('codex@openai.com'));
	});
	it('leaves people and automation bots alone', () => {
		assert.ok(!isAgentEmail('owner@example.com'));
		assert.ok(!isAgentEmail('49699333+dependabot[bot]@users.noreply.github.com'));
	});
});

describe('agentCoAuthors', () => {
	it('finds agent co-author trailers in either capitalisation', () => {
		const message =
			'feat: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nco-authored-by: Owner <owner@example.com>\n';
		assert.deepEqual(agentCoAuthors(message), [
			{ name: 'Claude Opus 5.5', email: 'noreply@anthropic.com' },
		]);
	});
	it('does not count an email-free Assisted-by trailer', () => {
		assert.deepEqual(agentCoAuthors('feat: x\n\nAssisted-by: Claude Code\n'), []);
	});
});

describe('problems', () => {
	it('passes a commit the owner authored with an Assisted-by trailer', () => {
		assert.deepEqual(
			problems({
				message: 'fix: y\n\nAssisted-by: Claude Code\n',
				author: owner,
				committer: owner,
			}),
			[]
		);
	});
	it('reports an agent author, committer and co-author', () => {
		const agent = { name: 'Claude', email: 'noreply@anthropic.com' };
		const found = problems({
			message: 'fix: y\n\nCo-authored-by: Claude <noreply@anthropic.com>\n',
			author: agent,
			committer: agent,
		});
		assert.equal(found.length, 3);
		assert.match(found[0], /^author is Claude/);
		assert.match(found[1], /^committer is Claude/);
		assert.match(found[2], /^Co-authored-by names Claude/);
	});
});

describe('mainProblems', () => {
	it('passes a commit on main that credits only its author', () => {
		const message =
			'fix: y (#1)\n\nGitHub adds a Co-authored-by line otherwise.\n\nAssisted-by: Codex\n';
		assert.deepEqual(mainProblems({ message, author: owner, committer: owner }), []);
	});
	it("reports a person's co-author line, which the pull request check allows", () => {
		const message =
			'fix: y (#1)\n\nAssisted-by: Claude Code\n\n---------\n\nCo-authored-by: Owner <old@example.com>\n';
		const commit = { message, author: owner, committer: owner };
		assert.deepEqual(problems(commit), []);
		assert.deepEqual(mainProblems(commit), [
			'has the line "Co-authored-by: Owner <old@example.com>"',
		]);
	});
	it("passes the line GitHub adds naming the commit's own author, and only that one", () => {
		const bot = {
			name: 'github-actions[bot]',
			email: '41898282+github-actions[bot]@users.noreply.github.com',
		};
		const own = `Co-authored-by: github-actions[bot] <${bot.email}>`;
		const message = `chore: release packages (#1590)\n\n${own}\n`;
		const check = (text, author = bot) => mainProblems({ message: text, author, committer: owner });
		assert.deepEqual(check(message), []);
		assert.deepEqual(check(`chore: x\n\n${own.toUpperCase()}  \n`), []);
		const other = 'Co-authored-by: Owner <owner@example.com>';
		assert.deepEqual(check(`${message}${other}\n`), [`has the line "${other}"`]);
		// A second address in the name part is someone else, whichever address GitHub takes.
		for (const name of ['Claude <noreply@anthropic.com>', 'Mallory <mallory@example.com>']) {
			const two = `Co-authored-by: ${name} <${bot.email}>`;
			assert.deepEqual(check(`chore: x\n\n${two}\n`), [`has the line "${two}"`]);
		}
		assert.equal(check(`chore: x\n\n  ${own}\n`).length, 1);
		for (const malformed of [
			`Co-authored-by:x<${bot.email}>z`,
			`Co-authored-by: <${bot.email}>`,
			`Co-authored-by:  <${bot.email}>`,
			`Co-authored-by: bot < ${bot.email} >`,
			'Co-authored-by: bot <>',
		]) {
			assert.equal(check(`chore: x\n\n${malformed}\n`).length, 1, malformed);
		}
		assert.equal(
			check('chore: x\n\nCo-authored-by: bot < >\n', { name: 'x', email: ' ' }).length,
			1
		);
		assert.deepEqual(check(message, null), [`has the line "${own}"`]);
		assert.deepEqual(check(message, { name: 'x', email: '' }), [`has the line "${own}"`]);
	});
	it('reports every co-author line however it is written, and an agent once', () => {
		const agent = { name: 'Claude', email: 'noreply@anthropic.com' };
		const message =
			'fix: y\n\nCO-AUTHORED-BY: botcore-factory\n  co-authored-by: Claude <noreply@anthropic.com>\nCo-authored-by : Owner\n';
		const found = mainProblems({ message, author: agent, committer: owner });
		assert.equal(found.length, 4);
		assert.match(found[0], /^author is Claude/);
		assert.equal(found[1], 'has the line "CO-AUTHORED-BY: botcore-factory"');
		assert.equal(found[2], 'has the line "co-authored-by: Claude <noreply@anthropic.com>"');
		assert.equal(found[3], 'has the line "Co-authored-by : Owner"');
	});
});

describe('pushedCommits', () => {
	const commit = (id) => ({ id, message: 'fix: y\n', author: owner, committer: owner });
	it('reads every commit of a push that ends at its head', () => {
		const commits = pushedCommits({ after: 'b2', commits: [commit('a1'), commit('b2')] });
		assert.deepEqual(
			commits.map(({ sha }) => sha),
			['a1', 'b2']
		);
	});
	it('refuses a list that may be cut short rather than checking part of it', () => {
		assert.throws(
			() => pushedCommits({ after: 'c3', commits: [commit('a1'), commit('b2')] }),
			/may not list every commit/
		);
		const full = Array.from({ length: PUSH_EVENT_LIMIT }, (_, n) => commit(`s${n}`));
		assert.throws(
			() => pushedCommits({ after: `s${PUSH_EVENT_LIMIT - 1}`, commits: full }),
			/may not list every commit/
		);
	});
	it('refuses an event that is not a push', () => {
		assert.throws(() => pushedCommits({ pull_request: {} }), /not a push event/);
	});
});

describe('--push-event', () => {
	const script = fileURLToPath(new URL('./commit-credit.mjs', import.meta.url));
	const queue = (merge_method) => [{ type: 'merge_queue', parameters: { merge_method } }];
	/** Runs the script on a push event, as main-credit.yml does (no token), against a local
	 * server standing in for GitHub's API that answers the branch's rules with `rules`. */
	const push = async (event, rules = queue('SQUASH'), environment = {}) => {
		const directory = mkdtempSync(join(tmpdir(), 'commit-credit-'));
		const path = join(directory, 'event.json');
		writeFileSync(path, JSON.stringify(event));
		const requests = [];
		const server = createServer((request, response) => {
			requests.push({ url: request.url, authorization: request.headers.authorization });
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(rules));
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const { GITHUB_TOKEN: _token, ...inherited } = process.env;
		const child = spawn(process.execPath, [script, '--push-event'], {
			env: {
				...inherited,
				GITHUB_EVENT_PATH: path,
				GITHUB_REPOSITORY: 'example/repo',
				GITHUB_REF_NAME: 'main',
				GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
				...environment,
			},
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		const status = await new Promise((done) => child.on('close', done));
		await new Promise((done) => server.close(done));
		rmSync(directory, { recursive: true, force: true });
		return { status, stdout, stderr, requests };
	};
	const pushed = (message) => ({ id: 'a1b2c3d4e5', message, author: owner, committer: owner });
	const credited = { commits: [pushed('fix: y\n\nCo-authored-by: Owner <old@example.com>\n')] };

	it('fails a push whose commit names a co-author, naming the commit, the line and the fix', async () => {
		const done = await push(credited);
		assert.equal(done.status, 1);
		assert.match(done.stderr, /a1b2c3d4 has the line "Co-authored-by: Owner <old@example.com>"/);
		assert.match(done.stderr, /The merge queue's ci-ok refuses such a squash/);
		// The rules of the pushed branch, read without a token, as main-credit.yml has none.
		assert.deepEqual(done.requests, [
			{ url: '/repos/example/repo/rules/branches/main?per_page=100', authorization: undefined },
		]);
	});
	it("names the rebase fix when main's queue rebases, and both when it cannot tell", async () => {
		const rebasing = await push(credited, queue('REBASE'));
		assert.equal(rebasing.status, 1);
		assert.match(rebasing.stderr, /the merge queue rebases, so main receives each commit as it is/);
		assert.doesNotMatch(rebasing.stderr, /squash/);
		const unread = await push(credited, queue('REBASE'), { GITHUB_REF_NAME: '' });
		assert.equal(unread.status, 1);
		assert.match(unread.stderr, /how main's queue merges could not be read/);
		assert.match(unread.stderr, /If main's merge queue squashes:[\s\S]*If it rebases:/);
		assert.deepEqual(unread.requests, []);
	});
	it('passes a push whose commits credit only their authors, reading nothing', async () => {
		const done = await push({ commits: [pushed('fix: y\n\nAssisted-by: Claude Code\n')] });
		assert.equal(done.status, 0, done.stderr);
		assert.match(done.stdout, /1 commit\(s\) credit only their authors/);
		assert.deepEqual(done.requests, []);
	});
	it('refuses a push event that lists no commits rather than passing it', async () => {
		const done = await push({ commits: [] });
		assert.equal(done.status, 2);
		assert.match(done.stderr, /lists no commits/);
	});
});

describe('--merge-group', () => {
	const script = fileURLToPath(new URL('./commit-credit.mjs', import.meta.url));
	const base = 'refs/heads/main';
	const head = 'c'.repeat(40);
	const queued = (sha, message, author = owner) => ({
		sha,
		commit: { message, author, committer: { name: 'GitHub', email: 'noreply@github.com' } },
	});
	const comparison = (commits, extra = {}) => ({
		merge_base_commit: { sha: 'b'.repeat(40) },
		status: 'ahead',
		behind_by: 0,
		total_commits: commits.length,
		commits,
		...extra,
	});
	/** A fake GitHub that answers each read in turn and records what was asked. */
	const github = (answers) => {
		const urls = [];
		let index = 0;
		return {
			urls,
			fetchImpl: async (url) => {
				urls.push(url);
				const answer = answers[Math.min(index++, answers.length - 1)];
				if (typeof answer === 'number')
					return { ok: false, status: answer, text: async () => 'nope', json: async () => ({}) };
				return { ok: true, json: async () => answer };
			},
		};
	};
	const read = (answers, overrides = {}) => {
		const fake = github(answers);
		return {
			fake,
			commits: mergeGroupCommits({
				repository: 'example/repo',
				base,
				head,
				token: 'token',
				fetchImpl: fake.fetchImpl,
				...overrides,
			}),
		};
	};

	it('reads the commits the group holds that its branch does not, in one comparison', async () => {
		const squash = queued(head, 'feat: x (#7)\n\nAssisted-by: Claude Code\n');
		const { fake, commits } = read([comparison([squash])]);
		assert.deepEqual(await commits, [
			{
				sha: head,
				message: squash.commit.message,
				author: owner,
				committer: squash.commit.committer,
			},
		]);
		assert.deepEqual(fake.urls, [
			`https://api.github.com/repos/example/repo/compare/main...${head}?per_page=100&page=1`,
		]);
	});

	it("finds the co-author line GitHub writes into the queue's squash, a person's included", async () => {
		const { commits } = read([
			comparison([
				queued('a'.repeat(40), 'fix: first in the queue (#6)\n'),
				queued(head, 'feat: x (#7)\n\n* feat: x\n\nCo-authored-by: Owner <old@example.com>\n'),
			]),
		]);
		const found = (await commits).map((commit) => mainProblems(commit));
		assert.deepEqual(found, [[], ['has the line "Co-authored-by: Owner <old@example.com>"']]);
	});

	it('follows the pages of a long group and refuses a list that stops short', async () => {
		const first = Array.from({ length: 100 }, (_, index) =>
			queued(String(index).padStart(40, '0'), 'fix: y\n')
		);
		const pages = [
			comparison(first, { total_commits: 101 }),
			comparison([queued(head, 'fix: last\n')], { total_commits: 101 }),
		];
		const whole = read(pages);
		assert.equal((await whole.commits).length, 101);
		assert.match(whole.fake.urls[1], /&page=2$/);
		// The branch moved between the pages: they are pages of two comparisons.
		await assert.rejects(
			read([pages[0], { ...pages[1], merge_base_commit: { sha: 'e'.repeat(40) } }]).commits,
			/main moved while the merge group c{40} was being read \(b{40} then e{40}\)/
		);
		await assert.rejects(
			read([{ ...pages[0], merge_base_commit: undefined }]).commits,
			/main moved while the merge group/
		);
		// The second page comes back empty: 100 of 101 is not the group.
		await assert.rejects(
			read([pages[0], comparison([], { total_commits: 101 })]).commits,
			/may not list every commit of the merge group \(100 of 101/
		);
	});

	it('refuses a group that is empty, ends elsewhere or is not its base plus commits', async () => {
		await assert.rejects(read([comparison([])]).commits, /may not list every commit/);
		await assert.rejects(
			read([comparison([queued('d'.repeat(40), 'fix: y\n')])]).commits,
			/may not list every commit/
		);
		await assert.rejects(
			read([comparison([queued(head, 'fix: y\n')], { status: 'diverged', behind_by: 2 })]).commits,
			/is not main plus commits \(status diverged\)/
		);
		await assert.rejects(read([502]).commits, /compare\/.*: 502 nope/);
		// The branch, never a commit: the commit a group was built on leaves out the groups ahead.
		for (const wrong of [
			'',
			'main',
			'b'.repeat(40),
			'refs/tags/v1',
			'refs/heads/a b',
			'refs/heads/../x?y',
		])
			await assert.rejects(
				read([comparison([])], { base: wrong }).commits,
				/BASE_REF must be/,
				wrong
			);
		const nested = read([comparison([queued(head, 'fix: y\n')])], {
			base: 'refs/heads/release/1.x',
		});
		await nested.commits;
		assert.match(nested.fake.urls[0], /\/compare\/release%2F1\.x\.\.\.c{40}\?/);
		await assert.rejects(read([comparison([])], { head: 'main' }).commits, /HEAD_SHA must be/);
	});

	/** Runs the script against a local server standing in for GitHub's API; `rules` answers the
	 * branch's rules, read only to name a failure's fix. */
	const run = async (
		body,
		environment = {},
		rules = [{ type: 'merge_queue', parameters: { merge_method: 'SQUASH' } }]
	) => {
		const requests = [];
		const server = createServer((request, response) => {
			requests.push(request.url);
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(request.url.includes('/rules/') ? rules : body));
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const child = spawn(process.execPath, [script, '--merge-group'], {
			env: {
				...process.env,
				GITHUB_TOKEN: 'token',
				GITHUB_REPOSITORY: 'example/repo',
				GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
				BASE_REF: base,
				HEAD_SHA: head,
				...environment,
			},
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		const status = await new Promise((done) => child.on('close', done));
		await new Promise((done) => server.close(done));
		return { status, stdout, stderr, requests };
	};

	it('fails the group whose squash names a co-author, naming the commit, the line and the fix', async () => {
		const done = await run(
			comparison([queued(head, 'feat: x (#7)\n\nCo-authored-by: Owner <old@example.com>\n')])
		);
		assert.equal(done.status, 1, done.stderr);
		assert.match(done.stderr, /cccccccc has the line "Co-authored-by: Owner <old@example.com>"/);
		assert.match(done.stderr, /The pull request has left the queue/);
		assert.match(done.stderr, /GitHub writes the\nqueue's squash message/);
		// The rules are read only to name the fix, once the verdict is failed.
		assert.deepEqual(done.requests, [
			`/repos/example/repo/compare/main...${head}?per_page=100&page=1`,
			'/repos/example/repo/rules/branches/main?per_page=100',
		]);
	});
	it("names the rebase fix when main's queue rebases, and both when it cannot tell", async () => {
		const line = 'feat: x\n\nCo-authored-by: Owner <old@example.com>\n';
		const rebasing = await run(comparison([queued(head, line)]), {}, [
			{ type: 'merge_queue', parameters: { merge_method: 'REBASE' } },
		]);
		assert.equal(rebasing.status, 1, rebasing.stderr);
		assert.match(rebasing.stderr, /The queue rebases/);
		assert.doesNotMatch(rebasing.stderr, /queue's squash message/);
		const unread = await run(comparison([queued(head, line)]), {}, { message: 'x' });
		assert.equal(unread.status, 1, unread.stderr);
		assert.match(unread.stderr, /how main's queue merges could not be read/);
		assert.match(unread.stderr, /If main's merge queue squashes:[\s\S]*If it rebases:/);
	});
	it('fails the group whose squash an agent authored', async () => {
		const agent = { name: 'Claude', email: 'noreply@anthropic.com' };
		const done = await run(comparison([queued(head, 'feat: x (#7)\n', agent)]));
		assert.equal(done.status, 1, done.stderr);
		assert.match(done.stderr, /cccccccc author is Claude <noreply@anthropic.com>/);
	});
	it('passes a group whose commits credit only their authors', async () => {
		const done = await run(
			comparison([queued(head, 'feat: x (#7)\n\nAssisted-by: Claude Code\n')])
		);
		assert.equal(done.status, 0, done.stderr);
		assert.match(done.stdout, /1 commit\(s\) credit only their authors/);
	});
	it('refuses a group it cannot read whole rather than passing it', async () => {
		assert.equal((await run(comparison([]))).status, 2);
		const noBase = await run(comparison([queued(head, 'fix: y\n')]), { BASE_REF: '' });
		assert.equal(noBase.status, 2);
		assert.match(noBase.stderr, /BASE_REF must be the merge group's target branch/);
		assert.deepEqual(noBase.requests, []);
	});
});

describe('a pull request when the queue rebases', () => {
	const script = fileURLToPath(new URL('./commit-credit.mjs', import.meta.url));
	const answer = (body, status = 200) => ({
		ok: status === 200,
		status,
		text: async () => 'nope',
		json: async () => body,
	});
	const queue = (merge_method) => ({ type: 'merge_queue', parameters: { merge_method } });
	const method = (rules, status) =>
		queueMergeMethod({
			repository: 'example/repo',
			branch: 'main',
			token: 'token',
			fetchImpl: async (url) => {
				assert.equal(
					url,
					'https://api.github.com/repos/example/repo/rules/branches/main?per_page=100'
				);
				return answer(rules, status);
			},
		});

	it("reads the queue's merge method from the branch's rules", async () => {
		assert.equal(await method([{ type: 'pull_request' }, queue('REBASE')]), 'REBASE');
		assert.equal(await method([queue('SQUASH')]), 'SQUASH');
		assert.equal(await method([{ type: 'pull_request' }]), null);
	});
	it('sends a token only when it has one: a public repository answers without', async () => {
		const sent = [];
		const read = (token) =>
			queueMergeMethod({
				repository: 'example/repo',
				branch: 'main',
				token,
				fetchImpl: async (_url, init) => {
					sent.push(init.headers.authorization);
					return answer([queue('REBASE')]);
				},
			});
		assert.equal(await read(undefined), 'REBASE');
		assert.equal(await read('t'), 'REBASE');
		assert.deepEqual(sent, [undefined, 'Bearer t']);
	});
	it("names the fix for a co-author on main by how main's queue merges", () => {
		assert.equal(onMainFix('REBASE', false), MAIN_REBASE_FIX);
		assert.equal(onMainFix('REBASE', true), QUEUE_REBASE_FIX);
		assert.equal(onMainFix('SQUASH', false), MAIN_FIX);
		assert.equal(onMainFix('SQUASH', true), QUEUE_FIX);
		assert.equal(onMainFix(null, false), MAIN_FIX);
		// Unread: both, each under its case, so the reader is never told the wrong one alone.
		const both = onMainFix(undefined, true);
		assert.ok(both.includes(QUEUE_FIX) && both.includes(QUEUE_REBASE_FIX));
		assert.match(both, /^If main's merge queue squashes:\n/);
		assert.match(QUEUE_REBASE_FIX, /pnpm branch:squash/);
		assert.doesNotMatch(MAIN_REBASE_FIX, /squash instead/);
	});
	it('refuses rules it cannot read whole or that disagree, rather than guessing', async () => {
		await assert.rejects(method([], 404), /404/);
		await assert.rejects(method({ message: 'x' }), /not a whole list/);
		await assert.rejects(
			method(Array.from({ length: 100 }, () => ({ type: 'x' }))),
			/not a whole list/
		);
		await assert.rejects(method([queue('REBASE'), queue('SQUASH')]), /method is unclear/);
		await assert.rejects(method([queue(undefined)]), /method is unclear/);
		await assert.rejects(
			queueMergeMethod({ repository: 'example/repo', branch: '', token: 't', fetchImpl: () => {} }),
			/no branch named whose rules to read/
		);
	});

	const own = (sha, message, author = owner) => ({
		sha,
		message,
		author,
		committer: author,
		parents: ['p'],
	});
	const merge = (sha, author = owner) => ({
		...own(sha, 'Merge origin/main', author),
		parents: ['p', 'q'],
	});
	it('passes one commit of its own beside merges of main, which the rebase drops', () => {
		assert.deepEqual(
			rebaseProblems([own('a1', 'feat: x\n\nAssisted-by: Claude Code\n'), merge('m1')]),
			[]
		);
	});
	it('counts the commits of its own, and checks each as main would', () => {
		assert.deepEqual(
			rebaseProblems([
				own('a1', 'feat: x\n'),
				merge('m1'),
				own('a2', 'fix: y\n\nCo-authored-by: P <p@example.com>\n'),
			]),
			[
				{ sha: 'a2', problem: 'has the line "Co-authored-by: P <p@example.com>"' },
				{
					problem:
						'the pull request has 2 commits of its own, merges aside, and a rebase lands each on main',
				},
			]
		);
		assert.match(rebaseProblems([merge('m1')]).at(-1).problem, /has 0 commits of its own/);
		const agent = { name: 'Claude', email: 'noreply@anthropic.com' };
		assert.deepEqual(rebaseProblems([own('a1', 'feat: x\n'), merge('m1', agent)]), [
			{ sha: 'm1', problem: 'author is Claude <noreply@anthropic.com>' },
			{ sha: 'm1', problem: 'committer is Claude <noreply@anthropic.com>' },
		]);
	});

	/** Runs the script in pull request mode against a local stand-in for GitHub's API. */
	const run = async (rules, commits) => {
		const requests = [];
		const server = createServer((request, response) => {
			requests.push(request.url);
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(request.url.includes('/rules/') ? rules : commits));
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const child = spawn(process.execPath, [script], {
			env: {
				...process.env,
				GITHUB_TOKEN: 'token',
				GITHUB_REPOSITORY: 'example/repo',
				GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
				GITHUB_BASE_REF: 'main',
				PR_NUMBER: '7',
			},
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		const status = await new Promise((done) => child.on('close', done));
		await new Promise((done) => server.close(done));
		return { status, stdout, stderr, requests };
	};
	const listed = (sha, message, parents = ['p']) => ({
		sha,
		parents: parents.map((parent) => ({ sha: parent })),
		commit: { message, author: owner, committer: owner },
	});
	const two = [listed('a'.repeat(40), 'feat: x\n'), listed('b'.repeat(40), 'fix: y\n')];

	it('fails a pull request of two commits once the queue rebases, naming the fix', async () => {
		const done = await run([queue('REBASE')], two);
		assert.equal(done.status, 1, done.stderr);
		assert.match(done.stderr, /has 2 commits of its own/);
		assert.match(done.stderr, /pnpm branch:squash folds the branch/);
		assert.deepEqual(done.requests, [
			'/repos/example/repo/rules/branches/main?per_page=100',
			'/repos/example/repo/pulls/7/commits?per_page=100&page=1',
		]);
	});
	it('passes one commit of its own and a merge once the queue rebases', async () => {
		const done = await run(
			[queue('REBASE')],
			[two[0], listed('c'.repeat(40), 'Merge main', ['p', 'q'])]
		);
		assert.equal(done.status, 0, done.stderr);
		assert.match(done.stdout, /one commit of its own, which credits only its author/);
	});
	it('leaves a pull request of several commits alone while the queue squashes', async () => {
		const done = await run([queue('SQUASH')], two);
		assert.equal(done.status, 0, done.stderr);
		assert.match(done.stdout, /2 commit\(s\) credit only people/);
	});
	it('refuses when the rules cannot be read, rather than passing', async () => {
		const done = await run({ message: 'Not Found' }, two);
		assert.equal(done.status, 2);
		assert.match(done.stderr, /not a whole list/);
	});
});
