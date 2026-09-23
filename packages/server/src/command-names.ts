/**
 * @fileoverview Server-creation checks for command names: duplicates and names
 * that the tool router or a built-in command would shadow.
 */

import { BOOTSTRAP_COMMAND_NAMES, CONTEXT_COMMAND_NAMES } from './bootstrap/registry.js';
import { META_TOOL_NAMES } from './meta-tools.js';

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
