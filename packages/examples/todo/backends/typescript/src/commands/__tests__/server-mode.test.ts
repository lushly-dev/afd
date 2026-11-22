/**
 * @fileoverview Tests for server devMode behavior
 *
 * Tests verify that:
 * - Production mode (default) sanitizes errors
 * - Development mode provides verbose errors, and changes no Origin check or CORS header
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	createMcpHandler,
	createMcpServer,
	defineCommand,
	type McpHandlerOptions,
} from '@lushly-dev/afd-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create test commands fresh for each test to avoid type inference issues.
 */
function createTestCommands() {
	const throwingCommand = defineCommand({
		name: 'test-throw',
		description: 'A command that throws an error',
		input: z.object({}),
		async handler() {
			throw new Error('Intentional test error with sensitive details: /internal/path/secret.key');
		},
	});

	const successCommand = defineCommand({
		name: 'test-success',
		description: 'A command that succeeds',
		input: z.object({
			value: z.string(),
		}),
		async handler(input) {
			return {
				success: true as const,
				data: { received: input.value },
			};
		},
	});

	// Use 'as any' to work around complex Zod generic inference
	return [throwingCommand, successCommand];
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEV MODE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Server devMode', () => {
	describe('devMode: true (development)', () => {
		let server: ReturnType<typeof createMcpServer>;

		beforeEach(async () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: createTestCommands(),
				port: 3201,
				devMode: true,
			});
			await server.start();
		});

		afterEach(async () => {
			await server.stop();
		});

		it('includes stack traces in error responses', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
			// In dev mode, should include detailed error message
			expect(result.error?.message).toContain('Intentional test error');
			// In dev mode, should include stack trace in details
			expect(result.error?.details).toBeDefined();
			expect(result.error?.details?.stack).toBeDefined();
			// Stack trace contains file path and function call info
			expect(result.error?.details?.stack).toContain('server-mode.test.ts');
		});

		it('includes detailed error message with sensitive info', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			// Dev mode preserves the full error message including sensitive paths
			expect(result.error?.message).toContain('sensitive details');
		});

		it('provides helpful suggestion in dev mode', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			expect(result.error?.suggestion).toContain('Check the command implementation');
		});
	});

	describe('devMode: false (production, default)', () => {
		let server: ReturnType<typeof createMcpServer>;

		beforeEach(async () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: createTestCommands(),
				port: 3202,
				devMode: false,
			});
			await server.start();
		});

		afterEach(async () => {
			await server.stop();
		});

		it('does NOT include stack traces in error responses', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
			// In production mode, should NOT include details with stack
			expect(result.error?.details).toBeUndefined();
		});

		it('sanitizes error message (no sensitive info)', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			// Production mode should return generic message
			expect(result.error?.message).toBe('An internal error occurred');
			// Should NOT contain the sensitive path
			expect(result.error?.message).not.toContain('sensitive details');
			expect(result.error?.message).not.toContain('/internal/path');
		});

		it('provides user-friendly suggestion in production', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			expect(result.error?.suggestion).toContain('Contact support');
		});
	});

	describe('default behavior (no devMode specified)', () => {
		let server: ReturnType<typeof createMcpServer>;

		beforeEach(async () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: createTestCommands(),
				port: 3203,
				// devMode not specified - should default to false (secure)
			});
			await server.start();
		});

		afterEach(async () => {
			await server.stop();
		});

		it('defaults to production behavior (secure by default)', async () => {
			const result = await server.execute('test-throw', {});

			expect(result.success).toBe(false);
			// Should behave like devMode: false
			expect(result.error?.details).toBeUndefined();
			expect(result.error?.message).toBe('An internal error occurred');
		});
	});

	describe('Origin and CORS do not depend on devMode', () => {
		/** Serve the HTTP routes on an ephemeral loopback port and POST one `/rpc` call. */
		async function rpcFrom(options: Partial<McpHandlerOptions>, origin: string): Promise<Response> {
			const handler = createMcpHandler({
				name: 'test-server',
				version: '1.0.0',
				host: '127.0.0.1',
				commands: createTestCommands(),
				...options,
			});
			const http = createServer(handler);
			await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
			try {
				const { port } = http.address() as AddressInfo;
				return await fetch(`http://127.0.0.1:${port}/rpc`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Origin: origin },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
				});
			} finally {
				handler.dispose();
				http.closeAllConnections();
				await new Promise<void>((resolve) => http.close(() => resolve()));
			}
		}

		it('devMode: true refuses a cross-origin request and sends no CORS header', async () => {
			for (const devMode of [true, false]) {
				const response = await rpcFrom({ devMode }, 'https://elsewhere.example');
				expect(response.status, `devMode ${devMode}`).toBe(403);
				expect(response.headers.get('access-control-allow-origin')).toBeNull();
			}
		});

		it('sends no CORS header by default, in devMode too', async () => {
			for (const devMode of [true, false]) {
				const response = await rpcFrom(
					{ devMode, allowedOrigins: ['http://localhost:5173'] },
					'http://localhost:5173'
				);
				expect(response.status).toBe(200);
				expect(response.headers.get('access-control-allow-origin')).toBeNull();
			}
		});

		it('explicit cors: true echoes a listed origin, never *', async () => {
			const response = await rpcFrom(
				{ devMode: true, cors: true, allowedOrigins: ['http://localhost:5173'] },
				'http://localhost:5173'
			);
			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Validation errors', () => {
	it('returns validation errors with details', async () => {
		const validationCommand = defineCommand({
			name: 'test-validate',
			description: 'A command with strict validation',
			input: z.object({
				email: z.string().email(),
				age: z.number().int().positive(),
			}),
			async handler(input) {
				return { success: true as const, data: input };
			},
		});

		const server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [validationCommand],
			port: 3207,
			devMode: true,
		});
		await server.start();

		const result = await server.execute('test-validate', {
			email: 'not-an-email',
			age: -5,
		});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		// Validation errors should include field-level details
		expect(result.error?.details?.errors).toBeDefined();

		await server.stop();
	});
});
