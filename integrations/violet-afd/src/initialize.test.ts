import { describe, expect, it } from 'vitest';
import { initializeCore, registry } from './index.js';

describe('initializeCore', () => {
	it('is idempotent: a second call is a no-op and does not throw', () => {
		initializeCore();
		const before = registry.list().length;
		expect(before).toBeGreaterThan(0);

		expect(() => initializeCore()).not.toThrow();
		expect(registry.list().length).toBe(before);
	});
});
