/**
 * @fileoverview Configuration and browser security policy for the chat app.
 *
 * Local-only by default: both servers bind 127.0.0.1, and browsers may only
 * call them from the demo page the realtime server serves
 * (http://localhost:3001). Everything is configurable through environment
 * variables; wildcards and the `null` origin are refused.
 */

import {
	createLoggingMiddleware,
	type McpHandlerOptions,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server';

export type Env = Readonly<Record<string, string | undefined>>;

export interface ChatConfig {
	/** Interface both servers bind (`HOST`, default `127.0.0.1`). */
	host: string;
	/** MCP server port (`PORT`, default 3100). */
	mcpPort: number;
	/** WebSocket and demo page port (`WS_PORT`, default 3001). */
	wsPort: number;
	/** Exact browser origins allowed on both servers: the demo page plus `ALLOWED_ORIGINS`. */
	allowedOrigins: string[];
	/** Host names accepted in the `Host` header (loopback names plus `ALLOWED_HOSTS`). */
	allowedHosts: string[];
	/** Largest MCP request body in bytes (`MAX_BODY_BYTES`, default 64 KiB). */
	maxBodyBytes: number;
	/** Largest WebSocket message in bytes (`WS_MAX_PAYLOAD`, default 16 KiB). */
	wsMaxPayload: number;
	/** `NODE_ENV=development`: verbose errors and any origin on the MCP server. */
	devMode: boolean;
	logLevel: string;
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === '') return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer, got "${value}"`);
	}
	return parsed;
}

/** Validate an `ALLOWED_ORIGINS` entry: an exact http(s) origin, never `*` or `null`. */
export function parseOrigin(origin: string): string {
	let url: URL | undefined;
	try {
		url = new URL(origin);
	} catch {}
	if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) {
		throw new Error(
			`ALLOWED_ORIGINS entry "${origin}" must be an exact http(s) origin such as http://localhost:5173 ("*" and "null" are not allowed)`
		);
	}
	return origin;
}

/** The demo page's origins: the realtime server on each loopback name. */
export function demoOrigins(wsPort: number): string[] {
	return LOOPBACK_HOSTS.map((host) => `http://${host}:${wsPort}`);
}

/** Read the configuration from environment variables. Throws on invalid values. */
export function loadChatConfig(env: Env): ChatConfig {
	const host = env.HOST?.trim() || '127.0.0.1';
	const wsPort = positiveInt('WS_PORT', env.WS_PORT, 3001);
	const hostName = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	return {
		host,
		mcpPort: positiveInt('PORT', env.PORT, 3100),
		wsPort,
		allowedOrigins: [
			...new Set([...demoOrigins(wsPort), ...list(env.ALLOWED_ORIGINS).map(parseOrigin)]),
		],
		allowedHosts: [...new Set([...LOOPBACK_HOSTS, hostName, ...list(env.ALLOWED_HOSTS)])].map(
			(name) => name.toLowerCase()
		),
		maxBodyBytes: positiveInt('MAX_BODY_BYTES', env.MAX_BODY_BYTES, 64 * 1024),
		wsMaxPayload: positiveInt('WS_MAX_PAYLOAD', env.WS_MAX_PAYLOAD, 16 * 1024),
		devMode: env.NODE_ENV === 'development',
		logLevel: env.LOG_LEVEL ?? 'info',
	};
}

/**
 * Options for the MCP server (`createMcpServer`) or an embedded handler
 * (`createMcpHandler`). Browsers use its `/rpc` route, which runs each command
 * through Zod validation, `expose.mcp` and middleware with a body limit.
 */
export function createChatMcpOptions(
	config: ChatConfig,
	commands: ZodCommandDefinition[]
): McpHandlerOptions {
	const verbose = config.devMode || config.logLevel === 'debug';
	return {
		name: 'chat-app',
		version: '1.0.0',
		commands,
		// Adds the afd-help, afd-docs and afd-schema bootstrap tools
		bootstrap: true,
		port: config.mcpPort,
		host: config.host,
		devMode: config.devMode,
		cors: true,
		allowedOrigins: config.allowedOrigins,
		allowedHosts: config.allowedHosts,
		maxBodyBytes: config.maxBodyBytes,
		middleware: [
			verbose
				? createLoggingMiddleware({ logInput: true, logResult: true })
				: createLoggingMiddleware(),
		],
		onCommand(command, input, result) {
			if (config.logLevel === 'debug') {
				console.error(`[Command] ${command}:`, { input, result });
			}
		},
		onError(error) {
			console.error('[Error]', error);
		},
	};
}
