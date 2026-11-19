/** The steps an up-front approval of `afd-batch` and `afd-pipe` sees (#459). */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { batchSteps, pipelineSteps, readsStepData } from './up-front-steps.js';

const remove = defineCommand({
	name: 'todo-delete',
	description: 'Delete a todo',
	approval: 'required',
	input: z.object({ id: z.number() }),
	handler: async () => ({ success: true, data: null }),
});

describe('readsStepData', () => {
	it.each([
		'$prev',
		'$prev.id',
		'$first',
		'$first.items[0]',
		'$steps[1]',
		'$steps.list.id',
		'$steps.input',
	])('counts %s as reading an earlier step', (ref) => {
		expect(readsStepData({ nested: [{ id: ref }] })).toBe(true);
	});

	it.each([
		'$input',
		'$input.id',
		'$$prev',
		'$prevx',
		'$9.99',
		'prev',
		`$prev.${'a'.repeat(1100)}`,
	])('counts %s as known up front', (value) => {
		expect(readsStepData({ value })).toBe(false);
	});
});

describe('steps', () => {
	it('validates batch inputs and marks invalid or unknown steps', () => {
		expect(
			batchSteps(
				{
					commands: [
						{ command: 'todo-delete', input: { id: 1, extra: true } },
						{ command: 'todo-delete', input: { id: 'x' } },
						{ command: 'todo-unknown', input: {} },
					],
				},
				[remove]
			)
		).toEqual([
			{
				index: 0,
				command: 'todo-delete',
				dynamic: false,
				valid: true,
				input: { id: 1 },
				sent: '{"extra":true,"id":1}',
			},
			{ index: 1, command: 'todo-delete', dynamic: false, valid: false },
			{ index: 2, command: 'todo-unknown', dynamic: false, valid: false },
		]);
	});

	it('resolves $input and marks steps that read earlier steps', () => {
		expect(
			pipelineSteps(
				{
					input: { id: 3 },
					steps: [
						{ command: 'todo-delete', input: { id: '$input.id' } },
						{ command: 'todo-delete', input: { id: '$prev.id' } },
					],
				},
				[remove]
			)
		).toEqual([
			{
				index: 0,
				command: 'todo-delete',
				dynamic: false,
				valid: true,
				input: { id: 3 },
				sent: '{"id":3}',
			},
			{ index: 1, command: 'todo-delete', dynamic: true, valid: false },
		]);
	});
});

describe('handlers of up-front steps', () => {
	it('never see the up-front approval, so a command they run cannot take it', async () => {
		const { createExecutionEngine } = await import('./execution.js');
		const { createApprovalMiddleware } = await import('./approval.js');
		const { bindUpFrontApproval, upFrontApproval } = await import('./approval-relay.js');
		const { createUpFrontApproval } = await import('./approval-up-front.js');
		const seen: boolean[] = [];
		const peek = defineCommand({
			name: 'todo-peek',
			description: 'Peek',
			input: z.object({}),
			handler: async (_input, context) => {
				seen.push(upFrontApproval(context) !== undefined);
				return { success: true, data: null };
			},
		});
		const engine = createExecutionEngine({
			commandMap: new Map([[peek.name, peek]]),
			middleware: [
				async (_name, _input, context, next) => {
					seen.push(upFrontApproval(context) !== undefined);
					return next();
				},
				createApprovalMiddleware({
					secret: 'test-approval-secret-0123456789abcdef',
					commands: [peek],
					relay: 'mcp-elicitation',
				}),
			],
			devMode: false,
		});
		const relay = {
			route() {},
			claim: () => false,
			answer: async () => ({ kind: 'missing' as const }),
			hold() {},
			answers: async () => ({ accepted: [], declined: [] }),
			holdSteps() {},
		};
		const request = { commands: [{ command: 'todo-peek', input: {} }] };
		const context = bindUpFrontApproval(
			{},
			createUpFrontApproval(relay, 'afd-batch', request, [peek])
		);
		const result = await engine.executeCommand('todo-peek', {}, context);
		expect(result.success).toBe(true);
		expect(seen).toEqual([true, false]);
	});
});

describe('a step approved in an earlier round (#1414)', () => {
	const add = defineCommand({
		name: 'note-add',
		description: 'Add a note',
		approval: 'required',
		input: z.object({
			text: z.string(),
			id: z.string().default(() => `note-${Math.random()}`),
			at: z.string().default(() => new Date().toISOString()),
		}),
		handler: async () => ({ success: true, data: null }),
	});
	const request = { commands: [{ command: 'note-add', input: { text: 'milk' } }] };
	const approved = '{"at":"2026-10-26T12:00:00.000Z","id":"note-1","text":"milk"}';

	it('keeps the approved input instead of validating what was sent again', () => {
		const [step] = batchSteps(request, [add], new Map([[0, approved]]));
		expect(step).toMatchObject({ valid: true, sent: '{"text":"milk"}' });
		expect(step?.input).toEqual({
			text: 'milk',
			id: 'note-1',
			at: '2026-10-26T12:00:00.000Z',
		});
	});

	it.each([
		['is not JSON', '{'],
		['does not validate', '{"id":"note-1","text":7}'],
		[
			'is not read back unchanged',
			'{"at":"2026-10-26T12:00:00.000Z","extra":1,"id":"note-1","text":"milk"}',
		],
	])('validates what was sent when the approved input %s', (_why, altered) => {
		const [step] = batchSteps(request, [add], new Map([[0, altered]]));
		expect(step?.valid).toBe(true);
		expect(step?.input).not.toMatchObject({ id: 'note-1' });
	});

	it('resolves $input before it looks for the approved input of a pipeline step', () => {
		const steps = pipelineSteps(
			{ input: { text: 'milk' }, steps: [{ command: 'note-add', input: { text: '$input.text' } }] },
			[add],
			new Map([[0, approved]])
		);
		expect(steps[0]).toMatchObject({ valid: true, sent: '{"text":"milk"}' });
		expect(steps[0]?.input).toMatchObject({ id: 'note-1' });
	});
});
