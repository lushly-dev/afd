/**
 * @fileoverview Loam's internal kernel interface (current shape, version 5): the surface shared
 * between `@lushly-dev/loam-kernel` and its in-repository consumers (`chrome`, `web`, `host`,
 * `desktop`, `testing`). External wire/manifest/SDK/persisted contracts (`ScopeV1`, `IdentityV1`,
 * `ManifestV3`, `ResourceLinkV1`, etc.) keep their explicit version tags.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type {
	CommandError,
	CommandMiddleware,
	CommandResult,
	JournalSink,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DirectRegistryOptions } from '@lushly-dev/afd-server/direct';
import type {
	BootProjectionV2,
	IdentityV1,
	ManifestRefusal,
	ManifestV3,
	ProjectionMountedV1,
	ProjectionV4,
} from '@lushly-dev/loam-manifest';
import type {
	AppDefinitionV1,
	AppProjectV1,
	AppStoreV1,
	EventHintV1,
	EventKindV1,
	EventV1,
	LoamClientV1,
	OverlayAnchorV1,
	OverlayResultV1,
	ProjectSummaryV1,
	ResourceLinkV1,
	ResourceLinkV2,
	ScopeV1,
} from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { CopilotOptionsV1, CopilotTraceV1 } from './copilot/types.js';
import type { KeybindingInForceV1 } from './keybindings.js';
import type { MembershipV1 } from './scope/access.js';
import type { ProjectV1, ScopeChangeV2 } from './scope/records.js';
import type { ServerCallV1 } from './trust-records.js';

export type { MemberRoleV1, MembershipV1 } from './scope/access.js';
export type {
	AgentMemberV1,
	PersonaV1,
	ProjectAccessV1,
	ProjectV1,
	ScopeChangeV2,
	WorkspaceAppV1,
	WorkspaceV1,
} from './scope/records.js';
export type {
	EventHintV1,
	EventKindV1,
	EventV1,
	IdentityV1,
	ProjectSummaryV1,
	ResourceLinkV1,
	ResourceLinkV2,
	ScopeV1,
};

/** Current kernel interface version reported by `kernel.version` and `shell-info-get`. */
export const KERNEL_INTERFACE_VERSION = 6;

export interface LoamKernel {
	/** Bind the local chrome that can perform reserved keyboard actions. */
	bindShellKeys?(
		perform: (action: import('./keybindings.js').ShellKeyAction) => boolean
	): () => void;
	readonly version: typeof KERNEL_INTERFACE_VERSION;
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: CallOptions
	): Promise<CommandResult<T>>;
	listCommands(): CommandSummary[];
	subscribe(listener: (event: KernelEvent) => void): () => void;
	readonly agent: Pick<LoamKernel, 'call' | 'listCommands'>;
	/** Runs stage B once. The chrome calls it after the first frame; a call may start it sooner. */
	startApps(): Promise<void>;
	/** Resolves when stage B has ended, however it ended. Never rejects. */
	readonly appsReady: Promise<void>;
	/** Set when the late commands could not load. */
	readonly lateFailure?: CommandError;
	/**
	 * The port for one instance, for the chrome to give an app.
	 *
	 * @throws LoamKernelError `APP_NOT_FOUND` for an unknown instance, `APP_NOT_READY` for a refused
	 *   one, which has no manifest to render from
	 */
	appPort(instance: string): AppPort;
	/**
	 * The bindings in force, first to last by precedence (phase 4 specification, 8.1): a person's
	 * overrides, the reserved chords, the active app's, then the active tab owner's, each `when` the
	 * kernel decides holding.
	 */
	listKeybindings(): KeybindingInForceV1[];
	/** Calls `app-instance-refresh` for each mounted instance. The chrome calls it after first paint. */
	startInstances(): Promise<void>;
	/**
	 * Write pending view-state persistence now, without waiting for the debounce. The chrome calls it
	 * on `pagehide` and `visibilitychange` to hidden.
	 */
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

