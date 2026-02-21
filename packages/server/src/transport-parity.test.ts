/**
 * @fileoverview Cross-transport parity tests
 *
 * Verifies that commands produce identical CommandResult shapes, error codes,
 * and metadata whether called via DirectClient or MCP server transports.
 *
 * Both stdio and http MCP transports share the same executeCommand function,
 * so server.execute() covers both transport modes. The meaningful parity
 * comparison is between the DirectClient path and the Server path.
 *
 * Intentional transport-specific differences (documented as tests):
 * - Error code for unknown commands: Server uses COMMAND_NOT_FOUND, DirectClient uses UNKNOWN_TOOL
 * - DirectClient provides structured UnknownToolError data for agent recovery
 * - Server adds executionTimeMs/traceId/commandVersion to metadata; DirectClient delegates to registry
 * - Server catches handler exceptions; DirectClient propagates them from registry
 */

import { type CommandDefinition, DirectClient, type DirectRegistry } from '@lushly-dev/afd-client';
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpServer, type McpServer } from './server.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED TEST COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

const greetCommand = defineCommand({
	name: 'test-greet',
	description: 'Greet a user',
	input: z.object({
		name: z.string(),
	}),
	async handler(input) {
		return success(
			{ message: `Hello, ${input.name}!` },
			{
				confidence: 0.99,
				reasoning: 'Static greeting, always confident',
			}
		);
	},
});

const failCommand = defineCommand({
	name: 'test-fail',
	description: 'Always fails with structured error',
	input: z.object({
		reason: z.string().optional(),
	}),
	async handler(input) {
		return failure({
			code: 'INTENTIONAL_ERROR',
			message: input.reason ?? 'This command always fails',
			suggestion: 'Use test-greet instead',
		});
	},
});

const metadataCommand = defineCommand({
	name: 'test-metadata',
	description: 'Returns result with full metadata',
	input: z.object({}),
	async handler() {
		return success('metadata-test', {
			confidence: 0.75,
			reasoning: 'Moderate confidence for testing',
			warnings: [
				{ message: 'Rate limit approaching' },
				{ code: 'STALE', message: 'Data may be outdated' },
			],
		});
	},
});

const echoCommand = defineCommand({
	name: 'test-echo',
	description: 'Echoes input back',
	input: z.object({
		value: z.string(),
		count: z.number().optional(),
	}),
	async handler(input) {
		return success(input);
	},
});

const throwCommand = defineCommand({
	name: 'test-throw',
	description: 'Throws an exception',
	input: z.object({}),
	async handler() {
		throw new Error('Unexpected handler error');
	},
});

const sharedCommands = [greetCommand, failCommand, metadataCommand, echoCommand, throwCommand];

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Adapter that wraps McpServer to execute via server.execute() path.
 */
function createServerExecutor(server: McpServer) {
	return {
		name: 'McpServer',
		call: (name: string, input: unknown, context?: CommandContext) =>
			server.execute(name, input ?? {}, context),
	};
}

/**
 * Adapter that wraps ZodCommandDefinitions as a DirectRegistry for DirectClient.
 * Includes exception handling and metadata augmentation to match server behavior.
 */
