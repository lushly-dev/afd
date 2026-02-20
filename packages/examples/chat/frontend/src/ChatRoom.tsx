/**
 * @fileoverview ChatRoom React component example
 *
 * This example demonstrates how to use the handoff pattern with React:
 * 1. Call chat-connect to get WebSocket credentials
 * 2. Connect to the WebSocket server using the returned endpoint and token
 * 3. Handle real-time messages and events
 */

import type { HandoffResult } from '@lushly-dev/afd-core';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Message {
	id: string;
	sender: string;
	text: string;
	timestamp: number;
}

interface ChatRoomProps {
	roomId: string;
	nickname?: string;
	/** AFD client instance for calling commands */
	client: {
		call: <T>(
			command: string,
			input: unknown
		) => Promise<{
			success: boolean;
			data?: T;
			error?: { code: string; message: string };
		}>;
	};
}

/**
 * ChatRoom component - connects to a chat room via WebSocket handoff.
 *
 * @example
 * ```tsx
 * <ChatRoom
 *   roomId="general"
 *   nickname="User123"
 *   client={afdClient}
 * />
 * ```
 */
export function ChatRoom({ roomId, nickname = 'Anonymous', client }: ChatRoomProps) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [connected, setConnected] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [inputText, setInputText] = useState('');
	const [participants, setParticipants] = useState<string[]>([]);
	const wsRef = useRef<WebSocket | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	// Connect to chat room
	const connect = useCallback(async () => {
		if (connecting || connected) return;

		setConnecting(true);
		setError(null);

		try {
			// Call handoff command
			const result = await client.call<HandoffResult>('chat-connect', {
				roomId,
				nickname,
			});

			if (!result.success || !result.data) {
				setError(result.error?.message ?? 'Failed to connect');
				setConnecting(false);
				return;
			}

			const handoff = result.data;

			// Connect to WebSocket
			const wsUrl = `${handoff.endpoint}?token=${handoff.credentials?.token}`;
			const ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				setConnected(true);
				setConnecting(false);
			};

			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data);

					switch (msg.type) {
						case 'welcome':
							setParticipants(msg.participants);
							break;

						case 'message':
							setMessages((prev) => [
								...prev,
								{
									id: msg.id,
									sender: msg.sender,
									text: msg.text,
									timestamp: msg.timestamp,
								},
							]);
							break;

						case 'user_joined':
							setParticipants((prev) => [...prev, msg.nickname]);
							setMessages((prev) => [
								...prev,
								{
									id: `system-${Date.now()}`,
									sender: 'System',
									text: `${msg.nickname} joined the room`,
									timestamp: msg.timestamp,
								},
							]);
							break;

						case 'user_left':
							setParticipants((prev) => prev.filter((p) => p !== msg.nickname));
							setMessages((prev) => [
								...prev,
								{
									id: `system-${Date.now()}`,
									sender: 'System',
									text: `${msg.nickname} left the room`,
									timestamp: msg.timestamp,
								},
							]);
							break;

						case 'error':
							console.error('Server error:', msg.message);
							break;
					}
				} catch {
					console.error('Failed to parse message');
				}
			};

			ws.onerror = () => {
				setError('WebSocket connection error');
			};

			ws.onclose = () => {
				setConnected(false);
				setConnecting(false);
				wsRef.current = null;
			};

			wsRef.current = ws;
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Connection failed');
			setConnecting(false);
		}
	}, [roomId, nickname, client, connecting, connected]);

	// Disconnect
	const disconnect = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		setConnected(false);
	}, []);

	// Send message
	const sendMessage = useCallback((text: string) => {
		if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
			return;
		}
		wsRef.current.send(JSON.stringify({ type: 'message', text }));
	}, []);

	// Handle form submit
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (inputText.trim()) {
			sendMessage(inputText.trim());
			setInputText('');
		}
	};

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			wsRef.current?.close();
		};
	}, []);

	// Format timestamp
	const formatTime = (timestamp: number) => {
		return new Date(timestamp).toLocaleTimeString();
	};

	return (
		<div className="chat-room">
			<div className="chat-header">
				<h2>Room: {roomId}</h2>
				<div className="connection-status">
					{connected ? (
						<>
							<span className="status-indicator connected" /> Connected
							<button type="button" onClick={disconnect}>
								Disconnect
							</button>
						</>
					) : (
						<>
							<span className="status-indicator disconnected" /> Disconnected
							<button type="button" onClick={connect} disabled={connecting}>
								{connecting ? 'Connecting...' : 'Connect'}
							</button>
						</>
					)}
				</div>
			</div>

			{error && <div className="error-message">{error}</div>}

			<div className="chat-body">
				<div className="participants">
					<h3>Participants ({participants.length})</h3>
					<ul>
						{participants.map((p) => (
							<li key={p}>{p}</li>
						))}
					</ul>
				</div>

				<div className="messages">
					{messages.map((msg) => (
						<div key={msg.id} className={`message ${msg.sender === 'System' ? 'system' : ''}`}>
							<span className="sender">{msg.sender}</span>
							<span className="text">{msg.text}</span>
							<span className="time">{formatTime(msg.timestamp)}</span>
						</div>
					))}
					<div ref={messagesEndRef} />
				</div>
			</div>

			<form className="chat-input" onSubmit={handleSubmit}>
				<input
					type="text"
					value={inputText}
					onChange={(e) => setInputText(e.target.value)}
					placeholder="Type a message..."
					disabled={!connected}
				/>
				<button type="submit" disabled={!connected || !inputText.trim()}>
					Send
				</button>
			</form>

			<style>{`
				.chat-room {
					display: flex;
					flex-direction: column;
					height: 100%;
					font-family: system-ui, sans-serif;
				}
				.chat-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 1rem;
					border-bottom: 1px solid #ddd;
				}
				.chat-header h2 {
					margin: 0;
				}
				.connection-status {
					display: flex;
					align-items: center;
					gap: 0.5rem;
				}
				.status-indicator {
					width: 10px;
					height: 10px;
					border-radius: 50%;
				}
				.status-indicator.connected {
					background: #22c55e;
				}
				.status-indicator.disconnected {
					background: #ef4444;
				}
				.error-message {
					padding: 0.5rem 1rem;
					background: #fee2e2;
					color: #dc2626;
				}
				.chat-body {
					display: flex;
					flex: 1;
					overflow: hidden;
				}
				.participants {
					width: 200px;
					padding: 1rem;
					border-right: 1px solid #ddd;
					overflow-y: auto;
				}
				.participants h3 {
					margin: 0 0 0.5rem;
					font-size: 0.875rem;
				}
				.participants ul {
					list-style: none;
					padding: 0;
					margin: 0;
				}
				.participants li {
					padding: 0.25rem 0;
				}
				.messages {
					flex: 1;
					padding: 1rem;
					overflow-y: auto;
				}
				.message {
					margin-bottom: 0.5rem;
					padding: 0.5rem;
					background: #f3f4f6;
					border-radius: 0.5rem;
				}
				.message.system {
					background: #fef3c7;
					font-style: italic;
				}
				.message .sender {
					font-weight: bold;
					margin-right: 0.5rem;
				}
				.message .time {
					color: #6b7280;
					font-size: 0.75rem;
					margin-left: 0.5rem;
				}
				.chat-input {
					display: flex;
					gap: 0.5rem;
					padding: 1rem;
					border-top: 1px solid #ddd;
				}
				.chat-input input {
					flex: 1;
					padding: 0.5rem;
					border: 1px solid #ddd;
					border-radius: 0.25rem;
				}
				.chat-input button {
					padding: 0.5rem 1rem;
					background: #3b82f6;
					color: white;
					border: none;
					border-radius: 0.25rem;
					cursor: pointer;
				}
				.chat-input button:disabled {
					background: #9ca3af;
					cursor: not-allowed;
				}
			`}</style>
		</div>
	);
}

export default ChatRoom;