export interface CallOptions {
	signal?: AbortSignal;
	/** Default: the active scope. `'workspace'` is the active workspace with no project. */
	scope?: ScopeV1 | 'workspace';
	/**
	 * The agent interface's agent: 1 to 64 characters of `^[a-z0-9][a-z0-9-]*$`, default `shell-agent`,
	 * so it can never spell an `agt_` id; `local`, `signed-out` and `shell-agent` are reserved
	 * (`AGENT_NAME_RESERVED`). Read by `agent.call` alone: the palette's calls are the person's.
	 */
	agent?: string;
	/**
	 * The copilot's trace. Read only from the options object the kernel made for the agent port's
	 * half: on any other call it is ignored, so no caller can claim a session or a turn.
	 */
	trace?: CopilotTraceV1;
}

export interface CommandSummary {
	name: string;
	title?: string;
	description: string;
	mutation: boolean;
	needsInput: boolean;
	keybinding?: string;
	/** The owning instance. Absent for a shell command. */
	instance?: string;
}

export interface KernelEvent {
	command: string;
	interface: 'palette' | 'agent' | 'apps';
	success: boolean;
	mutation: boolean;
	seq?: number;
	caller?: string;
	instance?: string;
	/** The call's effective scope. */
	scope?: ScopeV1;
	/** The active scope changed in this call, by `applyScopeChange`. */
	scopeChanged?: ScopeChangeV2;
	/** Kernel interface 6 (phase 5 specification, 9.4): reserved for the shell's chrome; an app hears events only through its port's `onBusEvent`. */
	busEvent?: true;
	/** What main shows changed, and how the URL should follow. */
	mainChanged?: 'push' | 'replace';
	/**
	 * The document an instance command that is a mutation changed, when it succeeded, so every open
	 * editor of it re-reads.
	 */
	document?: string;
	/** The person the kernel decides for changed, by `session-settle`. */
	actorChanged?: true;
	/** The active persona changed. */
	personaChanged?: true;
	/** The settings sections whose values this call changed, by full id. */
	settings?: string[];
	/**
	 * A confirmation in the inbox was raised, answered or ended by this call, which may itself have
	 * failed, as a call answered `CONFIRMATION_PENDING` has: the Inbox count reads again.
	 */
	inbox?: true;
	/**
	 * An experiment's state for the person changed (`experimentsChanged`): the chrome renders the
	 * apps, their surfaces and the settings tree again, as gates decide what is present.
	 */
	experiments?: true;
}

export interface KernelEnvironment {
	matches(query: string): boolean;
	onChange(query: string, listener: () => void): () => void;
}

/** A tool as MCP lists it, as far as a mounted instance's discovery reads one. */
export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
	_meta?: Record<string, unknown>;
}

/** A tool's result as MCP returns it. */
export interface McpToolCallResult {
	content?: Array<{ type: string; text?: string }>;
	structuredContent?: unknown;
	isError?: boolean;
}

/** In the kernel: a mounted-instance transport port supplied by the host, carrying `_meta`. */
export interface MountTransport {
	/**
	 * The handshake. `approvals: true` is the transport's own word, never the server's, that this
	 * lane carries a person's approval to the server: only the desktop's `stdio` and `http` lanes
	 * opened on MCP 2026-07-28 say it.
	 */
	connect(signal?: AbortSignal): Promise<{ protocolVersion: string; approvals?: true }>;
	listTools(signal?: AbortSignal): Promise<McpTool[]>;
	callTool(
		name: string,
		args: unknown,
		signal?: AbortSignal,
		meta?: Record<string, unknown>
	): Promise<McpToolCallResult>;
	close(): Promise<void>;
	/** Kernel interface 6's (`MountTransportV3`, phase 5 specification, 9.3): the server's resources, `resources/list`. */
	listResources?(signal?: AbortSignal): Promise<Array<{ uri: string; mimeType?: string }>>;
	/** And one resource's contents, `resources/read`. Absent on a lane that reads none, as the hosted relay's. */
	readResource?(
		uri: string,
		signal?: AbortSignal
	): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }>;
}

