/**
 * Tests for Health 1.0 trend measures producers in the bloat-sweeper and gate-discipline skills:
 * - bloat-sweeper/scripts/sweep.mjs (--measures-out, toMeasuresDocument)
 * - bloat-sweeper/scripts/cognitive-complexity.mjs (JS/TS, Python, Rust, C++, advisory exit 0)
 * - gate-discipline/scripts/report-test-counts.mjs (multi-language counts + exemptions)
 * - gate-discipline/scripts/report-test-changes.mjs (--measures-out, toMeasuresDocument)
 * - gate-discipline/scripts/report-coverage-measures.mjs (Istanbul summary/final, coverage.py, LCOV)
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	analyzeSource,
	toMeasuresDocument as complexityToMeasures,
	measureCognitiveComplexity,
} from '../endpoints/botcore/src/botcore/skills/bloat-sweeper/scripts/cognitive-complexity.mjs';
import { toMeasuresDocument as sweepToMeasures } from '../endpoints/botcore/src/botcore/skills/bloat-sweeper/scripts/sweep.mjs';
import {
	toMeasuresDocument as coverageToMeasures,
	parseCoverageFile,
	parseLcov,
	reportCoverageMeasures,
} from '../endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-coverage-measures.mjs';
import {
	reportTestChanges,
	toMeasuresDocument as testChangesToMeasures,
} from '../endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-test-changes.mjs';
import {
	reportTestCounts,
	toMeasuresDocument as testCountsToMeasures,
} from '../endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-test-counts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP_SCRIPT = join(
	REPO_ROOT,
	'endpoints/botcore/src/botcore/skills/bloat-sweeper/scripts/sweep.mjs'
);
const COMPLEXITY_SCRIPT = join(
	REPO_ROOT,
	'endpoints/botcore/src/botcore/skills/bloat-sweeper/scripts/cognitive-complexity.mjs'
);
const TEST_COUNTS_SCRIPT = join(
	REPO_ROOT,
	'endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-test-counts.mjs'
);
const TEST_CHANGES_SCRIPT = join(
	REPO_ROOT,
	'endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-test-changes.mjs'
);
const COVERAGE_SCRIPT = join(
	REPO_ROOT,
	'endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-coverage-measures.mjs'
);

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DIRECTIONS = new Set(['higher_is_better', 'lower_is_better', 'neutral']);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const FILE_KEYS = new Set(['schema_version', 'measures', 'source', 'target']);
const ROW_KEYS = new Set(['key', 'label', 'value', 'unit', 'direction', 'target', 'source']);

/** Assert a JSON document matches the exact Health 1.0 measures-file contract. */
function assertHealthMeasuresContract(doc) {
	assert.equal(doc.schema_version, '1.0');
	for (const key of Object.keys(doc)) assert.ok(FILE_KEYS.has(key), `unexpected file key: ${key}`);
	if (doc.source !== undefined) assert.match(doc.source, IDENTIFIER);
	if (doc.target !== undefined) assert.match(doc.target, IDENTIFIER);
	assert.ok(Array.isArray(doc.measures));
	const seen = new Set();
	for (const row of doc.measures) {
		for (const key of Object.keys(row)) assert.ok(ROW_KEYS.has(key), `unexpected row key: ${key}`);
		assert.match(row.key, IDENTIFIER);
		assert.equal(typeof row.label, 'string');
		assert.ok(row.label.trim().length > 0);
		assert.equal(typeof row.value, 'number');
		assert.ok(Number.isFinite(row.value) && Math.abs(row.value) <= MAX_SAFE);
		assert.equal(typeof row.unit, 'string');
		assert.ok(row.unit.trim().length > 0);
		assert.ok(DIRECTIONS.has(row.direction), `invalid direction: ${row.direction}`);
		if (row.target !== undefined) assert.match(row.target, IDENTIFIER);
		if (row.source !== undefined) assert.match(row.source, IDENTIFIER);
		const id = `${row.key}::${row.target ?? doc.target ?? ''}`;
		assert.ok(!seen.has(id), `duplicate measure identity: ${id}`);
		seen.add(id);
	}
}

