/**
 * @fileoverview The module `afd replay` loads to run a recorded session again.
 *
 * ```bash
 * TODO_JOURNAL=session.jsonl pnpm start      # record a session
 * pnpm build
 * afd replay session.jsonl --module dist/registry.js
 * ```
 *
 * The default export is a factory: each replay gets a fresh in-memory store, never the data
 * file, and the same middleware the server records through, so the clock and random values on
 * each entry's tape reach the handlers as they did when recorded. Replay starts from an empty
 * store, so a session that read todos it did not create diverges at the first such read.
 */

import { createMcpServer, type McpServer } from '@lushly-dev/afd-server';
import { createTodoServerOptions } from './server-options.js';
import { setStore, TodoStore } from './store/index.js';

export default function createReplayRegistry(): McpServer {
	setStore(new TodoStore());
	// No journal: the replayed calls are not recorded again.
	return createMcpServer(createTodoServerOptions({ ...process.env, TODO_JOURNAL: undefined }));
}
