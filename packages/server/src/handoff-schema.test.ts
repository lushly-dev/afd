import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	HandoffCredentialsSchema,
	HandoffMetadataSchema,
	HandoffResultSchema,
} from './handoff-schema.js';
import { defineCommand, success } from './index.js';

describe('HandoffCredentialsSchema', () => {
	it('parses empty object', () => {
		const result = HandoffCredentialsSchema.parse({});
		expect(result).toEqual({});
	});

	it('parses with token', () => {
		const result = HandoffCredentialsSchema.parse({ token: 'abc123' });
		expect(result.token).toBe('abc123');
	});

	it('parses with sessionId', () => {
		const result = HandoffCredentialsSchema.parse({ sessionId: 'session-xyz' });
		expect(result.sessionId).toBe('session-xyz');
	});

	it('parses with headers', () => {
		const result = HandoffCredentialsSchema.parse({
			headers: { 'X-Custom': 'value', Authorization: 'Bearer token' },
		});
		expect(result.headers).toEqual({
			'X-Custom': 'value',
			Authorization: 'Bearer token',
		});
	});

	it('parses with all fields', () => {
		const input = {
			token: 'abc123',
			sessionId: 'session-xyz',
			headers: { 'X-Custom': 'value' },
		};
		const result = HandoffCredentialsSchema.parse(input);
		expect(result).toEqual(input);
	});

	it('rejects non-string token', () => {
		expect(() => HandoffCredentialsSchema.parse({ token: 123 })).toThrow();
	});

	it('rejects non-string sessionId', () => {
		expect(() => HandoffCredentialsSchema.parse({ sessionId: 123 })).toThrow();
	});

	it('rejects non-object headers', () => {
		expect(() => HandoffCredentialsSchema.parse({ headers: 'invalid' })).toThrow();
	});
});

describe('HandoffMetadataSchema', () => {
	it('parses empty object', () => {
		const result = HandoffMetadataSchema.parse({});
		expect(result).toEqual({});
	});

	it('parses with expectedLatency', () => {
		const result = HandoffMetadataSchema.parse({ expectedLatency: 50 });
		expect(result.expectedLatency).toBe(50);
	});

	it('parses with capabilities', () => {
		const result = HandoffMetadataSchema.parse({
			capabilities: ['text', 'presence', 'typing'],
		});
		expect(result.capabilities).toEqual(['text', 'presence', 'typing']);
	});

	it('parses with expiresAt as ISO datetime', () => {
		const result = HandoffMetadataSchema.parse({
			expiresAt: '2025-01-15T12:00:00Z',
		});
		expect(result.expiresAt).toBe('2025-01-15T12:00:00Z');
	});

	it('parses with description', () => {
		const result = HandoffMetadataSchema.parse({
			description: 'Real-time chat connection',
		});
		expect(result.description).toBe('Real-time chat connection');
	});

	it('parses with reconnect policy', () => {
		const result = HandoffMetadataSchema.parse({
			reconnect: {
				allowed: true,
				maxAttempts: 5,
				backoffMs: 1000,
			},
		});
		expect(result.reconnect).toEqual({
			allowed: true,
			maxAttempts: 5,
			backoffMs: 1000,
		});
	});

	it('parses reconnect with only required field', () => {
		const result = HandoffMetadataSchema.parse({
			reconnect: { allowed: false },
		});
		expect(result.reconnect).toEqual({ allowed: false });
	});

	it('parses with all fields', () => {
		const input = {
			expectedLatency: 50,
			capabilities: ['text', 'presence'],
			expiresAt: '2025-01-15T12:00:00Z',
			reconnect: {
				allowed: true,
				maxAttempts: 5,
				backoffMs: 1000,
			},
			description: 'Chat connection',
		};
		const result = HandoffMetadataSchema.parse(input);
		expect(result).toEqual(input);
	});

	it('rejects non-number expectedLatency', () => {
		expect(() => HandoffMetadataSchema.parse({ expectedLatency: 'fast' })).toThrow();
	});

	it('rejects non-array capabilities', () => {
		expect(() => HandoffMetadataSchema.parse({ capabilities: 'text' })).toThrow();
	});

	it('rejects invalid datetime for expiresAt', () => {
		expect(() => HandoffMetadataSchema.parse({ expiresAt: 'not-a-date' })).toThrow();
	});

	it('rejects reconnect without allowed field', () => {
		expect(() => HandoffMetadataSchema.parse({ reconnect: { maxAttempts: 5 } })).toThrow();
	});

	it('rejects non-boolean reconnect.allowed', () => {
		expect(() => HandoffMetadataSchema.parse({ reconnect: { allowed: 'yes' } })).toThrow();
	});
});

