/**
 * @fileoverview `@lushly-dev/loam-identity` (phase 3 specification, 1): Loam's identity on the server.
 * Never imported by `web`, `chrome` or `kernel` (E13): a browser holds no provider's secret or database.
 */

export {
	BINDING_MODEL,
	type BindingAdapter,
	type BindingStatusV1,
	type BoundOrganizationV1,
	bindOrganization,
	type LoamBindingV1,
	type MembershipRowV1,
	membershipDigest,
	membershipOf,
	readBinding,
} from './binding.js';
export {
	type BootstrapInputV1,
	type BootstrapResultV1,
	bootstrapOrganization,
} from './bootstrap.js';
export {
	CONNECTED_ACCESS,
	type ConnectAgentInput,
	type ConnectedAgentV1,
	connectAgent,
	endConnections,
} from './connected-agents.js';
export { JOIN_INVITATION_MS, joinLink } from './enrolment.js';
export { createOrganizationHooks, type MemberRemovedV1 } from './hooks.js';
export {
	type AdmitPrincipal,
	createMcpAuth,
	credentialsGate,
	type McpAuthConfig,
	type McpProviderV1,
	principalOf,
	providerKeys,
} from './mcp.js';
export type { RecoveryV1 } from './members.js';
export {
	ACCESS_TOKEN_SECONDS,
	LOAM_SCOPES,
	type LoamOAuthConfig,
	OAUTH_CONSENT_PATH,
	OAUTH_LOGIN_PATH,
	OAUTH_SCOPES,
} from './oauth.js';
export {
	CLIENT_ADDRESS_HEADER,
	createLoamAuthOptions,
	FRESH_AGE_SECONDS,
	LOAM_DISABLED_PATHS,
	type LoamAuthConfig,
	type LoamMailV1,
	type LoamOidcProviderV1,
} from './options.js';
export { type LoamProviderState, loamServerPlugin } from './plugin.js';
export { RECOVERY_LINK_MS, recoveryLink } from './recovery.js';
export { isOwnerRole, loamAccessControl, loamRole, loamRoles } from './roles.js';
export {
	createNoSessionAdapter,
	createServerKernel,
	type ServerKernel,
	type ServerKernelOptions,
	serverAccountAccess,
} from './server.js';
