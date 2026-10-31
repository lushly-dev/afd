/**
 * @module docs/generator
 * Documentation generator from command registry
 */

import { matchesGlob } from '@lushly-dev/violet-core/engine';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import { ErrorCodes } from '../../types/command-result.js';
import { toJsonSchema } from '../json-schema.js';
import { type CommandContext, type CommandDefinition, registry } from '../registry.js';

// Input schema
export const DocsGenerateInputSchema = z.object({
	format: z.enum(['markdown', 'json']).default('markdown'),
	includeExamples: z.boolean().default(true),
	includeSchemas: z.boolean().default(true),
	filter: z.string().optional().describe("Filter commands by pattern (e.g., 'node.*')"),
});

export type DocsGenerateInput = z.input<typeof DocsGenerateInputSchema>;

// Output types
export interface CommandDoc {
	name: string;
	category: string;
	description: string;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	examples?: Array<{ input: Record<string, unknown>; description?: string }>;
	errors?: string[];
	tags?: string[];
}

export interface ErrorCodeDoc {
	code: string;
	description: string;
}

export interface DocsOutput {
	generated: string; // ISO timestamp
	version: string;
	commandCount: number;
	categories: string[];
	commands: CommandDoc[];
	errorCodes: ErrorCodeDoc[];
	markdown?: string; // Full markdown if format is markdown
}

// Output schema
export const DocsGenerateOutputSchema = z.object({
	generated: z.string(),
	version: z.string(),
	commandCount: z.number(),
	categories: z.array(z.string()),
	commands: z.array(
		z.object({
			name: z.string(),
			category: z.string(),
			description: z.string(),
			inputSchema: z.record(z.unknown()).optional(),
			outputSchema: z.record(z.unknown()).optional(),
			examples: z
				.array(
					z.object({
						input: z.record(z.unknown()),
						description: z.string().optional(),
					}),
				)
				.optional(),
			errors: z.array(z.string()).optional(),
			tags: z.array(z.string()).optional(),
		}),
	),
	errorCodes: z.array(
		z.object({
			code: z.string(),
			description: z.string(),
		}),
	),
	markdown: z.string().optional(),
});

/**
 * Generate markdown for a single command
 */
function generateCommandMarkdown(cmd: CommandDoc): string {
	const lines: string[] = [];

	lines.push(`## ${cmd.name}`);
	lines.push('');
	lines.push(cmd.description);
	lines.push('');
	lines.push(`**Category:** \`${cmd.category}\``);
	lines.push('');

	if (cmd.inputSchema) {
		lines.push('### Input Schema');
		lines.push('');
		lines.push('```json');
		lines.push(JSON.stringify(cmd.inputSchema, null, 2));
		lines.push('```');
		lines.push('');
	}

	if (cmd.outputSchema) {
		lines.push('### Output Schema');
		lines.push('');
		lines.push('```json');
		lines.push(JSON.stringify(cmd.outputSchema, null, 2));
		lines.push('```');
		lines.push('');
	}

	if (cmd.examples && cmd.examples.length > 0) {
		lines.push('### Examples');
		lines.push('');
		for (const example of cmd.examples) {
			if (example.description) {
				lines.push(`**${example.description}**`);
				lines.push('');
			}
			lines.push('```json');
			lines.push(JSON.stringify(example.input, null, 2));
			lines.push('```');
			lines.push('');
		}
	}

	if (cmd.errors && cmd.errors.length > 0) {
		lines.push('### Error Codes');
		lines.push('');
		for (const error of cmd.errors) {
			lines.push(`- \`${error}\``);
		}
		lines.push('');
	}

	lines.push('---');
	lines.push('');

	return lines.join('\n');
}

/**
 * Generate full markdown documentation
 */
function generateFullMarkdown(output: DocsOutput): string {
	const lines: string[] = [];

	// Header
	lines.push('# Violet Design Command Reference');
	lines.push('');
	lines.push(`*Generated: ${output.generated}*`);
	lines.push('');
	lines.push(`**Version:** ${output.version}`);
	lines.push('');
	lines.push(`**Total Commands:** ${output.commandCount}`);
	lines.push('');

	// Table of Contents
	lines.push('## Table of Contents');
	lines.push('');
	lines.push('- [Commands by Category](#commands-by-category)');
	for (const category of output.categories) {
		lines.push(`  - [${category}](#${category.toLowerCase().replace(/\s+/g, '-')})`);
	}
	lines.push('- [Error Codes](#error-codes)');
	lines.push('');

	// Commands by Category
	lines.push('## Commands by Category');
	lines.push('');

	for (const category of output.categories) {
		const categoryCommands = output.commands.filter((c: CommandDoc) => c.category === category);

		lines.push(`### ${category}`);
		lines.push('');
		lines.push('| Command | Description |');
		lines.push('|---------|-------------|');
		for (const cmd of categoryCommands) {
			lines.push(`| \`${cmd.name}\` | ${cmd.description.split('\n')[0]} |`);
		}
		lines.push('');
	}

	// Detailed Command Documentation
	lines.push('## Command Details');
	lines.push('');

	for (const cmd of output.commands) {
		lines.push(generateCommandMarkdown(cmd));
	}

	// Error Codes
	lines.push('## Error Codes');
	lines.push('');
	lines.push('| Code | Description |');
	lines.push('|------|-------------|');
	for (const error of output.errorCodes) {
		lines.push(`| \`${error.code}\` | ${error.description} |`);
	}
	lines.push('');

	return lines.join('\n');
}

