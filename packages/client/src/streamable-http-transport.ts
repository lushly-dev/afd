/**
 * @fileoverview MCP Streamable HTTP transport, built on the official MCP TypeScript SDK v2 client.
 *
 * It speaks MCP 2026-07-28 (stateless, per-request `_meta`) to servers that offer it, found by a
 * `server/discover` probe, and falls back to the 2025 `initialize` handshake otherwise. That
 * covers AFD servers' `/mcp` endpoint, the Python and Rust AFD servers, and any server built on
 * an official MCP SDK.
 *
 * `McpClient` speaks JSON-RPC to its transports, so `send()` maps the requests it makes
 * (`initialize`, `tools/list`, `tools/call`) onto the SDK client. `initialize` is answered
 * locally from what negotiation learned: there is no handshake on the modern protocol.
 */

import type { McpInitializeResult, McpRequest, McpResponse } from '@lushly-dev/afd-core';
import {
	Client,
	ProtocolError,
	StreamableHTTPClientTransport as SdkHttpTransport,
} from '@modelcontextprotocol/client';
import { raceWithAbort } from './request-abort.js';
import type { Transport } from './transport.js';
import type { ElicitationHandler } from './types.js';

/** How the transport negotiates the protocol revision. */
export type StreamableHttpMode = 'auto' | 'legacy' | 'modern';

/** The MCP revision `mode: 'modern'` requires. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * Never let the SDK time a request out: `McpClient` owns timeouts and aborts the request
 * through its signal.
 */
const NO_SDK_TIMEOUT = 2_147_483_647;

const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const TASK_SENTINEL = '__afd_mcp_task__';
const PASS_THROUGH_SCHEMA = {
	'~standard': {
		version: 1,
		vendor: 'afd',
		validate: (value: unknown) => ({ value }),
	},
} as const;

export interface StreamableHttpTransportOptions {
	headers?: Record<string, string>;
	clientName: string;
	clientVersion: string;
	/** Default `auto`: probe `server/discover`, fall back to `initialize`. */
	mode?: StreamableHttpMode;
	/** Answers form elicitations; without it the client declares no elicitation capability. */
	onElicitation?: ElicitationHandler;
	/** Declare the MCP Tasks extension (`io.modelcontextprotocol/tasks`) on modern requests. */
	tasks?: boolean;
	/**
	 * The `fetch` every request goes through. A host that does not trust the server uses it to limit
	 * what it reads, since the SDK reads a response whole and holds an event stream open with no deadline.
	 */
	fetch?: typeof fetch;
}

/**
 * The tool result for an `input_required` answer the client cannot fulfil: an `INPUT_REQUIRED`
 * failure carrying what the server asked.
 */
function inputRequiredResult(result: { inputRequests?: unknown }) {
	const failure = {
		success: false,
		error: {
			code: 'INPUT_REQUIRED',
			message: 'The server needs input from the user before it can run this call',
			suggestion:
				'Create the client with onElicitation to answer the server, or use a client that supports elicitation',
			retryable: false,
		},
		data: { inputRequests: result.inputRequests ?? {} },
	};
	return {
		content: [{ type: 'text', text: JSON.stringify(failure) }],
		structuredContent: failure,
		isError: true,
	};
}

