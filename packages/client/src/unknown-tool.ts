/**
 * @fileoverview Structured error handling for unknown tool requests
 *
 * Provides actionable error information when an agent calls a non-existent
 * tool, including fuzzy-match suggestions to help the agent self-correct.
 * Fuzzy matching comes from `@lushly-dev/afd-core`.
 */

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