/**
 * Extract command documentation from a command definition
 */
function extractCommandDoc(
	cmd: CommandDefinition<z.ZodType, unknown>,
	options: { includeExamples: boolean; includeSchemas: boolean },
): CommandDoc {
	const doc: CommandDoc = {
		name: cmd.name,
		category: cmd.category,
		description: cmd.description,
	};

	if (options.includeSchemas) {
		doc.inputSchema = toJsonSchema(cmd.inputSchema);
		doc.outputSchema = toJsonSchema(cmd.outputSchema);
	}

	if (options.includeExamples && cmd.examples && cmd.examples.length > 0) {
		doc.examples = cmd.examples.map((ex: { input: unknown; description: string }) => ({
			input: ex.input as Record<string, unknown>,
			description: ex.description,
		}));
	}

	// Extract error codes from description or use common ones
	const errorPattern = /`([A-Z_]+)`/g;
	const matches = cmd.description.match(errorPattern);
	if (matches) {
		doc.errors = matches.map((m: string) => m.replace(/`/g, ''));
	}

	return doc;
}

/**
 * Generate documentation from command registry
 */
export async function docsGenerate(
	input: DocsGenerateInput,
	_context: CommandContext,
): Promise<CommandResult<DocsOutput>> {
	const parsed = DocsGenerateInputSchema.parse(input);

	// Get all commands from registry
	const allCommandSummaries = registry.list();

	// Filter commands if pattern provided
	let filteredSummaries = allCommandSummaries;
	if (parsed.filter) {
		const filter = parsed.filter;
		filteredSummaries = allCommandSummaries.filter((cmd: { name: string }) =>
			matchesGlob(cmd.name, filter),
		);
	}

	// Get full command definitions and extract docs
	const commands: CommandDoc[] = [];
	for (const summary of filteredSummaries) {
		const cmd = registry.get(summary.name);
		if (cmd) {
			commands.push(
				extractCommandDoc(cmd, {
					includeExamples: parsed.includeExamples,
					includeSchemas: parsed.includeSchemas,
				}),
			);
		}
	}

	// Get unique categories
	const categories = [...new Set(commands.map((c: CommandDoc) => c.category))].sort();

	// Build error codes list from ErrorCodes constant
	const errorCodes: ErrorCodeDoc[] = Object.entries(ErrorCodes).map(([key, value]) => ({
		code: key,
		description: value.replace(/_/g, ' ').toLowerCase(),
	}));

	const output: DocsOutput = {
		generated: new Date().toISOString(),
		version: '1.0.0', // Could read from package.json
		commandCount: commands.length,
		categories,
		commands: commands.sort((a: CommandDoc, b: CommandDoc) => a.name.localeCompare(b.name)),
		errorCodes,
	};

	// Generate markdown if requested
	if (parsed.format === 'markdown') {
		output.markdown = generateFullMarkdown(output);
	}

	return {
		success: true,
		data: output,
		reasoning: `Generated documentation for ${commands.length} commands in ${categories.length} categories`,
	};
}

// Command definition
export const docsGenerateCommand: CommandDefinition<typeof DocsGenerateInputSchema, DocsOutput> = {
	name: 'docs.generate',
	category: 'system',
	description:
		'Generate documentation from command registry. Produces command reference with schemas and examples.',
	inputSchema: DocsGenerateInputSchema,
	outputSchema: DocsGenerateOutputSchema,
	handler: docsGenerate,
	examples: [
		{
			description: 'Generate markdown documentation',
			input: { format: 'markdown' },
		},
		{
			description: 'Generate JSON documentation',
			input: { format: 'json', includeSchemas: true },
		},
		{
			description: 'Generate docs for node commands only',
			input: { format: 'markdown', filter: 'node.*' },
		},
	],
};

/**
 * Register the docs.generate command
 */
export function registerDocsCommand(): void {
	registry.register(docsGenerateCommand);
}
