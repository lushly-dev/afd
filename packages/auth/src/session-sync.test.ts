import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSync } from './session-sync.js';
import type { SessionSyncMessage } from './session-sync-message.js';

// Mock browser APIs
const mockBroadcastChannelInstances: Array<{
	name: string;
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
}> = [];

class MockBroadcastChannel {
	name: string;
	onmessage: ((event: MessageEvent) => void) | null = null;
	postMessage = vi.fn();
	close = vi.fn();

	constructor(name: string) {
		this.name = name;
		mockBroadcastChannelInstances.push(this);
	}
}

const mockStorage = new Map<string, string>();
const mockLocalStorage = {
	getItem: vi.fn<(key: string) => string | null>(),
	setItem: vi.fn<(key: string, value: string) => void>(),
	removeItem: vi.fn<(key: string) => void>(),
};

/** Restore the working storage implementations a previous test may have replaced. */
function resetLocalStorage() {
	mockLocalStorage.getItem.mockReset().mockImplementation((key) => mockStorage.get(key) ?? null);
	mockLocalStorage.setItem.mockReset().mockImplementation((key, value) => {
		mockStorage.set(key, value);
	});
	mockLocalStorage.removeItem.mockReset().mockImplementation((key) => {
		mockStorage.delete(key);
	});
}

function getChannel() {
	const channel = mockBroadcastChannelInstances[0];
	if (!channel) throw new Error('No BroadcastChannel instance created');
	return channel;
}

