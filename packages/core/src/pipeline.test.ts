import { describe, expect, it } from 'vitest';
import type {
	PipelineCondition,
	PipelineContext,
	PipelineRequest,
	PipelineResult,
	PipelineStep,
	StepResult,
} from './pipeline.js';
import {
	aggregatePipelineConfidence,
	aggregatePipelineReasoning,
	aggregatePipelineSources,
	aggregatePipelineWarnings,
	buildConfidenceBreakdown,
	createPipeline,
	evaluateCondition,
	getNestedValue,
	isAndCondition,
	isEqCondition,
	isExistsCondition,
	isGtCondition,
	isNotCondition,
	isOrCondition,
	isPipelineCondition,
	isPipelineRequest,
	isPipelineResult,
	isPipelineStep,
	resolveReference,
	resolveVariable,
	resolveVariables,
} from './pipeline.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARD TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('isPipelineRequest', () => {
	it('returns true for valid pipeline request', () => {
		const request: PipelineRequest = {
			steps: [{ command: 'user-get', input: { id: 123 } }],
		};
		expect(isPipelineRequest(request)).toBe(true);
	});

	it('returns true for request with options', () => {
		const request: PipelineRequest = {
			id: 'test-pipeline',
			steps: [{ command: 'user-get' }],
			options: { timeoutMs: 5000 },
		};
		expect(isPipelineRequest(request)).toBe(true);
	});

	it('returns false for missing steps', () => {
		expect(isPipelineRequest({ id: 'test' })).toBe(false);
	});

	it('returns false for non-array steps', () => {
		expect(isPipelineRequest({ steps: 'not-an-array' })).toBe(false);
	});

	it('returns false for null', () => {
		expect(isPipelineRequest(null)).toBe(false);
	});

	it('returns false for primitive values', () => {
		expect(isPipelineRequest('string')).toBe(false);
		expect(isPipelineRequest(123)).toBe(false);
	});
});

describe('isPipelineStep', () => {
	it('returns true for valid step', () => {
		const step: PipelineStep = { command: 'user-get' };
		expect(isPipelineStep(step)).toBe(true);
	});

	it('returns true for step with all fields', () => {
		const step: PipelineStep = {
			command: 'order-list',
			input: { userId: '$prev.id' },
			as: 'orders',
			when: { $exists: '$prev.id' },
			stream: true,
		};
		expect(isPipelineStep(step)).toBe(true);
	});

	it('returns false for missing command', () => {
		expect(isPipelineStep({ input: {} })).toBe(false);
	});

	it('returns false for non-string command', () => {
		expect(isPipelineStep({ command: 123 })).toBe(false);
	});
});

describe('isPipelineResult', () => {
	it('returns true for valid result', () => {
		const result: PipelineResult = {
			data: { id: 1 },
			metadata: {
				confidence: 0.95,
				confidenceBreakdown: [],
				reasoning: [],
				warnings: [],
				sources: [],
				alternatives: [],
				executionTimeMs: 100,
				completedSteps: 1,
				totalSteps: 1,
			},
			steps: [],
		};
		expect(isPipelineResult(result)).toBe(true);
	});

	it('returns false for missing data', () => {
		expect(isPipelineResult({ metadata: {}, steps: [] })).toBe(false);
	});

	it('returns false for missing steps', () => {
		expect(isPipelineResult({ data: {}, metadata: {} })).toBe(false);
	});
});

describe('isPipelineCondition', () => {
	it('returns true for $exists condition', () => {
		expect(isPipelineCondition({ $exists: '$prev.id' })).toBe(true);
	});

	it('returns true for $eq condition', () => {
		expect(isPipelineCondition({ $eq: ['$prev.status', 'active'] })).toBe(true);
	});

	it('returns true for $and condition', () => {
		expect(
			isPipelineCondition({
				$and: [{ $exists: '$prev.id' }, { $eq: ['$prev.active', true] }],
			})
		).toBe(true);
	});

	it('returns false for empty object', () => {
		expect(isPipelineCondition({})).toBe(false);
	});

	it('returns false for multiple keys', () => {
		expect(isPipelineCondition({ $exists: '$a', $eq: ['$b', 1] })).toBe(false);
	});

	it('returns false for unknown operator', () => {
		expect(isPipelineCondition({ $unknown: 'value' })).toBe(false);
	});
});

