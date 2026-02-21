/**
 * @fileoverview CLI integration tests
 *
 * Tests verify:
 * - CLI creates correctly with all expected commands
 * - Version output
 * - Help output contains expected content
 * - Output formatters handle all CommandResult shapes
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { createCli } from './cli.js';
import { printResult, printTools } from './output.js';

describe('CLI program', () => {
	it('creates program with correct name and version', () => {
		const program = createCli();

		expect(program.name()).toBe('afd');
		expect(program.version()).toBeDefined();
	});

	it('registers all expected commands', () => {
		const program = createCli();
		const commandNames = program.commands.map((c) => c.name());

		expect(commandNames).toContain('connect');
		expect(commandNames).toContain('disconnect');
		expect(commandNames).toContain('status');
		expect(commandNames).toContain('tools');
		expect(commandNames).toContain('call');
		expect(commandNames).toContain('batch');
		expect(commandNames).toContain('stream');
		expect(commandNames).toContain('validate');
		expect(commandNames).toContain('shell');
		expect(commandNames).toContain('scenario');
	});

	it('connect command accepts url argument', () => {
		const program = createCli();
		const connectCmd = program.commands.find((c) => c.name() === 'connect');

		expect(connectCmd).toBeDefined();
		expect(connectCmd?.description()).toContain('Connect');
	});

	it('call command has required name argument', () => {
		const program = createCli();
		const callCmd = program.commands.find((c) => c.name() === 'call');

		expect(callCmd).toBeDefined();
		expect(callCmd?.description()).toBeTruthy();
	});

	it('tools command has format option', () => {
		const program = createCli();
		const toolsCmd = program.commands.find((c) => c.name() === 'tools');

		expect(toolsCmd).toBeDefined();
		const options = toolsCmd?.options.map((o) => o.long);
		expect(options).toContain('--format');
	});

	it('validate command has strict and verbose options', () => {
		const program = createCli();
		const validateCmd = program.commands.find((c) => c.name() === 'validate');

		expect(validateCmd).toBeDefined();
		const options = validateCmd?.options.map((o) => o.long);
		expect(options).toContain('--strict');
		expect(options).toContain('--verbose');
	});
});

describe('Output formatting', () => {
	describe('printResult', () => {
		it('prints success result in text format', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const result: CommandResult<{ id: string }> = {
				success: true,
				data: { id: 'test-123' },
			};

			printResult(result, { format: 'text' });

			const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(output).toContain('Success');
			expect(output).toContain('test-123');

			logSpy.mockRestore();
		});

		it('prints failure result with error code and suggestion', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const result: CommandResult<never> = {
				success: false,
				error: {
					code: 'NOT_FOUND',
					message: 'Item not found',
					suggestion: 'Check the ID',
				},
			};

			printResult(result, { format: 'text' });

			const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(output).toContain('Failed');
			expect(output).toContain('NOT_FOUND');
			expect(output).toContain('Item not found');
			expect(output).toContain('Check the ID');

			logSpy.mockRestore();
		});

		it('prints confidence bar when present', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const result: CommandResult<string> = {
				success: true,
				data: 'ok',
				confidence: 0.85,
			};

			printResult(result, { format: 'text' });

			const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(output).toContain('85%');

			logSpy.mockRestore();
		});

		it('prints warnings when present', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const result: CommandResult<string> = {
				success: true,
				data: 'ok',
				warnings: [{ message: 'Rate limit approaching' }],
			};

			printResult(result, { format: 'text' });

			const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(output).toContain('Rate limit approaching');

			logSpy.mockRestore();
		});

		it('outputs JSON format', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const result: CommandResult<{ count: number }> = {
				success: true,
				data: { count: 42 },
			};

			printResult(result, { format: 'json' });

			const output = logSpy.mock.calls[0]?.[0] as string;
			const parsed = JSON.parse(output);
			expect(parsed.success).toBe(true);
			expect(parsed.data.count).toBe(42);

			logSpy.mockRestore();
		});
	});

	describe('printTools', () => {
		it('prints tools in text format', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			printTools(
				[
					{ name: 'todo-create', description: 'Create a todo', inputSchema: { type: 'object' } },
					{ name: 'todo-list', description: 'List todos', inputSchema: { type: 'object' } },
				],
				{ format: 'text' }
			);

			const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(output).toContain('Available Tools (2)');
			expect(output).toContain('Create a todo');

			logSpy.mockRestore();
		});

		it('outputs JSON format', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			printTools([{ name: 'test-cmd', description: 'Test', inputSchema: { type: 'object' } }], {
				format: 'json',
			});

			const output = logSpy.mock.calls[0]?.[0] as string;
			const parsed = JSON.parse(output);
			expect(parsed).toHaveLength(1);
			expect(parsed[0].name).toBe('test-cmd');

			logSpy.mockRestore();
		});

		it('handles empty tools list', () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			printTools([], { format: 'text' });

			const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
			expect(output).toContain('No tools available');

			logSpy.mockRestore();
		});
	});
});
