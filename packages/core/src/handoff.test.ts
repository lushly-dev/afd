import { describe, expect, it } from 'vitest';
import {
	isHandoff,
	isHandoffProtocol,
	isHandoffCommand,
	getHandoffProtocol,
	type HandoffResult,
} from './handoff.js';

describe('isHandoff', () => {
	it('returns true for valid minimal HandoffResult', () => {
		const handoff: HandoffResult = {
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
		};

		expect(isHandoff(handoff)).toBe(true);
	});

	it('returns true for HandoffResult with all fields', () => {
		const handoff: HandoffResult = {
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
			credentials: {
				token: 'abc123',
				sessionId: 'session-xyz',
				headers: { 'X-Custom': 'value' },
			},
			metadata: {
				expectedLatency: 50,
				capabilities: ['text', 'presence'],
				expiresAt: '2025-01-15T12:00:00Z',
				reconnect: {
					allowed: true,
					maxAttempts: 5,
					backoffMs: 1000,
				},
				description: 'Chat connection',
			},
		};

		expect(isHandoff(handoff)).toBe(true);
	});

	it('returns true for custom protocol types', () => {
		const handoff: HandoffResult = {
			protocol: 'custom-protocol',
			endpoint: 'custom://example.com/stream',
		};

		expect(isHandoff(handoff)).toBe(true);
	});

	it('returns false for null', () => {
		expect(isHandoff(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isHandoff(undefined)).toBe(false);
	});

	it('returns false for non-object', () => {
		expect(isHandoff('string')).toBe(false);
		expect(isHandoff(123)).toBe(false);
		expect(isHandoff(true)).toBe(false);
	});

	it('returns false when protocol is missing', () => {
		expect(
			isHandoff({
				endpoint: 'wss://example.com/chat',
			})
		).toBe(false);
	});

	it('returns false when endpoint is missing', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
			})
		).toBe(false);
	});

	it('returns false when protocol is empty string', () => {
		expect(
			isHandoff({
				protocol: '',
				endpoint: 'wss://example.com/chat',
			})
		).toBe(false);
	});

	it('returns false when endpoint is empty string', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: '',
			})
		).toBe(false);
	});

	it('returns false when protocol is wrong type', () => {
		expect(
			isHandoff({
				protocol: 123,
				endpoint: 'wss://example.com/chat',
			})
		).toBe(false);
	});

	it('returns false when credentials is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				credentials: 'invalid',
			})
		).toBe(false);
	});

	it('returns false when credentials.token is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				credentials: { token: 123 },
			})
		).toBe(false);
	});

	it('returns false when credentials.sessionId is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				credentials: { sessionId: 123 },
			})
		).toBe(false);
	});

	it('returns false when credentials.headers is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				credentials: { headers: 'invalid' },
			})
		).toBe(false);
	});

	it('returns false when metadata is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: 'invalid',
			})
		).toBe(false);
	});

	it('returns false when metadata.expectedLatency is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { expectedLatency: 'fast' },
			})
		).toBe(false);
	});

	it('returns false when metadata.capabilities is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { capabilities: 'text' },
			})
		).toBe(false);
	});

	it('returns false when metadata.expiresAt is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { expiresAt: 12345 },
			})
		).toBe(false);
	});

	it('returns false when metadata.description is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { description: 123 },
			})
		).toBe(false);
	});

	it('returns false when metadata.reconnect is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { reconnect: 'yes' },
			})
		).toBe(false);
	});

	it('returns false when metadata.reconnect.allowed is missing', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { reconnect: { maxAttempts: 5 } },
			})
		).toBe(false);
	});

	it('returns false when metadata.reconnect.maxAttempts is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { reconnect: { allowed: true, maxAttempts: 'five' } },
			})
		).toBe(false);
	});

	it('returns false when metadata.reconnect.backoffMs is wrong type', () => {
		expect(
			isHandoff({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: { reconnect: { allowed: true, backoffMs: 'slow' } },
			})
		).toBe(false);
	});

	it('narrows type correctly', () => {
		const maybeHandoff: unknown = {
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
		};

		if (isHandoff(maybeHandoff)) {
			// TypeScript should know maybeHandoff is HandoffResult
			expect(maybeHandoff.protocol).toBe('websocket');
			expect(maybeHandoff.endpoint).toBe('wss://example.com/chat');
		} else {
			throw new Error('Expected isHandoff to return true');
		}
	});
});

