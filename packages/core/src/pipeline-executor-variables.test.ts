/**
 * executePipeline conformance with spec/pipeline-variables.md: `$input` from the request,
 * preflight depth limits, step data isolation and contained resolution errors.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PipelineRequest } from './pipeline.js';
import { executePipeline } from './pipeline-executor.js';
import type { CommandResult } from './result.js';

/** An executor that echoes each step's resolved input and records it. */
function echo() {
	const inputs: unknown[] = [];
	const execute = vi.fn(
		async (
			_name: string,
			input: unknown,
			_context: Record<string, unknown>
		): Promise<CommandResult> => {
			inputs.push(input);
			return { success: true, data: input };
		}
	);
	return { execute, inputs };
}

function nested(levels: number): Record<string, unknown> {
	let value: Record<string, unknown> = { leaf: 1 };
	for (let level = 1; level < levels; level++) value = { next: value };
	return value;
}

describe('executePipeline $input', () => {
	it('resolves $input to the request input', async () => {
		const { execute, inputs } = echo();
		const result = await executePipeline(
			{
				input: { userId: 'u-1', filters: ['open'] },
				steps: [{ command: 'echo', input: { id: '$input.userId', all: '$input' } }],
			},
			execute
		);
		expect(inputs[0]).toEqual({ id: 'u-1', all: { userId: 'u-1', filters: ['open'] } });
		expect(result.steps[0]?.status).toBe('success');
	});

	it('never exposes the execution context through $input', async () => {
		const { execute, inputs } = echo();
		await executePipeline(
			{
				steps: [
					{
						command: 'echo',
						input: { all: '$input', trace: '$input.traceId', auth: '$input.auth' },
					},
				],
			},
			execute,
			{ traceId: 'trace-secret', auth: { token: 'secret' } }
		);
		expect(inputs[0]).toEqual({});
		expect(execute.mock.calls[0]?.[2]).toMatchObject({ traceId: 'trace-secret' });
	});

	it('accepts any JSON value as input', async () => {
		for (const input of [null, 0, 'text', true, [1, { a: [] }], { nested: { ok: null } }]) {
			const { execute, inputs } = echo();
			await executePipeline(
				{ input, steps: [{ command: 'echo', input: { v: '$input' } }] },
				execute
			);
			expect(inputs[0]).toEqual({ v: input });
		}
	});

	it.each([
		['a function', () => 1],
		['a Date', new Date(0)],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['a bigint', 1n],
		['undefined in an array', [1, undefined]],
		['a nested class instance', { at: new (class Point {})() }],
	])('rejects %s as input before any step runs', async (_label, input) => {
		const { execute } = echo();
		const result = await executePipeline(
			{ input, steps: [{ command: 'echo' }] } as PipelineRequest,
			execute
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.steps[0]?.error?.code).toBe('INVALID_PIPELINE_REQUEST');
	});

	it('treats undefined object properties in input as omitted', async () => {
		const { execute, inputs } = echo();
		await executePipeline(
			{ input: { a: 1, b: undefined }, steps: [{ command: 'echo', input: { v: '$input' } }] },
			execute
		);
		expect(inputs[0]).toEqual({ v: { a: 1 } });
	});
});

describe('executePipeline nesting limit', () => {
	it('runs step inputs nested 64 levels deep', async () => {
		const { execute } = echo();
		const result = await executePipeline(
			{ input: nested(64), steps: [{ command: 'echo', input: nested(64) }] },
			execute
		);
		expect(execute).toHaveBeenCalledOnce();
		expect(result.steps[0]?.status).toBe('success');
	});

	it('rejects a step input nested 65 levels deep with VALIDATION_ERROR before any step runs', async () => {
		const { execute } = echo();
		const result = await executePipeline(
			{ steps: [{ command: 'first' }, { command: 'echo', input: nested(65) }] },
			execute
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]).toMatchObject({
			index: -1,
			status: 'failure',
			error: {
				code: 'VALIDATION_ERROR',
				message: 'The input of step 1 is nested deeper than 64 levels',
				suggestion: expect.any(String),
				details: { stepIndex: 1, maxDepth: 64 },
			},
		});
		expect(result.metadata.completedSteps).toBe(0);
	});

	it('counts arrays as nesting levels', async () => {
		let value: unknown = ['$prev'];
		for (let level = 1; level < 64; level++) value = [value];
		const { execute } = echo();
		const result = await executePipeline(
			{ steps: [{ command: 'echo', input: { list: value } }] },
			execute
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.steps[0]?.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a request input nested 65 levels deep', async () => {
		const { execute } = echo();
		const result = await executePipeline(
			{ input: nested(65), steps: [{ command: 'echo' }] },
			execute
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.steps[0]?.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field: 'input' },
		});
	});

	it('returns a result instead of overflowing the stack for very deep or cyclic inputs', async () => {
		const cyclic: Record<string, unknown> = { a: '$prev' };
		cyclic.self = cyclic;
		for (const input of [nested(20_000), cyclic]) {
			const { execute } = echo();
			const result = await executePipeline({ steps: [{ command: 'echo', input }] }, execute);
			expect(execute).not.toHaveBeenCalled();
			expect(result.steps[0]?.error?.code).toBe('VALIDATION_ERROR');
		}
		const { execute } = echo();
		const result = await executePipeline({ input: cyclic, steps: [{ command: 'echo' }] }, execute);
		expect(result.steps[0]?.error?.code).toBe('VALIDATION_ERROR');
	});
});