describe('condition type guards', () => {
	it('isExistsCondition identifies $exists', () => {
		const condition: PipelineCondition = { $exists: '$prev.id' };
		expect(isExistsCondition(condition)).toBe(true);
		expect(isEqCondition(condition)).toBe(false);
	});

	it('isEqCondition identifies $eq', () => {
		const condition: PipelineCondition = { $eq: ['$prev.status', 'active'] };
		expect(isEqCondition(condition)).toBe(true);
		expect(isExistsCondition(condition)).toBe(false);
	});

	it('isGtCondition identifies $gt', () => {
		const condition: PipelineCondition = { $gt: ['$prev.count', 10] };
		expect(isGtCondition(condition)).toBe(true);
	});

	it('isAndCondition identifies $and', () => {
		const condition: PipelineCondition = { $and: [{ $exists: '$prev.id' }] };
		expect(isAndCondition(condition)).toBe(true);
	});

	it('isOrCondition identifies $or', () => {
		const condition: PipelineCondition = { $or: [{ $exists: '$prev.id' }] };
		expect(isOrCondition(condition)).toBe(true);
	});

	it('isNotCondition identifies $not', () => {
		const condition: PipelineCondition = { $not: { $exists: '$prev.id' } };
		expect(isNotCondition(condition)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createPipeline', () => {
	it('creates pipeline from steps array', () => {
		const steps: PipelineStep[] = [
			{ command: 'user-get', input: { id: 1 } },
			{ command: 'order-list', input: { userId: '$prev.id' } },
		];
		const pipeline = createPipeline(steps);

		expect(pipeline.steps).toBe(steps);
		expect(pipeline.options).toBeUndefined();
	});

	it('includes options when provided', () => {
		const steps: PipelineStep[] = [{ command: 'test' }];
		const pipeline = createPipeline(steps, { timeoutMs: 5000, continueOnFailure: true });

		expect(pipeline.options?.timeoutMs).toBe(5000);
		expect(pipeline.options?.continueOnFailure).toBe(true);
	});
});

describe('aggregatePipelineConfidence', () => {
	it('returns minimum confidence (weakest link)', () => {
		const steps: StepResult[] = [
			{ index: 0, command: 'a', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.95 } },
			{ index: 1, command: 'b', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.80 } },
			{ index: 2, command: 'c', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.99 } },
		];

		expect(aggregatePipelineConfidence(steps)).toBe(0.80);
	});

	it('ignores failed steps', () => {
		const steps: StepResult[] = [
			{ index: 0, command: 'a', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.95 } },
			{ index: 1, command: 'b', status: 'failure', executionTimeMs: 10, metadata: { confidence: 0.50 } },
		];

		expect(aggregatePipelineConfidence(steps)).toBe(0.95);
	});

	it('defaults to 1.0 for steps without confidence', () => {
		const steps: StepResult[] = [
			{ index: 0, command: 'a', status: 'success', executionTimeMs: 10 },
			{ index: 1, command: 'b', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.90 } },
		];

		expect(aggregatePipelineConfidence(steps)).toBe(0.90);
	});

	it('returns 0 when no successful steps', () => {
		const steps: StepResult[] = [
			{ index: 0, command: 'a', status: 'failure', executionTimeMs: 10 },
			{ index: 1, command: 'b', status: 'skipped', executionTimeMs: 0 },
		];

		expect(aggregatePipelineConfidence(steps)).toBe(0);
	});
});

