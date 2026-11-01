/**
 * @lushly-dev/loam-kernel: the registries with name refusal, kernel interface version 0, the
 * shell commands, the layout model, the palette index and the journal options (phase 0
 * specification, endpoints/loam/docs/phases/0-kernel-chrome/spec.md, sections 5 and 6). Replay,
 * the journal diff and the reference workspace are in `@lushly-dev/loam-kernel/testing`.
 * No DOM dependency.
 */

export {
	APPEARANCE_DENSITIES,
	APPEARANCE_QUERIES,
	APPEARANCE_THEMES,
	APPEARANCE_VIEW_STATE_ID,
	type AppearanceDensityV0,
	type AppearanceStateV0,
	type AppearanceThemeV0,
	type AppearanceV0,
	type AppearanceValidation,
	createDefaultAppearance,
	type ResolvedThemeV0,
	resolveTheme,
	validateAppearancePatch,
} from './appearance.js';
export { PALETTE_SEARCH_LIMIT, SHELL_COMMAND_NAMES, SHELL_EXPOSE } from './commands.js';
export { LoamKernelError, type LoamKernelErrorCode, type LoamKernelErrorInit } from './errors.js';
export {
	COMMAND_NAME_SUGGESTION,
	createKernel,
	type KernelInterfaceV0,
	kernelJournalOptions,
	redactJournalRecord,
	UNJOURNALED_COMMANDS,
} from './kernel.js';
export { keybindingFor, SHELL_KEYBINDINGS_V0, type ShellKeybindingV0 } from './keybindings.js';
export {
	createDefaultLayout,
	LAYOUT_DEFAULTS_V0,
	LAYOUT_VIEW_STATE_ID,
	type LayoutPatchV0,
	type LayoutStateV0,
	type LayoutValidation,
	validateLayoutPatch,
	validateLayoutState,
} from './layout.js';
export {
	createPaletteIndex,
	PALETTE_RUN_BONUS,
	PALETTE_WEIGHTS,
	PALETTE_WORD_START_BONUS,
	type PaletteEntry,
	type PaletteField,
	type PaletteIndex,
	type PaletteItem,
} from './palette-index.js';
export {
	type CallOptionsV0,
	type CommandSummaryV0,
	KERNEL_INTERFACE_VERSION,
	type KernelEnvironmentV0,
	type KernelEventV0,
	type KernelOptionsV0,
	type LoamKernelV0,
	type ShellInfoV0,
} from './types.js';
