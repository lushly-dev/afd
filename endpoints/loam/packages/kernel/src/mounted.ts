/**
 * @fileoverview `@lushly-dev/loam-kernel/mounted` (phase 6 specification, 8.2): the parts of the mounted kind the hosted
 * relay runs in Node, so it decides exactly as the browser's kernel does, without the kernel root's other modules, which
 * assume a page. Each is the kernel's own, never a copy: discovery, the meta-tool filter, the projects and the pinned
 * space, the scope's schema, discovery's limits, and the access decision.
 */

export {
	type CatalogCommandV1,
	DISCOVERY_LIMITS,
	discoverInstance,
	type InstanceCatalogV1,
	isMetaTool,
	MOUNT_FAILURE_CODES,
	type MountFailureCode,
	type MountWarningV1,
	type PinnedInput,
	pinMountedInput,
	unlistedProject,
} from './apps/mounted.js';
export {
	type AccessActorV1,
	type AccessDecisionV2,
	decideAccess,
	type MemberRoleV1,
	type MembershipV1,
} from './scope/access.js';
export { SCOPE_V1 } from './scope/field.js';
export type { ProjectV1, ScopeV1, WorkspaceAppV1 } from './scope/records.js';
export type { McpTool, McpToolCallResult, MountTransport } from './types.js';