/** Kernel interface 6's name for the transport with its resource reads (phase 5 specification, 9.4). */
export type MountTransportV3 = MountTransport;

/**
 * A message a frame sent that the kernel refused at the boundary, before anything read it: what a
 * request is answered with, `data: { code, suggestion, details }` and the JSON-RPC code.
 */
export interface FrameRefusal {
	code: string;
	message: string;
	suggestion: string;
	rpcCode: number;
	details?: Record<string, unknown>;
}

/**
 * The kernel's admission of each message a frame sends, as it arrives: undefined admits it; a
 * refusal drops it, answering a request with it and failing a reply's waiting request with it.
 */
export type FrameAdmit = (message: unknown) => FrameRefusal | undefined;

export interface HandlerFrame {
	/** Resolves with the frame's command names, from `dev.loam/handlers-ready`. */
	readonly ready: Promise<string[]>;
	call(
		request: { callId: string; command: string; input: unknown; context: unknown },
		signal?: AbortSignal
	): Promise<CommandResult>;
	/**
	 * The frame's `tools/call` and `dev.loam/store`, answered by the kernel. A refusal rejects with a
	 * `LoamKernelError`; its `details.rpcCode` is the JSON-RPC code to answer with, and its `code`
	 * and `suggestion` go in the error's `data`.
	 */
	onRequest(handler: (method: string, params: unknown) => Promise<unknown>): void;
	close(): void;
}

/** Every URL a port receives is absolute, resolved by the kernel against `baseUrl`. */
export interface KernelPorts {
	/** The document's base, which a package's relative path resolves against. */
	readonly baseUrl: string;
	fetchJson(url: string): Promise<unknown>;
	fetchText(url: string): Promise<string>;
	importNative(url: string): Promise<AppDefinitionV1>;
	/** `admit`, the kernel's gate on every message the frame sends. */
	openHandlerFrame(instance: string, html: string, admit?: FrameAdmit): Promise<HandlerFrame>;
	/** Mounted transport whose command calls carry `_meta`. */
	mountTransport(entry: ProjectionMountedV1, url: string): Promise<MountTransport>;
	/**
	 * Run `fn` at `at` on the kernel's clock, for the session's expiry timer and the membership
	 * read's timeout; tests with a fake. Absent, `identity/` uses `setTimeout`.
	 */
	schedule?(at: number, fn: () => void): () => void;
	/**
	 * The signed-in person's membership of the bound organization now, null for none, which the
	 * kernel reads again before an owner's command and on a change of person.
	 */
	readMembership?(): Promise<{ role: 'owner' | 'admin' | 'member'; digest: string } | null>;
	/**
	 * The host tells the kernel its membership may have changed, and the kernel reads it again.
	 * Returns an unsubscribe.
	 */
	watchMembership?(listener: () => void): () => void;
	/**
	 * Hosted trust-record transport: a trust-record command run on the hosted server, answered with
	 * the server's `CommandResult` unchanged and the person's snapshot digest after it.
	 */
	serverCall?: ServerCallV1;
}

/** What stage B reads: the validated projection and the ports, or why the reader refused it. */
export type AppsLoad =
	| { deployment: ProjectionV4; ports: KernelPorts }
	| {
			/** The reader's message: each entry is listed `failed` with `DEPLOYMENT_INVALID`. */
			refused: string;
	  };

/** Whether the page holds `data-loam-anchor="<anchor>"` inside `owner`'s surface. */
export interface OverlayAnchors {
	/** `owner` by kind, so an instance id never passes for the shell's own surface. */
	resolve?(owner: { kind: 'shell' | 'app'; id: string }, anchor: OverlayAnchorV1): boolean;
}

export interface LocalWorkspaceBackup {
	persistence: Promise<'persistent' | 'best-effort' | 'unavailable'>;
	export(): Promise<{ filename: string; records: number }>;
}