describe('aggregatePipelineReasoning', () => {
	it('collects reasoning from all successful steps', () => {
		const steps: StepResult[] = [
			{ index: 0, command: 'fetch', status: 'success', executionTimeMs: 10, metadata: { reasoning: 'Used cached data' } },
			{ index: 1, command: 'transform', status: 'success', executionTimeMs: 10, metadata: { reasoning: 'Applied UTC normalization' } },
			{ index: 2, command: 'validate', status: 'success', executionTimeMs: 10 },
		];

		const reasoning = aggregatePipelineReasoning(steps);

		expect(reasoning).toHaveLength(2);
		expect(reasoning[0]).toEqual({
			stepIndex: 0,
			command: 'fetch',
			reasoning: 'Used cached data',
		});
		expect(reasoning[1]).toEqual({
			stepIndex: 1,
			command: 'transform',
			reasoning: 'Applied UTC normalization',
		});
	});

	it('ignores failed steps', () => {
		const steps: StepResult[] = [
			{ index: 0, command: 'a', status: 'success', executionTimeMs: 10, metadata: { reasoning: 'OK' } },
			{ index: 1, command: 'b', status: 'failure', executionTimeMs: 10, metadata: { reasoning: 'Failed' } },
		];

		const reasoning = aggregatePipelineReasoning(steps);
		expect(reasoning).toHaveLength(1);
		expect(reasoning[0].command).toBe('a');
	});
});

describe('aggregatePipelineWarnings', () => {
	it('collects warnings from all steps with attribution', () => {
		const steps: StepResult[] = [
			{
				index: 0,
				alias: 'user',
				command: 'user-get',
				status: 'success',
				executionTimeMs: 10,
				metadata: {
					warnings: [{ code: 'OUTDATED', message: 'Data is 6 months old', severity: 'info' as const }],
				},
			},
			{
				index: 1,
				command: 'order-list',
				status: 'success',
				executionTimeMs: 10,
				metadata: {
					warnings: [{ code: 'PARTIAL', message: 'Some orders excluded', severity: 'warning' as const }],
				},
			},
		];

		const warnings = aggregatePipelineWarnings(steps);

		expect(warnings).toHaveLength(2);
		expect(warnings[0].stepIndex).toBe(0);
		expect(warnings[0].stepAlias).toBe('user');
		expect(warnings[0].code).toBe('OUTDATED');
		expect(warnings[1].stepIndex).toBe(1);
		expect(warnings[1].code).toBe('PARTIAL');
	});
});

describe('aggregatePipelineSources', () => {
	it('collects sources from all steps with attribution', () => {
		const steps: StepResult[] = [
			{
				index: 0,
				command: 'search',
				status: 'success',
				executionTimeMs: 10,
				metadata: {
					sources: [
						{ type: 'document', id: 'doc-1', title: 'Style Guide' },
						{ type: 'api', id: 'api-1' },
					],
				},
			},
		];

		const sources = aggregatePipelineSources(steps);

		expect(sources).toHaveLength(2);
		expect(sources[0].stepIndex).toBe(0);
		expect(sources[0].title).toBe('Style Guide');
	});
});

