/**
 * P2-E14: the exit check over recorded runs. The fixtures in loam-exit-check/ are a manual run of each
 * workflow on one commit, every job a success, and the Loam run's log in `gh run view --log`'s layout, with
 * Vitest's verbose and node's spec reporters as each step prints them, colour included.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
	checkExit,
	LOCATIONS,
	ROWS,
	readBudget,
	readTitles,
	WORKFLOWS,
} from './loam-exit-check.mjs';

const root = join(import.meta.dirname, '..');
const fixture = (name) => readFileSync(join(import.meta.dirname, 'loam-exit-check', name), 'utf8');
const runs = () => ({
	loam: JSON.parse(fixture('loam-run.json')),
	ci: JSON.parse(fixture('ci-run.json')),
	log: fixture('loam.log'),
});
const E = '\u001b';
const line = (location, text) =>
	`${location.job}\t${location.step}\t2026-11-10T09:30:00.0000000Z ${text}`;
const problemsOf = (input) => checkExit(input).problems;
const job = (run, name) => run.jobs.find((entry) => entry.name === name);

test('P2-E14: all green passes, reporting each job and each row where it ran', () => {
	const { problems, report } = checkExit(runs());
	assert.deepEqual(problems, []);
	assert.match(report[0], /^loam\.yml run 42700000001 \(workflow_dispatch on main at 01234567\): /);
	assert.match(report[0], /Mounted against Umbel success/);
	assert.match(report[1], /TypeScript \(Node 22\.x\) success/);
	assert.ok(report.includes('P2-E13: Chromium 2; Mounted 1; Units 1'));
	assert.ok(report.includes('P2-D5: Units 1; Chromium 1; Editor walk 1'));
	assert.ok(report.includes('P2-E14: this check'));
	assert.match(
		report.find((entry) => entry.startsWith('P2-E2:')),
		/^P2-E2: Bundle budget JavaScript, minified 286084 of 300000, JavaScript, gzip 88196 of 91000; Chromium 1; AFD's lean path 2$/
	);
	assert.equal(report.length, 2 + ROWS.length);
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

test('P2-E14: a row with no passing title fails, naming the row and where it was looked for', () => {
	const input = runs();
	input.log = input.log
		.split('\n')
		.filter((entry) => !entry.includes('P2-E5:'))
		.join('\n');
	assert.deepEqual(problemsOf(input), [
		'P2-E5: no passing title in Units ("Build, unit and Chromium", step "Unit suites with coverage")',
	]);
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

test('P2-E14: a skipped title fails, from Vitest and from node', () => {
	const input = runs();
	input.log += [
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
		line(LOCATIONS.units, `endpoints/loam/packages/kernel test:    □ src/a.test.ts > P2-D4: later`),
		line(LOCATIONS.lean, `${E}[32m✔ P2-E11: a todo (0.04ms) # TODO${E}[39m`),
	].join('\n');
	const problems = problemsOf(input);
	assert.equal(problems.length, 2);
	assert.match(problems[0], /^P2-D4 is marked todo/);
	assert.match(problems[1], /^P2-E11 is marked todo/);
});

test('P2-E14: a failed title fails, though a retry let its job pass', () => {
	const input = runs();
	input.log += line(LOCATIONS.chromium, `   ${E}[31m×${E}[39m test/x.test.ts > P2-D7: one model`);
	assert.deepEqual(
		problemsOf(input).map((entry) => entry.slice(0, 22)),
		['P2-D7 is marked fail i']
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

test("P2-E14: a title is read only after a test's mark, wherever the log puts it", () => {
	const titles = readTitles(fixture('loam.log'));
	// Console lines that name a row, and a summary line, are not titles.
	assert.ok(!titles.some((title) => /grew the journal|first-contentful-paint/.test(title.text)));
	const budget = titles.find((title) => title.text.includes('A1 to A3'));
	// A test's own title claims its rows; its describe, phase 0's E9, claims none for it.
	assert.deepEqual(budget.rows, ['E2', 'D9']);
	const conformance = titles.find((title) => title.text.includes('IndexedDbAdapter'));
	// A test with no row of its own takes its nearest describe's.
	assert.deepEqual(conformance.rows, ['E13']);
	assert.deepEqual(
		readTitles(
			line(LOCATIONS.chromium, '✓ a.test.ts > P2-E3: a scenario > P2-E11: loads both versions 1ms')
		)[0].rows,
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
