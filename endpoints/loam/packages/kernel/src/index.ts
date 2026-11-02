/**
 * @lushly-dev/loam-kernel: the registries with name refusal, kernel interface version 1, the shell
 * and app commands, the layout model, the palette index and the journal options (phase 0
 * specification, endpoints/loam/docs/phases/0-kernel-chrome/spec.md, sections 5 and 6; phase 1
 * specification, section 9). Replay, the journal diff and the reference workspace are in
 * `@lushly-dev/loam-kernel/testing`. No DOM dependency.
 */

export type { AppCommandRowV1 } from './app-commands.js';
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
export {
	INTERNAL_COMMANDS,
	PALETTE_SEARCH_LIMIT,
	SHELL_COMMAND_NAMES,
	SHELL_EXPOSE,
} from './commands.js';
export { KERNEL_CONTEXT_FIELDS } from './context-fields.js';
export {
	kernelFailure,
	LoamKernelError,
	type LoamKernelErrorCode,
	type LoamKernelErrorInit,
} from './errors.js';
export {
	COMMAND_NAME_SUGGESTION,
	createKernel,
	type KernelInterfaceV0,
	kernelJournalOptions,
	redactJournalRecord,
	UNJOURNALED_COMMANDS,
} from './kernel.js';
export {
	type AppKeybinding,
	createKeybindings,
	type KeybindingRegistry,
	keybindingFor,
	SHELL_KEYBINDINGS_V0,
	type ShellKeybindingV0,
} from './keybindings.js';
export {
	appLayoutId,
	createDefaultLayout,
	LAYOUT_DEFAULTS_V0,
	LAYOUT_VIEW_STATE_ID,
	type LayoutPart,
	type LayoutPatchV0,
	type LayoutStateV0,
	type LayoutValidation,
	validateLayoutPatch,
	validateLayoutState,
} from './layout.js';
export { SHELL_OWNER, TOAST_CAP } from './overlays.js';
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
export { APPS_VIEW_STATE_ID } from './shell-state.js';
export {
	APP_CALLABLE_SHELL_COMMANDS_V1,
	type AppDetailV1,
	type AppInstanceV1,
	type AppKindV1,
	type AppPortV1,
	type AppStateV1,
	type AppSummaryV1,
	type CallOptionsV0,
	type CallOptionsV1,
	type CommandSummaryV0,
	type CommandSummaryV1,
	type HandlerFrameV1,
	KERNEL_INTERFACE_VERSION,
	type KernelEnvironmentV0,
	type KernelEventV0,
	type KernelEventV1,
	type KernelOptionsV0,
	type KernelOptionsV1,
	type KernelPortsV1,
	type LinkedCallV1,
	type LoamKernelV0,
	type LoamKernelV1,
	type McpTool,
	type McpToolCallResult,
	type MountTransportV1,
	type ShellInfoV0,
	type ShellInfoV1,
	type ViewBrokerV1,
} from './types.js';
