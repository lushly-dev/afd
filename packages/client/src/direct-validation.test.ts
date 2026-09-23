import { describe, expect, it } from 'vitest';
import { validateInput } from './direct-validation.js';

describe('validateInput integer parameters', () => {
	const parameters = [
		{ name: 'limit', type: 'integer' as const, description: 'Page size', required: true },
	];

	it('accepts integral numbers', () => {
		expect(validateInput({ limit: 20 }, parameters)).toBeNull();
	});

	it('rejects fractions and non-numbers', () => {
		for (const limit of [2.5, '20']) {
			expect(validateInput({ limit }, parameters)).toEqual([
				{
					parameter: 'limit',
					message: "Parameter 'limit' has wrong type",
					expected: 'integer',
					received: typeof limit,
				},
			]);
		}
	});
});
