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
 * file (importing the store module touches no file), and the middleware the server records
 * through, so the clock and random values on each entry's tape reach the handlers as they did
 * when recorded. Only the approval hold is off: each journaled call already passed it. Replay starts from an empty
 * store, so a session that read todos it did not create diverges at the first such read.
 */

import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { createMcpServer, type McpServer } from '@lushly-dev/afd-server';
import { createTodoServerOptions } from './server-options.js';
import { setStore, TodoStore } from './store/index.js';

/**
 * A fresh registry for one replay. It replaces the store for the whole process (`setStore`), so
 * build it in a process of its own, as `afd replay` does, not beside a running server.
 */
export default function createReplayRegistry(): McpServer {
	setStore(new TodoStore());
	return createMcpServer(
		createTodoServerOptions(
			// Every journaled call already got past the approval hold, and the approval itself is not
			// journaled, so replay without the hold or an approved call would be held again.
			{ ...process.env, APPROVALS: 'off', TODO_JOURNAL: undefined },
			// The same middleware as when recording: a journal middleware records nothing during a
			// replay, but restarts each call's tape at its own position.
			{ journal: new MemoryJournalSink() }
		)
	);
}
