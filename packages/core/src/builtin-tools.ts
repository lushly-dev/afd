/**
 * @fileoverview Names of the tools an AFD MCP server provides itself, as opposed
 * to the application's own commands. Shared by the server (which reserves them)
 * and by tooling that inspects a remote server (which skips them).
 */

/**
 * Tools the server's tool router handles itself: `afd-call`, `afd-batch`,
 * `afd-pipe`, `afd-discover`, `afd-detail`.
 */
export const AFD_META_TOOL_NAMES: readonly string[] = [
	'afd-call',
	'afd-batch',
	'afd-pipe',
	'afd-discover',
	'afd-detail',
];

/** Discovery commands registered by `bootstrap: true`: `afd-help`, `afd-docs`, `afd-schema`. */
export const AFD_BOOTSTRAP_COMMAND_NAMES: readonly string[] = [
	'afd-help',
	'afd-docs',
	'afd-schema',
];

/** Context commands registered when a server configures `contexts`. */
export const AFD_CONTEXT_COMMAND_NAMES: readonly string[] = [
	'afd-context-list',
	'afd-context-enter',
	'afd-context-exit',
];

/** Every tool or command name an AFD server provides itself. */
export const AFD_BUILTIN_TOOL_NAMES: readonly string[] = [
	...AFD_META_TOOL_NAMES,
	...AFD_BOOTSTRAP_COMMAND_NAMES,
	...AFD_CONTEXT_COMMAND_NAMES,
];

const builtinNames = new Set(AFD_BUILTIN_TOOL_NAMES);

/** Whether `name` is a tool or command that AFD servers provide themselves. */
export function isAfdBuiltinName(name: string): boolean {
	return builtinNames.has(name);
}
