/**
 * @fileoverview Tests for output schema feature
 *
 * Tests verify:
 * - Output schema stored on ZodCommandDefinition
 * - Output schema converts to JSON Schema (outputJsonSchema populated)
 * - `returns` populated correctly via toCommandDefinition() (not the placeholder)
 * - MCP tool `_meta` includes outputSchema (test via getToolsList)
 * - Commands without output schema work (backward compat, returns is placeholder)
 * - Type inference constrains handler (compile-time only, noted in comments)
 * - Output schemas for arrays, nested objects, discriminated unions
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { getToolsList } from './tools.js';

// ═══════════════════════════════════════════════════════════════════════════════
// defineCommand output schema
// ═══════════════════════════════════════════════════════════════════════════════

describe('defineCommand output schema', () => {
	it('stores output schema on ZodCommandDefinition', () => {
		const Todo = z.object({ id: z.string(), title: z.string(), done: z.boolean() });
		const cmd = defineCommand({
			name: 'todo-list',
			description: 'Lists all todo items',
			input: z.object({ filter: z.enum(['all', 'active', 'done']).optional() }),
			output: Todo.array(),
			handler: async () => ({ success: true, data: [] }),
		});
		expect(cmd.outputSchema).toBeDefined();
		expect(cmd.outputJsonSchema).toBeDefined();
		expect(cmd.outputJsonSchema?.type).toBe('array');
	});

	it('populates returns via toCommandDefinition()', () => {
		const cmd = defineCommand({
			name: 'todo-get',
			description: 'Gets a single todo',
			input: z.object({ id: z.string() }),
			output: z.object({ id: z.string(), title: z.string() }),
			handler: async () => ({ success: true, data: { id: '1', title: 'Test' } }),
		});
		const def = cmd.toCommandDefinition();
		expect(def.returns).toBeDefined();
		expect(def.returns?.type).toBe('object');
		expect(def.returns?.properties?.id).toBeDefined();
		expect(def.returns?.properties?.title).toBeDefined();
	});

	it('uses placeholder when no output schema', () => {
		const cmd = defineCommand({
			name: 'todo-delete',
			description: 'Deletes a todo',
			input: z.object({ id: z.string() }),
			handler: async () => ({ success: true, data: null }),
		});
		expect(cmd.outputSchema).toBeUndefined();
		expect(cmd.outputJsonSchema).toBeUndefined();
		const def = cmd.toCommandDefinition();
		expect(def.returns).toEqual({ type: 'object', description: 'Command result' });
	});

	it('includes outputSchema in MCP _meta', () => {
		const cmd = defineCommand({
			name: 'todo-list',
			description: 'Lists all todos',
			input: z.object({}),
			output: z.object({ id: z.string() }).array(),
			handler: async () => ({ success: true, data: [] }),
		});
		const tools = getToolsList([cmd], 'individual');
		const tool = tools.find((t) => t.name === 'todo-list');
		expect(tool?._meta?.outputSchema).toBeDefined();
		expect(tool?._meta?.outputSchema?.type).toBe('array');
	});

	it('handles complex nested output schemas', () => {
		const cmd = defineCommand({
			name: 'todo-stats',
			description: 'Gets todo statistics',
			input: z.object({}),
			output: z.object({
				total: z.number(),
				byPriority: z.object({
					high: z.number(),
					medium: z.number(),
					low: z.number(),
				}),
			}),
			handler: async () => ({
				success: true,
				data: { total: 0, byPriority: { high: 0, medium: 0, low: 0 } },
			}),
		});
		expect(cmd.outputJsonSchema?.properties?.byPriority).toBeDefined();
	});

	it('handles discriminated union output schemas', () => {
		const cmd = defineCommand({
			name: 'auth-check',
			description: 'Checks authentication status',
			input: z.object({}),
			output: z.discriminatedUnion('status', [
				z.object({ status: z.literal('authenticated'), userId: z.string() }),
				z.object({ status: z.literal('anonymous'), redirectUrl: z.string() }),
			]),
			handler: async () => ({
				success: true,
				data: { status: 'authenticated' as const, userId: '123' },
			}),
		});
		expect(cmd.outputJsonSchema).toBeDefined();
		// Discriminated unions produce oneOf/anyOf in JSON Schema
		const schema = cmd.outputJsonSchema;
		const hasUnion = schema?.oneOf || schema?.anyOf;
		expect(hasUnion).toBeDefined();
	});

	it('does not emit _meta when only outputJsonSchema is absent', () => {
		const cmd = defineCommand({
			name: 'todo-ping',
			description: 'Pings the server',
			input: z.object({}),
			handler: async () => ({ success: true, data: 'pong' }),
		});
		const tools = getToolsList([cmd], 'individual');
		const tool = tools.find((t) => t.name === 'todo-ping');
		expect(tool?._meta).toBeUndefined();
	});

	// Type inference: the output schema constrains the handler return type.
	// This is a compile-time check — if `output: z.object({ id: z.string() })` is
	// specified, the handler must return `CommandResult<{ id: string }>`.
	// This test just verifies the API compiles correctly; actual type errors
	// would be caught by TypeScript, not runtime tests.
	it('accepts output schema with matching handler type', () => {
		const cmd = defineCommand({
			name: 'todo-count',
			description: 'Counts todos',
			input: z.object({}),
			output: z.number(),
			handler: async () => ({ success: true, data: 42 }),
		});
		expect(cmd.outputJsonSchema?.type).toBe('number');
	});
});
