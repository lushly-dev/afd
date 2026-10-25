/**
 * @fileoverview Per-request `CommandContext` values from `createContext(req)`, shared by every
 * HTTP route (the legacy `/message` lane, `/rpc`, `/batch`, `/stream` and the `/mcp` endpoint).
 */

import type { IncomingMessage } from 'node:http';
import type { CreateRequestContext } from './server-types.js';

/** CommandContext keys the server sets itself; `createContext` cannot override them. */
export const RESERVED_CONTEXT_KEYS = new Set(['traceId', 'signal', 'interface']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The values `createContext` returns for `req`, without the reserved keys.
 *
 * @throws Error when `createContext` throws or returns something other than an object
 */
export async function requestContextValues(
	createContext: CreateRequestContext | undefined,
	req: IncomingMessage
): Promise<Record<string, unknown>> {
	const extra: unknown = createContext ? await createContext(req) : {};
	if (!isRecord(extra)) throw new Error('createContext must return an object');
	return Object.fromEntries(
		Object.entries(extra).filter(([key]) => !RESERVED_CONTEXT_KEYS.has(key))
	);
}
