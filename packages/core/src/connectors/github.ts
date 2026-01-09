/**
 * @fileoverview GitHub connector for interacting with GitHub via the gh CLI.
 *
 * SECURITY: This connector NEVER logs stdout to prevent token exposure.
 */

import { exec, type ExecOptions, type ExecResult, isExecError } from '../platform.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Options for creating an issue */
export interface IssueCreateOptions {
	/** Issue title */
	title: string;
	/** Issue body/description */
	body: string;
	/** Repository in owner/repo format (uses current repo if not specified) */
	repo?: string;
	/** Labels to apply to the issue */
	labels?: string[];
	/** Project to add the issue to */
	project?: string;
}

/** Filters for listing issues */
export interface IssueFilters {
	/** Filter by state */
	state?: 'open' | 'closed' | 'all';
	/** Filter by label */
	label?: string;
	/** Filter by assignee */
	assignee?: string;
	/** Maximum number of issues to return */
	limit?: number;
}

/** Represents a GitHub issue */
export interface Issue {
	/** Issue number */
	number: number;
	/** Issue title */
	title: string;
	/** Issue state */
	state: 'open' | 'closed';
	/** URL to the issue */
	url: string;
}

/** Options for creating a pull request */
export interface PrCreateOptions {
	/** PR title */
	title: string;
	/** PR body/description */
	body: string;
	/** Source branch */
	head: string;
	/** Target branch (defaults to default branch) */
	base?: string;
	/** Create as draft PR */
	draft?: boolean;
}

/** Represents a GitHub pull request */
export interface PullRequest {
	/** PR number */
	number: number;
	/** PR title */
	title: string;
	/** PR state */
	state: 'open' | 'closed' | 'merged';
	/** URL to the PR */
	url: string;
}

/** Options for GitHubConnector */
export interface GitHubConnectorOptions {
	/** Enable debug logging of commands (never logs stdout for security) */
	debug?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GITHUB CONNECTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector for interacting with GitHub via the gh CLI.
 *
 * SECURITY: This connector NEVER logs stdout to prevent accidental
 * exposure of tokens or sensitive data from gh CLI output.
 *
 * @example
 * ```typescript
 * const gh = new GitHubConnector({ debug: true });
 *
 * // Create an issue
 * const issueNum = await gh.issueCreate({
 *   title: 'Bug report',
 *   body: 'Description of the bug',
 *   labels: ['bug']
 * });
 *
 * // List issues
 * const issues = await gh.issueList('owner/repo', { state: 'open', limit: 10 });
 * ```
 */
export class GitHubConnector {
	private options?: GitHubConnectorOptions;

	constructor(options?: GitHubConnectorOptions) {
		this.options = options;
	}

	/**
	 * Create a new issue.
	 *
	 * @param opts - Issue creation options
	 * @returns Issue number on success, or throws on failure
	 */
	async issueCreate(opts: IssueCreateOptions): Promise<number> {
		const cmd: string[] = ['gh', 'issue', 'create', '--title', opts.title, '--body', opts.body];

		if (opts.repo) {
			cmd.push('--repo', opts.repo);
		}

		if (opts.labels && opts.labels.length > 0) {
			for (const label of opts.labels) {
				cmd.push('--label', label);
			}
		}

		if (opts.project) {
			cmd.push('--project', opts.project);
		}

		const result = await this.execGh(cmd);

		if (isExecError(result)) {
			throw new Error(`Failed to create issue: ${result.stderr || result.errorCode}`);
		}

		// Parse issue number from URL in stdout (e.g., https://github.com/owner/repo/issues/123)
		const match = result.stdout.match(/\/issues\/(\d+)/);
		if (!match || !match[1]) {
			throw new Error('Could not parse issue number from gh output');
		}

		return parseInt(match[1], 10);
	}

