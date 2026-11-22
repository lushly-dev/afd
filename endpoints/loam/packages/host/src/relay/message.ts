/**
 * @fileoverview The relay's parse (phase 6 specification, 8.1 steps 5 to 8; A3): one JSON-RPC message, read strictly,
 * and only the fields the relay names, each checked for its type. Nothing here forwards anything: `decide.ts` decides
 * on what this reads, and `rebuild.ts` builds the one message that leaves.
 */

import { SCOPE_V1, type ScopeV1 } from '@lushly-dev/loam-kernel/mounted';
import { isRefusal, type RelayRefusal, refusal } from './refusals.js';

/** The six methods the relay accepts; `notifications/cancelled` is its own and never forwarded (step 17). */
export const ACCEPTED_METHODS = Object.freeze([
	'initialize',
	'server/discover',
	'notifications/initialized',
	'notifications/cancelled',
	'ping',
	'tools/call',
] as const);

export type AcceptedMethod = (typeof ACCEPTED_METHODS)[number];

const ACCEPTED: ReadonlySet<string> = new Set(ACCEPTED_METHODS);

/** A JSON-RPC id the relay takes: a string, or a safe integer. */
export type RpcId = string | number;

/** The modern era's `_meta` keys (MCP 2026-07-28), read and kept only as step 7 reads them. */
export const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
export const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
export const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';

/** The kernel's context field (phase 2 specification, 3.1). */
export const SCOPE_KEY = 'dev.loam/scope';

/** The meta-tools whose `arguments.meta` AFD lifts, and the relay reads scope from (`meta-argument.ts:65`). */
const META_LIFTED: ReadonlySet<string> = new Set(['afd-call', 'afd-detail']);

export interface ClientInfo {
	name: string;
	version: string;
}

/** What the relay read of one message, and nothing more. */
export interface ParsedMessage {
	method: AcceptedMethod;
	/** A request's id; a notification has none. */
	id?: RpcId;
	/** `tools/call`'s `params.name`. */
	name?: string;
	/** `tools/call`'s `params.arguments`, an object; `{}` when absent. */
	arguments?: Readonly<Record<string, unknown>>;
	/** `initialize`'s `params.protocolVersion` and `params.clientInfo`. */
	initialize?: { protocolVersion: string; clientInfo: ClientInfo };
	/** A modern-era request's protocol version and client, from `params._meta`. */
	modern?: { protocolVersion: string; clientInfo?: ClientInfo };
	/** `params._meta.progressToken`, when present. */
	progressToken?: RpcId;
	/** `notifications/cancelled`'s `params.requestId`. */
	cancelled?: RpcId;
	/** The message's scope (step 8), or none. */
	scope?: ScopeV1;
}

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is RpcId =>
	typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));

/** Whether a JSON value nests past `limit`, by a walk with no recursion. */
export function deeperThan(value: unknown, limit: number): boolean {
	const stack: Array<[unknown, number]> = [[value, 1]];
	while (stack.length > 0) {
		const [item, depth] = stack.pop() as [unknown, number];
		if (typeof item !== 'object' || item === null) continue;
		if (depth > limit) return true;
		for (const child of Object.values(item)) stack.push([child, depth + 1]);
	}
	return false;
}

function clientInfoOf(value: unknown): ClientInfo | undefined {
	if (!isRecord(value)) return undefined;
	const { name, version } = value;
	return typeof name === 'string' && typeof version === 'string' ? { name, version } : undefined;
}

const invalid = (message: string): RelayRefusal => refusal('REQUEST_INVALID', message);

/** One scope value, parsed with the kernel's strict `SCOPE_V1`, in this deployment's workspace; `null` is absent. */
function scopeOf(value: unknown, workspace: string): ScopeV1 | undefined | RelayRefusal {
	if (value === undefined || value === null) return undefined;
	const parsed = SCOPE_V1.safeParse(value);
	if (!parsed.success) return invalid('The scope is not a scope');
	if (parsed.data.workspace !== workspace)
		return invalid("The scope names another workspace than this server's");
	return parsed.data.project === undefined
		? { workspace: parsed.data.workspace }
		: { workspace: parsed.data.workspace, project: parsed.data.project };
}

const sameScope = (a: ScopeV1, b: ScopeV1) =>
	a.workspace === b.workspace && a.project === b.project;

/**
 * Steps 5 to 8 on a request body already bounded by `request_body_bytes` (step 5's `413` is the route's): the message,
 * or the refusal the first broken rule gives.
 */
