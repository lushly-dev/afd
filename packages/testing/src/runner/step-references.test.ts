/**
 * @lushly-dev/afd-testing - Step Reference Resolution Tests
 *
 * Tests the real resolver used by both executors.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import {
	getValueAtPath,
	resolveStepReferences as resolveInput,
	StepReferenceError,
} from './step-references.js';

/** Resolve a single value the way it would be resolved inside a step input. */
function resolveStepReferences(
	value: unknown,
	stepResults: Array<CommandResult<unknown>>
): unknown {
	return resolveInput({ value }, stepResults)?.value;
}

describe('Step Reference Resolution', () => {
	describe('resolveStepReferences', () => {
		const stepResults: Array<CommandResult<unknown>> = [
			{ success: true, data: { id: 'todo-1', title: 'First Todo' } },
			{ success: true, data: { id: 'todo-2', title: 'Second Todo', count: 42 } },
			{ success: true, data: { items: [{ name: 'Item A' }, { name: 'Item B' }] } },
		];

		describe('exact match references', () => {
			it('resolves simple data.id reference', () => {
				const input = '${{ steps[0].data.id }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('todo-1');
			});

			it('resolves data.title reference', () => {
				const input = '${{ steps[1].data.title }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('Second Todo');
			});

			it('resolves numeric values without string conversion', () => {
				const input = '${{ steps[1].data.count }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe(42);
				expect(typeof result).toBe('number');
			});

			it('throws for a step that has not run', () => {
				const input = '${{ steps[99].data.id }}';
				expect(() => resolveStepReferences(input, stepResults)).toThrow(StepReferenceError);
				expect(() => resolveStepReferences(input, stepResults)).toThrow('step 99 has not run');
			});

			it('throws for a path with no value', () => {
				const input = '${{ steps[0].data.nonexistent }}';
				expect(() => resolveStepReferences(input, stepResults)).toThrow(
					"steps[0] has no value at 'data.nonexistent'"
				);
			});

			it('throws for a skipped step placeholder', () => {
				expect(() =>
					resolveStepReferences('${{ steps[0].data.id }}', [{ success: false }])
				).toThrow(StepReferenceError);
			});

			it('keeps null values, which did resolve', () => {
				expect(
					resolveStepReferences('${{ steps[0].data.v }}', [{ success: true, data: { v: null } }])
				).toBeNull();
			});
		});

		describe('embedded references', () => {
			it('replaces reference within string', () => {
				const input = 'Todo ID: ${{ steps[0].data.id }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('Todo ID: todo-1');
			});

			it('replaces multiple references in same string', () => {
				const input = 'First: ${{ steps[0].data.id }}, Second: ${{ steps[1].data.id }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('First: todo-1, Second: todo-2');
			});

			it('converts numbers to strings when embedded', () => {
				const input = 'Count is ${{ steps[1].data.count }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('Count is 42');
				expect(typeof result).toBe('string');
			});

			it('throws instead of embedding an empty string for a missing value', () => {
				const input = 'Missing: ${{ steps[0].data.missing }}';
				expect(() => resolveStepReferences(input, stepResults)).toThrow(StepReferenceError);
			});

			it('embeds objects as JSON', () => {
				const input = 'Items: ${{ steps[2].data.items[0] }}';
				expect(resolveStepReferences(input, stepResults)).toBe('Items: {"name":"Item A"}');
			});
		});

		describe('array index references', () => {
			it('resolves array element by index', () => {
				const input = '${{ steps[2].data.items[0].name }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('Item A');
			});

			it('resolves different array indices', () => {
				const input = '${{ steps[2].data.items[1].name }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('Item B');
			});

			it('throws for an out-of-bounds index', () => {
				const input = '${{ steps[2].data.items[99].name }}';
				expect(() => resolveStepReferences(input, stepResults)).toThrow(StepReferenceError);
			});
		});

		describe('nested objects', () => {
			it('resolves references in nested input objects', () => {
				const input = {
					id: '${{ steps[0].data.id }}',
					meta: {
						title: '${{ steps[1].data.title }}',
					},
				};
				const result = resolveStepReferences(input, stepResults);
				expect(result).toEqual({
					id: 'todo-1',
					meta: {
						title: 'Second Todo',
					},
				});
			});

			it('preserves non-reference values', () => {
				const input = {
					id: '${{ steps[0].data.id }}',
					static: 'unchanged',
					number: 123,
					flag: true,
					nested: {
						ref: '${{ steps[1].data.count }}',
						fixed: 'also unchanged',
					},
				};
				const result = resolveStepReferences(input, stepResults);
				expect(result).toEqual({
					id: 'todo-1',
					static: 'unchanged',
					number: 123,
					flag: true,
					nested: {
						ref: 42,
						fixed: 'also unchanged',
					},
				});
			});
		});

		describe('arrays', () => {
			it('resolves references in arrays', () => {
				const input = ['${{ steps[0].data.id }}', '${{ steps[1].data.id }}'];
				const result = resolveStepReferences(input, stepResults);
				expect(result).toEqual(['todo-1', 'todo-2']);
			});

			it('handles mixed arrays', () => {
				const input = ['static', '${{ steps[0].data.id }}', 42, true];
				const result = resolveStepReferences(input, stepResults);
				expect(result).toEqual(['static', 'todo-1', 42, true]);
			});
		});

		describe('whitespace handling', () => {
			it('handles extra whitespace in references', () => {
				const input = '${{   steps[0].data.id   }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('todo-1');
			});

			it('handles minimal whitespace', () => {
				const input = '${{steps[0].data.id}}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('todo-1');
			});
		});
	});

	describe('resolveStepReferences input handling', () => {
		it('returns undefined for a step without input', () => {
			expect(resolveInput(undefined, [])).toBeUndefined();
		});
	});

	describe('getValueAtPath', () => {
		it('handles null input', () => {
			const result = getValueAtPath(null, 'any.path');
			expect(result).toBeUndefined();
		});

		it('handles undefined input', () => {
			const result = getValueAtPath(undefined, 'any.path');
			expect(result).toBeUndefined();
		});

		it('returns full object for empty path segment', () => {
			const obj = { data: { nested: 'value' } };
			const result = getValueAtPath(obj, 'data');
			expect(result).toEqual({ nested: 'value' });
		});

		it('handles deeply nested paths', () => {
			const obj = { a: { b: { c: { d: { e: 'deep' } } } } };
			const result = getValueAtPath(obj, 'a.b.c.d.e');
			expect(result).toBe('deep');
		});

		it('returns undefined when a path goes through a primitive', () => {
			expect(getValueAtPath({ a: 'text' }, 'a.length')).toBeUndefined();
		});

		it('handles array access on non-array returns undefined', () => {
			const obj = { data: { items: 'not an array' } };
			const result = getValueAtPath(obj, 'data.items[0]');
			expect(result).toBeUndefined();
		});
	});
});
