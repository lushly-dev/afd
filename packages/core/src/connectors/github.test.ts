import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubConnector } from './github.js';

// Mock the exec function from platform.ts
vi.mock('../platform.js', () => ({
	exec: vi.fn(),
	isExecError: vi.fn((result) => result.errorCode !== undefined),
}));

import { exec } from '../platform.js';

const mockExec = vi.mocked(exec);

describe('GitHubConnector', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('creates connector without options', () => {
			const connector = new GitHubConnector();
			expect(connector).toBeInstanceOf(GitHubConnector);
		});

		it('creates connector with debug option', () => {
			const connector = new GitHubConnector({ debug: true });
			expect(connector).toBeInstanceOf(GitHubConnector);
		});
	});

	describe('issueCreate', () => {
		it('builds correct command with required fields', async () => {
			mockExec.mockResolvedValue({
				stdout: 'https://github.com/owner/repo/issues/123',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			const issueNum = await connector.issueCreate({
				title: 'Test Issue',
				body: 'Issue body',
			});

			expect(mockExec).toHaveBeenCalledWith(
				['gh', 'issue', 'create', '--title', 'Test Issue', '--body', 'Issue body'],
				{}
			);
			expect(issueNum).toBe(123);
		});

		it('builds correct command with all optional fields', async () => {
			mockExec.mockResolvedValue({
				stdout: 'https://github.com/owner/repo/issues/456',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			await connector.issueCreate({
				title: 'Test Issue',
				body: 'Issue body',
				repo: 'owner/repo',
				labels: ['bug', 'high-priority'],
				project: 'My Project',
			});

			expect(mockExec).toHaveBeenCalledWith(
				[
					'gh',
					'issue',
					'create',
					'--title',
					'Test Issue',
					'--body',
					'Issue body',
					'--repo',
					'owner/repo',
					'--label',
					'bug',
					'--label',
					'high-priority',
					'--project',
					'My Project',
				],
				{}
			);
		});

		it('throws on exec error', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: 'Authentication failed',
				exitCode: 1,
				durationMs: 100,
				errorCode: 'EXIT_CODE' as const,
			});

			const connector = new GitHubConnector();

			await expect(
				connector.issueCreate({
					title: 'Test',
					body: 'Body',
				})
			).rejects.toThrow('Failed to create issue');
		});

		it('throws when cannot parse issue number', async () => {
			mockExec.mockResolvedValue({
				stdout: 'Invalid output without URL',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();

			await expect(
				connector.issueCreate({
					title: 'Test',
					body: 'Body',
				})
			).rejects.toThrow('Could not parse issue number');
		});

		it('enables debug logging when configured', async () => {
			mockExec.mockResolvedValue({
				stdout: 'https://github.com/owner/repo/issues/789',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector({ debug: true });
			await connector.issueCreate({
				title: 'Test',
				body: 'Body',
			});

			expect(mockExec).toHaveBeenCalledWith(expect.any(Array), { debug: true });
		});
	});

	describe('issueList', () => {
		it('builds correct command for listing issues', async () => {
			mockExec.mockResolvedValue({
				stdout: JSON.stringify([
					{ number: 1, title: 'Issue 1', state: 'OPEN', url: 'https://...' },
					{ number: 2, title: 'Issue 2', state: 'CLOSED', url: 'https://...' },
				]),
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			const issues = await connector.issueList('owner/repo');

			expect(mockExec).toHaveBeenCalledWith(
				['gh', 'issue', 'list', '--repo', 'owner/repo', '--json', 'number,title,state,url'],
				{}
			);
			expect(issues).toHaveLength(2);
			expect(issues[0]).toEqual({
				number: 1,
				title: 'Issue 1',
				state: 'open',
				url: 'https://...',
			});
		});

		it('applies filters correctly', async () => {
			mockExec.mockResolvedValue({
				stdout: '[]',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			await connector.issueList('owner/repo', {
				state: 'open',
				label: 'bug',
				assignee: 'user1',
				limit: 10,
			});

			expect(mockExec).toHaveBeenCalledWith(
				[
					'gh',
					'issue',
					'list',
					'--repo',
					'owner/repo',
					'--json',
					'number,title,state,url',
					'--state',
					'open',
					'--label',
					'bug',
					'--assignee',
					'user1',
					'--limit',
					'10',
				],
				{}
			);
		});

		it('throws on exec error', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: 'Repository not found',
				exitCode: 1,
				durationMs: 100,
				errorCode: 'EXIT_CODE' as const,
			});

			const connector = new GitHubConnector();

			await expect(connector.issueList('nonexistent/repo')).rejects.toThrow(
				'Failed to list issues'
			);
		});
	});

	describe('prCreate', () => {
		it('builds correct command with required fields', async () => {
			mockExec.mockResolvedValue({
				stdout: 'https://github.com/owner/repo/pull/42',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			const prNum = await connector.prCreate({
				title: 'My PR',
				body: 'PR description',
				head: 'feature-branch',
			});

			expect(mockExec).toHaveBeenCalledWith(
				[
					'gh',
					'pr',
					'create',
					'--title',
					'My PR',
					'--body',
					'PR description',
					'--head',
					'feature-branch',
				],
				{}
			);
			expect(prNum).toBe(42);
		});

		it('includes base and draft options', async () => {
			mockExec.mockResolvedValue({
				stdout: 'https://github.com/owner/repo/pull/99',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			await connector.prCreate({
				title: 'Draft PR',
				body: 'WIP',
				head: 'feature',
				base: 'develop',
				draft: true,
			});

			expect(mockExec).toHaveBeenCalledWith(
				[
					'gh',
					'pr',
					'create',
					'--title',
					'Draft PR',
					'--body',
					'WIP',
					'--head',
					'feature',
					'--base',
					'develop',
					'--draft',
				],
				{}
			);
		});

		it('throws on exec error', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: 'No commits between branches',
				exitCode: 1,
				durationMs: 100,
				errorCode: 'EXIT_CODE' as const,
			});

			const connector = new GitHubConnector();

			await expect(
				connector.prCreate({
					title: 'PR',
					body: 'Body',
					head: 'branch',
				})
			).rejects.toThrow('Failed to create PR');
		});
	});

	describe('prList', () => {
		it('builds correct command for listing PRs', async () => {
			mockExec.mockResolvedValue({
				stdout: JSON.stringify([{ number: 10, title: 'PR 1', state: 'OPEN', url: 'https://...' }]),
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector();
			const prs = await connector.prList('owner/repo');

			expect(mockExec).toHaveBeenCalledWith(
				['gh', 'pr', 'list', '--repo', 'owner/repo', '--json', 'number,title,state,url'],
				{}
			);
			expect(prs).toHaveLength(1);
			expect(prs[0].state).toBe('open');
		});

		it('throws on exec error', async () => {
			mockExec.mockResolvedValue({
				stdout: '',
				stderr: 'Error',
				exitCode: 1,
				durationMs: 100,
				errorCode: 'EXIT_CODE' as const,
			});

			const connector = new GitHubConnector();

			await expect(connector.prList('owner/repo')).rejects.toThrow('Failed to list PRs');
		});
	});

	describe('security: never logs stdout', () => {
		let consoleSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		});

		afterEach(() => {
			consoleSpy.mockRestore();
		});

		it('GitHubConnector with debug:true does not log stdout (sensitive data)', async () => {
			// Simulate stdout containing a token (which should never be logged)
			mockExec.mockResolvedValue({
				stdout: 'https://github.com/owner/repo/issues/1 token=secret_gh_abc123',
				stderr: '',
				exitCode: 0,
				durationMs: 100,
			});

			const connector = new GitHubConnector({ debug: true });
			await connector.issueCreate({ title: 'Test', body: 'Body' });

			// Debug logging happens in exec(), which we've mocked
			// The connector itself should never log stdout
			// This test verifies the connector doesn't directly log stdout
			for (const call of consoleSpy.mock.calls) {
				const message = String(call[0]);
				expect(message).not.toContain('secret_gh_abc123');
				expect(message).not.toContain('token=');
			}
		});
	});
});
