/**
 * A declared approval policy holds without the approval middleware: the engine dispatches a
 * gated call only when an approval step admitted it, and answers `APPROVAL_UNAVAILABLE` otherwise
 * (spec/command-metadata.md, "Approvals").
 */

import { createDirectClient } from '@lushly-dev/afd-client';
import type {
	ApprovalPolicy,
	CommandContext,
	CommandMiddleware,
	CommandResult,
} from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

const SECRET = 'test-approval-secret-0123456789abcdef';

function expectUnavailable(result: CommandResult, command: string): void {
	expect(result.success).toBe(false);
	expect(result.error).toMatchObject({
		code: 'APPROVAL_UNAVAILABLE',
		message: `${command} needs a person's approval, and this server cannot ask for it`,
		retryable: false,
	});
	expect(result.error?.suggestion).toContain('do not retry');
}

/** Commands with each kind of policy, and a record of which handlers ran. */
function fixture() {
	const ran: string[] = [];
	const command = (name: string, approval?: ApprovalPolicy<{ id: number }>) =>
		defineCommand({
			name,
			description: `Command ${name}`,
			...(approval !== undefined && { approval }),
			input: z.object({ id: z.number().default(0) }),
			handler: async (input) => {
				ran.push(`${name}:${input.id}`);
				return { success: true as const, data: { id: input.id } };
			},
		});
	const commands = [
		command('todo-delete', 'required'),
		command('todo-check', () => 'not-required'),
		command('todo-touch', 'not-required'),
		command('todo-list'),
	];
	return { ran, commands };
}