describe('HandoffResultSchema', () => {
	it('parses minimal valid handoff', () => {
		const result = HandoffResultSchema.parse({
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
		});

		expect(result.protocol).toBe('websocket');
		expect(result.endpoint).toBe('wss://example.com/chat');
	});

	it('parses with all standard protocols', () => {
		const protocols = ['websocket', 'webrtc', 'sse', 'http-stream'];

		for (const protocol of protocols) {
			const result = HandoffResultSchema.parse({
				protocol,
				endpoint: 'https://example.com',
			});
			expect(result.protocol).toBe(protocol);
		}
	});

	it('parses with custom protocol', () => {
		const result = HandoffResultSchema.parse({
			protocol: 'my-custom-protocol',
			endpoint: 'https://example.com',
		});
		expect(result.protocol).toBe('my-custom-protocol');
	});

	it('parses with credentials', () => {
		const result = HandoffResultSchema.parse({
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
			credentials: {
				token: 'abc123',
				sessionId: 'session-xyz',
			},
		});

		expect(result.credentials).toEqual({
			token: 'abc123',
			sessionId: 'session-xyz',
		});
	});

	it('parses with metadata', () => {
		const result = HandoffResultSchema.parse({
			protocol: 'websocket',
			endpoint: 'wss://example.com/chat',
			metadata: {
				capabilities: ['text', 'presence'],
				reconnect: { allowed: true },
			},
		});

		expect(result.metadata).toEqual({
			capabilities: ['text', 'presence'],
			reconnect: { allowed: true },
		});
	});

	it('parses complete handoff result', () => {
		const input = {
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
				description: 'Real-time chat connection',
			},
		};

		const result = HandoffResultSchema.parse(input);
		expect(result).toEqual(input);
	});

	it('rejects missing protocol', () => {
		expect(() =>
			HandoffResultSchema.parse({
				endpoint: 'wss://example.com/chat',
			})
		).toThrow();
	});

	it('rejects missing endpoint', () => {
		expect(() =>
			HandoffResultSchema.parse({
				protocol: 'websocket',
			})
		).toThrow();
	});

	it('rejects invalid URL for endpoint', () => {
		expect(() =>
			HandoffResultSchema.parse({
				protocol: 'websocket',
				endpoint: 'not-a-url',
			})
		).toThrow();
	});

	it('rejects non-string protocol', () => {
		expect(() =>
			HandoffResultSchema.parse({
				protocol: 123,
				endpoint: 'wss://example.com/chat',
			})
		).toThrow();
	});

	it('rejects invalid credentials', () => {
		expect(() =>
			HandoffResultSchema.parse({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				credentials: 'invalid',
			})
		).toThrow();
	});

	it('rejects invalid metadata', () => {
		expect(() =>
			HandoffResultSchema.parse({
				protocol: 'websocket',
				endpoint: 'wss://example.com/chat',
				metadata: 'invalid',
			})
		).toThrow();
	});
});

