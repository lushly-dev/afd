/**
 * @fileoverview chat-disconnect command
 *
 * End a chat session.
 */

import { createError } from '@lushly-dev/afd-core';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { chatService } from '../services/chat.js';

const inputSchema = z.object({
	sessionId: z.string().min(1).describe('Session ID to disconnect'),
	reason: z.string().optional().describe('Optional disconnect reason'),
});

interface DisconnectResult {
	sessionId: string;
	closedAt: string;
	duration?: number;
	messagesSent: number;
}

export const chatDisconnect = defineCommand<typeof inputSchema, DisconnectResult>({
	name: 'chat-disconnect',
	category: 'chat',
	description: 'End a chat session',
	tags: ['chat', 'write', 'safe'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['SESSION_NOT_FOUND', 'FORBIDDEN'],

	async handler(input) {
		const session = chatService.getSession(input.sessionId);

		if (!session) {
			return failure(
				createError('SESSION_NOT_FOUND', 'Session does not exist', {
					suggestion: 'The session may have already been closed',
				})
			);
		}

		const closedSession = chatService.endSession(session.id, {
			reason: input.reason,
		});

		if (!closedSession) {
			return failure(createError('SESSION_NOT_FOUND', 'Failed to close session'));
		}

		return success<DisconnectResult>(
			{
				sessionId: closedSession.id,
				closedAt: closedSession.closedAt?.toISOString() ?? new Date().toISOString(),
				duration: closedSession.duration,
				messagesSent: closedSession.messagesSent,
			},
			{
				reasoning: 'Session closed. Any active WebSocket connection will be terminated.',
			}
		);
	},
});
