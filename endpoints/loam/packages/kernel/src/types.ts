/**
 * @fileoverview Kernel interface version 2 (phase 2 specification, 11.1), and versions 1 (phase 1
 * specification, 9.1) and 0 (phase 0 specification, 6.2), which it extends: the only surface the chrome
 * binds to.
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
	ManifestRefusal,
	ManifestV1,
	ManifestV2,
	ProjectionMountedV1,
	ProjectionV1,
	ProjectionV2,
} from '@lushly-dev/loam-manifest';
import type {
	AppDefinitionV1,
	AppStoreV1,
	LoamClientV1,
	OverlayResultV1,
	ScopeV1,
} from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { ShellKeybindingV0 } from './keybindings.js';
import type { ScopeChangeV2 } from './scope/records.js';

export type {
	ProjectAccessV1,
	ProjectV1,
	ScopeChangeV2,
	WorkspaceAppV1,
	WorkspaceV1,
} from './scope/records.js';
export type { ScopeV1 };

export const KERNEL_INTERFACE_VERSION = 2;

export interface LoamKernelV0 {
	readonly version: 0;
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: CallOptionsV0
	): Promise<CommandResult<T>>;
	listCommands(): CommandSummaryV0[];
	subscribe(listener: (event: KernelEventV0) => void): () => void;
	readonly agent: Pick<LoamKernelV0, 'call' | 'listCommands'>;
	/**
	 * Write pending view-state persistence now, without waiting for the debounce. The chrome
	 * calls it on `pagehide` and `visibilitychange` to hidden (5.2; added by step 5, 6.7).
	 */
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

export interface CallOptionsV0 {
	signal?: AbortSignal;
}

export interface CommandSummaryV0 {
	name: string;
	title?: string;
	description: string;
	mutation: boolean;
	needsInput: boolean;
	keybinding?: string;
}

export interface KernelEventV0 {
	command: string;
	interface: 'palette' | 'agent';
	success: boolean;
	mutation: boolean;
	seq?: number;
}

export interface KernelEnvironmentV0 {
	matches(query: string): boolean;
	onChange(query: string, listener: () => void): () => void;
}

export interface KernelOptionsV0 {
	store: DataAdapter;
	storeKind: 'memory' | 'indexeddb';
	journal: JournalSink;
	auth: AuthAdapter;
	environment: KernelEnvironmentV0;
	host: 'browser' | 'desktop' | 'hosted' | 'test';
	commands?: ZodCommandDefinition[];
	clock?: () => number;
	random?: () => number;
}

/** What `shell-info-get` returns. */
export interface ShellInfoV0 {
	kernelInterface: 0;
	layoutState: 0;
	storeInterface: 0;
	tokenContract: 1;
	host: KernelOptionsV0['host'];
	store: KernelOptionsV0['storeKind'];
}

// ─── Version 1 ──────────────────────────────────────────────────────────────────

export interface LoamKernelV1 {
	readonly version: 1;
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: CallOptionsV1
	): Promise<CommandResult<T>>;
	listCommands(): CommandSummaryV1[];
	subscribe(listener: (event: KernelEventV1) => void): () => void;
	readonly agent: Pick<LoamKernelV1, 'call' | 'listCommands'>;
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
	appPort(instance: string): AppPortV1;
	/** The reserved chords, then the active app's bindings (4.2). */
	listKeybindings(): ShellKeybindingV0[];
	/** Calls `app-instance-refresh` for each mounted instance. The chrome calls it after first paint. */
	startInstances(): Promise<void>;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

export type CallOptionsV1 = CallOptionsV0;

export interface CommandSummaryV1 extends CommandSummaryV0 {
	/** The owning instance. Absent for a shell command. */
	instance?: string;
}

