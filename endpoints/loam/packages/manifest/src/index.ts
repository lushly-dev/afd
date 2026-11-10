/**
 * @fileoverview `@lushly-dev/loam-manifest`: the catalogs and the types. The root imports no
 * validator, so the shell can read them before first paint; the readers are at `/validate`.
 */

export { AFD_CONTRACT } from './_generated/facts.js';
export {
	COMPOSITIONS_V1,
	type CompositionEntry,
	GRANT_CATALOG_V1,
	type GrantEntry,
	ICONS_V1,
	NOTICES_V1,
	SERVED_GRANTS_V2,
	SHELL_DOMAINS_V1,
	SHELL_RESERVED_CHORDS_V1,
	SURFACE_CATALOG_V1,
	type SurfaceEntry,
	TRUST_LINES_V1,
} from './catalogs.js';
export { LAYOUT_DEFAULTS_V0, type LayoutDefaultsV0 } from './layout-defaults.js';
export { needsInputShape } from './needs-input.js';
// Stage A's reader, in first paint: it holds no validator (phase 2 specification, 2.2).
export {
	type BootAppV2,
	type BootProjectionV2,
	type BootRefusalV2,
	type IdentityMethodV1,
	type IdentityV1,
	readBoot,
} from './read-boot.js';
export type {
	DeploymentRead,
	DeploymentRefusal,
	DeploymentRefusalCode,
	DeploymentV1,
	DeploymentV2,
	DeploymentV3,
	DeploymentWorkspaceV2,
	ManifestRead,
	ManifestRefusal,
	ManifestRefusalCode,
	ManifestV1,
	ManifestV2,
	ProjectionAppV1,
	ProjectionAppV2,
	ProjectionBootV2,
	ProjectionMountedV1,
	ProjectionRead,
	ProjectionV1,
	ProjectionV2,
	ProjectionV3,
	Refusal,
} from './types.js';
