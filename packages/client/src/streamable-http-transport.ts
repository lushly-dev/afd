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

export interface StreamableHttpTransportOptions {
	headers?: Record<string, string>;
	clientName: string;
	clientVersion: string;
	/** Default `auto`: probe `server/discover`, fall back to `initialize`. */
	mode?: StreamableHttpMode;
	/** Answers form elicitations; without it the client declares no elicitation capability. */
	onElicitation?: ElicitationHandler;
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

	constructor(
		readonly url: string,
		private readonly options: StreamableHttpTransportOptions
	) {}

	async connect(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		this.disconnect();
		const mode = this.options.mode ?? 'auto';
		const onElicitation = this.options.onElicitation;
		const client = new Client(
			{ name: this.options.clientName, version: this.options.clientVersion },
			{
				capabilities: onElicitation ? { elicitation: { form: {} } } : {},
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
		this.connected = true;
	}

	disconnect(): void {
		const client = this.client;
		const wasConnected = this.connected;
		this.client = null;
		this.connected = false;
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
					})) as { resultType?: string; inputRequests?: unknown };
					result = called.resultType === 'input_required' ? inputRequiredResult(called) : called;
					break;
				}
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
