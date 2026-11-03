/**
 * @lushly-dev/loam-kernel: the registries with name refusal, kernel interface version 2, the shell
 * and app commands, the layout model, the palette index and the journal options (phase 0
 * specification, endpoints/loam/docs/phases/0-kernel-chrome/spec.md, sections 5 and 6; phase 1
 * specification, section 9). Replay, the journal diff and the reference workspace are in
 * `@lushly-dev/loam-kernel/testing`. No DOM dependency.
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
export { type AppCommandRowV1, type BootAppsOptions, bootApps } from './apps-runtime.js';
export {
	BOOT_ONLY,
	INTERNAL_COMMANDS,
	PALETTE_SEARCH_LIMIT,
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
	NEEDS_STAGE_B,
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
	firstLayoutOf,
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
// The index's values are late-only, so they are `@lushly-dev/loam-kernel/palette`'s, out of the root's graph
// (phase 2 specification, 2.4); its types stay here.
export type {
	PaletteEntry,
	PaletteField,
	PaletteIndex,
	PaletteItem,
} from './palette-index.js';
export { type AccessInputV1, decideAccess, LOCAL_ACTOR } from './scope/access.js';
export { MCP_CONTEXT_FIELDS, SCOPE_V1 } from './scope/field.js';
export { SHELL_COMMAND_NAMES } from './shell-command-names.js';
export { APPS_VIEW_STATE_ID, type MainStateV2, SCOPE_VIEW_STATE_ID } from './shell-state.js';
export {
	APP_CALLABLE_SHELL_COMMANDS_V1,
	type AppDetailV1,
	type AppInstanceV1,
	type AppKindV1,
	type AppPortV1,
	type AppPortV2,
	type AppStateV1,
	type AppStateV2,
	type AppSummaryV1,
	type AppSummaryV2,
	type AppsLoadV2,
	type CallOptionsV0,
	type CallOptionsV1,
	type CallOptionsV2,
	type CommandSummaryV0,
	type CommandSummaryV1,
	type HandlerFrameV1,
	KERNEL_INTERFACE_VERSION,
	type KernelEnvironmentV0,
	type KernelEventV0,
	type KernelEventV1,
	type KernelEventV2,
	type KernelMcpOptions,
	type KernelOptionsV0,
	type KernelOptionsV1,
	type KernelOptionsV2,
	type KernelPortsV1,
	type LinkedCallV1,
	type LoamKernelV0,
	type LoamKernelV1,
	type LoamKernelV2,
	type McpTool,
	type McpToolCallResult,
	type MountTransportV1,
	type MountTransportV2,
	type ProjectAccessV1,
	type ProjectV1,
	type ScopeChangeV2,
	type ScopeV1,
	type ShellInfoV0,
	type ShellInfoV1,
	type ShellInfoV2,
	type SurfaceOptionsV2,
	type SurfacePortV2,
	type ViewBrokerV1,
	type WorkspaceAppV1,
	type WorkspaceV1,
} from './types.js';
