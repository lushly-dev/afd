/**
 * @fileoverview The desktop's inbound MCP dispatcher (phase 6 specification, 10.8; D137 to D139), at
 * `@lushly-dev/loam-kernel/inbound`. It loads in stage B on the desktop, never in first paint.
 *
 * The Rust host passes each JSON-RPC message the loopback endpoint accepted to the page; this answers it. It speaks
 * `initialize`, `ping`, `tools/list` and `tools/call`, and answers anything else, `server/discover` included, with
 * JSON-RPC's method-not-found, so AFD's client falls back to `initialize`. **The tools are proxies:** a direct registry
 * built with `interface: 'mcp'` and `createDirectToolSurface()`, whose entries carry the kernel's names, schemas and
 * metadata, and whose handlers call the kernel's agent interface as the agent `loam-inbound` with the scope from
 * `_meta` (phase 2's 9.2). The tools, the meta-tools and their descriptions are what an AFD MCP server lists, and every
 * call takes the kernel's own path: its queue, phase 3's rules, the autonomy gate and confirmations (phase 5's 6.1,
 * phase 4's 7.2), and the journal.
 *
 * **What it serves** (D138): a shell command in {@link DESKTOP_MCP_COMMANDS}, and an app's own command, native or
 * view, whose definition sets `expose.mcp: true`, each registered and exposed to the agent interface, as 10.8's "app
 * commands" reads. Never a mounted instance's command, page state, or a human, owner, session or internal command.
 * `SHELL_EXPOSE` does not change.
 */

import { type CommandResult, failure } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	createDirectRegistry,
	createDirectToolSurface,
	type DirectCommandRegistry,
} from '@lushly-dev/afd-server/direct';
import { SCOPE_FIELD } from '../scope/field.js';
import type { CallOptions, LoamKernel, ScopeV1 } from '../types.js';

/** The actor every inbound client runs as (10.8): one agent, which the journal records. */
export const INBOUND_AGENT = 'loam-inbound';

/**
 * The shell commands the desktop serves inbound (D138): section 7's `HOSTED_MCP_COMMANDS`, the documents commands but
 * `document-open`, since the records are in this webview, and, from phase 5's step 3, `confirmation-get` and
 * `confirmation-withdraw` for the confirmations `loam-inbound` raised. `loam-host`'s unit holds that it contains the
 * hosted list.
 */
export const DESKTOP_MCP_COMMANDS = Object.freeze([
	// Section 7's hosted list.
	'shell-info-get',
	'workspace-get',
	'workspace-app-list',
	'app-list',
	'app-get',
	'project-list',
	'project-get',
	'project-create',
	'project-update',
	'project-archive',
	'project-restore',
	'account-get',
	'persona-list',
	'member-list',
	'agent-member-list',
	'agent-member-get',
	// The documents, in this webview.
	'document-list',
	'document-get',
	'document-create',
	'document-update',
	'document-rename',
	'document-move',
	'document-trash',
	'document-restore',
	'document-import',
	'document-export',
	'document-link-add',
	'document-link-list',
	'document-link-remove',
	'document-type-list',
	'new-list',
	'project-summary-get',
	// Phase 5's step 3: the confirmations an inbound call raised.
	'confirmation-get',
	'confirmation-withdraw',
	// Phase 5's step 10 (D170): what changed since a cursor, as `loam-inbound` may read it.
	'event-list',
] as const);

/**
 * The protocol revision `initialize` answers: the one AFD's own handler answers on its 2025 lane
 * (`packages/server/src/http-handler.ts`), which every client AFD's SDK supports.
 */
export const INBOUND_PROTOCOL_VERSION = '2024-11-05';

/** The kernel's commands behind its agent interface, as `KernelParts.inboundCommands()` gives them. */
export interface InboundCommandsV1 {
	/** The shell's, exposed to the agent interface. */
	shell: readonly ZodCommandDefinition[];
	/** Each app's own commands, native or view, exposed to the agent interface; never a mounted instance's. */
	apps: readonly ZodCommandDefinition[];
}

export interface InboundSourceV1 {
	/** The kernel's agent interface, which every proxy calls. */
	agent: Pick<LoamKernel['agent'], 'call'>;
	/** The same object until the kernel's command set changes. */
	commands(): InboundCommandsV1;
}

export interface InboundDispatcherOptions {
	/** `initialize`'s `serverInfo`. */
	serverInfo?: { name: string; version: string };
}

/** A JSON-RPC response the dispatcher sends back. */
export type InboundResponseV1 =
	| { jsonrpc: '2.0'; id: string | number | null; result: unknown }
	| {
			jsonrpc: '2.0';
			id: string | number | null;
			error: { code: number; message: string; data?: unknown };
	  };

export interface InboundDispatcherV1 {
	/** The answer to one message, or `undefined` for a notification, which has none. */
	handle(message: unknown): Promise<InboundResponseV1 | undefined>;
	/** The served commands' names, in the registry's order, for tests and the record. */
	served(): string[];
}

const shellServed: ReadonlySet<string> = new Set(DESKTOP_MCP_COMMANDS);

/** The served definitions (D138): the shell's in the list, then the apps' own MCP-exposed ones. */
export function servedCommands(commands: InboundCommandsV1): ZodCommandDefinition[] {
	return [
		...commands.shell.filter((command) => shellServed.has(command.name)),
		...commands.apps.filter((command) => command.expose?.mcp === true),
	];
}

