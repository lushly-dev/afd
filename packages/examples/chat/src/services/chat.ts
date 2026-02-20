/**
 * @fileoverview Chat service for managing rooms, sessions, and messages
 */

import type { Message, Room, Session } from '../types.js';

/**
 * Generate a simple unique ID.
 */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a session token.
 */
function generateToken(): string {
	return `tok_${generateId()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * In-memory chat service.
 *
 * This is a simple implementation for demonstration purposes.
 * A production system would use a database and Redis for pub/sub.
 */
class ChatService {
	private rooms = new Map<string, Room>();
	private sessions = new Map<string, Session>();
	private messages: Message[] = [];

	constructor() {
		// Initialize with default rooms
		this.initializeDefaultRooms();
	}

	private initializeDefaultRooms(): void {
		const defaultRooms: Omit<Room, 'createdAt'>[] = [
			{
				id: 'general',
				name: 'General',
				description: 'General discussion room',
				participants: 0,
				maxParticipants: 100,
			},
			{
				id: 'random',
				name: 'Random',
				description: 'Random chat and off-topic discussions',
				participants: 0,
				maxParticipants: 50,
			},
			{
				id: 'help',
				name: 'Help',
				description: 'Get help with AFD and related topics',
				participants: 0,
				maxParticipants: 25,
			},
		];

		for (const room of defaultRooms) {
			this.rooms.set(room.id, {
				...room,
				createdAt: new Date(),
			});
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// ROOM OPERATIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Get a room by ID.
	 */
	getRoom(roomId: string): Room | undefined {
		return this.rooms.get(roomId);
	}

	/**
	 * Get all rooms.
	 */
	getRooms(): Room[] {
		return Array.from(this.rooms.values());
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// SESSION OPERATIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Create a new chat session.
	 */
	createSession(options: { roomId: string; userId: string; nickname: string }): Session {
		const session: Session = {
			id: `sess_${generateId()}`,
			roomId: options.roomId,
			userId: options.userId,
			nickname: options.nickname,
			token: generateToken(),
			state: 'pending',
			expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes to connect
			messagesSent: 0,
			messagesReceived: 0,
		};

		this.sessions.set(session.id, session);
		return session;
	}

	/**
	 * Get a session by ID.
	 */
	getSession(sessionId: string): Session | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Find a session by token.
	 */
	getSessionByToken(token: string): Session | undefined {
		for (const session of this.sessions.values()) {
			if (session.token === token) {
				return session;
			}
		}
		return undefined;
	}

	/**
	 * Mark a session as connected.
	 */
	markConnected(sessionId: string): Session | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;

		const room = this.rooms.get(session.roomId);
		if (room) {
			room.participants++;
		}

		session.state = 'connected';
		session.connectedAt = new Date();
		session.lastActivity = new Date();
		return session;
	}

	/**
	 * Mark a session as disconnected.
	 */
	markDisconnected(sessionId: string): Session | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;

		const room = this.rooms.get(session.roomId);
		if (room && room.participants > 0) {
			room.participants--;
		}

		session.state = 'disconnected';
		session.closedAt = new Date();
		if (session.connectedAt) {
			session.duration = Math.floor(
				(session.closedAt.getTime() - session.connectedAt.getTime()) / 1000
			);
		}
		return session;
	}

	/**
	 * End a session explicitly.
	 */
	endSession(sessionId: string, _options?: { reason?: string }): Session | undefined {
		return this.markDisconnected(sessionId);
	}

	/**
	 * Update session activity.
	 */
	updateActivity(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.lastActivity = new Date();
		}
	}

	/**
	 * Increment messages sent counter.
	 */
	incrementMessagesSent(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.messagesSent++;
			session.lastActivity = new Date();
		}
	}

	/**
	 * Increment messages received counter.
	 */
	incrementMessagesReceived(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.messagesReceived++;
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MESSAGE OPERATIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Save a message.
	 */
	saveMessage(options: {
		roomId: string;
		sessionId: string;
		nickname: string;
		text: string;
	}): Message {
		const message: Message = {
			id: `msg_${generateId()}`,
			roomId: options.roomId,
			sessionId: options.sessionId,
			nickname: options.nickname,
			text: options.text,
			createdAt: new Date(),
		};

		this.messages.push(message);
		this.incrementMessagesSent(options.sessionId);

		return message;
	}

	/**
	 * Get messages for a room.
	 */
	getMessages(options: { roomId: string; after?: string; limit?: number }): Message[] {
		const limit = options.limit ?? 50;

		let filtered = this.messages.filter((m) => m.roomId === options.roomId);

		if (options.after) {
			const afterIndex = filtered.findIndex((m) => m.id === options.after);
			if (afterIndex !== -1) {
				filtered = filtered.slice(afterIndex + 1);
			}
		}

		return filtered.slice(0, limit);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// UTILITY
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Clear all data (for testing).
	 */
	clear(): void {
		this.rooms.clear();
		this.sessions.clear();
		this.messages = [];
		this.initializeDefaultRooms();
	}
}

/**
 * Singleton chat service instance.
 */
export const chatService = new ChatService();