	/**
	 * List issues from a repository.
	 *
	 * @param repo - Repository in owner/repo format
	 * @param filters - Optional filters
	 * @returns Array of issues
	 */
	async issueList(repo: string, filters?: IssueFilters): Promise<Issue[]> {
		const cmd: string[] = [
			'gh',
			'issue',
			'list',
			'--repo',
			repo,
			'--json',
			'number,title,state,url',
		];

		if (filters?.state) {
			cmd.push('--state', filters.state);
		}

		if (filters?.label) {
			cmd.push('--label', filters.label);
		}

		if (filters?.assignee) {
			cmd.push('--assignee', filters.assignee);
		}

		if (filters?.limit) {
			cmd.push('--limit', String(filters.limit));
		}

		const result = await this.execGh(cmd);

		if (isExecError(result)) {
			throw new Error(`Failed to list issues: ${result.stderr || result.errorCode}`);
		}

		const issues = JSON.parse(result.stdout) as Array<{
			number: number;
			title: string;
			state: string;
			url: string;
		}>;

		return issues.map((issue) => ({
			number: issue.number,
			title: issue.title,
			state: issue.state.toLowerCase() as 'open' | 'closed',
			url: issue.url,
		}));
	}

	/**
	 * Create a new pull request.
	 *
	 * @param opts - PR creation options
	 * @returns PR number on success, or throws on failure
	 */
	async prCreate(opts: PrCreateOptions): Promise<number> {
		const cmd: string[] = ['gh', 'pr', 'create', '--title', opts.title, '--body', opts.body];

		cmd.push('--head', opts.head);

		if (opts.base) {
			cmd.push('--base', opts.base);
		}

		if (opts.draft) {
			cmd.push('--draft');
		}

		const result = await this.execGh(cmd);

		if (isExecError(result)) {
			throw new Error(`Failed to create PR: ${result.stderr || result.errorCode}`);
		}

		// Parse PR number from URL in stdout (e.g., https://github.com/owner/repo/pull/123)
		const match = result.stdout.match(/\/pull\/(\d+)/);
		if (!match || !match[1]) {
			throw new Error('Could not parse PR number from gh output');
		}

		return parseInt(match[1], 10);
	}

	/**
	 * List pull requests from a repository.
	 *
	 * @param repo - Repository in owner/repo format
	 * @param filters - Optional filters (reuses IssueFilters for similar fields)
	 * @returns Array of pull requests
	 */
	async prList(repo: string, filters?: IssueFilters): Promise<PullRequest[]> {
		const cmd: string[] = [
			'gh',
			'pr',
			'list',
			'--repo',
			repo,
			'--json',
			'number,title,state,url',
		];

		if (filters?.state && filters.state !== 'all') {
			cmd.push('--state', filters.state);
		}

		if (filters?.label) {
			cmd.push('--label', filters.label);
		}

		if (filters?.assignee) {
			cmd.push('--assignee', filters.assignee);
		}

		if (filters?.limit) {
			cmd.push('--limit', String(filters.limit));
		}

		const result = await this.execGh(cmd);

		if (isExecError(result)) {
			throw new Error(`Failed to list PRs: ${result.stderr || result.errorCode}`);
		}

		const prs = JSON.parse(result.stdout) as Array<{
			number: number;
			title: string;
			state: string;
			url: string;
		}>;

		return prs.map((pr) => ({
			number: pr.number,
			title: pr.title,
			state: pr.state.toLowerCase() as 'open' | 'closed' | 'merged',
			url: pr.url,
		}));
	}

	/**
	 * Execute a gh command.
	 *
	 * SECURITY: This method enables debug logging for commands but
	 * NEVER logs stdout to prevent token exposure.
	 */
	private execGh(cmd: string[]): Promise<ExecResult> {
		// Only pass debug flag for command logging, never log stdout
		const execOptions: ExecOptions = {};
		if (this.options?.debug) {
			execOptions.debug = true;
		}
		return exec(cmd, execOptions);
	}
}
