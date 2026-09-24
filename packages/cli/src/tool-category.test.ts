import type { McpTool } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { matchesCategory, toolCategory } from './tool-category.js';

function tool(overrides: Partial<McpTool> = {}): McpTool {
	return {
		name: 'todo-create',
		description: 'Create a todo item',
		inputSchema: { type: 'object' },
		...overrides,
	};
}

describe('toolCategory', () => {
	it('uses _meta.category when the server advertises one', () => {
		expect(toolCategory(tool({ _meta: { category: 'tasks' } }))).toBe('tasks');
	});

	it('falls back to the kebab-case domain before the first "-"', () => {
		expect(toolCategory(tool())).toBe('todo');
		expect(toolCategory(tool({ name: 'todo-create-batch' }))).toBe('todo');
		expect(toolCategory(tool({ _meta: { category: '' } }))).toBe('todo');
	});

	it('uses the whole name when there is no domain prefix', () => {
		expect(toolCategory(tool({ name: 'ping' }))).toBe('ping');
		expect(toolCategory(tool({ name: '-odd' }))).toBe('-odd');
		expect(toolCategory(tool({ name: 'todo.create' }))).toBe('todo.create');
	});
});

describe('matchesCategory', () => {
	it('prefers _meta.category and falls back to the kebab-case name prefix', () => {
		expect(matchesCategory(tool({ _meta: { category: 'todo' } }), 'todo')).toBe(true);
		expect(matchesCategory(tool({ name: 'todo-legacy' }), 'todo')).toBe(true);
		expect(matchesCategory(tool({ _meta: { category: 'tasks' } }), 'todo')).toBe(false);
		expect(matchesCategory(tool({ name: 'todo.create' }), 'todo')).toBe(false);
		expect(matchesCategory(tool({ name: 'todos-list' }), 'todo')).toBe(false);
	});
});
