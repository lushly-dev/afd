/**
 * @fileoverview Connector exports for CLI tool abstractions.
 *
 * Published as `@lushly-dev/afd-core/connectors`. Node.js only: the
 * connectors spawn processes through `node:child_process`.
 *
 * @example
 * ```typescript
 * import { GitHubConnector } from '@lushly-dev/afd-core/connectors';
 * ```
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
