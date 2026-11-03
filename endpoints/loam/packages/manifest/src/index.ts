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
	SHELL_DOMAINS_V1,
	SHELL_RESERVED_CHORDS_V1,
	SURFACE_CATALOG_V1,
	type SurfaceEntry,
	TRUST_LINES_V1,
} from './catalogs.js';
export { forInterfaceOne } from './interface-one.js';
export { LAYOUT_DEFAULTS_V0, type LayoutDefaultsV0 } from './layout-defaults.js';
export type {
	DeploymentRead,
	DeploymentRefusal,
	DeploymentRefusalCode,
	DeploymentV1,
	ManifestRead,
	ManifestRefusal,
	ManifestRefusalCode,
	ManifestV1,
	ManifestV2,
	ProjectionAppV1,
	ProjectionMountedV1,
	ProjectionRead,
	ProjectionV1,
	Refusal,
} from './types.js';
