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
export {
	COMPARE_DATA_FILE,
	COMPARE_PAGE_FILE,
	readComparePageData,
	runCompare,
	selectCompareEntries,
} from './compare.js';
export { renderComparePageHtml } from './compare-page.js';
export type {
	ComponentCoverage,
	CoverageEvidence,
	CoverageLevel,
	CoverageObligation,
} from './coverage.js';
export { canonicalJson, diffObservations } from './diff.js';
export {
	defineGuideSource,
	type GuideSource,
	type GuideSourceContext,
	type GuideSourceRule,
} from './guide-source.js';
export type { SpecimenHostError } from './host.js';
export {
	defineJobSource,
	type JobSource,
	type JobSourceContext,
	parseJobScenarioWithSources,
} from './job-source.js';
export {
	type CheckpointCaptureInput,
	type FinalizeCheckpointsOptions,
	type FinalizeJobRunOptions,
	finalizeCheckpointsRun,
	finalizeJobRun,
	isObservationUnchanged,
	isValidClockPin,
	resolveJobCapturePlan,
	resolvePinnedBaseline,
	validateJobEntries,
	withJobValidation,
} from './jobs.js';
export { finiteValues, readManifest } from './manifest.js';
export { normalizeDom } from './normalize.js';
export {
	type CommandRunner,
	type ComponentSchema,
	type ComposedTokens,
	composeTokenMaps,
	definePlugin,
	type JobDriver,
	type JobDriverHost,
	type JobDriverResult,
	type JobDriverStepOutcome,
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
	CAPTURE_LABELS_FILE,
	CAPTURE_SETS_DIR,
	captureContentHash,
	captureLabelsPath,
	captureSetsDir,
	computeSetId,
	diffCaptures,
	entryKind,
	isCaptureRef,
	isValidLabel,
	LABEL_PATTERN,
	nearestSpecimenIds,
	readCaptureSetManifest,
	readSetCapture,
	resolveCaptureSetId,
	runCaptureSet,
	SET_ID_PATTERN,
	SPECIMEN_DATA_DIR,
	selectCaptureEntries,
	specimenDataDir,
	summarizeCaptureAxe,
	themeAvailabilityReason,
	updateCaptureSetLabel,
	type WriteCaptureSetItem,
	type WriteCaptureSetOptions,
	writeCaptureSet,
} from './sets.js';
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
