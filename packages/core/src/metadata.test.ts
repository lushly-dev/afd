import { describe, expect, it } from 'vitest';
import type { WarningSeverity } from './metadata.js';
import { createWarning } from './metadata.js';

describe('WarningSeverity', () => {
	it('accepts valid severity values via createWarning', () => {
		const severities: WarningSeverity[] = ['info', 'warning', 'caution'];

		for (const severity of severities) {
			const warning = createWarning('TEST', 'test message', severity);
			expect(warning.severity).toBe(severity);
		}
	});

	it('defaults to warning severity', () => {
		const warning = createWarning('TEST', 'test message');
		expect(warning.severity).toBe('warning');
	});
});
