import assert from 'node:assert/strict';
import test from 'node:test';
import { factoryUnits } from './factory-units.mjs';

const scope = (files, affected = [], mode = 'affected') => ({ mode, files, affected });

test('a change names its packages, the workflows its paths trigger and its directories', () => {
	const units = factoryUnits(['packages/core/src/a.ts'], {
		scope: scope(['packages/core/src/a.ts'], ['@lushly-dev/afd-core', '@lushly-dev/afd-cli']),
		triggers: new Map([
			['core.yml', ['packages/core/**']],
			['python.yml', ['python/**']],
		]),
		plan: [{ suite: { workflow: 'loam.yml' } }],
	});
	assert.deepEqual(units, [
		'dir:packages/core/src',
		'package:@lushly-dev/afd-cli',
		'package:@lushly-dev/afd-core',
		'workflow:core.yml',
		'workflow:loam.yml',
	]);
});

test('a change that selects the whole workspace overlaps everything', () => {
	assert.deepEqual(factoryUnits(['package.json'], { scope: scope(['package.json'], [], 'all') }), [
		'*',
	]);
});

test('no change has no unit', () => {
	assert.deepEqual(factoryUnits([]), []);
});

test("this repository's map: two Botcore changes share units, a doc and Botcore do not", () => {
	const botcore = factoryUnits(['endpoints/botcore/src/botcore/__init__.py']);
	const factory = factoryUnits([
		'endpoints/botcore/plugins/botcore-factory/src/botcore_factory/lane.py',
	]);
	const docs = factoryUnits(['docs/README.md']);
	assert.ok(botcore.includes('workflow:botcore.yml'));
	assert.ok(factory.some((unit) => botcore.includes(unit)));
	assert.deepEqual(docs, ['dir:docs']);
	assert.ok(!docs.some((unit) => botcore.includes(unit)));
	assert.deepEqual(factoryUnits(['package.json']), ['*']);
});
