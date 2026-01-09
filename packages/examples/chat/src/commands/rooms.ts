/**
 * @fileoverview chat-rooms command
 *
 * List available chat rooms.
 */

import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { chatService } from '../services/chat.js';

const inputSchema = z.object({});

interface RoomInfo {
	id: string;
	name: string;
	description?: string;
	participants: number;
	maxParticipants: number;
	available: boolean;
}

interface RoomsResult {
	rooms: RoomInfo[];
	total: number;
}

export const chatRooms = defineCommand<typeof inputSchema, RoomsResult>({
	name: 'chat-rooms',
	category: 'chat',
	description: 'List available chat rooms',
	tags: ['chat', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: [],

	async handler() {
		const rooms = chatService.getRooms();

		return success<RoomsResult>(
			{
				rooms: rooms.map((r) => ({
					id: r.id,
					name: r.name,
					description: r.description,
					participants: r.participants,
					maxParticipants: r.maxParticipants,
					available: r.participants < r.maxParticipants,
				})),
				total: rooms.length,
			},
			{
				reasoning: `Found ${rooms.length} available chat rooms`,
			}
		);
	},
});
