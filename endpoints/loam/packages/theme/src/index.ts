/**
 * @lushly-dev/loam-theme: Loam's Violet tree, its exports, the token contract and the token-only
 * lint (endpoints/loam/docs/phases/0-kernel-chrome/spec.md, section 2). Node only: the tree is
 * built with `@lushly-dev/violet-core` at build time. Browsers read the built files,
 * `dist/loam-theme.css` and `dist/loam-theme.json`, through this package's subpaths; the shared
 * components read the committed component export in `violet-elements` (2.4).
 */
export {
	type CheckOptions,
	type CheckReport,
	type ComponentPaths,
	checkTheme,
	compareComponentExport,
	compareContract,
	compareLayoutDefaults,
	compareNodeIds,
	sourceFiles,
} from './check.js';
export {
	COMPONENT_EXPORT_SOURCE,
	type ComponentExport,
	type Fallback,
	type FallbackMismatch,
	findFallbacks,
	fixFallbacks,
	lightValuesByProperty,
	normalizeLiteral,
	renderComponentExport,
	scanFallbacks,
} from './components.js';
export { composite, contrastRatio, parseColor, type Rgba } from './contrast.js';
export {
	type BrokenReference,
	buildOutputs,
	CONTRACT_VERSION,
	type Contract,
	type ContractEntry,
	cssProperty,
	type ResolvedTree,
	renderContract,
	renderCss,
	renderThemeJson,
	resolveTree,
	type ThemeOutputs,
	type Token,
	toJson,
} from './outputs.js';
export { CONTRAST_FLOORS, CONTRAST_PAIRS, type ContrastPair, type PairKind } from './pairs.js';
export * from './tree/index.js';
