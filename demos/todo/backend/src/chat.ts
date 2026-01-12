/**
 * @fileoverview AI Chat endpoint using Gemini 3 Flash Preview with DirectClient
 *
 * This demonstrates the full AFD loop:
 * 1. User sends message
 * 2. Gemini analyzes and returns function calls
 * 3. DirectClient executes commands at ~0.003ms each
 * 4. Results fed back to Gemini
 * 5. Final response returned
 *
 * Features:
 * - Exponential backoff retry for transient failures
 * - Error categorization with user-friendly messages
 * - Structured logging with request IDs
 * - Metrics collection for observability
 */

import {
	GoogleGenAI,
	Type,
	type Schema,
	type Content,
	type Part,
	type FunctionDeclaration,
} from '@google/genai';
// DirectClient kept for MCP compatibility, but todo actions now go through Convex
import { DirectClient } from '@lushly-dev/afd-client';
import { registry } from './registry.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES ?? '3', 10);
const BASE_RETRY_DELAY_MS = parseInt(process.env.GEMINI_RETRY_DELAY_MS ?? '1000', 10);

// Initialize Gemini client
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
	console.warn('⚠️  No GOOGLE_API_KEY or GEMINI_API_KEY found in environment');
}

const genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;

// DirectClient for non-todo commands (MCP compatibility)
const directClient = new DirectClient(registry);

// Convex URL for todo operations
const CONVEX_URL = process.env.CONVEX_URL || 'https://gentle-ermine-359.convex.site';

// ═══════════════════════════════════════════════════════════════════════════════
// CONVEX HTTP CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map of command names to Convex endpoints
 */
const CONVEX_ENDPOINTS: Record<string, string> = {
  'todo-create': '/api/todos/create',
  'todo-list': '/api/todos/list',
  'todo-toggle': '/api/todos/toggle',
  'todo-complete': '/api/todos/toggle',
  'todo-uncomplete': '/api/todos/toggle',
  'todo-update': '/api/todos/update',
  'todo-delete': '/api/todos/delete',
  'todo-stats': '/api/todos/stats',
  'todo-clear': '/api/todos/clear-completed',
};

/**
 * Handle todo operations locally (mock success)
 * With local-first architecture, the frontend handles actual storage via LocalStore.
 * The chat server just returns success and the frontend executes locally on tool_end.
 */
