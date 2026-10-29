/**
 * Violet Design REST API Server
 *
 * Simple HTTP server that exposes commands via REST.
 * This is the same command layer that MCP uses - just a different transport.
 *
 * Uses Node.js built-in http module to avoid extra dependencies.
 *
 * Security defaults:
 * - Binds to 127.0.0.1 only (override with `host` / VIOLET_API_HOST).
 * - Optional shared-secret auth via VIOLET_API_TOKEN (Bearer or X-API-Key).
 *   A token is REQUIRED when binding a non-loopback host.
 * - CORS is restricted to an allow-list (VIOLET_CORS_ORIGINS), never `*`.
 * - Commands that shell out (`validate`) or inspect the host (`doctor`) are
 *   not exposed over HTTP.
 * - Request bodies are capped (1 MB by default).
 */

import { timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import {
	type CommandContext,
	type Database,
	createMemoryDatabase,
	createSQLiteDatabase,
	initializeCore,
	registry,
} from '@lushly-dev/violet-afd';
import { nanoid } from 'nanoid';

export interface ApiServerOptions {
	port?: number;
	/** Interface to bind. Defaults to VIOLET_API_HOST or 127.0.0.1 (loopback only). */
	host?: string;
	useMemory?: boolean;
	dbPath?: string;
	/**
	 * Shared secret. When set, /api/commands and /api/command require
	 * `Authorization: Bearer <token>` or `X-API-Key: <token>`.
	 * Defaults to VIOLET_API_TOKEN. REQUIRED when binding a non-loopback host.
	 */
	token?: string;
	/**
	 * Browser origins allowed via CORS. Defaults to VIOLET_CORS_ORIGINS
	 * (comma separated) or the web dev server origins on port 3000.
	 */
	corsOrigins?: string[];
	/** Maximum request body size in bytes (default 1 MB). */
	maxBodyBytes?: number;
	/** Suppress startup logging. */
	silent?: boolean;
}

/** Default allowed browser origins: the Vite dev server of packages/web. */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/** Default request body limit (1 MB). */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Commands that are never exposed over HTTP.
 * - `validate` shells out (`pnpm test`) on the server host.
 * - `doctor` inspects the host environment.
 */
export const HTTP_EXCLUDED_COMMANDS: ReadonlySet<string> = new Set(['validate', 'doctor']);

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True when `host` only accepts connections from the local machine. */
export function isLoopbackHost(host: string): boolean {
	const h = host.toLowerCase();
	return LOOPBACK_HOSTNAMES.has(h) || /^127(\.\d{1,3}){3}$/.test(h);
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

/**
 * Parse request body as a JSON object, enforcing a size limit.
 * An empty body yields `{}`.
 */
async function parseBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
	const tooLargeError = () =>
		new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);

	const declared = Number(req.headers['content-length']);
	if (Number.isFinite(declared) && declared > maxBytes) {
		req.resume();
		throw tooLargeError();
	}

	const raw = await new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		req.on('data', (chunk: Buffer) => {
			if (tooLarge) return;
			size += chunk.length;
			if (size > maxBytes) {
				tooLarge = true;
				chunks.length = 0;
				return; // keep draining, but stop buffering
			}
			chunks.push(chunk);
		});
		req.on('end', () =>
			tooLarge ? reject(tooLargeError()) : resolve(Buffer.concat(chunks).toString('utf8')),
		);
		req.on('error', reject);
	});

	if (raw.trim() === '') return {};

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object');
	}
	return parsed as Record<string, unknown>;
}

/**
 * Create command context
 */
function createContext(db: Database): CommandContext {
	return {
		db,
		actor: 'api',
		traceId: nanoid(),
	};
}