export interface KernelEventV1 extends KernelEventV0 {
	caller?: string;
	instance?: string;
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

/** In the kernel: a port the host supplies (7.3). */
export interface MountTransportV1 {
	connect(signal?: AbortSignal): Promise<{ protocolVersion: string }>;
	listTools(signal?: AbortSignal): Promise<McpTool[]>;
	callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpToolCallResult>;
	close(): Promise<void>;
}

/** Every URL a port receives is absolute, resolved by the kernel against `baseUrl` (9.5). */
export interface KernelPortsV1 {
	/** The document's base, which a package's relative path resolves against. */
	readonly baseUrl: string;
	fetchJson(url: string): Promise<unknown>;
	fetchText(url: string): Promise<string>;
	importNative(url: string): Promise<AppDefinitionV1>;
	openHandlerFrame(instance: string, html: string): Promise<HandlerFrameV1>;
	mountTransport(entry: ProjectionMountedV1, url: string): Promise<MountTransportV1>;
}

export interface HandlerFrameV1 {
	/** Resolves with the frame's command names, from `dev.loam/handlers-ready`. */
	readonly ready: Promise<string[]>;
	call(
		request: { callId: string; command: string; input: unknown; context: unknown },
		signal?: AbortSignal
	): Promise<CommandResult>;
	/**
	 * The frame's `tools/call` and `dev.loam/store`, answered by the kernel. A refusal rejects with a
	 * `LoamKernelError`; its `details.rpcCode` is the JSON-RPC code to answer with, and its `code` and
	 * `suggestion` go in the error's `data` (9.5).
	 */
	onRequest(handler: (method: string, params: unknown) => Promise<unknown>): void;
	close(): void;
}

export interface KernelOptionsV1 extends Omit<KernelOptionsV0, 'commands'> {
	commands?: ZodCommandDefinition[];
	/** The browser projection, already validated by the host through `readProjection` (9.4). */
	deployment?: ProjectionV1;
	/** Required when `deployment` lists an app. */
	ports?: KernelPortsV1;
	/**
	 * Why the host could not load what reads a deployment. Each entry of `deployment`, which then may be
	 * unread, is listed `failed` with this reason, and nothing else of it is used (D66).
	 */
	appsUnavailable?: string;
}

/** A call of one of a view app's commands, for the view its `tool_meta.ui.resourceUri` names (6.2). */
export interface LinkedCallV1 {
	command: string;
	input: unknown;
	result: McpToolCallResult;
	/** The call's own signal, so the view that started a bound call can tell that call from another. */
	signal?: AbortSignal;
}

/**
 * What a view's requests reach, and the boundary they cross (6.2; D54). Each runs in the kernel, since
 * a view's input is untrusted. A refusal rejects as a frame's does ({@link HandlerFrameV1.onRequest}).
 */
export interface ViewBrokerV1 {
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
	onLinkedCall(uri: string, listener: (call: LinkedCallV1) => void): () => void;
}

/** The kernel's object for one app instance, which the chrome turns into the SDK's objects (5.3). */
export interface AppPortV1 {
	readonly instance: string;
	/** The validated manifest: what the chrome renders from. */
	readonly manifest: ManifestV1;
	readonly config: Readonly<Record<string, unknown>>;
	readonly packageUrl: string;
	/** Imports the native module once. Rejects with `APP_HANDLER_MISSING` and sets `failed`. */
	load(): Promise<AppDefinitionV1>;
	/** Reads a file of the package, for a view's HTML. Only `ui.resources` paths and `view.handlers`. */
	readResource(uri: string): Promise<string>;
	/** The chrome's report that `activate` threw, since `activate` needs the DOM. */
	reportActivationFailed(message: string): void;
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: CallOptionsV1
	): Promise<CommandResult<T>>;
	waitOverlay(overlayId: string): Promise<OverlayResultV1>;
	/** For the chrome and tests, never given to an app's surface: a write here is not journaled. */
	readonly store?: AppStoreV1;
	/** A view app's broker. Absent for any other kind. */
	readonly view?: ViewBrokerV1;
}