describe('executePipeline step data isolation', () => {
	it('a handler mutating its input does not change an earlier step’s recorded data', async () => {
		const produced = { user: { name: 'Ada' }, tags: ['a'] };
		const result = await executePipeline(
			{
				steps: [
					{ command: 'produce', as: 'source' },
					{ command: 'mutate', input: { data: '$prev', tags: '$steps.source.tags' } },
					{ command: 'read', input: { data: '$steps.source' } },
				],
			},
			async (name, input) => {
				if (name === 'produce') return { success: true, data: produced };
				const typed = input as { data: typeof produced; tags?: string[] };
				if (name === 'mutate') {
					typed.data.user.name = 'mutated';
					typed.tags?.push('mutated');
				}
				return { success: true, data: typed.data };
			}
		);
		expect(result.steps[0]?.data).toEqual({ user: { name: 'Ada' }, tags: ['a'] });
		expect(result.steps[2]?.data).toEqual({ user: { name: 'Ada' }, tags: ['a'] });
		expect(result.steps[1]?.data).toEqual({ user: { name: 'mutated' }, tags: ['a'] });
	});

	it('a handler mutating its returned data later does not change the recorded data', async () => {
		const produced = { count: 1 };
		const result = await executePipeline({ steps: [{ command: 'produce' }] }, async () => ({
			success: true,
			data: produced,
		}));
		produced.count = 99;
		expect(result.steps[0]?.data).toEqual({ count: 1 });
		expect(result.data).toEqual({ count: 1 });
	});
});

describe('executePipeline literal handling', () => {
	it('passes literals through, unescapes $$ and omits unresolved references', async () => {
		const { execute, inputs } = echo();
		await executePipeline(
			{
				steps: [
					{ command: 'echo', input: { id: 1 }, as: 'first' },
					{
						command: 'echo',
						input: {
							price: '$9.99',
							home: '$HOME',
							escaped: '$$prev',
							missing: '$steps.nope',
							list: ['$steps.nope', '$first.id'],
							proto: '$prev.constructor.constructor',
						},
					},
				],
			},
			execute
		);
		expect(inputs[1]).toEqual({
			price: '$9.99',
			home: '$HOME',
			escaped: '$prev',
			list: [null, 1],
		});
	});

	it('skips a step whose when condition reads an unresolved path', async () => {
		const { execute } = echo();
		const result = await executePipeline(
			{
				steps: [
					{ command: 'echo', input: { id: 1 } },
					{ command: 'never', when: { $exists: '$prev.missing.deep' } },
					{ command: 'never', when: { $ne: ['$steps.nope', 'x'] } },
					{ command: 'runs', when: { $not: { $eq: ['$prev.missing', 1] } } },
				],
			},
			execute
		);
		expect(result.steps.map((s) => s.status)).toEqual(['success', 'skipped', 'skipped', 'success']);
	});
});

describe('executePipeline resolution errors', () => {
	it('turns a resolution exception into a step failure instead of rejecting', async () => {
		const { proxy, revoke } = Proxy.revocable({}, {});
		revoke();
		const execute = vi.fn(
			async (name: string): Promise<CommandResult> =>
				name === 'hostile' ? { success: true, data: proxy } : { success: true, data: 'ran' }
		);
		const result = await executePipeline(
			{
				options: { continueOnFailure: true },
				steps: [
					{ command: 'hostile' },
					{ command: 'reads', input: { value: '$prev.field' } },
					{ command: 'checks', when: { $exists: '$steps[0].field' } },
				],
			},
			execute
		);
		expect(execute).toHaveBeenCalledOnce();
		expect(result.steps[1]).toMatchObject({
			status: 'failure',
			error: { code: 'INTERNAL_ERROR', suggestion: expect.any(String) },
		});
		expect(result.steps[2]?.status).toBe('failure');
	});
});