export interface KernelOptions {
	/** Backup and storage status are supplied by the local browser host. */
	localWorkspace?: LocalWorkspaceBackup;
	store: DataAdapter;
	/** `sqlite` is the hosted server's `SqliteAdapter`. */
	storeKind: 'memory' | 'indexeddb' | 'sqlite';
	journal: JournalSink;
	auth: AuthAdapter;
	environment: KernelEnvironment;
	host: 'browser' | 'desktop' | 'hosted' | 'test';
	commands?: ZodCommandDefinition[];
	clock?: () => number;
	random?: () => number;
	/** Required when `deployment` lists an app. */
	ports?: KernelPorts;
	/** With no `boot`: the validated projection, and `createKernel` runs stage B before it resolves. */
	deployment?: ProjectionV4;
	/** What `readBoot` read. With it, `createKernel` resolves after stage A. */
	boot?: BootProjectionV2;
	/** What stage B reads. Required with `boot` when it lists an app. */
	appsLoader?: () => Promise<AppsLoad>;
	/** The URL's project, by slug, for the first frame, or `null` for a workspace-level URL. */
	initialScope?: { project: string | null };
	/** The workspace when no `boot` or `deployment` names one. Default `{ id: 'personal', name: 'Personal' }`. */
	workspace?: { id: string; name: string };
	/** The deployment's identity. Default: the projection's, or `local`. */
	identity?: IdentityV1;
	/**
	 * Stage A's membership, from the probe. Read only when its `mode` is the identity's; a `provider`
	 * kernel given none decides with no members, so line 0 refuses every gated call until it has one.
	 */
	membership?: MembershipV1;
	/**
	 * The identity ports of a host whose apps' ports come from stage B's loader, as the web host's
	 * do: the expiry timer's `schedule`, the membership read and its watch. `ports` serves when absent.
	 */
	identityPorts?: Pick<
		KernelPorts,
		'schedule' | 'readMembership' | 'watchMembership' | 'serverCall'
	>;
	/** The deployment's copilot providers, never a key or an endpoint, and the host's runner. */
	copilot?: CopilotOptionsV1;
	/**
	 * The page's anchors for `popover-open`: the chrome sets `resolve` once it renders. Given and
	 * not yet set, no anchor resolves. Absent, as in a kernel with no page, every anchor does.
	 */
	overlayAnchors?: OverlayAnchors;
}

/** A call of one of a view app's commands, for the view its `tool_meta.ui.resourceUri` names. */
export interface LinkedCall {
	command: string;
	input: unknown;
	result: McpToolCallResult;
	/** The call's own signal, so the view that started a bound call can tell that call from another. */
	signal?: AbortSignal;
}

/**
 * What a view's requests reach, and the boundary they cross (D54). Each runs in the kernel, since a
 * view's input is untrusted. A refusal rejects as a frame's does ({@link HandlerFrame.onRequest}).
 */
export interface ViewBroker {
	/** `deployment.sandbox_origin`. Null only for an app that is `failed` with `VIEW_SANDBOX_ORIGIN_INVALID`. */
	readonly sandboxOrigin: string | null;
	/** `tools/call`, through the port's checks. */
	toolsCall(params: unknown): Promise<McpToolCallResult>;
	/** `resources/read`: only the app's own `ui.resources`. */
	resourcesRead(params: unknown): Promise<{
		contents: Array<{ uri: string; mimeType: string; text: string }>;
	}>;
	/** The main surface's bound command, with `{}`, as the app, so its result carries no `seq`. */
	runBound(command: string, signal: AbortSignal): Promise<McpToolCallResult>;
	/** Hear each finished call of a command linked to `uri`, from any interface. */
	onLinkedCall(uri: string, listener: (call: LinkedCall) => void): () => void;
	/**
	 * `dev.loam/overlay-result`, `{ overlayId }`: the answer to one of this app's own overlays, once
	 * it closes; another owner's is refused `OVERLAY_NOT_OWNER`.
	 */
	overlayResult?(params: unknown): Promise<OverlayResultV1>;
	/** The kernel's gate on every message the view's frame sends, which the chrome's channel calls first. */
	readonly admit?: FrameAdmit;
}

