/**
 * @fileoverview Multi-tab session synchronization
 *
 * Uses BroadcastChannel (primary) with localStorage fallback.
 * All browser APIs are guarded with typeof checks for SSR safety.
 */

import { ListenerSet } from './listeners.js';
import {
	parseSessionSyncMessage,
	type SessionSyncMessage,
	type SessionSyncMessageType,
} from './session-sync-message.js';

export interface SessionSyncOptions {
	/** Channel name for BroadcastChannel (default: 'afd-auth-session') */
	channelName?: string;
	/** localStorage key for fallback sync (default: 'afd-auth-sync') */
	storageKey?: string;
	/** Lock key for refresh coordination (default: 'afd-auth-refresh-lock') */
	lockKey?: string;
	/** Lock timeout in ms (default: 10_000) */
	lockTimeoutMs?: number;
	/**
	 * How long `acquireRefreshLockAsync()` waits after writing the lock before
	 * reading it back to confirm ownership, in ms (default: 50)
	 */
	lockCheckDelayMs?: number;
	/**
	 * Debounce interval for received messages of the same type, in ms
	 * (default: 100). `signed-out` is never debounced.
	 */
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

/**
 * How far in the future a lock timestamp may be and still count as live.
 * Tabs share one clock, so a later timestamp comes from a clock change or a
 * corrupted value and must not block refresh until the clock catches up.
 */
const LOCK_CLOCK_SKEW_MS = 1_000;

interface RefreshLockRecord {
	ownerId: string;
	lockId: string;
	timestamp: number;
}

interface StorageRead<T> {
	available: boolean;
	value: T | null;
}

type LockAttempt =
	| { kind: 'declined' }
	| { kind: 'uncoordinated' }
	| { kind: 'written'; lockId: string };

let ownerSequence = 0;

export class SessionSync {
	private readonly options: Required<SessionSyncOptions>;
	private channel: BroadcastChannel | null = null;
	private readonly listeners = new ListenerSet<SessionSyncMessage>();
	private readonly pending = new Map<SessionSyncMessageType, ReturnType<typeof setTimeout>>();
	private hiddenAt: number | null = null;
	private visibilityHandler: (() => void) | null = null;
	private storageHandler: ((e: StorageEvent) => void) | null = null;
	private disposed = false;
	private readonly ownerId = createOwnerId();
	private heldLockId: string | null = null;

	constructor(options: SessionSyncOptions = {}) {
		this.options = { ...DEFAULTS, ...options };
		this.init();
	}

	/**
	 * Broadcast a session change to other tabs.
	 *
	 * @throws TypeError when `message` is not a valid {@link SessionSyncMessage}
	 */
	notifySessionChanged(message: SessionSyncMessage): void {
		const valid = parseSessionSyncMessage(message);
		if (!valid) {
			throw new TypeError(`Invalid session sync message: ${JSON.stringify(message)}`);
		}
		if (this.disposed) return;

		if (this.channel) {
			try {
				this.channel.postMessage(valid);
				return;
			} catch {
				// Fall through to localStorage
			}
		}

		this.notifyViaStorage(valid);
	}

	/**
	 * Subscribe to session changes from other tabs. Invalid payloads are
	 * dropped. Messages of one type are debounced by `debounceMs`; a
	 * `signed-out` message is delivered at once and cancels messages still
	 * waiting in the debounce, since it supersedes them.
	 */
	onSessionChanged(callback: (message: SessionSyncMessage) => void): { unsubscribe: () => void } {
		return this.listeners.add(callback);
	}

	/**
	 * Attempt to acquire a refresh lock to coordinate token refresh across tabs.
	 * Returns true if lock was acquired, false if another tab holds it.
	 */
	acquireRefreshLock(): boolean {
		const attempt = this.writeRefreshLock();
		if (attempt.kind !== 'written') return attempt.kind === 'uncoordinated';

		// localStorage has no compare-and-swap. The immediate read makes the
		// synchronous fallback best-effort: if another tab won the write race,
		// this instance declines the lock. It cannot make the operation atomic.
		return this.confirmRefreshLock(attempt.lockId);
	}

	/**
	 * Like {@link acquireRefreshLock}, but waits `lockCheckDelayMs` after
	 * writing the lock and reads it back before claiming it. A tab whose write
	 * raced another tab's then sees the other owner and declines. This narrows
	 * the race the synchronous check cannot see, but is still not atomic.
	 */
	async acquireRefreshLockAsync(): Promise<boolean> {
		const attempt = this.writeRefreshLock();
		if (attempt.kind !== 'written') return attempt.kind === 'uncoordinated';

		await new Promise((resolve) => setTimeout(resolve, this.options.lockCheckDelayMs));
		if (this.disposed) {
			this.removeRefreshLock(attempt.lockId);
			return false;
		}
		return this.confirmRefreshLock(attempt.lockId);
	}

