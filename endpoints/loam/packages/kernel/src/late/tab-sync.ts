/**
 * @fileoverview Cross-tab sync for the workspace's limits, each person's keybinding overrides and the
 * experiment gates (#2108): when one tab writes any of the three to the shared store, every other tab in the
 * same workspace hears a hint on `BroadcastChannel` (with `localStorage` fallback, as `SessionSync` does) and
 * reads its own store again. Messages carry no values—only the topic, workspace and optional person—so an
 * untrusted same-origin message can only trigger a safe re-read of the tab's own store. Never started in a
 * replay or on a principal-gated server kernel.
 */

import type { KernelEventV4 } from '../types.js';

/** The three cached store projections synced across tabs (#2108). */
export type TabSyncKind = 'limits' | 'keybindings' | 'experiments';

export interface TabSyncMessage {
	kind: TabSyncKind;
	workspace: string;
	/** In `provider` mode, the person whose record changed; absent for workspace-wide or `local` mode. */
	person?: string;
}

export interface TabSyncOptions {
	workspace: string;
	provider: boolean;
	person(): string | undefined;
	onMessage(kind: TabSyncKind): void;
	channelName?: string;
	storageKey?: string;
}

export interface TabSync {
	notify(kind: TabSyncKind, person?: string): void;
	stop(): void;
}

export const TAB_SYNC_CHANNEL = 'loam-tab-sync';
export const TAB_SYNC_STORAGE_KEY = 'loam-tab-sync';

const KINDS: ReadonlySet<string> = new Set(['limits', 'keybindings', 'experiments']);

/** Validate an incoming cross-tab hint; drop anything malformed. */
export function parseTabSyncMessage(payload: unknown): TabSyncMessage | undefined {
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
	const { kind, workspace, person } = payload as Record<string, unknown>;
	if (typeof kind !== 'string' || !KINDS.has(kind)) return undefined;
	if (typeof workspace !== 'string' || workspace.length === 0) return undefined;
	if (person !== undefined && typeof person !== 'string') return undefined;
	return {
		kind: kind as TabSyncKind,
		workspace,
		...(person !== undefined ? { person } : {}),
	};
}

interface StorageEventLike {
	key?: string | null;
	newValue?: string | null;
}

interface StorageLike {
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface WindowLike {
	addEventListener?(type: string, listener: (event: StorageEventLike) => void): void;
	removeEventListener?(type: string, listener: (event: StorageEventLike) => void): void;
}

function getLocalStorage(): StorageLike | undefined {
	try {
		return (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
	} catch {
		return undefined;
	}
}

function getWindow(): WindowLike | undefined {
	const w = (globalThis as unknown as { window?: WindowLike }).window;
	return w && typeof w.addEventListener === 'function' ? w : undefined;
}

export function createTabSync(options: TabSyncOptions): TabSync {
	const channelName = options.channelName ?? TAB_SYNC_CHANNEL;
	const storageKey = options.storageKey ?? TAB_SYNC_STORAGE_KEY;
	let channel: BroadcastChannel | null = null;
	let storageHandler: ((event: StorageEventLike) => void) | null = null;
	let stopped = false;

	const receive = (payload: unknown) => {
		if (stopped) return;
		const message = parseTabSyncMessage(payload);
		if (!message || message.workspace !== options.workspace) return;
		if (options.provider && message.person !== undefined && message.person !== options.person())
			return;
		options.onMessage(message.kind);
	};

	if (typeof BroadcastChannel !== 'undefined') {
		try {
			channel = new BroadcastChannel(channelName);
			channel.onmessage = (event: MessageEvent) => receive(event.data);
		} catch {
			channel = null;
		}
	}

	const win = getWindow();
	if (getLocalStorage() && win) {
		storageHandler = (event: StorageEventLike) => {
			if (event.key !== storageKey || !event.newValue) return;
			try {
				receive(JSON.parse(event.newValue));
			} catch {
				// Ignore malformed storage entries.
			}
		};
		win.addEventListener?.('storage', storageHandler);
	}

	const notifyViaStorage = (message: TabSyncMessage) => {
		const storage = getLocalStorage();
		if (!storage) return;
		try {
			storage.setItem(storageKey, JSON.stringify(message));
			storage.removeItem(storageKey);
		} catch {
			// Storage full or unavailable.
		}
	};

	return {
		notify(kind, person) {
			if (stopped) return;
			const message: TabSyncMessage = {
				kind,
				workspace: options.workspace,
				...(options.provider && person !== undefined ? { person } : {}),
			};
			if (channel) {
				try {
					channel.postMessage(message);
					return;
				} catch {
					// Fall through to localStorage.
				}
			}
			notifyViaStorage(message);
		},
		stop() {
			if (stopped) return;
			stopped = true;
			if (channel) {
				channel.close();
				channel = null;
			}
			if (storageHandler) {
				getWindow()?.removeEventListener?.('storage', storageHandler);
				storageHandler = null;
			}
		},
	};
}

/** Wire cross-tab refresh handlers for limits, keybinding overrides and experiment gates (#2108). */
export function wireTabSync(deps: {
	workspace: string;
	provider: boolean;
	person(): string | undefined;
	/** Ignore incoming hints until stage B has finished its initial reads and applies. */
	ready?(): boolean;
	readLimits(): Promise<boolean>;
	readOverrides(): Promise<boolean>;
	refreshExperiments(): Promise<boolean>;
	emit?(event: KernelEventV4): void;
}): TabSync {
	return createTabSync({
		workspace: deps.workspace,
		provider: deps.provider,
		person: deps.person,
		onMessage(kind) {
			if (deps.ready && !deps.ready()) return;
			if (kind === 'limits') {
				void deps
					.readLimits()
					.then((changed) => {
						if (changed)
							deps.emit?.({
								command: 'setting-set',
								interface: 'palette',
								success: true,
								mutation: false,
								settings: ['loam.limits'],
							});
					})
					.catch(() => undefined);
			} else if (kind === 'keybindings') {
				void deps
					.readOverrides()
					.then((changed) => {
						if (changed)
							deps.emit?.({
								command: 'setting-set',
								interface: 'palette',
								success: true,
								mutation: false,
								settings: ['loam.keybindings'],
							});
					})
					.catch(() => undefined);
			} else {
				void deps
					.refreshExperiments()
					.then((changed) => {
						if (changed)
							deps.emit?.({
								command: 'experiment-enable',
								interface: 'palette',
								success: true,
								mutation: false,
								experiments: true,
							});
					})
					.catch(() => undefined);
			}
		},
	});
}
