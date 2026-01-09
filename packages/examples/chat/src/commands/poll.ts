/**
 * @fileoverview chat-poll command
 *
 * Poll for new messages - a fallback for agents that cannot use WebSocket.
 */

import { createError } from '@lushly-dev/afd-core';
import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { chatService } from '../services/chat.js';

const inputSchema = z.object({
	roomId: z.string().min(1).describe('Room ID to poll messages from'),
	since: z.string().optional().describe('Last message ID seen'),
	limit: z.number().min(1).max(100).optional().default(50).describe('Maximum messages to return'),
});

interface PollMessage {
	id: string;
	sender: string;
	text: string;
	timestamp: string;
}

interface PollResult {
	roomId: string;
	messages: PollMessage[];
	hasMore: boolean;
	lastMessageId?: string;
}

export const chatPoll = defineCommand<typeof inputSchema, PollResult>({
	name: 'chat-poll',
	category: 'chat',
	description: 'Poll for new messages (fallback for agents without WebSocket)',
	tags: ['chat', 'read', 'agent-friendly'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: ['ROOM_NOT_FOUND'],

	async handler(input) {
		const room = chatService.getRoom(input.roomId);
		if (!room) {
			return failure(
				createError('ROOM_NOT_FOUND', 'Room does not exist', {
					suggestion: 'Use chat-rooms to list available rooms',
				})
			);
		}

		const limit = input.limit ?? 50;
		const messages = chatService.getMessages({
			roomId: input.roomId,
			after: input.since,
			limit: limit,
		});

		const lastMessage = messages[messages.length - 1];

		return success<PollResult>(
			{
				roomId: input.roomId,
				messages: messages.map((m) => ({
					id: m.id,
					sender: m.nickname,
					text: m.text,
					timestamp: m.createdAt.toISOString(),
				})),
				hasMore: messages.length === limit,
				lastMessageId: lastMessage?.id,
			},
			{
				reasoning:
					messages.length > 0 ? `Retrieved ${messages.length} messages` : 'No new messages',
				metadata: {
					agentHints: {
						nextAction:
							messages.length > 0
								? `Process ${messages.length} messages. Poll again with since="${lastMessage?.id}"`
								: 'No new messages. Wait 3-5 seconds and poll again.',
						pollInterval: 5000,
					},
				},
			}
		);
	},
});
