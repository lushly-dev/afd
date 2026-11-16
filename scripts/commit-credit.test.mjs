import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentCoAuthors, isAgentEmail, problems } from './commit-credit.mjs';

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
