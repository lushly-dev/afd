/**
 * @fileoverview HTTP security policy for the chat server, as pure functions.
 *
 * Everything here is side-effect free so it can be unit tested: configuration
 * parsing, the Origin and Host allowlists, client address resolution and a
 * bounded rate limiter.
 *
 * Defaults are local-only: the server binds 127.0.0.1, accepts browser
 * requests only from its own localhost origins, and ignores
 * `X-Forwarded-For` unless `TRUST_PROXY` is set.
 */

import type { IncomingHttpHeaders } from 'node:http';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Environment variables read by {@link loadChatServerConfig}. */
export type Env = Readonly<Record<string, string | undefined>>;

export interface ChatServerConfig {
	/** TCP port (`CHAT_PORT`, default 3201). */
	port: number;
	/** Interface to bind (`CHAT_HOST`, default `127.0.0.1`: loopback only). */
	host: string;
	/**
	 * Exact browser origins allowed to call the API: this server's own localhost
	 * origins (the bundled UI) plus any listed in `ALLOWED_ORIGINS`.
	 */
	allowedOrigins: string[];
	/** Host names accepted in the `Host` header, to block DNS rebinding (`ALLOWED_HOSTS`). */
	allowedHosts: string[];
	/** Use the address a trusted reverse proxy appended to `X-Forwarded-For` (`TRUST_PROXY`). */
	trustProxy: boolean;
	/** Maximum request body size in bytes (`MAX_BODY_SIZE`). */
	maxBodySize: number;
	/** `/chat` requests per minute per client (`RATE_LIMIT_CHAT`). */
	rateLimitChat: number;
	/** `/execute` requests per minute per client (`RATE_LIMIT_EXECUTE`). */
	rateLimitExecute: number;
	/** Most clients tracked by the rate limiter at once (`RATE_LIMIT_MAX_CLIENTS`). */
	rateLimitMaxClients: number;
}

