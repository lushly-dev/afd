/**
 * P2-E14, P3-E16 and P4-E16: the exit check over recorded runs. The fixtures in loam-exit-check/ are a manual run of each
 * workflow on one commit, every job a success, the Loam run's log in `gh run view --log`'s layout, with
 * Vitest's verbose and node's spec reporters as each step prints them, colour included, and the minimum
 * counts that log meets exactly.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	checkExit,
	checkRun,
	LOCATIONS,
	MINIMUMS_FILE,
	minimumsShape,
	P3_BUDGET_ROWS,
	P3_MINIMUMS_FILE,
	P3_ROWS,
	P4_BUDGET_ROWS,
	P4_MINIMUMS_FILE,
	P4_ROWS,
	P6_BUDGET_ROWS,
	P6_M1_ROWS,
	P6_MINIMUMS_FILE,
	PHASES,
	parseArgs,
	ROWS,
	readBudget,
	readBudgetWithin,
	readMinimums,
	readTitles,
	resolveLogSteps,
	WORKFLOWS,
} from './loam-exit-check.mjs';

const root = join(import.meta.dirname, '..');
const fixture = (name) => readFileSync(join(import.meta.dirname, 'loam-exit-check', name), 'utf8');
const runs = () => ({
	loam: JSON.parse(fixture('loam-run.json')),
	ci: JSON.parse(fixture('ci-run.json')),
	log: fixture('loam-run-log.txt'),
	minimums: JSON.parse(fixture('minimums.json')),
});
const E = '\u001b';
const line = (location, text) =>
	`${location.job}\t${location.step}\t2026-11-10T09:30:00.0000000Z ${text}`;
const unit = (text) => line(LOCATIONS.units, `endpoints/loam/packages/kernel test:    ${text}`);
const problemsOf = (input) => checkExit(input).problems;
const job = (run, name) => run.jobs.find((entry) => entry.name === name);
const without = (log, text) =>
	log
		.split('\n')
		.filter((entry) => !entry.includes(text))
		.join('\n');

test('P2-E14: all green passes, reporting the repository, each run and each row where it ran', () => {
	const { problems, report, observed } = checkExit(runs());
	assert.deepEqual(problems, []);
	assert.equal(report[0], 'Repository lushly-dev/afd');
	assert.match(
		report[1],
		/^loam\.yml run 42700000001, attempt 1 \(workflow_dispatch on main at 01234567\), https:\/\/github\.com\/lushly-dev\/afd\/actions\/runs\/42700000001: /
	);
	assert.match(report[1], /Mounted against Umbel success/);
	assert.match(report[2], /TypeScript \(Node 22\.x\) success/);
	assert.ok(report.includes('P2-E13: Chromium 3; Mounted 1; Units 1'));
	assert.ok(report.includes('P2-D5: Units 1; Chromium 1; Editor walk 1'));
	assert.ok(report.includes('P2-E14: this check'));
	assert.match(
		report.find((entry) => entry.startsWith('P2-E2:')),
		/^P2-E2: Bundle budget JavaScript, minified 286084 of 300000, JavaScript, gzip 88196 of 91000; Chromium 1; AFD's lean path 2$/
	);
	assert.equal(report.length, 3 + ROWS.length);
	assert.deepEqual(observed, runs().minimums);
});

test('P2-E14: a skipped job fails, by name', () => {
	const input = runs();
	job(input.loam, 'Mounted against Umbel').conclusion = 'skipped';
	assert.deepEqual(problemsOf(input), [
		'loam.yml run 42700000001: job "Mounted against Umbel" is skipped, not success',
	]);
});

test('P2-E14: a cancelled job fails, in either run', () => {
	const input = runs();
	job(input.ci, 'TypeScript (Node 24.x)').conclusion = 'cancelled';
	assert.deepEqual(problemsOf(input), [
		'ci.yml run 42700000002: job "TypeScript (Node 24.x)" is cancelled, not success',
	]);
});

test('P2-E14: a missing or renamed job fails', () => {
	const input = runs();
	input.loam.jobs = input.loam.jobs.filter((entry) => entry.name !== 'Editor walk');
	job(input.ci, 'TypeScript (Node 22.x)').name = 'TypeScript (Node 20.x)';
	const problems = problemsOf(input);
	assert.ok(problems.includes('loam.yml run 42700000001: job "Editor walk" is missing'));
	assert.ok(problems.includes('ci.yml run 42700000002: job "TypeScript (Node 22.x)" is missing'));
	assert.ok(
		problems.includes(
			'ci.yml run 42700000002: job "TypeScript (Node 20.x)" is not one the check knows'
		)
	);
});

test('P2-E14: a run that did not conclude success fails, whatever its jobs say', () => {
	const input = runs();
	input.loam.conclusion = 'failure';
	assert.deepEqual(problemsOf(input), ['loam.yml run 42700000001 concluded failure, not success']);
});

test('P2-E14: a re-run fails unless --allow-rerun accepts it', () => {
	const input = runs();
	input.ci.attempt = 2;
	assert.deepEqual(problemsOf(input), [
		"ci.yml run 42700000002 is attempt 2: a re-run can hide its first attempt's failure; pass --allow-rerun to accept it",
	]);
	assert.deepEqual(problemsOf({ ...input, allowRerun: true }), []);
	assert.match(checkExit({ ...input, allowRerun: true }).report[2], /, attempt 2 /);
});

test('P2-E14: a run of another repository or another workflow file fails', () => {
	const input = runs();
	input.loam.repository = 'someone/afd';
	input.ci.path = '.github/workflows/ci-copy.yml';
	assert.deepEqual(problemsOf(input), [
		'loam.yml run 42700000001 is in someone/afd, not lushly-dev/afd',
		'ci.yml run 42700000002 ran .github/workflows/ci-copy.yml, not .github/workflows/ci.yml',
	]);
});

test('P2-E14: a row with no passing title fails, naming the row and where it was looked for', () => {
	const input = runs();
	input.log = without(input.log, 'P2-E5:');
	assert.deepEqual(problemsOf(input), [
		'P2-E5: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
});

test('P2-E14: a count below its committed minimum fails, and so does a place with none recorded', () => {
	const input = runs();
	input.minimums.E5.units = 3;
	delete input.minimums.D7;
	assert.deepEqual(problemsOf(input), [
		`P2-E5: 2 passing titles in Units, fewer than the 3 ${MINIMUMS_FILE} records`,
		`P2-D7: ${MINIMUMS_FILE} records no minimum for Chromium`,
	]);
});

test('P2-E14: the committed minimums name every row and place the table does, each at least 1', () => {
	const minimums = readMinimums();
	for (const { row, in: places } of ROWS)
		for (const key of places)
			if (LOCATIONS[key].evidence !== 'budget')
				assert.ok(minimums[row]?.[key] >= 1, `P2-${row} ${key}: ${minimums[row]?.[key]}`);
	assert.deepEqual(
		Object.keys(minimums),
		ROWS.filter(({ in: places }) => places.length > 0).map(({ row }) => row)
	);
});

test('P2-E14: a title passing only in the wrong job does not count', () => {
	const input = runs();
	input.log = input.log.replaceAll(
		`Mounted against Umbel\t${LOCATIONS.mounted.step}\t`,
		`Build, unit and Chromium\t${LOCATIONS.chromium.step}\t`
	);
	const problems = problemsOf(input);
	assert.ok(problems.some((entry) => entry.startsWith('P2-E6: no passing title in Mounted')));
	// E13 passes in Mounted only through phase 1's mounted tests, so it fails there too.
	assert.ok(problems.some((entry) => entry.startsWith('P2-E13: no passing title in Mounted')));
	assert.equal(problems.length, 2);
});

test('P2-E14: a row that names two steps of one job needs a pass in each', () => {
	const input = runs();
	input.log = input.log
		.split('\n')
		.filter((entry) => !(entry.includes('P2-E11:') && entry.includes(`\t${LOCATIONS.lean.step}\t`)))
		.join('\n');
	assert.deepEqual(problemsOf(input), [
		`P2-E11: no passing title in AFD's lean path ("Build, unit and Chromium", step "AFD's lean path")`,
	]);
});

test('P2-E14: only a result line counts, and only a title that starts a title segment', () => {
	const input = runs();
	input.log = `${without(input.log, 'P2-E5:')}\n${[
		// Console output, a test's stdout header, a mark with no test file, and a mention mid-title.
		unit('P2-E5: the scope over MCP passed ✓'),
		unit('stdout | src/mcp-scope.test.ts > P2-E5: the scope over MCP > lists the tools'),
		unit('✓ P2-E5: the scope over MCP 12ms'),
		unit('✓ src/mcp-scope.test.ts > the scope, as P2-E5: says > lists the tools 12ms'),
		// node's shape counts in the lean-path step alone.
		line(LOCATIONS.units, `${E}[32m✔ P2-E5: the scope over MCP (0.4ms)${E}[39m`),
	].join('\n')}`;
	assert.deepEqual(problemsOf(input), [
		'P2-E5: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
});

test('P2-E14: a skipped title fails, from Vitest and from node', () => {
	const input = runs();
	input.log += [
		'',
		line(
			LOCATIONS.chromium,
			`   ${E}[33m↓${E}[39m test/browser/scope/rail.test.ts > P2-E3: two projects > P2-E3: keeps focus`
		),
		line(
			LOCATIONS.lean,
			`${E}[90m﹣ P2-E11: Loam's profile admits nothing (0.03ms) # SKIP${E}[39m`
		),
	].join('\n');
	const problems = problemsOf(input);
	assert.equal(problems.length, 2);
	assert.match(
		problems[0],
		/^P2-E3 is marked skip in "Build, unit and Chromium", step "Chromium suite/
	);
	assert.match(
		problems[1],
		/^P2-E11 is marked skip in "Build, unit and Chromium", step "AFD's lean path"/
	);
});

test('P2-E14: a todo title fails, though node marks it as passing', () => {
	const input = runs();
	input.log += [
		'',
		unit('□ src/a.test.ts > P2-D4: later'),
		line(LOCATIONS.lean, `${E}[32m✔ P2-E11: a todo (0.04ms) # TODO${E}[39m`),
	].join('\n');
	const problems = problemsOf(input);
	assert.equal(problems.length, 2);
	assert.match(problems[0], /^P2-D4 is marked todo/);
	assert.match(problems[1], /^P2-E11 is marked todo/);
});

test("P2-E14: node's expected failure fails, though it prints a pass mark", () => {
	const input = runs();
	input.log += `\n${line(LOCATIONS.lean, `${E}[32m✔ P2-E11: expected (0.24ms) # EXPECTED FAILURE${E}[39m`)}`;
	assert.deepEqual(
		problemsOf(input).map((entry) => entry.slice(0, 40)),
		['P2-E11 is marked expected failure in "Bu']
	);
});

test('P2-E14: a title that passed only on a retry fails, as Vitest prints it', () => {
	const input = runs();
	// Vitest's verbose line for a test that failed, then passed on its retry.
	input.log += `\n${line(LOCATIONS.chromium, `   ${E}[32m✓${E}[39m test/browser/x.test.ts > P2-D7: one model${E}[2m 1503${E}[22m${E}[2mms${E}[22m${E}[33m (retry x1)${E}[39m`)}`;
	assert.deepEqual(
		problemsOf(input).map((entry) => entry.slice(0, 22)),
		['P2-D7 is marked retrie']
	);
});

test('P2-E14: a failed title fails, though its job passed', () => {
	const input = runs();
	input.log += `\n${line(LOCATIONS.chromium, `   ${E}[31m×${E}[39m test/x.test.ts > P2-D7: one model 12ms`)}`;
	assert.deepEqual(
		problemsOf(input).map((entry) => entry.slice(0, 22)),
		['P2-D7 is marked fail i']
	);
});

test('P2-E14: a result line with a mark the check does not know fails, so a new format fails closed', () => {
	const input = runs();
	input.log += [
		'',
		unit('✗ src/a.test.ts > P2-E4: a new mark 3ms'),
		line(LOCATIONS.lean, '★ P2-E11: a new mark (0.5ms)'),
	].join('\n');
	assert.deepEqual(
		problemsOf(input).map((entry) => entry.slice(0, 32)),
		['P2-E4 is marked unknown mark "✗"', 'P2-E11 is marked unknown mark "★']
	);
});

test('P2-E14: a push run fails, as one whose gates may have skipped work', () => {
	const input = runs();
	input.loam.event = 'push';
	input.ci.headBranch = 'lush/branch';
	assert.deepEqual(problemsOf(input), [
		'loam.yml run 42700000001 was triggered by push, not workflow_dispatch, so its gates were not all open',
		'ci.yml run 42700000002 ran on lush/branch, not main',
	]);
});

test('P2-E14: runs of different commits, swapped runs, and a missing or failed step each fail', () => {
	const swapped = runs();
	[swapped.loam, swapped.ci] = [swapped.ci, swapped.loam];
	assert.ok(problemsOf(swapped).includes('loam.yml run 42700000002 is a run of "CI", not "Loam"'));

	const commits = runs();
	commits.ci.headSha = 'f'.repeat(40);
	assert.deepEqual(problemsOf(commits), [
		`the runs are of different commits: loam.yml ${'0123456789abcdef'.repeat(2)}01234567, ci.yml ${'f'.repeat(40)}`,
	]);

	const steps = runs();
	const loamJob = job(steps.loam, 'Build, unit and Chromium');
	loamJob.steps = loamJob.steps.filter((step) => step.name !== "AFD's lean path");
	loamJob.steps.find((step) => step.name === 'Bundle budget').conclusion = 'skipped';
	const problems = problemsOf(steps);
	assert.ok(
		problems.includes(
			`AFD's lean path: job "Build, unit and Chromium" has no step "AFD's lean path"`
		)
	);
	assert.ok(problems.includes('Bundle budget: step "Bundle budget" is skipped, not success'));
});

test('P2-E14: the budget rows are read from the budget step: present, at their ceilings, within them', () => {
	const input = runs();
	assert.deepEqual(readBudget(input.log).problems, []);
	input.log = input.log
		.replace(
			/JavaScript, minified {2,}286,084 {2,}of 300,000 {2,}95%/,
			'JavaScript, minified  301,000  of 300,000  OVER'
		)
		.replace(/JavaScript, gzip {2,}88,196 {5}of 91,000/, 'JavaScript, gzip  88,196  of 95,000');
	assert.deepEqual(readBudget(input.log).problems, [
		'Bundle budget: "JavaScript, minified" is 301000, over 300000',
		'Bundle budget: "JavaScript, gzip" is held to 95000, not 91000',
	]);
	assert.deepEqual(readBudget('').problems, [
		'Bundle budget: no "JavaScript, minified" row in the step\'s log',
		'Bundle budget: no "JavaScript, gzip" row in the step\'s log',
	]);
});

test("P2-E14: a test claims its own title's rows, else its nearest describe's", () => {
	const titles = readTitles(fixture('loam-run-log.txt'));
	// Console lines that name a row are not results.
	assert.ok(!titles.some((title) => /grew the journal|first-contentful-paint/.test(title.text)));
	// Its own title claims its rows; its describe, phase 0's E9, claims none for it.
	assert.deepEqual(titles.find((title) => title.text.includes('A1 to A3')).rows, [
		'E2',
		'D9',
		'E13',
	]);
	// A test with no row of its own takes its nearest describe's, here in a browser project's line.
	assert.deepEqual(titles.find((title) => title.text.includes('IndexedDbAdapter')).rows, ['E13']);
	assert.deepEqual(
		readTitles(unit('✓ src/a.test.ts > P2-E3: a scenario > P2-E11: loads both versions 1ms'))[0]
			.rows,
		['E11']
	);
	assert.ok(titles.every((title) => title.status === 'pass'));
});

test("P2-E14: the row table is the specifications' Job columns", () => {
	const table = (path) =>
		readFileSync(join(root, path), 'utf8')
			.split('\n')
			.filter((entry) => /^\| [ED]\d+ \|/.test(entry))
			.map((entry) => entry.split(' | '));
	const rows = [
		...table('endpoints/loam/docs/phases/2-scope-projects/spec.md'),
		...table('endpoints/loam/docs/phases/2-documents/spec.md'),
	].map(([id, , jobs]) => {
		const places = [];
		for (const [pattern, key] of [
			[/Bundle budget/, 'budget'],
			[/\bUnits\b/, 'units'],
			[/\bChromium\b/, 'chromium'],
			[/AFD's lean path/, 'lean'],
			[/\bMounted\b/, 'mounted'],
			[/Editor walk/, 'walk'],
		])
			if (pattern.test(jobs)) places.push(key);
		return [id.slice(2), places.sort()];
	});
	assert.equal(rows.length, 24);
	assert.deepEqual(
		ROWS.map(({ row, in: places }) => [
			row,
			// The walk left the Chromium step for a job of its own after D5's row was written.
			places.filter((key) => !(row === 'D5' && key === 'walk')).sort(),
		]),
		rows
	);
});

test("P6-E8: the desktop workflow's jobs are loam-desktop.yml's, by name", () => {
	const desktop = readFileSync(join(root, '.github/workflows', WORKFLOWS.desktop.file), 'utf8');
	assert.match(desktop, new RegExp(`^name: ${WORKFLOWS.desktop.name}$`, 'm'));
	const jobs = desktop
		.slice(desktop.indexOf('\njobs:\n'))
		.split(/\n(?= {2}[\w-]+:\n)/)
		.slice(1)
		.map((block) => /^ {4}name: (.+)$/m.exec(block)?.[1]);
	assert.deepEqual(jobs, WORKFLOWS.desktop.jobs);
	assert.match(desktop, /^ {6}- name: Desktop suite under tauri-driver$/m);
});

test("P2-E14: the jobs and steps the check reads are loam.yml's and ci.yml's", () => {
	const loam = readFileSync(join(root, '.github/workflows/loam.yml'), 'utf8');
	const jobs = loam
		.slice(loam.indexOf('\njobs:\n'))
		.split(/\n(?= {2}[\w-]+:\n)/)
		.slice(1)
		.map((block) => ({
			name: /^ {4}name: (.+)$/m.exec(block)?.[1],
			steps: [...block.matchAll(/^ {6}- name: (.+)$/gm)].map((match) => match[1]),
		}));
	assert.deepEqual(
		jobs.map((entry) => entry.name),
		WORKFLOWS.loam.jobs
	);
	for (const location of Object.values(LOCATIONS)) {
		const owner = jobs.find((entry) => entry.name === location.job);
		assert.ok(owner?.steps.includes(location.step), `${location.job}: ${location.step}`);
	}
	const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
	assert.match(ci, /^ {4}name: TypeScript \(Node \$\{\{ matrix\.node-version \}\}\)$/m);
	const manual = /workflow_dispatch'\)\n\s+&& '(\[[^']+\])'/.exec(ci)?.[1];
	assert.deepEqual(
		JSON.parse(manual).map((version) => `TypeScript (Node ${version})`),
		WORKFLOWS.ci.jobs
	);
});

// Phase 3's local part (`--phase 3`), over p3-loam-run.json and p3-loam-run-log.txt: the phase 2 fixture's
// run with the "AFD's identity path" step, and its log with D115's budget rows, section 13's chunk rows and
// one passing `P3-E<n>:` title or more in each place section 18 names, some in `gh run view --log`'s caret
// notation for colour (`^[[32m`), which it prints in place of the escape character.
const p3 = () => ({
	loam: JSON.parse(fixture('p3-loam-run.json')),
	ci: JSON.parse(fixture('ci-run.json')),
	log: fixture('p3-loam-run-log.txt'),
	phase: 3,
	minimums: JSON.parse(fixture('p3-minimums.json')).minimums,
	phase2Minimums: JSON.parse(fixture('minimums.json')),
});
const p3Problems = (input) => checkExit(input).problems;

test('P3-E16: all green passes, with each P3-E row where it ran and E12 as phase 2 rows', () => {
	const { problems, report, observed } = checkExit(p3());
	assert.deepEqual(problems, []);
	assert.ok(report.includes('P3-E1: Chromium 1; Units 1'));
	assert.ok(report.includes('P3-E9: Identity path 2'));
	assert.ok(report.includes('P3-E15: Chromium 1; Units 1'));
	assert.ok(report.includes('P3-E16: this check, the local part'));
	assert.match(
		report.find((entry) => entry.startsWith('P3-E10:')),
		/^P3-E10: Bundle budget JavaScript, minified 329804 of 330300, JavaScript, gzip 103590 of 103700, .*The chrome's `surfaces` chunk 96810 of 97000; Chromium 1$/
	);
	const e12 = report.indexOf(
		`P3-E12: phase 2's rows, in their places, at ${MINIMUMS_FILE}'s counts:`
	);
	assert.ok(e12 > 0);
	assert.deepEqual(
		report.slice(e12 + 1, e12 + 1 + ROWS.length).map((entry) => entry.slice(0, 9)),
		ROWS.map(({ row }) => `  P2-${row}:`.padEnd(9).slice(0, 9))
	);
	assert.ok(report.includes('  P2-E13: Chromium 3; Mounted 1; Units 1'));
	assert.equal(report.length, 3 + P3_ROWS.length + ROWS.length);
	assert.deepEqual(observed, p3().minimums);
});

test('P3-E16: phase 3 titles leave phase 2 reading as it was, and caret-notation colour is stripped', () => {
	assert.deepEqual(
		readTitles(fixture('p3-loam-run-log.txt')),
		readTitles(fixture('loam-run-log.txt'))
	);
	const titles = readTitles(fixture('p3-loam-run-log.txt'), 'P3');
	const identity = titles.filter((title) => title.step === LOCATIONS.identity.step);
	// One claimed by its describe, one by its own title; neither keeps a colour code.
	assert.deepEqual(
		identity.map((title) => title.rows),
		[['E9'], ['E9']]
	);
	assert.ok(titles.every((title) => !title.text.includes('^[') && title.status === 'pass'));
	// A chain claims each row it names; console output naming a row is no result.
	assert.deepEqual(titles.find((title) => title.text.includes('a join holds no token')).rows, [
		'E17',
		'E15',
	]);
	assert.ok(!titles.some((title) => title.text.includes('first paint requested')));
});

test('P3-E16: a P3 row with no passing title in a place it names fails, by name and place', () => {
	const input = p3();
	input.log = without(input.log, 'P3-E8: P3-E15:');
	assert.deepEqual(p3Problems(input), [
		'P3-E8: 1 passing titles in Units, fewer than the 2 loam-exit-check.p3.minimums.json records',
		'P3-E8: no passing title in Units, `identity/src/mcp-identity.test.ts` ("Build, unit and Chromium", step "Unit suites with coverage")',
		'P3-E15: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
});

test('P3-E16: E12 fails on any phase 2 row, against phase 2 minimums, prefixed P3-E12', () => {
	const input = p3();
	input.log = without(input.log, 'P2-E5:');
	input.phase2Minimums.D7.chromium = 2;
	assert.deepEqual(p3Problems(input), [
		'P3-E12: P2-E5: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
		`P3-E12: P2-D7: 1 passing titles in Chromium, fewer than the 2 ${MINIMUMS_FILE} records`,
	]);
});

test('P3-E16: a skipped, failed or retried title fails, of either phase', () => {
	const input = p3();
	input.log += [
		line(
			LOCATIONS.chromium,
			`   ${E}[33m↓${E}[39m test/browser/identity/oauth.test.ts > P3-E20: later`
		),
		line(LOCATIONS.identity, ' ^[[31m×^[[39m src/mcp-auth.test.ts^[[2m > ^[[22mP3-E9: refuses 4ms'),
		unit('✓ src/scope/scope.test.ts > P2-E4: passes on a retry 3ms (retry x1)'),
	].join('\n');
	assert.deepEqual(
		p3Problems(input).map((entry) => entry.slice(0, 26)),
		['P3-E20 is marked skip in "', 'P3-E9 is marked fail in "B', 'P2-E4 is marked retried in']
	);
});

test("P3-E16: the identity path's step is read: missing, it fails, and its titles count only there", () => {
	const input = p3();
	const loamJob = job(input.loam, 'Build, unit and Chromium');
	loamJob.steps = loamJob.steps.filter((step) => step.name !== LOCATIONS.identity.step);
	input.log = input.log.replaceAll(`\t${LOCATIONS.identity.step}\t`, `\t${LOCATIONS.units.step}\t`);
	assert.deepEqual(p3Problems(input), [
		`Identity path: job "Build, unit and Chromium" has no step "AFD's identity path"`,
		`P3-E9: no passing title in Identity path ("Build, unit and Chromium", step "AFD's identity path")`,
	]);
});

test("P3-E16: the budget is D115's: section 13's rows present and within the ceilings the script holds", () => {
	const input = p3();
	assert.deepEqual(readBudgetWithin(input.log, P3_BUDGET_ROWS).problems, []);
	const over = input.log.replace(
		/The `auth` chunk, Better Auth's client and `SessionSync`, minified 72,995 {5}of 73,200 {5}100%/,
		"The `auth` chunk, Better Auth's client and `SessionSync`, minified 73,995     of 73,200     OVER"
	);
	assert.deepEqual(readBudgetWithin(over, P3_BUDGET_ROWS).problems, [
		'Bundle budget: "The `auth` chunk, Better Auth\'s client and `SessionSync`, minified" is 73995, over 73200',
	]);
	// A row over its ceiling is refused, named or not.
	const css = `${input.log}\n${line(LOCATIONS.budget, 'CSS, minified, including loam-theme.css              10,600     of 10,500     OVER')}`;
	assert.deepEqual(readBudgetWithin(css, []).problems, [
		'Bundle budget: "CSS, minified, including loam-theme.css" is 10600, over 10500',
	]);
	input.log = without(input.log, 'The `sign-in` chunk');
	assert.deepEqual(p3Problems(input), [
		'P3-E10: Bundle budget: no "The `sign-in` chunk" row in the step\'s log',
	]);
	assert.deepEqual(readBudgetWithin('', ['JavaScript, gzip']).problems, [
		"Bundle budget: no budget row in the step's log",
		'Bundle budget: no "JavaScript, gzip" row in the step\'s log',
	]);
});

test('P3-E16: E12 reads P2-E2 under D115 too, so a first-paint row over its ceiling fails both', () => {
	const input = p3();
	input.log = input.log.replace(/329,804 {4}of 330,300 {4}100%/, '331,000    of 330,300    OVER');
	const problems = p3Problems(input);
	assert.deepEqual(problems, [
		'P3-E10: Bundle budget: "JavaScript, minified" is 331000, over 330300',
		'P3-E12: P2-E2: Bundle budget: "JavaScript, minified" is 331000, over 330300',
	]);
	// Phase 2's own check still holds its figures, unchanged.
	assert.ok(
		problemsOf({ ...runs(), log: fixture('p3-loam-run-log.txt') }).includes(
			'Bundle budget: "JavaScript, minified" is held to 330300, not 300000'.replace(/^/, 'P2-E2: ')
		)
	);
});

test('P3-E16: the committed phase 3 minimums name every row and place the table does, each at least 1', () => {
	const minimums = readMinimums(P3_MINIMUMS_FILE);
	for (const { row, in: places } of P3_ROWS)
		for (const key of places)
			if (LOCATIONS[key].evidence !== 'budget')
				assert.ok(minimums[row]?.[key] >= 1, `P3-${row} ${key}: ${minimums[row]?.[key]}`);
	assert.deepEqual(
		Object.keys(minimums),
		P3_ROWS.filter(({ in: places }) =>
			places.some((key) => LOCATIONS[key].evidence !== 'budget')
		).map(({ row }) => row)
	);
});

test("P3-E16: the phase 3 row table is section 18's Place column", () => {
	const spec = readFileSync(join(root, 'endpoints/loam/docs/phases/3-identity/spec.md'), 'utf8');
	const rows = spec
		.split('\n')
		.filter((entry) => /^\| P3-E\d+ \|/.test(entry))
		.map((entry) => entry.split(' | '))
		.map(([id, , place]) => {
			if (/Phase 2's places and minimums/.test(place)) return [id.slice(5), 'reuse'];
			if (/The exit step/.test(place)) return [id.slice(5), []];
			const places = [];
			for (const [pattern, key] of [
				[/\bBudget\b/, 'budget'],
				[/\bUnits\b/, 'units'],
				[/\bChromium\b/, 'chromium'],
				[/Identity path/, 'identity'],
				// A place that names its file: that file's titles are counted on their own too.
				[/identity\/src\/mcp-identity\.test\.ts/, 'handler'],
			])
				if (pattern.test(place)) places.push(key);
			return [id.slice(5), places.sort()];
		});
	assert.equal(rows.length, 20);
	assert.deepEqual(
		P3_ROWS.map(({ row, in: places, reuse }) => [row, reuse ? 'reuse' : [...places].sort()]),
		rows
	);
	// The places table names each step the check reads, as LOCATIONS spells it.
	for (const key of ['units', 'chromium', 'identity', 'budget', 'mounted', 'walk'])
		assert.ok(spec.includes(`\`${LOCATIONS[key].step}\``), key);
});

test("P3-E9: every afd-server test file with a P3-E9 title runs in loam.yml's identity path, and all of afd-auth", () => {
	const loam = readFileSync(join(root, '.github/workflows/loam.yml'), 'utf8');
	const step = /- name: AFD's identity path\n {8}run: \|\n((?: {10}.+\n)+)/.exec(loam)?.[1] ?? '';
	const files = execFileSync(
		'git',
		['grep', '-l', 'P3-E9', '--', 'packages/server/src/*.test.ts'],
		{
			cwd: root,
			encoding: 'utf8',
		}
	)
		.split('\n')
		.filter(Boolean);
	assert.ok(files.length >= 5, files.join(', '));
	for (const file of files)
		assert.match(
			step,
			new RegExp(`afd-server exec vitest run .*\\b${file.slice('packages/server/'.length)}\\b`),
			file
		);
	assert.match(step, /pnpm -F @lushly-dev\/afd-auth exec vitest run --reporter=verbose/);
});

test('P3-E16: the arguments: two run ids, `--phase 2` or `3` at most once, and the known flags', () => {
	assert.deepEqual(parseArgs(['1', '2']), {
		ids: ['1', '2'],
		phase: 2,
		allowRerun: false,
		printMinimums: false,
	});
	assert.deepEqual(parseArgs(['--phase', '3', '1', '2', '--allow-rerun', '--print-minimums']), {
		ids: ['1', '2'],
		phase: 3,
		allowRerun: true,
		printMinimums: true,
	});
	for (const argv of [
		['1', '2', '--phase', '5'],
		['1', '2', '--phase'],
		['1', '2', '--phase', '3', '--phase', '3'],
		['1', '--phase', '3'],
		['1', '2', '--hosted'],
	])
		assert.equal(parseArgs(argv), null, argv.join(' '));
});

test("P3-E16: E8's place names its file: a kernel title cannot stand in for the handler's", () => {
	const input = p3();
	// The handler file's one E8 title moved to a kernel suite: Units still counts it, the handler place does not.
	input.log = input.log.replace(
		'endpoints/loam/packages/identity test:  ^[[32m✓^[[39m src/mcp-identity.test.ts',
		'endpoints/loam/packages/kernel test:  ^[[32m✓^[[39m src/late/agent-members.test.ts'
	);
	assert.deepEqual(p3Problems(input), [
		'P3-E8: no passing title in Units, `identity/src/mcp-identity.test.ts` ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
	assert.ok(
		checkExit(p3()).report.includes('P3-E8: Units 2; Units, `identity/src/mcp-identity.test.ts` 1')
	);
});

test('P3-E16: a budget row whose figure is not a number fails, as a row missing', () => {
	const input = p3();
	input.log = input.log.replace(
		/The `sign-in` chunk, `loam-sign-in-dialog`, minified 9,998 {6}of 10,500/,
		'The `sign-in` chunk, `loam-sign-in-dialog`, minified ,      of 10,500'
	);
	assert.deepEqual(readBudgetWithin(input.log, P3_BUDGET_ROWS).problems, [
		'Bundle budget: no "The `sign-in` chunk" row in the step\'s log',
	]);
});

test('P3-E16: a phase the check has no rows for is refused, not read as phase 2', () => {
	for (const phase of [1, 5, 6])
		assert.throws(() => checkExit({ ...p3(), phase }), /no rows for phase/, String(phase));
});

// Phase 4 (`--phase 4`), over p3-loam-run.json and p4-loam-run-log.txt: phase 3's fixture log with section 14's
// chunk rows added to the budget step and one passing `P4-E<n>:` title in each place section 19 names.
const p4 = () => ({
	loam: JSON.parse(fixture('p3-loam-run.json')),
	ci: JSON.parse(fixture('ci-run.json')),
	log: fixture('p4-loam-run-log.txt'),
	phase: 4,
	minimums: JSON.parse(fixture('p4-minimums.json')).minimums,
	minimumsByPhase: { 3: JSON.parse(fixture('p3-minimums.json')).minimums },
	phase2Minimums: JSON.parse(fixture('minimums.json')),
});

test('P4-E16: all green passes, E11 withdrawn, E14 as phase 3 rows with phase 2 nested inside', () => {
	const { problems, report, observed } = checkExit(p4());
	assert.deepEqual(problems, []);
	assert.ok(report.includes('P4-E1: Chromium 1; Units 1'));
	assert.ok(report.includes('P4-E11: withdrawn, menus are deferred (section 9)'));
	assert.ok(report.includes('P4-E16: Units 1'));
	assert.match(
		report.find((entry) => entry.startsWith('P4-E12:')),
		/^P4-E12: Bundle budget JavaScript, minified 329804 of 330300, JavaScript, gzip 103590 of 103700, The kernel's `late` chunk 120358 of 120800, The kernel's `late-settings` chunk 123545 of 124000, The `settings` chunk 51512 of 52000, The chrome's `inbox` chunk 11941 of 12000, The chrome's `overlays` chunk 10758 of 11000, The kernel's `apps` chunks 437173 of 437500; Chromium 1$/
	);
	const e14 = report.indexOf(
		`P4-E14: phase 3's rows, in their places, at ${P3_MINIMUMS_FILE}'s counts:`
	);
	assert.ok(e14 > 0);
	assert.equal(report[e14 + 1], '  P3-E1: Chromium 1; Units 1');
	assert.ok(report.includes('  P3-E16: this check, the local part'));
	assert.ok(
		report.includes(`  P3-E12: phase 2's rows, in their places, at ${MINIMUMS_FILE}'s counts:`)
	);
	assert.ok(report.includes('    P2-E13: Chromium 3; Mounted 1; Units 1'));
	assert.equal(report.length, 3 + P4_ROWS.length + P3_ROWS.length + ROWS.length);
	// The counts observed are phase 4's own rows, the shape of its minimums file.
	assert.deepEqual(observed, p4().minimums);
});

test('P4-E16: a P4 row with no passing title in a place it names fails, by name and place', () => {
	const input = p4();
	input.log = without(input.log, 'P4-E9: a unit of E9');
	assert.deepEqual(problemsOf(input), [
		'P4-E9: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
	input.minimums.E2.units = 2;
	assert.ok(
		problemsOf(input).includes(
			`P4-E2: 1 passing titles in Units, fewer than the 2 ${P4_MINIMUMS_FILE} records`
		)
	);
});

test("P4-E16: a P4 title counts only in its row's places, and another phase's title never stands in for it", () => {
	const input = p4();
	input.log = [
		without(input.log, 'P4-E2: a unit of E2'),
		// E2's places are Units alone: a passing E2 title in Chromium is not counted.
		line(
			LOCATIONS.chromium,
			`   ${E}[32m✓${E}[39m test/browser/settings.test.ts > P4-E2: in the wrong place`
		),
		// Phase 3's E2, in E2's own place, is not phase 4's.
		unit("✓ src/late/settings.test.ts > P3-E2: not phase 4's E2 3ms"),
	].join('\n');
	assert.deepEqual(problemsOf(input), [
		'P4-E2: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
});

test("P4-E16: E14 fails on any phase 3 row, and on phase 2's through phase 3's E12, each prefixed", () => {
	const input = p4();
	input.log = without(input.log, 'P3-E11:');
	input.phase2Minimums.D7.chromium = 2;
	assert.deepEqual(problemsOf(input), [
		'P4-E14: P3-E11: no passing title in Chromium ("Build, unit and Chromium", step "Chromium suite against the built shell (phase 0\'s E1 to E10, phase 1\'s so far, A1 to A3; the walk is its own job)")',
		`P4-E14: P3-E12: P2-D7: 1 passing titles in Chromium, fewer than the 2 ${MINIMUMS_FILE} records`,
	]);
});

test('P4-E16: a skipped, failed or retried title fails, of phase 4 or of a phase E14 reuses', () => {
	const input = p4();
	input.log += [
		'',
		line(LOCATIONS.chromium, `   ${E}[33m↓${E}[39m test/browser/inbox.test.ts > P4-E6: later`),
		line(
			LOCATIONS.chromium,
			`   ${E}[33m↓${E}[39m test/browser/identity/oauth.test.ts > P3-E20: later`
		),
		unit('✓ src/scope/scope.test.ts > P2-E4: passes on a retry 3ms (retry x1)'),
	].join('\n');
	assert.deepEqual(
		problemsOf(input).map((entry) => entry.slice(0, 26)),
		['P4-E6 is marked skip in "B', 'P3-E20 is marked skip in "', 'P2-E4 is marked retried in']
	);
});

test("P4-E16: the budget is D115's: section 14's rows present and within the ceilings the script holds", () => {
	const input = p4();
	input.log = without(input.log, 'The `settings` chunk');
	assert.deepEqual(problemsOf(input), [
		'P4-E12: Bundle budget: no "The `settings` chunk" row in the step\'s log',
	]);
	const over = p4();
	over.log = over.log.replace(
		"The chrome's `inbox` chunk, the inbox section, minified 11,941     of 12,000     100%",
		"The chrome's `inbox` chunk, the inbox section, minified 12,941     of 12,000     OVER"
	);
	assert.ok(
		problemsOf(over).includes(
			'P4-E12: Bundle budget: "The chrome\'s `inbox` chunk, the inbox section, minified" is 12941, over 12000'
		)
	);
	assert.deepEqual(readBudgetWithin(fixture('p4-loam-run-log.txt'), P4_BUDGET_ROWS).problems, []);
});

test("P4-E16: the phase 4 row table is section 19's Place column", () => {
	const spec = readFileSync(join(root, 'endpoints/loam/docs/phases/4-settings/spec.md'), 'utf8');
	const rows = spec
		.split('\n')
		.filter((entry) => /^\| P4-E\d+ \|/.test(entry))
		.map((entry) => entry.split(' | '))
		.map(([id, criterion, place]) => {
			if (/^Withdrawn$/.test(criterion)) return [id.slice(5), 'withdrawn'];
			if (/Earlier phases' places/.test(place)) return [id.slice(5), 'reuse'];
			const places = [];
			for (const [pattern, key] of [
				[/\bBudget\b/, 'budget'],
				[/\bUnits\b/, 'units'],
				[/\bChromium\b/, 'chromium'],
			])
				if (pattern.test(place)) places.push(key);
			return [id.slice(5), places.sort()];
		});
	assert.equal(rows.length, 17);
	assert.deepEqual(
		P4_ROWS.map(({ row, in: places, reuse, withdrawn }) => [
			row,
			withdrawn ? 'withdrawn' : reuse ? 'reuse' : [...places].sort(),
		]),
		rows
	);
	assert.equal(P4_ROWS.find(({ row }) => row === 'E14').reuse, 3);
});

test('P4-E16: the committed phase 4 minimums name every row and place the table does, each at least 1', () => {
	const minimums = readMinimums(P4_MINIMUMS_FILE);
	for (const { row, in: places } of P4_ROWS)
		for (const key of places)
			if (LOCATIONS[key].evidence !== 'budget')
				assert.ok(minimums[row]?.[key] >= 1, `P4-${row} ${key}: ${minimums[row]?.[key]}`);
	assert.deepEqual(
		Object.keys(minimums),
		P4_ROWS.filter(({ in: places }) =>
			places.some((key) => LOCATIONS[key].evidence !== 'budget')
		).map(({ row }) => row)
	);
});

test('P4-E16: `--phase 4` is accepted, and every phase in the table has its rows, prefix and minimums file', () => {
	assert.equal(parseArgs(['--phase', '4', '1', '2']).phase, 4);
	for (const [id, phase] of Object.entries(PHASES)) {
		// A phase 6 milestone's key is `6-<milestone>`, its prefix phase 6's.
		assert.equal(phase.prefix, `P${id.split('-')[0]}`);
		assert.ok(phase.rows.length > 0, id);
		assert.match(phase.minimumsFile, /^loam-exit-check\.(?:p\d\.)?minimums\.json$/);
		for (const { reuse } of phase.rows)
			if (reuse) assert.ok(Number(reuse) < Number.parseInt(id, 10), id);
	}
});

test("#2181: standalone phase 2 accepts the 2026-11-09 four-job loam.yml shape, while phases 3 and 4 require the current workflow's jobs", () => {
	const input = runs();
	input.loam.jobs = input.loam.jobs.filter((entry) =>
		WORKFLOWS.loam.phase2HistoricalJobs.includes(entry.name)
	);
	assert.deepEqual(problemsOf(input), []);
	// Dropping any one of those four jobs still fails closed.
	const missingWalk = {
		...input,
		loam: {
			...input.loam,
			jobs: input.loam.jobs.filter((entry) => entry.name !== 'Editor walk'),
		},
	};
	assert.ok(
		problemsOf(missingWalk).includes('loam.yml run 42700000001: job "Editor walk" is missing')
	);
	// Phase 3 and phase 4 do not accept the four-job shape.
	const p3Input = p3();
	p3Input.loam.jobs = p3Input.loam.jobs.filter((entry) =>
		WORKFLOWS.loam.phase2HistoricalJobs.includes(entry.name)
	);
	const p3Issues = p3Problems(p3Input);
	for (const job of [
		'Merge queue paths',
		'Firefox suites',
		'WebKit suites',
		'Hosted development profile',
	]) {
		assert.ok(p3Issues.includes(`loam.yml run 42700000001: job "${job}" is missing`), job);
	}
	const p4Input = p4();
	p4Input.loam.jobs = p4Input.loam.jobs.filter((entry) =>
		WORKFLOWS.loam.phase2HistoricalJobs.includes(entry.name)
	);
	const p4Issues = problemsOf(p4Input);
	for (const job of [
		'Merge queue paths',
		'Firefox suites',
		'WebKit suites',
		'Hosted development profile',
	]) {
		assert.ok(p4Issues.includes(`loam.yml run 42700000001: job "${job}" is missing`), job);
	}
	// Duplicate job names on the current workflow shape are rejected too.
	const dup = runs();
	dup.loam.jobs = [...dup.loam.jobs, { ...dup.loam.jobs[0] }];
	assert.ok(
		problemsOf(dup).includes(
			`loam.yml run 42700000001: job "${dup.loam.jobs[0].name}" appears more than once`
		)
	);
});

test('#2181: resolveLogSteps rejects out-of-window timestamps, skipped steps, and sub-second jumps', () => {
	const run = {
		jobs: [
			{
				name: 'Build, unit and Chromium',
				steps: [
					{
						number: 1,
						name: 'Build',
						conclusion: 'success',
						startedAt: '2026-11-09T10:00:00Z',
						completedAt: '2026-11-09T10:00:10Z',
					},
					{
						number: 2,
						name: 'Skipped step',
						conclusion: 'skipped',
						startedAt: '2026-11-09T10:00:10Z',
						completedAt: '2026-11-09T10:00:10Z',
					},
					{
						number: 3,
						name: 'Wrong sub-second step',
						conclusion: 'success',
						startedAt: '2026-11-09T10:00:10Z',
						completedAt: '2026-11-09T10:00:10Z',
					},
					{
						number: 4,
						name: 'Loam unit tests',
						conclusion: 'success',
						startedAt: '2026-11-09T10:00:10Z',
						completedAt: '2026-11-09T10:00:20Z',
					},
				],
			},
		],
	};
	// Timestamp 5 minutes before the first step started stays UNKNOWN STEP (never credited to any step).
	const early =
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T09:55:00.000Z ✓ src/scope.test.ts > P2-E5: forged 1ms';
	assert.equal(resolveLogSteps(early, run), early);
	// Timestamp after the last step ended stays UNKNOWN STEP.
	const late =
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T10:05:00.000Z ✓ src/scope.test.ts > P2-E5: late 1ms';
	assert.equal(resolveLogSteps(late, run), late);
	// Single boundary at shared second 10:00:10 advances past Build into Wrong sub-second step (skipping
	// Skipped step), NOT all the way into Loam unit tests.
	const sharedSecond = [
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T10:00:05.000Z building...',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T10:00:10.100Z ##[group]Run wrong-step',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T10:00:10.200Z ✓ src/scope.test.ts > P2-E5: wrong 1ms',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T10:00:10.500Z ##[group]Run unit-tests',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T10:00:11.000Z ✓ src/scope.test.ts > P2-E5: real 1ms',
	].join('\n');
	const resolved = resolveLogSteps(sharedSecond, run).split('\n');
	assert.ok(resolved[0].startsWith('Build, unit and Chromium\tBuild\t'));
	assert.ok(resolved[2].startsWith('Build, unit and Chromium\tWrong sub-second step\t'));
	assert.ok(resolved[4].startsWith('Build, unit and Chromium\tLoam unit tests\t'));
});

test('#2181: UNKNOWN STEP log lines resolve from step timestamps and group boundaries without overriding named steps', () => {
	const loam = {
		jobs: [
			{
				name: 'Build, unit and Chromium',
				steps: [
					{
						number: 1,
						name: 'Unit suites with coverage',
						startedAt: '2026-11-09T21:27:06Z',
						completedAt: '2026-11-09T21:27:51Z',
					},
					{
						number: 2,
						name: "AFD's lean path",
						startedAt: '2026-11-09T21:27:51Z',
						completedAt: '2026-11-09T21:27:55Z',
					},
				],
			},
		],
	};
	const raw = [
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T21:27:16.100Z endpoints/loam/packages/kernel test: ✓ src/a.test.ts > P2-E5: passes 1ms',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T21:27:51.100Z endpoints/loam/packages/kernel test: ✓ src/b.test.ts > P2-E4: last unit line in shared second 1ms',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T21:27:51.900Z ##[group]Run pnpm -F @lushly-dev/afd-server exec vitest run',
		'Build, unit and Chromium\tUNKNOWN STEP\t2026-11-09T21:27:52.100Z ✔ P2-E11: manifest passes (1ms)',
		'Build, unit and Chromium\tWrong Step\t2026-11-09T21:27:16.200Z endpoints/loam/packages/kernel test: ✓ src/c.test.ts > P2-E5: stays in named step 1ms',
	].join('\n');
	const resolved = resolveLogSteps(raw, loam).split('\n');
	assert.equal(resolved[0].split('\t')[1], 'Unit suites with coverage');
	assert.equal(resolved[1].split('\t')[1], 'Unit suites with coverage');
	assert.equal(resolved[2].split('\t')[1], "AFD's lean path");
	assert.equal(resolved[3].split('\t')[1], "AFD's lean path");
	// An explicit step name is never rewritten.
	assert.equal(resolved[4].split('\t')[1], 'Wrong Step');
});

test('checkRun accepts reusable queue job names and skipped pull-request-only jobs on manual runs', () => {
	const loamRun = JSON.parse(fixture('loam-run.json'));
	loamRun.jobs[0].name = 'Merge queue paths / Merge queue paths';
	assert.deepEqual(checkRun(loamRun, WORKFLOWS.loam), []);

	const ciRun = JSON.parse(fixture('ci-run.json'));
	ciRun.jobs.push({ name: 'Pull request title', conclusion: 'skipped' });
	assert.deepEqual(checkRun(ciRun, WORKFLOWS.ci), []);

	const failedPrTitle = JSON.parse(fixture('ci-run.json'));
	failedPrTitle.jobs.push({ name: 'Pull request title', conclusion: 'failure' });
	assert.match(
		checkRun(failedPrTitle, WORKFLOWS.ci).join('\n'),
		/pull-request-only job "Pull request title" is failure, not skipped/
	);
});

// Phase 6's milestone M1 (`--phase 6 --milestone m1`), over p6-loam-run.json and p6-loam-run-log.txt: the
// phase 3 fixture's run with the hosted job's unit and "AFD's host path" steps (D162), and a log with section 14's browser rows and one
// passing `P6-` title or more in each place section 19 names for M1's rows, in caret notation for colour.
const p6 = () => ({
	loam: JSON.parse(fixture('p6-loam-run.json')),
	ci: JSON.parse(fixture('ci-run.json')),
	log: fixture('p6-loam-run-log.txt'),
	phase: '6-m1',
	minimums: JSON.parse(fixture('p6-minimums.json')).minimums.m1,
});
const hosted = (text) =>
	line(LOCATIONS.hosted, ` ^[[32m✓^[[39m test/hosted/relay.test.ts^[[2m > ^[[22m${text}`);

test('P6-E8: M1 passes all green, with each of its rows where it ran and no other phase read', () => {
	const { problems, report, observed } = checkExit(p6());
	assert.deepEqual(problems, []);
	assert.deepEqual(report.slice(3), [
		'P6-E1: Units 1; Units, `loam-host` 1',
		'P6-E2: Units, `loam-host` 1',
		'P6-E3: Units 1; Units, `loam-host` 1',
		'P6-E4: Units 2',
		'P6-E5: Units 1; Units, `loam-host` 2',
		'P6-E7: Host path 2',
		'P6-E8: this check, milestone m1',
		"P6-E9: Bundle budget JavaScript, minified 333058 of 333400, JavaScript, gzip 104911 of 105000, The kernel's `late` chunk 124664 of 125200, The kernel's `late-hosted` chunk 6412 of 6500, The kernel's `apps` chunks 452033 of 452600; Chromium 1; Hosted 1",
		...['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'].map((row) => `P6-${row}: Hosted 1`),
	]);
	assert.deepEqual(observed, p6().minimums);
	// No desktop run is read for a milestone, and a P2 title in the log is no P6 row.
	assert.ok(!report.some((entry) => /desktop|P2-/.test(entry)));
});

test('P6-E8: phase 6 is read only by a milestone the table has, and M1 lists the rows of 5.3', () => {
	assert.throws(
		() => checkExit({ ...p6(), phase: 6 }),
		/no rows for phase 6; phase 6 takes --milestone m1/
	);
	assert.throws(() => checkExit({ ...p6(), phase: '6-m2' }), /no rows for phase 6-m2/);
	assert.deepEqual(
		P6_M1_ROWS.map(({ row }) => row),
		['E1', 'E2', 'E3', 'E4', 'E5', 'E7', 'E8', 'E9', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8']
	);
	const spec = readFileSync(join(root, 'endpoints/loam/docs/phases/6-hosts/spec.md'), 'utf8');
	assert.match(
		spec,
		/\*\*M1 is reached\*\* when P6-E1 to P6-E5, P6-E7 to P6-E9 and P6-H1 to P6-H8 pass on `main` in their places/
	);
});

test("P6-E8: M1's row table is section 19's Place column", () => {
	const spec = readFileSync(join(root, 'endpoints/loam/docs/phases/6-hosts/spec.md'), 'utf8');
	const places = new Map(
		spec
			.split('\n')
			.filter((entry) => /^\| P6-[EH]\d+ \|/.test(entry))
			.map((entry) => entry.split(' | '))
			.map(([id, , place]) => {
				if (/The exit step/.test(place)) return [id.slice(5), []];
				const keys = [];
				// "Units" is either half, `units` or `hostUnits` (D162), read as one key here.
				for (const [pattern, key] of [
					[/\bBudget\b/, 'budget'],
					[/\bUnits\b/, 'units'],
					[/\bChromium\b/, 'chromium'],
					[/\bHost path\b/, 'host'],
					[/\bHosted\b/, 'hosted'],
				])
					if (pattern.test(place)) keys.push(key);
				return [id.slice(5), keys.sort()];
			})
	);
	for (const { row, in: keys } of P6_M1_ROWS)
		assert.deepEqual(
			[...new Set(keys.map((key) => (key === 'hostUnits' ? 'units' : key)))].sort(),
			places.get(row),
			`P6-${row}`
		);
	// The places table names each step the check reads, as LOCATIONS spells it, and each job.
	for (const key of ['units', 'hostUnits', 'chromium', 'host', 'budget', 'hosted']) {
		assert.ok(spec.includes(`\`${LOCATIONS[key].step}\``), key);
		assert.ok(spec.includes(`\`${LOCATIONS[key].job}\``), key);
	}
});

test('P6-E8: a row with no passing title in its place fails, and a title elsewhere does not count', () => {
	const input = p6();
	input.log = without(input.log, 'P6-H8: a crash');
	assert.deepEqual(problemsOf(input), [
		'P6-H8: no passing title in Hosted ("Hosted development profile", step "Hosted criterion against the development profile")',
	]);
	// The log's stray `P6-E1:` titles, in the hosted step and in `loam-host`'s unit step's console output, are
	// not E1's units, and one half's titles never stand in for the other's.
	const e1 = p6();
	e1.log = without(e1.log, 'a non-https localhost origin');
	assert.deepEqual(problemsOf(e1), [
		'P6-E1: no passing title in Units, `loam-host` ("Hosted development profile", step "The hosted server\'s unit suites with coverage")',
	]);
	const e1Units = { ...p6(), minimums: { ...p6().minimums, E1: { units: 2, hostUnits: 1 } } };
	assert.deepEqual(problemsOf(e1Units), [
		`P6-E1: 1 passing titles in Units, fewer than the 2 ${P6_MINIMUMS_FILE} records`,
	]);
});

test('P6-E8: a count below its minimum fails, and so does a place with none recorded', () => {
	const input = p6();
	input.minimums.H6.hosted = 2;
	delete input.minimums.E7;
	assert.deepEqual(problemsOf(input), [
		`P6-E7: ${P6_MINIMUMS_FILE} records no minimum for Host path`,
		`P6-H6: 1 passing titles in Hosted, fewer than the 2 ${P6_MINIMUMS_FILE} records`,
	]);
	assert.ok(problemsOf({ ...p6(), minimums: {} }).length >= 15);
});

test("P6-E8: any P6 title not a plain pass fails, M1's or not, and a chain claims each row", () => {
	const input = p6();
	input.log += `${[
		hosted('P6-H9: the production profile^[[2m (retry x1)^[[22m'),
		line(
			LOCATIONS.hosted,
			' ^[[33m↓^[[39m test/hosted/relay.test.ts^[[2m > ^[[22mP6-H6: idle bindings'
		),
		line(
			LOCATIONS.hosted,
			' ^[[31m×^[[39m test/hosted/relay.test.ts^[[2m > ^[[22mP6-H6: P6-H7: the scan'
		),
	].join('\n')}\n`;
	assert.deepEqual(problemsOf(input), [
		'P6-H9 is marked retried in "Hosted development profile", step "Hosted criterion against the development profile": ✓ test/hosted/relay.test.ts > P6-H9: the production profile (retry x1)',
		'P6-H6 is marked skip in "Hosted development profile", step "Hosted criterion against the development profile": ↓ test/hosted/relay.test.ts > P6-H6: idle bindings',
		'P6-H6, P6-H7 is marked fail in "Hosted development profile", step "Hosted criterion against the development profile": × test/hosted/relay.test.ts > P6-H6: P6-H7: the scan',
	]);
	const chained = readTitles(p6().log, 'P6').find((title) =>
		title.text.includes('a request with no id')
	);
	assert.deepEqual(chained.rows, ['E5', 'H6']);
});

test('P6-E8: the hosted and host-path steps are read: missing or failed, each fails by name', () => {
	const input = p6();
	const hostedJob = job(input.loam, 'Hosted development profile');
	hostedJob.steps.find((step) => step.name === LOCATIONS.hosted.step).conclusion = 'failure';
	hostedJob.steps = hostedJob.steps.filter((step) => step.name !== LOCATIONS.host.step);
	const problems = problemsOf(input);
	assert.ok(
		problems.includes('Host path: job "Hosted development profile" has no step "AFD\'s host path"')
	);
	assert.ok(
		problems.includes(
			'Hosted: step "Hosted criterion against the development profile" is failure, not success'
		)
	);
});

test("P6-E8: P6-E9's budget is D115's: section 14's browser rows present and within their ceilings", () => {
	const input = p6();
	assert.deepEqual(readBudgetWithin(input.log, P6_BUDGET_ROWS).problems, []);
	const missing = { ...p6(), log: without(input.log, "The kernel's `late-hosted` chunk") };
	assert.deepEqual(problemsOf(missing), [
		'P6-E9: Bundle budget: no "The kernel\'s `late-hosted` chunk" row in the step\'s log',
	]);
	const over = {
		...p6(),
		log: input.log.replace(/6,412 {6}of 6,500 {6}99%/, '6,600      of 6,500      OVER'),
	};
	assert.deepEqual(problemsOf(over), [
		'P6-E9: Bundle budget: "The kernel\'s `late-hosted` chunk and its imports, minified" is 6600, over 6500',
	]);
	// `late` is its own row: `late-identity` or `late-hosted` never stands in for it.
	assert.deepEqual(problemsOf({ ...p6(), log: without(input.log, "The kernel's `late` chunk") }), [
		'P6-E9: Bundle budget: no "The kernel\'s `late` chunk" row in the step\'s log',
	]);
});

test('P6-E8: a run whose job list repeats a job is not the list, success or not', () => {
	const input = p6();
	input.ci.jobs.push({ ...input.ci.jobs.find((entry) => entry.name === 'TypeScript (Node 22.x)') });
	input.loam.jobs.push({ ...job(input.loam, 'Hosted development profile') });
	input.ci.jobs.push({ name: 'Pull request title', conclusion: 'skipped' });
	input.ci.jobs.push({ name: 'Pull request title', conclusion: 'skipped' });
	const problems = problemsOf(input);
	assert.ok(
		problems.includes(
			'ci.yml run 42700000002: job "TypeScript (Node 22.x)" appears more than once'
		),
		problems.join('\n')
	);
	assert.ok(
		problems.includes('ci.yml run 42700000002: job "Pull request title" appears more than once')
	);
	assert.ok(
		problems.some((problem) =>
			/job "Hosted development profile" appears more than once/.test(problem)
		)
	);
});

test("P6-E8: the M1 runs are held to condition 1 as phase 2's are", () => {
	const input = p6();
	input.ci.headSha = 'different';
	input.loam.event = 'push';
	input.loam.attempt = 2;
	const problems = problemsOf(input);
	assert.ok(problems.some((problem) => /different commits/.test(problem)));
	assert.ok(problems.some((problem) => /triggered by push/.test(problem)));
	assert.ok(problems.some((problem) => /attempt 2/.test(problem)));
	assert.ok(
		!problemsOf({ ...input, allowRerun: true }).some((problem) => /attempt 2/.test(problem))
	);
});

test('P6-E8: the committed M1 minimums name every row and place M1 reads, each at least 1', () => {
	const { m1, ...others } = readMinimums(P6_MINIMUMS_FILE);
	assert.deepEqual(Object.keys(others), []);
	for (const { row, in: places } of P6_M1_ROWS)
		for (const key of places)
			if (LOCATIONS[key].evidence !== 'budget')
				assert.ok(m1[row]?.[key] >= 1, `P6-${row} ${key}: ${m1[row]?.[key]}`);
	assert.deepEqual(
		Object.keys(m1),
		P6_M1_ROWS.filter(({ in: places }) =>
			places.some((key) => LOCATIONS[key].evidence !== 'budget')
		).map(({ row }) => row)
	);
	// `--print-minimums` prints the observed counts in the file's own shape, under the milestone.
	assert.deepEqual(minimumsShape('6-m1', { E1: { units: 3 } }), { m1: { E1: { units: 3 } } });
	assert.deepEqual(minimumsShape(4, { E1: { units: 3 } }), { E1: { units: 3 } });
});

test('P6-E8: the arguments: `--phase 6` only with `--milestone m1`, each at most once', () => {
	assert.deepEqual(parseArgs(['--phase', '6', '--milestone', 'm1', '1', '2', '--print-minimums']), {
		ids: ['1', '2'],
		phase: '6-m1',
		allowRerun: false,
		printMinimums: true,
	});
	for (const argv of [
		['1', '2', '--phase', '6'],
		['1', '2', '--milestone', 'm1'],
		['1', '2', '--phase', '3', '--milestone', 'm1'],
		['1', '2', '--phase', '6', '--milestone', 'm2'],
		['1', '2', '--phase', '6', '--milestone'],
		['1', '2', '--phase', '6', '--milestone', 'm1', '--milestone', 'm1'],
		['1', '2', '3', '--phase', '6', '--milestone', 'm1'],
		// A flag's value is the argument after it in argv, never one another flag's removal left beside it.
		['1', '2', '--milestone', '--phase', '6', 'm1'],
		['1', '2', '--phase', '--milestone', 'm1', '6'],
		// Each boolean flag at most once too.
		['1', '2', '--allow-rerun', '--allow-rerun'],
		['1', '2', '--phase', '6', '--milestone', 'm1', '--print-minimums', '--print-minimums'],
	])
		assert.equal(parseArgs(argv), null, argv.join(' '));
});