/** As AFD's server wraps a result as tool content: compact JSON text, and the object as structured content. */
function toolResult(data: unknown, isError: boolean) {
	return {
		content: [{ type: 'text', text: JSON.stringify(data) }],
		...(data !== null && typeof data === 'object' ? { structuredContent: data } : {}),
		isError,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type JsonRpcId = string | number | null;

function errorResponse(
	id: JsonRpcId,
	code: number,
	message: string,
	data?: unknown
): InboundResponseV1 {
	return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** A proxy of `command`: its name, schema and metadata, served over MCP, its handler the kernel's agent interface. */
function proxy(command: ZodCommandDefinition, source: InboundSourceV1): ZodCommandDefinition {
	return {
		...command,
		expose: { ...command.expose, mcp: true },
		handler: async (input: unknown, context: { scope?: ScopeV1 }) => {
			const options: CallOptions = {
				agent: INBOUND_AGENT,
				// No scope in `_meta` is the workspace, as on the hosted server, never what the person has open.
				scope: context.scope ?? 'workspace',
			};
			return source.agent.call(command.name, input, options);
		},
	} as ZodCommandDefinition;
}

/**
 * The dispatcher over `source`. Its registry is built again whenever the kernel's command set changes, so an app's
 * commands come and go with it.
 */
export function createInboundDispatcher(
	source: InboundSourceV1,
	options: InboundDispatcherOptions = {}
): InboundDispatcherV1 {
	const serverInfo = options.serverInfo ?? { name: 'loam-desktop', version: '0.1.0' };
	let built:
		| { from: InboundCommandsV1; registry: DirectCommandRegistry; names: string[] }
		| undefined;

	function registry(): { registry: DirectCommandRegistry; names: string[] } {
		const from = source.commands();
		if (built?.from !== from) {
			const served = servedCommands(from);
			built = {
				from,
				registry: createDirectRegistry(
					served.map((command) => proxy(command, source)),
					{ interface: 'mcp', contextFields: [SCOPE_FIELD], tools: createDirectToolSurface() }
				),
				names: served.map((command) => command.name),
			};
		}
		return built;
	}

	async function callTool(id: JsonRpcId, params: unknown): Promise<InboundResponseV1> {
		if (!isRecord(params) || typeof params.name !== 'string') {
			return errorResponse(id, -32602, 'tools/call needs params.name, a string');
		}
		const args = params.arguments ?? {};
		if (!isRecord(args)) {
			return errorResponse(id, -32602, 'tools/call params.arguments must be an object');
		}
		const meta = params._meta;
		if (meta !== undefined && !isRecord(meta)) {
			return errorResponse(id, -32602, 'tools/call params._meta must be an object');
		}
		// The declared field alone (`dev.loam/scope`); the registry checks it against its schema.
		const scope = meta?.[SCOPE_FIELD.meta];
		let result: CommandResult;
		try {
			result = await registry().registry.execute(
				params.name,
				args,
				scope === undefined ? {} : { scope }
			);
		} catch (cause) {
			result = failure({
				code: 'COMMAND_FAILED',
				message: cause instanceof Error ? cause.message : String(cause),
				suggestion: 'Retry the call; if it persists, reload Loam',
			});
		}
		// As AFD's router decides it: a pipeline by its steps, everything else by `success`.
		const steps = isRecord(result) ? (result as { steps?: unknown }).steps : undefined;
		const isError = Array.isArray(steps)
			? steps.some((step) => isRecord(step) && step.status === 'failure')
			: isRecord(result) && result.success === false;
		return { jsonrpc: '2.0', id, result: toolResult(result, isError) };
	}

	return {
		served: () => [...registry().names],
		async handle(message) {
			if (!isRecord(message) || typeof message.method !== 'string') {
				const id = isRecord(message) ? message.id : undefined;
				return id === undefined
					? undefined
					: errorResponse(
							typeof id === 'string' || typeof id === 'number' ? id : null,
							-32600,
							'Send one JSON-RPC request'
						);
			}
			// A notification has no answer (`notifications/initialized`, `notifications/cancelled`).
			if (!('id' in message)) return undefined;
			const id = message.id;
			if (typeof id !== 'string' && typeof id !== 'number') {
				return errorResponse(null, -32600, 'A request id is a string or a number');
			}
			try {
				return await answer(id, message.method, message.params);
			} catch (cause) {
				// Never a request left unanswered: the client would wait out the host's 60 s.
				return errorResponse(id, -32603, 'Loam could not answer', {
					code: 'COMMAND_FAILED',
					message: cause instanceof Error ? cause.message : String(cause),
					suggestion: 'Retry the call; if it persists, reload Loam',
				});
			}
		},
	};

	async function answer(
		id: string | number,
		method: string,
		params: unknown
	): Promise<InboundResponseV1> {
		switch (method) {
			case 'initialize':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: INBOUND_PROTOCOL_VERSION,
						capabilities: { tools: {} },
						serverInfo,
					},
				};
			case 'ping':
				return { jsonrpc: '2.0', id, result: {} };
			case 'tools/list':
				return { jsonrpc: '2.0', id, result: { tools: registry().registry.listTools() } };
			case 'tools/call':
				return callTool(id, params);
			default:
				return errorResponse(id, -32601, `Method not found: ${method.slice(0, 64)}`);
		}
	}
}
