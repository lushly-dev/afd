/**
 * The `afd call` approval flow (#417), against a real registry with `createApprovalMiddleware`.
 * Time comes from a manual clock, never the wall clock.
 */

import { PassThrough } from 'node:stream';
import { type CommandResult, fixedClock, success } from '@lushly-dev/afd-core';
import { createApprovalMiddleware, createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	type ApprovalPrompt,
	approvalDetails,
	callWithApproval,
	createTerminalApproval,
	describeApproval,
} from './approval.js';

const SECRET = 'cli-approval-test-secret-0123456789abcdef';

function setup() {
	const clock = fixedClock('2026-10-26T12:00:00Z');
	const deleted: number[] = [];
	const commands = [
		defineCommand({
			name: 'todo-delete',
			description: 'Delete a todo',
			mutation: true,
			destructive: true,
			confirmPrompt: 'Delete the todo (permanent)',
			approval: 'required',
			input: z.object({ id: z.number() }),
			handler: async ({ id }) => {
				deleted.push(id);
				return success({ deleted: id });
			},
		}),
		defineCommand({
			name: 'todo-purge',
			description: 'Delete every todo',
			mutation: true,
			destructive: true,
			approval: 'required',
			input: z.object({}),
			handler: async () => success({ purged: true }),
		}),
		defineCommand({
			name: 'todo-list',
			description: 'List todos',
			approval: 'not-required',
			input: z.object({}),
			handler: async () => success({ items: [] }),
		}),
	];
	const server = createMcpServer({
		name: 'approval-cli',
		version: '1.0.0',
		commands,
		middleware: [createApprovalMiddleware({ secret: SECRET, commands, clock })],
	});
	const attempts: Array<string | undefined> = [];
	const call =
		(name: string, input: Record<string, unknown>) =>
		(approval?: string): Promise<CommandResult> => {
			attempts.push(approval);
			return server.execute(name, input, {
				interface: 'cli',
				...(approval !== undefined ? { approval } : {}),
			});
		};
	return { clock, deleted, server, attempts, call };
}

function sink() {
	const stream = new PassThrough();
	let text = '';
	stream.setEncoding('utf8').on('data', (chunk: string) => {
		text += chunk;
	});
	return { stream, text: () => text };
}

const yes: ApprovalPrompt = async () => true;
const no: ApprovalPrompt = async () => false;

