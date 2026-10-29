import { MemoryDatabase } from '@lushly-dev/violet-core/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareNodesCommand } from '../analyze/compare.js';
import { registry } from '../registry.js';
import type { CommandContext } from '../registry.js';
import {
	DocsGenerateInputSchema,
	DocsGenerateOutputSchema,
	docsGenerateCommand,
	registerDocsCommand,
} from './generator.js';

describe('docs.generate command', () => {
	let context: CommandContext;

	beforeAll(() => {
		const db = new MemoryDatabase();
		context = { db };

		// Register the docs command if not already registered
		if (!registry.get('docs.generate')) {
			registerDocsCommand();
		}
	});

	afterAll(() => {
		// Note: Commands can't be unregistered in current implementation
	});

	describe('command definition', () => {
		it('should have correct name', () => {
			expect(docsGenerateCommand.name).toBe('docs.generate');
		});

		it('should have correct category', () => {
			expect(docsGenerateCommand.category).toBe('system');
		});

		it('should have a description', () => {
			expect(docsGenerateCommand.description).toBeTruthy();
			expect(docsGenerateCommand.description.length).toBeGreaterThan(10);
		});

		it('should have examples', () => {
			expect(docsGenerateCommand.examples).toBeDefined();
			expect(docsGenerateCommand.examples?.length).toBeGreaterThan(0);
		});
	});

	describe('input schema', () => {
		it('should accept empty input with defaults', () => {
			const result = DocsGenerateInputSchema.safeParse({});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.format).toBe('markdown');
				expect(result.data.includeExamples).toBe(true);
				expect(result.data.includeSchemas).toBe(true);
			}
		});

		it('should accept markdown format', () => {
			const result = DocsGenerateInputSchema.safeParse({ format: 'markdown' });
			expect(result.success).toBe(true);
		});

		it('should accept json format', () => {
			const result = DocsGenerateInputSchema.safeParse({ format: 'json' });
			expect(result.success).toBe(true);
		});

		it('should reject invalid format', () => {
			const result = DocsGenerateInputSchema.safeParse({ format: 'html' });
			expect(result.success).toBe(false);
		});

		it('should accept filter pattern', () => {
			const result = DocsGenerateInputSchema.safeParse({ filter: 'node.*' });
			expect(result.success).toBe(true);
		});

		it('should accept boolean options', () => {
			const result = DocsGenerateInputSchema.safeParse({
				includeExamples: false,
				includeSchemas: false,
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.includeExamples).toBe(false);
				expect(result.data.includeSchemas).toBe(false);
			}
		});
	});

	describe('output schema', () => {
		it('should validate basic output structure', () => {
			const output = {
				generated: new Date().toISOString(),
				version: '1.0.0',
				commandCount: 5,
				categories: ['node', 'token'],
				commands: [],
				errorCodes: [],
			};
			const result = DocsGenerateOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should validate command doc structure', () => {
			const output = {
				generated: new Date().toISOString(),
				version: '1.0.0',
				commandCount: 1,
				categories: ['node'],
				commands: [
					{
						name: 'node.create',
						category: 'node',
						description: 'Create a node',
						inputSchema: { type: 'object' },
						examples: [{ input: { name: 'test' }, description: 'Create test node' }],
						errors: ['NODE_NOT_FOUND'],
					},
				],
				errorCodes: [{ code: 'NODE_NOT_FOUND', description: 'Node not found' }],
				markdown: '# Docs',
			};
			const result = DocsGenerateOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});
	});

	describe('handler execution', () => {
		it('should generate documentation successfully', async () => {
			const result = await docsGenerateCommand.handler({}, context);

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data?.generated).toBeTruthy();
			expect(result.data?.version).toBe('1.0.0');
			expect(result.data?.commandCount).toBeGreaterThan(0);
			expect(result.data?.categories.length).toBeGreaterThan(0);
			expect(result.data?.commands.length).toBeGreaterThan(0);
		});

		it('should include markdown when format is markdown', async () => {
			const result = await docsGenerateCommand.handler({ format: 'markdown' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.markdown).toBeTruthy();
			expect(result.data?.markdown).toContain('# Violet Design Command Reference');
		});

		it('should not include markdown when format is json', async () => {
			const result = await docsGenerateCommand.handler({ format: 'json' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.markdown).toBeUndefined();
		});

		it('should filter commands by pattern', async () => {
			const allResult = await docsGenerateCommand.handler({}, context);
			const filteredResult = await docsGenerateCommand.handler({ filter: 'node.*' }, context);

			expect(allResult.success).toBe(true);
			expect(filteredResult.success).toBe(true);
			expect(filteredResult.data?.commandCount).toBeLessThan(allResult.data?.commandCount);
			expect(filteredResult.data?.commands.every((c) => c.name.startsWith('node.'))).toBe(true);
		});

		it('should anchor the filter so node.* does not match compare.nodes', async () => {
			// compare.nodes contains "node" followed by another character; an unanchored
			// pattern would wrongly include it
			if (!registry.get('compare.nodes')) {
				registry.register(compareNodesCommand);
			}
			const result = await docsGenerateCommand.handler({ filter: 'node.*' }, context);

			expect(result.success).toBe(true);
			const names = result.data?.commands.map((c) => c.name) ?? [];
			expect(names).not.toContain('compare.nodes');
			expect(names.every((n) => n.startsWith('node.'))).toBe(true);
		});

		it('should treat regex metacharacters in the filter literally', async () => {
			for (const filter of ['(', '[', 'node.(list']) {
				const result = await docsGenerateCommand.handler({ filter }, context);
				expect(result.success).toBe(true);
				expect(result.data?.commandCount).toBe(0);
			}
		});

		it('should include schemas when requested', async () => {
			const result = await docsGenerateCommand.handler({ includeSchemas: true }, context);

			expect(result.success).toBe(true);
			expect(result.data?.commands[0]?.inputSchema).toBeDefined();
			expect(result.data?.commands[0]?.outputSchema).toBeDefined();
		});

		it('should exclude schemas when not requested', async () => {
			const result = await docsGenerateCommand.handler({ includeSchemas: false }, context);

			expect(result.success).toBe(true);
			expect(result.data?.commands[0]?.inputSchema).toBeUndefined();
		});

		it('should include error codes list', async () => {
			const result = await docsGenerateCommand.handler({}, context);

			expect(result.success).toBe(true);
			expect(result.data?.errorCodes.length).toBeGreaterThan(0);
			expect(result.data?.errorCodes[0]?.code).toBeTruthy();
			expect(result.data?.errorCodes[0]?.description).toBeTruthy();
		});

		it('should provide reasoning in result', async () => {
			const result = await docsGenerateCommand.handler({}, context);

			expect(result.success).toBe(true);
			expect(result.reasoning).toBeTruthy();
			expect(result.reasoning).toContain('Generated documentation');
		});
	});

	describe('markdown generation', () => {
		it('should generate table of contents', async () => {
			const result = await docsGenerateCommand.handler({ format: 'markdown' }, context);

			expect(result.data?.markdown).toContain('## Table of Contents');
			expect(result.data?.markdown).toContain('Commands by Category');
		});

		it('should generate category sections', async () => {
			const result = await docsGenerateCommand.handler({ format: 'markdown' }, context);

			expect(result.data?.markdown).toContain('## Commands by Category');
			expect(result.data?.markdown).toContain('| Command | Description |');
		});

		it('should generate command details', async () => {
			const result = await docsGenerateCommand.handler({ format: 'markdown' }, context);

			expect(result.data?.markdown).toContain('## Command Details');
			expect(result.data?.markdown).toContain('**Category:**');
		});

		it('should generate error codes table', async () => {
			const result = await docsGenerateCommand.handler({ format: 'markdown' }, context);

			expect(result.data?.markdown).toContain('## Error Codes');
			expect(result.data?.markdown).toContain('| Code | Description |');
		});
	});

	describe('examples validation', () => {
		it('should accept valid example inputs', () => {
			for (const example of docsGenerateCommand.examples || []) {
				const result = DocsGenerateInputSchema.safeParse(example.input);
				expect(result.success).toBe(true);
			}
		});
	});
});