function tokensMatch(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

function extractToken(req: IncomingMessage): string | undefined {
	const auth = req.headers.authorization;
	if (typeof auth === 'string') {
		const match = /^Bearer\s+(.+)$/i.exec(auth);
		if (match) return match[1].trim();
	}
	const key = req.headers['x-api-key'];
	return typeof key === 'string' ? key : undefined;
}

function parseOriginList(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const list = value
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return list.length > 0 ? list : undefined;
}

/**
 * Create and start the REST API server
 */
export async function createApiServer(
	options: ApiServerOptions = {},
): Promise<ReturnType<typeof createServer>> {
	const {
		port = 3001,
		host = process.env.VIOLET_API_HOST || '127.0.0.1',
		useMemory = true,
		dbPath = './violet.db',
		maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
		silent = false,
	} = options;
	const token = options.token ?? (process.env.VIOLET_API_TOKEN || undefined);
	const corsOrigins = (
		options.corsOrigins ??
		parseOriginList(process.env.VIOLET_CORS_ORIGINS) ??
		DEFAULT_CORS_ORIGINS
	)
		.map((o) => o.replace(/\/$/, ''))
		.filter((o) => o !== '*');
	const allowedOrigins = new Set(corsOrigins);
	const loopback = isLoopbackHost(host);

	if (!loopback && !token) {
		throw new Error(
			`Refusing to bind the Violet API to non-loopback host "${host}" without authentication. Set VIOLET_API_TOKEN (or the token option) or bind to 127.0.0.1.`,
		);
	}

	// Initialize core and register all commands
	initializeCore();

	// Create database
	const db = useMemory ? createMemoryDatabase() : await createSQLiteDatabase(dbPath);

	const send = (
		res: ServerResponse,
		data: unknown,
		status = 200,
		extraHeaders: Record<string, string> = {},
	): void => {
		res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
		res.end(JSON.stringify(data));
	};

	const fail = (
		res: ServerResponse,
		status: number,
		code: string,
		message: string,
		headers: Record<string, string> = {},
	): void => send(res, { success: false, error: { code, message } }, status, headers);

	const server = createServer(async (req, res) => {
		const path = new URL(req.url || '/', 'http://localhost').pathname;
		const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

		// Defend against DNS rebinding when only reachable via loopback.
		if (loopback) {
			const hostHeader = req.headers.host ?? '';
			const hostname = hostHeader.startsWith('[')
				? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
				: hostHeader.split(':')[0];
			if (!isLoopbackHost(hostname)) {
				fail(res, 403, 'FORBIDDEN_HOST', 'Unexpected Host header');
				return;
			}
		}

		// Browser requests must come from an allow-listed origin.
		const corsHeaders: Record<string, string> = { Vary: 'Origin' };
		if (origin !== undefined) {
			if (!allowedOrigins.has(origin)) {
				fail(res, 403, 'FORBIDDEN_ORIGIN', 'Origin not allowed', corsHeaders);
				return;
			}
			corsHeaders['Access-Control-Allow-Origin'] = origin;
		}

		// Handle CORS preflight
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				...corsHeaders,
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
				'Access-Control-Max-Age': '600',
			});
			res.end();
			return;
		}

		try {
			// Health check (unauthenticated, reveals nothing sensitive)
			if (path === '/api/health' && req.method === 'GET') {
				send(res, { status: 'ok', timestamp: new Date().toISOString() }, 200, corsHeaders);
				return;
			}

			const isCommandRoute =
				(path === '/api/commands' && req.method === 'GET') ||
				(path === '/api/command' && req.method === 'POST');

			if (isCommandRoute && token) {
				const provided = extractToken(req);
				if (!provided || !tokensMatch(provided, token)) {
					fail(res, 401, 'UNAUTHORIZED', 'Missing or invalid API token', {
						...corsHeaders,
						'WWW-Authenticate': 'Bearer',
					});
					return;
				}
			}

			// List available commands
			if (path === '/api/commands' && req.method === 'GET') {
				const commands = registry
					.list()
					.filter((cmd) => !HTTP_EXCLUDED_COMMANDS.has(cmd.name))
					.map((cmd) => ({
						name: cmd.name,
						description: cmd.description,
						category: cmd.name.split('.')[0],
					}));
				send(res, { success: true, data: { commands } }, 200, corsHeaders);
				return;
			}

			// Execute command
			if (path === '/api/command' && req.method === 'POST') {
				const body = await parseBody(req, maxBodyBytes);
				const { command, input = {} } = body as { command?: unknown; input?: unknown };

				if (typeof command !== 'string' || !command) {
					fail(res, 400, 'MISSING_COMMAND', 'Command name required', corsHeaders);
					return;
				}

				if (HTTP_EXCLUDED_COMMANDS.has(command)) {
					fail(
						res,
						403,
						'COMMAND_NOT_ALLOWED',
						`Command is not available over HTTP: ${command}`,
						corsHeaders,
					);
					return;
				}

				const cmd = registry.get(command);
				if (!cmd) {
					send(
						res,
						{
							success: false,
							error: {
								code: 'COMMAND_NOT_FOUND',
								message: `Unknown command: ${command}`,
								suggestion: 'Use GET /api/commands to list available commands',
							},
						},
						404,
						corsHeaders,
					);
					return;
				}

				const context = createContext(db);
				const result = await registry.execute(command, input, context);
				send(res, result, 200, corsHeaders);
				return;
			}

			// 404 for unknown routes
			fail(res, 404, 'NOT_FOUND', `Unknown route: ${path}`, corsHeaders);
		} catch (error) {
			if (res.headersSent) {
				res.end();
				return;
			}
			if (error instanceof HttpError) {
				const headers =
					error.status === 413 ? { ...corsHeaders, Connection: 'close' } : corsHeaders;
				fail(res, error.status, error.code, error.message, headers);
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			fail(res, 500, 'EXECUTION_ERROR', message, corsHeaders);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.off('error', reject);
			resolve();
		});
	});

	if (!silent) {
		const actualPort = (server.address() as AddressInfo).port;
		console.log(`Violet API Server running at http://${host}:${actualPort}`);
		console.log(`   Commands: ${registry.list().length - HTTP_EXCLUDED_COMMANDS.size} exposed`);
		console.log(`   Database: ${useMemory ? 'memory' : 'sqlite'}`);
		console.log(`   Auth: ${token ? 'token required' : 'none (loopback only)'}`);
	}

	return server;
}

/** True when this module is the process entry point (not merely imported). */
function isEntryPoint(): boolean {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(entry)).href;
	} catch {
		return import.meta.url === pathToFileURL(entry).href;
	}
}

// Run directly
if (isEntryPoint()) {
	// VIOLET_DB_PATH serves an existing SQLite database (e.g. one seeded with
	// `violet demo seed`); without it the server starts with an in-memory database.
	// VIOLET_API_PORT moves it off 3001, e.g. for the web end-to-end tests.
	const dbPath = process.env.VIOLET_DB_PATH;
	const port = process.env.VIOLET_API_PORT ? Number(process.env.VIOLET_API_PORT) : undefined;
	createApiServer({
		...(dbPath ? { useMemory: false, dbPath } : {}),
		...(port ? { port } : {}),
	}).catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
