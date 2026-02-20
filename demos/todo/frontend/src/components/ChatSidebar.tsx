import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '../hooks/useConfirm';
import type { LocalStore } from '../hooks/useLocalStore';
import type { Todo } from '../types';
import { ConfirmModal } from './ConfirmModal';
import MarkdownMessage from './MarkdownMessage';
import './ChatSidebar.css';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const CHAT_HISTORY_KEY = 'chat-history';
const MAX_HISTORY_MESSAGES = 50;

interface SlashCommand {
	name: string;
	description: string;
	prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
	{
		name: '/todo',
		description: 'Create a new todo item',
		prompt: 'Create a new todo: ',
	},
	{
		name: '/help',
		description: 'Get help with available commands',
		prompt: 'What commands are available and how do I use them?',
	},
	{
		name: '/clear',
		description: 'Clear the chat history',
		prompt: 'Clear all messages from this chat',
	},
	{
		name: '/stats',
		description: 'Show todo statistics and overview',
		prompt: 'Show me my todo statistics and overview',
	},
	{
		name: '/priority',
		description: 'Work with high priority todos',
		prompt: 'Show me my high priority todos and help me prioritize: ',
	},
	{
		name: '/complete',
		description: 'Mark todos as completed',
		prompt: 'Help me complete some todos: ',
	},
	{
		name: '/search',
		description: 'Search through todos',
		prompt: 'Search my todos for: ',
	},
];

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolExecution {
	name: string;
	args: Record<string, unknown>;
	result: unknown;
	latencyMs: number;
	status?: 'pending' | 'running' | 'success' | 'error';
	startTime?: number;
	error?: string;
}

interface LiveToolExecution {
	id: string;
	name: string;
	args: Record<string, unknown>;
	status: 'pending' | 'running' | 'success' | 'error';
	startTime: number;
	endTime?: number;
	result?: unknown;
	error?: string;
	latencyMs?: number;
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
	reasoning?: string;
	toolExecutions?: ToolExecution[];
	liveToolExecutions?: LiveToolExecution[];
	totalToolLatencyMs?: number;
	modelLatencyMs?: number;
	timestamp: Date;
}

// Stored message with timestamp as string (for JSON serialization)
type StoredChatMessage = Omit<ChatMessage, 'timestamp'> & { timestamp: string };

interface ChatSidebarProps {
	isOpen: boolean;
	onToggle: () => void;
	onTodosChanged?: () => void;
	chatServerUrl?: string;
	todos?: Todo[];
	localStore?: LocalStore;
	onConnectionStatusChange?: (status: 'connecting' | 'connected' | 'error') => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_TODOS: Todo[] = [];

const getWelcomeMessage = (): ChatMessage => ({
	id: 'welcome',
	role: 'system',
	content:
		'Ask me to help manage your todos! Try: "Create 3 high-priority tasks" or "Show my stats"',
	timestamp: new Date(),
});

const loadChatHistory = (): ChatMessage[] => {
	try {
		const stored = localStorage.getItem(CHAT_HISTORY_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			// Convert timestamp strings back to Date objects
			const messages = (parsed as StoredChatMessage[]).map((msg) => ({
				...msg,
				timestamp: new Date(msg.timestamp),
			}));
			return messages;
		}
	} catch (error) {
		console.warn('Failed to load chat history:', error);
	}
	return [getWelcomeMessage()];
};

const saveChatHistory = (messages: ChatMessage[]) => {
	try {
		// Keep only the last MAX_HISTORY_MESSAGES
		const messagesToSave = messages.slice(-MAX_HISTORY_MESSAGES);
		localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messagesToSave));
	} catch (error) {
		console.warn('Failed to save chat history:', error);
	}
};

const clearChatHistory = () => {
	try {
		localStorage.removeItem(CHAT_HISTORY_KEY);
	} catch (error) {
		console.warn('Failed to clear chat history:', error);
	}
};

/**
 * Execute a todo action locally via the LocalStore
 * This is called when a chat tool completes successfully
 */
