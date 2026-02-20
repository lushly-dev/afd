/**
 * @fileoverview Connector exports for CLI tool abstractions.
 */

export type {
	GitHubConnectorOptions,
	Issue,
	IssueCreateOptions,
	IssueFilters,
	PrCreateOptions,
	PullRequest,
} from './github.js';
export { GitHubConnector } from './github.js';
export type { PackageManager, PackageManagerConnectorOptions } from './package-manager.js';
export { PackageManagerConnector } from './package-manager.js';