describe('callWithApproval', () => {
	it('runs a call that needs no approval once, without asking', async () => {
		const { call, attempts } = setup();
		const prompt = vi.fn(yes);
		const result = await callWithApproval('todo-list', call('todo-list', {}), { prompt });
		expect(result.success).toBe(true);
		expect(prompt).not.toHaveBeenCalled();
		expect(attempts).toEqual([undefined]);
	});

	it('shows the summary and expiry, and retries with the issued token on yes', async () => {
		const { call, attempts, deleted } = setup();
		const out = sink();
		const prompt = vi.fn(yes);

		const result = await callWithApproval('todo-delete', call('todo-delete', { id: 42 }), {
			prompt,
			output: out.stream,
		});

		expect(result).toMatchObject({ success: true, data: { deleted: 42 } });
		expect(deleted).toEqual([42]);
		expect(prompt).toHaveBeenCalledOnce();
		const [, details] = prompt.mock.calls[0] ?? [];
		expect(details?.approvalToken).toMatch(/^afdap1\./);
		// The retry carried exactly the token the server issued, nothing the CLI made.
		expect(attempts).toEqual([undefined, details?.approvalToken]);
		expect(out.text()).toContain('todo-delete needs approval before it runs.');
		expect(out.text()).toContain('Action: Delete the todo (permanent)');
		expect(out.text()).toContain('Approval expires: 2026-10-26T12:05:00.000Z');
	});

	it('returns the held result unchanged when the human says no', async () => {
		const { call, attempts, deleted, server } = setup();
		const first = await server.execute('todo-delete', { id: 42 }, { interface: 'cli' });

		const result = await callWithApproval('todo-delete', call('todo-delete', { id: 42 }), {
			prompt: no,
			output: sink().stream,
		});

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(Object.keys(result.error?.details ?? {}).sort()).toEqual(
			Object.keys(first.error?.details ?? {}).sort()
		);
		expect(deleted).toEqual([]);
		expect(attempts).toEqual([undefined]);
	});

	it('returns the held result unchanged with no terminal and no --approve', async () => {
		const { call, attempts, deleted } = setup();
		const out = sink();

		const result = await callWithApproval('todo-delete', call('todo-delete', { id: 42 }), {
			output: out.stream,
		});

		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(approvalDetails(result)?.approvalToken).toMatch(/^afdap1\./);
		expect(deleted).toEqual([]);
		expect(attempts).toEqual([undefined]);
		expect(out.text()).toContain('Rerun with --approve');
	});

	it('--approve retries once with the issued token, without asking', async () => {
		const { call, attempts, deleted } = setup();
		const prompt = vi.fn(no);

		const result = await callWithApproval('todo-delete', call('todo-delete', { id: 7 }), {
			approve: true,
			prompt,
			output: sink().stream,
		});

		expect(result).toMatchObject({ success: true, data: { deleted: 7 } });
		expect(prompt).not.toHaveBeenCalled();
		expect(attempts).toHaveLength(2);
		expect(attempts[0]).toBeUndefined();
		expect(attempts[1]).toMatch(/^afdap1\./);
		expect(deleted).toEqual([7]);
	});

	it('--approve never sends evidence when the first call was not held', async () => {
		const { call, attempts } = setup();
		const result = await callWithApproval('todo-list', call('todo-list', {}), { approve: true });
		expect(result.success).toBe(true);
		expect(attempts).toEqual([undefined]);
	});

	it('reports an expired token, and --approve does not retry again', async () => {
		const { call, clock, attempts, deleted } = setup();
		const out = sink();
		const execute = call('todo-delete', { id: 42 });
		// The approval arrives after the token's five minutes are up.
		const slow = (approval?: string) => {
			if (approval !== undefined) clock.advance(5 * 60 * 1000 + 1);
			return execute(approval);
		};

		const result = await callWithApproval('todo-delete', slow, {
			approve: true,
			output: out.stream,
		});

		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(approvalDetails(result)?.reason).toBe('expired');
		expect(attempts).toHaveLength(2);
		expect(deleted).toEqual([]);
		expect(out.text()).toContain('The previous approval was not accepted (expired).');
	});

	it('asks again after an expired token, and runs on the second yes', async () => {
		const { call, clock, deleted } = setup();
		const execute = call('todo-delete', { id: 42 });
		let first = true;
		const prompt = vi.fn<ApprovalPrompt>(async () => {
			// The human takes too long the first time.
			if (first) clock.advance(5 * 60 * 1000 + 1);
			first = false;
			return true;
		});

		const result = await callWithApproval('todo-delete', execute, {
			prompt,
			output: sink().stream,
		});

		expect(result.success).toBe(true);
		expect(prompt).toHaveBeenCalledTimes(2);
		expect(prompt.mock.calls[1]?.[1].reason).toBe('expired');
		expect(deleted).toEqual([42]);
	});

	it.each([
		['input', 'todo-delete', { id: 1 }, 'input-mismatch'],
		['command', 'todo-purge', {}, 'command-mismatch'],
	] as const)(
		'cannot run a call with a token issued for another %s',
		async (_what, name, input, reason) => {
			const { call, server, deleted } = setup();
			// A server that is wrong about which call it issued the token for: it answers
			// todo-delete of id 42 with the held result of another call.
			const other = await server.execute(name, input, { interface: 'cli' });
			expect(approvalDetails(other)?.approvalToken).toMatch(/^afdap1\./);
			const execute = call('todo-delete', { id: 42 });
			let attempt = 0;
			const confused = (approval?: string) =>
				attempt++ === 0 ? Promise.resolve(other) : execute(approval);

			const result = await callWithApproval('todo-delete', confused, {
				approve: true,
				output: sink().stream,
			});

			// The token is bound to its own call, so the retry is held, not run.
			expect(result.error?.code).toBe('APPROVAL_REQUIRED');
			expect(approvalDetails(result)?.reason).toBe(reason);
			expect(deleted).toEqual([]);
		}
	);

	it('does not retry a held result that carries no token', async () => {
		const out = sink();
		const held: CommandResult = {
			success: false,
			error: {
				code: 'APPROVAL_REQUIRED',
				message: 'x needs approval before it runs',
				details: { summary: 'Run x', expiresAt: '2026-10-26T12:05:00.000Z' },
			},
		};
		const execute = vi.fn(async () => held);

		const result = await callWithApproval('x', execute, { approve: true, output: out.stream });

		expect(result).toBe(held);
		expect(execute).toHaveBeenCalledOnce();
		expect(out.text()).toContain('delivers this approval to the approver another way');
	});
});

describe('describeApproval', () => {
	it('strips terminal control sequences from server text', () => {
		const text = describeApproval('x', { summary: 'Delete\u001b[2J all', expiresAt: 'soon' });
		expect(text).not.toContain('\u001b');
		expect(text).toContain('Approval expires: soon');
	});
});

describe('createTerminalApproval', () => {
	it.each([
		['y\n', true],
		['YES\n', true],
		['\n', false],
		['no\n', false],
	])('reads %j as %s', async (answer, expected) => {
		const input = new PassThrough();
		const output = sink();
		const prompt = createTerminalApproval({ input, output: output.stream });
		const decision = prompt('todo-delete', {});
		input.end(answer);
		expect(await decision).toBe(expected);
		expect(output.text()).toContain('Approve? [y/N]');
	});

	it('reads end of input with no answer as no', async () => {
		const input = new PassThrough();
		const prompt = createTerminalApproval({ input, output: sink().stream });
		const decision = prompt('todo-delete', {});
		input.end();
		expect(await decision).toBe(false);
	});
});
