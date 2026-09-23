/**
 * @fileoverview createDirectRegistry: DirectClient calls go through Zod
 * validation, middleware and the expose.agent check.
 */

import {
	createDirectClient,
	type DirectRegistry,
	isUnknownToolError,
} from '@lushly-dev/afd-client';
import type { CommandContext, CommandMiddleware } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry, isExposedTo } from './direct-registry.js';
import { defineCommand, success } from './index.js';

interface Todo {
	id: string;
	title: string;
	priority: 'low' | 'medium' | 'high';
}

function createTodoCommands() {
	const created: Todo[] = [];
	const createHandler = vi.fn(async (input: Pick<Todo, 'title' | 'priority'>) => {
		const todo = { id: `todo-${created.length + 1}`, ...input };
		created.push(todo);
		return success(todo);
	});
	const contexts: CommandContext[] = [];

	const create = defineCommand({
		name: 'todo-create',
		description: 'Create a todo',
		mutation: true,
		expose: { mcp: true },
		input: z.object({
			title: z.string().min(1).max(200),
			priority: z.enum(['low', 'medium', 'high']).default('medium'),
		}),
		handler: createHandler,
	});
	const list = defineCommand({
		name: 'todo-list',
		description: 'List todos',
		input: z.object({}),
		async handler(_input, context) {
			contexts.push(context);
			return success([...created]);
		},
	});
	const reset = defineCommand({
		name: 'todo-reset',
		description: 'Delete every todo',
		destructive: true,
		expose: { palette: true, agent: false },
		input: z.object({}),
		async handler() {
			created.length = 0;
			return success({ reset: true });
		},
	});
	const crash = defineCommand({
		name: 'todo-crash',
		description: 'Throws',
		input: z.object({}),
		async handler(): Promise<never> {
			throw new Error('db password=hunter2');
		},
	});

	return { commands: [create, list, reset, crash], created, createHandler, contexts };
}