beforeEach(() => {
	vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
	vi.stubGlobal('localStorage', mockLocalStorage);
	vi.stubGlobal('document', {
		visibilityState: 'visible',
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	vi.stubGlobal('window', {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});

	mockBroadcastChannelInstances.length = 0;
	mockStorage.clear();
	vi.clearAllMocks();
	resetLocalStorage();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function deliver(data: unknown) {
	getChannel().onmessage?.({ data } as MessageEvent);
}

describe('SessionSync', () => {
	it('notifies subscribers via BroadcastChannel', async () => {
		const sync = new SessionSync({ debounceMs: 0 });
		const received: unknown[] = [];

		sync.onSessionChanged((data) => {
			received.push(data);
		});

		// Simulate receiving a message from another tab
		deliver({ type: 'signed-in', userId: 'u1' });

		// Wait for debounce (0ms but still async via setTimeout)
		await new Promise((r) => setTimeout(r, 10));

		expect(received).toEqual([{ type: 'signed-in', userId: 'u1' }]);

		sync.dispose();
	});

	it('broadcasts via BroadcastChannel on notifySessionChanged', () => {
		const sync = new SessionSync();
		const channel = getChannel();

		sync.notifySessionChanged({ type: 'signed-out' });

		expect(channel.postMessage).toHaveBeenCalledWith({ type: 'signed-out' });

		sync.dispose();
	});

	it('supports unsubscribe', async () => {
		const sync = new SessionSync({ debounceMs: 0 });
		const received: unknown[] = [];

		const { unsubscribe } = sync.onSessionChanged((data) => {
			received.push(data);
		});

		unsubscribe();

		deliver({ type: 'signed-out' });

		await new Promise((r) => setTimeout(r, 10));

		expect(received).toHaveLength(0);

		sync.dispose();
	});

	it('acquires and releases refresh lock', () => {
		const sync = new SessionSync();

		expect(sync.acquireRefreshLock()).toBe(true);
		expect(mockLocalStorage.setItem).toHaveBeenCalled();

		sync.releaseRefreshLock();
		expect(mockLocalStorage.removeItem).toHaveBeenCalled();

		sync.dispose();
	});

	it('blocks lock acquisition when another tab holds it', () => {
		const sync = new SessionSync();

		// Simulate another tab holding the lock
		mockStorage.set('afd-auth-refresh-lock', String(Date.now()));

		expect(sync.acquireRefreshLock()).toBe(false);

		sync.dispose();
	});

	it('allows lock acquisition when existing lock is stale', () => {
		const sync = new SessionSync({ lockTimeoutMs: 10_000 });

		// Simulate a stale lock (15 seconds old)
		mockStorage.set('afd-auth-refresh-lock', String(Date.now() - 15_000));

		expect(sync.acquireRefreshLock()).toBe(true);

		sync.dispose();
	});

	it('only the owning instance can release a refresh lock', () => {
		const owner = new SessionSync();
		const other = new SessionSync();

		expect(owner.acquireRefreshLock()).toBe(true);
		expect(other.acquireRefreshLock()).toBe(false);
		other.releaseRefreshLock();
		expect(mockStorage.has('afd-auth-refresh-lock')).toBe(true);

		owner.releaseRefreshLock();
		expect(mockStorage.has('afd-auth-refresh-lock')).toBe(false);
		owner.dispose();
		other.dispose();
	});

	it('does not let an expired owner release a successor lock', () => {
		const oldOwner = new SessionSync({ lockTimeoutMs: 10_000 });
		const newOwner = new SessionSync({ lockTimeoutMs: 10_000 });

		expect(oldOwner.acquireRefreshLock()).toBe(true);
		const oldLock = JSON.parse(mockStorage.get('afd-auth-refresh-lock') ?? '{}') as {
			ownerId: string;
			lockId: string;
		};
		mockStorage.set(
			'afd-auth-refresh-lock',
			JSON.stringify({ ...oldLock, timestamp: Date.now() - 15_000 })
		);

		expect(newOwner.acquireRefreshLock()).toBe(true);
		const successorLock = mockStorage.get('afd-auth-refresh-lock');
		oldOwner.releaseRefreshLock();
		expect(mockStorage.get('afd-auth-refresh-lock')).toBe(successorLock);

		newOwner.releaseRefreshLock();
		oldOwner.dispose();
		newOwner.dispose();
	});

	it('continues without coordination when storage access is denied', () => {
		mockLocalStorage.getItem.mockImplementation(() => {
			throw new Error('storage denied');
		});
		mockLocalStorage.setItem.mockImplementation(() => {
			throw new Error('storage denied');
		});
		const sync = new SessionSync();

		expect(sync.acquireRefreshLock()).toBe(true);
		expect(() => sync.releaseRefreshLock()).not.toThrow();
		sync.dispose();
	});

	it('does not access storage when the localStorage accessor is denied', () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => {
				throw new Error('storage denied');
			},
		});

		try {
			const sync = new SessionSync();
			expect(sync.acquireRefreshLock()).toBe(true);
			expect(() => sync.releaseRefreshLock()).not.toThrow();
			sync.dispose();
		} finally {
			if (descriptor) {
				Object.defineProperty(globalThis, 'localStorage', descriptor);
			} else {
				Reflect.deleteProperty(globalThis, 'localStorage');
			}
		}
	});

	it('does not acquire a lock after disposal', () => {
		const sync = new SessionSync();
		sync.dispose();

		expect(sync.acquireRefreshLock()).toBe(false);
	});

	it('closes BroadcastChannel on dispose', () => {
		const sync = new SessionSync();
		const channel = getChannel();

		sync.dispose();

		expect(channel.close).toHaveBeenCalled();
	});

	it('does not notify after dispose', async () => {
		const sync = new SessionSync({ debounceMs: 0 });
		const received: unknown[] = [];

		sync.onSessionChanged((data) => {
			received.push(data);
		});

		sync.dispose();
		sync.notifySessionChanged({ type: 'signed-out' });
		deliver({ type: 'signed-out' });

		await new Promise((r) => setTimeout(r, 10));

		expect(received).toHaveLength(0);
	});

	it('debounces rapid notifications', async () => {
		const sync = new SessionSync({ debounceMs: 50 });
		const received: unknown[] = [];

		sync.onSessionChanged((data) => {
			received.push(data);
		});

		deliver({ type: 'profile-updated', userId: 'first' });
		deliver({ type: 'profile-updated', userId: 'second' });
		deliver({ type: 'profile-updated', userId: 'third' });

		await new Promise((r) => setTimeout(r, 100));

		// Only the last one of the type is delivered
		expect(received).toEqual([{ type: 'profile-updated', userId: 'third' }]);

		sync.dispose();
	});

	describe('message delivery', () => {
		it('delivers a sign-out followed by another message type', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ debounceMs: 50 });
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged((message) => received.push(message));

			deliver({ type: 'signed-out' });
			deliver({ type: 'profile-updated' });
			await vi.advanceTimersByTimeAsync(100);

			expect(received).toEqual([{ type: 'signed-out' }, { type: 'profile-updated' }]);
			sync.dispose();
		});

		it('delivers a sign-out at once and drops the messages it supersedes', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ debounceMs: 50 });
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged((message) => received.push(message));

			deliver({ type: 'session-refreshed' });
			deliver({ type: 'signed-out' });
			expect(received).toEqual([{ type: 'signed-out' }]);

			await vi.advanceTimersByTimeAsync(100);
			expect(received).toEqual([{ type: 'signed-out' }]);
			sync.dispose();
		});

		it('debounces each message type separately', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ debounceMs: 50 });
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged((message) => received.push(message));

			deliver({ type: 'signed-in', userId: 'u1' });
			deliver({ type: 'profile-updated', userId: 'u1' });
			deliver({ type: 'signed-in', userId: 'u2' });
			await vi.advanceTimersByTimeAsync(100);

			expect(received).toEqual([
				{ type: 'profile-updated', userId: 'u1' },
				{ type: 'signed-in', userId: 'u2' },
			]);
			sync.dispose();
		});

		it('drops invalid payloads and strips unknown fields', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ debounceMs: 0 });
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged((message) => received.push(message));

			for (const payload of [
				'signed-out',
				null,
				{ status: 'signed-out' },
				{ type: 'unknown' },
				{ type: 'signed-in', userId: 42 },
			]) {
				deliver(payload);
			}
			deliver({ type: 'signed-out', token: 'secret' });
			await vi.advanceTimersByTimeAsync(10);

			expect(received).toEqual([{ type: 'signed-out' }]);
			sync.dispose();
		});

		it('rejects an invalid outgoing message', () => {
			const sync = new SessionSync();
			const invalid = { type: 'logout' } as unknown as SessionSyncMessage;

			expect(() => sync.notifySessionChanged(invalid)).toThrow(TypeError);
			expect(getChannel().postMessage).not.toHaveBeenCalled();
			sync.dispose();
		});

		it('keeps delivering to later listeners when one throws', () => {
			vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => {});
			const sync = new SessionSync();
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged(() => {
				throw new Error('listener failed');
			});
			sync.onSessionChanged((message) => received.push(message));

			deliver({ type: 'signed-out' });

			expect(received).toEqual([{ type: 'signed-out' }]);
			sync.dispose();
			vi.restoreAllMocks();
		});

		it('raises visibility-refresh after the tab was hidden long enough', async () => {
			vi.useFakeTimers();
			const documentStub = {
				visibilityState: 'visible',
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			};
			vi.stubGlobal('document', documentStub);
			const sync = new SessionSync({ debounceMs: 0, visibilityRefreshMs: 1_000 });
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged((message) => received.push(message));
			const handler = documentStub.addEventListener.mock.calls[0]?.[1] as () => void;

			documentStub.visibilityState = 'hidden';
			handler();
			vi.advanceTimersByTime(500);
			documentStub.visibilityState = 'visible';
			handler();
			await vi.advanceTimersByTimeAsync(10);
			expect(received).toEqual([]);

			documentStub.visibilityState = 'hidden';
			handler();
			vi.advanceTimersByTime(1_000);
			documentStub.visibilityState = 'visible';
			handler();
			await vi.advanceTimersByTimeAsync(10);
			expect(received).toEqual([{ type: 'visibility-refresh' }]);

			sync.dispose();
			expect(documentStub.removeEventListener).toHaveBeenCalledWith('visibilitychange', handler);
		});
	});

	describe('localStorage fallback', () => {
		function createStorageSync() {
			vi.stubGlobal('BroadcastChannel', undefined);
			const windowStub = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
			vi.stubGlobal('window', windowStub);
			const sync = new SessionSync({ debounceMs: 0 });
			const handler = windowStub.addEventListener.mock.calls[0]?.[1] as (e: StorageEvent) => void;
			return { sync, handler, windowStub };
		}

		it('broadcasts through a storage write', () => {
			const { sync } = createStorageSync();

			sync.notifySessionChanged({ type: 'signed-in', userId: 'u1' });

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'afd-auth-sync',
				JSON.stringify({ type: 'signed-in', userId: 'u1' })
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('afd-auth-sync');
			sync.dispose();
		});

		it('validates messages from storage events', async () => {
			vi.useFakeTimers();
			const { sync, handler, windowStub } = createStorageSync();
			const received: SessionSyncMessage[] = [];
			sync.onSessionChanged((message) => received.push(message));

			handler({ key: 'afd-auth-sync', newValue: '{not json' } as StorageEvent);
			handler({ key: 'afd-auth-sync', newValue: '"signed-out"' } as StorageEvent);
			handler({ key: 'other-key', newValue: '{"type":"signed-out"}' } as StorageEvent);
			handler({ key: 'afd-auth-sync', newValue: '{"type":"signed-out"}' } as StorageEvent);
			await vi.advanceTimersByTimeAsync(10);

			expect(received).toEqual([{ type: 'signed-out' }]);
			sync.dispose();
			expect(windowStub.removeEventListener).toHaveBeenCalledWith('storage', handler);
		});
	});

	describe('refresh lock timestamps', () => {
		it('treats a lock timestamp far in the future as stale', () => {
			const sync = new SessionSync();
			mockStorage.set(
				'afd-auth-refresh-lock',
				JSON.stringify({ ownerId: 'other', lockId: 'x', timestamp: Date.now() + 3_600_000 })
			);

			expect(sync.acquireRefreshLock()).toBe(true);
			sync.dispose();
		});

		it('still honours a lock timestamp within the clock skew', () => {
			const sync = new SessionSync();
			mockStorage.set(
				'afd-auth-refresh-lock',
				JSON.stringify({ ownerId: 'other', lockId: 'x', timestamp: Date.now() + 500 })
			);

			expect(sync.acquireRefreshLock()).toBe(false);
			sync.dispose();
		});
	});

	describe('acquireRefreshLockAsync', () => {
		it('confirms the lock after lockCheckDelayMs', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ lockCheckDelayMs: 50 });

			const acquired = sync.acquireRefreshLockAsync();
			await vi.advanceTimersByTimeAsync(49);
			let settled = false;
			void acquired.then(() => {
				settled = true;
			});
			await Promise.resolve();
			expect(settled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			await expect(acquired).resolves.toBe(true);
			sync.releaseRefreshLock();
			expect(mockStorage.has('afd-auth-refresh-lock')).toBe(false);
			sync.dispose();
		});

		it('declines when another tab overwrote the lock during the delay', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ lockCheckDelayMs: 50 });

			const acquired = sync.acquireRefreshLockAsync();
			// Another tab read the empty key before our write and wrote its own lock.
			mockStorage.set(
				'afd-auth-refresh-lock',
				JSON.stringify({ ownerId: 'other-tab', lockId: 'y', timestamp: Date.now() })
			);
			await vi.advanceTimersByTimeAsync(50);

			await expect(acquired).resolves.toBe(false);
			sync.releaseRefreshLock();
			expect(mockStorage.has('afd-auth-refresh-lock')).toBe(true);
			sync.dispose();
		});

		it('declines without waiting when a live lock exists or after disposal', async () => {
			const holder = new SessionSync();
			const other = new SessionSync();
			expect(holder.acquireRefreshLock()).toBe(true);

			await expect(other.acquireRefreshLockAsync()).resolves.toBe(false);

			other.dispose();
			await expect(other.acquireRefreshLockAsync()).resolves.toBe(false);
			holder.dispose();
		});

		it('removes its lock when disposed during the delay', async () => {
			vi.useFakeTimers();
			const sync = new SessionSync({ lockCheckDelayMs: 50 });

			const acquired = sync.acquireRefreshLockAsync();
			expect(mockStorage.has('afd-auth-refresh-lock')).toBe(true);
			sync.dispose();
			await vi.advanceTimersByTimeAsync(50);

			await expect(acquired).resolves.toBe(false);
			expect(mockStorage.has('afd-auth-refresh-lock')).toBe(false);
		});

		it('proceeds without coordination when storage writes are denied', async () => {
			mockLocalStorage.setItem.mockImplementationOnce(() => {
				throw new Error('quota exceeded');
			});
			const sync = new SessionSync();

			await expect(sync.acquireRefreshLockAsync()).resolves.toBe(true);
			sync.dispose();
		});
	});
});
