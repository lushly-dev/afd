/**
 * @fileoverview The two ways into the commands that the server builds: the copilot's registry
 * (DirectClient) and the MCP handler at `/mcp`, sharing what must be shared.
 *
 * Both run the main example's middleware. Its journal is opened here once and handed to both,
 * because two `FileJournalSink`s on one file would write the same `seq` twice. The MCP handler
 * takes this server's Host and Origin lists, so `/mcp` accepts exactly the requests the server's
 * own checks let through.
 */

import { createTodoServerOptions, type Env } from '@afd/example-todo-ts/server-options';
import type { JournalSink } from '@lushly-dev/afd-core';
import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
import {
	createMcpHandler,
	type DirectCommandRegistry,
	type McpHandler,
} from '@lushly-dev/afd-server';
import type { ChatServerConfig } from './http-security.js';
import { createCopilotRegistry } from './registry.js';

export interface TodoServices {
	/** The registry the copilot's DirectClient calls. */
	registry: DirectCommandRegistry;
	/** MCP at `/mcp`: the main example's server on this server's port, hosts and origins. */
	mcp: McpHandler;
}

/**
 * Build both. `journal` replaces the one `TODO_JOURNAL` names, for tests.
 */
export function createTodoServices(
	env: Env,
	config: Pick<ChatServerConfig, 'host' | 'port' | 'allowedHosts' | 'allowedOrigins'>,
	journal: JournalSink | undefined = env.TODO_JOURNAL
		? new FileJournalSink(env.TODO_JOURNAL)
		: undefined
): TodoServices {
	const deps = journal ? { journal } : {};
	return {
		registry: createCopilotRegistry(env, deps),
		mcp: createMcpHandler({
			...createTodoServerOptions(env, deps),
			host: config.host,
			port: config.port,
			allowedHosts: config.allowedHosts,
			allowedOrigins: config.allowedOrigins,
		}),
	};
}
