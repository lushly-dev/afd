import React, { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownMessage from './MarkdownMessage';
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
	chatServerUrl = import.meta.env.VITE_CHAT_URL ?? 'http://localhost:3101',
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
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

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

	// Auto-resize textarea based on content
	const adjustTextareaHeight = useCallback(() => {
		const textarea = inputRef.current;
		if (!textarea) return;

		// Reset to auto to recalculate
		textarea.style.height = 'auto';

		// Calculate new height (max ~5 lines)
		const maxHeight = 120;
		const newHeight = Math.min(textarea.scrollHeight, maxHeight);

		textarea.style.height = `${newHeight}px`;
		textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
	}, []);

	// Auto-resize when input changes
	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue, adjustTextareaHeight]);

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

	// Send message with streaming (with fallback to legacy)
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

		// Create new AbortController for this request
		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		// Try streaming first
		const success = await tryStreamingChat(trimmedInput, abortController);

		// If streaming failed, fall back to legacy endpoint
		if (!success) {
			console.log('📡 Falling back to legacy /chat endpoint');
			await tryLegacyChat(trimmedInput, abortController);
		}

		setIsLoading(false);
		abortControllerRef.current = null;
	};

	// Try streaming chat with SSE
	const tryStreamingChat = async (message: string, abortController: AbortController): Promise<boolean> => {
		try {
			const response = await fetch(`${chatServerUrl}/chat/stream`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message }),
				signal: abortController.signal,
			});

			if (!response.ok) {
				return false; // Fall back to legacy
			}

			const reader = response.body?.getReader();
			if (!reader) {
				return false;
			}

			// Initialize assistant message for streaming
			const assistantMessageId = generateId();
			let currentContent = '';
			const toolExecutions: ToolExecution[] = [];
			let streamingMetadata: any = {};
			const toolsInProgress = new Map<string, number>(); // Track which tools are running

			// Add initial empty assistant message
			setMessages((prev) => [...prev, {
				id: assistantMessageId,
				role: 'assistant',
				content: '',
				toolExecutions: [],
				timestamp: new Date(),
			}]);

			const decoder = new TextDecoder();
			let currentEvent = '';

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value);
					const lines = chunk.split('\n');

					for (const line of lines) {
						if (line.startsWith('event: ')) {
							currentEvent = line.slice(7).trim();
							continue;
						}

						if (line.startsWith('data: ')) {
							const dataStr = line.slice(6);
							if (!dataStr.trim()) continue;

							try {
								const eventData = JSON.parse(dataStr);

								if (currentEvent === 'token') {
									// Append token to current content
									currentContent += eventData.text;
									setMessages((prev) => prev.map(msg =>
										msg.id === assistantMessageId
											? { ...msg, content: currentContent }
											: msg
									));
								} else if (currentEvent === 'tool_start') {
									// Mark tool as starting
									const startTime = Date.now();
									toolsInProgress.set(eventData.name, startTime);

									// Update UI to show tool is running
									setMessages((prev) => prev.map(msg =>
										msg.id === assistantMessageId
											? {
												...msg,
												content: currentContent + `\n\n🔧 Running ${eventData.name}...`
											}
											: msg
									));
								} else if (currentEvent === 'tool_end') {
									// Tool completed
									toolsInProgress.delete(eventData.name);

									// Add to tool executions
									const toolExecution: ToolExecution = {
										name: eventData.name,
										args: {}, // We don't get args back in the stream
										result: eventData.result,
										latencyMs: eventData.latencyMs,
									};
									toolExecutions.push(toolExecution);

									// Remove the "Running..." text and update tool executions
									const cleanContent = currentContent.replace(new RegExp(`\\n\\n🔧 Running ${eventData.name}...`, 'g'), '');
									currentContent = cleanContent;

									setMessages((prev) => prev.map(msg =>
										msg.id === assistantMessageId
											? {
												...msg,
												content: currentContent,
												toolExecutions: [...toolExecutions]
											}
											: msg
									));
								} else if (currentEvent === 'done') {
									// Stream completed successfully
									streamingMetadata = eventData;

									// Final update with all metadata
									setMessages((prev) => prev.map(msg =>
										msg.id === assistantMessageId
											? {
												...msg,
												content: currentContent,
												toolExecutions,
												totalToolLatencyMs: streamingMetadata.totalToolLatencyMs,
												modelLatencyMs: streamingMetadata.modelLatencyMs
											}
											: msg
									));

									// If tools were executed, notify parent to refresh todos
									if (toolExecutions.length > 0 && onTodosChanged) {
										onTodosChanged();
									}
								} else if (currentEvent === 'error') {
									// Stream error
									const errorMessage: ChatMessage = {
										id: generateId(),
										role: 'system',
										content: `Error: ${eventData.message}`,
										timestamp: new Date(),
									};
									setMessages((prev) => [...prev, errorMessage]);
									return false;
								}

								// Reset current event after processing
								currentEvent = '';
							} catch (parseErr) {
								console.warn('Failed to parse SSE data:', dataStr, parseErr);
							}
						}
					}
				}

				return true; // Success
			} finally {
				reader.releaseLock();
			}
		} catch (err) {
			// Handle abort error differently
			if (err instanceof Error && err.name === 'AbortError') {
				const cancelledMessage: ChatMessage = {
					id: generateId(),
					role: 'system',
					content: 'Request cancelled by user',
					timestamp: new Date(),
				};
				setMessages((prev) => [...prev, cancelledMessage]);
				return true; // Don't fallback if user cancelled
			}

			console.warn('Streaming failed:', err);
			return false; // Fall back to legacy
		}
	};

	// Legacy chat endpoint as fallback
	const tryLegacyChat = async (message: string, abortController: AbortController): Promise<void> => {
		try {
			const response = await fetch(`${chatServerUrl}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message }),
				signal: abortController.signal,
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
			// Handle abort error differently
			if (err instanceof Error && err.name === 'AbortError') {
				const cancelledMessage: ChatMessage = {
					id: generateId(),
					role: 'system',
					content: 'Request cancelled by user',
					timestamp: new Date(),
				};
				setMessages((prev) => [...prev, cancelledMessage]);
			} else {
				const errorMessage: ChatMessage = {
					id: generateId(),
					role: 'system',
					content: `Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`,
					timestamp: new Date(),
				};
				setMessages((prev) => [...prev, errorMessage]);
			}
		}
	};

	// Stop current request
	const stopRequest = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
	};

	// Handle input key press
	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if (!isLoading) {
				sendMessage();
			}
		}
	};

	// Handle textarea change with auto-resize
	const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInputValue(e.target.value);
		adjustTextareaHeight();
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
							<MarkdownMessage content={msg.content} className="chat-message-content" />

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
						<textarea
							ref={inputRef}
							className="chat-input"
							placeholder="Ask AI to help... (Shift+Enter for newlines)"
							value={inputValue}
							onChange={handleInputChange}
							onKeyDown={handleKeyPress}
							disabled={isLoading || connectionStatus === 'error'}
							rows={1}
							aria-label="Chat message input. Shift+Enter for new lines, Enter to send."
						/>
						{isLoading ? (
							<button
								className="chat-stop-btn"
								onClick={stopRequest}
								title="Stop current request"
							>
								Stop
							</button>
						) : (
							<button
								className="chat-send-btn"
								onClick={sendMessage}
								disabled={!inputValue.trim() || connectionStatus === 'error'}
							>
								Send
							</button>
						)}
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