/** What an app may call besides its own commands, until the `calls` grant in phase 5 (D68). */
export const APP_CALLABLE_SHELL_COMMANDS_V1 = [
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

export type AppStateV1 = 'ready' | 'loading' | 'failed' | 'refused';

export type AppKindV1 = 'native' | 'view' | 'mounted';

export interface AppSummaryV1 {
	instance: string;
	app: string;
	title: string;
	kind: AppKindV1;
	icon: string;
	order: number;
	state: AppStateV1;
	/** Set when `state` is `failed` or `refused`. */
	error?: CommandError;
}

export interface AppDetailV1 extends Omit<AppSummaryV2, 'state'> {
	state: AppStateV1;
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
	/** Each status item's value, for the ones the app has set (9.5). */
	statusItems: Record<string, string>;
}

/** Never a location, a credential or a command line. */
export interface AppInstanceV1 {
	instance: string;
	app: string;
	prefix: string;
	audience: 'team' | 'person';
	transport: 'http' | 'stdio';
	state: AppStateV1;
	protocolVersion?: string;
	toolStrategy?: string;
	commands: number;
	hidden: number;
	discoveredAt?: string;
	error?: CommandError;
	warnings: Array<{ code: string; message: string }>;
	notices: Array<{ code: string; message: string }>;
}

/** What `shell-info-get` returns from version 1. */
export interface ShellInfoV1 extends Omit<ShellInfoV0, 'kernelInterface'> {
	kernelInterface: 1;
	manifestVersion: 1;
	appProtocol: 1;
	surfaceCatalog: 1;
	compositionLibrary: 1;
	sdk: 1;
}

// ─── Version 2 ──────────────────────────────────────────────────────────────────

/**
 * Kernel interface version 2 (phase 2 specification, 11.1). Step 2 adds the version and the boot in two
 * stages; `startApps`, `appsReady` and `lateFailure` came with step 1, on version 1. Step 4 adds scope:
 * in a call's options, in an event, and a surface's own port.
 */
export interface LoamKernelV2
	extends Omit<LoamKernelV1, 'version' | 'agent' | 'call' | 'subscribe' | 'appPort'> {
	readonly version: 2;
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: CallOptionsV2
	): Promise<CommandResult<T>>;
	subscribe(listener: (event: KernelEventV2) => void): () => void;
	readonly agent: Pick<LoamKernelV2, 'call' | 'listCommands'>;
	/**
	 * The port for one instance, for the chrome to give an app.
	 *
	 * @throws LoamKernelError `APP_NOT_FOUND` for an unknown instance, `APP_NOT_READY` for a refused
	 *   one, which has no manifest to render from
	 */
	appPort(instance: string): AppPortV2;
}

export interface CallOptionsV2 extends CallOptionsV1 {
	/** Default: the active scope. `'workspace'` is the active workspace with no project (3.2). */
	scope?: ScopeV1 | 'workspace';
}

export interface KernelEventV2 extends KernelEventV1 {
	/** The call's effective scope. */
	scope?: ScopeV1;
	/** The active scope changed in this call, by `applyScopeChange` (3.4). */
	scopeChanged?: ScopeChangeV2;
	/** What main shows changed, and how the URL should follow (6.3). */
	mainChanged?: 'push' | 'replace';
}

/** A surface's port: fixed to the scope it was created in (phase 2 specification, 3.6; D83). */
export interface SurfaceOptionsV2 {
	/** Fixed for this surface's life. Only the chrome calls `surface`; an app never holds a port. */
	scope: ScopeV1;
	/** An embed: every mutation is `EMBED_READ_ONLY`. */
	readOnly?: boolean;
}

export interface SurfacePortV2 {
	readonly scope: ScopeV1;
	readonly readOnly: boolean;
	/** `options.level: 'workspace'` is the only widening. Any other scope is `SCOPE_NOT_GRANTED`. */
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: { signal?: AbortSignal; level?: 'workspace' }
	): Promise<CommandResult<T>>;
	/** The view's broker, closed over this surface. Absent for any other kind. */
	readonly view?: ViewBrokerV1;
}

