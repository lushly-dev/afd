/**
 * @fileoverview Structured error handling for unknown tool requests
 *
 * Provides actionable error information when an agent calls a non-existent
 * tool, including fuzzy-match suggestions to help the agent self-correct.
 * Fuzzy matching comes from `@lushly-dev/afd-core`.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { findSimilarTools, truncateName } from '@lushly-dev/afd-core';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Structured error returned when an agent calls a non-existent tool.
 * Provides actionable information for the agent to self-correct.
 */
export interface UnknownToolError {
	error: 'UNKNOWN_TOOL';
	message: string;
	requested_tool: string;
	available_tools: string[];
	suggestions: string[];
	hint: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a structured unknown tool error.
 */
export function createUnknownToolError(
	requestedTool: string,
	availableTools: string[]
): UnknownToolError {
	const suggestions = findSimilarTools(requestedTool, availableTools);
	const hint = suggestions.length > 0 ? `Did you mean '${suggestions[0]}'?` : null;

	return {
		error: 'UNKNOWN_TOOL',
		message: `Tool '${truncateName(requestedTool)}' not found in registry`,
		requested_tool: requestedTool,
		available_tools: availableTools,
		suggestions,
		hint,
	};
}

/**
 * The `UNKNOWN_TOOL` failure that DirectClient returns and DirectTransport sends to McpClient:
 * a CommandResult whose `data` is the {@link UnknownToolError} and whose `error` always carries a
 * `suggestion` (the closest match, or where to find valid names).
 */
export function unknownToolFailure(
	requestedTool: string,
	availableTools: string[]
): CommandResult<UnknownToolError> {
	const unknownToolError = createUnknownToolError(requestedTool, availableTools);
	return {
		success: false,
		data: unknownToolError,
		error: {
			code: 'UNKNOWN_TOOL',
			message: unknownToolError.message,
			suggestion:
				unknownToolError.hint ?? 'Call one of the commands returned by listCommandNames()',
			retryable: false,
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE GUARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Whether a `DirectClient.call()` result is the structured failure for an
 * unknown command.
 *
 * `call<T>()` returns `CommandResult<T> | CommandResult<UnknownToolError>`, so
 * checking `result.success` alone does not tell TypeScript which one it has.
 * Rule out the unknown-tool case first; the result is then `CommandResult<T>`.
 *
 * @example
 * ```typescript
 * import { isSuccess } from '@lushly-dev/afd-core';
 * import { isUnknownToolError } from '@lushly-dev/afd-client';
 *
 * const result = await client.call<Todo>('todo-create', { title: 'Test' });
 * if (isUnknownToolError(result)) {
 *   console.log(result.data?.suggestions); // UnknownToolError
 * } else if (isSuccess(result)) {
 *   console.log(result.data.id); // Todo
 * }
 * ```
 */
export function isUnknownToolError<T>(
	result: CommandResult<T> | CommandResult<UnknownToolError>
): result is CommandResult<UnknownToolError> {
	if (result.success || result.error?.code !== 'UNKNOWN_TOOL') return false;
	const data: unknown = result.data;
	return (
		typeof data === 'object' && data !== null && 'error' in data && data.error === 'UNKNOWN_TOOL'
	);
}
