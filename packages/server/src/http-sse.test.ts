import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseHub, DEFAULT_MAX_SSE_CONNECTIONS, DEFAULT_SSE_HEARTBEAT_MS } from './http-sse.js';

class FakeResponse extends EventEmitter {
	destroyed = false;
	writableEnded = false;
	readonly writes: string[] = [];
	write(chunk: string): boolean {
		this.writes.push(chunk);
		return true;
	}
	end(): void {
		this.writableEnded = true;
		this.emit('close');
	}
}

function fake(): FakeResponse & ServerResponse {
	return new FakeResponse() as FakeResponse & ServerResponse;
}

afterEach(() => {
	vi.useRealTimers();
});

describe('createSseHub', () => {
	it('uses documented defaults', () => {
		expect(DEFAULT_MAX_SSE_CONNECTIONS).toBe(100);
		expect(DEFAULT_SSE_HEARTBEAT_MS).toBe(25_000);
		const hub = createSseHub();
		for (let i = 0; i < DEFAULT_MAX_SSE_CONNECTIONS; i++) hub.add(fake());
		expect(hub.isFull()).toBe(true);
		hub.closeAll();
		expect(hub.isFull()).toBe(false);
	});

	it('pings live clients, drops dead ones, and stops when none remain', () => {
		vi.useFakeTimers();
		const hub = createSseHub({ maxConnections: 3, heartbeatMs: 1000 });
		const live = fake();
		const dead = fake();
		hub.add(live);
		hub.add(dead);
		dead.destroyed = true;
		vi.advanceTimersByTime(1000);
		expect(live.writes).toEqual([': ping\n\n']);
		expect(dead.writes).toEqual([]);
		expect(hub.clients.size).toBe(1);
		expect(vi.getTimerCount()).toBe(1);

		live.emit('close');
		expect(hub.clients.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ends every client on closeAll', () => {
		vi.useFakeTimers();
		const hub = createSseHub({ heartbeatMs: 1000 });
		const response = fake();
		hub.add(response);
		hub.closeAll();
		expect(response.writableEnded).toBe(true);
		expect(hub.clients.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});
