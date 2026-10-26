import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertPinnedConvexFixtureDependency } from './cli-preflight.mjs';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

test('CLI dependency preflight validates the actual fixture package pin', async () => {
	const fixturePackage = JSON.parse(await readFile(join(fixtureDir, 'package.json'), 'utf8'));
	assert.equal(assertPinnedConvexFixtureDependency(fixturePackage), fixturePackage);
});

test('CLI dependency preflight rejects a missing or altered fixture package pin', () => {
	assert.throws(
		() => assertPinnedConvexFixtureDependency({ dependencies: {} }),
		/Convex fixture package.json must pin convex 1\.32\.0/
	);
	assert.throws(
		() => assertPinnedConvexFixtureDependency({ dependencies: { convex: '1.31.0' } }),
		/Convex fixture package.json must pin convex 1\.32\.0/
	);
});