describe('defineCommand with handoff', () => {
	it('creates command with handoff: true', () => {
		const cmd = defineCommand({
			name: 'chat.connect',
			description: 'Connect to chat room',
			input: z.object({ roomId: z.string() }),
			handoff: true,
			async handler() {
				return success({ protocol: 'websocket', endpoint: 'wss://example.com' });
			},
		});

		expect(cmd.handoff).toBe(true);
		expect(cmd.tags).toContain('handoff');
	});

	it('creates command with handoff and protocol', () => {
		const cmd = defineCommand({
			name: 'chat.connect',
			description: 'Connect to chat room',
			input: z.object({ roomId: z.string() }),
			handoff: true,
			handoffProtocol: 'websocket',
			async handler() {
				return success({ protocol: 'websocket', endpoint: 'wss://example.com' });
			},
		});

		expect(cmd.handoff).toBe(true);
		expect(cmd.handoffProtocol).toBe('websocket');
		expect(cmd.tags).toContain('handoff');
		expect(cmd.tags).toContain('handoff:websocket');
	});

	it('preserves existing tags when adding handoff tags', () => {
		const cmd = defineCommand({
			name: 'chat.connect',
			description: 'Connect to chat room',
			input: z.object({ roomId: z.string() }),
			tags: ['realtime', 'streaming'],
			handoff: true,
			handoffProtocol: 'websocket',
			async handler() {
				return success({ protocol: 'websocket', endpoint: 'wss://example.com' });
			},
		});

		expect(cmd.tags).toContain('realtime');
		expect(cmd.tags).toContain('streaming');
		expect(cmd.tags).toContain('handoff');
		expect(cmd.tags).toContain('handoff:websocket');
	});

	it('does not add handoff tags when handoff is false', () => {
		const cmd = defineCommand({
			name: 'chat.list',
			description: 'List chat rooms',
			input: z.object({}),
			handoff: false,
			async handler() {
				return success([]);
			},
		});

		expect(cmd.handoff).toBe(false);
		expect(cmd.tags).toBeUndefined();
	});

	it('does not add handoff tags when handoff is undefined', () => {
		const cmd = defineCommand({
			name: 'chat.list',
			description: 'List chat rooms',
			input: z.object({}),
			tags: ['list'],
			async handler() {
				return success([]);
			},
		});

		expect(cmd.handoff).toBeUndefined();
		expect(cmd.tags).toEqual(['list']);
	});

	it('supports all standard protocols', () => {
		const protocols = ['websocket', 'webrtc', 'sse', 'http-stream'] as const;

		for (const protocol of protocols) {
			const cmd = defineCommand({
				name: `stream.${protocol}`,
				description: `Connect via ${protocol}`,
				input: z.object({}),
				handoff: true,
				handoffProtocol: protocol,
				async handler() {
					return success({ protocol, endpoint: 'https://example.com' });
				},
			});

			expect(cmd.handoffProtocol).toBe(protocol);
			expect(cmd.tags).toContain(`handoff:${protocol}`);
		}
	});

	it('supports custom protocols', () => {
		const cmd = defineCommand({
			name: 'stream.custom',
			description: 'Connect via custom protocol',
			input: z.object({}),
			handoff: true,
			handoffProtocol: 'my-custom-protocol',
			async handler() {
				return success({
					protocol: 'my-custom-protocol',
					endpoint: 'custom://example.com',
				});
			},
		});

		expect(cmd.handoffProtocol).toBe('my-custom-protocol');
		expect(cmd.tags).toContain('handoff:my-custom-protocol');
	});

	it('includes handoff properties in toCommandDefinition()', () => {
		const cmd = defineCommand({
			name: 'chat.connect',
			description: 'Connect to chat room',
			input: z.object({ roomId: z.string() }),
			handoff: true,
			handoffProtocol: 'websocket',
			async handler() {
				return success({ protocol: 'websocket', endpoint: 'wss://example.com' });
			},
		});

		const def = cmd.toCommandDefinition();

		expect(def.handoff).toBe(true);
		expect(def.handoffProtocol).toBe('websocket');
		expect(def.tags).toContain('handoff');
		expect(def.tags).toContain('handoff:websocket');
	});

	it('does not duplicate handoff tag if already present', () => {
		const cmd = defineCommand({
			name: 'chat.connect',
			description: 'Connect to chat room',
			input: z.object({}),
			tags: ['handoff'], // Already has handoff tag
			handoff: true,
			async handler() {
				return success({ protocol: 'websocket', endpoint: 'wss://example.com' });
			},
		});

		// Should only have one 'handoff' tag
		const handoffCount = cmd.tags?.filter((t) => t === 'handoff').length ?? 0;
		expect(handoffCount).toBe(1);
	});
});
