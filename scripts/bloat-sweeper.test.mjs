/** The bloat-sweeper skill's script, which Botcore ships to every repository that seeds the skill. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	areaResolver,
	countLines,
	findClones,
	formatTrend,
	isJudgedCohesive,
	isMeasured,
	NOT_KEEPING_UP,
	parseMetrics,
	rankOversized,
	readSettings,
	recordBody,
	worseningMeasures,
} from '../endpoints/botcore/src/botcore/skills/bloat-sweeper/scripts/sweep.mjs';

test('settings come from botcore.toml, or from pyproject.toml under tool.botcore', () => {
	const settings = readSettings(
		[
			'file_size_warn = 400 # comment',
			'file_size_error = 1500',
			'[skills]',
			'listing_budget = 6000',
			'[sweep]',
			'trend_issue = 42',
			'exclude = [',
			'  "vendor/",',
			"  'third_party/',",
			']',
			'measures = "node scripts/measures.mjs"',
		].join('\n')
	);
	assert.equal(settings.threshold, 400);
	assert.equal(settings.trendIssue, 42);
	assert.deepEqual(settings.exclude, ['vendor/', 'third_party/']);
	assert.equal(settings.measures, 'node scripts/measures.mjs');
	assert.equal(settings.churnDays, 90);
	assert.equal(settings.cohesive, 'sweep-cohesive.json');

	const pyproject = readSettings(
		'[tool.botcore]\nfile_size_warn = 300\n[tool.botcore.sweep]\nchurn_days = 30\n',
		{
			pyproject: true,
		}
	);
	assert.equal(pyproject.threshold, 300);
	assert.equal(pyproject.churnDays, 30);
	assert.equal(readSettings('').threshold, 500);
});

test('only source is measured: no tests, output, generated files or excluded prefixes', () => {
	const settings = readSettings('[sweep]\nexclude = ["foundations/fast-af"]\n');
	for (const path of [
		'src/a.ts',
		'packages/x/src/b.mjs',
		'python/src/afd/c.py',
		'crate/src/lib.rs',
	])
		assert.equal(isMeasured(path, settings), true, path);
	for (const path of [
		'src/a.test.ts',
		'src/a.stories.ts',
		'src/a.d.ts',
		'tests/test_a.py',
		'src/a_test.py',
		'dist/a.js',
		'src/_generated/types.ts',
		'packages/x/test/helper.ts',
		'README.md',
		'foundations/fast-af/packages/a.ts',
	])
		assert.equal(isMeasured(path, settings), false, path);
});

test('a file belongs to the nearest package, and the root is the last resort', () => {
	const areaOf = areaResolver([
		'package.json',
		'packages/core/package.json',
		'python/pyproject.toml',
		'endpoints/umbel/Cargo.toml',
		'endpoints/umbel/plugins/ideas/Cargo.toml',
	]);
	assert.equal(areaOf('packages/core/src/a.ts'), 'packages/core');
	assert.equal(areaOf('python/src/afd/b.py'), 'python');
	assert.equal(areaOf('endpoints/umbel/src/c.rs'), 'endpoints/umbel');
	assert.equal(areaOf('endpoints/umbel/plugins/ideas/src/d.rs'), 'endpoints/umbel/plugins/ideas');
	assert.equal(areaOf('scripts/e.mjs'), '.');
	assert.equal(areaOf('f.mjs'), '.');
});

test('lines past the threshold, weighted by churn, rank the busy big file first', () => {
	assert.equal(countLines(''), 0);
	assert.equal(countLines('a\nb\n'), 2);
	assert.equal(countLines('a\nb'), 2);
	const ranked = rankOversized(
		[
			{ path: 'big-quiet.ts', lines: 1400, churn: 0 },
			{ path: 'busy.ts', lines: 700, churn: 9 },
			{ path: 'small.ts', lines: 300, churn: 50 },
		],
		500
	);
	assert.deepEqual(
		ranked.map((file) => file.path),
		['busy.ts', 'big-quiet.ts']
	);
	const verdicts = { 'busy.ts': { lines: 650, reason: 'one table' } };
	assert.equal(isJudgedCohesive({ path: 'busy.ts', lines: 700 }, verdicts), true);
	assert.equal(isJudgedCohesive({ path: 'busy.ts', lines: 800 }, verdicts), false);
});

test('a pasted run of ten lines is a copy; imports and comments are not', () => {
	const body = Array.from(
		{ length: 12 },
		(_, index) => `const value${index} = compute(${index});`
	).join('\n');
	const imports = Array.from(
		{ length: 12 },
		(_, index) => `import { name${index} } from './m${index}.js';`
	).join('\n');
	const { groups, duplicatedLines } = findClones([
		{ path: 'a.ts', contents: `${imports}\n${body}\n` },
		{ path: 'b.ts', contents: `// other\n${body}\n` },
		{ path: 'c.ts', contents: `${imports}\nconst unrelated = 1;\n` },
	]);
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0].files, ['a.ts', 'b.ts']);
	assert.equal(groups[0].lines, 12);
	assert.equal(duplicatedLines.get('a.ts'), 12);
	assert.equal(duplicatedLines.has('c.ts'), false);
});

test('the trend reads recorded passes and says when deferral is losing', () => {
	const pass = (date, overThreshold, extra = {}) => ({
		date,
		head: 'abc1234',
		overThreshold,
		duplicatedLines: 10,
		spreadingClones: 1,
		...extra,
	});
	const bodies = [
		recordBody({
			metrics: pass('2026-11-01', 50, { chunkBytes: 10, labels: { chunkBytes: 'chunk bytes' } }),
			area: 'a',
		}),
		recordBody({
			metrics: pass('2026-11-08', 52, { chunkBytes: 11, labels: { chunkBytes: 'chunk bytes' } }),
			area: 'a',
		}),
		'a hand-written comment',
		recordBody({
			metrics: pass('2026-11-15', 55, { chunkBytes: 12, labels: { chunkBytes: 'chunk bytes' } }),
			area: 'b',
		}),
		recordBody({
			metrics: pass('2026-11-22', 60, { chunkBytes: 13, labels: { chunkBytes: 'chunk bytes' } }),
			area: 'b',
		}),
	];
	assert.match(bodies[0], /- chunk bytes: 10/);
	const history = parseMetrics(bodies);
	assert.equal(history.length, 4);
	assert.deepEqual(
		worseningMeasures(history).map(({ key }) => key),
		['overThreshold', 'chunkBytes']
	);
	const text = formatTrend(history, 7);
	assert.match(text, /Bloat trend from #7/);
	assert.ok(text.includes(NOT_KEEPING_UP));
	assert.match(formatTrend(history.slice(0, 2), 7), /Verdict: holding/);
	assert.match(formatTrend([], 7), /No measurements recorded on #7 yet/);
});
