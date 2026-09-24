import { afterEach, describe, expect, it, vi } from 'vitest';
import { sseHandler, websocketHandler } from './handlers.js';

class FakeSource {
	static latest: FakeSource;
	onopen?: () => void;
	onmessage?: (event: { data: string }) => void;
	onerror?: () => void;
	close = vi.fn();
	constructor() {
		FakeSource.latest = this;
	}
}
const handoff = { protocol: 'sse', endpoint: 'https://example.com/events' };
afterEach(() => {
	vi.unstubAllGlobals();
});
describe('built-in handoff SSE lifecycle', () => {
	it('closes a lost source once and ignores queued reopen and message callbacks', async () => {
		vi.stubGlobal('EventSource', FakeSource);
		const onDisconnect = vi.fn(),
			onMessage = vi.fn(),
			onError = vi.fn();
		const pending = sseHandler(handoff, { onDisconnect, onMessage, onError });
		const source = FakeSource.latest;
		source.onopen?.();
		const connection = await pending;
		source.onmessage?.({ data: '{"ok":true}' });
		source.onmessage?.({ data: 'raw text' });
		expect(onMessage.mock.calls).toEqual([[{ ok: true }], ['raw text']]);
		expect(() => connection.send({})).toThrow('read-only');
		source.onerror?.();
		source.onopen?.();
		source.onmessage?.({ data: 'late' });
		source.onerror?.();
		connection.close();
		expect(connection.state).toBe('disconnected');
		expect(source.close).toHaveBeenCalledOnce();
		expect(onDisconnect).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledOnce();
		expect(onMessage).toHaveBeenCalledTimes(2);
	});
	it('rejects failed handshakes and cannot revive them', async () => {
		vi.stubGlobal('EventSource', FakeSource);
		const pending = sseHandler(handoff, {});
		const rejected = expect(pending).rejects.toThrow('SSE connection error');
		const source = FakeSource.latest;
		source.onerror?.();
		await rejected;
		source.onopen?.();
		source.onerror?.();
		expect(source.close).toHaveBeenCalledOnce();
	});
	it('closes an established source idempotently without callbacks', async () => {
		vi.stubGlobal('EventSource', FakeSource);
		const pending = sseHandler(handoff, {});
		const source = FakeSource.latest;
		source.onmessage?.({ data: 'premature' });
		source.onopen?.();
		source.onopen?.();
		const connection = await pending;
		source.onmessage?.({ data: '{}' });
		connection.close();
		connection.close();
		expect(source.close).toHaveBeenCalledOnce();
	});
	it('reports a missing EventSource runtime', async () => {
		vi.stubGlobal('EventSource', undefined);
		await expect(sseHandler(handoff, {})).rejects.toThrow('EventSource is not available');
	});
	it('reports a missing WebSocket runtime', async () => {
		vi.stubGlobal('WebSocket', undefined);
		await expect(websocketHandler({ ...handoff, protocol: 'websocket' }, {})).rejects.toThrow(
			'WebSocket is not available'
		);
	});
	it('reports missing fetch for authenticated SSE', async () => {
		vi.stubGlobal('fetch', undefined);
		await expect(sseHandler({ ...handoff, credentials: { token: 'test' } }, {})).rejects.toThrow(
			'fetch is not available'
		);
	});
	it.each([new Error('offline'), 'offline'])(
		'normalizes handshake fetch rejection %j',
		async (reason) => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
			await expect(sseHandler({ ...handoff, credentials: { token: 'test' } }, {})).rejects.toThrow(
				'SSE connection failed: offline'
			);
		}
	);
	it.each([new Response(null, { status: 403 }), new Response(null)])(
		'rejects failed or missing-body streams',
		async (response) => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
			await expect(
				sseHandler({ ...handoff, credentials: { headers: { Authorization: 'test' } } }, {})
			).rejects.toThrow();
		}
	);
	it('parses authenticated SSE with the spec-compliant shared parser', async () => {
		const onMessage = vi.fn(),
			onDisconnect = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						': keep-alive\n\ndata:{"compact":true}\n\ndata: {"multi":\ndata: "line"}\n\ndata: plain\r\n\r\n'
					)
				);
				controller.close();
			},
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

		await sseHandler({ ...handoff, credentials: { token: 'test' } }, { onMessage, onDisconnect });
		await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());

		expect(onMessage.mock.calls).toEqual([[{ compact: true }], [{ multi: 'line' }], ['plain']]);
	});
	it('stops an authenticated SSE stream whose event exceeds the size bound', async () => {
		const onError = vi.fn(),
			onDisconnect = vi.fn(),
			cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(64 * 1024)}`));
			},
			cancel,
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

		await sseHandler({ ...handoff, credentials: { token: 'test' } }, { onError, onDisconnect });
		await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'SseEventTooLargeError' })
		);
		expect(cancel).toHaveBeenCalled();
	});
	it('reports background reader failures with actionable disconnect state', async () => {
		const onError = vi.fn(),
			onDisconnect = vi.fn();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error('network reset');
			},
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
		const connection = await sseHandler(
			{ ...handoff, credentials: { token: 'test' } },
			{ onError, onDisconnect }
		);
		await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network reset' }));
		expect(connection.state).toBe('disconnected');
	});
});
