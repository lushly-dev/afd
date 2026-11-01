import { describe, expect, it } from 'vitest';
import { speedProbe } from './speed-probe.mjs';

describe('speedProbe', () => {
	it('runs identical fixed work and reports its CPU and wall time', () => {
		const first = speedProbe();
		const second = speedProbe();
		expect(first.status).toBe('complete');
		expect(first.cpuSeconds).toBeGreaterThan(0);
		expect(first.wallSeconds).toBeGreaterThan(0);
		// Same work, same result: the digest identifies the workload, not the host.
		expect(second.digest).toBe(first.digest);
		// A multi-run probe reports the fastest of its separate runs.
		const several = speedProbe({ runs: 2 });
		expect(several.runs).toHaveLength(2);
		expect(several.cpuSeconds).toBe(Math.min(...several.runs.map((run) => run.cpuSeconds)));
	});
});
