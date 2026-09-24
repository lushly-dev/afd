/**
 * @fileoverview WebSocket server for real-time chat
 *
 * This server handles WebSocket connections after handoff from the chat-connect
 * command, and serves the browser demo (`demo.html`) from the same origin.
 *
 * Security defaults:
 * - binds 127.0.0.1;
 * - refuses messages over `maxPayload` bytes (16 KiB instead of the `ws`
 *   default of 100 MiB) and chat text over 2000 characters;
 * - refuses upgrades from browser origins other than `allowedOrigins`
 *   (a WebSocket is not covered by CORS, so the server must check), and
 *   `Host` headers that do not name this server (DNS rebinding).
 */

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';
import { demoOrigins } from './config.js';
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
		this.rooms.get(roomId)?.set(ws, client);
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

/** Longest chat message, matching the chat-send command's schema. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Message types from clients.
 */
interface ClientMessage {
	type: 'message' | 'typing' | 'ping';
	text?: unknown;
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

export interface WebSocketServerOptions {
	/** Port for WebSocket upgrades and the demo page (default 3001; 0 picks a free port). */
	port?: number;
	/** Interface to bind (default `127.0.0.1`). */
	host?: string;
	/** Largest incoming message in bytes (default 16 KiB). */
	maxPayload?: number;
	/** Exact browser origins allowed to connect (default: the demo page's localhost origins). */
	allowedOrigins?: string[];
	/** Host names accepted in the `Host` header (default: localhost, 127.0.0.1, [::1] and `host`). */
	allowedHosts?: string[];
}

export interface ChatRealtimeServer {
	/** The WebSocket server. */
	wss: WebSocketServer;
	/** The HTTP server it is attached to, which also serves the demo page. */
	http: Server;
	/** Resolves with the bound address once listening. */
	ready: Promise<AddressInfo>;
	/** Close every connection and stop listening. */
	close(): Promise<void>;
}

/** Scripts only from this origin, so injected markup cannot run code. */
const DEMO_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	// The page calls the local MCP server's /rpc route and opens the WebSocket.
	"connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'",
].join('; ');

const DEMO_FILES: Record<string, { file: URL; type: string }> = {
	'/': { file: new URL('../demo.html', import.meta.url), type: 'text/html; charset=utf-8' },
	'/demo.html': {
		file: new URL('../demo.html', import.meta.url),
		type: 'text/html; charset=utf-8',
	},
	'/demo.js': {
		file: new URL('../demo.js', import.meta.url),
		type: 'text/javascript; charset=utf-8',
	},
};

/** Whether an upgrade or page request comes from an allowed browser origin (or no browser). */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
	if (origin === undefined) return true; // non-browser clients send no Origin
	return origin !== 'null' && allowed.includes(origin);
}

/** Whether the `Host` header names this server. */
export function isHostAllowed(host: string | undefined, allowed: readonly string[]): boolean {
	if (!host || /[\s/@\\?#]/.test(host)) return false;
	try {
		return allowed.includes(new URL(`http://${host}`).hostname.toLowerCase());
	} catch {
		return false;
	}
}

function sendText(res: ServerResponse, status: number, text: string): void {
	res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end(text);
}

/**
 * Create and start the WebSocket server.
 */
export function createWebSocketServer(options: WebSocketServerOptions = {}): ChatRealtimeServer {
	const port = options.port ?? 3001;
	const host = options.host ?? '127.0.0.1';
	const hostName = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	const allowedHosts = options.allowedHosts ?? ['localhost', '127.0.0.1', '[::1]', hostName];
	const allowedOrigins = options.allowedOrigins ?? demoOrigins(port);

	const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		if (!isHostAllowed(req.headers.host, allowedHosts)) {
			sendText(res, 403, 'Host not allowed');
			return;
		}
		const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
		const entry = DEMO_FILES[pathname];
		if (req.method !== 'GET' || !entry) {
			sendText(res, 404, 'Not found. Connect with WebSocket to /rooms/:roomId');
			return;
		}
		try {
			const body = await readFile(entry.file);
			res.writeHead(200, {
				'Content-Type': entry.type,
				'Content-Security-Policy': DEMO_CSP,
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'no-store',
			});
			res.end(body);
		} catch {
			sendText(res, 500, 'Demo page unavailable');
		}
	});

	const wss = new WebSocketServer({
		server: http,
		maxPayload: options.maxPayload ?? 16 * 1024,
		verifyClient: ({ origin, req }, done) => {
			if (!isHostAllowed(req.headers.host, allowedHosts)) {
				done(false, 403, 'Host not allowed');
			} else if (!isOriginAllowed(origin, allowedOrigins)) {
				done(false, 403, 'Origin not allowed');
			} else {
				done(true);
			}
		},
	});

	wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
		// Parse URL
		const url = new URL(req.url ?? '/', 'ws://localhost');
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
					case 'message': {
						const text = typeof msg.text === 'string' ? msg.text.trim() : '';
						if (!text) {
							sendError(ws, 'Message text required');
							return;
						}
						if (text.length > MAX_MESSAGE_LENGTH) {
							sendError(ws, `Message text is limited to ${MAX_MESSAGE_LENGTH} characters`);
							return;
						}

						const saved = chatService.saveMessage({
							roomId,
							sessionId: session.id,
							nickname: session.nickname,
							text,
						});

						roomManager.broadcast(roomId, {
							type: 'message',
							id: saved.id,
							sender: session.nickname,
							text,
							timestamp: saved.createdAt.getTime(),
						});
						break;
					}

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

	const ready = new Promise<AddressInfo>((resolve, reject) => {
		http.once('error', reject);
		http.listen(port, host, () => resolve(http.address() as AddressInfo));
	});

	async function close(): Promise<void> {
		for (const client of wss.clients) client.terminate();
		await new Promise<void>((resolve) => wss.close(() => resolve()));
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	}

	return { wss, http, ready, close };
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
