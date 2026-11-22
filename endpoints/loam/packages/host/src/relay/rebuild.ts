/**
 * @fileoverview The relay's rebuild (phase 6 specification, 8.1 steps 12 to 14; A3): the one message the relay sends,
 * its own serialization of `{ jsonrpc, id, method, params }` with `params` built only from its decisions, and the
 * request headers it sets. No field, `_meta` key or header of the page's passes unless a rule here names it.
 */

import type { Decision } from './decide.js';
import {
	CLIENT_CAPABILITIES_KEY,
	CLIENT_INFO_KEY,
	isRecord,
	type ParsedMessage,
	PROTOCOL_VERSION_KEY,
	SCOPE_KEY,
} from './message.js';

export interface RebuiltMessage {
	method: string;
	/** The message as JSON, the relay's own serialization. */
	body: string;
	/** `params.name` of a forwarded `tools/call`, for `Mcp-Name`. */
	name?: string;
	/** The `MCP-Protocol-Version` of a modern-era request, from its rebuilt `_meta`. */
	modernVersion?: string;
}

/** Step 13: `_meta` rebuilt from what step 7 read and the scope the relay decided, or none when it holds nothing. */
function metaOf(
	message: ParsedMessage,
	scope: object | undefined
): Record<string, unknown> | undefined {
	const meta: Record<string, unknown> = {};
	if (scope) meta[SCOPE_KEY] = scope;
	if (message.progressToken !== undefined) meta.progressToken = message.progressToken;
	if (message.modern) {
		meta[PROTOCOL_VERSION_KEY] = message.modern.protocolVersion;
		if (message.modern.clientInfo) meta[CLIENT_INFO_KEY] = { ...message.modern.clientInfo };
		// The page declares no capability (phase 1), and the relay answers no server request (step 15).
		meta[CLIENT_CAPABILITIES_KEY] = {};
	}
	return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * `params` for a forwarded `tools/call` (step 12's table, as step 6 amended it). **Every command is forwarded as
 * `afd-call` with its exact name**, a first-class one too: AFD's router reads a bare tool name by its own strategy
 * (`tool-router.ts`), so an instance that changed from `hybrid` to `grouped` after the relay's discovery would route a
 * bare `notes` to another command; `afd-call` runs exactly the command named (the trust review, Astra). It reads an
 * acknowledgement only from its own top-level `confirm`, which the relay never sets, so a command's `confirm` is data
 * and nothing is acknowledged; the page's top-level `confirm` on a bare first-class call is dropped, as AFD would read it
 * there as the acknowledgement of a `confirmPrompt`.
 */
function toolParams(
	decision: Extract<Decision, { kind: 'discovery' | 'command' }>,
	meta: Record<string, unknown> | undefined
): { name: string; params: Record<string, unknown> } {
	const withMeta = (params: Record<string, unknown>) =>
		meta ? { ...params, _meta: meta } : params;
	if (decision.kind === 'discovery')
		return {
			name: decision.tool,
			params: withMeta({ name: decision.tool, arguments: decision.arguments }),
		};
	const { command, input, via } = decision;
	const declaresConfirm =
		isRecord(command.inputSchema) &&
		isRecord(command.inputSchema.properties) &&
		Object.hasOwn(command.inputSchema.properties, 'confirm');
	const { confirm: _dropped, ...rest } = input;
	const kept = via === 'first-class' && !declaresConfirm ? rest : { ...input };
	return {
		name: 'afd-call',
		params: withMeta({ name: 'afd-call', arguments: { command: command.tool, input: kept } }),
	};
}

/** Step 12: the message the relay sends for `message`, which the relay decided as `decision`. */
export function rebuildMessage(message: ParsedMessage, decision: Decision): RebuiltMessage {
	const scope = decision.kind === 'command' ? decision.scope : undefined;
	const meta = metaOf(message, scope);
	const envelope = (params: Record<string, unknown> | undefined): string =>
		JSON.stringify({
			jsonrpc: '2.0',
			...(message.id !== undefined ? { id: message.id } : {}),
			method: message.method,
			...(params ? { params } : {}),
		});
	const modernVersion = message.modern?.protocolVersion;
	const shared = modernVersion !== undefined ? { modernVersion } : {};
	switch (message.method) {
		case 'tools/call': {
			const tool = toolParams(
				decision as Extract<Decision, { kind: 'discovery' | 'command' }>,
				meta
			);
			return { method: message.method, body: envelope(tool.params), name: tool.name, ...shared };
		}
		case 'initialize': {
			const { protocolVersion, clientInfo } = message.initialize as NonNullable<
				ParsedMessage['initialize']
			>;
			return {
				method: message.method,
				body: envelope({ protocolVersion, clientInfo: { ...clientInfo }, capabilities: {} }),
				...shared,
			};
		}
		case 'server/discover':
			return { method: message.method, body: envelope(meta ? { _meta: meta } : {}), ...shared };
		case 'ping':
			return {
				method: message.method,
				body: envelope(message.modern && meta ? { _meta: meta } : undefined),
				...shared,
			};
		case 'notifications/initialized':
			return { method: message.method, body: envelope(undefined), ...shared };
		default:
			// `notifications/cancelled` is the relay's own (step 17), and nothing else reaches here.
			throw new Error(`The relay forwards no ${message.method}`);
	}
}

/** Step 14's headers: the relay's own, none of the page's. The HTTP client adds only its framing. */
export function requestHeaders(options: {
	rebuilt: RebuiltMessage;
	/** The deployer's bearer for this instance (section 13), never the page's. */
	bearer?: string;
	/** A legacy-era session's id and the version its `initialize` answer named (step 16). */
	session?: { id: string; protocolVersion?: string };
	/** The page's `MCP-Protocol-Version`, for a stateless legacy-era instance, when the client SDK supports it. */
	statelessVersion?: string;
}): Record<string, string> {
	const { rebuilt, bearer, session, statelessVersion } = options;
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		'accept-encoding': 'identity',
		'mcp-method': rebuilt.method,
	};
	if (rebuilt.name !== undefined) headers['mcp-name'] = rebuilt.name;
	const version =
		rebuilt.modernVersion ??
		(session
			? session.protocolVersion
			: rebuilt.method === 'initialize'
				? undefined
				: statelessVersion);
	if (version !== undefined) headers['mcp-protocol-version'] = version;
	// An `initialize` starts a session, so it never carries one (step 14).
	if (session && rebuilt.method !== 'initialize') headers['mcp-session-id'] = session.id;
	if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
	return headers;
}
