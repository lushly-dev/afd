/**
 * @fileoverview chat-send command
 *
 * Send a message to a chat room (for agents using polling).
 */

import { createError } from '@lushly-dev/afd-core';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { chatService } from '../services/chat.js';

const inputSchema = z.object({
	roomId: z.string().min(1).describe('Room ID to send message to'),
	text: z.string().min(1).max(2000).describe('Message text'),
	sessionId: z.string().optional().describe('Optional session ID for attribution'),
});

interface SendResult {
	messageId: string;
	timestamp: string;
}

export const chatSend = defineCommand<typeof inputSchema, SendResult>({
	name: 'chat-send',
	category: 'chat',
	description: 'Send a message to a chat room',
	tags: ['chat', 'write', 'agent-friendly'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['ROOM_NOT_FOUND', 'SESSION_NOT_FOUND'],

	async handler(input, ctx) {
		const room = chatService.getRoom(input.roomId);
		if (!room) {
			return failure(
				createError('ROOM_NOT_FOUND', 'Room does not exist', {
					suggestion: 'Use chat-rooms to list available rooms',
				})
			);
		}

		// Get nickname from session or use default
		let nickname = 'Agent';
		let sessionId = input.sessionId;

		if (sessionId) {
			const session = chatService.getSession(sessionId);
			if (session) {
				nickname = session.nickname;
			}
		} else {
			// Create an anonymous session for this message
			const session = chatService.createSession({
				roomId: input.roomId,
				userId: ctx.traceId ?? 'agent',
				nickname: 'Agent',
			});
			sessionId = session.id;
		}

		const message = chatService.saveMessage({
			roomId: input.roomId,
			sessionId: sessionId,
			nickname: nickname,
			text: input.text,
		});

		return success<SendResult>(
			{
				messageId: message.id,
				timestamp: message.createdAt.toISOString(),
			},
			{
				reasoning: `Message sent to room "${room.name}"`,
			}
		);
	},
});