const executeLocalAction = (
	localStore: LocalStore | undefined,
	toolName: string,
	args: Record<string, unknown>,
	result: unknown
): void => {
	if (!localStore) return;

	console.log(`[executeLocalAction] Tool completed: ${toolName}`, { args, result });

	// For writes, the backend returns mock success instantly.
	// We update LocalStore to reflect the change in the UI.
	// ConvexSync handles background persistence.

	// Helper to find todo ID by title (when chat uses Convex ID but LocalStore has local ID)
	const findTodoByTitle = (title: string): string | null => {
		const todo = localStore.todos.find((t) => t.title.toLowerCase() === title.toLowerCase());
		return todo?.id ?? null;
	};

	try {
		switch (toolName) {
			case 'todo-create':
				if (result && typeof result === 'object' && 'title' in result) {
					// Create locally - ConvexSync will persist
					localStore.createTodo((result as { title: string }).title || (args.title as string), {
						description: args.description as string | undefined,
						priority: (args.priority as 'low' | 'medium' | 'high') || 'medium',
					});
				}
				break;

			case 'todo-toggle':
			case 'todo-complete':
			case 'todo-uncomplete': {
				// Try to find by ID first, then by title from result
				let todoId = args.id as string | undefined;
				if (!todoId || !localStore.todos.find((t) => t.id === todoId)) {
					// Chat returned Convex ID but we need local ID - search by title
					const resultObj = result as { title?: string } | undefined;
					if (resultObj?.title) {
						todoId = findTodoByTitle(resultObj.title) ?? undefined;
					}
				}
				if (todoId) {
					localStore.toggleTodo(todoId);
				}
				break;
			}

			case 'todo-update': {
				let todoId = args.id as string | undefined;
				if (!todoId || !localStore.todos.find((t) => t.id === todoId)) {
					const resultObj = result as { title?: string } | undefined;
					if (resultObj?.title) {
						todoId = findTodoByTitle(resultObj.title) ?? undefined;
					}
				}
				if (todoId) {
					const { id, ...updates } = args;
					localStore.updateTodo(
						todoId,
						updates as Partial<Pick<Todo, 'title' | 'description' | 'priority'>>
					);
				}
				break;
			}

			case 'todo-delete': {
				// ID can be in args OR result (backend returns it in result)
				const resultObj = result as
					| { id?: string; title?: string; data?: { id?: string; title?: string } }
					| undefined;
				const todoId = (args.id as string | undefined) || resultObj?.id || resultObj?.data?.id;
				const title =
					resultObj?.title || resultObj?.data?.title || (args.title as string | undefined);

				// First try direct ID match
				if (todoId && localStore.todos.find((t) => t.id === todoId)) {
					localStore.deleteTodo(todoId);
				}
				// Then try title match as fallback
				else if (title) {
					const foundId = findTodoByTitle(title);
					if (foundId) {
						localStore.deleteTodo(foundId);
					} else {
						console.warn('[executeLocalAction] Could not find todo by title:', title);
					}
				} else {
					console.warn('[executeLocalAction] Could not find todo to delete:', { args, result });
				}
				break;
			}

			case 'todo-clear':
				localStore.clearCompleted();
				break;

			default:
				break;
		}
	} catch (error) {
		console.error('[executeLocalAction] Failed to execute local action:', toolName, error);
	}
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
	isOpen,
	onToggle,
	onTodosChanged,
	chatServerUrl = import.meta.env.VITE_CHAT_URL ?? 'http://localhost:3101',
	todos = EMPTY_TODOS,
	localStore,
	onConnectionStatusChange,
}) => {
	const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatHistory());
	const [isHistoryRestored, setIsHistoryRestored] = useState<boolean>(() => {
		try {
			const stored = localStorage.getItem(CHAT_HISTORY_KEY);
			return stored !== null && JSON.parse(stored).length > 1; // More than just welcome message
		} catch {
			return false;
		}
	});
	const [inputValue, setInputValue] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>(
		'connecting'
	);

	// Reasoning toggle state with localStorage persistence
	const [showReasoning, setShowReasoning] = useState<boolean>(() => {
		const stored = localStorage.getItem('chat-show-reasoning');
		return stored ? JSON.parse(stored) : false;
	});

	// Slash command autocomplete state
	const [showSlashCommands, setShowSlashCommands] = useState(false);
	const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
	const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

	// @mention autocomplete state
	const [showMentions, setShowMentions] = useState(false);
	const [filteredTodos, setFilteredTodos] = useState<Todo[]>([]);
	const [selectedTodoIndex, setSelectedTodoIndex] = useState(0);

	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	// Confirmation dialog for destructive agent actions
	const { state: confirmState, confirm, handleConfirm, handleCancel } = useConfirm();

	// Scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	// Focus input when sidebar opens
	useEffect(() => {
		if (isOpen) {
			inputRef.current?.focus();
		}
	}, [isOpen]);

	// Save messages to localStorage whenever they change
	useEffect(() => {
		saveChatHistory(messages);
	}, [messages]);

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
	}, [adjustTextareaHeight]);

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

	// Notify parent of connection status changes
	useEffect(() => {
		onConnectionStatusChange?.(connectionStatus);
	}, [connectionStatus, onConnectionStatusChange]);

	// Generate unique message ID
	const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

	// Parse @mentions from text and return referenced todos
	const parseReferencedTodos = useCallback(
		(text: string): Todo[] => {
			const mentionPattern = /@([^@\s]+)/g;
			const matches = Array.from(text.matchAll(mentionPattern));
			const referencedTodos: Todo[] = [];

			for (const match of matches) {
				const mentionedTitle = match[1];
				const todo = todos.find((t) => t.title === mentionedTitle);
				if (todo && !referencedTodos.find((rt) => rt.id === todo.id)) {
					referencedTodos.push(todo);
				}
			}

			return referencedTodos;
		},
		[todos]
	);

	// Generate todos summary for context
	const generateTodosSummary = useCallback(
		(message?: string) => {
			if (todos.length === 0) {
				return 'No todos found.';
			}

			const pending = todos.filter((t) => !t.completed);
			const completed = todos.filter((t) => t.completed);
			const highPriority = todos.filter((t) => t.priority === 'high');

			const summary = [
				`Total todos: ${todos.length}`,
				`Pending: ${pending.length}, Completed: ${completed.length}`,
			];

			if (highPriority.length > 0) {
				summary.push(`High priority: ${highPriority.length}`);
			}

			// If message contains @mentions, include details of referenced todos
			if (message) {
				const referencedTodos = parseReferencedTodos(message);
				if (referencedTodos.length > 0) {
					summary.push('\nReferenced todos:');
					referencedTodos.forEach((todo) => {
						const priorityText =
							todo.priority === 'high'
								? ' (HIGH)'
								: todo.priority === 'medium'
									? ' (MED)'
									: ' (LOW)';
						const statusText = todo.completed ? ' [COMPLETED]' : ' [PENDING]';
						summary.push(`- ${todo.title}${priorityText}${statusText}`);
						if (todo.description) {
							summary.push(`  Description: ${todo.description}`);
						}
					});
				}
			}

			if (
				pending.length > 0 &&
				pending.length <= 5 &&
				(!message || !parseReferencedTodos(message).length)
			) {
				summary.push('\nPending todos:');
				pending.forEach((todo) => {
					const priorityText =
						todo.priority === 'high' ? ' (HIGH)' : todo.priority === 'medium' ? ' (MED)' : ' (LOW)';
					summary.push(`- ${todo.title}${priorityText}`);
				});
			}

			return summary.join('\n');
		},
		[todos, parseReferencedTodos]
	);

	// Toggle reasoning display
	const toggleReasoning = () => {
		const newValue = !showReasoning;
		setShowReasoning(newValue);
		localStorage.setItem('chat-show-reasoning', JSON.stringify(newValue));
	};

	// Start a new chat session
	const startNewChat = () => {
		clearChatHistory();
		setMessages([getWelcomeMessage()]);
		setIsHistoryRestored(false);
	};

	// Slash command detection and filtering
	const detectSlashCommand = useCallback((input: string) => {
		const cursorPosition = inputRef.current?.selectionStart ?? input.length;
		const textBeforeCursor = input.slice(0, cursorPosition);
		const lines = textBeforeCursor.split('\n');
		const currentLine = lines[lines.length - 1];

		// Check if current line starts with / and is at the beginning or after whitespace
		const slashMatch = currentLine.match(/(?:^|\s)\/(\w*)$/);
		if (slashMatch) {
			const partialCommand = `/${slashMatch[1]}`;
			const filtered = SLASH_COMMANDS.filter((cmd) =>
				cmd.name.toLowerCase().startsWith(partialCommand.toLowerCase())
			);
			return {
				isSlashCommand: true,
				partialCommand,
				filtered,
				position: cursorPosition - slashMatch[0].length + slashMatch[0].indexOf('/'),
			};
		}

		return { isSlashCommand: false, partialCommand: '', filtered: [], position: -1 };
	}, []);

	// @mention detection and filtering
	const detectMention = useCallback(
		(input: string) => {
			const cursorPosition = inputRef.current?.selectionStart ?? input.length;
			const textBeforeCursor = input.slice(0, cursorPosition);
			const lines = textBeforeCursor.split('\n');
			const currentLine = lines[lines.length - 1];

			// Check if current line has @ followed by word characters or spaces (partial todo title)
			const mentionMatch = currentLine.match(/(?:^|\s)@([^@\s]*)$/);
			if (mentionMatch) {
				const partialTitle = mentionMatch[1];
				const filtered = todos.filter((todo) =>
					todo.title.toLowerCase().includes(partialTitle.toLowerCase())
				);
				return {
					isMention: true,
					partialTitle,
					filtered,
					position: cursorPosition - mentionMatch[0].length + mentionMatch[0].indexOf('@'),
				};
			}

			return { isMention: false, partialTitle: '', filtered: [], position: -1 };
		},
		[todos]
	);

	// Update autocomplete when input changes
	useEffect(() => {
		const { isSlashCommand, filtered: commandsFiltered } = detectSlashCommand(inputValue);
		const { isMention, filtered: todosFiltered } = detectMention(inputValue);

		// Show slash commands if detected and available
		setShowSlashCommands(isSlashCommand && commandsFiltered.length > 0);
		setFilteredCommands(commandsFiltered);
		setSelectedCommandIndex(0);

		// Show @mentions if detected and available
		setShowMentions(isMention && todosFiltered.length > 0);
		setFilteredTodos(todosFiltered);
		setSelectedTodoIndex(0);

		// Hide the other dropdown when one is active
		if (isSlashCommand) {
			setShowMentions(false);
		} else if (isMention) {
			setShowSlashCommands(false);
		}
	}, [inputValue, detectSlashCommand, detectMention]);

	// Handle slash command selection
	const selectSlashCommand = useCallback(
		(command: SlashCommand) => {
			const { position } = detectSlashCommand(inputValue);
			if (position === -1) return;

			const beforeSlash = inputValue.slice(0, position);
			const afterCursor = inputValue.slice(inputRef.current?.selectionStart ?? inputValue.length);
			const newValue = beforeSlash + command.prompt + afterCursor;

			setInputValue(newValue);
			setShowSlashCommands(false);

			// Focus input and position cursor after the inserted text
			setTimeout(() => {
				if (inputRef.current) {
					const newCursorPosition = beforeSlash.length + command.prompt.length;
					inputRef.current.focus();
					inputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
				}
			}, 0);
		},
		[inputValue, detectSlashCommand]
	);

	// Handle @mention selection
	const selectMention = useCallback(
		(todo: Todo) => {
			const { position } = detectMention(inputValue);
			if (position === -1) return;

			const beforeMention = inputValue.slice(0, position);
			const afterCursor = inputValue.slice(inputRef.current?.selectionStart ?? inputValue.length);
			const mentionText = `@${todo.title}`;
			const newValue = beforeMention + mentionText + afterCursor;

			setInputValue(newValue);
			setShowMentions(false);

			// Focus input and position cursor after the inserted text
			setTimeout(() => {
				if (inputRef.current) {
					const newCursorPosition = beforeMention.length + mentionText.length;
					inputRef.current.focus();
					inputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
				}
			}, 0);
		},
		[inputValue, detectMention]
	);

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
	const tryStreamingChat = async (
		message: string,
		abortController: AbortController
	): Promise<boolean> => {
		try {
			const response = await fetch(`${chatServerUrl}/chat/stream`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message,
					context: {
						todos: generateTodosSummary(message),
					},
				}),
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
			let streamingMetadata: Record<string, unknown> = {};
			const toolsInProgress = new Map<string, number>(); // Track which tools are running
			const toolArgs = new Map<string, Record<string, unknown>>(); // Track tool args for local execution
			let toolCounter = 0; // Unique counter for tool IDs

			// Add initial empty assistant message
			setMessages((prev) => [
				...prev,
				{
					id: assistantMessageId,
					role: 'assistant',
					content: '',
					toolExecutions: [],
					timestamp: new Date(),
				},
			]);

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
									setMessages((prev) =>
										prev.map((msg) =>
											msg.id === assistantMessageId ? { ...msg, content: currentContent } : msg
										)
									);
								} else if (currentEvent === 'tool_start') {
									// Mark tool as starting
									const startTime = Date.now();
									toolCounter++; // Increment counter for unique ID
									const toolId = `${eventData.name}-${startTime}-${toolCounter}`;
									toolsInProgress.set(eventData.name, startTime);
									toolArgs.set(eventData.name, eventData.args || {}); // Store args for local execution

									// Create live tool execution
									const liveTool: LiveToolExecution = {
										id: toolId,
										name: eventData.name,
										args: eventData.args || {},
										status: 'running',
										startTime,
									};

									// Update UI to show tool is running
									setMessages((prev) =>
										prev.map((msg) =>
											msg.id === assistantMessageId
												? {
														...msg,
														liveToolExecutions: [...(msg.liveToolExecutions || []), liveTool],
													}
												: msg
										)
									);
								} else if (currentEvent === 'tool_end') {
									// Tool completed
									const startTime = toolsInProgress.get(eventData.name);
									const args = toolArgs.get(eventData.name) || {};
									toolsInProgress.delete(eventData.name);
									toolArgs.delete(eventData.name);
									const endTime = Date.now();

									// Handle local action execution (with confirmation for destructive actions)
									if (!eventData.error) {
										const metadata = eventData.metadata as
											| {
													destructive?: boolean;
													confirmPrompt?: string;
													tags?: string[];
											  }
											| undefined;

										if (metadata?.destructive) {
											// Destructive action - prompt for confirmation
											const toolDisplayName = eventData.name.replace(/-/g, ' ');
											const confirmPrompt =
												metadata.confirmPrompt || `Are you sure you want to ${toolDisplayName}?`;

											// Use IIFE for async confirmation
											(async () => {
												const confirmed = await confirm(
													'Confirm Agent Action',
													confirmPrompt,
													'This action was performed by the AI assistant.'
												);

												if (confirmed) {
													executeLocalAction(localStore, eventData.name, args, eventData.result);
												} else {
													// User cancelled - the action already happened on the backend
													// Add a system message to inform the user
													console.log(
														'[ChatSidebar] User cancelled destructive action:',
														eventData.name
													);
													// Note: Backend already executed, Convex sync will reconcile state
												}
											})();
										} else {
											// Non-destructive: execute immediately
											executeLocalAction(localStore, eventData.name, args, eventData.result);
										}
									}

									// Add to tool executions
									const toolExecution: ToolExecution = {
										name: eventData.name,
										args: {}, // We don't get args back in the stream
										result: eventData.result,
										latencyMs: eventData.latencyMs,
										status: eventData.error ? 'error' : 'success',
										startTime,
										error: eventData.error,
									};
									toolExecutions.push(toolExecution);

									setMessages((prev) =>
										prev.map((msg) =>
											msg.id === assistantMessageId
												? {
														...msg,
														content: currentContent,
														toolExecutions: [...toolExecutions],
														liveToolExecutions: (msg.liveToolExecutions || []).map((liveTool) =>
															liveTool.name === eventData.name
																? {
																		...liveTool,
																		status: eventData.error ? 'error' : 'success',
																		endTime,
																		result: eventData.result,
																		error: eventData.error,
																		latencyMs: eventData.latencyMs,
																	}
																: liveTool
														),
													}
												: msg
										)
									);
								} else if (currentEvent === 'done') {
									// Stream completed successfully
									streamingMetadata = eventData;

									// Final update with all metadata
									setMessages((prev) =>
										prev.map((msg) =>
											msg.id === assistantMessageId
												? {
														...msg,
														content: currentContent,
														toolExecutions,
														reasoning: streamingMetadata.reasoning as string | undefined,
														totalToolLatencyMs: streamingMetadata.totalToolLatencyMs as
															| number
															| undefined,
														modelLatencyMs: streamingMetadata.modelLatencyMs as number | undefined,
													}
												: msg
										)
									);

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
	const tryLegacyChat = async (
		message: string,
		abortController: AbortController
	): Promise<void> => {
		try {
			const response = await fetch(`${chatServerUrl}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message,
					context: {
						todos: generateTodosSummary(message),
					},
				}),
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
		// Handle slash command navigation
		if (showSlashCommands && filteredCommands.length > 0) {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedCommandIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
					return;
				case 'ArrowUp':
					e.preventDefault();
					setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
					return;
				case 'Enter':
					e.preventDefault();
					selectSlashCommand(filteredCommands[selectedCommandIndex]);
					return;
				case 'Escape':
					e.preventDefault();
					setShowSlashCommands(false);
					return;
			}
		}

		// Handle @mention navigation
		if (showMentions && filteredTodos.length > 0) {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedTodoIndex((prev) => (prev < filteredTodos.length - 1 ? prev + 1 : 0));
					return;
				case 'ArrowUp':
					e.preventDefault();
					setSelectedTodoIndex((prev) => (prev > 0 ? prev - 1 : filteredTodos.length - 1));
					return;
				case 'Enter':
					e.preventDefault();
					selectMention(filteredTodos[selectedTodoIndex]);
					return;
				case 'Escape':
					e.preventDefault();
					setShowMentions(false);
					return;
			}
		}

		// Normal enter handling
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

	// Get elapsed time for running tools
	const getElapsedTime = (startTime: number): string => {
		const elapsed = Date.now() - startTime;
		if (elapsed < 1000) {
			return `${elapsed}ms`;
		}
		return `${(elapsed / 1000).toFixed(1)}s`;
	};

	// Component for rendering reasoning with collapsible functionality
	const ReasoningSection: React.FC<{ reasoning: string }> = ({ reasoning }) => {
		const [collapsed, setCollapsed] = useState(true);

		// Don't render if no reasoning content
		if (!reasoning || !reasoning.trim()) return null;

		return (
			<div className="reasoning-section">
				{/* biome-ignore lint/a11y/useSemanticElements: Custom styled collapsible header */}
				<div
					className="reasoning-header"
					role="button"
					tabIndex={0}
					onClick={() => setCollapsed(!collapsed)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setCollapsed(!collapsed);
						}
					}}
				>
					<span className="reasoning-icon">🧠</span>
					<span className="reasoning-label">Reasoning</span>
					<button
						type="button"
						className="reasoning-toggle"
						aria-label={collapsed ? 'Expand reasoning' : 'Collapse reasoning'}
					>
						{collapsed ? '▶' : '▼'}
					</button>
				</div>
				{!collapsed && (
					<div className="reasoning-content">
						<MarkdownMessage content={reasoning} className="reasoning-text" />
					</div>
				)}
			</div>
		);
	};

	// Component for rendering tools section with collapsible functionality
	const ToolsSection: React.FC<{
		liveTools?: LiveToolExecution[];
		toolExecutions?: ToolExecution[];
	}> = ({ liveTools, toolExecutions }) => {
		const [collapsed, setCollapsed] = useState(true);

		// Count total tools
		const liveCount = liveTools?.length || 0;
		const legacyCount = toolExecutions?.length || 0;
		const totalCount = liveCount + legacyCount;

		if (totalCount === 0) return null;

		return (
			<div className="tools-section">
				{/* biome-ignore lint/a11y/useSemanticElements: Custom styled collapsible header */}
				<div
					className="tools-header"
					role="button"
					tabIndex={0}
					onClick={() => setCollapsed(!collapsed)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setCollapsed(!collapsed);
						}
					}}
				>
					<span className="tools-icon">⚙️</span>
					<span className="tools-label">Tools ({totalCount})</span>
					<button
						type="button"
						className="tools-toggle"
						aria-label={collapsed ? 'Expand tools' : 'Collapse tools'}
					>
						{collapsed ? '▶' : '▼'}
					</button>
				</div>
				{!collapsed && (
					<div className="tools-content">
						{liveTools?.map((tool) => (
							<LiveToolExecutionComponent key={tool.id} tool={tool} />
						))}
						{toolExecutions &&
							!liveTools &&
							toolExecutions.map((exec, idx) => (
								<div key={`${exec.name}-${idx}`} className="chat-tool-exec">
									<span className="chat-tool-name">{exec.name}</span>
									<span className="chat-tool-latency">{exec.latencyMs.toFixed(3)}ms</span>
								</div>
							))}
					</div>
				)}
			</div>
		);
	};

	// Component for rendering live tool execution
	const LiveToolExecutionComponent: React.FC<{ tool: LiveToolExecution }> = ({ tool }) => {
		const [collapsed, setCollapsed] = useState(true);
		const [elapsedTime, setElapsedTime] = useState<string>('');

		// Update elapsed time for running tools
		useEffect(() => {
			if (tool.status === 'running') {
				const interval = setInterval(() => {
					setElapsedTime(getElapsedTime(tool.startTime));
				}, 100);
				return () => clearInterval(interval);
			} else {
				setElapsedTime('');
			}
		}, [tool.status, tool.startTime]);

		const getStatusIcon = () => {
			switch (tool.status) {
				case 'running':
					return <span className="tool-status-icon running">⚡</span>;
				case 'success':
					return <span className="tool-status-icon success">✓</span>;
				case 'error':
					return <span className="tool-status-icon error">✗</span>;
				default:
					return <span className="tool-status-icon pending">○</span>;
			}
		};

		const hasArgs = Object.keys(tool.args).length > 0;

		return (
			<div className={`live-tool-execution ${tool.status}`}>
				<div className="live-tool-header">
					{getStatusIcon()}
					<span className="live-tool-name">{tool.name}</span>
					<div className="live-tool-timing">
						{tool.status === 'running' && elapsedTime && (
							<span className="live-tool-elapsed">{elapsedTime}</span>
						)}
						{tool.latencyMs !== undefined && (
							<span className="live-tool-latency">{tool.latencyMs.toFixed(3)}ms</span>
						)}
					</div>
					{hasArgs && (
						<button
							type="button"
							className="live-tool-args-toggle"
							onClick={() => setCollapsed(!collapsed)}
							title={collapsed ? 'Show arguments' : 'Hide arguments'}
						>
							{collapsed ? '▶' : '▼'}
						</button>
					)}
				</div>
				{hasArgs && !collapsed && (
					<div className="live-tool-args">
						<pre>{JSON.stringify(tool.args, null, 2)}</pre>
					</div>
				)}
				{tool.error && <div className="live-tool-error">Error: {tool.error}</div>}
			</div>
		);
	};

	return (
		<>
			{/* Sidebar */}
			<aside className={`chat-sidebar ${isOpen ? 'open' : ''}`}>
				<header className="chat-sidebar-header">
					<h2>Myoso</h2>
					<span className="chat-context-indicator">{todos.length} todos</span>
					<div className="chat-header-actions">
						<button
							type="button"
							className="chat-header-btn"
							onClick={startNewChat}
							title="New chat"
						>
							+
						</button>
						{/* History panel - coming soon
						<button
							className="chat-header-btn history-btn"
							onClick={() => {}}
							title="Chat history"
						>
							📜
						</button>
						*/}
					</div>
				</header>

				{/* History Restored Indicator */}
				{isHistoryRestored && (
					<div className="history-restored-indicator">📋 Continued from previous session</div>
				)}

				{/* Messages */}
				<div className="chat-messages">
					{messages.map((msg) => (
						<div key={msg.id} className={`chat-message ${msg.role}`}>
							<MarkdownMessage content={msg.content} className="chat-message-content" />

							{/* Reasoning Section - controlled by toggle */}
							{msg.role === 'assistant' && showReasoning && msg.reasoning && (
								<ReasoningSection reasoning={msg.reasoning} />
							)}

							{/* Tools Section - collapsible */}
							{msg.role === 'assistant' &&
								(msg.liveToolExecutions?.length || msg.toolExecutions?.length) && (
									<ToolsSection
										liveTools={msg.liveToolExecutions}
										toolExecutions={msg.toolExecutions}
									/>
								)}

							{/* Latency Summary */}
							{(msg.modelLatencyMs !== undefined || msg.totalToolLatencyMs !== undefined) && (
								<div className="chat-latency-summary">
									{msg.modelLatencyMs !== undefined && (
										<span>🧠 Gemini: {msg.modelLatencyMs?.toFixed(0)}ms</span>
									)}
									{msg.totalToolLatencyMs !== undefined && (
										<span>
											⚡ DirectClient:{' '}
											<span className="highlight">{msg.totalToolLatencyMs?.toFixed(3)}ms</span>
										</span>
									)}
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
					{/* Slash Command Autocomplete Dropdown */}
					{showSlashCommands && filteredCommands.length > 0 && (
						<div className="slash-commands-dropdown">
							{filteredCommands.map((command, index) => (
								<div
									key={command.name}
									className={`slash-command-item ${
										index === selectedCommandIndex ? 'selected' : ''
									}`}
									role="option"
									tabIndex={-1}
									aria-selected={index === selectedCommandIndex}
									onClick={() => selectSlashCommand(command)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectSlashCommand(command);
										}
									}}
									onMouseEnter={() => setSelectedCommandIndex(index)}
								>
									<div className="slash-command-name">{command.name}</div>
									<div className="slash-command-description">{command.description}</div>
								</div>
							))}
						</div>
					)}

					{/* @mention Autocomplete Dropdown */}
					{showMentions && filteredTodos.length > 0 && (
						<div className="mentions-dropdown">
							{filteredTodos.map((todo, index) => (
								<div
									key={todo.id}
									className={`mention-item ${index === selectedTodoIndex ? 'selected' : ''}`}
									role="option"
									tabIndex={-1}
									aria-selected={index === selectedTodoIndex}
									onClick={() => selectMention(todo)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectMention(todo);
										}
									}}
									onMouseEnter={() => setSelectedTodoIndex(index)}
								>
									<div className="mention-todo-title">@{todo.title}</div>
									<div className="mention-todo-meta">
										{todo.completed ? 'Completed' : 'Pending'} •
										{todo.priority === 'high'
											? ' High'
											: todo.priority === 'medium'
												? ' Medium'
												: ' Low'}{' '}
										priority
										{todo.description &&
											` • ${todo.description.slice(0, 50)}${todo.description.length > 50 ? '...' : ''}`}
									</div>
								</div>
							))}
						</div>
					)}

					<div className="chat-input-row">
						<textarea
							ref={inputRef}
							className="chat-input"
							placeholder="Type / for commands, @ for todos..."
							value={inputValue}
							onChange={handleInputChange}
							onKeyDown={handleKeyPress}
							disabled={isLoading || connectionStatus === 'error'}
							rows={1}
							aria-label="Chat message input. Type / for slash commands, Shift+Enter for new lines, Enter to send."
						/>
					</div>
					<div className="chat-options-row">
						<button
							type="button"
							className={`chat-option-btn ${showReasoning ? 'active' : ''}`}
							onClick={toggleReasoning}
							title={showReasoning ? 'Hide reasoning' : 'Show reasoning'}
						>
							🧠 Reasoning
						</button>
						<span className="chat-model-selector">⚡ Gemini 3 Flash</span>
						<div className="chat-options-spacer" />
						{isLoading ? (
							<button
								type="button"
								className="chat-stop-btn"
								onClick={stopRequest}
								title="Stop current request"
							>
								Stop
							</button>
						) : (
							<button
								type="button"
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
				type="button"
				className={`chat-toggle-btn ${isOpen ? 'hidden' : ''}`}
				onClick={onToggle}
				title="Open Myoso"
			>
				💬
			</button>

			{/* Confirmation dialog for destructive agent actions */}
			<ConfirmModal
				isOpen={confirmState.isOpen}
				title={confirmState.title}
				message={confirmState.message}
				warning={confirmState.warning}
				onConfirm={handleConfirm}
				onCancel={handleCancel}
			/>
		</>
	);
};

export default ChatSidebar;