/** A surface's port: fixed to the scope it was created in (D83). */
export interface SurfaceOptions {
	/** Fixed for this surface's life. Only the chrome calls `surface`; an app never holds a port. */
	scope: ScopeV1;
	/** An embed: every mutation is `EMBED_READ_ONLY`. */
	readOnly?: boolean;
}

export interface SurfacePort {
	readonly scope: ScopeV1;
	readonly readOnly: boolean;
	/** `options.level: 'workspace'` is the only widening. Any other scope is `SCOPE_NOT_GRANTED`. */
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: { signal?: AbortSignal; level?: 'workspace' }
	): Promise<CommandResult<T>>;
	/** The view's broker, closed over this surface. Absent for any other kind. */
	readonly view?: ViewBroker;
}

/** The kernel's object for one app instance, which the chrome turns into the SDK's objects. */
export interface AppPort {
	readonly instance: string;
	/** The validated manifest: what the chrome renders from. */
	readonly manifest: ManifestV3;
	readonly config: Readonly<Record<string, unknown>>;
	readonly packageUrl: string;
	/** Imports the native module once. Rejects with `APP_HANDLER_MISSING` and sets `failed`. */
	load(): Promise<AppDefinitionV1>;
	/** Reads a file of the package, for a view's HTML. Only `ui.resources` paths and `view.handlers`. */
	readResource(uri: string): Promise<string>;
	/** The chrome's report that `activate` threw, since `activate` needs the DOM. */
	reportActivationFailed(message: string): void;
	call: LoamClientV1['call'];
	surface(options: SurfaceOptions): SurfacePort;
	waitOverlay(overlayId: string): Promise<OverlayResultV1>;
	/** For the chrome and tests, never given to an app's surface: a write here is not journaled. */
	readonly store?: AppStoreV1;
	/** A view app's broker. Absent for any other kind. */
	readonly view?: ViewBroker;
	/**
	 * Kernel interface 6 (phase 5 specification, 9.2): a wakeup when events this app may read are projected, filtered
	 * by `canSeeEvent` in the kernel and coalesced within a microtask, carrying only its readable kinds, instances and
	 * cursor; never called for an app without the `events` grant. `boundScope`, a surface's: another project's
	 * events are not its. Returns the unsubscribe.
	 */
	onBusEvent(listener: (hint: EventHintV1) => void, boundScope?: ScopeV1): () => void;
}

/** Base shell commands every app may call, passed by the app port into `appCallable`. */
export const APP_CALLABLE_SHELL_COMMANDS_BASE = [
	'toast-show',
	'modal-open',
	'overlay-dismiss',
	'overlay-list',
	'status-item-set',
	'app-selection-get',
	'app-selection-set',
	'appearance-get',
	'shell-info-get',
] as const;

/** All shell commands an app may call besides its own commands (subject to declared grants). */
export const APP_CALLABLE_SHELL_COMMANDS = [
	...APP_CALLABLE_SHELL_COMMANDS_BASE,
	'setting-get',
	'setting-list',
	'popover-open',
	'dialog-open',
	'prompt-open',
	'notification-push',
	'confirmation-get',
	'confirmation-withdraw',
	'experiment-check',
] as const;

/** Kernel interface 6's (phase 5 specification, 9.4): interface 4's, `event-list` and `shell-open`, whatever the grants. */
export const APP_CALLABLE_SHELL_COMMANDS_V3 = [
	...APP_CALLABLE_SHELL_COMMANDS,
	'event-list',
	'shell-open',
] as const;

export type AppBaseState = 'ready' | 'loading' | 'failed' | 'refused' | 'gated';
export type AppState = AppBaseState | 'disabled';
export type AppKind = 'native' | 'view' | 'mounted';

