/**
 * @fileoverview Kernel interface version 1 (phase 1 specification, 9.1), and version 0 (phase 0
 * specification, 6.2), which it extends: the only surface the chrome binds to.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandError, CommandResult, JournalSink } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	ManifestRefusal,
	ManifestV1,
	ProjectionMountedV1,
	ProjectionV1,
} from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1, AppStoreV1, OverlayResultV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { ShellKeybindingV0 } from './keybindings.js';

export const KERNEL_INTERFACE_VERSION = 1;

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

export interface AppDetailV1 extends AppSummaryV1 {
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