export function parseMessage(
	body: string,
	options: { depth: number; workspace: string }
): ParsedMessage | RelayRefusal {
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		return invalid('The body is not JSON');
	}
	// Step 5: one message. MCP 2025-06-18 removed batching (A3).
	if (Array.isArray(value)) return refusal('MOUNT_BATCH_REFUSED', 'A JSON-RPC batch is refused');
	if (deeperThan(value, options.depth)) return invalid('The message nests too deeply');
	if (!isRecord(value) || value.jsonrpc !== '2.0')
		return invalid('The body is not one JSON-RPC message');
	// Step 6: the methods. A response from the page (no `method`) is a method the relay refuses.
	if (!('method' in value))
		return refusal('MOUNT_METHOD_REFUSED', 'The relay takes no JSON-RPC response from the page');
	const { method } = value;
	if (typeof method !== 'string') return invalid('The method is not a string');
	if (!ACCEPTED.has(method))
		return refusal('MOUNT_METHOD_REFUSED', 'The relay does not forward this method');
	const accepted = method as AcceptedMethod;
	const notification = accepted.startsWith('notifications/');
	const message: ParsedMessage = { method: accepted };
	if (notification) {
		if ('id' in value) return invalid('A notification carries no id');
	} else {
		if (!isId(value.id)) return invalid('A request needs a string or safe-integer id');
		message.id = value.id;
	}
	const params = value.params;
	if (params !== undefined && !isRecord(params)) return invalid('`params` is not an object');
	const meta = params?._meta;
	if (meta !== undefined && !isRecord(meta)) return invalid('`params._meta` is not an object');
	// Step 7: the fields the relay reads, each for its type.
	if (meta && 'progressToken' in meta) {
		if (!isId(meta.progressToken))
			return invalid('`progressToken` is not a string or safe integer');
		message.progressToken = meta.progressToken;
	}
	if (meta && PROTOCOL_VERSION_KEY in meta) {
		const version = meta[PROTOCOL_VERSION_KEY];
		if (typeof version !== 'string') return invalid('The protocol version is not a string');
		let clientInfo: ClientInfo | undefined;
		if (CLIENT_INFO_KEY in meta) {
			clientInfo = clientInfoOf(meta[CLIENT_INFO_KEY]);
			if (!clientInfo) return invalid('The client information is not `{ name, version }`');
		}
		message.modern = { protocolVersion: version, ...(clientInfo ? { clientInfo } : {}) };
	}
	switch (accepted) {
		case 'tools/call': {
			const { name, arguments: args } = params ?? {};
			if (typeof name !== 'string') return invalid('`params.name` is not a string');
			if (args !== undefined && !isRecord(args))
				return invalid('`params.arguments` is not an object');
			message.name = name;
			message.arguments = args ?? {};
			break;
		}
		case 'initialize': {
			const protocolVersion = params?.protocolVersion;
			const clientInfo = clientInfoOf(params?.clientInfo);
			if (typeof protocolVersion !== 'string' || !clientInfo)
				return invalid('`initialize` needs a protocol version and `{ name, version }`');
			message.initialize = { protocolVersion, clientInfo };
			break;
		}
		case 'server/discover':
			if (!message.modern) return invalid('`server/discover` needs the modern protocol version');
			break;
		case 'notifications/cancelled': {
			const requestId = params?.requestId;
			const reason = params?.reason;
			if (!isId(requestId)) return invalid('`requestId` is not a string or safe integer');
			if (reason !== undefined && typeof reason !== 'string')
				return invalid('`reason` is not a string');
			message.cancelled = requestId;
			break;
		}
		default:
			break;
	}
	// Step 8: the scope the message carries, from `_meta` and, for `afd-call` and `afd-detail` only, `arguments.meta`.
	const fromMeta = scopeOf(meta?.[SCOPE_KEY], options.workspace);
	if (isRefusal(fromMeta)) return fromMeta;
	let fromArguments: ScopeV1 | undefined;
	if (message.name !== undefined && META_LIFTED.has(message.name)) {
		const lifted = message.arguments?.meta;
		const read = isRecord(lifted) ? scopeOf(lifted[SCOPE_KEY], options.workspace) : undefined;
		if (isRefusal(read)) return read;
		fromArguments = read;
	}
	if (fromMeta && fromArguments && !sameScope(fromMeta, fromArguments))
		return invalid('The scope in `_meta` and in `arguments.meta` differ');
	const scope = fromMeta ?? fromArguments;
	if (scope) message.scope = scope;
	return message;
}
