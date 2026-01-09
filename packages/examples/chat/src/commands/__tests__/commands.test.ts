/**
 * @fileoverview Tests for chat commands
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { chatService } from '../../services/chat.js';
import { chatConnect } from '../connect.js';
import { chatDisconnect } from '../disconnect.js';
import { chatPoll } from '../poll.js';
import { chatRooms } from '../rooms.js';
import { chatSend } from '../send.js';
import { chatStatus } from '../status.js';

// Reset state before each test
beforeEach(() => {
	chatService.clear();
});

describe('chat-rooms', () => {
	it('lists default rooms', async () => {
		const result = await chatRooms.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.rooms.length).toBeGreaterThan(0);
		expect(result.data?.rooms.some((r) => r.id === 'general')).toBe(true);
	});

	it('includes reasoning', async () => {
		const result = await chatRooms.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
		expect(result.reasoning).toContain('room');
	});
});

describe('chat-connect', () => {
	it('returns handoff for valid room', async () => {
		const result = await chatConnect.handler({ roomId: 'general', nickname: 'TestUser' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.protocol).toBe('websocket');
		expect(result.data?.endpoint).toContain('/rooms/general');
		expect(result.data?.credentials?.token).toBeDefined();
		expect(result.data?.credentials?.sessionId).toBeDefined();
	});

	it('includes handoff metadata', async () => {
		const result = await chatConnect.handler({ roomId: 'general', nickname: 'TestUser' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.metadata?.capabilities).toContain('text');
		expect(result.data?.metadata?.capabilities).toContain('typing');
		expect(result.data?.metadata?.reconnect?.allowed).toBe(true);
		expect(result.data?.metadata?.expiresAt).toBeDefined();
	});

	it('includes agent hints in metadata', async () => {
		const result = await chatConnect.handler({ roomId: 'general', nickname: 'TestUser' }, {});

		expect(result.success).toBe(true);
		const agentHints = result.metadata?.agentHints as Record<string, unknown>;
		expect(agentHints?.fallbackCommand).toBe('chat-poll');
		expect(agentHints?.delegateToUser).toBe(true);
	});

	it('fails for non-existent room', async () => {
		const result = await chatConnect.handler({ roomId: 'nonexistent', nickname: 'TestUser' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('ROOM_NOT_FOUND');
		expect(result.error?.suggestion).toBeDefined();
	});

	it('uses default nickname when not provided', async () => {
		const result = await chatConnect.handler({ roomId: 'general' }, {});

		expect(result.success).toBe(true);
		// Session created with 'Anonymous' nickname
		const sessionId = result.data?.credentials?.sessionId;
		expect(sessionId).toBeDefined();
		const session = chatService.getSession(sessionId!);
		expect(session?.nickname).toBe('Anonymous');
	});
});

describe('chat-status', () => {
	it('returns session status', async () => {
		// First connect to create a session
		const connectResult = await chatConnect.handler(
			{ roomId: 'general', nickname: 'TestUser' },
			{}
		);
		const sessionId = connectResult.data?.credentials?.sessionId;

		const result = await chatStatus.handler({ sessionId: sessionId! }, {});

		expect(result.success).toBe(true);
		expect(result.data?.sessionId).toBe(sessionId);
		expect(result.data?.roomId).toBe('general');
		expect(result.data?.state).toBe('pending'); // Not connected via WebSocket yet
		expect(result.data?.nickname).toBe('TestUser');
	});

	it('fails for non-existent session', async () => {
		const result = await chatStatus.handler({ sessionId: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('SESSION_NOT_FOUND');
	});
});

describe('chat-disconnect', () => {
	it('closes a session', async () => {
		// First connect
		const connectResult = await chatConnect.handler(
			{ roomId: 'general', nickname: 'TestUser' },
			{}
		);
		const sessionId = connectResult.data?.credentials?.sessionId;

		const result = await chatDisconnect.handler({ sessionId: sessionId! }, {});

		expect(result.success).toBe(true);
		expect(result.data?.sessionId).toBe(sessionId);
		expect(result.data?.closedAt).toBeDefined();
	});

	it('fails for non-existent session', async () => {
		const result = await chatDisconnect.handler({ sessionId: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('SESSION_NOT_FOUND');
	});
});

describe('chat-poll', () => {
	it('returns empty messages for empty room', async () => {
		const result = await chatPoll.handler({ roomId: 'general', limit: 50 }, {});

		expect(result.success).toBe(true);
		expect(result.data?.messages).toEqual([]);
		expect(result.data?.hasMore).toBe(false);
	});

	it('returns messages after they are sent', async () => {
		// Send a message
		await chatSend.handler({ roomId: 'general', text: 'Hello, world!' }, { traceId: 'test-user' });

		const result = await chatPoll.handler({ roomId: 'general', limit: 50 }, {});

		expect(result.success).toBe(true);
		expect(result.data?.messages.length).toBe(1);
		expect(result.data?.messages[0]?.text).toBe('Hello, world!');
	});

	it('supports pagination with since parameter', async () => {
		// Send multiple messages
		await chatSend.handler({ roomId: 'general', text: 'Message 1' }, {});
		await chatSend.handler({ roomId: 'general', text: 'Message 2' }, {});
		await chatSend.handler({ roomId: 'general', text: 'Message 3' }, {});

		// Get first batch
		const firstResult = await chatPoll.handler({ roomId: 'general', limit: 2 }, {});
		expect(firstResult.data?.messages.length).toBe(2);
		expect(firstResult.data?.hasMore).toBe(true);

		// Get next batch
		const secondResult = await chatPoll.handler(
			{ roomId: 'general', since: firstResult.data?.lastMessageId, limit: 50 },
			{}
		);
		expect(secondResult.data?.messages.length).toBe(1);
		expect(secondResult.data?.messages[0]?.text).toBe('Message 3');
	});

	it('fails for non-existent room', async () => {
		const result = await chatPoll.handler({ roomId: 'nonexistent', limit: 50 }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('ROOM_NOT_FOUND');
	});

	it('includes agent hints in metadata', async () => {
		const result = await chatPoll.handler({ roomId: 'general', limit: 50 }, {});

		expect(result.success).toBe(true);
		const agentHints = result.metadata?.agentHints as Record<string, unknown>;
		expect(agentHints?.pollInterval).toBe(5000);
	});
});

describe('chat-send', () => {
	it('sends a message', async () => {
		const result = await chatSend.handler({ roomId: 'general', text: 'Test message' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.messageId).toBeDefined();
		expect(result.data?.timestamp).toBeDefined();
	});

	it('fails for non-existent room', async () => {
		const result = await chatSend.handler({ roomId: 'nonexistent', text: 'Test' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('ROOM_NOT_FOUND');
	});

	it('uses session nickname when provided', async () => {
		// Create a session first
		const connectResult = await chatConnect.handler(
			{ roomId: 'general', nickname: 'TestUser' },
			{}
		);
		const sessionId = connectResult.data?.credentials?.sessionId;

		// Send with session
		await chatSend.handler({ roomId: 'general', text: 'Hello', sessionId }, {});

		// Poll to see the message
		const pollResult = await chatPoll.handler({ roomId: 'general', limit: 50 }, {});
		expect(pollResult.data?.messages[0]?.sender).toBe('TestUser');
	});
});

describe('AFD Compliance', () => {
	it('success results include reasoning', async () => {
		const result = await chatRooms.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
		expect(typeof result.reasoning).toBe('string');
	});

	it('error results include suggestion', async () => {
		const result = await chatConnect.handler({ roomId: 'nonexistent' }, {});

		expect(result.success).toBe(false);
		expect(result.error?.suggestion).toBeDefined();
	});

	it('handoff commands include proper metadata', async () => {
		const result = await chatConnect.handler({ roomId: 'general' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.protocol).toBeDefined();
		expect(result.data?.endpoint).toBeDefined();
		expect(result.data?.metadata).toBeDefined();
	});
});
