import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	READBACK_DEADLINE_MS,
	READBACK_MAX_ATTEMPTS,
	readPublished,
	readPublishedBatch,
} from './release-operations/prerequisites.mjs';

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
	assert.deepEqual(waits, [5000, 10000]);
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
	assert.equal(calls, READBACK_MAX_ATTEMPTS);
	assert.equal(waits, READBACK_MAX_ATTEMPTS - 1);
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

test('the readback deadline stops slow lookups without another wait or read', () => {
	let time = 0,
		calls = 0;
	assert.throws(
		() =>
			readPublished(
				{ name: '@fixture/a', version: '1.0.0' },
				{
					now: () => time,
					lookup: () => {
						calls++;
						time = READBACK_DEADLINE_MS;
						return { notVisible: true };
					},
					wait: () => assert.fail('deadline reached'),
				}
			),
		/still not visible/
	);
	assert.equal(calls, 1);
});

test('a blob that appears after ten minutes is still read back (#1007)', () => {
	let time = 0;
	const waits = [];
	const metadata = { name: '@fixture/a', version: '1.0.0' };
	const actual = readPublished(metadata, {
		now: () => time,
		lookup: () => (time < 11 * 60_000 ? { notVisible: true } : metadata),
		wait: (ms) => {
			waits.push(ms);
			time += ms;
		},
	});
	assert.equal(actual, metadata);
	assert.deepEqual(waits.slice(0, 6), [5000, 10000, 20000, 40000, 60000, 60000]);
	assert.ok(waits.every((ms) => ms <= 60000));
});

test('waiting stops at the deadline, with the last wait cut to what remains', () => {
	let time = 0,
		calls = 0;
	const waits = [];
	assert.throws(
		() =>
			readPublished(
				{ name: '@fixture/a', version: '1.0.0' },
				{
					now: () => time,
					lookup: () => {
						calls++;
						return { notVisible: true };
					},
					wait: (ms) => {
						waits.push(ms);
						time += ms;
					},
				}
			),
		/still not visible/
	);
	assert.equal(time, READBACK_DEADLINE_MS);
	assert.ok(calls < READBACK_MAX_ATTEMPTS);
	assert.equal(
		waits.reduce((sum, ms) => sum + ms, 0),
		READBACK_DEADLINE_MS
	);
});

test('readPublishedBatch overlaps backoff waits across a wave of independent artifacts (#952)', () => {
	let time = 0;
	const waits = [];
	const calls = { '@fixture/a': 0, '@fixture/b': 0, '@fixture/c': 0 };
	const artifacts = [
		{ name: '@fixture/a', version: '1.0.0' },
		{ name: '@fixture/b', version: '1.0.0' },
		{ name: '@fixture/c', version: '1.0.0' },
	];
	// Each package becomes visible at a different time; all three share one backoff schedule.
	const readyAt = { '@fixture/a': 15_000, '@fixture/b': 5_000, '@fixture/c': 35_000 };
	const observed = readPublishedBatch(artifacts, {
		now: () => time,
		lookup: (artifact) => {
			calls[artifact.name]++;
			return time >= readyAt[artifact.name]
				? { name: artifact.name, version: artifact.version }
				: { notVisible: true };
		},
		wait: (ms) => {
			waits.push(ms);
			time += ms;
		},
	});
	assert.deepEqual(
		observed.map((entry) => entry.name),
		['@fixture/a', '@fixture/b', '@fixture/c']
	);
	// One shared backoff (5s + 10s + 20s = 35s) instead of waiting separately for each package (55s).
	assert.deepEqual(waits, [5000, 10000, 20000]);
	assert.equal(time, 35_000);
	// Ready packages are not polled again on later rounds.
	assert.deepEqual(calls, { '@fixture/a': 3, '@fixture/b': 2, '@fixture/c': 4 });
});

test('readPublishedBatch attributes an immediate lookup error to the failing artifact (#952)', () => {
	const artifacts = [
		{ name: '@fixture/a', version: '1.0.0' },
		{ name: '@fixture/b', version: '1.0.0' },
		{ name: '@fixture/c', version: '1.0.0' },
	];
	let caught;
	try {
		readPublishedBatch(artifacts, {
			lookup: (artifact) => {
				if (artifact.name === '@fixture/b') throw new Error('HTTP 503');
				return { name: artifact.name, version: artifact.version };
			},
			wait: () => assert.fail('must not wait on non-visibility error'),
		});
	} catch (error) {
		caught = error;
	}
	assert.match(caught?.message ?? '', /HTTP 503/);
	assert.equal(caught?.artifact, '@fixture/b');
	assert.deepEqual(
		caught?.pending?.map((entry) => entry.name),
		['@fixture/b', '@fixture/c']
	);
	assert.equal(caught?.results?.has('@fixture/a'), true);
});
