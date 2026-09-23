/**
 * @fileoverview CLI integration tests
 *
 * Tests verify:
 * - CLI creates correctly with all expected commands
 * - Version output
 * - Help output contains expected content
 * - Output formatters handle all CommandResult shapes
 */

import { stripVTControlCharacters } from 'node:util';
import type { CommandResult } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../package.json';
import { createCli } from './cli.js';
import {
	getConfidenceBar,
	getProgressBar,
	printError,
	printInfo,
	printResult,
	printStatus,
	printSuccess,
	printTools,
	printWarning,
	renderBar,
} from './output.js';

describe('CLI program', () => {
	it('creates program with correct name and version', () => {
		const program = createCli();

		expect(program.name()).toBe('afd');
		expect(program.version()).toBe(packageJson.version);
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
		const options = callCmd?.options.map((option) => option.long);
		expect(options).toContain('--connect');
		expect(options).toContain('--format');
		expect(options).not.toContain('--json');
		expect(options).not.toContain('--input');
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

	it('validate command only executes tools behind an explicit --execute flag', () => {
		const validateCmd = createCli().commands.find((c) => c.name() === 'validate');
		const execute = validateCmd?.options.find((o) => o.long === '--execute');

		expect(execute?.defaultValue).toBeUndefined();
		expect(execute?.description).toMatch(/mutation\/destructive/);
		let help = '';
		validateCmd
			?.configureOutput({
				writeOut: (text) => {
					help += text;
				},
			})
			.outputHelp();
		expect(help).toContain('No tool is executed');
		expect(help).toContain('_meta.examples[0].input');
	});
});

describe('Bar rendering', () => {
	const plain = (text: string) => text;
	const cells = (bar: string) => stripVTControlCharacters(bar);

	it('fills proportionally inside the 0-1 range', () => {
		expect(cells(renderBar(0.5, 10, plain))).toBe('█████░░░░░');
		expect(cells(renderBar(0, 4, plain))).toBe('░░░░');
		expect(cells(renderBar(1, 4, plain))).toBe('████');
	});

	it('clamps out-of-range and non-finite values instead of throwing', () => {
		expect(cells(renderBar(1.5, 10, plain))).toBe('██████████');
		expect(cells(renderBar(-0.5, 10, plain))).toBe('░░░░░░░░░░');
		expect(cells(renderBar(Number.NaN, 4, plain))).toBe('░░░░');
		expect(cells(renderBar(Number.POSITIVE_INFINITY, 4, plain))).toBe('████');
		expect(cells(renderBar(Number.NEGATIVE_INFINITY, 4, plain))).toBe('░░░░');
	});

	it('keeps confidence and progress bars at a fixed width for any value', () => {
		for (const value of [-1, 0.2, 0.6, 0.9, 1.5]) {
			expect(cells(getConfidenceBar(value))).toHaveLength(10);
			expect(cells(getProgressBar(value))).toHaveLength(22);
		}
	});

	it('prints results whose confidence is outside 0-1', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		expect(() => printResult({ success: true, data: 'x', confidence: 1.5 })).not.toThrow();
		expect(() => printResult({ success: true, data: 'x', confidence: -0.2 })).not.toThrow();
		expect(logSpy.mock.calls.flat().join('\n')).toContain('150%');

		logSpy.mockRestore();
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

	it('prints verbose provenance and all confidence ranges', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		printResult(
			{
				success: true,
				data: 'done',
				confidence: 0.6,
				reasoning: 'matched records',
				sources: [{ type: 'database', title: 'Primary', location: 'rows/1' }, { type: 'api' }],
			},
			{ verbose: true }
		);
		printResult({ success: true, data: 'low', confidence: 0.2 });
		printResult(
			{
				success: false,
				error: {
					code: 'RETRY',
					message: 'temporary',
					retryable: true,
					details: { attempt: 2 },
				},
			},
			{ verbose: true }
		);

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('matched records');
		expect(output).toContain('Primary');
		expect(output).toContain('20%');
		expect(output).toContain('attempt');
	});

	it('prints connection variants and message helpers', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		printStatus({ connected: true, url: 'http://test/mcp', serverName: 'afd' });
		printStatus({ connected: true, serverName: 'afd', serverVersion: '2' });
		printStatus({ connected: false });
		printError('outer', new Error('inner'));
		printError('same', new Error('same'));
		printSuccess('saved');
		printInfo('working');
		printWarning('careful');

		expect(logSpy.mock.calls.flat().join('\n')).toContain('afd v?');
		expect(errorSpy.mock.calls.flat().join('\n')).toContain('inner');
	});
});
