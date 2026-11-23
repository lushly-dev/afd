// Generates pipeline-variables.json from the TypeScript reference implementation, so every
// language can check its resolver and conditions against the same expected values.
//
//   pnpm -F @lushly-dev/afd-core build
//   node spec/vectors/generate-pipeline-variables.mjs
import { writeFileSync } from 'node:fs';
import { evaluateCondition, resolveVariable } from '../../packages/core/dist/pipeline-variables.js';

// The prefix "$prev." has six UTF-16 units. These keys make references of exactly 1024/1025.
const astralBoundaryKey = '😀'.repeat(509);
const astralOverLimitKey = `${astralBoundaryKey}a`;

// Step 0 succeeded (alias "user"), step 1 failed (alias "broken"), step 2 succeeded; steps 3
// and 4 succeeded with null data and with none.
const context = {
	input: { q: 'milk', n: 2, nested: { deep: [1, { v: 'x' }] } },
	steps: [
		{
			index: 0,
			alias: 'user',
			status: 'success',
			data: {
				id: 'u1',
				name: 'Ada',
				items: [10, 20, 30],
				0: 'zero',
				nothing: null,
				constructor: 'c',
				'key with space': 1,
			},
		},
		{ index: 1, alias: 'broken', status: 'failure' },
		{
			index: 2,
			status: 'success',
			data: {
				id: 't9',
				done: false,
				count: 3,
				[astralBoundaryKey]: 'at-limit',
				[astralOverLimitKey]: 'over-limit',
			},
		},
		// A step that succeeded with `null` data, which a reference reads as null (#1961), and one
		// that succeeded with no data, which is absent. `previous` stays step 2.
		{ index: 3, alias: 'empty', status: 'success', data: null },
		{ index: 4, alias: 'none', status: 'success' },
	],
	previous: 2,
};

const tsContext = {
	pipelineInput: context.input,
	steps: context.steps.map((step) => ({ ...step, command: `step-${step.index}` })),
	previousResult: undefined,
};
tsContext.previousResult = tsContext.steps[context.previous];

const references = [
	'$steps.empty',
	'$steps[3]',
	'$steps.empty.x',
	'$steps.none',
	'$steps[4]',
	'$prev',
	'$prev.id',
	'$prev.missing',
	'$prev.id.deeper',
	'$prev.',
	'$prevx',
	'$prev.a b',
	// A non-breaking space is JavaScript whitespace, so this is a literal.
	`$prev.a${String.fromCharCode(0xa0)}b`,
	'$first',
	'$first.name',
	'$first.items',
	'$first.items[1]',
	'$first.items.2',
	'$first.items.01',
	'$first.items[3]',
	'$first.items[99999999999999999999]',
	'$first.0',
	'$first.nothing',
	'$first.nothing.x',
	'$first.constructor',
	'$first.__proto__',
	'$first.__class__',
	'$first.items.length',
	'$steps[0].id',
	'$steps[1]',
	'$steps[2].done',
	'$steps[5]',
	'$steps[0][1]',
	'$steps.user.name',
	'$steps.user[0]',
	'$steps.broken',
	'$steps.nobody',
	'$steps.__proto__',
	'$steps',
	'$stepsx',
	'$input',
	'$input.q',
	'$input.nested.deep[1].v',
	'$input.nested.deep.1.v',
	'$9.99',
	'$HOME',
	'$',
	'$$prev',
	'$$$prev',
	'plain',
	'',
	`$prev.${'a'.repeat(1018)}`,
	`$prev.${'a'.repeat(1019)}`,
	`$prev.${astralBoundaryKey}`,
	`$prev.${astralOverLimitKey}`,
	`$$prev.${astralOverLimitKey}`,
];

const conditions = [
	{ $exists: '$steps.empty' },
	{ $eq: ['$steps.empty', null] },
	{ $ne: ['$steps.empty', null] },
	{ $eq: ['$steps.none', null] },
	{ $exists: '$prev.id' },
	{ $exists: '$prev.missing' },
	{ $exists: '$first.nothing' },
	{ $exists: '$steps.nobody.id' },
	{ $exists: 'not-a-reference' },
	{ $exists: '$$prev' },
	{ $eq: ['$prev.done', false] },
	{ $eq: ['$first.items', [10, 20, 30]] },
	{ $eq: ['$input', { q: 'milk', n: 2, nested: { deep: [1, { v: 'x' }] } }] },
	{ $eq: ['$input.n', 2.0] },
	{ $eq: ['$first.nothing', null] },
	{ $eq: ['$steps.nobody', null] },
	{ $ne: ['$steps.nobody', 'x'] },
	{ $ne: ['$prev.id', 'other'] },
	{ $ne: ['$prev.id', 't9'] },
	{ $gt: ['$prev.count', 2] },
	{ $gte: ['$prev.count', 3] },
	{ $lt: ['$prev.count', 3] },
	{ $lte: ['$prev.count', 3] },
	{ $gt: ['$prev.id', 1] },
	{ $lt: ['$steps.nobody', 1] },
	{ $and: [] },
	{ $or: [] },
	{ $and: [{ $exists: '$prev.id' }, { $gt: ['$input.n', 1] }] },
	{ $or: [{ $exists: '$steps.nobody' }, { $eq: ['$input.q', 'milk'] }] },
	{ $not: { $exists: '$steps.nobody' } },
	{ $not: { $eq: ['$prev.id', 't9'] } },
];

const vectors = {
	description:
		'Pipeline variable references and conditions (spec/pipeline-variables.md), with values produced by the TypeScript implementation. Regenerate with node spec/vectors/generate-pipeline-variables.mjs.',
	context,
	references: references.map((reference) => {
		const resolved = resolveVariable(reference, tsContext);
		return resolved === undefined
			? { reference, resolved: false }
			: { reference, resolved: true, value: resolved };
	}),
	conditions: conditions.map((condition) => ({
		condition,
		expected: evaluateCondition(condition, tsContext),
	})),
};

const json = `${JSON.stringify(vectors, null, '\t')}\n`;
if (process.argv.includes('--stdout')) process.stdout.write(json);
else writeFileSync(new URL('./pipeline-variables.json', import.meta.url), json);