describe('a gated command without the approval middleware', () => {
	it('is refused by createMcpServer before the handler runs', async () => {
		const { ran, commands } = fixture();
		const server = createMcpServer({ name: 't', version: '1', commands });
		expectUnavailable(await server.execute('todo-delete', { id: 1 }), 'todo-delete');
		// A policy function is not evaluated: the declaration alone needs an approval step.
		expectUnavailable(await server.execute('todo-check', { id: 2 }), 'todo-check');
		expect(ran).toEqual([]);
	});

	it('is refused by createDirectRegistry, also with other middleware installed', async () => {
		const { ran, commands } = fixture();
		const passThrough: CommandMiddleware = (_name, _input, _context, next) => next();
		const registry = createDirectRegistry(commands, { middleware: [passThrough] });
		expectUnavailable(await registry.execute('todo-delete', { id: 1 }), 'todo-delete');
		expect(ran).toEqual([]);
	});

	it('is refused through DirectClient', async () => {
		const { ran, commands } = fixture();
		const client = createDirectClient(createDirectRegistry(commands));
		expectUnavailable(await client.call('todo-delete', { id: 1 }), 'todo-delete');
		expect(ran).toEqual([]);
	});

	it("runs a 'not-required' or undeclared policy", async () => {
		const { ran, commands } = fixture();
		const server = createMcpServer({ name: 't', version: '1', commands });
		expect((await server.execute('todo-touch', { id: 1 })).success).toBe(true);
		expect((await server.execute('todo-list', { id: 2 })).success).toBe(true);
		const registry = createDirectRegistry(commands);
		expect((await registry.execute('todo-list', { id: 3 })).success).toBe(true);
		expect(ran).toEqual(['todo-touch:1', 'todo-list:2', 'todo-list:3']);
	});

	it('checks every batch item and pipeline step on its own', async () => {
		const { ran, commands } = fixture();
		const engine = createExecutionEngine({
			commandMap: new Map(commands.map((command) => [command.name, command])),
			middleware: [],
			devMode: false,
		});
		const batch = await engine.executeBatch({
			commands: [
				{ command: 'todo-list', input: { id: 1 } },
				{ command: 'todo-delete', input: { id: 2 } },
			],
		});
		expect(batch.results[0]?.result.success).toBe(true);
		expect(batch.results[1]?.result.error?.code).toBe('APPROVAL_UNAVAILABLE');
		const server = createMcpServer({ name: 't', version: '1', commands });
		const pipe = await server.executePipeline({
			steps: [
				{ command: 'todo-list', input: { id: 3 } },
				{ command: 'todo-delete', input: { id: 4 } },
			],
		});
		expect(pipe.steps[1]?.error?.code).toBe('APPROVAL_UNAVAILABLE');
		expect(ran).toEqual(['todo-list:1', 'todo-list:3']);
	});

	it('refuses a gated command run from inside another command', async () => {
		const { ran, commands } = fixture();
		let nested: CommandResult | undefined;
		const outer = defineCommand({
			name: 'todo-sweep',
			description: 'Runs todo-delete from its handler',
			input: z.object({}),
			handler: async (_input, context) => {
				nested = await registry.execute('todo-delete', { id: 9 }, context);
				return { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([...commands, outer]);
		expect((await registry.execute('todo-sweep', {})).success).toBe(true);
		expectUnavailable(nested as CommandResult, 'todo-delete');
		expect(ran).toEqual([]);
	});
});

describe('the approval middleware decides from the command it runs', () => {
	it('holds a gated command missing from its commands list', async () => {
		const { ran, commands } = fixture();
		const server = createMcpServer({
			name: 't',
			version: '1',
			commands,
			middleware: [createApprovalMiddleware({ secret: SECRET, commands: [] })],
		});
		const held = await server.execute('todo-delete', { id: 1 });
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		expect((await server.execute('todo-check', { id: 2 })).success).toBe(true);
		expect(ran).toEqual(['todo-check:2']);
	});

	it('works without a commands list, and the retry with the token runs', async () => {
		const { ran, commands } = fixture();
		const registry = createDirectRegistry(commands, {
			middleware: [createApprovalMiddleware({ secret: SECRET })],
		});
		const client = createDirectClient(registry, { onApprovalNeeded: async () => true });
		const result = await client.call('todo-delete', { id: 5 });
		expect(result).toMatchObject({ success: true, data: { id: 5 } });
		expect((await client.call('todo-list', { id: 6 })).success).toBe(true);
		expect(ran).toEqual(['todo-delete:5', 'todo-list:6']);
	});

	it('uses the confirmPrompt of the command it runs as the summary', async () => {
		const prompted = defineCommand({
			name: 'todo-purge',
			description: 'Purge',
			approval: 'required',
			confirmPrompt: 'Purge every todo',
			input: z.object({}),
			handler: async () => ({ success: true as const, data: null }),
		});
		const registry = createDirectRegistry([prompted], {
			middleware: [createApprovalMiddleware({ secret: SECRET })],
		});
		const asked = vi.fn(async () => false);
		await createDirectClient(registry, { onApprovalNeeded: asked }).call('todo-purge', {});
		expect(asked).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Purge every todo' }));
	});

	it('does not let a nested call inherit the outer call’s admission', async () => {
		const ran: string[] = [];
		let nested: CommandResult | undefined;
		const inner = defineCommand({
			name: 'todo-delete',
			description: 'Delete',
			approval: 'required',
			input: z.object({}),
			handler: async () => {
				ran.push('inner');
				return { success: true as const, data: null };
			},
		});
		const outer = defineCommand({
			name: 'todo-sweep',
			description: 'Admitted by its policy, then runs todo-delete',
			approval: () => 'not-required',
			input: z.object({}),
			handler: async (_input, context: CommandContext) => {
				ran.push('outer');
				nested = await server.execute('todo-delete', {}, context);
				return { success: true as const, data: null };
			},
		});
		const server = createMcpServer({
			name: 't',
			version: '1',
			commands: [inner, outer],
			middleware: [createApprovalMiddleware({ secret: SECRET })],
		});
		expect((await server.execute('todo-sweep', {})).success).toBe(true);
		expect(nested?.error?.code).toBe('APPROVAL_REQUIRED');
		expect(ran).toEqual(['outer']);
	});

	it('admits through a second installed copy, which shares the records on globalThis', async () => {
		const { ran, commands } = fixture();
		// What another copy of the package's middleware does: mark the call through the shared map.
		const otherCopy: CommandMiddleware = (_name, _input, context, next) => {
			const shared = (globalThis as Record<symbol, unknown>)[
				Symbol.for('dev.afd/approval-admission')
			] as WeakMap<CommandContext, { admitted: boolean }>;
			const record = shared.get(context);
			if (record) record.admitted = true;
			return next();
		};
		const registry = createDirectRegistry(commands, { middleware: [otherCopy] });
		expect((await registry.execute('todo-delete', { id: 1 })).success).toBe(true);
		expect(ran).toEqual(['todo-delete:1']);
	});

	it('still validates a commands list when one is given', () => {
		expect(() =>
			createApprovalMiddleware({
				secret: SECRET,
				commands: [{ name: 'x', approval: 'sometimes' as never }],
			})
		).toThrow(/invalid approval policy/);
	});
});
