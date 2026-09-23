import { describe, expect, it } from 'vitest';
import { error, failure, success } from './index.js';

describe('result helper re-exports', () => {
	it('re-exports the documented error(code, message, options) helper', () => {
		expect(error('NOT_FOUND', 'Todo 1 not found', { suggestion: 'Use todo-list' })).toEqual(
			failure({ code: 'NOT_FOUND', message: 'Todo 1 not found', suggestion: 'Use todo-list' })
		);
		expect(success(1).success).toBe(true);
	});
});
