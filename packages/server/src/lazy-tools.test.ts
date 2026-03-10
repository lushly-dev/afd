import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executeDetail, executeDiscover } from './lazy-tools.js';
import { defineCommand } from './schema.js';

// Fixtures
function createTestCommands() {
	return [
		defineCommand({
			name: 'todo-create',
			description: 'Creates a new todo item',
			category: 'todo',
			tags: ['crud', 'write'],
			mutation: true,
			input: z.object({ title: z.string() }),
			handler: async () => ({ success: true as const, data: null }),
		}),
		defineCommand({
			name: 'todo-list',
			description: 'Lists all todo items with optional filtering',
			category: 'todo',
			tags: ['crud', 'read'],
			mutation: false,
			input: z.object({}),
			handler: async () => ({ success: true as const, data: [] }),
		}),
		defineCommand({
			name: 'user-get',
			description: 'Gets a user by ID',
			category: 'user',
			tags: ['crud', 'read'],
			mutation: false,
			input: z.object({ id: z.string() }),
			handler: async () => ({ success: true as const, data: null }),
		}),
		defineCommand({
			name: 'user-create',
			description: 'Creates a new user account',
			category: 'user',
			tags: ['crud', 'write', 'admin'],
			mutation: true,
			input: z.object({ name: z.string(), email: z.string() }),
			handler: async () => ({ success: true as const, data: null }),
		}),
	];
}

describe('afd-discover', () => {
	it('returns all commands with no filters', () => {
		const commands = createTestCommands();
		const result = executeDiscover(commands, {});
		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(4);
		expect(result.data?.filtered).toBe(4);
		expect(result.data?.returned).toBe(4);
		expect(result.data?.hasMore).toBe(false);
	});

	it('filters by category', () => {
		const result = executeDiscover(createTestCommands(), { category: 'todo' });
		expect(result.data?.commands).toHaveLength(2);
		expect(result.data?.commands.every((c) => c.category === 'todo')).toBe(true);
	});

	it('filters by single tag', () => {
		const result = executeDiscover(createTestCommands(), { tag: 'write' });
		expect(result.data?.commands).toHaveLength(2);
	});

	it('filters by multiple tags (any mode)', () => {
		const result = executeDiscover(createTestCommands(), {
			tag: ['write', 'admin'],
			tagMode: 'any',
		});
		expect(result.data?.commands).toHaveLength(2);
	});

	it('filters by multiple tags (all mode)', () => {
		const result = executeDiscover(createTestCommands(), {
			tag: ['write', 'admin'],
			tagMode: 'all',
		});
		expect(result.data?.commands).toHaveLength(1);
		expect(result.data?.commands[0]?.name).toBe('user-create');
	});

	it('filters by search text', () => {
		const result = executeDiscover(createTestCommands(), { search: 'todo' });
		expect(result.data?.commands).toHaveLength(2);
	});

	it('search is tokenized', () => {
		const result = executeDiscover(createTestCommands(), { search: 'create user' });
		expect(result.data?.commands).toHaveLength(1);
		expect(result.data?.commands[0]?.name).toBe('user-create');
	});

	it('paginates with limit and offset', () => {
		const result = executeDiscover(createTestCommands(), { limit: 2, offset: 0 });
		expect(result.data?.returned).toBe(2);
		expect(result.data?.hasMore).toBe(true);

		const page2 = executeDiscover(createTestCommands(), { limit: 2, offset: 2 });
		expect(page2.data?.returned).toBe(2);
		expect(page2.data?.hasMore).toBe(false);
	});

	it('clamps limit to 200', () => {
		const result = executeDiscover(createTestCommands(), { limit: 500 });
		// Should not error, just clamp
		expect(result.success).toBe(true);
	});

	it('includes availableCategories and availableTags', () => {
		const result = executeDiscover(createTestCommands(), {});
		expect(result.data?.availableCategories).toContain('todo');
		expect(result.data?.availableCategories).toContain('user');
		expect(result.data?.availableTags).toContain('crud');
		expect(result.data?.availableTags).toContain('write');
	});

	it('includes mutation when includeMutation is true', () => {
		const result = executeDiscover(createTestCommands(), { includeMutation: true });
		expect(result.data?.commands[0]).toHaveProperty('mutation');
	});

	it('excludes mutation by default', () => {
		const result = executeDiscover(createTestCommands(), {});
		// mutation should only be present when includeMutation is true
		for (const cmd of result.data?.commands ?? []) {
			expect(cmd).not.toHaveProperty('mutation');
		}
	});

	it('truncates long descriptions', () => {
		const cmd = defineCommand({
			name: 'long-desc',
			description:
				'This is a very long description that goes on and on. It has multiple sentences. And even more detail that should be truncated.',
			input: z.object({}),
			handler: async () => ({ success: true as const, data: null }),
		});
		const result = executeDiscover([cmd], {});
		expect(result.data?.commands[0]?.description).toBe(
			'This is a very long description that goes on and on'
		);
	});

	it('returns reasoning with result count', () => {
		const result = executeDiscover(createTestCommands(), { category: 'todo' });
		expect(result.reasoning).toContain('2 of 2');
		expect(result.confidence).toBe(1.0);
	});
});

