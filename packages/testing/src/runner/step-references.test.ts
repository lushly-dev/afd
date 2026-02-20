/**
 * @lushly-dev/afd-testing - Step Reference Resolution Tests
 */

import { describe, expect, it } from 'vitest';

// We need to test the step reference resolution functions
// They are internal to executor.ts, so we test via the exported InProcessExecutor
// But for unit testing, let's create standalone functions that can be tested

/**
 * Resolve step references in a value.
 * References use syntax: ${{ steps[N].path.to.value }}
 */
function resolveStepReferences(
	value: unknown,
	stepResults: Array<{ success: boolean; data?: unknown }>
): unknown {
	return resolveValue(value, stepResults);
}

function resolveValue(
	value: unknown,
	stepResults: Array<{ success: boolean; data?: unknown }>
): unknown {
	if (typeof value === 'string') {
		return resolveStringReferences(value, stepResults);
	}
	if (Array.isArray(value)) {
		return value.map((v) => resolveValue(v, stepResults));
	}
	if (value !== null && typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = resolveValue(v, stepResults);
		}
		return result;
	}
	return value;
}

function resolveStringReferences(
	str: string,
	stepResults: Array<{ success: boolean; data?: unknown }>
): unknown {
	// Exact match: entire string is a reference (return raw value)
	const exactMatch = /^\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}$/.exec(str);
	if (exactMatch && exactMatch[1] !== undefined && exactMatch[2] !== undefined) {
		const stepIndex = parseInt(exactMatch[1], 10);
		const path = exactMatch[2];
		return getValueAtPath(stepResults[stepIndex], path);
	}

	// Embedded references: replace within string
	return str.replace(/\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}/g, (_match, stepIndexStr, path) => {
		const stepIndex = parseInt(stepIndexStr, 10);
		const value = getValueAtPath(stepResults[stepIndex], path);
		return String(value ?? '');
	});
}

function getValueAtPath(obj: unknown, path: string): unknown {
	const parts = path.split('.');
	let current: unknown = obj;

	for (const part of parts) {
		if (current === null || current === undefined) {
			return undefined;
		}

		// Handle array index: items[0]
		const arrayMatch = /^(\w+)\[(\d+)\]$/.exec(part);
		if (arrayMatch && arrayMatch[1] !== undefined && arrayMatch[2] !== undefined) {
			const key = arrayMatch[1];
			const index = parseInt(arrayMatch[2], 10);
			current = (current as Record<string, unknown>)[key];
			if (Array.isArray(current)) {
				current = current[index];
			} else {
				return undefined;
			}
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}

	return current;
}

describe('Step Reference Resolution', () => {
	describe('resolveStepReferences', () => {
		const stepResults = [
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

			it('returns undefined for non-existent step', () => {
				const input = '${{ steps[99].data.id }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBeUndefined();
			});

			it('returns undefined for non-existent path', () => {
				const input = '${{ steps[0].data.nonexistent }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBeUndefined();
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

			it('replaces undefined values with empty string', () => {
				const input = 'Missing: ${{ steps[0].data.missing }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBe('Missing: ');
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

			it('returns undefined for out-of-bounds index', () => {
				const input = '${{ steps[2].data.items[99].name }}';
				const result = resolveStepReferences(input, stepResults);
				expect(result).toBeUndefined();
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

		it('handles array access on non-array returns undefined', () => {
			const obj = { data: { items: 'not an array' } };
			const result = getValueAtPath(obj, 'data.items[0]');
			expect(result).toBeUndefined();
		});
	});
});
