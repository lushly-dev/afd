import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSync } from './session-sync.js';

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
	getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
	setItem: vi.fn((key: string, value: string) => {
		mockStorage.set(key, value);
	}),
	removeItem: vi.fn((key: string) => {
		mockStorage.delete(key);
	}),
};

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
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('SessionSync', () => {
	it('notifies subscribers via BroadcastChannel', async () => {
		const sync = new SessionSync({ debounceMs: 0 });
		const received: unknown[] = [];

		sync.onSessionChanged((data) => {
			received.push(data);
		});

		// Simulate receiving a message from another tab
		const channel = getChannel();
		channel.onmessage?.({ data: { status: 'signed-out' } } as MessageEvent);

		// Wait for debounce (0ms but still async via setTimeout)
		await new Promise((r) => setTimeout(r, 10));

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ status: 'signed-out' });

		sync.dispose();
	});

	it('broadcasts via BroadcastChannel on notifySessionChanged', () => {
		const sync = new SessionSync();
		const channel = getChannel();

		sync.notifySessionChanged({ event: 'sign-out' });

		expect(channel.postMessage).toHaveBeenCalledWith({ event: 'sign-out' });

		sync.dispose();
	});

	it('supports unsubscribe', async () => {
		const sync = new SessionSync({ debounceMs: 0 });
		const received: unknown[] = [];

		const { unsubscribe } = sync.onSessionChanged((data) => {
			received.push(data);
		});

		unsubscribe();

		const channel = getChannel();
		channel.onmessage?.({ data: 'test' } as MessageEvent);

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
		sync.notifySessionChanged({ event: 'test' });

		await new Promise((r) => setTimeout(r, 10));

		expect(received).toHaveLength(0);
	});

	it('debounces rapid notifications', async () => {
		const sync = new SessionSync({ debounceMs: 50 });
		const received: unknown[] = [];

		sync.onSessionChanged((data) => {
			received.push(data);
		});

		const channel = getChannel();
		channel.onmessage?.({ data: 'first' } as MessageEvent);
		channel.onmessage?.({ data: 'second' } as MessageEvent);
		channel.onmessage?.({ data: 'third' } as MessageEvent);

		await new Promise((r) => setTimeout(r, 100));

		// Only the last one should be delivered due to debouncing
		expect(received).toHaveLength(1);
		expect(received[0]).toBe('third');

		sync.dispose();
	});
});
