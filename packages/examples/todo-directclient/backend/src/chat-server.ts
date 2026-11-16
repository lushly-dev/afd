/**
 * @fileoverview The server: the page, the copilot's `/chat`, and MCP at `/mcp`, in one process
 * over one store.
 *
 * - The copilot calls the main to-do example's commands through DirectClient, in this process
 *   (`copilot.ts`, `registry.ts`).
 * - `/mcp` serves the same commands over MCP (`createMcpHandler` with the main example's
 *   options), so `afd connect http://localhost:3201/mcp` reaches the todos the copilot changes.
 * - The store is the main example's: `TODO_STORE_TYPE` and `TODO_STORE_PATH` choose it, and by
 *   default it is the JSON file the main example's server also uses.
 *
 * Security defaults (see `http-security.ts`, all configurable in `.env`): binds 127.0.0.1 only,
 * browser requests only from this server's own localhost origins (`null` and `*` refused), a
 * `Host` check against DNS rebinding, per-client rate limits, a body size limit, and every
 * command validated by `createDirectRegistry`.
 *
 * Usage: pnpm dev, then open http://localhost:3201
 */

import 'dotenv/config';
import { createTodoServerOptions } from '@afd/example-todo-ts/server-options';
import { createStore, SqliteStore, setStore } from '@afd/example-todo-ts/store';
import { DirectClient } from '@lushly-dev/afd-client';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { createChatBackend } from './chat.js';
import { createChatServer } from './chat-http.js';
import { Copilot } from './copilot.js';
import { GeminiModel } from './gemini.js';
import { loadChatServerConfig } from './http-security.js';
import { createCopilotRegistry } from './registry.js';

function fail(message: string): never {
	console.error(`❌ ${message}`);
	process.exit(1);
}

let config: ReturnType<typeof loadChatServerConfig>;
try {
	config = loadChatServerConfig(process.env);
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

const store = createStore(process.env);
// A SQLite database that cannot be opened fails here, not on the first command
if (store instanceof SqliteStore) await store.check();
setStore(store);

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (apiKey && apiKey.length < 20) fail('The API key looks too short. Check your .env file.');
const registry = createCopilotRegistry(process.env);
const copilot = apiKey
	? new Copilot({
			registry,
			model: new GeminiModel({
				apiKey,
				maxRetries: Number.parseInt(process.env.GEMINI_MAX_RETRIES ?? '3', 10),
				retryDelayMs: Number.parseInt(process.env.GEMINI_RETRY_DELAY_MS ?? '1000', 10),
				onRetry: (attempt, delayMs, error) =>
					console.error(`⚠️  Gemini retry ${attempt} in ${delayMs}ms (${error.category})`),
			}),
			maxRounds: Number.parseInt(process.env.GEMINI_MAX_TOOL_ROUNDS ?? '5', 10),
		})
	: undefined;

// The main example's MCP options, on this server's port and with this server's browser origins
const mcp = createMcpHandler({
	...createTodoServerOptions(process.env),
	host: config.host,
	port: config.port,
	allowedOrigins: config.allowedOrigins,
});

const { server } = createChatServer(config, {
	// The page's own calls go through the same registry as the copilot's, as a person
	executor: new DirectClient(registry),
	chat: createChatBackend(copilot),
	mcp,
});

server.listen(config.port, config.host, () => {
	const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
	console.log(`\nTodo copilot running at ${url}`);
	console.log(
		`   Gemini: ${copilot ? `configured (key ***${apiKey?.slice(-4)})` : 'not configured (set GOOGLE_API_KEY)'}`
	);
	console.log(`   MCP:    afd connect ${url}/mcp`);
	console.log(`   Bound to ${config.host}; browser origins ${config.allowedOrigins.join(', ')}`);
	console.log(
		`   Hosts ${config.allowedHosts.join(', ')}; X-Forwarded-For ${config.trustProxy ? 'trusted' : 'ignored'}`
	);
	console.log(
		`   Rate limits: chat ${config.rateLimitChat}/min, execute ${config.rateLimitExecute}/min; body ${config.maxBodySize} bytes`
	);
	console.log('\n   Press Ctrl+C to stop.\n');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		mcp.dispose();
		server.close(() => process.exit(0));
	});
}
