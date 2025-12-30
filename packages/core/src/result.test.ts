import { describe, expect, it } from 'vitest';
import { failure, isFailure, isSuccess, success } from './result.js';

describe('success', () => {
	it('creates a successful result with data', () => {
		const result = success({ id: '123', name: 'Test' });

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ id: '123', name: 'Test' });
		expect(result.error).toBeUndefined();
	});

	it('includes optional UX-enabling fields', () => {
		const result = success('test data', {
			confidence: 0.95,
			reasoning: 'Because it matches the pattern',
			sources: [{ type: 'document', title: 'Style Guide' }],
		});

		expect(result.success).toBe(true);
		expect(result.confidence).toBe(0.95);
		expect(result.reasoning).toBe('Because it matches the pattern');
		expect(result.sources).toHaveLength(1);
	});
});

describe('failure', () => {
	it('creates a failed result with error', () => {
		const result = failure({
			code: 'NOT_FOUND',
			message: 'Document not found',
		});

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.data).toBeUndefined();
	});

	it('includes optional metadata', () => {
		const result = failure(
			{ code: 'ERROR', message: 'Failed' },
			{
				warnings: [{ code: 'WARN', message: 'Something to note', severity: 'info' }],
				metadata: { traceId: 'trace-123' },
			}
		);

		expect(result.warnings).toHaveLength(1);
		expect(result.metadata?.traceId).toBe('trace-123');
	});
});

describe('isSuccess', () => {
	it('returns true for successful results', () => {
		const result = success({ id: '123' });
		expect(isSuccess(result)).toBe(true);
	});

	it('returns false for failed results', () => {
		const result = failure({ code: 'ERROR', message: 'Failed' });
		expect(isSuccess(result)).toBe(false);
	});

	it('narrows type correctly', () => {
		const result = success({ id: '123' });
		if (isSuccess(result)) {
			// TypeScript should know result.data exists
			expect(result.data.id).toBe('123');
		}
	});
});

describe('isFailure', () => {
	it('returns true for failed results', () => {
		const result = failure({ code: 'ERROR', message: 'Failed' });
		expect(isFailure(result)).toBe(true);
	});

	it('returns false for successful results', () => {
		const result = success({ id: '123' });
		expect(isFailure(result)).toBe(false);
	});

	it('narrows type correctly', () => {
		const result = failure({ code: 'ERROR', message: 'Failed' });
		if (isFailure(result)) {
			// TypeScript should know result.error exists
			expect(result.error.code).toBe('ERROR');
		}
	});
});
