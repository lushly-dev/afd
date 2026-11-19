import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	agentCoAuthors,
	isAgentEmail,
	mainProblems,
	mergeGroupCommits,
	PUSH_EVENT_LIMIT,
	problems,
	pushedCommits,
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
	const push = (event) => {
		const directory = mkdtempSync(join(tmpdir(), 'commit-credit-'));
		const path = join(directory, 'event.json');
		writeFileSync(path, JSON.stringify(event));
		const done = spawnSync(process.execPath, [script, '--push-event'], {
			encoding: 'utf8',
			env: { ...process.env, GITHUB_EVENT_PATH: path },
		});
		rmSync(directory, { recursive: true, force: true });
		return done;
	};
	const pushed = (message) => ({ id: 'a1b2c3d4e5', message, author: owner, committer: owner });

	it('fails a push whose commit names a co-author, naming the commit and the line', () => {
		const done = push({ commits: [pushed('fix: y\n\nCo-authored-by: Owner <old@example.com>\n')] });
		assert.equal(done.status, 1);
		assert.match(done.stderr, /a1b2c3d4 has the line "Co-authored-by: Owner <old@example.com>"/);
		assert.match(done.stderr, /--body-file/);
	});
	it('passes a push whose commits credit only their authors', () => {
		const done = push({ commits: [pushed('fix: y\n\nAssisted-by: Claude Code\n')] });
		assert.equal(done.status, 0, done.stderr);
		assert.match(done.stdout, /1 commit\(s\) credit only their authors/);
	});
	it('refuses a push event that lists no commits rather than passing it', () => {
		const done = push({ commits: [] });
		assert.equal(done.status, 2);
		assert.match(done.stderr, /lists no commits/);
	});
});

describe('--merge-group', () => {
	const script = fileURLToPath(new URL('./commit-credit.mjs', import.meta.url));
	const base = 'b'.repeat(40);
	const head = 'c'.repeat(40);
	const queued = (sha, message, author = owner) => ({
		sha,
		commit: { message, author, committer: { name: 'GitHub', email: 'noreply@github.com' } },
	});
	const comparison = (commits, extra = {}) => ({
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

	it('reads the commits the group adds to its base, in one comparison', async () => {
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
			`https://api.github.com/repos/example/repo/compare/${base}...${head}?per_page=100&page=1`,
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
			/is not its base .* plus commits \(status diverged\)/
		);
		await assert.rejects(read([502]).commits, /compare\/.*: 502 nope/);
		await assert.rejects(read([comparison([])], { base: '' }).commits, /BASE_SHA must be/);
		await assert.rejects(read([comparison([])], { head: 'main' }).commits, /HEAD_SHA must be/);
	});

	/** Runs the script against a local server standing in for GitHub's API. */
	const run = async (body, environment = {}) => {
		const requests = [];
		const server = createServer((request, response) => {
			requests.push(request.url);
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(body));
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const child = spawn(process.execPath, [script, '--merge-group'], {
			env: {
				...process.env,
				GITHUB_TOKEN: 'token',
				GITHUB_REPOSITORY: 'example/repo',
				GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
				BASE_SHA: base,
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
		assert.deepEqual(done.requests, [
			`/repos/example/repo/compare/${base}...${head}?per_page=100&page=1`,
		]);
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
		const noBase = await run(comparison([queued(head, 'fix: y\n')]), { BASE_SHA: '' });
		assert.equal(noBase.status, 2);
		assert.match(noBase.stderr, /BASE_SHA must be a 40-character commit/);
		assert.deepEqual(noBase.requests, []);
	});
});