describe('buildConfidenceBreakdown', () => {
	it('builds breakdown from step results', () => {
		const steps: StepResult[] = [
			{ index: 0, alias: 'user', command: 'user-get', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.95 } },
			{ index: 1, command: 'order-list', status: 'success', executionTimeMs: 10, metadata: { confidence: 0.87, reasoning: 'Schema mismatch' } },
		];

		const breakdown = buildConfidenceBreakdown(steps);

		expect(breakdown).toHaveLength(2);
		expect(breakdown[0]).toEqual({
			step: 0,
			alias: 'user',
			command: 'user-get',
			confidence: 0.95,
			reasoning: undefined,
		});
		expect(breakdown[1]).toEqual({
			step: 1,
			alias: undefined,
			command: 'order-list',
			confidence: 0.87,
			reasoning: 'Schema mismatch',
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// VARIABLE RESOLUTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveVariable', () => {
	const context: PipelineContext = {
		pipelineInput: { originalId: 'input-123' },
		previousResult: {
			index: 1,
			command: 'user-get',
			status: 'success',
			executionTimeMs: 10,
			data: { id: 456, name: 'Alice', profile: { email: 'alice@example.com' } },
		},
		steps: [
			{
				index: 0,
				alias: 'first',
				command: 'init',
				status: 'success',
				executionTimeMs: 5,
				data: { startId: 100 },
			},
			{
				index: 1,
				alias: 'user',
				command: 'user-get',
				status: 'success',
				executionTimeMs: 10,
				data: { id: 456, name: 'Alice', profile: { email: 'alice@example.com' } },
			},
		],
	};

	it('resolves $prev', () => {
		expect(resolveVariable('$prev', context)).toEqual({
			id: 456,
			name: 'Alice',
			profile: { email: 'alice@example.com' },
		});
	});

	it('resolves $prev.field', () => {
		expect(resolveVariable('$prev.name', context)).toBe('Alice');
	});

	it('resolves $prev.nested.field', () => {
		expect(resolveVariable('$prev.profile.email', context)).toBe('alice@example.com');
	});

	it('resolves $first', () => {
		expect(resolveVariable('$first', context)).toEqual({ startId: 100 });
	});

	it('resolves $first.field', () => {
		expect(resolveVariable('$first.startId', context)).toBe(100);
	});

	it('resolves $input', () => {
		expect(resolveVariable('$input', context)).toEqual({ originalId: 'input-123' });
	});

	it('resolves $input.field', () => {
		expect(resolveVariable('$input.originalId', context)).toBe('input-123');
	});

	it('resolves $steps[n]', () => {
		expect(resolveVariable('$steps[0]', context)).toEqual({ startId: 100 });
		expect(resolveVariable('$steps[1]', context)).toEqual({
			id: 456,
			name: 'Alice',
			profile: { email: 'alice@example.com' },
		});
	});

	it('resolves $steps[n].field', () => {
		expect(resolveVariable('$steps[1].name', context)).toBe('Alice');
	});

	it('resolves $steps.alias', () => {
		expect(resolveVariable('$steps.user', context)).toEqual({
			id: 456,
			name: 'Alice',
			profile: { email: 'alice@example.com' },
		});
	});

	it('resolves $steps.alias.field', () => {
		expect(resolveVariable('$steps.user.name', context)).toBe('Alice');
		expect(resolveVariable('$steps.user.profile.email', context)).toBe('alice@example.com');
	});

	it('returns undefined for non-existent paths', () => {
		expect(resolveVariable('$prev.nonexistent', context)).toBeUndefined();
		expect(resolveVariable('$steps.unknown', context)).toBeUndefined();
		expect(resolveVariable('$steps[99]', context)).toBeUndefined();
	});

	it('returns non-variable strings as-is', () => {
		expect(resolveVariable('literal', context)).toBe('literal');
	});
});

describe('resolveVariables', () => {
	const context: PipelineContext = {
		previousResult: {
			index: 0,
			command: 'test',
			status: 'success',
			executionTimeMs: 10,
			data: { id: 123, items: ['a', 'b', 'c'] },
		},
		steps: [],
	};

	it('resolves string variables', () => {
		expect(resolveVariables('$prev.id', context)).toBe(123);
	});

	it('resolves variables in objects', () => {
		const input = { userId: '$prev.id', status: 'active' };
		expect(resolveVariables(input, context)).toEqual({ userId: 123, status: 'active' });
	});

	it('resolves variables in arrays', () => {
		const input = ['$prev.id', 'literal', '$prev.items'];
		expect(resolveVariables(input, context)).toEqual([123, 'literal', ['a', 'b', 'c']]);
	});

	it('resolves nested structures', () => {
		const input = {
			user: { id: '$prev.id' },
			filters: ['$prev.items', { type: 'static' }],
		};
		expect(resolveVariables(input, context)).toEqual({
			user: { id: 123 },
			filters: [['a', 'b', 'c'], { type: 'static' }],
		});
	});

	it('passes through non-variable values', () => {
		expect(resolveVariables(123, context)).toBe(123);
		expect(resolveVariables(true, context)).toBe(true);
		expect(resolveVariables(null, context)).toBe(null);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateCondition', () => {
	const context: PipelineContext = {
		previousResult: {
			index: 0,
			command: 'test',
			status: 'success',
			executionTimeMs: 10,
			data: { id: 123, status: 'active', count: 5, tier: 'premium' },
		},
		steps: [
			{
				index: 0,
				alias: 'user',
				command: 'test',
				status: 'success',
				executionTimeMs: 10,
				data: { id: 123, status: 'active', count: 5, tier: 'premium' },
			},
		],
	};

	describe('$exists', () => {
		it('returns true when field exists', () => {
			expect(evaluateCondition({ $exists: '$prev.id' }, context)).toBe(true);
		});

		it('returns false when field does not exist', () => {
			expect(evaluateCondition({ $exists: '$prev.nonexistent' }, context)).toBe(false);
		});

		it('returns false for null values', () => {
			const nullContext: PipelineContext = {
				previousResult: {
					index: 0,
					command: 'test',
					status: 'success',
					executionTimeMs: 10,
					data: { value: null },
				},
				steps: [],
			};
			expect(evaluateCondition({ $exists: '$prev.value' }, nullContext)).toBe(false);
		});
	});

	describe('$eq', () => {
		it('returns true when values match', () => {
			expect(evaluateCondition({ $eq: ['$prev.status', 'active'] }, context)).toBe(true);
			expect(evaluateCondition({ $eq: ['$prev.count', 5] }, context)).toBe(true);
		});

		it('returns false when values differ', () => {
			expect(evaluateCondition({ $eq: ['$prev.status', 'inactive'] }, context)).toBe(false);
		});
	});

	describe('$ne', () => {
		it('returns true when values differ', () => {
			expect(evaluateCondition({ $ne: ['$prev.status', 'inactive'] }, context)).toBe(true);
		});

		it('returns false when values match', () => {
			expect(evaluateCondition({ $ne: ['$prev.status', 'active'] }, context)).toBe(false);
		});
	});

	describe('$gt', () => {
		it('returns true when greater', () => {
			expect(evaluateCondition({ $gt: ['$prev.count', 3] }, context)).toBe(true);
		});

		it('returns false when not greater', () => {
			expect(evaluateCondition({ $gt: ['$prev.count', 5] }, context)).toBe(false);
			expect(evaluateCondition({ $gt: ['$prev.count', 10] }, context)).toBe(false);
		});
	});

	describe('$gte', () => {
		it('returns true when greater or equal', () => {
			expect(evaluateCondition({ $gte: ['$prev.count', 5] }, context)).toBe(true);
			expect(evaluateCondition({ $gte: ['$prev.count', 3] }, context)).toBe(true);
		});

		it('returns false when less', () => {
			expect(evaluateCondition({ $gte: ['$prev.count', 10] }, context)).toBe(false);
		});
	});

	describe('$lt', () => {
		it('returns true when less', () => {
			expect(evaluateCondition({ $lt: ['$prev.count', 10] }, context)).toBe(true);
		});

		it('returns false when not less', () => {
			expect(evaluateCondition({ $lt: ['$prev.count', 5] }, context)).toBe(false);
		});
	});

	describe('$lte', () => {
		it('returns true when less or equal', () => {
			expect(evaluateCondition({ $lte: ['$prev.count', 5] }, context)).toBe(true);
			expect(evaluateCondition({ $lte: ['$prev.count', 10] }, context)).toBe(true);
		});

		it('returns false when greater', () => {
			expect(evaluateCondition({ $lte: ['$prev.count', 3] }, context)).toBe(false);
		});
	});

	describe('$and', () => {
		it('returns true when all conditions match', () => {
			expect(
				evaluateCondition(
					{
						$and: [{ $exists: '$prev.id' }, { $eq: ['$prev.status', 'active'] }],
					},
					context
				)
			).toBe(true);
		});

		it('returns false when any condition fails', () => {
			expect(
				evaluateCondition(
					{
						$and: [{ $exists: '$prev.id' }, { $eq: ['$prev.status', 'inactive'] }],
					},
					context
				)
			).toBe(false);
		});
	});

	describe('$or', () => {
		it('returns true when any condition matches', () => {
			expect(
				evaluateCondition(
					{
						$or: [{ $eq: ['$prev.status', 'inactive'] }, { $exists: '$prev.id' }],
					},
					context
				)
			).toBe(true);
		});

		it('returns false when no conditions match', () => {
			expect(
				evaluateCondition(
					{
						$or: [
							{ $eq: ['$prev.status', 'inactive'] },
							{ $exists: '$prev.nonexistent' },
						],
					},
					context
				)
			).toBe(false);
		});
	});

	describe('$not', () => {
		it('negates the inner condition', () => {
			expect(evaluateCondition({ $not: { $exists: '$prev.nonexistent' } }, context)).toBe(true);
			expect(evaluateCondition({ $not: { $exists: '$prev.id' } }, context)).toBe(false);
		});
	});

	describe('complex nested conditions', () => {
		it('evaluates complex nested conditions', () => {
			const complexCondition: PipelineCondition = {
				$and: [
					{ $exists: '$prev.id' },
					{
						$or: [
							{ $eq: ['$prev.tier', 'premium'] },
							{ $gt: ['$prev.count', 10] },
						],
					},
				],
			};

			expect(evaluateCondition(complexCondition, context)).toBe(true);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// NESTED VALUE HELPER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('getNestedValue', () => {
	it('returns value at simple path', () => {
		expect(getNestedValue({ name: 'Alice' }, 'name')).toBe('Alice');
	});

	it('returns value at nested path', () => {
		expect(getNestedValue({ user: { profile: { name: 'Bob' } } }, 'user.profile.name')).toBe('Bob');
	});

	it('returns undefined for missing paths', () => {
		expect(getNestedValue({ name: 'Alice' }, 'missing')).toBeUndefined();
		expect(getNestedValue({ name: 'Alice' }, 'missing.deep.path')).toBeUndefined();
	});

	it('returns undefined for null/undefined objects', () => {
		expect(getNestedValue(null, 'path')).toBeUndefined();
		expect(getNestedValue(undefined, 'path')).toBeUndefined();
	});

	it('handles array index notation', () => {
		const obj = { items: ['a', 'b', 'c'] };
		expect(getNestedValue(obj, 'items[0]')).toBe('a');
		expect(getNestedValue(obj, 'items[1]')).toBe('b');
		expect(getNestedValue(obj, 'items[2]')).toBe('c');
	});

	it('handles nested array access', () => {
		const obj = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
		expect(getNestedValue(obj, 'users[0].name')).toBe('Alice');
		expect(getNestedValue(obj, 'users[1].name')).toBe('Bob');
	});

	it('returns undefined for out-of-bounds array access', () => {
		expect(getNestedValue({ items: ['a', 'b'] }, 'items[5]')).toBeUndefined();
	});

	it('returns undefined for array access on non-array', () => {
		expect(getNestedValue({ items: 'not-array' }, 'items[0]')).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// BACKWARDS COMPATIBILITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveReference (backwards compatibility)', () => {
	it('is an alias for resolveVariable', () => {
		expect(resolveReference).toBe(resolveVariable);
	});

	it('works identically to resolveVariable', () => {
		const context: PipelineContext = {
			previousResult: {
				index: 0,
				command: 'test',
				status: 'success',
				executionTimeMs: 10,
				data: { id: 123 },
			},
			steps: [],
		};

		expect(resolveReference('$prev.id', context)).toBe(123);
		expect(resolveVariable('$prev.id', context)).toBe(123);
	});
});
