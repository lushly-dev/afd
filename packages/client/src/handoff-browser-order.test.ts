/**
 * A browser reports a failed WebSocket handshake as an `error` event followed by `close` with
 * code 1006. These tests replay that order against the built-in WebSocket handler.
 */

import type { HandoffResult } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';
import { DirectClient } from './direct.js';
import type { DirectRegistry } from './direct-types.js';
import { websocketHandler } from './handlers.js';
import {
	clearProtocolHandlers,
	createReconnectingHandoff,
	type HandoffCommandClient,
	registerProtocolHandler,
} from './handoff.js';

interface FakeSocket {
	onopen: (() => void) | null;
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onclose: ((event: { code: number; reason: string }) => void) | null;
	send: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
}

/** A WebSocket whose every handshake fails the way browsers report it. */
function stubFailingWebSocket(): FakeSocket[] {
	const sockets: FakeSocket[] = [];
	class FailingWebSocket {
		constructor() {
			const socket: FakeSocket = {
				onopen: null,
				onmessage: null,
				onerror: null,
				onclose: null,
				send: vi.fn(),
				close: vi.fn(),
			};
			sockets.push(socket);
			queueMicrotask(() => {
				socket.onerror?.({ type: 'error' });
				socket.onclose?.({ code: 1006, reason: '' });
			});
			// biome-ignore lint/correctness/noConstructorReturn: the fake socket is shared with the test
			return socket as never;
		}
	}
	vi.stubGlobal('WebSocket', FailingWebSocket);
	return sockets;
}

const handoff: HandoffResult = { protocol: 'websocket', endpoint: 'wss://example.com/socket' };

afterEach(() => {
	clearProtocolHandlers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('WebSocket handshake failure in browser event order', () => {
	it('rejects once and reports no disconnect for a connection that never opened', async () => {
		stubFailingWebSocket();
		const onDisconnect = vi.fn();
		const onError = vi.fn();
		const states: string[] = [];

		await expect(
			websocketHandler(handoff, {
				onDisconnect,
				onError,
				onStateChange: (state) => states.push(state),
			})
		).rejects.toThrow('WebSocket error');
		await Promise.resolve();

		expect(onDisconnect).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledOnce();
		expect(states).toEqual(['failed']);
	});

	it('does not start a background reconnect loop after the caller saw the rejection', async () => {
		vi.useFakeTimers();
		const sockets = stubFailingWebSocket();
		const onReconnect = vi.fn();
		const onDisconnect = vi.fn();
		const call = vi.fn();

		await expect(
			createReconnectingHandoff({ call }, handoff, {
				reconnectCommand: 'chat-reconnect',
				backoffMs: 1,
				onReconnect,
				onDisconnect,
			})
		).rejects.toThrow('WebSocket error');
		await vi.runAllTimersAsync();

		expect(sockets).toHaveLength(1);
		expect(onReconnect).not.toHaveBeenCalled();
		expect(onDisconnect).not.toHaveBeenCalled();
		expect(call).not.toHaveBeenCalled();
	});

	it('ignores late disconnects from a failed initial attempt of a custom handler', async () => {
		vi.useFakeTimers();
		let lateDisconnect: (() => void) | undefined;
		const attempts = vi.fn();
		registerProtocolHandler('websocket', async (_handoff, options) => {
			attempts();
			lateDisconnect = () => options.onDisconnect?.(1006, '');
			throw new Error('handshake failed');
		});
		const onReconnect = vi.fn();

		await expect(
			createReconnectingHandoff({ call: vi.fn() }, handoff, { backoffMs: 1, onReconnect })
		).rejects.toThrow('handshake failed');
		lateDisconnect?.();
		await vi.runAllTimersAsync();

		expect(attempts).toHaveBeenCalledOnce();
		expect(onReconnect).not.toHaveBeenCalled();
	});
});

describe('createReconnectingHandoff client type', () => {
	it('accepts McpClient and DirectClient', async () => {
		registerProtocolHandler('websocket', async (result, options) => {
			options.onConnect?.({});
			return {
				send: vi.fn(),
				close: vi.fn(),
				state: 'connected',
				protocol: result.protocol,
				endpoint: result.endpoint,
			};
		});
		const registry: DirectRegistry = {
			execute: async () => ({ success: true }),
			listCommandNames: () => [],
			listCommands: () => [],
			hasCommand: () => false,
		};
		const clients: HandoffCommandClient[] = [
			new McpClient({ url: 'http://localhost/sse' }),
			new DirectClient(registry),
		];

		for (const client of clients) {
			const connection = await createReconnectingHandoff(client, handoff);
			expect(connection.state).toBe('connected');
			connection.close();
		}
	});
});