describe('afd-detail', () => {
	it('returns detail for a single command', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		const result = executeDetail(commands, exposedNames, { command: 'todo-create' });

		expect(result.success).toBe(true);
		const entries = result.data ?? [];
		expect(entries).toHaveLength(1);
		expect(entries[0]?.found).toBe(true);
		expect(entries[0]?.name).toBe('todo-create');
		if (entries[0]?.found) {
			expect(entries[0].inputSchema).toBeDefined();
			expect(entries[0].callable).toBe(true);
		}
	});

	it('returns detail for multiple commands', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		const result = executeDetail(commands, exposedNames, {
			command: ['todo-create', 'user-get'],
		});

		expect(result.data).toHaveLength(2);
	});

	it('returns COMMAND_NOT_FOUND with fuzzy suggestion for unknown command', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		const result = executeDetail(commands, exposedNames, { command: 'todo-crate' });

		const entry = result.data?.[0];
		expect(entry?.found).toBe(false);
		if (!entry?.found) {
			expect(entry?.error.code).toBe('COMMAND_NOT_FOUND');
			expect(entry?.error.suggestion).toContain('todo-create');
		}
	});

	it('handles mixed found and not-found in batch', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		const result = executeDetail(commands, exposedNames, {
			command: ['todo-create', 'nonexistent-cmd'],
		});

		expect(result.data).toHaveLength(2);
		expect(result.data?.[0]?.found).toBe(true);
		expect(result.data?.[1]?.found).toBe(false);
	});

	it('marks non-exposed commands as not callable', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(['todo-create']); // Only expose one
		const result = executeDetail(commands, exposedNames, { command: 'user-get' });

		const entry = result.data?.[0];
		expect(entry?.found).toBe(true);
		if (entry?.found) {
			expect(entry.callable).toBe(false);
		}
	});

	it('enforces max 10 batch limit', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		// Request 15 commands — only first 10 should be processed
		const names = Array.from({ length: 15 }, (_, i) => `cmd-${i}`);
		const result = executeDetail(commands, exposedNames, { command: names });
		expect(result.data).toHaveLength(10);
	});

	it('includes outputSchema when command has output', () => {
		const cmd = defineCommand({
			name: 'todo-get',
			description: 'Gets a single todo by ID',
			input: z.object({ id: z.string() }),
			output: z.object({ id: z.string(), title: z.string(), done: z.boolean() }),
			handler: async () => ({
				success: true as const,
				data: { id: '1', title: 'Test', done: false },
			}),
		});
		const result = executeDetail([cmd], new Set(['todo-get']), { command: 'todo-get' });
		const entry = result.data?.[0];
		expect(entry?.found).toBe(true);
		if (entry?.found) {
			expect(entry.outputSchema).toBeDefined();
			expect(entry.outputSchema?.type).toBe('object');
			expect(entry.outputSchema?.properties?.id).toBeDefined();
		}
	});

	it('omits outputSchema when command has no output', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		const result = executeDetail(commands, exposedNames, { command: 'todo-create' });
		const entry = result.data?.[0];
		expect(entry?.found).toBe(true);
		if (entry?.found) {
			expect(entry.outputSchema).toBeUndefined();
		}
	});

	it('handles duplicate names in batch', () => {
		const commands = createTestCommands();
		const exposedNames = new Set(commands.map((c) => c.name));
		const result = executeDetail(commands, exposedNames, {
			command: ['todo-create', 'todo-create'],
		});
		expect(result.data).toHaveLength(2);
		expect(result.data?.[0]?.name).toBe('todo-create');
		expect(result.data?.[1]?.name).toBe('todo-create');
	});
});

describe('afd-discover edge cases', () => {
	it('returns zero results when no commands match filter', () => {
		const result = executeDiscover(createTestCommands(), { category: 'nonexistent' });
		expect(result.success).toBe(true);
		expect(result.data?.commands).toHaveLength(0);
		expect(result.data?.filtered).toBe(0);
		expect(result.data?.returned).toBe(0);
	});

	it('returns empty when offset is beyond range', () => {
		const result = executeDiscover(createTestCommands(), { offset: 100 });
		expect(result.success).toBe(true);
		expect(result.data?.commands).toHaveLength(0);
		expect(result.data?.hasMore).toBe(false);
	});

	it('handles empty command set', () => {
		const result = executeDiscover([], {});
		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(0);
		expect(result.data?.commands).toHaveLength(0);
	});

	it('clamps limit to minimum 1', () => {
		const result = executeDiscover(createTestCommands(), { limit: 0 });
		expect(result.success).toBe(true);
		expect(result.data?.returned).toBe(1);
	});
});
