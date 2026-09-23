import type { McpTool } from '@lushly-dev/afd-core';
import { validateCommandSurface } from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { matchesCategory } from './tools.js';
import {
	getExecutionInput,
	getExecutionSkipReason,
	mapToolsToSurfaceCommands,
	validateToolListing,
} from './validate.js';

function tool(overrides: Partial<McpTool> = {}): McpTool {
	return {
		name: 'todo-create',
		description: 'Create a todo item',
		inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
		...overrides,
	};
}

function codes(result: ReturnType<typeof validateToolListing>) {
	return {
		errors: result.errors.map((e) => e.code),
		warnings: result.warnings.map((w) => w.code),
	};
}

describe('tool listing validation (no execution)', () => {
	it('accepts a well-formed listing entry', () => {
		const result = validateToolListing(
			tool({ _meta: { examples: [{ title: 'Basic', input: { title: 'Buy milk' } }] } })
		);
		expect(result).toEqual({ valid: true, errors: [], warnings: [] });
	});

	it('reports missing names and descriptions and invalid input schemas', () => {
		const result = validateToolListing({
			name: ' ',
			inputSchema: { type: 'array' },
		} as unknown as McpTool);
		expect(result.valid).toBe(false);
		expect(codes(result).errors).toEqual([
			'MISSING_NAME',
			'MISSING_DESCRIPTION',
			'INVALID_INPUT_SCHEMA',
		]);
	});

	it('warns about short descriptions and rejects a missing input schema', () => {
		const result = validateToolListing(
			tool({ description: 'Create', inputSchema: undefined as unknown as McpTool['inputSchema'] })
		);
		expect(codes(result)).toEqual({
			errors: ['INVALID_INPUT_SCHEMA'],
			warnings: ['SHORT_DESCRIPTION'],
		});
	});

	it('checks the shape of advertised examples', () => {
		const notArray = tool({ _meta: { examples: 'none' as unknown as [] } });
		expect(codes(validateToolListing(notArray)).errors).toEqual(['INVALID_EXAMPLES']);

		const badInput = tool({
			_meta: {
				examples: [
					{ title: 'ok', input: {} },
					{ title: 'bad', input: 'text' },
				],
			},
		});
		const result = validateToolListing(badInput);
		expect(codes(result).errors).toEqual(['INVALID_EXAMPLE_INPUT']);
		expect(result.errors[0]?.path).toBe('_meta.examples[1].input');
	});
});

describe('--execute safety', () => {
	it('skips tools marked mutation or destructive', () => {
		expect(getExecutionSkipReason(tool({ _meta: { mutation: true } }))).toBe('mutation: true');
		const destructive = tool({ _meta: { destructive: true } as McpTool['_meta'] });
		expect(getExecutionSkipReason(destructive)).toBe('destructive: true');
	});

	it('executes tools that are read-only or carry no metadata', () => {
		expect(getExecutionSkipReason(tool())).toBeUndefined();
		expect(getExecutionSkipReason(tool({ _meta: { mutation: false } }))).toBeUndefined();
	});

	it('uses the first example input, falling back to an empty object', () => {
		const examples = [
			{ title: 'First', input: { title: 'Buy milk' } },
			{ title: 'Second', input: { title: 'Ignored' } },
		];
		expect(getExecutionInput(tool({ _meta: { examples } }))).toEqual({ title: 'Buy milk' });
		expect(getExecutionInput(tool())).toEqual({});
		expect(getExecutionInput(tool({ _meta: { examples: [{ title: 'x', input: [1] }] } }))).toEqual(
			{}
		);
	});
});

describe('category matching', () => {
	it('prefers _meta.category and falls back to the kebab-case name prefix', () => {
		expect(matchesCategory(tool({ _meta: { category: 'todo' } }), 'todo')).toBe(true);
		expect(matchesCategory(tool({ name: 'todo-legacy' }), 'todo')).toBe(true);
		expect(matchesCategory(tool({ _meta: { category: 'tasks' } }), 'todo')).toBe(false);
		expect(matchesCategory(tool({ name: 'todo.create' }), 'todo')).toBe(false);
		expect(matchesCategory(tool({ name: 'todos-list' }), 'todo')).toBe(false);
	});
});

describe('remote surface metadata', () => {
	it('preserves category, prerequisites, output schema, examples, and contexts', () => {
		const tools: McpTool[] = [
			{
				name: 'alpha-run',
				description: 'Run the alpha operation',
				inputSchema: { type: 'object' },
				_meta: {
					category: 'alpha',
					requires: ['missing-command'],
					examples: [{ title: 'Basic', input: {} }],
					outputSchema: { type: 'object', properties: { value: { type: 'string' } } },
					contexts: ['editing'],
				},
			},
		];

		const commands = mapToolsToSurfaceCommands(tools);
		expect(commands[0]).toMatchObject({
			category: 'alpha',
			requires: ['missing-command'],
			examples: [{ title: 'Basic', input: {} }],
			outputJsonSchema: { type: 'object' },
			contexts: ['editing'],
		});

		const result = validateCommandSurface(commands, { configuredContexts: ['editing'] });
		expect(result.findings.some((finding) => finding.rule === 'unresolved-prerequisite')).toBe(
			true
		);
		expect(result.findings.some((finding) => finding.rule === 'missing-output-schema')).toBe(false);
		expect(result.findings.some((finding) => finding.rule === 'missing-context')).toBe(false);
	});

	it('retains prerequisite cycles from MCP metadata', () => {
		const tools: McpTool[] = ['alpha-run', 'beta-run'].map((name, index, names) => ({
			name,
			description: `Run the ${name} operation`,
			inputSchema: { type: 'object' },
			_meta: { requires: [names[1 - index] ?? ''] },
		}));

		const result = validateCommandSurface(mapToolsToSurfaceCommands(tools));
		expect(result.findings.some((finding) => finding.rule === 'circular-prerequisite')).toBe(true);
	});
});