export const DEFAULT_CHAT_PORT = 3201;
export const DEFAULT_BIND_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Split a comma-separated setting, dropping empty entries. */
export function parseList(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/** `true`, `1`, `yes` and `on` (any case) are true; anything else is false. */
export function parseBoolean(value: string | undefined): boolean {
	return ['true', '1', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

/** Parse a positive integer setting, or throw naming the variable. */
export function parsePositiveInt(
	name: string,
	value: string | undefined,
	fallback: number
): number {
	if (value === undefined || value.trim() === '') return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer, got "${value}"`);
	}
	return parsed;
}

/** The origins the bundled frontend is served from: this server on each loopback name. */
export function defaultAllowedOrigins(port: number): string[] {
	return LOOPBACK_HOSTS.map((host) => `http://${host}:${port}`);
}

/**
 * Validate one `ALLOWED_ORIGINS` entry. Wildcards and `null` are refused:
 * `null` is the origin of `file://` pages, sandboxed iframes and redirects,
 * so allowing it allows any site that can produce one.
 */
export function normalizeOrigin(origin: string): string {
	if (origin === '*' || origin.toLowerCase() === 'null') {
		throw new Error(
			`ALLOWED_ORIGINS cannot contain "${origin}"; list exact origins such as http://localhost:5173`
		);
	}
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new Error(`ALLOWED_ORIGINS entry "${origin}" is not a valid origin`);
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) {
		throw new Error(
			`ALLOWED_ORIGINS entry "${origin}" must be a bare http(s) origin such as ${url.origin}`
		);
	}
	return origin;
}

/**
 * Read the chat server configuration from environment variables.
 *
 * @throws If a setting is invalid, for example `ALLOWED_ORIGINS=*`
 */
export function loadChatServerConfig(env: Env): ChatServerConfig {
	const port = parsePositiveInt('CHAT_PORT', env.CHAT_PORT, DEFAULT_CHAT_PORT);
	const host = env.CHAT_HOST?.trim() || DEFAULT_BIND_HOST;
	const configuredOrigins = parseList(env.ALLOWED_ORIGINS).map(normalizeOrigin);
	const hostName = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

	return {
		port,
		host,
		allowedOrigins: [...new Set([...defaultAllowedOrigins(port), ...configuredOrigins])],
		allowedHosts: [...new Set([...LOOPBACK_HOSTS, hostName, ...parseList(env.ALLOWED_HOSTS)])].map(
			(name) => name.toLowerCase()
		),
		trustProxy: parseBoolean(env.TRUST_PROXY),
		maxBodySize: parsePositiveInt('MAX_BODY_SIZE', env.MAX_BODY_SIZE, 10_240),
		rateLimitChat: parsePositiveInt('RATE_LIMIT_CHAT', env.RATE_LIMIT_CHAT, 30),
		rateLimitExecute: parsePositiveInt('RATE_LIMIT_EXECUTE', env.RATE_LIMIT_EXECUTE, 120),
		rateLimitMaxClients: parsePositiveInt(
			'RATE_LIMIT_MAX_CLIENTS',
			env.RATE_LIMIT_MAX_CLIENTS,
			10_000
		),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORIGIN AND HOST CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether a request may proceed under the Origin allowlist.
 *
 * - An `Origin` must match an allowed origin exactly. `null` never matches.
 * - Without `Origin`, requests from non-browser clients (curl, scripts) pass,
 *   but a browser request that `Sec-Fetch-Site` marks as cross-site (an
 *   `<img>` or `<form>` on another site) is refused.
 */
export function isOriginAllowed(
	headers: IncomingHttpHeaders,
	allowedOrigins: readonly string[]
): boolean {
	const origin = firstHeader(headers.origin);
	if (origin !== undefined) {
		return origin !== 'null' && allowedOrigins.includes(origin);
	}
	const fetchSite = firstHeader(headers['sec-fetch-site']);
	return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}

/**
 * Whether the `Host` header names this server. Checking it defeats DNS
 * rebinding, where an attacker's domain is re-pointed at 127.0.0.1.
 */
export function isHostAllowed(
	hostHeader: string | undefined,
	allowedHosts: readonly string[]
): boolean {
	if (!hostHeader || /[\s/@\\?#]/.test(hostHeader)) return false;
	let hostname: string;
	try {
		hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
	} catch {
		return false;
	}
	return allowedHosts.includes(hostname);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT ADDRESS
// ═══════════════════════════════════════════════════════════════════════════════

/** The parts of a request {@link getClientAddress} reads. */
export interface ClientRequest {
	headers: IncomingHttpHeaders;
	socket: { remoteAddress?: string };
}

/**
 * The address to rate limit on.
 *
 * `X-Forwarded-For` is only honored with `trustProxy`, and then only its last
 * entry: the address that the one trusted reverse proxy in front of this server
 * appended. Earlier entries come from the client and can be anything, so
 * trusting them (or trusting the header without a proxy) lets a client pick a
 * fresh rate-limit key for every request.
 */
export function getClientAddress(req: ClientRequest, trustProxy: boolean): string {
	if (trustProxy) {
		const header = req.headers['x-forwarded-for'];
		const forwarded = Array.isArray(header) ? header.join(',') : header;
		const last = parseList(forwarded).at(-1);
		if (last) return last;
	}
	return req.socket.remoteAddress ?? 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════

export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the client's window resets, when refused. */
	retryAfter?: number;
}

export interface RateLimiterOptions {
	/** Window length in milliseconds (default: one minute). */
	windowMs?: number;
	/** Most keys tracked at once; the oldest window is evicted beyond it (default: 10000). */
	maxKeys?: number;
	/** Clock, for tests. */
	now?: () => number;
}

/**
 * Fixed-window rate limiter with bounded memory.
 *
 * Expired windows are dropped when their key is seen again, by {@link sweep}
 * (call it on a timer), and whenever the map is full. If every tracked window
 * is still live, the oldest one is evicted, so memory never exceeds `maxKeys`
 * entries however many addresses a client rotates through.
 */
export class RateLimiter {
	private readonly windows = new Map<string, { count: number; resetAt: number }>();
	private readonly windowMs: number;
	private readonly maxKeys: number;
	private readonly now: () => number;

	constructor(options: RateLimiterOptions = {}) {
		this.windowMs = options.windowMs ?? 60_000;
		this.maxKeys = options.maxKeys ?? 10_000;
		this.now = options.now ?? Date.now;
		if (!Number.isSafeInteger(this.maxKeys) || this.maxKeys <= 0) {
			throw new Error('maxKeys must be a positive integer');
		}
	}

	/** Number of tracked keys. */
	get size(): number {
		return this.windows.size;
	}

	/** Count one request for `key` and decide whether it is within `limit`. */
	check(key: string, limit: number): RateLimitDecision {
		const now = this.now();
		const current = this.windows.get(key);

		if (current && current.resetAt > now) {
			if (current.count >= limit) {
				return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
			}
			current.count++;
			return { allowed: true };
		}

		// Re-insert so Map order stays oldest-window-first for eviction.
		this.windows.delete(key);
		if (this.windows.size >= this.maxKeys) {
			this.sweep();
			if (this.windows.size >= this.maxKeys) {
				const oldest = this.windows.keys().next();
				if (!oldest.done) this.windows.delete(oldest.value);
			}
		}
		this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
		return { allowed: true };
	}

	/** Drop expired windows. Returns how many were removed. */
	sweep(): number {
		const now = this.now();
		let removed = 0;
		for (const [key, window] of this.windows) {
			if (window.resetAt <= now) {
				this.windows.delete(key);
				removed++;
			}
		}
		return removed;
	}
}