function createDirectRegistry(commands: typeof sharedCommands): DirectRegistry {
	const commandMap = new Map(commands.map((c) => [c.name, c]));

	return {
		async execute<T>(name: string, input?: unknown, context?: CommandContext) {
			const cmd = commandMap.get(name);
			if (!cmd) {
				return failure({
					code: 'COMMAND_NOT_FOUND',
					message: `Command '${name}' not found`,
				}) as CommandResult<T>;
			}

			try {
				const result = (await cmd.handler(input, context ?? {})) as CommandResult<T>;

				// Add metadata (similar to what server.executeCommand does)
				if (!result.metadata) {
					result.metadata = {};
				}
				if (context?.traceId) {
					result.metadata.traceId = context.traceId;
				}

				return result;
			} catch (err) {
				return failure({
					code: 'COMMAND_EXECUTION_ERROR',
					message: err instanceof Error ? err.message : String(err),
				}) as CommandResult<T>;
			}
		},
		listCommandNames() {
			return Array.from(commandMap.keys());
		},
		listCommands() {
			return commands.map((c) => ({ name: c.name, description: c.description }));
		},
		hasCommand(name: string) {
			return commandMap.has(name);
		},
		getCommand(name: string): CommandDefinition | undefined {
			const cmd = commandMap.get(name);
			if (!cmd) return undefined;

			// Convert Zod schema to CommandParameter[] for DirectClient validation
			const shape =
				cmd.inputSchema && 'shape' in cmd.inputSchema
					? (cmd.inputSchema as z.ZodObject<z.ZodRawShape>).shape
					: {};

			return {
				name: cmd.name,
				description: cmd.description,
				parameters: Object.entries(shape).map(([key, zodType]) => ({
					name: key,
					type: getZodBaseType(zodType as z.ZodTypeAny),
					description: '',
					required: !isZodOptional(zodType as z.ZodTypeAny),
				})),
			};
		},
	};
}

/** Extract base type from a Zod schema for DirectClient validation. */
function getZodBaseType(
	schema: z.ZodTypeAny
): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
	const typeName = schema._def?.typeName as string | undefined;
	if (typeName === 'ZodString') return 'string';
	if (typeName === 'ZodNumber') return 'number';
	if (typeName === 'ZodBoolean') return 'boolean';
	if (typeName === 'ZodArray') return 'array';
	if (typeName === 'ZodNull') return 'null';
	if (typeName === 'ZodOptional') {
		return getZodBaseType((schema as z.ZodOptional<z.ZodTypeAny>)._def.innerType);
	}
	return 'object';
}

/** Check if a Zod schema is optional. */
function isZodOptional(schema: z.ZodTypeAny): boolean {
	return (schema._def?.typeName as string) === 'ZodOptional';
}

