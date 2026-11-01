/**
 * @fileoverview Server-creation checks for command names: duplicates and names
 * that the tool router or a built-in command would shadow.
 */

import { type ExposeOptions, isExposedTo } from '@lushly-dev/afd-core';
import { BOOTSTRAP_COMMAND_NAMES, CONTEXT_COMMAND_NAMES } from './bootstrap/registry.js';
import { META_TOOL_NAMES } from './meta-tools.js';
import type { ZodCommandDefinition } from './schema.js';
import { MAX_FIRST_CLASS_TOOLS, type ToolStrategy } from './server-types.js';

/**
 * Throw if two commands share a name, or if a command uses a name the server
 * handles itself:
 * - the router's meta-tools (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`,
 *   `afd-detail`), which are always intercepted before command lookup;
 * - `afd-help`, `afd-docs`, `afd-schema` when `bootstrap` is enabled;
 * - `afd-context-list`, `afd-context-enter`, `afd-context-exit` when contexts are configured.
 */
export function assertValidCommandNames(
	commands: ReadonlyArray<{ name: string }>,
	builtins: { bootstrap: boolean; contexts: boolean }
): void {
	const seen = new Set<string>();
	for (const { name } of commands) {
		if (META_TOOL_NAMES.includes(name)) {
			throw new Error(
				`[AFD] Command name '${name}' is reserved: the tool router handles '${name}' itself, so the command would be unreachable. Rename the command.`
			);
		}
		if (builtins.bootstrap && BOOTSTRAP_COMMAND_NAMES.includes(name)) {
			throw new Error(
				`[AFD] Command name '${name}' is reserved: bootstrap: true registers a built-in '${name}'. Rename the command, or drop it (for example getBootstrapCommands() output) from commands.`
			);
		}
		if (builtins.contexts && CONTEXT_COMMAND_NAMES.includes(name)) {
			throw new Error(
				`[AFD] Command name '${name}' is reserved: contexts registers a built-in '${name}'. Rename the command.`
			);
		}
		if (seen.has(name)) {
			throw new Error(
				`[AFD] Duplicate command name '${name}': command names must be unique, otherwise one command shadows the other. Rename or remove one of them.`
			);
		}
		seen.add(name);
	}
}

/**
 * Throw unless the first-class set matches the tool strategy and, for `hybrid`, is a valid set
 * (`spec/tool-strategies.md`, H1, H2 and H5). Every message names the offending entry or option.
 *
 * @param commands - Every registered command, built-ins included
 * @param interface - The interface whose exposure a first-class command needs: `'mcp'` (the
 *   default) for the MCP server, the registry's own for `createDirectToolSurface`
 */
export function assertValidFirstClassTools(options: {
	toolStrategy: ToolStrategy;
	firstClassTools: readonly string[] | undefined;
	commands: ReadonlyArray<Pick<ZodCommandDefinition, 'name' | 'expose'>>;
	interface?: keyof ExposeOptions;
}): void {
	const { toolStrategy, firstClassTools, commands } = options;
	const iface = options.interface ?? 'mcp';
	if (toolStrategy !== 'hybrid') {
		if (firstClassTools !== undefined) {
			throw new Error(
				`[AFD] firstClassTools is only valid with toolStrategy: 'hybrid' (got '${toolStrategy}'). Set toolStrategy: 'hybrid', or remove firstClassTools.`
			);
		}
		return;
	}
	if (firstClassTools === undefined) {
		throw new Error(
			"[AFD] toolStrategy: 'hybrid' needs firstClassTools: the names of the commands to list as their own tools."
		);
	}
	if (!Array.isArray(firstClassTools) || firstClassTools.length === 0) {
		throw new Error(
			"[AFD] firstClassTools is empty. A hybrid server with no first-class tools is the lazy strategy: set toolStrategy: 'lazy', or name the commands to list."
		);
	}
	const byName = new Map(commands.map((command) => [command.name, command]));
	const seen = new Set<string>();
	firstClassTools.forEach((entry, index) => {
		const shown = typeof entry === 'string' ? `'${entry}'` : String(entry);
		if (index >= MAX_FIRST_CLASS_TOOLS) {
			throw new Error(
				`[AFD] firstClassTools entry ${shown} is beyond the cap of ${MAX_FIRST_CLASS_TOOLS} first-class tools. Remove it, or use the individual or grouped strategy to list more tools.`
			);
		}
		if (typeof entry !== 'string' || !entry) {
			throw new Error(`[AFD] firstClassTools entry ${shown} is not a command name.`);
		}
		if (META_TOOL_NAMES.includes(entry) || CONTEXT_COMMAND_NAMES.includes(entry)) {
			throw new Error(
				`[AFD] firstClassTools entry ${shown} is already listed by the hybrid strategy (meta-tools and context tools always are). Remove it.`
			);
		}
		if (seen.has(entry)) {
			throw new Error(
				`[AFD] firstClassTools entry ${shown} appears more than once. Each tool is listed once.`
			);
		}
		seen.add(entry);
		const command = byName.get(entry);
		if (!command) {
			const hint = BOOTSTRAP_COMMAND_NAMES.includes(entry)
				? ' Set bootstrap: true to register it.'
				: '';
			throw new Error(
				`[AFD] firstClassTools entry ${shown} is not a registered command.${hint} Register it in commands, or remove it.`
			);
		}
		if (!isExposedTo(command, iface)) {
			const where = iface === 'mcp' ? 'over MCP' : `to ${iface}`;
			throw new Error(
				`[AFD] firstClassTools entry ${shown} is not exposed ${where} (expose.${iface} is not true), so it cannot be listed. Expose it, or remove it.`
			);
		}
	});
}
