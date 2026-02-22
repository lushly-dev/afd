/**
 * @fileoverview Multi-tab session synchronization
 *
 * Uses BroadcastChannel (primary) with localStorage fallback.
 * All browser APIs are guarded with typeof checks for SSR safety.
 */

export interface SessionSyncOptions {
	/** Channel name for BroadcastChannel (default: 'afd-auth-session') */
	channelName?: string;
	/** localStorage key for fallback sync (default: 'afd-auth-sync') */
	storageKey?: string;
	/** Lock key for refresh coordination (default: 'afd-auth-refresh-lock') */
	lockKey?: string;
	/** Lock timeout in ms (default: 10_000) */
	lockTimeoutMs?: number;
	/** Double-check delay for lock acquisition in ms (default: 50) */
	lockCheckDelayMs?: number;
	/** Debounce interval for state updates in ms (default: 100) */
	debounceMs?: number;
	/** Re-check session after tab hidden for this long in ms (default: 300_000 = 5 min) */
	visibilityRefreshMs?: number;
}

const DEFAULTS: Required<SessionSyncOptions> = {
	channelName: 'afd-auth-session',
	storageKey: 'afd-auth-sync',
	lockKey: 'afd-auth-refresh-lock',
	lockTimeoutMs: 10_000,
	lockCheckDelayMs: 50,
	debounceMs: 100,
	visibilityRefreshMs: 300_000,
};

export class SessionSync {
	private readonly options: Required<SessionSyncOptions>;
	private channel: BroadcastChannel | null = null;
	private listeners = new Set<(data: unknown) => void>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private hiddenAt: number | null = null;
	private visibilityHandler: (() => void) | null = null;
	private storageHandler: ((e: StorageEvent) => void) | null = null;
	private disposed = false;

	constructor(options: SessionSyncOptions = {}) {
		this.options = { ...DEFAULTS, ...options };
		this.init();
	}

	/**
	 * Broadcast a session change to other tabs.
	 */
	notifySessionChanged(data: unknown): void {
		if (this.disposed) return;

		if (this.channel) {
			try {
				this.channel.postMessage(data);
				return;
			} catch {
				// Fall through to localStorage
			}
		}

		this.notifyViaStorage(data);
	}

	/**
	 * Subscribe to session changes from other tabs.
	 */
	onSessionChanged(callback: (data: unknown) => void): { unsubscribe: () => void } {
		this.listeners.add(callback);
		return {
			unsubscribe: () => {
				this.listeners.delete(callback);
			},
		};
	}

	/**
	 * Attempt to acquire a refresh lock to coordinate token refresh across tabs.
	 * Returns true if lock was acquired, false if another tab holds it.
	 */
	acquireRefreshLock(): boolean {
		if (!this.hasLocalStorage()) return true;

		const now = Date.now();
		const existing = localStorage.getItem(this.options.lockKey);

		if (existing) {
			const timestamp = Number.parseInt(existing, 10);
			if (now - timestamp < this.options.lockTimeoutMs) {
				return false; // Another tab holds a valid lock
			}
		}

		localStorage.setItem(this.options.lockKey, String(now));
		return true;
	}

	/**
	 * Release the refresh lock.
	 */
	releaseRefreshLock(): void {
		if (!this.hasLocalStorage()) return;
		localStorage.removeItem(this.options.lockKey);
	}

	/**
	 * Clean up all resources.
	 */
	dispose(): void {
		this.disposed = true;

		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.channel) {
			this.channel.close();
			this.channel = null;
		}

		if (this.storageHandler && typeof window !== 'undefined') {
			window.removeEventListener('storage', this.storageHandler);
			this.storageHandler = null;
		}

		if (this.visibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.visibilityHandler);
			this.visibilityHandler = null;
		}

		this.listeners.clear();
	}

	private init(): void {
		// Try BroadcastChannel first
		if (typeof BroadcastChannel !== 'undefined') {
			try {
				this.channel = new BroadcastChannel(this.options.channelName);
				this.channel.onmessage = (event: MessageEvent) => {
					this.debouncedNotify(event.data);
				};
			} catch {
				// BroadcastChannel unavailable, fall through to localStorage
			}
		}

		// localStorage fallback for storage events
		if (!this.channel && this.hasLocalStorage() && typeof window !== 'undefined') {
			this.storageHandler = (e: StorageEvent) => {
				if (e.key === this.options.storageKey && e.newValue) {
					try {
						const data: unknown = JSON.parse(e.newValue);
						this.debouncedNotify(data);
					} catch {
						// Ignore malformed data
					}
				}
			};
			window.addEventListener('storage', this.storageHandler);
		}

		// Visibility change handler
		if (typeof document !== 'undefined') {
			this.visibilityHandler = () => {
				if (document.visibilityState === 'hidden') {
					this.hiddenAt = Date.now();
				} else if (document.visibilityState === 'visible' && this.hiddenAt !== null) {
					const elapsed = Date.now() - this.hiddenAt;
					this.hiddenAt = null;
					if (elapsed >= this.options.visibilityRefreshMs) {
						this.debouncedNotify({ type: 'visibility-refresh' });
					}
				}
			};
			document.addEventListener('visibilitychange', this.visibilityHandler);
		}
	}

	private notifyViaStorage(data: unknown): void {
		if (!this.hasLocalStorage()) return;
		try {
			localStorage.setItem(this.options.storageKey, JSON.stringify(data));
			// Clean up immediately — the storage event fires in other tabs
			localStorage.removeItem(this.options.storageKey);
		} catch {
			// localStorage full or unavailable
		}
	}

	private debouncedNotify(data: unknown): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			for (const listener of this.listeners) {
				listener(data);
			}
		}, this.options.debounceMs);
	}

	private hasLocalStorage(): boolean {
		try {
			return typeof localStorage !== 'undefined';
		} catch {
			return false;
		}
	}
}
