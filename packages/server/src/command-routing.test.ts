import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	commandAction,
	commandGroup,
	defaultCommandGroup,
	filterByContext,
	isAccessibleInContext,
	notFoundSuggestion,
	notInContextError,
} from './command-routing.js';
import { defineCommand } from './schema.js';

function command(name: string, extra: { category?: string; contexts?: string[] } = {}) {
	return defineCommand({
		name,
		description: name,
		input: z.object({}),
		handler: async () => ({ success: true, data: null }),
		...extra,
	});
}

describe('group and action derivation', () => {
	it('uses the category, else the first name segment, else general', () => {
		expect(defaultCommandGroup(command('todo-create'))).toBe('todo');
		expect(defaultCommandGroup(command('todo-create', { category: 'tasks' }))).toBe('tasks');
		expect(defaultCommandGroup({ name: '-odd', category: '' })).toBe('general');
	});

	it('prefers groupByFn and falls back to general when it returns nothing', () => {
		const cmd = command('todo-create', { category: 'tasks' });
		expect(commandGroup(cmd)).toBe('tasks');
		expect(commandGroup(cmd, () => 'custom')).toBe('custom');
		expect(commandGroup(cmd, () => undefined)).toBe('general');
		expect(commandGroup(cmd, () => '')).toBe('general');
	});

	it('drops the first name segment to get the action', () => {
		expect(commandAction(command('todo-create'))).toBe('create');
		expect(commandAction(command('todo-create-batch'))).toBe('create-batch');
		expect(commandAction(command('ping'))).toBe('ping');
	});
});

describe('context scoping', () => {
	const universal = command('app-help');
	const editing = command('doc-edit', { contexts: ['editing'] });
	const printing = command('doc-print', { contexts: ['printing', 'review'] });

	it('allows everything without an active context and universal commands always', () => {
		for (const active of [null, undefined, '']) {
			expect(isAccessibleInContext(editing, active)).toBe(true);
		}
		expect(isAccessibleInContext(universal, 'printing')).toBe(true);
		expect(isAccessibleInContext(printing, 'review')).toBe(true);
		expect(isAccessibleInContext(editing, 'printing')).toBe(false);
	});

	it('filters by the active context', () => {
		const all = [universal, editing, printing];
		expect(filterByContext(all, null)).toBe(all);
		expect(filterByContext(all, 'editing').map((c) => c.name)).toEqual(['app-help', 'doc-edit']);
	});

	it('builds the COMMAND_NOT_IN_CONTEXT error', () => {
		expect(notInContextError('doc-edit', 'printing')).toEqual({
			code: 'COMMAND_NOT_IN_CONTEXT',
			message: "Command 'doc-edit' is not available in context 'printing'",
			suggestion: 'Use afd-context-list to see available contexts, or afd-context-enter to switch.',
		});
	});
});

describe('not-found suggestions', () => {
	const names = ['todo-create', 'todo-created', 'todo-creates', 'todo-creator', 'user-get'];

	it('names at most three close matches, best first, and points to afd-discover', () => {
		const suggestion = notFoundSuggestion('todo-creat', names);
		expect(suggestion).toMatch(
			/^Did you mean 'todo-create'\? Other close matches: '[a-z-]+', '[a-z-]+'\. Use afd-discover to list all commands\.$/
		);
	});

	it('names a single match without the other-matches clause', () => {
		expect(notFoundSuggestion('user-gt', ['user-get', 'billing-report-export'])).toBe(
			"Did you mean 'user-get'? Use afd-discover to list all commands."
		);
	});

	it('only points to afd-discover when nothing is close or the name is too long', () => {
		expect(notFoundSuggestion('zzzz', names)).toBe('Use afd-discover to list all commands.');
		expect(notFoundSuggestion('t'.repeat(10_000), names)).toBe(
			'Use afd-discover to list all commands.'
		);
		expect(notFoundSuggestion('todo-create', [])).toBe('Use afd-discover to list all commands.');
	});
});
