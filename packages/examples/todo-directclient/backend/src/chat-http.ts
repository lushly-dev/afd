/**
 * @fileoverview HTTP server for the AI copilot: the page, a turn of the copilot, the page's
 * answers to it, and MCP.
 *
 * `createChatServer` builds the server without starting it and takes its collaborators as
 * arguments, so tests can drive it with a scripted model. `chat-server.ts` wires in Gemini and
 * starts it.
 *
 * - `POST /chat` streams one turn as JSON lines (`application/x-ndjson`): `turn` (its id), then
 *   `call` and `result` for each command the model runs, `approval` and `view` questions for the
 *   page, `withdrawn` when one lapses, and last `done` (the turn) or `error`.
 * - `POST /chat/answer { turn, ask, approved }` answers an approval, and
 *   `{ turn, ask, result }` a view call with the page's own command result (`turns.ts`).
 * - `/mcp` is the main example's MCP server, which the page's to-do list uses.
 *
 * Every request is checked, in order, for:
 * 1. a `Host` header naming this server (DNS rebinding),
 * 2. an allowed `Origin` (never `null` or a wildcard),
 * 3. a per-client rate limit keyed on the socket address (or the trusted
 *    proxy's `X-Forwarded-For` entry when `TRUST_PROXY` is set), except `/mcp`,
 * 4. a JSON body within `MAX_BODY_SIZE`.
 */

import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CommandResult, failure } from '@lushly-dev/afd-core';
import { COPILOT_MODES, type CopilotMode, type RunOptions } from './copilot.js';
import {
	type ChatServerConfig,
	getClientAddress,
	isHostAllowed,
	isOriginAllowed,
	RateLimiter,
} from './http-security.js';
import { TurnDesk } from './turns.js';

/** The AI side of the server (the copilot in `chat.ts`). */
export interface ChatBackend {
	processChat(message: string, mode: CopilotMode, options?: RunOptions): Promise<unknown>;
	isConfigured(): boolean;
	getMetrics(): Record<string, unknown>;
}

/** An error whose message is safe to show to the user. */
export class PublicError extends Error {}

export interface ChatServerDeps {
	chat: ChatBackend;
	/**
	 * Serves MCP at `/mcp` (`createMcpHandler` over the same commands and store), so the AFD CLI
	 * and other MCP clients reach the todos the copilot changes. Requests reach it after the Host
	 * and Origin checks; it answers CORS itself.
	 */
	mcp?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
	/** The built page (default: `../../frontend/dist`, from `pnpm build` in `frontend/`). */
	frontendDir?: string;
	/** How long the page has to answer a view call, in milliseconds (default 10 000). */
	viewTimeoutMs?: number;
	/** Clock for the rate limiter, for tests. */
	now?: () => number;
	/** Called for unexpected errors (default: `console.error`). */
	onError?: (error: unknown) => void;
}

export interface ChatServer {
	server: http.Server;
	rateLimiter: RateLimiter;
	/** The turns in progress. */
	turns: TurnDesk;
	/** Stop the rate-limit sweep timer. Called automatically when the server closes. */
	dispose(): void;
}

const MAX_MESSAGE_LENGTH = 2000;
/** How long to wait for the person when a held call states no expiry. */
const APPROVAL_WAIT_MS = 5 * 60_000;

/** The types of the files a Vite build writes; any other file is not served. */
const CONTENT_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
};

/** Scripts only from this origin (no inline script, so injected markup cannot run code). */
const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"connect-src 'self'",
	"img-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join('; ');

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly suggestion?: string
	) {
		super(message);
	}
}

function sendJson(
	res: http.ServerResponse,
	status: number,
	body: unknown,
	headers: http.OutgoingHttpHeaders = {}
): void {
	res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
	res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, error: HttpError): void {
	sendJson(res, error.status, {
		error: error.message,
		...(error.suggestion ? { suggestion: error.suggestion } : {}),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a JSON object body, refusing other content types and bodies over `maxBytes`. */
export async function readJsonObject(
	req: http.IncomingMessage,
	maxBytes: number
): Promise<Record<string, unknown>> {
	const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
	if (contentType !== 'application/json') {
		throw new HttpError(415, 'Content-Type must be application/json');
	}
	const declared = Number(req.headers['content-length']);
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new HttpError(413, 'Request body too large', `Send at most ${maxBytes} bytes`);
	}

	// Listeners rather than `for await`: leaving a `for await` early destroys the
	// socket, and the client would never see the 413.
	const text = await new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const cleanup = () => {
			req.off('data', onData);
			req.off('end', onEnd);
			req.off('error', onFailure);
			req.off('aborted', onFailure);
		};
		const onData = (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				cleanup();
				reject(new HttpError(413, 'Request body too large', `Send at most ${maxBytes} bytes`));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => {
			cleanup();
			resolve(Buffer.concat(chunks).toString('utf8'));
		};
		const onFailure = () => {
			cleanup();
			reject(new HttpError(400, 'Request body could not be read'));
		};
		req.on('data', onData);
		req.once('end', onEnd);
		req.once('error', onFailure);
		req.once('aborted', onFailure);
	});

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new HttpError(400, 'Invalid JSON', 'Send a JSON object body');
	}
	if (!isRecord(parsed)) {
		throw new HttpError(400, 'Request body must be a JSON object');
	}
	return parsed;
}

