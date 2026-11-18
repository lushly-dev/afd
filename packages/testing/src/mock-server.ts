/**
 * @fileoverview Mock MCP server for testing
 *
 * This creates an in-memory MCP server that can be used for testing
 * without needing a real server.
 */

import { isDeepStrictEqual } from 'node:util';
import type {
	BatchRequest,
	CommandContext,
	CommandDefinition,
	CommandResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolsListResult,
} from '@lushly-dev/afd-core';
import {
	commandToMcpTool,
	createMcpErrorResponse,
	createMcpResponse,
	executeBatch,
	failure,
	McpErrorCodes,
	textContent,
} from '@lushly-dev/afd-core';
import {
	createDirectRegistry,
	type DirectCommandRegistry,
	type DirectRegistryOptions,
	type ZodCommandDefinition,
	zodToJsonSchema,
} from '@lushly-dev/afd-server/direct';
import { z } from 'zod';
import {
	discoverResult,
	MODERN_PROTOCOL_VERSION,
	modernResult,
	negotiateLegacyVersion,
	requestedModernVersion,
	unsupportedVersionError,
} from './mcp/protocol.js';

/** Name of the built-in batch tool, as on the real server. */
const BATCH_TOOL = 'afd-batch';

/**
 * Options for {@link MockMcpServer}.
 */
export interface MockServerOptions extends Omit<DirectRegistryOptions, 'interface' | 'tools'> {}