function cleanEnv() {
	const env = { ...process.env };
	for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
	return env;
}

function makeTempRepo(t, files) {
	const dir = mkdtempSync(join(tmpdir(), 'afd-measures-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const env = cleanEnv();
	const git = (args) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
	git(['init', '-b', 'main']);
	git(['config', 'user.email', 'test@example.com']);
	git(['config', 'user.name', 'Test User']);
	for (const [rel, content] of Object.entries(files)) {
		const full = join(dir, rel);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content, 'utf8');
	}
	git(['add', '.']);
	git(['commit', '-m', 'initial']);
	return { dir, env, git };
}

test('sweep toMeasuresDocument namespaces custom keys, checks bounds and measures below-threshold files', (t) => {
	const doc = sweepToMeasures(
		{
			metrics: {
				overThreshold: 4,
				largestLines: 920,
				duplicatedLines: 65,
				cloneGroups: 3,
				spreadingClones: 1,
				tests_total: 240,
				labels: { tests_total: 'Custom repo tests metric' },
			},
			largestMeasuredLines: 920,
			cohesiveCount: 2,
			repositoryMeta: { tests_total: { unit: 'kilobytes', direction: 'lower_is_better' } },
		},
		{ target: 'afd-repo' }
	);
	assertHealthMeasuresContract(doc);
	assert.equal(doc.source, 'sweep-bloat');
	assert.equal(doc.target, 'afd-repo');
	const byKey = Object.fromEntries(doc.measures.map((m) => [m.key, m]));
	assert.equal(byKey.files_over_warn.value, 4);
	assert.equal(byKey.largest_source_lines.value, 920);
	assert.equal(byKey.duplicated_lines.value, 65);
	assert.equal(byKey.clone_groups.value, 3);
	assert.equal(byKey.spreading_clones.value, 1);
	assert.equal(byKey.cohesive_exemptions.value, 2);
	// Namespaced under sweep_custom. so a repo measure named `tests_total` cannot collide.
	assert.equal(byKey['sweep_custom.tests_total'].value, 240);
	assert.equal(byKey['sweep_custom.tests_total'].unit, 'kilobytes');
	assert.throws(() => sweepToMeasures({ metrics: {} }, { target: 'bad target!' }));
	// Exceeding IEEE-754 MAX_SAFE_INTEGER must fail before writing.
	assert.throws(
		() =>
			sweepToMeasures({
				metrics: {
					overThreshold: 0,
					largestLines: 0,
					duplicatedLines: 0,
					cloneGroups: 0,
					spreadingClones: 0,
					huge: 1e16,
					labels: { huge: 'Huge number' },
				},
			}),
		/safe IEEE-754/
	);

	// Below-threshold repo must still report its actual largest file (not 0).
	const smallSource = Array.from({ length: 42 }, (_, i) => `export const v${i} = ${i};`).join('\n');
	const { dir, env } = makeTempRepo(t, {
		'botcore.toml': 'file_size_warn = 500\n',
		'package.json': '{"name":"sample"}\n',
		'src/small.ts': `${smallSource}\n`,
	});
	const outPath = join(dir, 'out/sweep.measures.json');
	const run = spawnSync(process.execPath, [SWEEP_SCRIPT, 'bloat', '--measures-out', outPath], {
		cwd: dir,
		env,
		encoding: 'utf8',
	});
	assert.equal(run.status, 0, run.stderr);
	const written = JSON.parse(readFileSync(outPath, 'utf8'));
	assertHealthMeasuresContract(written);
	assert.equal(written.measures.find((m) => m.key === 'files_over_warn').value, 0);
	assert.equal(written.measures.find((m) => m.key === 'largest_source_lines').value, 42);

	// Empty --measures-out must fail loudly rather than skipping silently.
	const emptyOut = spawnSync(process.execPath, [SWEEP_SCRIPT, 'bloat', '--measures-out', ''], {
		cwd: dir,
		env,
		encoding: 'utf8',
	});
	assert.equal(emptyOut.status, 1);
});

test('cognitive complexity handles JS/TS, Python multiline defs, Rust ?, regexes, arrows and never blocks', (t) => {
	const js = analyzeSource(
		'src/a.ts',
		`
		export function flat(x: { a?: { b?: string } }, cb: (n: number) => void) {
			const v = x?.a?.b;
			const re = /if|else|for|"quote"|\\/\\//;
			const label = v ? 'yes' : 'no';
			cb(1);
			return re.test(v ?? label) ? 1 : 0;
		}
		export function templateInterpolations(a: boolean, b: boolean) {
			return \`prefix \${a ? 1 : 2} if while \${b ? 3 : 4} suffix\`;
		}
		export const exprArrow = (n: number) => (n > 0 ? n : -n);
		export function branchy(a: number, b: number, c: boolean) {
			// if (comment) && || while
			const text = "if (string) for while && ||";
			if (a > 0 && b > 0 || c) {
				for (let i = 0; i < a; i++) {
					if (i % 2 === 0) {
						return i;
					} else if (i === 3) {
						return -1;
					} else {
						continue;
					}
				}
			}
			do {
				a -= 1;
			} while (a > 0);
			if (c) return 7;
			const obj = { ok: true };
			return obj.ok ? 1 : 0;
		}
	`
	);
	// flat: string ternary (+1) + `??` (+1) + numeric ternary (+1) = 3; `?.`, `a?:`, `cb: (n) => void` and regex add 0!
	assert.equal(js.find((f) => f.name === 'flat').complexity, 3);
	// templateInterpolations: both `${...}` ternaries are preserved and scored (+2), while literal text `if while` is masked.
	assert.equal(js.find((f) => f.name === 'templateInterpolations').complexity, 2);
	// TS function-type annotation `(n: number) => void` must not be counted as an extra function.
	assert.equal(js.length, 4);
	// exprArrow: expression-bodied arrow is counted and scores ternary (+1).
	assert.equal(js.find((f) => f.name === 'exprArrow').complexity, 1);
	// branchy: if(1) + &&(1) + ||(1) + for(2) + if(3) + else if(1) + else(1) + do(1) + if(1) + ternary(1) = 13
	assert.equal(js.find((f) => f.name === 'branchy').complexity, 13);

	const py = analyzeSource(
		'src/a.py',
		[
			'def simple(x):',
			'    """if while for and or"""',
			'    return x',
			'',
			'async def multiline_sig(',
			'    items: list[int],',
			'    flag: bool = False,',
			') -> int:',
			'    if (',
			'        items',
			'        and flag',
			'    ):',
			'        for item in items:',
			'            if item > 0:',
			'                return item',
			'    return -1',
		].join('\n')
	);
	assert.equal(py.find((f) => f.name === 'simple').complexity, 0);
	// multiline_sig: if (+1) + and (+1) + for (+2) + if (+3) = 7
	assert.equal(py.find((f) => f.name === 'multiline_sig').complexity, 7);

	const rs = analyzeSource(
		'src/lib.rs',
		`
		pub fn try_ops<'a>(s: &'a str, items: &[i32]) -> Result<i32, ()> {
			let raw = r#"if while for && ||"#;
			let first = items.first().ok_or(())?;
			let mut sum = *first;
			for x in items {
				if *x > 0 && !s.is_empty() {
					sum += *x;
				}
			}
			Ok(sum)
		}
	`
	);
	// Rust `?` adds 0; for (+1) + if (+2) + && (+1) = 4.
	assert.equal(rs.find((f) => f.name === 'try_ops').complexity, 4);

	const cpp = analyzeSource(
		'src/engine.cpp',
		`
		int compute(int n) {
			int total = 0;
			for (int i = 0; i < n; ++i) {
				if (i > 10) {
					total += i;
				}
			}
			return total;
		}
	`
	);
	assert.equal(cpp.find((f) => f.name === 'compute').complexity, 3);

	// Advisory CLI check: even with threshold=1 and findings > 0, exit code MUST stay 0.
	const { dir, env } = makeTempRepo(t, {
		'src/complex.ts':
			'export function f(a: number) { if (a > 0) { if (a > 1) { return 2; } } return 0; }\n',
	});
	const outPath = join(dir, 'out/complexity.measures.json');
	const run = spawnSync(
		process.execPath,
		[COMPLEXITY_SCRIPT, '--root', dir, '--threshold', '1', '--measures-out', outPath],
		{ cwd: dir, env, encoding: 'utf8' }
	);
	assert.equal(run.status, 0, run.stderr);
	const written = JSON.parse(readFileSync(outPath, 'utf8'));
	assertHealthMeasuresContract(written);
	assert.equal(written.source, 'cognitive-complexity');
	assert.equal(written.measures.find((m) => m.key === 'cognitive_complexity_findings').value, 1);
	assert.equal(written.measures.find((m) => m.key === 'cognitive_complexity_max').value, 3);
});

test('report-test-counts separates skips from focus (.only) and emits Health 1.0 JSON', (t) => {
	const { dir, env } = makeTempRepo(t, {
		'packages/a/src/a.test.ts': [
			"fdescribe('focused suite runs, not skipped', () => {",
			"  it('one', () => { expect(1).toBe(1); });",
			"  it.skip('two', () => { expect(2).toBe(2); });",
			"  fit('focused fit runs, not skipped', () => { expect(2).toBe(2); });",
			"  test.only('focused runs, not skipped', () => { expect(3).toBe(3); });",
			'});',
		].join('\n'),
		'python/tests/test_a.py': ['def test_ok():', '    assert 1 == 1', ''].join('\n'),
		'crates/a/tests/basic.rs': ['#[test]', 'fn works() {', '    assert_eq!(1, 1);', '}'].join('\n'),
		'cpp/tests/basic_test.cpp': ['TEST_CASE("ok") {', '    CHECK(1 == 1);', '}'].join('\n'),
		'scenarios/login.scenario.yaml': [
			'name: login',
			'steps:',
			'  - command: auth-login',
			'    expect:',
			'      success: true',
			'  - command: auth-status',
			'    expect:',
			'      success: true',
		].join('\n'),
		'scripts/policy/test-quarantine.json': JSON.stringify({
			quarantined: [
				{
					file: 'packages/a/src/a.test.ts',
					owner: 'owner',
					reason: 'Waiting for upstream parser fix before enabling',
					issue: '#1',
				},
			],
		}),
		'scripts/policy/test-discovery.json': JSON.stringify({
			unrun: [
				{
					path: 'python/examples/test_demo.py',
					owner: 'owner',
					reason: 'Example test file outside main pytest testpaths',
					issue: '#2',
				},
			],
		}),
	});
	const outPath = join(dir, 'out/test-counts.measures.json');
	const run = spawnSync(
		process.execPath,
		[TEST_COUNTS_SCRIPT, '--root', dir, '--measures-out', outPath],
		{ cwd: dir, env, encoding: 'utf8' }
	);
	assert.equal(run.status, 0, run.stderr);
	const written = JSON.parse(readFileSync(outPath, 'utf8'));
	assertHealthMeasuresContract(written);
	const byKey = Object.fromEntries(written.measures.map((m) => [m.key, m.value]));
	assert.equal(byKey.test_files_total, 4);
	assert.equal(byKey.tests_total, 7);
	// `test.only`, `fit` and `fdescribe` must NOT be counted as skipped or unconditionally skipped!
	assert.equal(byKey.tests_skipped, 1);
	assert.equal(byKey.tests_unconditional_skips, 1);
	assert.equal(byKey.tests_quarantined, 1);
	assert.equal(byKey.test_discovery_exemptions, 1);
	assert.equal(byKey.scenario_files_total, 1);
	assert.equal(byKey.scenario_steps_total, 2);
	assert.equal(byKey.tests_javascript, 4);
	assert.equal(byKey.tests_python, 1);
	assert.equal(byKey.tests_rust, 1);
	assert.equal(byKey.tests_cpp, 1);

	// Empty or missing CLI flag values must fail cleanly.
	const missingTarget = spawnSync(
		process.execPath,
		[TEST_COUNTS_SCRIPT, '--root', dir, '--target'],
		{ cwd: dir, env, encoding: 'utf8' }
	);
	assert.equal(missingTarget.status, 1);
	assert.match(missingTarget.stderr, /requires a non-empty value/);
	const emptyMeasuresOut = spawnSync(
		process.execPath,
		[TEST_CHANGES_SCRIPT, '--root', dir, '--base', 'main', '--measures-out', ''],
		{ cwd: dir, env, encoding: 'utf8' }
	);
	assert.equal(emptyMeasuresOut.status, 2);
	assert.match(emptyMeasuresOut.stderr, /requires a non-empty value/);
});

test('report-test-changes --measures-out captures branch weakenings in Health 1.0 JSON', (t) => {
	const { dir, env, git } = makeTempRepo(t, {
		'src/a.test.ts': [
			"it('one', () => { expect(1).toBe(1); });",
			"it('two', () => { expect(2).toBe(2); });",
		].join('\n'),
	});
	git(['checkout', '-b', 'feature']);
	writeFileSync(
		join(dir, 'src/a.test.ts'),
		"it.skip('one', () => { expect(1).toBeDefined(); });\n"
	);
	const outPath = join(dir, 'out/test-changes.measures.json');
	const run = spawnSync(
		process.execPath,
		[TEST_CHANGES_SCRIPT, '--root', dir, '--base', 'main', '--measures-out', outPath],
		{ cwd: dir, env, encoding: 'utf8' }
	);
	assert.equal(run.status, 0, run.stderr);
	const written = JSON.parse(readFileSync(outPath, 'utf8'));
	assertHealthMeasuresContract(written);
	const byKey = Object.fromEntries(written.measures.map((m) => [m.key, m.value]));
	assert.ok(byKey.test_change_findings >= 2);
	assert.equal(byKey.test_fewer_tests_findings, 1);
	assert.equal(byKey.test_skips_added, 1);
	assert.equal(byKey.tests_net_delta, -1);
});

test('report-coverage-measures parses Istanbul, coverage.py, LCOV DA-only, resolves relative --input against --root and rejects invalid/empty', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'afd-cov-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const summaryPath = join(dir, 'packages/core/coverage/coverage-summary.json');
	mkdirSync(dirname(summaryPath), { recursive: true });
	writeFileSync(
		summaryPath,
		JSON.stringify({
			total: {
				lines: { total: 100, covered: 90, skipped: 0, pct: 90 },
				statements: { total: 100, covered: 88, skipped: 0, pct: 88 },
				branches: { total: 20, covered: 15, skipped: 0, pct: 75 },
				functions: { total: 10, covered: 9, skipped: 0, pct: 90 },
			},
		})
	);
	writeFileSync(
		join(dir, 'packages/core/coverage/coverage-final.json'),
		JSON.stringify({
			'x.ts': { s: { 0: 0 }, statementMap: { 0: { start: { line: 1 } } }, f: {}, b: {} },
		})
	);

	const finalPath = join(dir, 'packages/server/coverage/coverage-final.json');
	mkdirSync(dirname(finalPath), { recursive: true });
	writeFileSync(
		finalPath,
		JSON.stringify({
			'src/app.ts': {
				statementMap: {
					0: { start: { line: 1 } },
					1: { start: { line: 2 } },
					2: { start: { line: 2 } },
					3: { start: { line: 3 } },
				},
				s: { 0: 1, 1: 1, 2: 0, 3: 0 },
				f: { 0: 1, 1: 0 },
				b: { 0: [1, 0] },
			},
		})
	);

	const pyPath = join(dir, 'python/coverage.json');
	mkdirSync(dirname(pyPath), { recursive: true });
	writeFileSync(
		pyPath,
		JSON.stringify({
			totals: { covered_lines: 40, num_statements: 50, num_branches: 10, covered_branches: 8 },
		})
	);

	// LCOV with DA/FNDA/BRDA detail lines and NO LF/LH summary lines.
	const lcovPath = join(dir, 'packages/rust/lcov.info');
	mkdirSync(dirname(lcovPath), { recursive: true });
	writeFileSync(
		lcovPath,
		[
			'SF:src/lib.rs',
			'DA:1,3',
			'DA:2,0',
			'FNDA:1,alpha',
			'FNDA:0,beta',
			'BRDA:1,0,0,2',
			'BRDA:1,0,1,0',
			'end_of_record',
		].join('\n')
	);

	const lcovParsed = parseLcov(readFileSync(lcovPath, 'utf8'));
	assert.deepEqual(lcovParsed.lines, { covered: 1, total: 2 });
	assert.deepEqual(lcovParsed.functions, { covered: 1, total: 2 });
	assert.deepEqual(lcovParsed.branches, { covered: 1, total: 2 });

	assert.equal(parseCoverageFile(finalPath).lines.total, 3);
	assert.equal(parseCoverageFile(finalPath).lines.covered, 2);

	const outPath = join(dir, 'out/coverage.measures.json');
	const run = spawnSync(
		process.execPath,
		[COVERAGE_SCRIPT, '--root', dir, '--scan', '--measures-out', outPath],
		{ cwd: dir, encoding: 'utf8' }
	);
	assert.equal(run.status, 0, run.stderr);
	const written = JSON.parse(readFileSync(outPath, 'utf8'));
	assertHealthMeasuresContract(written);
	const byKey = Object.fromEntries(written.measures.map((m) => [m.key, m.value]));
	// Lines: (90 + 2 + 40 + 1) / (100 + 3 + 50 + 2) = 133 / 155 = 85.81%
	assert.equal(byKey.coverage_lines_pct, 85.81);
	assert.equal(byKey['coverage_lines.packages.core'], 90);
	assert.equal(byKey['coverage_lines.packages.server'], 66.67);
	assert.equal(byKey['coverage_lines.python'], 80);
	assert.equal(byKey['coverage_lines.packages.rust'], 50);

	// Relative --input paths resolve against --root even when cwd !== root!
	const explicitRun = spawnSync(
		process.execPath,
		[
			COVERAGE_SCRIPT,
			'--root',
			dir,
			'--input',
			'my-py=python/coverage.json',
			'--input',
			'packages/rust/lcov.info',
			'--json',
		],
		{ cwd: REPO_ROOT, encoding: 'utf8' }
	);
	assert.equal(explicitRun.status, 0, explicitRun.stderr);
	const explicitData = JSON.parse(explicitRun.stdout);
	assert.deepEqual(
		explicitData.units.map((u) => u.unit),
		['my-py', 'packages.rust']
	);

	// Zero-statement coverage artifact must fail without --allow-empty.
	const zeroPath = join(dir, 'zero/coverage.json');
	mkdirSync(dirname(zeroPath), { recursive: true });
	writeFileSync(zeroPath, JSON.stringify({ totals: { covered_lines: 0, num_statements: 0 } }));
	assert.throws(() => reportCoverageMeasures({ root: dir, inputs: [zeroPath] }), /zero coverable/);

	// Invalid covered > total must be rejected instead of producing 200%.
	const badPath = join(dir, 'bad/coverage-summary.json');
	mkdirSync(dirname(badPath), { recursive: true });
	writeFileSync(badPath, JSON.stringify({ total: { lines: { total: 1, covered: 2, pct: 200 } } }));
	assert.throws(() => parseCoverageFile(badPath), /exceeds total/);

	// Empty directory must fail loudly unless --allow-empty is given.
	const emptyDir = mkdtempSync(join(tmpdir(), 'afd-cov-empty-'));
	t.after(() => rmSync(emptyDir, { recursive: true, force: true }));
	const failRun = spawnSync(process.execPath, [COVERAGE_SCRIPT, '--root', emptyDir, '--scan'], {
		cwd: emptyDir,
		encoding: 'utf8',
	});
	assert.equal(failRun.status, 1);
	assert.match(failRun.stderr, /No coverage artifacts found/);
});

