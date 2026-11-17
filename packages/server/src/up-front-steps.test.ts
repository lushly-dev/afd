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
			{ index: 0, command: 'todo-delete', dynamic: false, valid: true, input: { id: 1 } },
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
			{ index: 0, command: 'todo-delete', dynamic: false, valid: true, input: { id: 3 } },
			{ index: 1, command: 'todo-delete', dynamic: true, valid: false },
		]);
	});
});
