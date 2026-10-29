import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPublished } from './release-operations/prerequisites.mjs';

test('fresh registry lag retries reads only and stops once version metadata exists', () => {
	let calls = 0;
	const waits = [];
	const metadata = { name: '@fixture/a', version: '1.0.0' };
	const actual = readPublished(metadata, {
		lookup: () => (++calls < 3 ? { notVisible: true } : metadata),
		wait: (ms) => waits.push(ms),
	});
	assert.equal(actual, metadata);
	assert.equal(calls, 3);
	assert.deepEqual(waits, [5000, 5000]);
});
test('lag has a fixed attempt limit and other errors fail immediately', () => {
	let calls = 0,
		waits = 0;
	assert.throws(
		() =>
			readPublished(
				{ name: '@fixture/a', version: '1.0.0' },
				{
					lookup: () => {
						calls++;
						return { notVisible: true };
					},
					wait: () => waits++,
				}
			),
		/still not visible/
	);
	assert.equal(calls, 24);
	assert.equal(waits, 23);
	calls = 0;
	assert.throws(
		() =>
			readPublished(
				{},
				{
					lookup: () => {
						calls++;
						throw new Error('network failed');
					},
					wait: () => assert.fail('must not wait'),
				}
			),
		/network failed/
	);
	assert.equal(calls, 1);
});
