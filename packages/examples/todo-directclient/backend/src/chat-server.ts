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
import { createStore, SqliteStore, setStore } from '@afd/example-todo-ts/store';
import { DirectClient } from '@lushly-dev/afd-client';
import { createChatBackend } from './chat.js';
import { createChatServer } from './chat-http.js';
import { Copilot } from './copilot.js';
import { GeminiModel } from './gemini.js';
import { loadChatServerConfig, parsePositiveInt } from './http-security.js';
import { createTodoServices } from './services.js';

function fail(message: string): never {
	console.error(`❌ ${message}`);
	process.exit(1);
}

const env = process.env;
let config: ReturnType<typeof loadChatServerConfig>;
let limits: { maxRetries: number; retryDelayMs: number; maxRounds: number };
try {
	config = loadChatServerConfig(env);
	limits = {
		maxRetries: parsePositiveInt('GEMINI_MAX_RETRIES', env.GEMINI_MAX_RETRIES, 3),
		retryDelayMs: parsePositiveInt('GEMINI_RETRY_DELAY_MS', env.GEMINI_RETRY_DELAY_MS, 1000),
		maxRounds: parsePositiveInt('GEMINI_MAX_TOOL_ROUNDS', env.GEMINI_MAX_TOOL_ROUNDS, 5),
	};
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

const store = createStore(env);
// A SQLite database that cannot be opened fails here, not on the first command
if (store instanceof SqliteStore) await store.check();
setStore(store);

const apiKey = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
if (apiKey && apiKey.length < 20) fail('The API key looks too short. Check your .env file.');
// The copilot's registry and /mcp, over one journal and with this server's hosts and origins
const { registry, mcp } = createTodoServices(env, config);
const copilot = apiKey
	? new Copilot({
			registry,
			model: new GeminiModel({
				apiKey,
				maxRetries: limits.maxRetries,
				retryDelayMs: limits.retryDelayMs,
				onRetry: (attempt, delayMs, error) =>
					console.error(`⚠️  Gemini retry ${attempt} in ${delayMs}ms (${error.category})`),
			}),
			maxRounds: limits.maxRounds,
		})
	: undefined;

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
