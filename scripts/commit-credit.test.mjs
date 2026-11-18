import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	agentCoAuthors,
	isAgentEmail,
	mainProblems,
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
