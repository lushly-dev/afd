/**
 * A declared approval policy holds without the approval middleware: the engine dispatches a
 * gated call only when an approval step admitted it, and answers `APPROVAL_UNAVAILABLE` otherwise
 * (spec/command-metadata.md, "Approvals").
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDirectClient } from '@lushly-dev/afd-client';
import type {
	ApprovalPolicy,
	CommandContext,
	CommandMiddleware,
	CommandResult,
} from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { installAdmissionRecords } from './approval-admission.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import { createRetryMiddleware } from './middleware.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';

const SECRET = 'test-approval-secret-0123456789abcdef';

function expectUnavailable(
	result: CommandResult,
	command: string,
	reason: 'no-approval-step' | 'admission-mismatch' = 'no-approval-step'
): void {
	expect(result.success).toBe(false);
	expect(result.error).toMatchObject({
		code: 'APPROVAL_UNAVAILABLE',
		message: `${command} needs a person's approval, and this server cannot ask for it`,
		retryable: false,
		details: { reason },
	});
	expect(result.error?.suggestion?.toLowerCase()).toContain('do not retry');
	// The operator fixes the approval setup (spec/recovery.md, "Engine errors").
	expect(result.error?.recovery).toEqual({ kind: 'external' });
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

	it('admits through an independently loaded copy of the middleware module', async () => {
		const { ran, commands } = fixture();
		vi.resetModules();
		const other = (await import('./approval.js')) as typeof import('./approval.js');
		expect(other.createApprovalMiddleware).not.toBe(createApprovalMiddleware);
		// The engine is this file's copy; the approval middleware is the other copy's.
		const engine = createExecutionEngine({
			commandMap: new Map(commands.map((command) => [command.name, command])),
			middleware: [other.createApprovalMiddleware({ secret: SECRET })],
			devMode: false,
		});
		const held = await engine.executeCommand('todo-delete', { id: 1 });
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		const token = (held.error?.details as { approvalToken?: string } | undefined)?.approvalToken;
		const retried = await engine.executeCommand('todo-delete', { id: 1 }, { approval: token });
		expect(retried).toMatchObject({ success: true, data: { id: 1 } });
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

describe('one admission runs one handler, on what was approved', () => {
	/** A registry whose todo-delete is approved through DirectClient, with `after` behind approval. */
	function approved(after: CommandMiddleware) {
		const { ran, commands } = fixture();
		const registry = createDirectRegistry(commands, {
			middleware: [createApprovalMiddleware({ secret: SECRET }), after],
		});
		return { ran, client: createDirectClient(registry, { onApprovalNeeded: async () => true }) };
	}

	it('refuses a retry inside the chain after the approval middleware', async () => {
		let attempts = 0;
		const handled = vi.fn();
		const flaky = defineCommand({
			name: 'todo-delete',
			description: 'Fails once with a transient error',
			approval: 'required',
			input: z.object({ id: z.number() }),
			handler: async () => {
				handled();
				attempts++;
				return attempts === 1
					? { success: false as const, error: { code: 'TRANSIENT_ERROR', message: 'try again' } }
					: { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([flaky], {
			middleware: [
				createApprovalMiddleware({ secret: SECRET }),
				createRetryMiddleware({ maxRetries: 2, retryDelay: 0, jitter: false }),
			],
		});
		const client = createDirectClient(registry, { onApprovalNeeded: async () => true });
		const result = await client.call('todo-delete', { id: 1 });
		expect(handled).toHaveBeenCalledOnce();
		expectUnavailable(result, 'todo-delete', 'admission-mismatch');
		expect(result.error?.suggestion).toContain('before the approval middleware');
	});

	it('refuses an input changed in place after the approval', async () => {
		const { ran, client } = approved((_name, input, _context, next) => {
			(input as { id: number }).id = 99;
			return next();
		});
		expectUnavailable(
			await client.call('todo-delete', { id: 1 }),
			'todo-delete',
			'admission-mismatch'
		);
		expect(ran).toEqual([]);
	});

	it('refuses an admission for another command', async () => {
		const { ran, commands } = fixture();
		const approval = createApprovalMiddleware({ secret: SECRET, commands });
		// Asks the middleware about a command its policy lets through, then lets the gated one
		// through.
		const swap: CommandMiddleware = (_name, input, context, next) =>
			approval('todo-check', input, context, next);
		const registry = createDirectRegistry(commands, { middleware: [swap] });
		expectUnavailable(
			await registry.execute('todo-delete', { id: 1 }),
			'todo-delete',
			'admission-mismatch'
		);
		expect(ran).toEqual([]);
	});

	it('runs an approved call whose middleware after the approval leaves it alone', async () => {
		const { ran, client } = approved((_name, _input, _context, next) => next());
		expect((await client.call('todo-delete', { id: 2 })).success).toBe(true);
		expect(ran).toEqual(['todo-delete:2']);
	});

	/** todo-tag, whose validated input holds a Set (canonical JSON refuses it), with `after` behind approval. */
	function tagged(approval: ApprovalPolicy<{ tags: Set<string> }>, after?: CommandMiddleware) {
		const handled = vi.fn();
		const asked = vi.fn();
		const tag = defineCommand({
			name: 'todo-tag',
			description: 'Its validated input holds a Set, which canonical JSON refuses',
			approval,
			input: z.object({ tags: z.array(z.string()).transform((tags) => new Set(tags)) }),
			handler: async () => {
				handled();
				return { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([tag], {
			middleware: [
				createApprovalMiddleware({ secret: SECRET, onApprovalRequired: asked }),
				...(after ? [after] : []),
			],
		});
		return { handled, asked, registry };
	}

	it('answers a held call on an input with no canonical form without asking anyone', async () => {
		const { handled, asked, registry } = tagged('required');
		const result = await registry.execute('todo-tag', { tags: ['a'] });
		expect(result).toMatchObject({
			success: false,
			error: {
				code: 'APPROVAL_UNAVAILABLE',
				message: "todo-tag needs a person's approval, and this input cannot be bound to one",
				suggestion:
					"Do not retry with this input: it has no exact canonical form, so an approval cannot be bound to it. Send the input in a form canonical JSON accepts (for example, an integer a JavaScript number cannot hold exactly, such as 2^53 + 1, as a string). If the command's schema itself produces such a value (a Set, Map, bigint or class instance), tell the user: the operator must change the schema.",
				retryable: false,
				details: { reason: 'input-not-canonical' },
			},
		});
		expect(result.error?.recovery).toBeUndefined();
		expect(asked).not.toHaveBeenCalled();
		expect(handled).not.toHaveBeenCalled();
	});

	it('runs a call its policy lets through on an input with no canonical form', async () => {
		const { handled, registry } = tagged(() => 'not-required');
		expect((await registry.execute('todo-tag', { tags: ['a'] })).success).toBe(true);
		expect(handled).toHaveBeenCalledOnce();
	});

	it('refuses such an input given a canonical form after the approval', async () => {
		// Compared by identity, so this is refused because the replaced member gives the input a
		// canonical form; a change inside the same Set would not be seen.
		const { handled, registry } = tagged(
			() => 'not-required',
			(_name, input, _context, next) => {
				(input as { tags: unknown }).tags = ['changed'];
				return next();
			}
		);
		expectUnavailable(
			await registry.execute('todo-tag', { tags: ['a'] }),
			'todo-tag',
			'admission-mismatch'
		);
		expect(handled).not.toHaveBeenCalled();
	});

	it('runs a top-level NaN input its policy lets through', async () => {
		const handled = vi.fn();
		const nan = defineCommand({
			name: 'todo-nan',
			description: 'Its validated input is NaN, which is not equal to itself',
			approval: () => 'not-required',
			input: z.object({}).transform(() => Number.NaN),
			handler: async () => {
				handled();
				return { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([nan], {
			middleware: [createApprovalMiddleware({ secret: SECRET })],
		});
		expect((await registry.execute('todo-nan', {})).success).toBe(true);
		expect(handled).toHaveBeenCalledOnce();
	});

	it('refuses, without asking, an input its policy function changed', async () => {
		const handled = vi.fn();
		const asked = vi.fn();
		const remove = defineCommand({
			name: 'todo-delete',
			description: 'Its policy function changes the input it decides on',
			approval: async (input: { id: number }) => {
				input.id = 9;
				return 'required' as const;
			},
			input: z.object({ id: z.number() }),
			handler: async () => {
				handled();
				return { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([remove], {
			middleware: [createApprovalMiddleware({ secret: SECRET, onApprovalRequired: asked })],
		});
		const changed = await registry.execute('todo-delete', { id: 1 });
		expect(changed).toMatchObject({
			success: false,
			error: {
				code: 'APPROVAL_UNAVAILABLE',
				message: "todo-delete's input changed while its approval was being decided",
				retryable: false,
				details: { reason: 'admission-mismatch' },
			},
		});
		expect(changed.error?.recovery).toEqual({ kind: 'external' });
		expect(asked).not.toHaveBeenCalled();
		expect(handled).not.toHaveBeenCalled();
	});

	it('admits the input the token was verified against, not one changed while it was checked', async () => {
		const { ran, commands } = fixture();
		let seen: { id: number } | undefined;
		const capture: CommandMiddleware = (_name, input, _context, next) => {
			seen = input as { id: number };
			return next();
		};
		const engine = createExecutionEngine({
			commandMap: new Map(commands.map((command) => [command.name, command])),
			middleware: [
				capture,
				createApprovalMiddleware({
					secret: SECRET,
					// The input changes while the nonce is being spent.
					nonceStore: {
						consume: async () => {
							if (seen) seen.id = 2;
							return true;
						},
					},
				}),
			],
			devMode: false,
		});
		const held = await engine.executeCommand('todo-delete', { id: 1 });
		const token = (held.error?.details as { approvalToken?: string } | undefined)?.approvalToken;
		expect(token).toBeTypeOf('string');
		expectUnavailable(
			await engine.executeCommand('todo-delete', { id: 1 }, { approval: token }),
			'todo-delete',
			'admission-mismatch'
		);
		expect(ran).toEqual([]);
	});
});

describe('a policy given only in the commands list', () => {
	it('still holds the command', async () => {
		const ran = vi.fn();
		const wipe = defineCommand({
			name: 'todo-wipe',
			description: 'Wipe todos; its gate is declared only in the middleware list',
			input: z.object({}),
			handler: async () => {
				ran();
				return { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([wipe], {
			middleware: [
				createApprovalMiddleware({
					secret: SECRET,
					commands: [{ name: 'todo-wipe', approval: 'required' }],
				}),
			],
		});
		const held = await registry.execute('todo-wipe', {});
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		expect(ran).not.toHaveBeenCalled();
	});

	it('holds when a listed function holds, though the command declares not-required', async () => {
		const { ran, commands } = fixture();
		const registry = createDirectRegistry(commands, {
			middleware: [
				createApprovalMiddleware({
					secret: SECRET,
					commands: [{ name: 'todo-touch', approval: () => 'required' }],
				}),
			],
		});
		expect((await registry.execute('todo-touch', { id: 1 })).error?.code).toBe('APPROVAL_REQUIRED');
		expect(ran).toEqual([]);
	});

	/** todo-list, ungated by its own declaration, gated by the list; approved through DirectClient. */
	function listedApproval(after: CommandMiddleware, handler?: () => CommandResult) {
		const handled = vi.fn();
		const list = defineCommand({
			name: 'todo-list',
			description: 'Its gate is declared only in the middleware list',
			input: z.object({ id: z.number() }),
			handler: async (input) => {
				handled(input.id);
				return handler?.() ?? { success: true as const, data: null };
			},
		});
		const registry = createDirectRegistry([list], {
			middleware: [
				createApprovalMiddleware({
					secret: SECRET,
					commands: [{ name: 'todo-list', approval: 'required' }],
				}),
				after,
			],
		});
		return {
			handled,
			client: createDirectClient(registry, { onApprovalNeeded: async () => true }),
		};
	}

	it('runs one handler per approval, refusing a retry after the approval middleware', async () => {
		let attempts = 0;
		const { handled, client } = listedApproval(
			createRetryMiddleware({ maxRetries: 2, retryDelay: 0, jitter: false }),
			() =>
				++attempts === 1
					? { success: false, error: { code: 'TRANSIENT_ERROR', message: 'try again' } }
					: { success: true, data: null }
		);
		const result = await client.call('todo-list', { id: 1 });
		expect(handled).toHaveBeenCalledOnce();
		expectUnavailable(result, 'todo-list', 'admission-mismatch');
	});

	it('refuses an input changed in place after the approval', async () => {
		const { handled, client } = listedApproval((_name, input, _context, next) => {
			(input as { id: number }).id = 99;
			return next();
		});
		expectUnavailable(await client.call('todo-list', { id: 1 }), 'todo-list', 'admission-mismatch');
		expect(handled).not.toHaveBeenCalled();
	});

	it('runs an approved call that nothing changed after the approval', async () => {
		const { handled, client } = listedApproval((_name, _input, _context, next) => next());
		expect((await client.call('todo-list', { id: 3 })).success).toBe(true);
		expect(handled).toHaveBeenCalledWith(3);
	});

	it('refuses a call renamed to an ungated command on its way to the approval middleware', async () => {
		const handled = vi.fn();
		const wipe = defineCommand({
			name: 'todo-wipe',
			description: 'Its gate is declared only in the middleware list',
			input: z.object({}),
			handler: async () => {
				handled();
				return { success: true as const, data: null };
			},
		});
		const approval = createApprovalMiddleware({
			secret: SECRET,
			commands: [{ name: 'todo-wipe', approval: 'required' }],
		});
		const rename: CommandMiddleware = (_name, input, context, next) =>
			approval('todo-list', input, context, next);
		const registry = createDirectRegistry([wipe], { middleware: [rename] });
		expectUnavailable(await registry.execute('todo-wipe', {}), 'todo-wipe');
		expect(handled).not.toHaveBeenCalled();
	});

	it('runs an approved call behind a second approval middleware that does not gate it', async () => {
		const { handled, client } = listedApproval(createApprovalMiddleware({ secret: SECRET }));
		expect((await client.call('todo-list', { id: 4 })).success).toBe(true);
		expect(handled).toHaveBeenCalledWith(4);
	});

	it('refuses a retry between it and a second approval middleware that also lists it', async () => {
		let attempts = 0;
		const retry = createRetryMiddleware({ maxRetries: 2, retryDelay: 0, jitter: false });
		// Lists the command with a policy that lets it through, so it admits the call too.
		const other = createApprovalMiddleware({
			secret: SECRET,
			commands: [{ name: 'todo-list', approval: () => 'not-required' }],
		});
		const { handled, client } = listedApproval(
			(name, input, context, next) =>
				retry(name, input, context, () => other(name, input, context, next)),
			() =>
				++attempts === 1
					? { success: false, error: { code: 'TRANSIENT_ERROR', message: 'try again' } }
					: { success: true, data: null }
		);
		const result = await client.call('todo-list', { id: 6 });
		expect(handled).toHaveBeenCalledOnce();
		expectUnavailable(result, 'todo-list', 'admission-mismatch');
	});

	it('refuses a retry between it and a second approval middleware that does not gate it', async () => {
		let attempts = 0;
		const retry = createRetryMiddleware({ maxRetries: 2, retryDelay: 0, jitter: false });
		const other = createApprovalMiddleware({ secret: SECRET });
		const { handled, client } = listedApproval(
			(name, input, context, next) =>
				retry(name, input, context, () => other(name, input, context, next)),
			() =>
				++attempts === 1
					? { success: false, error: { code: 'TRANSIENT_ERROR', message: 'try again' } }
					: { success: true, data: null }
		);
		const result = await client.call('todo-list', { id: 5 });
		expect(handled).toHaveBeenCalledOnce();
		expectUnavailable(result, 'todo-list', 'admission-mismatch');
	});
});

describe('over MCP tools/call, with no approval middleware', () => {
	it('refuses a gated command through its own tool and afd-call, before the handler', async () => {
		const { ran, commands } = fixture();
		const handler = createMcpHandler({
			name: 'fail-closed',
			version: '1.0.0',
			commands: commands.map((command) => ({
				...command,
				expose: { mcp: true },
			})) as typeof commands,
			host: '127.0.0.1',
			toolStrategy: 'individual',
		});
		const http = createServer(handler);
		await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
		const client = new Client({ name: 'fail-closed-client', version: '0' });
		try {
			const port = (http.address() as AddressInfo).port;
			await client.connect(
				new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
			);
			for (const call of [
				{ name: 'todo-delete', arguments: { id: 1 } },
				{ name: 'afd-call', arguments: { command: 'todo-delete', input: { id: 2 } } },
			]) {
				const result = await client.callTool(call);
				const content = (result as { content: Array<{ text: string }> }).content;
				const body = JSON.parse(content[0]?.text ?? '{}') as CommandResult;
				expect(body.error?.code).toBe('APPROVAL_UNAVAILABLE');
				expect((result as { isError?: boolean }).isError).toBe(true);
			}
			expect(ran).toEqual([]);
		} finally {
			await client.close();
			handler.dispose();
			http.closeAllConnections();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		}
	});
});

describe('the shared admission records', () => {
	const KEY = Symbol.for('dev.afd/approval-admission');

	it('are installed once on globalThis, non-writable and non-configurable', () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, KEY);
		expect(descriptor).toMatchObject({ writable: false, configurable: false, enumerable: false });
		expect(Object.getPrototypeOf(descriptor?.value)).toBe(WeakMap.prototype);
		expect(installAdmissionRecords()).toBe(descriptor?.value);
	});

	it('install on a free holder and are shared by a copy that finds them', () => {
		const holder = {};
		const first = installAdmissionRecords(holder);
		expect(installAdmissionRecords(holder)).toBe(first);
		expect(() => {
			(holder as Record<symbol, unknown>)[KEY] = new WeakMap();
		}).toThrow(TypeError);
	});

	it('ignore anything else pre-installed under the key', () => {
		class Admitting extends WeakMap<object, unknown> {}
		const impostors: Array<[unknown, PropertyDescriptor]> = [
			[new WeakMap(), { writable: true, configurable: true }],
			[new Admitting(), { writable: false, configurable: false }],
			[{ get: () => ({ admitted: true }) }, { writable: false, configurable: false }],
			[Object.assign(new WeakMap(), { get: () => ({}) }), { writable: false, configurable: false }],
		];
		for (const [value, flags] of impostors) {
			const holder = {};
			Object.defineProperty(holder, KEY, { value, ...flags });
			const records = installAdmissionRecords(holder);
			expect(records).not.toBe(value);
			expect(Object.getPrototypeOf(records)).toBe(WeakMap.prototype);
		}
	});
});
