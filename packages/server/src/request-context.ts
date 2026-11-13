/**
 * @fileoverview Per-request `CommandContext` values from `createContext(req)`, shared by every
 * HTTP route (the legacy `/message` lane, `/rpc`, `/batch`, `/stream` and the `/mcp` endpoint).
 */

import type { IncomingMessage } from 'node:http';
import { credentialsActor } from './mcp-auth.js';
import type { Credentials } from './mcp-auth-rules.js';
import type { CreateRequestContext } from './server-types.js';

/** CommandContext keys the server sets itself; `createContext` cannot override them. */
export const RESERVED_CONTEXT_KEYS = new Set(['traceId', 'signal', 'interface']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The values `createContext` returns for `req`, without the reserved keys.
 *
 * With `credentials` (a request the server's MCP authorization verified), `createContext` is
 * given them, its own `credentials` are replaced by them (only the server sets them, M4), and
 * the actor is the one it returns or, without one, `{ kind: 'agent', id: <clientId>,
 * onBehalfOf: <subject> }`.
 *
 * @throws Error when `createContext` throws or returns something other than an object
 */
export async function requestContextValues(
	createContext: CreateRequestContext | undefined,
	req: IncomingMessage,
	credentials?: Credentials
): Promise<Record<string, unknown>> {
	const extra: unknown = createContext
		? await createContext(req, credentials ? { credentials } : {})
		: {};
	if (!isRecord(extra)) throw new Error('createContext must return an object');
	const values = Object.fromEntries(
		Object.entries(extra).filter(([key]) => !RESERVED_CONTEXT_KEYS.has(key))
	);
	if (!credentials) return values;
	return { ...values, credentials, actor: values.actor ?? credentialsActor(credentials) };
}
