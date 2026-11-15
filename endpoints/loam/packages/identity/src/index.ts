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
export { JOIN_INVITATION_MS, joinLink } from './enrolment.js';
export { createOrganizationHooks } from './hooks.js';
export type { RecoveryV1 } from './members.js';
export {
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
