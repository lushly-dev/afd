import { describe, expect, it } from 'vitest';
import { admission } from './host.mjs';

describe('resource pilot admission', () => {
	it('requires measured memory and CPU headroom before one job', () => {
		expect(admission({ freeMemoryPercent: 50, logicalCores: 10, usedCores: 2 }).admitted).toBe(
			true
		);
		expect(
			admission({ freeMemoryPercent: null, logicalCores: 10, usedCores: 2 }).reasons
		).toContain('HOST_MEMORY_HEADROOM_UNAVAILABLE');
		expect(
			admission({ freeMemoryPercent: 50, logicalCores: 10, usedCores: null }).reasons
		).toContain('HOST_CPU_HEADROOM_UNAVAILABLE');
	});
	it('retains the numeric reserves and rejects exhausted headroom', () => {
		const blocked = admission({ freeMemoryPercent: 20, logicalCores: 10, usedCores: 9 });
		expect(blocked.admitted).toBe(false);
		expect(blocked.reasons).toHaveLength(2);
		expect(blocked.minFreeMemoryPercent).toBe(25);
		expect(blocked.reservedCores).toBe(2);
	});
});
