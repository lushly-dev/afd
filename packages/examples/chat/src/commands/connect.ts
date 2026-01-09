/**
 * @fileoverview chat-connect command
 *
 * Connects to a chat room and returns a WebSocket handoff for real-time messaging.
 */

import { createError } from '@lushly-dev/afd-core';
import type { HandoffResult } from '@lushly-dev/afd-core';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { chatService } from '../services/chat.js';

const inputSchema = z.object({
	roomId: z.string().min(1).describe('Chat room ID'),
	nickname: z.string().min(1).max(50).optional().describe('Display name'),
});

export const chatConnect = defineCommand<typeof inputSchema, HandoffResult>({
	name: 'chat-connect',
	category: 'chat',
	description: 'Connect to a chat room for real-time messaging',
	tags: ['chat', 'handoff', 'handoff:websocket'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['ROOM_NOT_FOUND', 'ROOM_FULL'],

	async handler(input, ctx) {
		// Check room exists
		const room = chatService.getRoom(input.roomId);
		if (!room) {
			return failure(
				createError('ROOM_NOT_FOUND', `Room "${input.roomId}" does not exist`, {
					suggestion: 'Use chat-rooms to list available rooms',
				})
			);
		}

		// Check room capacity
		if (room.participants >= room.maxParticipants) {
			return failure(
				createError('ROOM_FULL', 'Room is at capacity', {
					suggestion: 'Try again later or join a different room',
				})
			);
		}

		// Create session
		const session = chatService.createSession({
			roomId: input.roomId,
			userId: ctx.traceId ?? 'anonymous',
			nickname: input.nickname ?? 'Anonymous',
		});

		// Get WebSocket base URL from environment or use default
		const wsBaseUrl = process.env.WS_BASE_URL ?? 'ws://localhost:3001';

		return success<HandoffResult>(
			{
				protocol: 'websocket',
				endpoint: `${wsBaseUrl}/rooms/${input.roomId}`,
				credentials: {
					token: session.token,
					sessionId: session.id,
				},
				metadata: {
					expiresAt: session.expiresAt.toISOString(),
					capabilities: ['text', 'typing', 'presence', 'reactions'],
					reconnect: {
						allowed: true,
						maxAttempts: 5,
						backoffMs: 1000,
					},
					description: `Real-time chat in "${room.name}"`,
				},
			},
			{
				reasoning: `Session created for room "${room.name}". Connect to the WebSocket URL within 5 minutes.`,
				metadata: {
					agentHints: {
						handoffType: 'websocket',
						consumable: false,
						delegateToUser: true,
						fallbackCommand: 'chat-poll',
					},
				},
			}
		);
	},
});
