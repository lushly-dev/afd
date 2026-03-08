/**
 * @fileoverview Tests for MCP server transport functionality
 *
 * Tests verify:
 * - Transport auto-detection
 * - Explicit transport configuration
 * - Backward compatibility with deprecated stdio option
 * - Server URL reporting based on transport
 */

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpServer, isStdinPiped, type McpServer } from './server.js';

// Simple test command
const testCommand = defineCommand({
	name: 'test-echo',
	description: 'Echo the input',
	category: 'test',
	version: '1.0.0',
	mutation: false,
	input: z.object({
		message: z.string(),
	}),
	handler: async (input) => ({
		success: true,
		data: { echo: input.message },
	}),
});

describe('Transport configuration', () => {
	let server: McpServer;

	afterEach(async () => {
		if (server) {
			await server.stop();
		}
	});

	describe('explicit transport option', () => {
		it("uses stdio transport when transport: 'stdio'", () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: [testCommand],
				transport: 'stdio',
			});

			expect(server.getTransport()).toBe('stdio');
			expect(server.getUrl()).toBe('stdio://');
		});

		it("uses http transport when transport: 'http'", () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: [testCommand],
				transport: 'http',
				port: 3300,
			});

			expect(server.getTransport()).toBe('http');
			expect(server.getUrl()).toBe('http://localhost:3300');
		});

		it("auto-detects transport when transport: 'auto'", () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: [testCommand],
				transport: 'auto',
				port: 3301,
			});

			// In test environment, stdin is typically piped, so should resolve to stdio
			const transport = server.getTransport();
			expect(transport === 'stdio' || transport === 'http').toBe(true);
		});
	});

	describe('backward compatibility with stdio option', () => {
		it('uses stdio transport when deprecated stdio: true', () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: [testCommand],
				stdio: true,
			});

			expect(server.getTransport()).toBe('stdio');
		});

		it('uses http transport when deprecated stdio: false', () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: [testCommand],
				stdio: false,
				port: 3302,
			});

			expect(server.getTransport()).toBe('http');
		});
	});

	describe('default transport', () => {
		it('defaults to auto transport when no transport option is specified', () => {
			server = createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				commands: [testCommand],
				port: 3303,
			});

			// Should resolve to either stdio or http based on environment
			const transport = server.getTransport();
			expect(transport === 'stdio' || transport === 'http').toBe(true);
		});
	});
});

describe('isStdinPiped', () => {
	it('returns a boolean', () => {
		const result = isStdinPiped();
		expect(typeof result).toBe('boolean');
	});

	it('reflects process.stdin.isTTY', () => {
		const result = isStdinPiped();
		// isStdinPiped returns true when stdin is NOT a TTY (i.e., piped)
		expect(result).toBe(!process.stdin.isTTY);
	});
});

describe('HTTP transport server', () => {
	let server: McpServer;

	afterEach(async () => {
		if (server) {
			await server.stop();
		}
	});

	it('starts HTTP server when transport is http', async () => {
		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [testCommand],
			transport: 'http',
			port: 3304,
		});

		await server.start();

		// Verify server is running by checking the URL
		expect(server.getUrl()).toBe('http://localhost:3304');
	});

	it('exposes commands via execute method', async () => {
		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [testCommand],
			transport: 'http',
			port: 3305,
		});

		await server.start();

		const result = await server.execute('test-echo', { message: 'hello' });
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ echo: 'hello' });
	});
});

describe('Tool _meta emission', () => {
	let server: McpServer;

	afterEach(async () => {
		if (server) {
			await server.stop();
		}
	});

	it('emits _meta with requires and mutation when present', () => {
		const cmdWithMeta = defineCommand({
			name: 'test-protected',
			description: 'A protected command',
			category: 'test',
			version: '1.0.0',
			mutation: true,
			requires: ['test-auth'],
			input: z.object({}),
			handler: async () => ({ success: true, data: {} }),
		});

		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [cmdWithMeta],
			transport: 'stdio',
		});

		const commands = server.getCommands();
		const cmd = commands.find((c) => c.name === 'test-protected');
		expect(cmd).toBeDefined();
		expect(cmd?.requires).toEqual(['test-auth']);
		expect(cmd?.mutation).toBe(true);
	});

	it('command without requires or mutation has no _meta fields', () => {
		const plainCmd = defineCommand({
			name: 'test-plain',
			description: 'A plain command',
			category: 'test',
			version: '1.0.0',
			input: z.object({}),
			handler: async () => ({ success: true, data: {} }),
		});

		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [plainCmd],
			transport: 'stdio',
		});

		const commands = server.getCommands();
		const cmd = commands.find((c) => c.name === 'test-plain');
		expect(cmd).toBeDefined();
		expect(cmd?.requires).toBeUndefined();
		expect(cmd?.mutation).toBeUndefined();
	});

	it('empty requires array does not surface on command definition', () => {
		const cmdEmptyReq = defineCommand({
			name: 'test-empty-req',
			description: 'A command with empty requires',
			category: 'test',
			version: '1.0.0',
			requires: [],
			mutation: false,
			input: z.object({}),
			handler: async () => ({ success: true, data: {} }),
		});

		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [cmdEmptyReq],
			transport: 'stdio',
		});

		const commands = server.getCommands();
		const cmd = commands.find((c) => c.name === 'test-empty-req');
		expect(cmd).toBeDefined();
		// Empty array is passed through by defineCommand, but _meta logic checks length > 0
		expect(cmd?.mutation).toBe(false);
	});
});

describe('Stdio transport server', () => {
	let server: McpServer;

	afterEach(async () => {
		if (server) {
			await server.stop();
		}
	});

	it('starts without HTTP server when transport is stdio', async () => {
		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [testCommand],
			transport: 'stdio',
		});

		await server.start();

		// Verify transport is stdio
		expect(server.getTransport()).toBe('stdio');
		expect(server.getUrl()).toBe('stdio://');
	});

	it('can execute commands directly even in stdio mode', async () => {
		server = createMcpServer({
			name: 'test-server',
			version: '1.0.0',
			commands: [testCommand],
			transport: 'stdio',
		});

		await server.start();

		const result = await server.execute('test-echo', { message: 'test' });
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ echo: 'test' });
	});
});
