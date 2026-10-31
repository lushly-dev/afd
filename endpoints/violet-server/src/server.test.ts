import { initializeCore, registry } from '@lushly-dev/violet-afd';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMcpServer } from './server.js';

describe('MCP Server', () => {
	beforeAll(() => {
		// Initialize core once for all tests
		if (registry.list().length === 0) {
			initializeCore();
		}
	});

	describe('createMcpServer', () => {
		it('should create a server instance', async () => {
			const server = await createMcpServer({
				name: 'test-server',
				version: '1.0.0',
				useMemory: true,
				skipInit: true, // Core already initialized in beforeAll
			});

			expect(server).toBeDefined();
		});

		it('should create server with custom name and version', async () => {
			const server = await createMcpServer({
				name: 'custom-name',
				version: '2.0.0',
				useMemory: true,
				skipInit: true,
			});

			expect(server).toBeDefined();
		});

		it('should create server with memory database', async () => {
			const server = await createMcpServer({
				name: 'memory-server',
				version: '1.0.0',
				useMemory: true,
				skipInit: true,
			});

			expect(server).toBeDefined();
		});

		it('should use default name if not provided', async () => {
			const server = await createMcpServer({
				useMemory: true,
				skipInit: true,
			});

			expect(server).toBeDefined();
		});
	});
});