export class StreamableHttpTransport implements Transport {
	private client: Client | null = null;
	private connected = false;
	private messageHandler: ((response: McpResponse) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private readonly pendingTasks = new Map<string, Record<string, unknown>>();

	constructor(
		readonly url: string,
		private readonly options: StreamableHttpTransportOptions
	) {}

	async connect(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		this.disconnect();
		const mode = this.options.mode ?? 'auto';
		const onElicitation = this.options.onElicitation;
		const capabilities: Record<string, unknown> = {};
		if (onElicitation) capabilities.elicitation = { form: {} };
		if (this.options.tasks) capabilities.extensions = { [TASKS_EXTENSION_ID]: {} };
		const client = new Client(
			{ name: this.options.clientName, version: this.options.clientVersion },
			{
				capabilities: capabilities as never,
				versionNegotiation: { mode: mode === 'modern' ? { pin: MODERN_PROTOCOL_VERSION } : mode },
				// Without a handler, an input_required answer is returned to `send` as is.
				...(!onElicitation && { inputRequired: { autoFulfill: false } }),
			}
		);
		if (onElicitation) {
			client.setRequestHandler('elicitation/create', async (request) => {
				const params = request.params as { message?: string; requestedSchema?: unknown };
				return (await onElicitation({
					message: params.message ?? '',
					requestedSchema: (params.requestedSchema ?? {}) as Record<string, unknown>,
				})) as never;
			});
		}
		const transport = new SdkHttpTransport(new URL(this.url), {
			...(this.options.headers && { requestInit: { headers: this.options.headers } }),
			...(this.options.fetch && { fetch: this.options.fetch }),
		});
		client.onerror = (error) => {
			if (this.client === client) this.errorHandler?.(error);
		};
		client.onclose = () => {
			if (this.client !== client || !this.connected) return;
			this.connected = false;
			this.closeHandler?.();
		};
		this.client = client;
		try {
			await (signal
				? raceWithAbort(signal, () => client.connect(transport))
				: client.connect(transport));
		} catch (error) {
			if (this.client === client) this.client = null;
			await client.close().catch(() => {});
			throw error;
		}
		if (this.client !== client) {
			await client.close().catch(() => {});
			throw new Error('Transport disconnected');
		}
		if (this.options.tasks) {
			// The MCP SDK v2.4.0 rev2026 codec rejects `resultType: 'task'` on `tools/call`.
			// Intercept it on the transport boundary and carry it to `send()` via a private token.
			const deliver = transport.onmessage;
			transport.onmessage = (message) => {
				const msg = message as { id?: string | number; result?: Record<string, unknown> };
				if (
					msg &&
					typeof msg === 'object' &&
					'result' in msg &&
					msg.result &&
					typeof msg.result === 'object'
				) {
					if (msg.result.resultType === 'task') {
						const token = crypto.randomUUID();
						this.pendingTasks.set(token, msg.result);
						deliver?.({
							jsonrpc: '2.0',
							id: msg.id as string | number,
							result: {
								resultType: 'complete',
								content: [],
								_meta: { [TASK_SENTINEL]: token },
							},
						} as never);
						return;
					}
					const meta = msg.result._meta as Record<string, unknown> | undefined;
					if (meta && typeof meta === 'object' && TASK_SENTINEL in meta) {
						const { [TASK_SENTINEL]: _stripped, ...restMeta } = meta;
						deliver?.({
							...msg,
							result: { ...msg.result, _meta: restMeta },
						} as never);
						return;
					}
				}
				deliver?.(message);
			};
		}
		this.connected = true;
	}

	disconnect(): void {
		const client = this.client;
		const wasConnected = this.connected;
		this.client = null;
		this.connected = false;
		this.pendingTasks.clear();
		client?.close().catch(() => {});
		if (wasConnected) this.closeHandler?.();
	}

	/** The negotiated protocol revision, such as `2026-07-28` or `2025-11-25`. */
	get protocolVersion(): string | undefined {
		return this.client?.getNegotiatedProtocolVersion();
	}

	/** `modern` for 2026-07-28 and later, `legacy` for the `initialize` handshake. */
	get protocolEra(): 'modern' | 'legacy' | undefined {
		return this.client?.getProtocolEra();
	}

	async send(request: McpRequest, signal?: AbortSignal): Promise<McpResponse> {
		const client = this.client;
		if (!client || !this.connected) throw new Error('Transport not connected');
		const options = { signal, timeout: NO_SDK_TIMEOUT };
		let result: unknown;
		try {
			switch (request.method) {
				case 'initialize':
					result = this.initializeResult(client);
					break;
				case 'tools/list':
					result = await client.listTools(request.params as never, options);
					break;
				case 'tools/call': {
					const called = (await client.callTool(request.params as never, {
						...options,
						...(!this.options.onElicitation && { allowInputRequired: true }),
					})) as { resultType?: string; inputRequests?: unknown; _meta?: Record<string, unknown> };
					const taskToken = called._meta?.[TASK_SENTINEL];
					if (typeof taskToken === 'string') {
						const taskResult = this.pendingTasks.get(taskToken);
						this.pendingTasks.delete(taskToken);
						result = taskResult ?? called;
					} else {
						result = called.resultType === 'input_required' ? inputRequiredResult(called) : called;
					}
					break;
				}
				case 'tasks/get':
				case 'tasks/update':
				case 'tasks/cancel':
				// Resources (spec/mcp-resources.md, R3 and R4), such as an MCP Apps `ui://` view.
				case 'resources/list':
				case 'resources/read':
				// The Skills extension (spec/mcp-resources.md, S3 and S4).
				case 'skills/list':
				case 'skills/get':
					result = await client.request(
						{ method: request.method, params: request.params as Record<string, unknown> },
						PASS_THROUGH_SCHEMA as never,
						options
					);
					break;
				default:
					return {
						jsonrpc: '2.0',
						id: request.id,
						error: {
							code: -32601,
							message: `Method not supported by the streamable-http transport: ${request.method}`,
						},
					};
			}
		} catch (error) {
			if (error instanceof ProtocolError) {
				return {
					jsonrpc: '2.0',
					id: request.id,
					error: {
						code: error.code,
						message: error.message,
						...(error.data !== undefined && { data: error.data }),
					},
				};
			}
			throw error;
		}
		const response: McpResponse = { jsonrpc: '2.0', id: request.id, result };
		this.messageHandler?.(response);
		return response;
	}

	isConnected(): boolean {
		return this.connected;
	}

	onMessage(handler: (response: McpResponse) => void): void {
		this.messageHandler = handler;
	}

	onError(handler: (error: Error) => void): void {
		this.errorHandler = handler;
	}

	onClose(handler: () => void): void {
		this.closeHandler = handler;
	}

	private initializeResult(client: Client): McpInitializeResult & { instructions?: string } {
		const instructions = client.getInstructions();
		return {
			protocolVersion: client.getNegotiatedProtocolVersion() ?? '',
			capabilities: (client.getServerCapabilities() ?? {}) as McpInitializeResult['capabilities'],
			serverInfo: {
				name: client.getServerVersion()?.name ?? '',
				version: client.getServerVersion()?.version ?? '',
			},
			...(instructions && { instructions }),
		};
	}
}