async function callConvexAction(
  commandName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message: string } }> {
  const endpoint = CONVEX_ENDPOINTS[commandName];
  
  if (!endpoint) {
    // Fall back to DirectClient for non-todo commands
    return directClient.call(commandName, args);
  }
  
  // For todo commands: return mock success
  // The frontend's executeLocalAction will handle actual storage via LocalStore
  console.log(`[callConvexAction] Returning mock success for ${commandName}, frontend will handle via LocalStore`);
  
  switch (commandName) {
    case 'todo-create':
      return { 
        success: true, 
        data: { 
          id: `pending-${Date.now()}`,
          title: args.title,
          priority: args.priority || 'medium',
          completed: false,
        } 
      };
    case 'todo-list':
      // Return empty list - frontend has the real data
      return { success: true, data: { items: [], total: 0 } };
    case 'todo-toggle':
    case 'todo-complete':
    case 'todo-uncomplete':
      return { success: true, data: { id: args.id, toggled: true } };
    case 'todo-update':
      return { success: true, data: { id: args.id, updated: true } };
    case 'todo-delete':
      return { success: true, data: { id: args.id, deleted: true } };
    case 'todo-stats':
      // Return placeholder - frontend has real stats
      return { success: true, data: { total: 0, completed: 0, pending: 0 } };
    case 'todo-clear':
      return { success: true, data: { cleared: true } };
    default:
      return { success: true, data: {} };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════════════════

interface Metrics {
	requestCount: number;
	successCount: number;
	errorCount: number;
	toolCallCount: number;
	totalLatencyMs: number;
	errorsByType: Record<string, number>;
	latencies: number[]; // Keep last 100 for percentiles
}

const metrics: Metrics = {
	requestCount: 0,
	successCount: 0,
	errorCount: 0,
	toolCallCount: 0,
	totalLatencyMs: 0,
	errorsByType: {},
	latencies: [],
};

export function getMetrics() {
	const sorted = [...metrics.latencies].sort((a, b) => a - b);
	const len = sorted.length;

	return {
		...metrics,
		latencies: undefined, // Don't expose raw array
		avgLatencyMs: len > 0 ? metrics.totalLatencyMs / len : 0,
		p50LatencyMs: len > 0 ? sorted[Math.floor(len * 0.5)] : 0,
		p95LatencyMs: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
		p99LatencyMs: len > 0 ? sorted[Math.floor(len * 0.99)] : 0,
	};
}

function recordLatency(ms: number) {
	metrics.latencies.push(ms);
	metrics.totalLatencyMs += ms;
	// Keep only last 100
	if (metrics.latencies.length > 100) {
		const removed = metrics.latencies.shift()!;
		metrics.totalLatencyMs -= removed;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

type ErrorCategory = 'rate_limit' | 'auth' | 'network' | 'timeout' | 'server' | 'unknown';

interface CategorizedError {
	category: ErrorCategory;
	message: string;
	userMessage: string;
	retryable: boolean;
	originalError: unknown;
}

function categorizeError(error: unknown): CategorizedError {
	const errorMessage = error instanceof Error ? error.message : String(error);
	const errorName = error instanceof Error ? error.name : '';

	// Rate limit errors
	if (
		errorMessage.includes('429') ||
		errorMessage.includes('rate limit') ||
		errorMessage.includes('quota')
	) {
		return {
			category: 'rate_limit',
			message: errorMessage,
			userMessage: "I'm getting rate limited. Please wait a moment and try again.",
			retryable: true,
			originalError: error,
		};
	}

	// Auth errors
	if (
		errorMessage.includes('401') ||
		errorMessage.includes('403') ||
		errorMessage.includes('invalid key') ||
		errorMessage.includes('API key')
	) {
		return {
			category: 'auth',
			message: errorMessage,
			userMessage: 'There was an authentication problem. Please check the API key configuration.',
			retryable: false,
			originalError: error,
		};
	}

	// Network errors
	if (
		errorMessage.includes('ECONNREFUSED') ||
		errorMessage.includes('ENOTFOUND') ||
		errorMessage.includes('network') ||
		errorName === 'FetchError'
	) {
		return {
			category: 'network',
			message: errorMessage,
			userMessage: 'Network connection issue. Please check your internet and try again.',
			retryable: true,
			originalError: error,
		};
	}

	// Timeout errors
	if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
		return {
			category: 'timeout',
			message: errorMessage,
			userMessage: 'The request took too long. Please try a simpler request.',
			retryable: true,
			originalError: error,
		};
	}

	// Server errors
	if (errorMessage.includes('500') || errorMessage.includes('503') || errorMessage.includes('502')) {
		return {
			category: 'server',
			message: errorMessage,
			userMessage: 'Gemini is temporarily unavailable. Please try again in a moment.',
			retryable: true,
			originalError: error,
		};
	}

	// Unknown errors
	return {
		category: 'unknown',
		message: errorMessage,
		userMessage: 'Something unexpected happened. Please try again.',
		retryable: false,
		originalError: error,
	};
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries: number;
		baseDelayMs: number;
		requestId: string;
	}
): Promise<T> {
	let lastError: CategorizedError | null = null;

	for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = categorizeError(error);

			// Don't retry non-retryable errors
			if (!lastError.retryable) {
				throw lastError;
			}

			// Don't retry if we've exhausted attempts
			if (attempt >= options.maxRetries) {
				throw lastError;
			}

			// Exponential backoff: 1s, 2s, 4s...
			const delayMs = options.baseDelayMs * Math.pow(2, attempt);
			console.log(
				`⚠️  [${options.requestId}] Retry ${attempt + 1}/${options.maxRetries} after ${delayMs}ms (${lastError.category})`
			);

			await sleep(delayMs);
		}
	}

	throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tool execution log entry
 */
export interface ToolExecution {
	name: string;
	args: Record<string, unknown>;
	result: unknown;
	latencyMs: number;
}

/**
 * Chat response with tool execution details
 */
export interface ChatResponse {
	message: string;
	toolExecutions: ToolExecution[];
	totalToolLatencyMs: number;
	modelLatencyMs: number;
	requestId?: string;
}

/**
 * Convert registry commands to Gemini function declarations
 */
function getToolDeclarations(): FunctionDeclaration[] {
	const commands = registry.listCommands();

	return commands.map((cmd) => ({
		name: cmd.name.replace(/-/g, '_'), // Gemini prefers underscores
		description: cmd.description,
		parameters: {
			type: Type.OBJECT,
			properties: getCommandProperties(cmd.name),
			required: [] as string[],
		},
	}));
}

/**
 * Get simplified properties for a command (based on known commands)
 */
function getCommandProperties(name: string): Record<string, Schema> {
	switch (name) {
		case 'todo-create':
			return {
				title: { type: Type.STRING, description: 'The todo title' },
				priority: {
					type: Type.STRING,
					description: 'Priority level',
					enum: ['low', 'medium', 'high'],
				},
				description: { type: Type.STRING, description: 'Optional description' },
			};
		case 'todo-list':
			return {
				completed: { type: Type.BOOLEAN, description: 'Filter by completion status' },
				priority: { type: Type.STRING, description: 'Filter by priority' },
				limit: { type: Type.NUMBER, description: 'Maximum number of todos to return' },
			};
		case 'todo-get':
		case 'todo-toggle':
		case 'todo-delete':
		case 'todo-complete':
		case 'todo-uncomplete':
			return {
				id: { type: Type.STRING, description: 'The todo ID' },
			};
		case 'todo-update':
			return {
				id: { type: Type.STRING, description: 'The todo ID' },
				title: { type: Type.STRING, description: 'New title' },
				priority: { type: Type.STRING, description: 'New priority' },
				description: { type: Type.STRING, description: 'New description' },
			};
		case 'todo-clear':
		case 'todo-stats':
			return {};
		case 'todo-search':
			return {
				query: { type: Type.STRING, description: 'Search query' },
			};
		case 'todo-createBatch':
			return {
				items: {
					type: Type.ARRAY,
					description: 'Array of todos to create',
					items: {
						type: Type.OBJECT,
						properties: {
							title: { type: Type.STRING },
							priority: { type: Type.STRING },
						},
					},
				},
			};
		case 'todo-toggleBatch':
		case 'todo-deleteBatch':
			return {
				ids: {
					type: Type.ARRAY,
					description: 'Array of todo IDs',
					items: { type: Type.STRING },
				},
			};
		default:
			return {};
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// REASONING GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate reasoning about what happened during the chat processing
 */
function generateReasoning(userMessage: string, toolExecutions: ToolExecution[], totalLatency: number): string {
	const reasoning: string[] = [];

	reasoning.push(`**User Request Analysis:**`);
	reasoning.push(`The user asked: "${userMessage}"`);
	reasoning.push('');

	if (toolExecutions.length === 0) {
		reasoning.push('**Processing:**');
		reasoning.push('This request didn\'t require any tool executions. I processed it directly using my language model capabilities.');
	} else {
		reasoning.push('**Tool Execution Strategy:**');
		reasoning.push(`I identified that this request required ${toolExecutions.length} tool execution${toolExecutions.length === 1 ? '' : 's'}:`);
		reasoning.push('');

		for (const exec of toolExecutions) {
			reasoning.push(`• **${exec.name}** (${exec.latencyMs.toFixed(3)}ms)`);
			reasoning.push(`  - Purpose: Execute todo operation`);
			reasoning.push(`  - Result: ${exec.result && typeof exec.result === 'object' && 'success' in exec.result ?
				(exec.result as any).success ? 'Success' : 'Error' : 'Completed'}`);
		}
		reasoning.push('');

		reasoning.push('**Performance:**');
		reasoning.push(`- Total tool execution time: ${toolExecutions.reduce((acc, exec) => acc + exec.latencyMs, 0).toFixed(3)}ms`);
		reasoning.push(`- DirectClient efficiency: Each tool call averaged ${(toolExecutions.reduce((acc, exec) => acc + exec.latencyMs, 0) / toolExecutions.length).toFixed(3)}ms`);
	}

	reasoning.push('');
	reasoning.push('**Response Generation:**');
	reasoning.push(`I synthesized the results into a helpful response for the user, completing the entire request in ${totalLatency.toFixed(0)}ms.`);

	return reasoning.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CHAT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

let requestCounter = 0;

/**
 * Process a chat message with Gemini + DirectClient
 */
export async function processChat(userMessage: string, todosContext?: string | null): Promise<ChatResponse> {
	const requestId = `req-${Date.now()}-${++requestCounter}`;
	const startTime = performance.now();

	metrics.requestCount++;

	if (!genAI) {
		metrics.errorCount++;
		metrics.errorsByType['config'] = (metrics.errorsByType['config'] || 0) + 1;
		throw new Error('Gemini API key not configured. Set GOOGLE_API_KEY in .env');
	}

	const toolExecutions: ToolExecution[] = [];
	let totalToolLatencyMs = 0;

	try {
		const modelStart = performance.now();

		// Create system instruction with context
		const systemInstruction = todosContext
			? `You are a helpful todo assistant. You can manage todos using the available tools.
When the user asks you to do something with todos, use the appropriate tool.
Available actions: create todos, list todos, toggle completion, update todos, get stats, search todos, clear completed.
Be concise in your responses. After performing actions, briefly summarize what was done.

CURRENT TODO CONTEXT:
${todosContext}

Use this context to provide more relevant suggestions and responses.`
			: `You are a helpful todo assistant. You can manage todos using the available tools.
When the user asks you to do something with todos, use the appropriate tool.
Available actions: create todos, list todos, toggle completion, update todos, get stats, search todos, clear completed.
Be concise in your responses. After performing actions, briefly summarize what was done.`;

		// Create model call with retry wrapper
		let response = await withRetry(
			() =>
				genAI.models.generateContent({
					model: 'gemini-3-flash-preview',
					contents: [{ role: 'user', parts: [{ text: userMessage }] }],
					config: {
						tools: [{ functionDeclarations: getToolDeclarations() }],
						systemInstruction,
					},
				}),
			{ maxRetries: MAX_RETRIES, baseDelayMs: BASE_RETRY_DELAY_MS, requestId }
		);

		let modelLatencyMs = performance.now() - modelStart;

		// Process function calls in a loop
		const messages: Content[] = [{ role: 'user', parts: [{ text: userMessage }] }];

		while (response.candidates?.[0]?.content?.parts) {
			const parts = response.candidates[0].content.parts;
			const functionCalls = parts.filter(
				(p: unknown) => (p as Record<string, unknown>).functionCall
			);

			if (functionCalls.length === 0) {
				// No more function calls, we have the final response
				break;
			}

			// Execute each function call via DirectClient
			const functionResponses: Part[] = [];

			for (const part of functionCalls) {
				const fc = (part as { functionCall: { name: string; args: Record<string, unknown> } })
					.functionCall;

				// Convert underscore back to hyphen for command name
				const commandName = fc.name.replace(/_/g, '-');

				// Execute via DirectClient (the fast path!)
				const start = performance.now();
				const result = await callConvexAction(commandName, fc.args || {});
				const latencyMs = performance.now() - start;

				totalToolLatencyMs += latencyMs;
				metrics.toolCallCount++;

				toolExecutions.push({
					name: commandName,
					args: fc.args || {},
					result: result.success ? result.data : result.error,
					latencyMs,
				});

				functionResponses.push({
					functionResponse: {
						name: fc.name,
						response: (result.success ? result.data : { error: result.error }) as Record<
							string,
							unknown
						>,
					},
				});
			}

			// Add assistant's function calls and our responses to message history
			messages.push({ role: 'model', parts: parts as Part[] });
			messages.push({ role: 'user', parts: functionResponses });

			// Get next response from model with retry
			const nextStart = performance.now();
			response = await withRetry(
				() =>
					genAI.models.generateContent({
						model: 'gemini-3-flash-preview',
						contents: messages,
						config: {
							tools: [{ functionDeclarations: getToolDeclarations() }],
						},
					}),
				{ maxRetries: MAX_RETRIES, baseDelayMs: BASE_RETRY_DELAY_MS, requestId }
			);
			modelLatencyMs += performance.now() - nextStart;
		}

		// Extract final text response
		const textParts = response.candidates?.[0]?.content?.parts?.filter(
			(p: unknown) => (p as Record<string, unknown>).text
		);
		const message =
			textParts?.map((p: unknown) => (p as { text: string }).text).join('') ||
			'Task completed successfully.';

		// Record success metrics
		const totalLatency = performance.now() - startTime;
		metrics.successCount++;
		recordLatency(totalLatency);

		return {
			message,
			toolExecutions,
			totalToolLatencyMs,
			modelLatencyMs,
			requestId,
		};
	} catch (error) {
		// Handle categorized errors
		if ((error as CategorizedError).category) {
			const catError = error as CategorizedError;
			metrics.errorCount++;
			metrics.errorsByType[catError.category] = (metrics.errorsByType[catError.category] || 0) + 1;

			console.error(`❌ [${requestId}] ${catError.category}: ${catError.message}`);
			throw new Error(catError.userMessage);
		}

		// Handle uncategorized errors
		metrics.errorCount++;
		metrics.errorsByType['unknown'] = (metrics.errorsByType['unknown'] || 0) + 1;
		throw error;
	}
}

/**
 * Streaming callbacks interface
 */
export interface StreamingCallbacks {
	onToken: (text: string) => void;
	onToolStart: (name: string) => void;
	onToolEnd: (name: string, result: unknown, latencyMs: number) => void;
	onError: (message: string) => void;
	onDone: (metadata: {
		toolExecutions: ToolExecution[];
		totalToolLatencyMs: number;
		modelLatencyMs: number;
		requestId: string;
		reasoning?: string;
	}) => void;
}

/**
 * Process a chat message with streaming updates
 */
export async function processChatStreaming(
	userMessage: string,
	todosContext: string | null,
	callbacks: StreamingCallbacks
): Promise<void> {
	const requestId = `req-${Date.now()}-${++requestCounter}`;
	const startTime = performance.now();

	metrics.requestCount++;

	if (!genAI) {
		metrics.errorCount++;
		metrics.errorsByType['config'] = (metrics.errorsByType['config'] || 0) + 1;
		callbacks.onError('Gemini API key not configured. Set GOOGLE_API_KEY in .env');
		return;
	}

	const toolExecutions: ToolExecution[] = [];
	let totalToolLatencyMs = 0;

	try {
		const modelStart = performance.now();

		// Create system instruction with context
		const systemInstruction = todosContext
			? `You are a helpful todo assistant. You can manage todos using the available tools.
When the user asks you to do something with todos, use the appropriate tool.
Available actions: create todos, list todos, toggle completion, update todos, get stats, search todos, clear completed.
Be concise in your responses. After performing actions, briefly summarize what was done.

CURRENT TODO CONTEXT:
${todosContext}

Use this context to provide more relevant suggestions and responses.`
			: `You are a helpful todo assistant. You can manage todos using the available tools.
When the user asks you to do something with todos, use the appropriate tool.
Available actions: create todos, list todos, toggle completion, update todos, get stats, search todos, clear completed.
Be concise in your responses. After performing actions, briefly summarize what was done.`;

		// Create model call with retry wrapper
		let response = await withRetry(
			() =>
				genAI.models.generateContent({
					model: 'gemini-3-flash-preview',
					contents: [{ role: 'user', parts: [{ text: userMessage }] }],
					config: {
						tools: [{ functionDeclarations: getToolDeclarations() }],
						systemInstruction,
					},
				}),
			{ maxRetries: MAX_RETRIES, baseDelayMs: BASE_RETRY_DELAY_MS, requestId }
		);

		let modelLatencyMs = performance.now() - modelStart;

		// Process function calls in a loop
		const messages: Content[] = [{ role: 'user', parts: [{ text: userMessage }] }];

		while (response.candidates?.[0]?.content?.parts) {
			const parts = response.candidates[0].content.parts;
			const functionCalls = parts.filter(
				(p: unknown) => (p as Record<string, unknown>).functionCall
			);

			if (functionCalls.length === 0) {
				// No more function calls, stream the final response token by token
				const textParts = parts.filter(
					(p: unknown) => (p as Record<string, unknown>).text
				);

				if (textParts.length > 0) {
					const fullText =
						textParts.map((p: unknown) => (p as { text: string }).text).join('') ||
						'Task completed successfully.';

					// Stream tokens - simulate word-by-word streaming
					const words = fullText.split(' ');
					for (let i = 0; i < words.length; i++) {
						const token = i === 0 ? words[i] : ' ' + words[i];
						callbacks.onToken(token);
						// Small delay to simulate streaming (remove in production if too slow)
						await new Promise(resolve => setTimeout(resolve, 10));
					}
				}
				break;
			}

			// Execute each function call via DirectClient
			const functionResponses: Part[] = [];

			for (const part of functionCalls) {
				const fc = (part as { functionCall: { name: string; args: Record<string, unknown> } })
					.functionCall;

				// Convert underscore back to hyphen for command name
				const commandName = fc.name.replace(/_/g, '-');

				// Notify tool start
				callbacks.onToolStart(commandName);

				// Execute via DirectClient (the fast path!)
				const start = performance.now();
				const result = await callConvexAction(commandName, fc.args || {});
				const latencyMs = performance.now() - start;

				totalToolLatencyMs += latencyMs;
				metrics.toolCallCount++;

				const toolExecution = {
					name: commandName,
					args: fc.args || {},
					result: result.success ? result.data : result.error,
					latencyMs,
				};

				toolExecutions.push(toolExecution);

				// Notify tool completion
				callbacks.onToolEnd(commandName, toolExecution.result, latencyMs);

				functionResponses.push({
					functionResponse: {
						name: fc.name,
						response: (result.success ? result.data : { error: result.error }) as Record<
							string,
							unknown
						>,
					},
				});
			}

			// Add assistant's function calls and our responses to message history
			messages.push({ role: 'model', parts: parts as Part[] });
			messages.push({ role: 'user', parts: functionResponses });

			// Get next response from model with retry
			const nextStart = performance.now();
			response = await withRetry(
				() =>
					genAI.models.generateContent({
						model: 'gemini-3-flash-preview',
						contents: messages,
						config: {
							tools: [{ functionDeclarations: getToolDeclarations() }],
						},
					}),
				{ maxRetries: MAX_RETRIES, baseDelayMs: BASE_RETRY_DELAY_MS, requestId }
			);
			modelLatencyMs += performance.now() - nextStart;
		}

		// Record success metrics
		const totalLatency = performance.now() - startTime;
		metrics.successCount++;
		recordLatency(totalLatency);

		// Generate reasoning about what happened
		const reasoning = generateReasoning(userMessage, toolExecutions, totalLatency);

		// Send final metadata
		callbacks.onDone({
			toolExecutions,
			totalToolLatencyMs,
			modelLatencyMs,
			requestId,
			reasoning,
		});
	} catch (error) {
		// Handle categorized errors
		if ((error as CategorizedError).category) {
			const catError = error as CategorizedError;
			metrics.errorCount++;
			metrics.errorsByType[catError.category] = (metrics.errorsByType[catError.category] || 0) + 1;

			console.error(`❌ [${requestId}] ${catError.category}: ${catError.message}`);
			callbacks.onError(catError.userMessage);
			return;
		}

		// Handle uncategorized errors
		metrics.errorCount++;
		metrics.errorsByType['unknown'] = (metrics.errorsByType['unknown'] || 0) + 1;
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		callbacks.onError(errorMessage);
	}
}

/**
 * Check if Gemini is configured
 */
export function isConfigured(): boolean {
	return genAI !== null;
}
