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
	keybindingWhenProblem,
	NOTICES_V1,
	SERVED_GRANTS_V2,
	SHELL_DOMAINS_V1,
	SHELL_RESERVED_CHORDS_V1,
	SURFACE_CATALOG_V1,
	type SurfaceEntry,
	TRUST_LINES_V1,
} from './catalogs.js';
// Phase 4's experiments (its 5.1, 5.3): the declaration, the gated surfaces and every gate a manifest declares.
export {
	type ExperimentStageV1,
	type ExperimentV1,
	GATED_SURFACES_V1,
	gatesOf,
	isExperimentDate,
	MANIFEST_EXPERIMENTS_MAX,
} from './experiments.js';
export { LAYOUT_DEFAULTS_V0, type LayoutDefaultsV0 } from './layout-defaults.js';
export { needsInputShape } from './needs-input.js';
// Stage A's reader, in first paint: it holds no validator (phase 2 specification, 2.2).
export {
	type BootAppV2,
	type BootProjectionV2,
	type BootRefusalV2,
	type CopilotProjectionProviderV1,
	type CopilotProjectionV1,
	copilotOf,
	type IdentityMethodV1,
	type IdentityV1,
	readBoot,
} from './read-boot.js';
// Phase 4's settings (its 3.1): the types, and the check of a value the kernel's `late-settings` chunk shares.
export {
	checkSettingValue,
	keyLevels,
	MANIFEST_SETTINGS_MAX,
	SETTING_LEVELS_V1,
	SETTING_SECTION_MAX_BYTES,
	type SettingKeyV1,
	type SettingLevelV1,
	type SettingSchemaV1,
	type SettingSectionV1,
} from './settings.js';
export { saysShellName } from './shell-name.js';
export type {
	DeploymentRead,
	DeploymentRefusal,
	DeploymentRefusalCode,
	DeploymentV1,
	DeploymentV2,
	DeploymentV3,
	DeploymentV4,
	DeploymentWorkspaceV2,
	HostKindV1,
	ManifestRead,
	ManifestRefusal,
	ManifestRefusalCode,
	ManifestV1,
	ManifestV2,
	ManifestV3,
	ProjectionAppV1,
	ProjectionAppV2,
	ProjectionAppV4,
	ProjectionBootV2,
	ProjectionMountedV1,
	ProjectionRead,
	ProjectionV1,
	ProjectionV2,
	ProjectionV3,
	ProjectionV4,
	Refusal,
} from './types.js';
