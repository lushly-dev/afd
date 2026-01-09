/**
 * @fileoverview chat-status command
 *
 * Get the status of a chat session.
 */

import { createError } from '@lushly-dev/afd-core';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { chatService } from '../services/chat.js';

const inputSchema = z.object({
	sessionId: z.string().min(1).describe('Session ID to check'),
});

interface StatusResult {
	sessionId: string;
	roomId: string;
	state: string;
	nickname: string;
	connectedAt?: string;
	lastActivity?: string;
	metrics: {
		messagesSent: number;
		messagesReceived: number;
	};
}

export const chatStatus = defineCommand<typeof inputSchema, StatusResult>({
	name: 'chat-status',
	category: 'chat',
	description: 'Get status of a chat session',
	tags: ['chat', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: ['SESSION_NOT_FOUND', 'FORBIDDEN'],

	async handler(input) {
		const session = chatService.getSession(input.sessionId);

		if (!session) {
			return failure(
				createError('SESSION_NOT_FOUND', 'Session does not exist', {
					suggestion: 'Use chat-connect to create a new session',
				})
			);
		}

		return success<StatusResult>(
			{
				sessionId: session.id,
				roomId: session.roomId,
				state: session.state,
				nickname: session.nickname,
				connectedAt: session.connectedAt?.toISOString(),
				lastActivity: session.lastActivity?.toISOString(),
				metrics: {
					messagesSent: session.messagesSent,
					messagesReceived: session.messagesReceived,
				},
			},
			{
				reasoning: `Session "${session.id}" is ${session.state}`,
			}
		);
	},
});
