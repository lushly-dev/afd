/**
 * @fileoverview Type definitions for the chat example
 */

/**
 * Chat room entity.
 */
export interface Room {
	id: string;
	name: string;
	description?: string;
	participants: number;
	maxParticipants: number;
	createdAt: Date;
}

/**
 * Session states.
 */
export type SessionState = 'pending' | 'connected' | 'disconnected';

/**
 * Chat session entity representing a user's connection to a room.
 */
export interface Session {
	id: string;
	roomId: string;
	userId: string;
	nickname: string;
	token: string;
	state: SessionState;
	expiresAt: Date;
	connectedAt?: Date;
	lastActivity?: Date;
	closedAt?: Date;
	duration?: number;
	messagesSent: number;
	messagesReceived: number;
}

/**
 * Chat message entity.
 */
export interface Message {
	id: string;
	roomId: string;
	sessionId: string;
	nickname: string;
	text: string;
	createdAt: Date;
}

/**
 * WebSocket client connection.
 */
export interface ChatClient {
	sessionId: string;
	userId: string;
	nickname: string;
}
