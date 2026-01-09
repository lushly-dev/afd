/**
 * @fileoverview WebSocket server for real-time chat
 *
 * This server handles WebSocket connections after handoff from the chat-connect command.
 */

import type { IncomingMessage } from 'http';
import { type WebSocket, WebSocketServer } from 'ws';
import { chatService } from './services/chat.js';
import type { ChatClient } from './types.js';

/**
 * Room manager for tracking connected clients.
 */
class RoomManager {
	private rooms = new Map<string, Map<WebSocket, ChatClient>>();

	/**
	 * Join a room.
	 */
	join(roomId: string, ws: WebSocket, client: ChatClient): void {
		if (!this.rooms.has(roomId)) {
			this.rooms.set(roomId, new Map());
		}
		this.rooms.get(roomId)!.set(ws, client);
	}

	/**
	 * Leave a room.
	 */
	leave(roomId: string, ws: WebSocket): ChatClient | undefined {
		const room = this.rooms.get(roomId);
		if (!room) return undefined;

		const client = room.get(ws);
		room.delete(ws);

		if (room.size === 0) {
			this.rooms.delete(roomId);
		}

		return client;
	}

	/**
	 * Broadcast a message to all clients in a room.
	 */
	broadcast(roomId: string, message: unknown, exclude?: WebSocket): void {
		const room = this.rooms.get(roomId);
		if (!room) return;

		const data = JSON.stringify(message);
		for (const [ws] of room) {
			if (ws !== exclude && ws.readyState === ws.OPEN) {
				ws.send(data);
			}
		}
	}

	/**
	 * Get all clients in a room.
	 */
	getClients(roomId: string): ChatClient[] {
		const room = this.rooms.get(roomId);
		if (!room) return [];
		return Array.from(room.values());
	}
}

const roomManager = new RoomManager();

/**
 * Message types from clients.
 */
interface ClientMessage {
	type: 'message' | 'typing' | 'ping';
	text?: string;
}

/**
 * Message types to clients.
 */
type ServerMessage =
	| { type: 'message'; id: string; sender: string; text: string; timestamp: number }
	| { type: 'user_joined'; nickname: string; timestamp: number }
	| { type: 'user_left'; nickname: string; timestamp: number }
	| { type: 'typing'; nickname: string }
	| { type: 'pong' }
	| { type: 'error'; message: string }
	| { type: 'welcome'; roomId: string; participants: string[] };

/**
 * Create and start the WebSocket server.
 */
export function createWebSocketServer(port = 3001): WebSocketServer {
	const wss = new WebSocketServer({ port });

	wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
		// Parse URL
		const url = new URL(req.url ?? '/', `ws://${req.headers.host ?? 'localhost'}`);
		const pathParts = url.pathname.split('/').filter(Boolean);

		// Expect /rooms/:roomId
		if (pathParts[0] !== 'rooms' || !pathParts[1]) {
			sendError(ws, 'Invalid path. Use /rooms/:roomId');
			ws.close(4000, 'Invalid path');
			return;
		}

		const roomId = pathParts[1];
		const token = url.searchParams.get('token');

		if (!token) {
			sendError(ws, 'Missing token');
			ws.close(4001, 'Missing token');
			return;
		}

		// Validate token
		const session = chatService.getSessionByToken(token);
		if (!session) {
			sendError(ws, 'Invalid token');
			ws.close(4001, 'Invalid token');
			return;
		}

		// Verify session matches room
		if (session.roomId !== roomId) {
			sendError(ws, 'Session room mismatch');
			ws.close(4003, 'Session mismatch');
			return;
		}

		// Check session is not expired
		if (session.expiresAt < new Date()) {
			sendError(ws, 'Session expired');
			ws.close(4002, 'Session expired');
			return;
		}

		// Mark session as connected
		chatService.markConnected(session.id);

		// Add to room
		const client: ChatClient = {
			sessionId: session.id,
			userId: session.userId,
			nickname: session.nickname,
		};
		roomManager.join(roomId, ws, client);

		// Send welcome message
		const participants = roomManager.getClients(roomId).map((c) => c.nickname);
		send(ws, {
			type: 'welcome',
			roomId,
			participants,
		});

		// Broadcast join
		roomManager.broadcast(
			roomId,
			{
				type: 'user_joined',
				nickname: session.nickname,
				timestamp: Date.now(),
			},
			ws
		);

		// Handle messages
		ws.on('message', async (data: Buffer) => {
			try {
				const msg = JSON.parse(data.toString()) as ClientMessage;

				switch (msg.type) {
					case 'message':
						if (!msg.text) {
							sendError(ws, 'Message text required');
							return;
						}

						const saved = chatService.saveMessage({
							roomId,
							sessionId: session.id,
							nickname: session.nickname,
							text: msg.text,
						});

						roomManager.broadcast(roomId, {
							type: 'message',
							id: saved.id,
							sender: session.nickname,
							text: msg.text,
							timestamp: saved.createdAt.getTime(),
						});
						break;

					case 'typing':
						roomManager.broadcast(
							roomId,
							{
								type: 'typing',
								nickname: session.nickname,
							},
							ws
						);
						break;

					case 'ping':
						send(ws, { type: 'pong' });
						chatService.updateActivity(session.id);
						break;

					default:
						sendError(ws, 'Unknown message type');
				}
			} catch {
				sendError(ws, 'Invalid message format');
			}
		});

		// Handle disconnect
		ws.on('close', async () => {
			chatService.markDisconnected(session.id);
			roomManager.leave(roomId, ws);

			roomManager.broadcast(roomId, {
				type: 'user_left',
				nickname: session.nickname,
				timestamp: Date.now(),
			});
		});

		// Handle errors
		ws.on('error', (error) => {
			console.error(`WebSocket error for session ${session.id}:`, error);
		});
	});

	return wss;
}

/**
 * Send a message to a WebSocket client.
 */
function send(ws: WebSocket, message: ServerMessage): void {
	if (ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify(message));
	}
}

/**
 * Send an error message to a WebSocket client.
 */
function sendError(ws: WebSocket, message: string): void {
	send(ws, { type: 'error', message });
}