function createDirectExecutor(client: DirectClient) {
	return {
		name: 'DirectClient',
		call: (name: string, input: unknown, context?: CommandContext) =>
			client.call(name, (input ?? {}) as Record<string, unknown>, context),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-transport parity', () => {
	let server: McpServer;
	let directClient: DirectClient;
	let serverExec: ReturnType<typeof createServerExecutor>;
	let directExec: ReturnType<typeof createDirectExecutor>;

	beforeEach(async () => {
		// Server transport (covers both stdio and http since they share executeCommand)
		server = createMcpServer({
			name: 'parity-test',
			version: '1.0.0',
			commands: sharedCommands,
			transport: 'http',
			port: 3399,
		});
		await server.start();
		serverExec = createServerExecutor(server);

		// DirectClient transport (with validation enabled via getCommand)
		const registry = createDirectRegistry(sharedCommands);
		directClient = new DirectClient(registry, { validateInputs: true });
		directExec = createDirectExecutor(directClient);
	});

	afterEach(async () => {
		if (server) {
			await server.stop();
		}
	});

	// ─────────────────────────────────────────────────────────────────────────
	// SUCCESS RESULT PARITY
	// ─────────────────────────────────────────────────────────────────────────

	describe('successful command results', () => {
		it('produces identical success shape for simple commands', async () => {
			const serverResult = await serverExec.call('test-greet', { name: 'World' });
			const directResult = await directExec.call('test-greet', { name: 'World' });

			// Both succeed
			expect(serverResult.success).toBe(true);
			expect(directResult.success).toBe(true);

			// Identical data payload
			expect(serverResult.data).toEqual(directResult.data);
			expect(serverResult.data).toEqual({ message: 'Hello, World!' });
		});

		it('preserves confidence and reasoning across transports', async () => {
			const serverResult = await serverExec.call('test-greet', { name: 'Alice' });
			const directResult = await directExec.call('test-greet', { name: 'Alice' });

			expect(serverResult.confidence).toBe(directResult.confidence);
			expect(serverResult.confidence).toBe(0.99);

			expect(serverResult.reasoning).toBe(directResult.reasoning);
			expect(serverResult.reasoning).toBe('Static greeting, always confident');
		});

		it('echoes identical data for complex inputs', async () => {
			const input = { value: 'test-data', count: 42 };
			const serverResult = await serverExec.call('test-echo', input);
			const directResult = await directExec.call('test-echo', input);

			expect(serverResult.success).toBe(true);
			expect(directResult.success).toBe(true);
			expect(serverResult.data).toEqual(directResult.data);
			expect(serverResult.data).toEqual(input);
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// ERROR RESULT PARITY
	// ─────────────────────────────────────────────────────────────────────────

	describe('error result parity', () => {
		it('produces identical error structure for command failures', async () => {
			const serverResult = await serverExec.call('test-fail', { reason: 'parity test' });
			const directResult = await directExec.call('test-fail', { reason: 'parity test' });

			// Both fail
			expect(serverResult.success).toBe(false);
			expect(directResult.success).toBe(false);

			// Identical error code and message
			expect(serverResult.error?.code).toBe(directResult.error?.code);
			expect(serverResult.error?.code).toBe('INTENTIONAL_ERROR');
			expect(serverResult.error?.message).toBe(directResult.error?.message);
			expect(serverResult.error?.message).toBe('parity test');

			// Identical suggestion
			expect(serverResult.error?.suggestion).toBe(directResult.error?.suggestion);
			expect(serverResult.error?.suggestion).toBe('Use test-greet instead');
		});

		it('both return failure for invalid input types', async () => {
			// Send wrong type for 'name' field (number instead of string)
			const serverResult = await serverExec.call('test-greet', { name: 123 });
			const directResult = await directExec.call('test-greet', { name: 123 });

			// Both fail
			expect(serverResult.success).toBe(false);
			expect(directResult.success).toBe(false);

			// Both use VALIDATION_ERROR code
			expect(serverResult.error?.code).toBe('VALIDATION_ERROR');
			expect(directResult.error?.code).toBe('VALIDATION_ERROR');
		});

		it('both return failure for missing required fields', async () => {
			// 'name' is required but not provided
			const serverResult = await serverExec.call('test-greet', {});
			const directResult = await directExec.call('test-greet', {});

			expect(serverResult.success).toBe(false);
			expect(directResult.success).toBe(false);

			expect(serverResult.error?.code).toBe('VALIDATION_ERROR');
			expect(directResult.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// METADATA PARITY
	// ─────────────────────────────────────────────────────────────────────────

	describe('metadata parity', () => {
		it('preserves warnings across transports', async () => {
			const serverResult = await serverExec.call('test-metadata', {});
			const directResult = await directExec.call('test-metadata', {});

			expect(serverResult.warnings).toEqual(directResult.warnings);
			expect(serverResult.warnings).toHaveLength(2);
			expect(serverResult.warnings?.[0]?.message).toBe('Rate limit approaching');
			expect(serverResult.warnings?.[1]?.code).toBe('STALE');
		});

		it('preserves confidence across transports', async () => {
			const serverResult = await serverExec.call('test-metadata', {});
			const directResult = await directExec.call('test-metadata', {});

			expect(serverResult.confidence).toBe(directResult.confidence);
			expect(serverResult.confidence).toBe(0.75);
		});

		it('preserves reasoning across transports', async () => {
			const serverResult = await serverExec.call('test-metadata', {});
			const directResult = await directExec.call('test-metadata', {});

			expect(serverResult.reasoning).toBe(directResult.reasoning);
			expect(serverResult.reasoning).toBe('Moderate confidence for testing');
		});

		it('propagates traceId in both transports', async () => {
			const traceId = 'parity-trace-123';
			const serverResult = await serverExec.call('test-greet', { name: 'Trace' }, { traceId });
			const directResult = await directExec.call('test-greet', { name: 'Trace' }, { traceId });

			// Both should include traceId in metadata
			expect(serverResult.metadata?.traceId).toBe(traceId);
			expect(directResult.metadata?.traceId).toBe(traceId);
		});

		it('server adds executionTimeMs to metadata', async () => {
			const serverResult = await serverExec.call('test-greet', { name: 'Timing' });

			// Server executeCommand always adds executionTimeMs
			expect(serverResult.metadata?.executionTimeMs).toBeDefined();
			expect(serverResult.metadata?.executionTimeMs).toBeLessThan(100);
		});

		it('server adds commandVersion when command defines version', async () => {
			// Commands without explicit version don't get commandVersion metadata
			const serverResult = await serverExec.call('test-greet', { name: 'Meta' });

			// commandVersion is only set if the command definition includes version
			// Our test commands don't set version, so it should be undefined on both
			expect(serverResult.metadata?.commandVersion).toBeUndefined();
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// UNKNOWN COMMAND HANDLING
	// ─────────────────────────────────────────────────────────────────────────

	describe('unknown command handling', () => {
		it('both return failure for unknown commands', async () => {
			const serverResult = await serverExec.call('nonexistent-command', {});
			const directResult = await directExec.call('nonexistent-command', {});

			expect(serverResult.success).toBe(false);
			expect(directResult.success).toBe(false);
		});

		it('documents intentional error code difference for unknown commands', async () => {
			const serverResult = await serverExec.call('nonexistent-command', {});
			const directResult = await directExec.call('nonexistent-command', {});

			// Intentional difference: Server uses COMMAND_NOT_FOUND, DirectClient uses UNKNOWN_TOOL
			// DirectClient intercepts before reaching the registry and provides richer agent recovery data
			expect(serverResult.error?.code).toBe('COMMAND_NOT_FOUND');
			expect(directResult.error?.code).toBe('UNKNOWN_TOOL');
		});

		it('server includes available commands in suggestion', async () => {
			const serverResult = await serverExec.call('nonexistent-command', {});

			expect(serverResult.error?.suggestion).toContain('test-greet');
			expect(serverResult.error?.suggestion).toContain('test-fail');
		});

		it('DirectClient includes structured recovery data for unknown commands', async () => {
			const directResult = await directExec.call('nonexistent-command', {});

			// DirectClient provides UnknownToolError with available_tools for agent recovery
			expect(directResult.data).toBeDefined();
			const data = directResult.data as {
				available_tools?: string[];
				requested_tool?: string;
				suggestions?: string[];
			};
			expect(data.available_tools).toContain('test-greet');
			expect(data.requested_tool).toBe('nonexistent-command');
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// HANDLER EXCEPTION PARITY
	// ─────────────────────────────────────────────────────────────────────────

	describe('handler exception handling', () => {
		it('both handle thrown exceptions gracefully', async () => {
			const serverResult = await serverExec.call('test-throw', {});
			const directResult = await directExec.call('test-throw', {});

			// Both should fail (not throw uncaught)
			expect(serverResult.success).toBe(false);
			expect(directResult.success).toBe(false);
		});

		it('documents error message difference for handler exceptions', async () => {
			const serverResult = await serverExec.call('test-throw', {});
			const directResult = await directExec.call('test-throw', {});

			// Intentional difference: Server hides internal error details in non-devMode (security)
			// DirectClient (via registry adapter) exposes the actual error message
			expect(serverResult.error?.message).toBe('An internal error occurred');
			expect(directResult.error?.message).toBe('Unexpected handler error');
		});

		it('both use COMMAND_EXECUTION_ERROR code for handler exceptions', async () => {
			const serverResult = await serverExec.call('test-throw', {});
			const directResult = await directExec.call('test-throw', {});

			expect(serverResult.error?.code).toBe('COMMAND_EXECUTION_ERROR');
			expect(directResult.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		});

		it('server exposes error details in devMode', async () => {
			const devServer = createMcpServer({
				name: 'parity-dev',
				version: '1.0.0',
				commands: sharedCommands,
				transport: 'http',
				port: 3398,
				devMode: true,
			});
			await devServer.start();

			try {
				const result = await devServer.execute('test-throw', {});
				// In devMode, the actual error message is exposed
				expect(result.error?.message).toBe('Unexpected handler error');
			} finally {
				await devServer.stop();
			}
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// TRANSPORT MODE EQUIVALENCE
	// ─────────────────────────────────────────────────────────────────────────

	describe('stdio vs http transport equivalence', () => {
		it('server.execute() produces same results regardless of transport config', async () => {
			const stdioServer = createMcpServer({
				name: 'parity-stdio',
				version: '1.0.0',
				commands: sharedCommands,
				transport: 'stdio',
			});
			await stdioServer.start();

			try {
				const httpResult = await server.execute('test-greet', { name: 'Transport' });
				const stdioResult = await stdioServer.execute('test-greet', { name: 'Transport' });

				// Identical results since both use the same executeCommand function
				expect(httpResult.success).toBe(stdioResult.success);
				expect(httpResult.data).toEqual(stdioResult.data);
				expect(httpResult.confidence).toBe(stdioResult.confidence);
				expect(httpResult.reasoning).toBe(stdioResult.reasoning);
			} finally {
				await stdioServer.stop();
			}
		});

		it('error handling is identical across transport configs', async () => {
			const stdioServer = createMcpServer({
				name: 'parity-stdio-error',
				version: '1.0.0',
				commands: sharedCommands,
				transport: 'stdio',
			});
			await stdioServer.start();

			try {
				const httpResult = await server.execute('test-fail', {});
				const stdioResult = await stdioServer.execute('test-fail', {});

				expect(httpResult.success).toBe(stdioResult.success);
				expect(httpResult.error).toEqual(stdioResult.error);
			} finally {
				await stdioServer.stop();
			}
		});

		it('validation errors are identical across transport configs', async () => {
			const stdioServer = createMcpServer({
				name: 'parity-stdio-validation',
				version: '1.0.0',
				commands: sharedCommands,
				transport: 'stdio',
			});
			await stdioServer.start();

			try {
				const httpResult = await server.execute('test-greet', {});
				const stdioResult = await stdioServer.execute('test-greet', {});

				expect(httpResult.success).toBe(stdioResult.success);
				expect(httpResult.error?.code).toBe(stdioResult.error?.code);
				expect(httpResult.error?.code).toBe('VALIDATION_ERROR');
			} finally {
				await stdioServer.stop();
			}
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// RESULT SHAPE COMPLETENESS
	// ─────────────────────────────────────────────────────────────────────────

	describe('result shape completeness', () => {
		it('success results have all expected fields', async () => {
			const serverResult = await serverExec.call('test-metadata', {});
			const directResult = await directExec.call('test-metadata', {});

			for (const result of [serverResult, directResult]) {
				expect(result).toHaveProperty('success', true);
				expect(result).toHaveProperty('data');
				expect(result).toHaveProperty('confidence');
				expect(result).toHaveProperty('reasoning');
				expect(result).toHaveProperty('warnings');
			}
		});

		it('failure results have all expected fields', async () => {
			const serverResult = await serverExec.call('test-fail', {});
			const directResult = await directExec.call('test-fail', {});

			for (const result of [serverResult, directResult]) {
				expect(result).toHaveProperty('success', false);
				expect(result.error).toHaveProperty('code');
				expect(result.error).toHaveProperty('message');
			}
		});

		it('error suggestion is preserved across transports', async () => {
			const serverResult = await serverExec.call('test-fail', {});
			const directResult = await directExec.call('test-fail', {});

			expect(serverResult.error?.suggestion).toBe('Use test-greet instead');
			expect(directResult.error?.suggestion).toBe('Use test-greet instead');
		});
	});
});