test('all six producers (including nonempty coverage, custom sweep and Alfred) share one target with zero collisions', (t) => {
	const { dir } = makeTempRepo(t, {
		'src/app.ts': 'export function ok(x: number) { return x > 0 ? x : 0; }\n',
		'src/app.test.ts': "it('ok', () => { expect(1).toBe(1); });\n",
		'packages/core/coverage/coverage-summary.json': JSON.stringify({
			total: {
				lines: { total: 10, covered: 9, pct: 90 },
				statements: { total: 10, covered: 9, pct: 90 },
				branches: { total: 4, covered: 3, pct: 75 },
				functions: { total: 2, covered: 2, pct: 100 },
			},
		}),
	});
	const target = 'afd';
	const alfredDoc = {
		schema_version: '1.0',
		source: 'alfred',
		target,
		measures: [
			{
				key: 'alfred_lint_files_checked',
				label: 'Alfred lint files checked',
				value: 10,
				unit: 'files',
				direction: 'neutral',
			},
			{
				key: 'alfred_lint_errors',
				label: 'Alfred lint errors',
				value: 0,
				unit: 'errors',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_lint_warnings',
				label: 'Alfred lint warnings',
				value: 1,
				unit: 'warnings',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_lint_suppressed',
				label: 'Alfred suppressed lint findings',
				value: 0,
				unit: 'findings',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_parity_gaps',
				label: 'Alfred parity gaps',
				value: 2,
				unit: 'gaps',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_parity_name_gaps',
				label: 'Alfred parity name gaps',
				value: 2,
				unit: 'gaps',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_parity_wire_gaps',
				label: 'Alfred wire-fixture gaps',
				value: 0,
				unit: 'gaps',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_parity_vector_gaps',
				label: 'Alfred behavior-vector gaps',
				value: 0,
				unit: 'gaps',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_parity_contract_gaps',
				label: 'Alfred contract-version gaps',
				value: 0,
				unit: 'gaps',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_commands_scanned',
				label: 'AFD commands scanned',
				value: 5,
				unit: 'commands',
				direction: 'neutral',
			},
			{
				key: 'alfred_quality_issues',
				label: 'Alfred command quality issues',
				value: 0,
				unit: 'issues',
				direction: 'lower_is_better',
			},
			{
				key: 'alfred_quality_warnings',
				label: 'Alfred command quality warnings',
				value: 0,
				unit: 'warnings',
				direction: 'lower_is_better',
			},
		],
	};
	const docs = [
		sweepToMeasures(
			{
				metrics: {
					overThreshold: 0,
					largestLines: 0,
					duplicatedLines: 0,
					cloneGroups: 0,
					spreadingClones: 0,
					tests_total: 12,
					labels: { tests_total: 'Repo custom count' },
				},
				largestMeasuredLines: 1,
				cohesiveCount: 0,
			},
			{ target }
		),
		complexityToMeasures(measureCognitiveComplexity({ root: dir }), { target }),
		testCountsToMeasures(reportTestCounts({ root: dir }), { target }),
		testChangesToMeasures(reportTestChanges({ root: dir, base: 'main' }), { target }),
		coverageToMeasures(reportCoverageMeasures({ root: dir, scan: true }), { target }),
		alfredDoc,
	];
	const seen = new Set();
	for (const doc of docs) {
		assertHealthMeasuresContract(doc);
		assert.ok(doc.measures.length > 0, `${doc.source} emitted no measures`);
		for (const row of doc.measures) {
			const identity = `${row.key}::${row.target ?? doc.target ?? ''}`;
			assert.ok(!seen.has(identity), `Cross-producer collision on ${identity}`);
			seen.add(identity);
		}
	}
	assert.equal(seen.size, 52);
});
