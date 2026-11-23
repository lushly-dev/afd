export { createSpecimenBench, DiscoveryError, type SpecimenBench } from './bench.js';
export {
	climbElement,
	domAccessibleNameOf,
	domClimbNode,
	domRoleOf,
	elementRef,
	isDescendantOf,
	parentOrHost,
	resolveElementRef,
} from './browser/climb-dom.js';
export {
	type ClimbNode,
	type ClimbOptions,
	type ClimbResult,
	climbObservation,
	climbSelection,
	INTERACTIVE_ROLES,
	isMeaningfulNode,
	observationClimbTree,
} from './climb.js';
export type {
	ComponentCoverage,
	CoverageEvidence,
	CoverageLevel,
	CoverageObligation,
} from './coverage.js';
export { diffObservations } from './diff.js';
export {
	defineGuideSource,
	type GuideSource,
	type GuideSourceContext,
	type GuideSourceRule,
} from './guide-source.js';
export type { SpecimenHostError } from './host.js';
export { finiteValues, readManifest } from './manifest.js';
export { normalizeDom } from './normalize.js';
export {
	type CommandRunner,
	type ComponentSchema,
	type ComposedTokens,
	composeTokenMaps,
	definePlugin,
	type PropertySchema,
	type SchemaValue,
	type SpecimenPlugin,
	type ThemePreset,
	type ThemeTarget,
	type TokenMap,
} from './plugin.js';
export {
	DEFAULT_PIN,
	type FormatPointerInput,
	formatPointer,
	isValidElementRef,
	MAX_POINTER_TEXT_LENGTH,
	POINTER_INVALID,
	PointerError,
	type PointerPin,
	parsePointer,
	type SpecimenPointer,
} from './pointer.js';
export {
	DEFAULT_STORY_FILES,
	type Discovery,
	type DiscoveryProblem,
	declaredThemes,
	normalizeSpecifier,
	THEME_TAGS,
	UNSUPPORTED_ANNOTATIONS,
} from './stories.js';
export { DEFAULT_THEME_THRESHOLD } from './themes.js';
export * from './types.js';
