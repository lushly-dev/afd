/**
 * @fileoverview The library over MCP and HTTP.
 *
 * Over MCP the caller is an agent unless `createContext` names someone else, and an agent is
 * refused the steward's commands. Confirmations are enforced, so `variety-retire` and
 * `request-clear` run only once the caller confirms; under `enforce` an agent can confirm by
 * itself, which is why the screens ask the person before they call.
 */

import type { Actor } from '@lushly-dev/afd-core';
import { createMcpHandler, type McpHandlerOptions } from '@lushly-dev/afd-server';
import type { SeedLibrary } from './app.js';

export interface SeedLibraryServerOptions
	extends Partial<Omit<McpHandlerOptions, 'commands' | 'middleware'>> {
	/**
	 * The actor of every call, as the host verified it. Set it only from what the host
	 * verified, never from what a caller sends. Default: the server's, an agent.
	 */
	actor?: Actor;
}

/** The options of an MCP server or handler over the library's commands. */
export function seedLibraryServerOptions(
	library: SeedLibrary,
	options: SeedLibraryServerOptions = {}
): McpHandlerOptions {
	const { actor, ...rest } = options;
	return {
		name: 'seed-library',
		version: '0.1.0',
		toolStrategy: 'individual',
		confirmations: 'enforce',
		clock: library.clock,
		...(actor && { createContext: () => ({ actor: { ...actor } }) }),
		...rest,
		commands: library.commands,
		middleware: library.middleware,
	};
}

/** A Node request handler serving the library over MCP and HTTP. */
export function createSeedLibraryHandler(
	library: SeedLibrary,
	options: SeedLibraryServerOptions = {}
) {
	return createMcpHandler(seedLibraryServerOptions(library, options));
}