describe('createDirectRegistry', () => {
	it('is accepted by DirectClient', () => {
		const { commands } = createTodoCommands();
		const registry: DirectRegistry = createDirectRegistry(commands);
		expect(createDirectClient(registry).hasCommand('todo-create')).toBe(true);
	});

	describe('input validation', () => {
		it('rejects invalid input through DirectClient before the handler runs', async () => {
			const { commands, createHandler } = createTodoCommands();
			const client = createDirectClient(createDirectRegistry(commands));

			const nested = await client.call('todo-create', { title: { nested: true } });
			const tooLong = await client.call('todo-create', { title: 'x'.repeat(201) });
			const badEnum = await client.call('todo-create', { title: 'ok', priority: 'urgent' });

			for (const result of [nested, tooLong, badEnum]) {
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('VALIDATION_ERROR');
				expect(result.error?.suggestion).toBeTruthy();
			}
			expect(createHandler).not.toHaveBeenCalled();
		});

		it('passes the parsed input, with defaults applied, to the handler', async () => {
			const { commands, createHandler } = createTodoCommands();
			const client = createDirectClient(createDirectRegistry(commands));

			const result = await client.call<Todo>('todo-create', { title: 'Write tests' });

			expect(result).toMatchObject({
				success: true,
				data: { id: 'todo-1', title: 'Write tests', priority: 'medium' },
			});
			expect(createHandler).toHaveBeenCalledWith(
				{ title: 'Write tests', priority: 'medium' },
				expect.objectContaining({ interface: 'agent' })
			);
		});

		it('validates an omitted input as an empty object', async () => {
			const { commands } = createTodoCommands();
			const registry = createDirectRegistry(commands);

			expect((await registry.execute('todo-list')).success).toBe(true);
			expect((await registry.execute('todo-create')).error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('exposure', () => {
		it('refuses commands that are not exposed to agents', async () => {
			const { commands, created } = createTodoCommands();
			created.push({ id: 'keep', title: 'Keep me', priority: 'low' });
			const registry = createDirectRegistry(commands);
			const client = createDirectClient(registry);

			const viaClient = await client.call('todo-reset', {});
			if (!isUnknownToolError(viaClient)) throw new Error('expected UNKNOWN_TOOL');
			expect(viaClient.data?.available_tools).not.toContain('todo-reset');

			const direct = await registry.execute('todo-reset', {});
			expect(direct.success).toBe(false);
			expect(direct.error).toMatchObject({
				code: 'COMMAND_NOT_EXPOSED',
				message: "Command 'todo-reset' is not exposed to agent",
				retryable: false,
			});
			expect(direct.error?.suggestion).toContain('todo-create');

			expect(created).toHaveLength(1);
			expect(registry.listCommandNames()).toEqual(['todo-create', 'todo-list', 'todo-crash']);
			expect(registry.hasCommand('todo-reset')).toBe(false);
		});

		it('keeps the defaultExpose fallback for flags a command leaves out', () => {
			expect(isExposedTo({ expose: undefined }, 'agent')).toBe(true);
			expect(isExposedTo({ expose: undefined }, 'mcp')).toBe(false);
			expect(isExposedTo({ expose: { mcp: true } }, 'agent')).toBe(true);
			expect(isExposedTo({ expose: { mcp: true } }, 'cli')).toBe(false);
			expect(isExposedTo({ expose: { agent: false } }, 'agent')).toBe(false);
			expect(isExposedTo({ expose: { cli: true } }, 'cli')).toBe(true);
		});

		it('serves another interface when asked', async () => {
			const { commands } = createTodoCommands();
			const registry = createDirectRegistry(commands, { interface: 'mcp' });

			expect(registry.interface).toBe('mcp');
			expect(registry.listCommandNames()).toEqual(['todo-create']);
			expect((await registry.execute('todo-list', {})).error?.code).toBe('COMMAND_NOT_EXPOSED');
		});

		it('explains when nothing is exposed to the interface', async () => {
			const { commands } = createTodoCommands();
			const registry = createDirectRegistry(commands, { interface: 'cli' });

			const result = await registry.execute('todo-list', {});

			expect(result.error?.suggestion).toBe(
				'No commands are exposed to cli; set expose.cli on the commands it should call'
			);
		});

		it('returns COMMAND_NOT_FOUND for unregistered names', async () => {
			const { commands } = createTodoCommands();
			const registry = createDirectRegistry(commands);

			const result = await registry.execute('todo-archive', {});

			expect(result.error?.code).toBe('COMMAND_NOT_FOUND');
		});
	});

	describe('middleware', () => {
		it('runs registry middleware around the handler, inside client middleware', async () => {
			const { commands } = createTodoCommands();
			const order: string[] = [];
			const trace =
				(label: string): CommandMiddleware =>
				async (name, input, _context, next) => {
					order.push(`${label}:before:${name}:${JSON.stringify(input)}`);
					const result = await next();
					order.push(`${label}:after:${result.success}`);
					return result;
				};
			const client = createDirectClient(
				createDirectRegistry(commands, { middleware: [trace('registry')] }),
				{ middleware: [trace('client')] }
			);

			await client.call('todo-create', { title: 'Ordered' });

			expect(order).toEqual([
				'client:before:todo-create:{"title":"Ordered"}',
				// Registry middleware sees the validated input, defaults included.
				'registry:before:todo-create:{"title":"Ordered","priority":"medium"}',
				'registry:after:true',
				'client:after:true',
			]);
		});

		it('lets middleware short-circuit a call', async () => {
			const { commands, createHandler } = createTodoCommands();
			const denyMutations: CommandMiddleware = async (name, _input, _context, next) =>
				name === 'todo-create'
					? { success: false, error: { code: 'FORBIDDEN', message: 'Read-only session' } }
					: next();
			const client = createDirectClient(
				createDirectRegistry(commands, { middleware: [denyMutations] })
			);

			const result = await client.call('todo-create', { title: 'Blocked' });

			expect(result.error?.code).toBe('FORBIDDEN');
			expect(createHandler).not.toHaveBeenCalled();
		});

		it('does not run middleware for invalid input', async () => {
			const { commands } = createTodoCommands();
			const middleware = vi.fn<CommandMiddleware>(async (_n, _i, _c, next) => next());
			const registry = createDirectRegistry(commands, { middleware: [middleware] });

			await registry.execute('todo-create', { title: 42 });

			expect(middleware).not.toHaveBeenCalled();
		});
	});

	describe('context and errors', () => {
		it('propagates the DirectClient context and marks the interface', async () => {
			const { commands, contexts } = createTodoCommands();
			const client = createDirectClient(createDirectRegistry(commands), { source: 'copilot' });

			await client.call('todo-list', {}, { traceId: 'trace-42', interface: 'mcp' });

			expect(contexts[0]).toMatchObject({
				traceId: 'trace-42',
				source: 'copilot',
				interface: 'agent',
			});
		});

		it('hides exception details outside devMode and reports them to onError', async () => {
			const { commands } = createTodoCommands();
			const onError = vi.fn();
			const registry = createDirectRegistry(commands, { onError });

			const result = await registry.execute('todo-crash', {});

			expect(result.error).toMatchObject({
				code: 'COMMAND_EXECUTION_ERROR',
				message: 'An internal error occurred',
			});
			expect(JSON.stringify(result)).not.toContain('hunter2');
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'db password=hunter2' })
			);
		});

		it('shows exception messages in devMode and calls onCommand', async () => {
			const { commands } = createTodoCommands();
			const onCommand = vi.fn();
			const registry = createDirectRegistry(commands, { devMode: true, onCommand });

			const crashed = await registry.execute('todo-crash', {});
			await registry.execute('todo-list', {});

			expect(crashed.error?.message).toBe('db password=hunter2');
			expect(onCommand).toHaveBeenCalledWith(
				'todo-list',
				{},
				expect.objectContaining({ success: true })
			);
		});
	});

	it('lists commands with their input schemas', () => {
		const { commands } = createTodoCommands();
		const registry = createDirectRegistry(commands);

		const [create] = registry.listCommands();

		expect(create).toMatchObject({
			name: 'todo-create',
			description: 'Create a todo',
			mutation: true,
			inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
		});
	});

	it('rejects duplicate command names', () => {
		const { commands } = createTodoCommands();
		const [create] = commands;
		if (!create) throw new Error('expected commands');

		expect(() => createDirectRegistry([...commands, create])).toThrow(
			'Duplicate command name: todo-create'
		);
	});
});
