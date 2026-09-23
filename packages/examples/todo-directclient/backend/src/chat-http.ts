/**
 * @fileoverview HTTP server for the AI copilot: routes, security checks and
 * the bundled frontend.
 *
 * `createChatServer` builds the server without starting it and takes its
 * collaborators as arguments, so tests can drive it with a fake chat model.
 * `chat-server.ts` wires in Gemini and starts it.
 *
 * Every request is checked, in order, for:
 * 1. a `Host` header naming this server (DNS rebinding),
 * 2. an allowed `Origin` (never `null` or a wildcard),
 * 3. a per-client rate limit keyed on the socket address (or the trusted
 *    proxy's `X-Forwarded-For` entry when `TRUST_PROXY` is set),
 * 4. a JSON body within `MAX_BODY_SIZE`.
 */

import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	type ChatServerConfig,
	getClientAddress,
	isHostAllowed,
	isOriginAllowed,
	RateLimiter,
} from './http-security.js';

/** Executes commands for `/execute`: a `DirectClient` over the validating registry. */
export interface CommandExecutor {
	call(name: string, args?: Record<string, unknown>): Promise<CommandResult<unknown>>;
}

/** The AI side of the server (Gemini in `chat.ts`). */
export interface ChatBackend {
	processChat(message: string): Promise<unknown>;
	isConfigured(): boolean;
	getMetrics(): Record<string, unknown>;
}

/** An error whose message is safe to show to the user. */
export class PublicError extends Error {}

export interface ChatServerDeps {
	executor: CommandExecutor;
	chat: ChatBackend;
	/** Directory holding `index.html`, `app.js` and `render.js` (default: `../../frontend`). */
	frontendDir?: string;
	/** Clock for the rate limiter, for tests. */
	now?: () => number;
	/** Called for unexpected errors (default: `console.error`). */
	onError?: (error: unknown) => void;
}

export interface ChatServer {
	server: http.Server;
	rateLimiter: RateLimiter;
	/** Stop the rate-limit sweep timer. Called automatically when the server closes. */
	dispose(): void;
}

const MAX_MESSAGE_LENGTH = 2000;
const COMMAND_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** Static files served to the browser; nothing else on disk is reachable. */
const FRONTEND_FILES: Record<string, { file: string; type: string }> = {
	'/': { file: 'index.html', type: 'text/html; charset=utf-8' },
	'/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
	'/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
	'/render.js': { file: 'render.js', type: 'text/javascript; charset=utf-8' },
};

/**
 * Scripts only from this origin (no inline script, so injected markup cannot
 * run code); `connect-src` also allows the MCP server's health check.
 */
const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"connect-src 'self' http://localhost:3200 http://127.0.0.1:3200",
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
 *   executor: new DirectClient(registry),
 *   chat: { processChat, isConfigured, getMetrics },
 * });
 * server.listen(config.port, config.host);
 * ```
 */
export function createChatServer(config: ChatServerConfig, deps: ChatServerDeps): ChatServer {
	const startedAt = Date.now();
	const frontendDir =
		deps.frontendDir ?? fileURLToPath(new URL('../../frontend/', import.meta.url));
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

	async function serveFrontend(res: http.ServerResponse, pathname: string): Promise<boolean> {
		const entry = FRONTEND_FILES[pathname];
		if (!entry) return false;
		const body = await readFile(join(frontendDir, entry.file));
		res.writeHead(200, {
			'Content-Type': entry.type,
			'Content-Security-Policy': CONTENT_SECURITY_POLICY,
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Cache-Control': 'no-store',
		});
		res.end(body);
		return true;
	}

	async function execute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await readJsonObject(req, config.maxBodySize);
		const name = body.name;
		if (typeof name !== 'string' || !COMMAND_NAME.test(name)) {
			throw new HttpError(400, 'Invalid command name', 'Use a kebab-case name such as todo-list');
		}
		if (body.args !== undefined && !isRecord(body.args)) {
			throw new HttpError(400, 'args must be a JSON object');
		}
		// The executor is a DirectClient over createDirectRegistry: unknown names,
		// commands not exposed to the agent and invalid input all fail here,
		// before any handler runs.
		const start = performance.now();
		const result = await deps.executor.call(name, body.args ?? {});
		sendJson(res, 200, { ...result, latencyMs: performance.now() - start });
	}

	async function chat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await readJsonObject(req, config.maxBodySize);
		const message = typeof body.message === 'string' ? body.message.trim() : '';
		if (!message) throw new HttpError(400, 'Message required');
		sendJson(res, 200, await deps.chat.processChat(message.slice(0, MAX_MESSAGE_LENGTH)));
	}

	async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (!isHostAllowed(req.headers.host, config.allowedHosts)) {
			throw new HttpError(403, 'Host not allowed', 'Add this host name to ALLOWED_HOSTS');
		}
		if (!isOriginAllowed(req.headers, config.allowedOrigins)) {
			throw new HttpError(403, 'Origin not allowed', 'Add the page origin to ALLOWED_ORIGINS');
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

		const { pathname } = new URL(req.url ?? '/', 'http://localhost');
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
					checks: { gemini: ready ? 'ok' : 'missing_api_key', directClient: 'ok' },
				});
				return;
			}
			if (pathname === '/metrics') {
				sendJson(res, 200, {
					...deps.chat.getMetrics(),
					uptimeMs: Date.now() - startedAt,
					rateLimitConfig: { chat: config.rateLimitChat, execute: config.rateLimitExecute },
				});
				return;
			}
			if (await serveFrontend(res, pathname)) return;
		}

		if (req.method === 'POST' && pathname === '/execute') {
			if (limit(res, `${client}:execute`, config.rateLimitExecute)) await execute(req, res);
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
			if (res.headersSent) {
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

	return { server, rateLimiter, dispose };
}