/**
 * Create the chat server (not yet listening).
 *
 * @example
 * ```typescript
 * const { server } = createChatServer(loadChatServerConfig(process.env), {
 *   chat: createChatBackend(copilot),
 *   mcp,
 * });
 * server.listen(config.port, config.host);
 * ```
 */
export function createChatServer(config: ChatServerConfig, deps: ChatServerDeps): ChatServer {
	const startedAt = Date.now();
	const frontendDir = resolve(
		deps.frontendDir ?? fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
	);
	const viewTimeoutMs = deps.viewTimeoutMs ?? 10_000;
	const turns = new TurnDesk();
	const onError =
		deps.onError ?? ((error: unknown) => console.error('❌ Chat server error:', error));
	const rateLimiter = new RateLimiter({ maxKeys: config.rateLimitMaxClients, now: deps.now });

	function limit(res: http.ServerResponse, key: string, max: number): boolean {
		const decision = rateLimiter.check(key, max);
		if (decision.allowed) return true;
		sendJson(
			res,
			429,
			{ error: 'Rate limit exceeded', retryAfter: decision.retryAfter },
			{ 'Retry-After': String(decision.retryAfter) }
		);
		return false;
	}

	/** A file of the built page, or false: nothing outside its directory, no other types. */
	async function serveFrontend(res: http.ServerResponse, pathname: string): Promise<boolean> {
		let relative: string;
		try {
			relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
		} catch {
			return false;
		}
		const path = normalize(`${frontendDir}${sep}${relative}`);
		const type = CONTENT_TYPES[extname(path)];
		if (!type || !path.startsWith(frontendDir + sep)) return false;
		const found = await stat(path).catch(() => undefined);
		if (!found?.isFile()) return false;
		const body = await readFile(path);
		res.writeHead(200, {
			'Content-Type': type,
			'Content-Security-Policy': CONTENT_SECURITY_POLICY,
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Cache-Control': 'no-store',
		});
		res.end(body);
		return true;
	}

	async function chat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await readJsonObject(req, config.maxBodySize);
		const message = typeof body.message === 'string' ? body.message.trim() : '';
		if (!message) throw new HttpError(400, 'Message required');
		const mode = body.mode ?? 'change';
		if (!COPILOT_MODES.includes(mode as CopilotMode)) {
			throw new HttpError(400, 'Invalid mode', `Use one of: ${COPILOT_MODES.join(', ')}`);
		}
		// A page that goes away mid-turn cancels the rest of it: the model request, the commands
		// and any question it was waiting to answer
		const cancel = new AbortController();
		res.once('close', () => {
			if (!res.writableEnded) cancel.abort();
		});
		res.writeHead(200, {
			'Content-Type': 'application/x-ndjson; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
		});
		const send = (event: Record<string, unknown>) => {
			if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
		};
		const turn = turns.open(send);
		send({ type: 'turn', turn: turn.id });
		try {
			const result = await deps.chat.processChat(
				message.slice(0, MAX_MESSAGE_LENGTH),
				mode as CopilotMode,
				{
					signal: cancel.signal,
					onEvent: (event) => send({ ...event }),
					// The person answers in the page; no answer by the token's expiry is a no
					onApprovalNeeded: async ({ command, summary, expiresAt, signal }) => {
						const expires = Date.parse(expiresAt);
						const waitMs = Number.isNaN(expires) ? APPROVAL_WAIT_MS : expires - Date.now();
						const question = { type: 'approval' as const, command, summary, expiresAt };
						return (await turn.ask(question, waitMs, signal)) === true;
					},
					page: {
						run: async (command, input, signal) =>
							((await turn.ask({ type: 'view', command, input }, viewTimeoutMs, signal)) as
								| CommandResult<unknown>
								| undefined) ??
							failure({
								code: 'PAGE_DID_NOT_ANSWER',
								message: `The page did not run ${command} in time`,
								suggestion: 'Answer in the chat instead, or ask the person to reload the page',
							}),
					},
				}
			);
			send({ type: 'done', ...(result as Record<string, unknown>) });
		} catch (error) {
			if (!cancel.signal.aborted) {
				if (!(error instanceof PublicError)) onError(error);
				send({
					type: 'error',
					error: error instanceof PublicError ? error.message : 'Internal server error',
				});
			}
		} finally {
			turns.close(turn);
			res.end();
		}
	}

	/** The page's answer to a question a turn asked. */
	async function answer(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await readJsonObject(req, config.maxBodySize);
		const { turn: id, ask, approved, result } = body;
		if (typeof id !== 'string' || typeof ask !== 'number' || !Number.isInteger(ask)) {
			throw new HttpError(400, 'turn (a string) and ask (an integer) are required');
		}
		let accepted: boolean;
		if (typeof approved === 'boolean') {
			accepted = turns.get(id)?.answer(ask, 'approval', approved) ?? false;
		} else if (isRecord(result) && typeof result.success === 'boolean') {
			accepted = turns.get(id)?.answer(ask, 'view', result) ?? false;
		} else {
			throw new HttpError(
				400,
				'Send approved (a boolean) or result (a command result)',
				'Answer an approval with { approved } and a view call with { result }'
			);
		}
		if (!accepted) {
			throw new HttpError(
				404,
				'No such question is open',
				'It was answered or withdrawn, or its turn ended'
			);
		}
		sendJson(res, 200, { accepted: true });
	}

	async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (!isHostAllowed(req.headers.host, config.allowedHosts)) {
			throw new HttpError(403, 'Host not allowed', 'Add this host name to ALLOWED_HOSTS');
		}
		if (!isOriginAllowed(req.headers, config.allowedOrigins)) {
			throw new HttpError(403, 'Origin not allowed', 'Add the page origin to ALLOWED_ORIGINS');
		}

		const { pathname } = new URL(req.url ?? '/', 'http://localhost');
		if (deps.mcp && (pathname === '/mcp' || pathname.startsWith('/mcp/'))) {
			await deps.mcp(req, res);
			return;
		}

		const origin = req.headers.origin;
		if (origin) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
			res.setHeader('Access-Control-Max-Age', '600');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		const client = getClientAddress(req, config.trustProxy);

		if (req.method === 'GET') {
			if (pathname === '/health') {
				sendJson(res, 200, {
					status: 'ok',
					geminiConfigured: deps.chat.isConfigured(),
					uptimeMs: Date.now() - startedAt,
				});
				return;
			}
			if (pathname === '/ready') {
				const ready = deps.chat.isConfigured();
				sendJson(res, ready ? 200 : 503, {
					ready,
					checks: { gemini: ready ? 'ok' : 'missing_api_key' },
				});
				return;
			}
			if (pathname === '/metrics') {
				sendJson(res, 200, {
					...deps.chat.getMetrics(),
					uptimeMs: Date.now() - startedAt,
					openTurns: turns.size,
					rateLimitConfig: { chat: config.rateLimitChat, answer: config.rateLimitAnswer },
				});
				return;
			}
			if (await serveFrontend(res, pathname)) return;
		}

		if (req.method === 'POST' && pathname === '/chat/answer') {
			if (limit(res, `${client}:answer`, config.rateLimitAnswer)) await answer(req, res);
			return;
		}
		if (req.method === 'POST' && pathname === '/chat') {
			if (limit(res, `${client}:chat`, config.rateLimitChat)) await chat(req, res);
			return;
		}

		sendJson(res, 404, { error: 'Not found' });
	}

	const server = http.createServer((req, res) => {
		route(req, res).catch((error: unknown) => {
			// Already answered, or the client has gone (a cancelled turn): nothing to send
			if (res.headersSent || res.destroyed) {
				res.destroy();
				return;
			}
			if (error instanceof HttpError) {
				if (!req.complete) {
					// Stop reading the rest of a rejected upload once the answer is sent.
					res.setHeader('Connection', 'close');
					res.once('finish', () => req.destroy());
				}
				sendError(res, error);
				return;
			}
			onError(error);
			const message = error instanceof PublicError ? error.message : 'Internal server error';
			sendJson(res, 500, { error: message });
		});
	});

	const sweep = setInterval(() => rateLimiter.sweep(), 60_000);
	sweep.unref();
	const dispose = () => clearInterval(sweep);
	server.once('close', dispose);

	return { server, rateLimiter, turns, dispose };
}