	/**
	 * Release the refresh lock.
	 */
	releaseRefreshLock(): void {
		const heldLockId = this.heldLockId;
		this.heldLockId = null;
		// A stale owner must never retain permission to release a later owner's
		// lock through this instance.
		if (heldLockId !== null) this.removeRefreshLock(heldLockId);
	}

	/**
	 * Clean up all resources.
	 */
	dispose(): void {
		this.releaseRefreshLock();
		this.disposed = true;
		this.cancelPending();

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
					this.receive(event.data);
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
						this.receive(JSON.parse(e.newValue));
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
						this.receive({ type: 'visibility-refresh' });
					}
				}
			};
			document.addEventListener('visibilitychange', this.visibilityHandler);
		}
	}

	private receive(payload: unknown): void {
		if (this.disposed) return;
		const message = parseSessionSyncMessage(payload);
		if (!message) return;

		if (message.type === 'signed-out') {
			this.cancelPending();
			this.listeners.emit(message);
			return;
		}

		const existing = this.pending.get(message.type);
		if (existing !== undefined) clearTimeout(existing);
		this.pending.set(
			message.type,
			setTimeout(() => {
				this.pending.delete(message.type);
				this.listeners.emit(message);
			}, this.options.debounceMs)
		);
	}

	private cancelPending(): void {
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}

	private notifyViaStorage(message: SessionSyncMessage): void {
		if (!this.hasLocalStorage()) return;
		try {
			localStorage.setItem(this.options.storageKey, JSON.stringify(message));
			// Clean up immediately — the storage event fires in other tabs
			localStorage.removeItem(this.options.storageKey);
		} catch {
			// localStorage full or unavailable
		}
	}

	private writeRefreshLock(): LockAttempt {
		if (this.disposed) return { kind: 'declined' };
		if (!this.hasLocalStorage()) return { kind: 'uncoordinated' };

		const now = Date.now();
		const existing = this.readRefreshLock();
		if (!existing.available) return { kind: 'uncoordinated' };

		if (existing.value && this.isLockLive(existing.value.timestamp, now)) {
			return { kind: 'declined' }; // Another tab holds a valid lock
		}

		const lockId = createLockId();
		const lock: RefreshLockRecord = { ownerId: this.ownerId, lockId, timestamp: now };
		try {
			localStorage.setItem(this.options.lockKey, JSON.stringify(lock));
		} catch {
			// Storage can be present but denied (private browsing, blocked cookies,
			// quota). Proceed without coordination rather than failing auth refresh.
			this.heldLockId = null;
			return { kind: 'uncoordinated' };
		}
		return { kind: 'written', lockId };
	}

	private isLockLive(timestamp: number, now: number): boolean {
		return timestamp <= now + LOCK_CLOCK_SKEW_MS && now - timestamp < this.options.lockTimeoutMs;
	}

	private confirmRefreshLock(lockId: string): boolean {
		const observed = this.readRefreshLock();
		if (
			observed.available &&
			observed.value?.ownerId === this.ownerId &&
			observed.value.lockId === lockId
		) {
			this.heldLockId = lockId;
			return true;
		}

		this.heldLockId = null;
		return false;
	}

	private removeRefreshLock(lockId: string): void {
		if (!this.hasLocalStorage()) return;
		const current = this.readRefreshLock();
		if (
			current.available &&
			current.value?.ownerId === this.ownerId &&
			current.value.lockId === lockId
		) {
			try {
				localStorage.removeItem(this.options.lockKey);
			} catch {
				// Storage became unavailable; there is nothing safe to release.
			}
		}
	}

	private hasLocalStorage(): boolean {
		try {
			return typeof localStorage !== 'undefined';
		} catch {
			return false;
		}
	}

	private readRefreshLock(): StorageRead<RefreshLockRecord> {
		try {
			const raw = localStorage.getItem(this.options.lockKey);
			if (!raw) return { available: true, value: null };

			const parsed: unknown = JSON.parse(raw);
			if (isRefreshLockRecord(parsed)) return { available: true, value: parsed };

			// Read locks written by older versions so they expire normally. A
			// legacy lock has no owner and therefore cannot be released by us.
			const timestamp = Number.parseInt(raw, 10);
			return Number.isFinite(timestamp)
				? {
						available: true,
						value: { ownerId: '', lockId: '', timestamp },
					}
				: { available: true, value: null };
		} catch {
			return { available: false, value: null };
		}
	}
}

function createOwnerId(): string {
	ownerSequence += 1;
	return `afd-auth-${Date.now().toString(36)}-${ownerSequence.toString(36)}-${Math.random()
		.toString(36)
		.slice(2)}`;
}

function createLockId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRefreshLockRecord(value: unknown): value is RefreshLockRecord {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.ownerId === 'string' &&
		typeof record.lockId === 'string' &&
		typeof record.timestamp === 'number' &&
		Number.isFinite(record.timestamp)
	);
}
