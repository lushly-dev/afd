/**
 * @lushly-dev/loam-kernel: the registries with name refusal, current kernel interface (version 5),
 * shell and domain commands organized by domain (`scope/`, `overlays/`, `apps/`, `documents/`,
 * `identity/`, `settings/`, `copilot/`, `inbound/`, `server/`), the layout model, the palette index
 * and the journal options. Replay, the journal diff and the reference workspace are in
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
export type {
	AccountV1,
	AgentMemberRowV1,
	LoamAccountAccessV1,
	LoamAuthAdapter,
	MemberInvitationV1,
	MemberV1,
	OwnInvitationV1,
} from './identity/member-commands.js';
export {
	COMMAND_NAME_SUGGESTION,
	createKernel,
	// The server's kernel (phase 3 specification, 9.5): `loam-identity`'s `createServerKernel` builds it with
	// `gate: 'principal'`; a browser builds its kernel with `createKernel`.
	createKernelParts,
	type KernelInterface,
	type KernelParts,
	type KernelPartsOptions,
	kernelJournalOptions,
	NEEDS_STAGE_B,
	redactJournalRecord,
	UNJOURNALED_COMMANDS,
} from './kernel.js';
export {
	type AppKeybinding,
	createKeybindings,
	type KeybindingContextV1,
	type KeybindingEntryV1,
	type KeybindingInForceV1,
	type KeybindingInfoV1,
	type KeybindingOverrideV1,
	type KeybindingRegistry,
	type KeybindingResolverV1,
	type KeybindingSourceV1,
	type KeybindingV1,
	keybindingFor,
	type ResolvedKeybindingsV1,
	SHELL_KEY_ACTIONS,
	SHELL_KEYBINDINGS_V0,
	type ShellKeyAction,
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
export { SHELL_OWNER, TOAST_CAP } from './overlays/store.js';
// The index's values are late-only, so they are `@lushly-dev/loam-kernel/palette`'s, out of the root's graph;
// its types stay here.
export type {
	PaletteEntry,
	PaletteField,
	PaletteIndex,
	PaletteItem,
} from './palette-index.js';
export {
	type AccessActorV1,
	type AccessDecisionV2,
	type AccessInputV2,
	decideAccess,
	LOCAL_ACTOR,
	type MemberRoleV1,
	type MembershipV1,
	personKey,
} from './scope/access.js';
export { MCP_CONTEXT_FIELDS, SCOPE_V1 } from './scope/field.js';
export { personalRecordId } from './scope/personal.js';
export type { KernelPrincipalV1, PrincipalInputV1 } from './scope/principal.js';
export { SHELL_COMMAND_NAMES } from './shell-command-names.js';
export { APPS_VIEW_STATE_ID, type MainStateV2, SCOPE_VIEW_STATE_ID } from './shell-state.js';
// Phase 6's trust records: the routed list and the transport's shapes, for the hosts.
export {
	canonicalJson,
	SERVER_COMMANDS,
	type ServerCallAnswerV1,
	type ServerCallRequestV1,
	type ServerCallV1,
	type ServerCommandV1,
	TRUST_RECORDS_MAX_BYTES,
	type TrustRecordSettleInputV1,
	type TrustRecordSnapshotV1,
} from './trust-records.js';
export {
	type AgentMemberV1,
	APP_CALLABLE_SHELL_COMMANDS,
	APP_CALLABLE_SHELL_COMMANDS_BASE,
	APP_CALLABLE_SHELL_COMMANDS_V3,
	type AppBaseState,
	type AppDetail,
	type AppInstance,
	type AppKind,
	type AppPort,
	type AppSelection,
	type AppState,
	type AppSummary,
	type AppsLoad,
	type CallOptions,
	type CommandSummary,
	type ContextField,
	type EventHintV1,
	type EventKindV1,
	type EventV1,
	type FrameAdmit,
	type FrameRefusal,
	type HandlerFrame,
	type IdentityV1,
	KERNEL_INTERFACE_VERSION,
	type KernelEnvironment,
	type KernelEvent,
	type KernelMcpOptions,
	type KernelOptions,
	type KernelPorts,
	type LinkedCall,
	type LoamKernel,
	type LocalWorkspaceBackup,
	type McpTool,
	type McpToolCallResult,
	type MountedUiSlotV1,
	type MountTransport,
	type OverlayAnchors,
	type PersonaV1,
	type ProjectAccessV1,
	type ProjectSummaryResult,
	type ProjectSummaryRow,
	type ProjectSummaryV1,
	type ProjectV1,
	type ResourceLinkV1,
	type ResourceLinkV2,
	type ScopeChangeV2,
	type ScopeV1,
	type ShellInfo,
	type SurfaceOptions,
	type SurfacePort,
	type ViewBroker,
	type WorkspaceAppV1,
	type WorkspaceV1,
} from './types.js';