/** Keep parameter-based helpers working alongside production Zod command definitions. */
function serverCommand(command: CommandDefinition | ZodCommandDefinition): ZodCommandDefinition {
	if ('inputSchema' in command) return command;
	const jsonSchema = commandToMcpTool(command).inputSchema;
	return {
		...command,
		jsonSchema,
		// Core definitions have no runtime Zod schema. Preserve their historical passthrough;
		// production validation requires the original definition from defineCommand().
		inputSchema: z.unknown(),
		outputJsonSchema: command.returns,
		toCommandDefinition: () => command,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toolResponse(request: McpRequest, result: CommandResult): McpResponse {
	return createMcpResponse(request.id, {
		content: [textContent(JSON.stringify(result))],
		isError: !result.success,
	});
}

/**
 * Mock MCP server for testing.
 *
 * Runs commands through the production server engine (validation, middleware,
 * context scoping and error handling), with an in-process MCP envelope:
 * - only commands with `expose.mcp: true` are listed, and calling any other
 *   command returns `COMMAND_NOT_EXPOSED`;
 * - `tools/call` with the built-in `afd-batch` tool runs a batch through the
 *   shared core executor: malformed envelopes are rejected before anything
 *   runs, `options.timeout` is a deadline at any `parallelism`, and every
 *   entry is exposure-checked;
 * - handler exceptions are reported without their message or stack unless
 *   `devMode` is set.
 *
 * Commands built with `createMockCommand()`, `createSuccessCommand()` or
 * `createFailureCommand()` are exposed to MCP.
 */
export class MockMcpServer {
	private registry: DirectCommandRegistry;
	private commands: ZodCommandDefinition[];
	private options: MockServerOptions;
	private serverInfo = {
		name: 'MockMcpServer',
		version: '0.1.0',
	};
	private requestLog: Array<{ request: McpRequest; response: McpResponse }> = [];

	constructor(
		commands: Array<CommandDefinition | ZodCommandDefinition> = [],
		options: MockServerOptions = {}
	) {
		this.commands = commands.map(serverCommand);
		this.options = { ...options, actor: options.actor ?? { kind: 'agent' } };
		this.registry = createDirectRegistry(this.commands, { ...this.options, interface: 'mcp' });
	}

	/**
	 * Register a command on the mock server.
	 */
	register(command: ZodCommandDefinition): void;
	register<TInput = unknown, TOutput = unknown>(command: CommandDefinition<TInput, TOutput>): void;
	register(command: CommandDefinition | ZodCommandDefinition): void {
		const commands = [...this.commands, serverCommand(command)];
		// Build before replacing state, so a duplicate registration leaves the server usable.
		const registry = createDirectRegistry(commands, { ...this.options, interface: 'mcp' });
		this.commands = commands;
		this.registry = registry;
	}

	/**
	 * Process an MCP request and return a response.
	 */
	async handleRequest(request: McpRequest): Promise<McpResponse> {
		let response: McpResponse;

		try {
			const modern = requestedModernVersion(request.params);
			if (modern !== undefined && modern !== MODERN_PROTOCOL_VERSION) {
				const error = unsupportedVersionError(modern);
				response = createMcpErrorResponse(request.id, error.code, error.message, error.data);
				this.requestLog.push({ request, response });
				return response;
			}
			switch (request.method) {
				case 'initialize':
					response = this.handleInitialize(request);
					break;

				case 'server/discover':
					response = this.handleDiscover(request);
					break;

				case 'tools/list':
					response = this.handleToolsList(request);
					break;

				case 'tools/call':
					response = await this.handleToolsCall(request);
					break;

				default:
					response = createMcpErrorResponse(
						request.id,
						McpErrorCodes.METHOD_NOT_FOUND,
						`Method not found: ${request.method}`
					);
			}
			if (modern !== undefined && request.method !== 'server/discover' && !response.error) {
				response = {
					...response,
					result: modernResult(request.method, response.result, this.serverInfo),
				};
			}
		} catch (error) {
			response = createMcpErrorResponse(
				request.id,
				McpErrorCodes.INTERNAL_ERROR,
				error instanceof Error ? error.message : String(error)
			);
		}

		this.requestLog.push({ request, response });
		return response;
	}

	/**
	 * Get the request log.
	 */
	getRequestLog(): Array<{ request: McpRequest; response: McpResponse }> {
		return [...this.requestLog];
	}

	/**
	 * Clear the request log.
	 */
	clearRequestLog(): void {
		this.requestLog = [];
	}

	/**
	 * Get the tools an MCP client can see: registered commands with `expose.mcp: true`.
	 */
	getTools(activeContext?: string): McpTool[] {
		return this.commands
			.filter(
				(command) =>
					this.registry.hasCommand(command.name) &&
					(!activeContext || !command.contexts?.length || command.contexts.includes(activeContext))
			)
			.map((command) => ({
				...commandToMcpTool(command.toCommandDefinition()),
				inputSchema: command.jsonSchema as McpTool['inputSchema'],
			}));
	}

	/**
	 * Reset server state.
	 */
	reset(): void {
		this.requestLog = [];
	}

	private handleInitialize(request: McpRequest): McpResponse {
		return createMcpResponse(request.id, {
			protocolVersion: negotiateLegacyVersion(request.params),
			capabilities: {
				tools: { listChanged: false },
			},
			serverInfo: this.serverInfo,
		});
	}

	private handleToolsList(request: McpRequest): McpResponse {
		const activeContext =
			(request.params?._meta as Record<string, unknown> | undefined)?.['dev.afd/context'] ??
			undefined;
		if (
			activeContext !== undefined &&
			!this.options.contexts?.some((context) => context.name === activeContext)
		) {
			return createMcpErrorResponse(
				request.id,
				McpErrorCodes.INVALID_PARAMS,
				'Unknown active context'
			);
		}
		const tools = this.getTools(activeContext as string | undefined);
		const result: McpToolsListResult = { tools };
		return createMcpResponse(request.id, result);
	}

	private handleDiscover(request: McpRequest): McpResponse {
		const result = discoverResult(this.serverInfo, { tools: { listChanged: false } });
		const fields = this.options.contextFields;
		return createMcpResponse(request.id, {
			...result,
			_meta: {
				...result._meta,
				...(fields?.length && {
					'dev.afd/context-fields': fields.map((field) => ({
						name: field.name,
						meta: field.meta,
						schema: zodToJsonSchema(field.schema),
						required: field.required ?? false,
						journal: field.journal ?? false,
					})),
				}),
			},
		});
	}

	private async handleToolsCall(request: McpRequest): Promise<McpResponse> {
		const params = request.params as McpToolCallParams | undefined;

		if (!params?.name) {
			return createMcpErrorResponse(request.id, McpErrorCodes.INVALID_PARAMS, 'Missing tool name');
		}

		// Remote callers are MCP clients, so every entry point is exposure-checked.
		let args: unknown = params.arguments;
		const sentMeta = request.params?._meta;
		const meta = isRecord(sentMeta) ? { ...sentMeta } : {};
		// The mock's built-in meta-tool accepts the same fallback as MCP clients that cannot
		// send _meta. Lift it before selecting the context or reading declared request fields.
		if (params.name === BATCH_TOOL && isRecord(args) && 'meta' in args) {
			const { meta: argument, ...rest } = args;
			args = rest;
			if (argument != null && !isRecord(argument)) {
				return toolResponse(
					request,
					failure({
						code: 'VALIDATION_ERROR',
						message: 'The meta argument of afd-batch must be an object',
						suggestion: 'Send meta as an object with context or declared context-field keys',
						details: { argument: 'meta' },
					})
				);
			}
			const keys = new Set([
				'dev.afd/context',
				...(this.options.contextFields ?? []).map((field) => field.meta),
			]);
			for (const [key, value] of Object.entries(argument ?? {})) {
				if (!keys.has(key) || value == null) continue;
				if (meta[key] != null && !isDeepStrictEqual(meta[key], value)) {
					return toolResponse(
						request,
						failure({
							code: 'VALIDATION_ERROR',
							message: `_meta["${key}"] and the meta argument of afd-batch disagree`,
							suggestion: `Send ${key} in _meta or in meta, or the same value in both`,
							details: { meta: key },
						})
					);
				}
				meta[key] = value;
			}
		}
		const context: CommandContext = {};
		for (const field of this.options.contextFields ?? []) {
			if (meta[field.meta] != null) context[field.name] = meta[field.meta];
		}
		const activeContext = meta['dev.afd/context'] ?? undefined;
		if (activeContext !== undefined && typeof activeContext !== 'string') {
			return createMcpErrorResponse(
				request.id,
				McpErrorCodes.INVALID_PARAMS,
				'Active context must be a string'
			);
		}
		const executeOptions = activeContext === undefined ? {} : { activeContext };
		const registry = this.registry;
		const result =
			params.name === BATCH_TOOL
				? // SAFETY: executeBatch validates the whole envelope before running anything.
					await executeBatch(
						args as BatchRequest,
						(name, input, stepContext) =>
							registry.execute(name, input, stepContext, executeOptions),
						context,
						{ devMode: this.options.devMode }
					)
				: await registry.execute(
						params.name,
						args === undefined ? {} : args,
						context,
						executeOptions
					);

		return toolResponse(request, result);
	}
}

/**
 * Create a mock MCP server.
 */
export function createMockServer(
	commands?: Array<CommandDefinition | ZodCommandDefinition>,
	options?: MockServerOptions
): MockMcpServer {
	return new MockMcpServer(commands, options);
}
