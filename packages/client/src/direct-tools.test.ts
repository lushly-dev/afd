/**
 * @fileoverview DirectClient's `activeContext` call option and `listTools` (#527, part 3).
 *
 * The active context reaches the registry as its own call option, beside the command context, on
 * every attempt and every pipeline step; `listTools` forwards to the registry with `allow` applied.
 * The server package tests the same against `createDirectRegistry` with a tool surface.
 */

import type { CommandContext, CommandResult, McpTool } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import {
	holdDirectApproval,
	takeDirectApproval,
} from '@lushly-dev/afd-core/internal/direct-approval';
import { describe, expect, it, vi } from 'vitest';
import {
	createDirectClient,
	type DirectExecuteOptions,
	type DirectListToolsOptions,
	type DirectRegistry,
} from './direct.js';

interface Call {
	name: string;
	context: CommandContext;
	options?: DirectExecuteOptions;
	arity: number;
}

const TOOLS: McpTool[] = [
	{ name: 'afd-call', inputSchema: { type: 'object' } },
	{ name: 'note-list', inputSchema: { type: 'object' } },
	{ name: 'note-delete', inputSchema: { type: 'object' } },
];

function recordingRegistry(extra: Partial<DirectRegistry> = {}) {
	const calls: Call[] = [];
	const registry: DirectRegistry = {
		async execute<T>(...args: [string, unknown?, CommandContext?, DirectExecuteOptions?]) {
			const [name, , context = {}, options] = args;
			calls.push({ name, context: { ...context }, options, arity: args.length });
			return success({ name }) as CommandResult<T>;
		},
		listCommandNames: () => ['note-list', 'note-delete'],
		listCommands: () => [
			{ name: 'note-list', description: 'List notes' },
			{ name: 'note-delete', description: 'Delete a note' },
		],
		hasCommand: (name) => name === 'note-list' || name === 'note-delete',
		...extra,
	};
	return { registry, calls };
}

describe('DirectClient activeContext', () => {
	it('passes it to the registry as a call option, never in the command context', async () => {
		const { registry, calls } = recordingRegistry();
		const client = createDirectClient(registry);

		await client.call('note-list', {}, { activeContext: 'writing', tenant: 'acme' });
		await client.call('note-list', {}, { tenant: 'acme' });

		expect(calls[0]?.options).toEqual({ activeContext: 'writing' });
		expect(calls[0]?.context).toEqual(expect.objectContaining({ tenant: 'acme' }));
		expect(calls[0]?.context).not.toHaveProperty('activeContext');
		// Without one, the registry is called exactly as before.
		expect(calls[1]?.arity).toBe(3);
		expect(calls[1]?.options).toBeUndefined();
	});

	it('passes it with every pipeline step', async () => {
		const { registry, calls } = recordingRegistry();
		const client = createDirectClient(registry);

		await client.pipe(
			[{ command: 'note-list' }, { command: 'note-delete', input: { id: '$prev.name' } }],
			{
				activeContext: 'writing',
			}
		);

		expect(calls.map((call) => call.options)).toEqual([
			{ activeContext: 'writing' },
			{ activeContext: 'writing' },
		]);
		expect(calls.every((call) => !('activeContext' in call.context))).toBe(true);
	});

	it('passes it again on the approval retry', async () => {
		const options: Array<DirectExecuteOptions | undefined> = [];
		const { registry } = recordingRegistry({
			async execute<T>(
				_name: string,
				_input?: unknown,
				context: CommandContext = {},
				callOptions?: DirectExecuteOptions
			) {
				options.push(callOptions);
				if (takeDirectApproval(context) === 'tok-1')
					return success({ deleted: true }) as CommandResult<T>;
				holdDirectApproval(context, {
					approvalToken: 'tok-1',
					expiresAt: '2026-10-31T12:01:00.000Z',
					summary: 'Delete a note',
				});
				return failure({
					code: 'APPROVAL_REQUIRED',
					message: 'note-delete needs approval',
					suggestion: 'Ask the user',
				});
			},
		});
		const hook = vi.fn(async () => true);
		const client = createDirectClient(registry, { onApprovalNeeded: hook });

		const result = await client.call('note-delete', { id: 1 }, { activeContext: 'writing' });

		expect(result.success).toBe(true);
		expect(hook).toHaveBeenCalledOnce();
		expect(options).toEqual([{ activeContext: 'writing' }, { activeContext: 'writing' }]);
	});
});

describe('DirectClient listTools', () => {
	it('forwards to the registry and leaves out the tools allow refuses', () => {
		const listTools = vi.fn((_options?: DirectListToolsOptions) => TOOLS);
		const { registry } = recordingRegistry({ listTools });
		const client = createDirectClient(registry, {
			allow: (name) => name !== 'note-delete',
		});

		const options: DirectListToolsOptions = { strategy: 'lazy', activeContext: 'writing' };
		expect(client.listTools(options).map((tool) => tool.name)).toEqual(['afd-call', 'note-list']);
		expect(listTools).toHaveBeenCalledWith(options);
		expect(createDirectClient(registry).listTools()).toHaveLength(3);
	});

	it('throws when the registry cannot list tools', () => {
		const { registry } = recordingRegistry();
		expect(() => createDirectClient(registry).listTools()).toThrow(TypeError);
		expect(() => createDirectClient(registry).listTools()).toThrow('createDirectToolSurface');
	});
});
