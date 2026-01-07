/**
 * Tests for step evaluator
 */

import { describe, it, expect } from 'vitest';
import { evaluateResult } from '../runner/evaluator.js';
import type { CommandResult } from '@lushly-dev/afd-core';
import type { Expectation } from '../types/scenario.js';

describe('Evaluator', () => {
	describe('evaluateResult', () => {
		describe('success assertion', () => {
			it('should pass when success matches', () => {
				const actual: CommandResult<unknown> = { success: true, data: {} };
				const expected: Expectation = { success: true };

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
				expect(result.assertions).toHaveLength(1);
				expect(result.assertions.at(0)?.passed).toBe(true);
			});

			it('should fail when success does not match', () => {
				const actual: CommandResult<unknown> = { success: false };
				const expected: Expectation = { success: true };

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(false);
				expect(result.assertions.at(0)?.passed).toBe(false);
			});
		});

		describe('data assertions', () => {
			it('should validate simple data equality', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { title: 'Buy groceries', completed: false },
				};
				const expected: Expectation = {
					success: true,
					data: { title: 'Buy groceries' },
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should fail on data mismatch', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { title: 'Buy groceries' },
				};
				const expected: Expectation = {
					success: true,
					data: { title: 'Go shopping' },
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(false);
			});

			it('should handle nested data paths', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: {
						user: { name: 'John', email: 'john@example.com' },
					},
				};
				const expected: Expectation = {
					success: true,
					data: {
						user: { name: 'John' },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});
		});

		describe('matchers', () => {
			it('should handle exists matcher', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { id: '123', createdAt: '2024-01-01' },
				};
				const expected: Expectation = {
					success: true,
					data: {
						id: { exists: true },
						createdAt: { exists: true },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle exists:false for missing fields', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { id: '123' },
				};
				const expected: Expectation = {
					success: true,
					data: {
						deletedAt: { exists: false },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle contains matcher', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { message: 'Todo created successfully' },
				};
				const expected: Expectation = {
					success: true,
					data: {
						message: { contains: 'successfully' },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should fail contains when substring not found', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { message: 'Todo created' },
				};
				const expected: Expectation = {
					success: true,
					data: {
						message: { contains: 'deleted' },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(false);
			});

			it('should handle length matcher for arrays', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { items: [1, 2, 3] },
				};
				const expected: Expectation = {
					success: true,
					data: {
						items: { length: 3 },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle gte matcher', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { count: 10 },
				};
				const expected: Expectation = {
					success: true,
					data: {
						count: { gte: 5 },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle lte matcher', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { count: 3 },
				};
				const expected: Expectation = {
					success: true,
					data: {
						count: { lte: 10 },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle between matcher', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { score: 75 },
				};
				const expected: Expectation = {
					success: true,
					data: {
						score: { between: [50, 100] },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle includes matcher for arrays', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { tags: ['urgent', 'work', 'review'] },
				};
				const expected: Expectation = {
					success: true,
					data: {
						tags: { includes: 'urgent' },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should handle matches (regex) matcher', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { id: 'todo-12345-abc' },
				};
				const expected: Expectation = {
					success: true,
					data: {
						id: { matches: '^todo-\\d+-[a-z]+$' },
					},
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});
		});

		describe('error assertions', () => {
			it('should validate error code', () => {
				const actual: CommandResult<unknown> = {
					success: false,
					error: { code: 'NOT_FOUND', message: 'Item not found' },
				};
				const expected: Expectation = {
					success: false,
					error: { code: 'NOT_FOUND' },
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should validate error message contains', () => {
				const actual: CommandResult<unknown> = {
					success: false,
					error: { code: 'VALIDATION_ERROR', message: 'Title is required' },
				};
				const expected: Expectation = {
					success: false,
					error: { message: 'required' },
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});
		});

		describe('reasoning and confidence', () => {
			it('should validate reasoning contains', () => {
				const actual = {
					success: true,
					data: {},
					reasoning: 'Applied override from Xbox config',
				};
				const expected: Expectation = {
					success: true,
					reasoning: 'Xbox',
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should validate confidence threshold', () => {
				const actual = {
					success: true,
					data: {},
					confidence: 0.95,
				};
				const expected: Expectation = {
					success: true,
					confidence: 0.8,
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(true);
			});

			it('should fail when confidence below threshold', () => {
				const actual = {
					success: true,
					data: {},
					confidence: 0.5,
				};
				const expected: Expectation = {
					success: true,
					confidence: 0.8,
				};

				const result = evaluateResult(actual, expected);

				expect(result.passed).toBe(false);
			});
		});

		describe('assertion results', () => {
			it('should include human-readable descriptions', () => {
				const actual: CommandResult<unknown> = {
					success: true,
					data: { count: 10 },
				};
				const expected: Expectation = {
					success: true,
					data: { count: { gte: 5 } },
				};

				const result = evaluateResult(actual, expected);

				expect(result.assertions.length).toBeGreaterThan(0);
				const gteAssertion = result.assertions.find((a) => a.matcher === 'gte');
				expect(gteAssertion?.description).toBeDefined();
				expect(gteAssertion?.description).toContain('count');
			});
		});
	});
});
