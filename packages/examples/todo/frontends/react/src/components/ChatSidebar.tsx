import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ChatSidebar.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolExecution {
	name: string;
	args: Record<string, unknown>;
	result: unknown;
	latencyMs: number;
}

interface ChatResponse {
	message: string;
	toolExecutions: ToolExecution[];
	totalToolLatencyMs: number;
	modelLatencyMs: number;
	requestId?: string;
}

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	toolExecutions?: ToolExecution[];
	totalToolLatencyMs?: number;
	modelLatencyMs?: number;
	timestamp: Date;
}

interface ChatSidebarProps {
	isOpen: boolean;
	onToggle: () => void;
	onTodosChanged?: () => void;
	chatServerUrl?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
	isOpen,
	onToggle,
	onTodosChanged,
	chatServerUrl = 'http://localhost:3101',
}) => {
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: 'welcome',
			role: 'system',
			content:
				'Ask me to help manage your todos! Try: "Create 3 high-priority tasks" or "Show my stats"',
			timestamp: new Date(),
		},
	]);
	const [inputValue, setInputValue] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>(
		'connecting'
	);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	// Focus input when sidebar opens
	useEffect(() => {
		if (isOpen) {
			inputRef.current?.focus();
		}
	}, [isOpen]);

	// Check chat server health
	const checkHealth = useCallback(async () => {
		try {
			const response = await fetch(`${chatServerUrl}/health`);
			const data = await response.json();
			setConnectionStatus(data.geminiConfigured ? 'connected' : 'error');
		} catch {
			setConnectionStatus('error');
		}
	}, [chatServerUrl]);

	useEffect(() => {
		checkHealth();
		const interval = setInterval(checkHealth, 10000);
		return () => clearInterval(interval);
	}, [checkHealth]);

	// Generate unique message ID
	const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

	// Send message to chat server
	const sendMessage = async () => {
		const trimmedInput = inputValue.trim();
		if (!trimmedInput || isLoading) return;

		// Add user message
		const userMessage: ChatMessage = {
			id: generateId(),
			role: 'user',
			content: trimmedInput,
			timestamp: new Date(),
		};
		setMessages((prev) => [...prev, userMessage]);
		setInputValue('');
		setIsLoading(true);

		try {
			const response = await fetch(`${chatServerUrl}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: trimmedInput }),
			});

			const data: ChatResponse | { error: string } = await response.json();

			if ('error' in data) {
				// Error response
				const errorMessage: ChatMessage = {
					id: generateId(),
					role: 'system',
					content: `Error: ${data.error}`,
					timestamp: new Date(),
				};
				setMessages((prev) => [...prev, errorMessage]);
			} else {
				// Success response
				const assistantMessage: ChatMessage = {
					id: generateId(),
					role: 'assistant',
					content: data.message,
					toolExecutions: data.toolExecutions,
					totalToolLatencyMs: data.totalToolLatencyMs,
					modelLatencyMs: data.modelLatencyMs,
					timestamp: new Date(),
				};
				setMessages((prev) => [...prev, assistantMessage]);

				// If tools were executed, notify parent to refresh todos
				if (data.toolExecutions.length > 0 && onTodosChanged) {
					onTodosChanged();
				}
			}
		} catch (err) {
			const errorMessage: ChatMessage = {
				id: generateId(),
				role: 'system',
				content: `Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`,
				timestamp: new Date(),
			};
			setMessages((prev) => [...prev, errorMessage]);
		} finally {
			setIsLoading(false);
		}
	};

	// Handle input key press
	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	};

	// Get status display text
	const getStatusText = () => {
		switch (connectionStatus) {
			case 'connecting':
				return 'Connecting...';
			case 'connected':
				return 'Ready';
			case 'error':
				return 'Offline';
		}
	};

	return (
		<>
			{/* Sidebar */}
			<aside className={`chat-sidebar ${isOpen ? 'open' : ''}`}>
				<header className="chat-sidebar-header">
					<span className="chat-sidebar-header-icon">🤖</span>
					<h2>AI Copilot</h2>
					<span className={`chat-sidebar-status ${connectionStatus}`}>{getStatusText()}</span>
				</header>

				{/* Messages */}
				<div className="chat-messages">
					{messages.map((msg) => (
						<div key={msg.id} className={`chat-message ${msg.role}`}>
							<div className="chat-message-content">{msg.content}</div>

							{/* Tool Executions */}
							{msg.toolExecutions && msg.toolExecutions.length > 0 && (
								<div className="chat-tool-executions">
									<div className="chat-tool-executions-header">Tools executed:</div>
									{msg.toolExecutions.map((exec, idx) => (
										<div key={idx} className="chat-tool-exec">
											<span className="chat-tool-name">{exec.name}</span>
											<span className="chat-tool-latency">{exec.latencyMs.toFixed(3)}ms</span>
										</div>
									))}
									<div className="chat-latency-summary">
										<span>🧠 Gemini: {msg.modelLatencyMs?.toFixed(0)}ms</span>
										<span>
											⚡ DirectClient:{' '}
											<span className="highlight">{msg.totalToolLatencyMs?.toFixed(3)}ms</span>
										</span>
									</div>
								</div>
							)}
						</div>
					))}

					{/* Typing Indicator */}
					{isLoading && (
						<div className="chat-typing-indicator">
							<div className="chat-typing-dots">
								<span></span>
								<span></span>
								<span></span>
							</div>
							<span>Gemini thinking...</span>
						</div>
					)}

					<div ref={messagesEndRef} />
				</div>

				{/* Input */}
				<div className="chat-input-container">
					<div className="chat-input-row">
						<input
							ref={inputRef}
							type="text"
							className="chat-input"
							placeholder="Ask AI to help with todos..."
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyPress={handleKeyPress}
							disabled={isLoading || connectionStatus === 'error'}
						/>
						<button
							className="chat-send-btn"
							onClick={sendMessage}
							disabled={isLoading || !inputValue.trim() || connectionStatus === 'error'}
						>
							Send
						</button>
					</div>
				</div>
			</aside>

			{/* Toggle Button (Mobile) */}
			<button
				className={`chat-toggle-btn ${isOpen ? 'hidden' : ''}`}
				onClick={onToggle}
				title="Open AI Copilot"
			>
				🤖
			</button>
		</>
	);
};

export default ChatSidebar;
