/**
 * @fileoverview MCP protocol-era handling shared by the testing package's mock servers.
 *
 * The mock servers are dual-era, like AFD's own servers:
 *
 * - **Legacy (2025 and earlier):** `initialize` negotiates a version; the requested one is
 *   echoed when supported, otherwise the newest legacy revision is offered.
 * - **Modern (2026-07-28):** every request carries `_meta["io.modelcontextprotocol/protocolVersion"]`;
 *   `server/discover` advertises the server, and results carry `resultType` and `serverInfo`.
 */

/** The stateless MCP revision the mock servers serve. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/** `initialize`-era revisions the mock servers accept, newest first. */
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

/** JSON-RPC code for an unsupported protocol version (MCP 2026-07-28). */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export interface ServerIdentity {
	name: string;
	version: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** The `initialize` result's protocol version for the client's requested one. */
export function negotiateLegacyVersion(params: unknown): string {
	const requested = record(params)?.protocolVersion;
	return typeof requested === 'string' && LEGACY_PROTOCOL_VERSIONS.includes(requested)
		? requested
		: (LEGACY_PROTOCOL_VERSIONS[0] as string);
}

/**
 * The per-request protocol version of a modern request, or `undefined` for a legacy one.
 */
export function requestedModernVersion(params: unknown): string | undefined {
	const version = record(record(params)?._meta)?.[PROTOCOL_VERSION_KEY];
	return typeof version === 'string' ? version : undefined;
}

/** The JSON-RPC error for a modern request naming a revision the server does not serve. */
export function unsupportedVersionError(requested: string) {
	return {
		code: UNSUPPORTED_PROTOCOL_VERSION,
		message: 'Unsupported protocol version',
		data: { supported: [MODERN_PROTOCOL_VERSION], requested },
	};
}

/** The `server/discover` result. */
export function discoverResult(server: ServerIdentity, capabilities: Record<string, unknown>) {
	return {
		resultType: 'complete',
		supportedVersions: [MODERN_PROTOCOL_VERSION],
		capabilities,
		_meta: { [SERVER_INFO_KEY]: server },
		ttlMs: 0,
		cacheScope: 'private',
	};
}

/**
 * Stamp a result for a modern request: `resultType: "complete"`, `serverInfo` in `_meta`, and
 * the cache fields a `tools/list` result requires. Legacy results are returned unchanged.
 */
export function modernResult(
	method: string,
	result: unknown,
	server: ServerIdentity
): Record<string, unknown> {
	const body = record(result) ?? {};
	return {
		...body,
		resultType: 'complete',
		_meta: { ...record(body._meta), [SERVER_INFO_KEY]: server },
		...(method === 'tools/list' && { ttlMs: 0, cacheScope: 'private' }),
	};
}
