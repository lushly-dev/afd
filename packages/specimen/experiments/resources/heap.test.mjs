import { expect, it } from 'vitest';
import { allocationTotals } from './heap.mjs';

it('groups sampled self sizes without double-counting inclusive ancestors', () => {
	const frame = { url: '/runtime.js', lineNumber: 3, functionName: 'allocate' };
	const profile = {
		head: {
			callFrame: frame,
			selfSize: 100,
			children: [
				{
					callFrame: frame,
					selfSize: 50,
					children: [
						{ callFrame: { url: '/other.js', lineNumber: 0, functionName: '' }, selfSize: 20 },
					],
				},
			],
		},
	};
	expect(allocationTotals(profile)).toEqual([
		{ url: '/runtime.js', line: 4, function: 'allocate', sampledBytes: 150 },
		{ url: '/other.js', line: 1, function: '(anonymous)', sampledBytes: 20 },
	]);
	expect(allocationTotals(profile, 1)).toHaveLength(1);
});
