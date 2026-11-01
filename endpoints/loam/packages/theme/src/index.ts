/**
 * @lushly-dev/loam-theme: Loam's Violet tree, its exports, the token contract and the token-only
 * lint (endpoints/loam/docs/phases/0-kernel-chrome/spec.md, section 2). Node only: the tree is
 * built with `@lushly-dev/violet-core` at build time. Browsers read the built files,
 * `dist/loam-theme.css` and `dist/loam-theme.json`, through this package's subpaths.
 */
export {
	type CheckReport,
	checkTheme,
	compareContract,
	compareLayoutDefaults,
	compareNodeIds,
} from './check.js';
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