describe('isHandoffProtocol', () => {
	it('returns true when protocol matches', () => {
		const handoff: HandoffResult = {
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
		};

		expect(isHandoffProtocol(handoff, 'websocket')).toBe(true);
	});

	it('returns false when protocol does not match', () => {
		const handoff: HandoffResult = {
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
		};

		expect(isHandoffProtocol(handoff, 'sse')).toBe(false);
	});

	it('works with standard protocols', () => {
		const protocols = ['websocket', 'webrtc', 'sse', 'http-stream'] as const;

		for (const protocol of protocols) {
			const handoff: HandoffResult = {
				protocol,
				endpoint: 'https://example.com',
			};

			expect(isHandoffProtocol(handoff, protocol)).toBe(true);

			for (const other of protocols) {
				if (other !== protocol) {
					expect(isHandoffProtocol(handoff, other)).toBe(false);
				}
			}
		}
	});

	it('works with custom protocols', () => {
		const handoff: HandoffResult = {
			protocol: 'my-custom-protocol',
			endpoint: 'custom://example.com',
		};

		expect(isHandoffProtocol(handoff, 'my-custom-protocol')).toBe(true);
		expect(isHandoffProtocol(handoff, 'websocket')).toBe(false);
	});
});

describe('isHandoffCommand', () => {
	it('returns true when handoff property is true', () => {
		expect(isHandoffCommand({ handoff: true })).toBe(true);
	});

	it('returns true when handoff tag is present', () => {
		expect(isHandoffCommand({ tags: ['handoff'] })).toBe(true);
	});

	it('returns true when handoff tag is present among other tags', () => {
		expect(isHandoffCommand({ tags: ['streaming', 'handoff', 'realtime'] })).toBe(true);
	});

	it('returns false when handoff property is false', () => {
		expect(isHandoffCommand({ handoff: false })).toBe(false);
	});

	it('returns false when handoff property is undefined', () => {
		expect(isHandoffCommand({})).toBe(false);
	});

	it('returns false when tags do not include handoff', () => {
		expect(isHandoffCommand({ tags: ['streaming', 'realtime'] })).toBe(false);
	});

	it('returns false when tags is empty', () => {
		expect(isHandoffCommand({ tags: [] })).toBe(false);
	});

	it('returns true when both handoff property and tag are present', () => {
		expect(isHandoffCommand({ handoff: true, tags: ['handoff'] })).toBe(true);
	});
});

describe('getHandoffProtocol', () => {
	it('returns undefined for non-handoff commands', () => {
		expect(getHandoffProtocol({})).toBeUndefined();
		expect(getHandoffProtocol({ tags: ['streaming'] })).toBeUndefined();
	});

	it('returns handoffProtocol property when present', () => {
		expect(
			getHandoffProtocol({ handoff: true, handoffProtocol: 'websocket' })
		).toBe('websocket');
	});

	it('returns protocol from handoff:{protocol} tag', () => {
		expect(
			getHandoffProtocol({ tags: ['handoff', 'handoff:sse'] })
		).toBe('sse');
	});

	it('prefers handoffProtocol property over tag', () => {
		expect(
			getHandoffProtocol({
				handoff: true,
				handoffProtocol: 'websocket',
				tags: ['handoff:sse'],
			})
		).toBe('websocket');
	});

	it('returns undefined when handoff is true but no protocol specified', () => {
		expect(getHandoffProtocol({ handoff: true })).toBeUndefined();
	});

	it('returns undefined when only handoff tag present (no protocol tag)', () => {
		expect(getHandoffProtocol({ tags: ['handoff'] })).toBeUndefined();
	});

	it('works with custom protocols', () => {
		expect(
			getHandoffProtocol({ handoff: true, handoffProtocol: 'custom-proto' })
		).toBe('custom-proto');

		expect(
			getHandoffProtocol({ tags: ['handoff', 'handoff:my-protocol'] })
		).toBe('my-protocol');
	});

	it('extracts protocol correctly from tag with colons', () => {
		expect(
			getHandoffProtocol({ tags: ['handoff', 'handoff:http-stream'] })
		).toBe('http-stream');
	});
});
