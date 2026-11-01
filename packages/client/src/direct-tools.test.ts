/**
 * @fileoverview DirectClient's `activeContext` and `allow` call options and `listTools` (#527,
 * part 3, and #577), and DirectTransport's `tools/list` over a registry with a tool surface.
 *
 * The active context and the allow check reach the registry as call options, beside the command
 * context, on every attempt and every pipeline step; `listTools` forwards to the registry with
 * `allow` passed and applied. The server package tests the same against `createDirectRegistry`
 * with a tool surface.
 */

import type { CommandContext, CommandResult, McpResponse, McpTool } from '@lushly-dev/afd-core';
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
	DirectTransport,
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

describe('DirectClient allow call option', () => {
	const allowed = new Set(['afd-call', 'note-list']);

	it('passes the client’s check to the registry, alone or beside activeContext', async () => {
		const { registry, calls } = recordingRegistry({ hasCommand: () => true });
		const client = createDirectClient(registry, { allow: (name) => allowed.has(name) });

		await client.call('afd-call', { command: 'note-delete' });
		await client.call('note-list', {}, { activeContext: 'writing' });

		expect(calls.map((call) => call.name)).toEqual(['afd-call', 'note-list']);
		expect(calls[0]?.options).toEqual({ allow: expect.any(Function) });
		expect(calls[1]?.options).toEqual({ activeContext: 'writing', allow: expect.any(Function) });
		const allow = calls[0]?.options?.allow;
		expect(allow?.('note-list')).toBe(true);
		expect(allow?.('note-delete')).toBe(false);
		// Never a command-context value.
		expect(calls.every((call) => !('allow' in call.context))).toBe(true);
	});

	it('passes a check that denies when the client’s predicate throws', async () => {
		const { registry, calls } = recordingRegistry({ hasCommand: () => true });
		let throwing = false;
		const client = createDirectClient(registry, {
			allow: () => {
				if (throwing) throw new Error('policy unavailable');
				return true;
			},
		});

		await client.call('afd-call', {});
		throwing = true;
		expect(calls[0]?.options?.allow?.('note-list')).toBe(false);
	});

	it('passes it with every pipeline step', async () => {
		const { registry, calls } = recordingRegistry({ hasCommand: () => true });
		const client = createDirectClient(registry, { allow: (name) => allowed.has(name) });

		await client.pipe([
			{ command: 'note-list' },
			{ command: 'afd-call', input: { command: 'note-delete' } },
		]);

		expect(calls.map((call) => call.name)).toEqual(['note-list', 'afd-call']);
		expect(calls.every((call) => typeof call.options?.allow === 'function')).toBe(true);
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
		const client = createDirectClient(registry, {
			allow: (name) => name.startsWith('note-'),
			onApprovalNeeded: async () => true,
		});

		const result = await client.call('note-delete', { id: 1 });

		expect(result.success).toBe(true);
		expect(options).toHaveLength(2);
		expect(options.every((callOptions) => typeof callOptions?.allow === 'function')).toBe(true);
	});

	it('passes nothing for a client without allow', async () => {
		const { registry, calls } = recordingRegistry();
		await createDirectClient(registry).call('note-list', {});
		expect(calls[0]?.arity).toBe(3);
		expect(calls[0]?.options).toBeUndefined();
	});
});

describe('DirectClient listTools', () => {
	it('forwards to the registry with allow, and leaves out the tools allow refuses', () => {
		const listTools = vi.fn(
			(_options?: DirectListToolsOptions & Pick<DirectExecuteOptions, 'allow'>) => TOOLS
		);
		const { registry } = recordingRegistry({ listTools });
		const client = createDirectClient(registry, {
			allow: (name) => name !== 'note-delete',
		});

		const options: DirectListToolsOptions = { strategy: 'lazy', activeContext: 'writing' };
		expect(client.listTools(options).map((tool) => tool.name)).toEqual(['afd-call', 'note-list']);
		expect(listTools).toHaveBeenCalledWith({ ...options, allow: expect.any(Function) });
		expect(listTools.mock.calls[0]?.[0]?.allow?.('note-delete')).toBe(false);

		listTools.mockClear();
		expect(createDirectClient(registry).listTools(options)).toHaveLength(3);
		expect(listTools).toHaveBeenCalledWith(options);
	});

	it('throws when the registry cannot list tools', () => {
		const { registry } = recordingRegistry();
		expect(() => createDirectClient(registry).listTools()).toThrow(TypeError);
		expect(() => createDirectClient(registry).listTools()).toThrow('createDirectToolSurface');
	});
});

describe('DirectTransport tools/list', () => {
	async function listed(registry: DirectRegistry): Promise<McpResponse> {
		const transport = new DirectTransport(registry);
		await transport.connect();
		return transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
	}
	const names = (response: McpResponse) =>
		(response.result as { tools: McpTool[] }).tools.map((tool) => tool.name);

	it('uses the registry’s listTools when it has one', async () => {
		const { registry } = recordingRegistry({ listTools: () => TOOLS });
		expect(names(await listed(registry))).toEqual(['afd-call', 'note-list', 'note-delete']);
	});

	it('falls back to listCommands without listTools, or when it has no tool surface', async () => {
		const { registry } = recordingRegistry();
		expect(names(await listed(registry))).toEqual(['note-list', 'note-delete']);

		const { registry: noSurface } = recordingRegistry({
			listTools: () => {
				throw new TypeError('This registry has no tool surface');
			},
		});
		expect(names(await listed(noSurface))).toEqual(['note-list', 'note-delete']);
	});

	it('answers an internal error when listTools fails otherwise', async () => {
		const { registry } = recordingRegistry({
			listTools: () => {
				throw new Error('broken');
			},
		});
		const response = await listed(registry);
		expect(response.error?.code).toBe(-32603);
	});
});