export interface AppSummary {
	instance: string;
	app: string;
	title: string;
	kind: AppKind;
	icon: string;
	order: number;
	state: AppState;
	scopeLevels: Array<'workspace' | 'project'>;
	rail: boolean;
	/** Whether it can open in the active scope, as the rail shows. */
	available: boolean;
	/** Its place in the person's own rail order, `loam.rail.order`, from 0, when the list names it. */
	railRank?: number;
	/** Set when `state` is `failed` or `refused`. */
	error?: CommandError;
}

export interface AppDetail extends Omit<AppSummary, 'state'> {
	state: AppBaseState;
	version: string;
	/** "Trusted, not sandboxed", "Sandboxed", or "External". */
	trust: 'trusted' | 'sandboxed' | 'external';
	trustLine: string;
	surfaces: string[];
	compositions: string[];
	grants: Array<{ name: string; required: boolean; served: boolean; reason: string }>;
	contexts: string[];
	skills: string[];
	warnings: ManifestRefusal[];
	notices: Array<{ code: string; message: string }>;
	/** Each status item's value, for the ones the app has set. */
	statusItems: Record<string, string>;
	/**
	 * Each gate the manifest declares on the app or a surface, with whether it is open for the person.
	 * A closed surface is left out of `surfaces`, so the chrome never creates it.
	 */
	gates: Record<string, { experiment: string; open: boolean }>;
}

/** Never a location, a credential or a command line. */
export interface AppInstance {
	instance: string;
	app: string;
	prefix: string;
	audience: 'team' | 'person';
	transport: 'http' | 'stdio';
	state: AppBaseState;
	protocolVersion?: string;
	toolStrategy?: string;
	commands: number;
	hidden: number;
	discoveredAt?: string;
	error?: CommandError;
	warnings: Array<{ code: string; message: string }>;
	notices: Array<{ code: string; message: string }>;
}

/** What the hosted lane passes to `createMcpHandler`. */
export interface KernelMcpOptions {
	/** Every registered command but `BOOT_ONLY` and `INTERNAL_COMMANDS`. */
	commands: readonly ZodCommandDefinition[];
	/** The auth middleware, the journal's, then the scope middleware: the kernel's own chain. */
	middleware: readonly CommandMiddleware[];
	/** `scope` alone: the other fields are set by trusted code, and a caller must not claim them. */
	contextFields: readonly ContextField[];
}

/** A declared context field, as `createMcpHandler` takes one. */
export type ContextField = NonNullable<DirectRegistryOptions['contextFields']>[number];

/** `app-selection-get`'s answer: the selected id and the level it was made at. */
export interface AppSelection {
	id: string | null;
	level: 'workspace' | 'project';
}

/** One app's row of `project-summary-get`: its summary, or why there is none. */
export interface ProjectSummaryRow {
	instance: string;
	title: string;
	icon: string;
	summary?: ProjectSummaryV1;
	/** How many of the summary's entries were malformed or over a bound, and dropped. */
	dropped?: number;
	error?: { code: string; message: string; suggestion: string };
}

/** `project-summary-get`'s answer: the project, through a port as an app sees it, and its rows. */
export interface ProjectSummaryResult {
	project: ProjectV1 | AppProjectV1;
	summaries: ProjectSummaryRow[];
}

/** What `shell-info-get` returns. */
export interface ShellInfo {
	kernelInterface: typeof KERNEL_INTERFACE_VERSION;
	layoutState: 0;
	storeInterface: 1;
	tokenContract: 1;
	manifestVersion: 3;
	appProtocol: 1;
	surfaceCatalog: 1;
	compositionLibrary: 1;
	sdk: 1;
	host: KernelOptions['host'];
	store: KernelOptions['storeKind'];
	/** The deployment's identity mode, and its bound organization's slug in `provider` mode. */
	identity: { mode: IdentityV1['mode']; organization: string | null };
}
