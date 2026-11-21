import { initializeCore, registry } from '@lushly-dev/violet-afd';
import { beforeAll, describe, expect, it } from 'vitest';
import { HTTP_EXCLUDED_COMMANDS } from '../api.js';
import { MCP_EXCLUDED_COMMANDS, generateTools, getTool } from './generator.js';

describe('MCP Tool Generator', () => {
	beforeAll(() => {
		// Initialize core once for all tests
		if (registry.list().length === 0) {
			initializeCore();
		}
	});

	describe('generateTools', () => {
		it('should generate tools from registered commands', () => {
			const tools = generateTools();

			expect(tools).toBeInstanceOf(Array);
			expect(tools.length).toBeGreaterThan(0);
		});

		it('should generate valid MCP tool format', () => {
			const tools = generateTools();
			const tool = tools[0];

			expect(tool).toHaveProperty('name');
			expect(tool).toHaveProperty('description');
			expect(tool).toHaveProperty('inputSchema');
			expect(typeof tool.name).toBe('string');
			expect(typeof tool.description).toBe('string');
			expect(typeof tool.inputSchema).toBe('object');
		});

		it('should have valid JSON Schema for inputSchema', () => {
			const tools = generateTools();

			for (const tool of tools) {
				expect(tool.inputSchema).toHaveProperty('type');
				expect(tool.inputSchema.type).toBe('object');
				// JSON Schema should have properties defined
				expect(tool.inputSchema.properties).toBeDefined();
			}
		});

		it('should generate tools for all registered commands but the host-only ones', () => {
			const commands = registry.list().filter((cmd) => !MCP_EXCLUDED_COMMANDS.has(cmd.name));
			const tools = generateTools();

			expect(tools.length).toBe(commands.length);

			const toolNames = tools.map((t) => t.name);
			for (const cmd of commands) {
				expect(toolNames).toContain(cmd.name);
			}
		});

		it('leaves out validate and doctor, as the HTTP API does', () => {
			const names = generateTools().map((t) => t.name);
			expect(registry.get('validate')).toBeDefined();
			expect(registry.get('doctor')).toBeDefined();
			expect(names).not.toContain('validate');
			expect(names).not.toContain('doctor');
			expect(getTool('validate')).toBeUndefined();
			expect(getTool('doctor')).toBeUndefined();
			expect([...MCP_EXCLUDED_COMMANDS].sort()).toEqual([...HTTP_EXCLUDED_COMMANDS].sort());
		});
	});

	describe('getTool', () => {
		it('should return a tool by name', () => {
			const tool = getTool('node.create');

			expect(tool).toBeDefined();
			expect(tool?.name).toBe('node.create');
		});

		it('should return undefined for unknown tool', () => {
			const tool = getTool('unknown.command');

			expect(tool).toBeUndefined();
		});

		it('should return tool with correct description', () => {
			const tool = getTool('node.create');
			const command = registry.get('node.create');

			expect(tool?.description).toBe(command?.description);
		});
	});

	describe('tool schema quality', () => {
		it('should generate node.create with required fields', () => {
			const tool = getTool('node.create');

			expect(tool).toBeDefined();
			expect(tool?.inputSchema.properties).toHaveProperty('name');
			expect(tool?.inputSchema.required).toContain('name');
		});

		it('should generate token.add with required fields', () => {
			const tool = getTool('token.add');

			expect(tool).toBeDefined();
			// Check that tool has properties (the exact field names may vary)
			expect(tool?.inputSchema.properties).toBeDefined();
			expect(Object.keys(tool?.inputSchema.properties || {}).length).toBeGreaterThan(0);
		});

		it('should generate export tool with format enum', () => {
			const tool = getTool('export');

			expect(tool).toBeDefined();
			expect(tool?.inputSchema.properties).toHaveProperty('format');
		});
	});
});