/**
 * The port of interface 2: it holds the manifest as version 2 reads it, and makes a port per surface.
 * `call` keeps the active scope, for the chrome and tests.
 */
export interface AppPortV2 extends Omit<AppPortV1, 'manifest' | 'call'> {
	readonly manifest: ManifestV2;
	call: LoamClientV1['call'];
	surface(options: SurfaceOptionsV2): SurfacePortV2;
}

/** What phase 6's hosted lane passes to `createMcpHandler` (phase 2 specification, 3.3). */
export interface KernelMcpOptions {
	/** Every registered command but `BOOT_ONLY` and `INTERNAL_COMMANDS`, with `expose.mcp` as phase 6 will decide. */
	commands: readonly ZodCommandDefinition[];
	/** The auth middleware, the journal's, then the scope middleware (3.4): the kernel's own chain. */
	middleware: readonly CommandMiddleware[];
	/** `scope` alone: the other fields are set by trusted code, and a caller must not claim them. */
	contextFields: readonly ContextFieldV2[];
}

/** A declared context field, as `createMcpHandler` takes one. */
export type ContextFieldV2 = NonNullable<DirectRegistryOptions['contextFields']>[number];

/** Interface 2's transport: a command's call carries `_meta` (phase 2 specification, 9.2; step 8). */
export interface MountTransportV2 extends Omit<MountTransportV1, 'callTool'> {
	callTool(
		name: string,
		args: unknown,
		signal?: AbortSignal,
		meta?: Record<string, unknown>
	): Promise<McpToolCallResult>;
}

/** What stage B reads: the validated projection and the ports, or why the reader refused it (2.2). */
export type AppsLoadV2 =
	| { deployment: ProjectionV2; ports: KernelPortsV1 }
	| {
			/** The reader's message: each entry is listed `failed` with `DEPLOYMENT_INVALID`. */
			refused: string;
	  };

export interface KernelOptionsV2 extends Omit<KernelOptionsV1, 'deployment' | 'appsUnavailable'> {
	/** With no `boot`: the validated projection, and `createKernel` runs stage B before it resolves. */
	deployment?: ProjectionV2;
	/** What `readBoot` read. With it, `createKernel` resolves after stage A (2.2). */
	boot?: BootProjectionV2;
	/** What stage B reads. Required with `boot` when it lists an app. */
	appsLoader?: () => Promise<AppsLoadV2>;
	/** The URL's project, by slug, for the first frame, or `null` for a workspace-level URL (6.3). */
	initialScope?: { project: string | null };
	/** The workspace when no `boot` or `deployment` names one. Default `{ id: 'personal', name: 'Personal' }`. */
	workspace?: { id: string; name: string };
}

/** `disabled` is step 4's, from a `workspace-app` record. */
export type AppStateV2 = AppStateV1 | 'disabled';

/**
 * `app-selection-get`'s answer: the selected id and the level it was made at, so main calls its command
 * there, in a dual-scope app's sidebar of two groups (phase 2 specification, 7.4).
 */
export interface SelectionV2 {
	id: string | null;
	level: 'workspace' | 'project';
}

export interface AppSummaryV2 extends Omit<AppSummaryV1, 'state'> {
	state: AppStateV2;
	scopeLevels: Array<'workspace' | 'project'>;
	rail: boolean;
	/** Whether it can open in the active scope, as the rail shows. */
	available: boolean;
}

/** What `shell-info-get` returns from version 2. */
export interface ShellInfoV2
	extends Omit<ShellInfoV1, 'kernelInterface' | 'manifestVersion' | 'storeInterface'> {
	kernelInterface: 2;
	/** The manifest version this shell reads up to: version 2 reads both (phase 2 specification, 8.1). */
	manifestVersion: 2;
	/** The workspace, project and scoped app stores (phase 2 specification, section 4). */
	storeInterface: 1;
}
