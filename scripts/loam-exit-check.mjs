#!/usr/bin/env node
/**
 * Loam's exit check: `node scripts/loam-exit-check.mjs <loam run id> <ci run id> [--phase 2|3|4]`. Phase 2's, by
 * default, as below; `--phase 3` is phase 3's local part, after this comment's list.
 *
 * Step 14 of the phase 2 specification (endpoints/loam/docs/phases/2-scope-projects/spec.md, section 16)
 * runs `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`, which opens every gate, and then this. It
 * fails, naming what is wrong, unless:
 *
 * 1. both runs are of lushly-dev/afd, of `.github/workflows/loam.yml` and `ci.yml`, manual, on `main`, of
 *    one commit, on their first attempt (`--allow-rerun` accepts a re-run), and a success; and by
 *    `gh run view <id> --json jobs`, each holds exactly the jobs its workflow has, every one `success`;
 * 2. by `gh run view <loam id> --log`, each exit row's `P2-E<n>:` or `P2-D<n>:` title passes in the log of
 *    each job and step its row names, read from the test reporters' result lines and not assumed from the
 *    job's success, at least as often as loam-exit-check.minimums.json records;
 * 3. no such title anywhere in that log is marked skipped, todo, failed, retried, an expected failure, or
 *    with a mark the check does not know.
 *
 * It prints a short report for STATUS.md's exit line: the repository, each run's attempt, URL and jobs, and
 * each row's passing titles counted where its row names. `ci.yml`'s log cannot show a title, since lefthook
 * prints only a summary, so its jobs prove the whole workspace by their conclusions alone, and `loam.yml`'s
 * "AFD's lean path" step shows E2's and E11's AFD side. Vitest's `it.fails` and `retry` print as a plain
 * pass, so scripts/repository-contract.test.mjs refuses them, and skips, in the tests these rows read.
 *
 * The minimums hold each count of a manual run, so an `exclude`, a skipped suite or a deleted file cannot
 * pass unnoticed. When exit tests are added or removed on purpose, run the check on a run that has them with
 * `--print-minimums` and copy the counts it prints into the file, in the same pull request.
 *
 * `--phase 3` is step 9 of the phase 3 specification (endpoints/loam/docs/phases/3-identity/spec.md, section
 * 19), P3-E16's local part. It checks the same two runs by condition 1, then each `P3-E<n>:` row of section
 * 18 in the places its row names, against loam-exit-check.p3.minimums.json, with condition 3 over `P3-`
 * titles; "Identity path" is the `loam` job's "AFD's identity path" step. P3-E12 reuses phase 2's rows and
 * minimums, as its row says: every `P2-E<n>:` and `P2-D<n>:` row above, in its own places, at
 * loam-exit-check.minimums.json's counts, with condition 3 over `P2-` titles. Budgets are D115's (owner,
 * 2026-11-13): a ceiling rises with its measurement, so neither P3-E10 nor E12's P2-E2 holds a ceiling to a
 * figure; each row the specification names must be printed, at or under its own ceiling, and no row OVER. Once
 * D161 names the date D115 ends, this reading goes back to holding the figures the specification names.
 * The hosted part, P3-H1 to P3-H5, is step 10's.
 *
 * `--phase 4` is step 11 of the phase 4 specification (endpoints/loam/docs/phases/4-settings/spec.md, section
 * 20), its whole exit, which is local (D126). It checks the same two runs by condition 1, then each `P4-E<n>:`
 * row of section 19 in the places its row names, against loam-exit-check.p4.minimums.json, with condition 3
 * over `P4-` titles. E11 is withdrawn (menus are deferred, section 9) and has no count. P4-E14 reuses phase 3's
 * rows and minimums, and through P3-E12 phase 2's, each with condition 3 over its own prefix. E12's budget is
 * section 14's rows under D115, as above: each printed, at or under its own ceiling, and none OVER.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'lushly-dev/afd';

/** The runs' workflows, by the name `gh run view` reports, and the jobs a manual run of each has. */
export const WORKFLOWS = {
	loam: {
		name: 'Loam',
		file: 'loam.yml',
		// Reusable queue.yml jobs appear as "<caller> / <callee>" in `gh run view --json jobs`.
		jobAliases: { 'Merge queue paths / Merge queue paths': 'Merge queue paths' },
		jobs: [
			// The merge queue's gate: it runs on every event and passes a manual run straight through.
			'Merge queue paths',
			'Affected units',
			'Build, unit and Chromium',
			'Editor walk',
			// #706: the mount, the view and phase 4's I8 chord in Firefox and in WebKit.
			'Firefox suites',
			'WebKit suites',
			'Mounted against Umbel',
			// Phase 6's step 2: the hosted criterion against the development profile.
			'Hosted development profile',
		],
	},
	// Phase 6's steps 11 and 12: the desktop suite and installers (specification, 10.7 and 11.3). Read only
	// under `--phase 6` without `--milestone` (section 19).
	desktop: {
		name: 'Loam desktop',
		file: 'loam-desktop.yml',
		jobAliases: { 'Merge queue paths / Merge queue paths': 'Merge queue paths' },
		jobs: [
			'Merge queue paths',
			'Affected units',
			'Desktop on Linux',
			'Desktop on Windows',
			'Desktop on macOS',
		],
	},
	// A manual run's matrix (ci.yml): Node 22, 24 and 26. Pull-request-only jobs are skipped on workflow_dispatch.
	ci: {
		name: 'CI',
		file: 'ci.yml',
		skippedJobs: ['Pull request title'],
		jobs: ['TypeScript (Node 22.x)', 'TypeScript (Node 24.x)', 'TypeScript (Node 26.x)'],
	},
};

const LOAM_JOB = 'Build, unit and Chromium';

/**
 * Where an exit row's tests run: a job of `loam.yml` and its step, by the names `gh run view --log` prints.
 * "Units" is the `loam` job's unit step and "Chromium" its `test:browser` step (section 15's preamble).
 * `budget` is read from the budget script's own rows, since `budget` is a measure and not a test.
 */
export const LOCATIONS = {
	units: { label: 'Units', job: LOAM_JOB, step: 'Unit suites with coverage' },
	lean: { label: "AFD's lean path", job: LOAM_JOB, step: "AFD's lean path" },
	chromium: {
		label: 'Chromium',
		job: LOAM_JOB,
		step: "Chromium suite against the built shell (phase 0's E1 to E10, phase 1's so far, A1 to A3; the walk is its own job)",
	},
	budget: { label: 'Bundle budget', job: LOAM_JOB, step: 'Bundle budget', evidence: 'budget' },
	walk: {
		label: 'Editor walk',
		job: 'Editor walk',
		step: "The editor area's seeded walk, every seed, thirteen invariants after each step",
	},
	mounted: {
		label: 'Mounted',
		job: 'Mounted against Umbel',
		step: "E3, E4 and E9's mounted part, through a test-only relay",
	},
	// Phase 3's E9: afd-server's and afd-auth's authorization suites (its specification, section 18).
	identity: { label: 'Identity path', job: LOAM_JOB, step: "AFD's identity path" },
	// Phase 3's E8: the unit step, but only the file its row names, so another suite's titles cannot stand in for it.
	handler: {
		label: 'Units, `identity/src/mcp-identity.test.ts`',
		job: LOAM_JOB,
		step: 'Unit suites with coverage',
		within: /^endpoints\/loam\/packages\/identity test:\s+\S+\s+src\/mcp-identity\.test\.ts > /,
	},
};

/**
 * Each exit row and where its row says it runs. E1 to E14 are the "Job" column of
 * endpoints/loam/docs/phases/2-scope-projects/spec.md, section 15; D1 to D10 are the "Job" column of
 * endpoints/loam/docs/phases/2-documents/spec.md, section 14. Change a row here only with its spec row.
 */
export const ROWS = [
	{ row: 'E1', in: ['chromium'] },
	// "`loam` job's "Bundle budget" step; Chromium; `loam` job's "AFD's lean path" step for `entry-points.test.ts`"
	{ row: 'E2', in: ['budget', 'chromium', 'lean'] },
	{ row: 'E3', in: ['chromium'] },
	{ row: 'E4', in: ['units', 'chromium'] },
	// "Units: `kernel/src/mcp-scope.test.ts`"
	{ row: 'E5', in: ['units'] },
	{ row: 'E6', in: ['mounted'] },
	{ row: 'E7', in: ['units', 'chromium'] },
	{ row: 'E8', in: ['units', 'chromium'] },
	{ row: 'E9', in: ['chromium'] },
	{ row: 'E10', in: ['units', 'chromium'] },
	// "Units; `loam` job's "AFD's lean path" step for `scripts/plugin-manifest.test.mjs`"
	{ row: 'E11', in: ['units', 'lean'] },
	{ row: 'E12', in: ['chromium'] },
	// Phases 0's and 1's exit tests, titled `P2-E13: E<n>:` over their own labels.
	{ row: 'E13', in: ['chromium', 'mounted', 'units'] },
	// "The exit step": this check itself.
	{ row: 'E14', in: [] },
	{ row: 'D1', in: ['chromium'] },
	{ row: 'D2', in: ['chromium', 'units'] },
	{ row: 'D3', in: ['units'] },
	{ row: 'D4', in: ['units'] },
	// "Units; Chromium", and the seeded walk, which left the Chromium step for a job of its own after the
	// specification was written.
	{ row: 'D5', in: ['units', 'chromium', 'walk'] },
	{ row: 'D6', in: ['units', 'chromium'] },
	{ row: 'D7', in: ['chromium'] },
	{ row: 'D8', in: ['chromium'] },
	{ row: 'D9', in: ['units', 'chromium'] },
	{ row: 'D10', in: ['chromium', 'units'] },
];

/**
 * Phase 3's exit rows: section 18 of endpoints/loam/docs/phases/3-identity/spec.md, by its "Place" column.
 * E12 reuses phase 2's rows and minimums (`reuse`); E16 is this check. Change a row here only with its spec
 * row. The `P3-H` rows are the hosted part, step 10's.
 */
export const P3_ROWS = [
	{ row: 'E1', in: ['chromium', 'units'] },
	{ row: 'E2', in: ['units', 'chromium'] },
	{ row: 'E3', in: ['chromium'] },
	{ row: 'E4', in: ['units', 'chromium'] },
	{ row: 'E5', in: ['chromium', 'units'] },
	{ row: 'E6', in: ['units', 'chromium'] },
	{ row: 'E7', in: ['chromium', 'units'] },
	// "Units (`identity/src/mcp-identity.test.ts`)", through a test-only handler: every unit, and that file's own.
	{ row: 'E8', in: ['units', 'handler'] },
	{ row: 'E9', in: ['identity'] },
	{ row: 'E10', in: ['budget', 'chromium'] },
	{ row: 'E11', in: ['chromium'] },
	// "Phase 2's places and minimums": every row of ROWS, with no `P3-E12:` title.
	{ row: 'E12', in: [], reuse: 2 },
	{ row: 'E13', in: ['units'] },
	{ row: 'E14', in: ['chromium', 'units'] },
	{ row: 'E15', in: ['chromium', 'units'] },
	// "The exit step": this check itself.
	{ row: 'E16', in: [] },
	{ row: 'E17', in: ['chromium', 'units'] },
	{ row: 'E18', in: ['chromium', 'units'] },
	{ row: 'E19', in: ['units', 'chromium'] },
	{ row: 'E20', in: ['chromium', 'units'] },
];

/** The two ceilings E2 names, as the budget script prints their rows. */
export const BUDGET_ROWS = [
	{ label: 'JavaScript, minified', ceiling: 300_000 },
	{ label: 'JavaScript, gzip', ceiling: 91_000 },
];

/**
 * The rows of phase 3's section 13, by the start of the label the budget script prints: first paint's two,
 * then each chunk row the section names. Under D115 a ceiling is whatever the script holds, so none is a
 * figure here. E12's P2-E2 reads the first two the same way.
 */
export const P3_BUDGET_ROWS = [
	'JavaScript, minified',
	'JavaScript, gzip',
	'@lushly-dev/loam-kernel alone',
	"The kernel's `late` chunk",
	"The kernel's `late-identity` chunk",
	'The `auth` chunk',
	'The `sign-in` chunk',
	'The `account-menu` chunk',
	'The `account` chunk',
	"The kernel's `apps` chunks",
	"The chrome's `surfaces` chunk",
];

/**
 * Phase 4's exit rows: section 19 of endpoints/loam/docs/phases/4-settings/spec.md, by its "Place" column.
 * E11 is withdrawn (menus are deferred); E14 reuses phase 3's local rows, which reuse phase 2's (`reuse`);
 * E16 is `scenarios.test.ts` in Units, then this check. Change a row here only with its spec row.
 */
export const P4_ROWS = [
	{ row: 'E1', in: ['chromium', 'units'] },
	{ row: 'E2', in: ['units'] },
	{ row: 'E3', in: ['units', 'chromium'] },
	{ row: 'E4', in: ['units', 'chromium'] },
	{ row: 'E5', in: ['chromium', 'units'] },
	{ row: 'E6', in: ['chromium', 'units'] },
	{ row: 'E7', in: ['chromium', 'units'] },
	{ row: 'E8', in: ['chromium', 'units'] },
	{ row: 'E9', in: ['chromium', 'units'] },
	{ row: 'E10', in: ['chromium', 'units'] },
	// "Withdrawn": menus are deferred (section 9, D127), so the row has no place and no title.
	{ row: 'E11', in: [], withdrawn: true },
	{ row: 'E12', in: ['budget', 'chromium'] },
	{ row: 'E13', in: ['chromium'] },
	// "Earlier phases' places": phase 3's local rows, whose E12 is phase 2's, each at its own minimums.
	{ row: 'E14', in: [], reuse: 3 },
	{ row: 'E15', in: ['units'] },
	// "Units; the exit step": the scenario runner's titles, then this check.
	{ row: 'E16', in: ['units'] },
	{ row: 'E17', in: ['units'] },
];

/**
 * The rows of phase 4's section 14, by the start of the label the budget script prints: first paint's two, then
 * each chunk row the section names. Under D115, as phase 3's: printed once, at or under its own ceiling.
 */
export const P4_BUDGET_ROWS = [
	'JavaScript, minified',
	'JavaScript, gzip',
	"The kernel's `late` chunk",
	"The kernel's `late-settings` chunk",
	'The `settings` chunk',
	"The chrome's `inbox` chunk",
	"The chrome's `overlays` chunk",
	"The kernel's `apps` chunks",
];

/**
 * ANSI escapes, as the escape character or in caret notation (`^[[32m`), which `gh run view --log` prints
 * in place of it since November 2026: neither is ever part of a title.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are what this strips.
const ANSI = /(?:\u001b|\^\[)\[[0-9;?]*[A-Za-z]/g;
const TIMESTAMP = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
/**
 * A Vitest verbose result: pnpm's prefix in a recursive run, a mark, a browser project's name in browser
 * mode, then `<path>.test.<ext> > ` and the title's segments. Console output never has this shape.
 */
const VITEST_RESULT =
	/^(?:[\w./@-]+ [\w-]+(?::[\w-]+)*: )?\s*([^\w\s])\s+(?:\|[\w-]+\|\s+|[\w-]+\s+)?[\w./@-]+\.test\.[cm]?[jt]sx? > (.*)$/u;
/** A node spec result, in the lean-path step only: a mark, the title, its duration, and any directive. */
const NODE_RESULT = /^\s*([^\w\s])\s+(.*?) \(\d+(?:\.\d+)?ms\)(?: # (.+))?$/u;
/** A row title starts a title segment: `P2-E2: `, or several, as `P2-E2: P2-D9: `; phase 3's `P3-E8: `. */
const ROW_TITLES = {
	P2: /^(?:P2-[ED]\d+: )+/,
	P3: /^(?:P3-E\d+: )+/,
	P4: /^(?:P4-E\d+: )+/,
};
const VITEST_STATUS = { '✓': 'pass', '×': 'fail', '↓': 'skip', '□': 'todo' };
const NODE_STATUS = { '✔': 'pass', '✖': 'fail', '﹣': 'skip' };
const RETRIED = /\(retry x\d+\)/;

/**
 * The rows a test claims: those its own title starts with, else those of its nearest describe that starts
 * with any. A describe that groups a scenario's tests does not claim a row for a test that names its own.
 */
function claimedRows(segments, rowTitle) {
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const prefix = rowTitle.exec(segments[index]);
		if (prefix)
			return [...new Set(prefix[0].trim().split(/:\s*/).filter(Boolean))].map((id) => id.slice(3));
	}
	return [];
}

/**
 * Reads `gh run view --log`: each line is `<job>\t<step>\t<timestamp> <text>`. Returns each test result
 * whose title claims a row, with its job, step, status and rows. Only a result line counts: Vitest's verbose
 * shape anywhere, node's spec shape in the lean-path step. A status is `pass` only for a passing mark with
 * no retry and no node directive (`# SKIP`, `# TODO`, `# EXPECTED FAILURE`); an unknown mark is its own
 * status, so a change of format fails closed. `prefix` is the phase whose titles it reads, `P2`, `P3` or `P4`;
 * each is read alone, so an earlier phase's reading is the same with a later phase's titles in the log.
 */
export function readTitles(log, prefix = 'P2') {
	const rowTitle = ROW_TITLES[prefix];
	const titles = [];
	for (const raw of log.split('\n')) {
		const [job, step, ...rest] = raw.split('\t');
		if (rest.length === 0) continue;
		const text = rest.join('\t').replace(ANSI, '').replace(TIMESTAMP, '').trimEnd();
		let mark;
		let segments;
		let status;
		const vitest = VITEST_RESULT.exec(text);
		const node = vitest || step !== LOCATIONS.lean.step ? null : NODE_RESULT.exec(text);
		if (vitest) {
			[, mark] = vitest;
			segments = vitest[2].split(' > ');
			status = VITEST_STATUS[mark] ?? `unknown mark "${mark}"`;
		} else if (node) {
			[, mark] = node;
			segments = [node[2]];
			status = node[3]
				? node[3].trim().toLowerCase()
				: (NODE_STATUS[mark] ?? `unknown mark "${mark}"`);
		} else continue;
		const rows = claimedRows(segments, rowTitle);
		if (rows.length === 0) continue;
		if (status === 'pass' && RETRIED.test(text)) status = 'retried';
		titles.push({ job, step, status, rows, text: text.trim() });
	}
	return titles;
}

/** The text a step printed, without the log's prefix or colour. */
function stepText(log, location) {
	const lines = [];
	for (const raw of log.split('\n')) {
		const [job, step, ...rest] = raw.split('\t');
		if (job === location.job && step === location.step && rest.length > 0)
			lines.push(rest.join('\t').replace(ANSI, '').replace(TIMESTAMP, ''));
	}
	return lines;
}

/** E2's bundle budget, read from the budget script's rows: each ceiling as specified, and within it. */
export function readBudget(log, location = LOCATIONS.budget) {
	const lines = stepText(log, location);
	const problems = [];
	const found = [];
	for (const { label, ceiling } of BUDGET_ROWS) {
		const pattern = new RegExp(`^${label}\\s+([\\d,]+)\\s+of\\s+([\\d,]+)\\s+(OVER|\\d+%)`);
		const row = lines.map((line) => pattern.exec(line.trim())).find(Boolean);
		if (!row) {
			problems.push(`${location.label}: no "${label}" row in the step's log`);
			continue;
		}
		const [bytes, printed] = [row[1], row[2]].map((value) => Number(value.replaceAll(',', '')));
		if (printed !== ceiling)
			problems.push(`${location.label}: "${label}" is held to ${printed}, not ${ceiling}`);
		if (row[3] === 'OVER' || bytes > ceiling)
			problems.push(`${location.label}: "${label}" is ${bytes}, over ${ceiling}`);
		found.push(`${label} ${bytes} of ${ceiling}`);
	}
	if (lines.some((line) => /budget: over the ceiling/.test(line)))
		problems.push(`${location.label}: the step reports a row over its ceiling`);
	return { problems, found };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Each figure a number, its thousands grouped: a comma alone, or a stray one, is no measurement.
const BUDGET_ROW = /\s(\d{1,3}(?:,\d{3})*)\s+of\s+(\d{1,3}(?:,\d{3})*)\s+(OVER|\d+%)$/;

/**
 * The budget under D115, for phase 3: each label named is printed once, at or under the ceiling it is held
 * to, and no row of the step is OVER or reported over. `labels` are the starts of the rows' labels.
 */
export function readBudgetWithin(log, labels, location = LOCATIONS.budget) {
	const lines = stepText(log, location).map((line) => line.trim());
	const problems = [];
	const found = [];
	const rows = lines.filter((line) => BUDGET_ROW.test(line));
	if (rows.length === 0) problems.push(`${location.label}: no budget row in the step's log`);
	for (const line of rows) {
		const [, bytes, ceiling, mark] = BUDGET_ROW.exec(line);
		const [used, held] = [bytes, ceiling].map((value) => Number(value.replaceAll(',', '')));
		if (mark === 'OVER' || used > held)
			problems.push(
				`${location.label}: "${line.slice(0, line.length - BUDGET_ROW.exec(line)[0].length).trim()}" is ${used}, over ${held}`
			);
	}
	for (const label of labels) {
		const matches = rows.filter((line) => new RegExp(`^${escapeRegExp(label)}\\b`).test(line));
		if (matches.length !== 1) {
			problems.push(
				`${location.label}: ${matches.length === 0 ? 'no' : matches.length} "${label}" row${matches.length === 0 ? '' : 's'} in the step's log`
			);
			continue;
		}
		const [, bytes, ceiling] = BUDGET_ROW.exec(matches[0]);
		found.push(`${label} ${bytes.replaceAll(',', '')} of ${ceiling.replaceAll(',', '')}`);
	}
	if (lines.some((line) => /budget: over the ceiling/.test(line)))
		problems.push(`${location.label}: the step reports a row over its ceiling`);
	return { problems, found };
}

/**
 * Condition 1 for one run: this repository, the right workflow file, a manual run on main, completed and a
 * success, on its first attempt unless `allowRerun`, and every job a success.
 */
export function checkRun(run, workflow, { allowRerun = false } = {}) {
	const problems = [];
	const where = `${workflow.file} run ${run.databaseId}`;
	if (run.repository !== REPOSITORY)
		problems.push(`${where} is in ${run.repository}, not ${REPOSITORY}`);
	if (run.path !== `.github/workflows/${workflow.file}`)
		problems.push(`${where} ran ${run.path}, not .github/workflows/${workflow.file}`);
	if (run.workflowName !== workflow.name)
		problems.push(`${where} is a run of "${run.workflowName}", not "${workflow.name}"`);
	if (run.event !== 'workflow_dispatch')
		problems.push(
			`${where} was triggered by ${run.event}, not workflow_dispatch, so its gates were not all open`
		);
	if (run.headBranch !== 'main') problems.push(`${where} ran on ${run.headBranch}, not main`);
	if (run.status !== 'completed') problems.push(`${where} is ${run.status}, not completed`);
	else if (run.conclusion !== 'success')
		problems.push(`${where} concluded ${run.conclusion}, not success`);
	if (run.attempt !== 1 && !allowRerun)
		problems.push(
			`${where} is attempt ${run.attempt}: a re-run can hide its first attempt's failure; pass --allow-rerun to accept it`
		);
	const aliases = workflow.jobAliases ?? {};
	const skippedJobs = workflow.skippedJobs ?? [];
	const canonicalName = (name) => aliases[name] ?? name;
	const names = run.jobs.map((job) => canonicalName(job.name));
	for (const name of workflow.jobs)
		if (!names.includes(name)) problems.push(`${where}: job "${name}" is missing`);
	for (const job of run.jobs) {
		const canonical = canonicalName(job.name);
		if (skippedJobs.includes(canonical)) {
			if (job.conclusion !== 'skipped')
				problems.push(
					`${where}: pull-request-only job "${job.name}" is ${job.conclusion || job.status}, not skipped`
				);
			continue;
		}
		if (!workflow.jobs.includes(canonical))
			problems.push(`${where}: job "${job.name}" is not one the check knows`);
		if (job.conclusion !== 'success')
			problems.push(`${where}: job "${job.name}" is ${job.conclusion || job.status}, not success`);
	}
	return problems;
}

/** A location's step, from the run's jobs: present, and a success. */
function checkStep(run, location) {
	const job = run.jobs.find((entry) => entry.name === location.job);
	if (!job) return [];
	const step = job.steps?.find((entry) => entry.name === location.step);
	if (!step) return [`${location.label}: job "${location.job}" has no step "${location.step}"`];
	if (step.conclusion !== 'success')
		return [`${location.label}: step "${location.step}" is ${step.conclusion}, not success`];
	return [];
}

/** The committed minimum count of passing titles for each row and place (see the file's `about`). */
export const MINIMUMS_FILE = 'loam-exit-check.minimums.json';
/** Phase 3's, in the same shape; E12 reads phase 2's file. */
export const P3_MINIMUMS_FILE = 'loam-exit-check.p3.minimums.json';
/** Phase 4's, in the same shape; E14 reads phase 3's file, and through it phase 2's. */
export const P4_MINIMUMS_FILE = 'loam-exit-check.p4.minimums.json';
export function readMinimums(file = MINIMUMS_FILE) {
	return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8'))
		.minimums;
}

/** Condition 3: every title of the phase's prefix that is not a plain pass, by name. */
function titleProblems(titles, prefix) {
	return titles
		.filter((title) => title.status !== 'pass')
		.map(
			(title) =>
				`${title.rows.map((row) => `${prefix}-${row}`).join(', ')} is marked ${title.status} in "${title.job}", step "${title.step}": ${title.text}`
		);
}

/**
 * Each phase the check reads, by its number: its title prefix, its rows, its minimums file, and its budget.
 * A phase with `budgetRows` reads them under D115 (`readBudgetWithin`); phase 2 holds its own figures
 * (`readBudget`) when checked as itself, and D115's first-paint rows when another phase reuses it. A row with
 * `reuse: <n>` is phase n's whole check, nested under it; `line` is what a row with no place prints. Phase 6's
 * milestones add their own entries here.
 */
export const PHASES = {
	2: { prefix: 'P2', rows: ROWS, minimumsFile: MINIMUMS_FILE, line: {} },
	3: {
		prefix: 'P3',
		rows: P3_ROWS,
		minimumsFile: P3_MINIMUMS_FILE,
		budgetRows: P3_BUDGET_ROWS,
		line: { E16: 'this check, the local part' },
	},
	4: {
		prefix: 'P4',
		rows: P4_ROWS,
		minimumsFile: P4_MINIMUMS_FILE,
		budgetRows: P4_BUDGET_ROWS,
		line: { E11: 'withdrawn, menus are deferred (section 9)' },
	},
};

/** Every place a phase's rows name, its reused phases' included. */
function placesOf(id) {
	return PHASES[id].rows.flatMap((row) => (row.reuse ? placesOf(row.reuse) : row.in));
}

/**
 * Conditions 2 and 3 over one phase's rows: each row's passing titles counted in each place it names, against
 * its minimums; a reused phase checked whole, its row problems prefixed with the row that reuses it. Returns
 * the title problems (condition 3, this phase's and each reused phase's, in that order), the row problems,
 * the report's lines and the counts observed for this phase's own rows.
 */
function checkPhase(id, { log, minimumsOf, reused = false }) {
	const { prefix, rows, minimumsFile, budgetRows, line } = PHASES[id];
	const titles = readTitles(log, prefix);
	const titleIssues = titleProblems(titles, prefix);
	// D115: a ceiling is the one the budget script holds, so phase 2's figures are read only as itself.
	const budget = budgetRows
		? readBudgetWithin(log, budgetRows)
		: reused
			? readBudgetWithin(log, P3_BUDGET_ROWS.slice(0, 2))
			: readBudget(log);
	const minimums = minimumsOf(id);
	const problems = [];
	const nested = [];
	const report = [];
	const observed = {};
	for (const { row, in: places, reuse } of rows) {
		if (reuse) {
			const inner = checkPhase(reuse, { log, minimumsOf, reused: true });
			titleIssues.push(...inner.titleIssues);
			nested.push(...inner.problems.map((problem) => `${prefix}-${row}: ${problem}`));
			report.push(
				`${prefix}-${row}: phase ${reuse}'s rows, in their places, at ${PHASES[reuse].minimumsFile}'s counts:`,
				...inner.report.map((entry) => `  ${entry}`)
			);
			continue;
		}
		if (places.length === 0) {
			report.push(`${prefix}-${row}: ${line[row] ?? 'this check'}`);
			continue;
		}
		const counts = places.map((key) => {
			const location = LOCATIONS[key];
			if (location.evidence === 'budget') {
				problems.push(...budget.problems.map((problem) => `${prefix}-${row}: ${problem}`));
				return `${location.label} ${budget.found.join(', ') || 'none'}`;
			}
			const passed = titles.filter(
				(title) =>
					title.status === 'pass' &&
					title.job === location.job &&
					title.step === location.step &&
					title.rows.includes(row) &&
					(!location.within || location.within.test(title.text))
			).length;
			observed[row] = { ...observed[row], [key]: passed };
			const floor = minimums[row]?.[key];
			if (passed === 0)
				problems.push(
					`${prefix}-${row}: no passing title in ${location.label} ("${location.job}", step "${location.step}")`
				);
			else if (floor === undefined)
				problems.push(`${prefix}-${row}: ${minimumsFile} records no minimum for ${location.label}`);
			else if (passed < floor)
				problems.push(
					`${prefix}-${row}: ${passed} passing titles in ${location.label}, fewer than the ${floor} ${minimumsFile} records`
				);
			return `${location.label} ${passed}`;
		});
		report.push(`${prefix}-${row}: ${counts.join('; ')}`);
	}
	return { titleIssues, problems: [...problems, ...nested], report, observed };
}

/**
 * The whole check over the two runs and the Loam run's log. Returns the problems, each naming what is
 * wrong, the report's lines, and the counts observed for the phase's own rows, in the minimums file's shape.
 * `minimums` is the phase's own (its file by default), `phase2Minimums` phase 2's when another phase reuses
 * it, and `minimumsByPhase` any phase's, by number; each defaults to the committed file.
 */
export function checkExit({
	loam,
	ci,
	log,
	phase = 2,
	minimums,
	phase2Minimums,
	minimumsByPhase = {},
	allowRerun = false,
}) {
	// A phase this check has no rows for is refused, never read as phase 2's: phase 6's milestones add their own.
	if (!Object.hasOwn(PHASES, phase))
		throw new Error(`The exit check has no rows for phase ${phase}`);
	const given = { ...minimumsByPhase };
	if (phase2Minimums !== undefined) given[2] = phase2Minimums;
	if (minimums !== undefined) given[phase] = minimums;
	const minimumsOf = (id) => given[id] ?? readMinimums(PHASES[id].minimumsFile);
	const problems = [
		...checkRun(loam, WORKFLOWS.loam, { allowRerun }),
		...checkRun(ci, WORKFLOWS.ci, { allowRerun }),
	];
	if (loam.headSha !== ci.headSha)
		problems.push(
			`the runs are of different commits: loam.yml ${loam.headSha}, ci.yml ${ci.headSha}`
		);

	for (const key of new Set(placesOf(phase))) problems.push(...checkStep(loam, LOCATIONS[key]));

	const own = checkPhase(phase, { log, minimumsOf });
	problems.push(...own.titleIssues, ...own.problems);
	const { report, observed } = own;

	const header = (run, workflow) =>
		`${workflow.file} run ${run.databaseId}, attempt ${run.attempt} (${run.event} on ${run.headBranch} at ${String(run.headSha).slice(0, 8)}), ${run.url}: ${run.jobs.map((job) => `${job.name} ${job.conclusion || job.status}`).join(', ')}`;
	return {
		problems,
		observed,
		report: [
			`Repository ${REPOSITORY}`,
			header(loam, WORKFLOWS.loam),
			header(ci, WORKFLOWS.ci),
			...report,
		],
	};
}

const RUN_FIELDS =
	'databaseId,workflowName,event,headBranch,headSha,status,conclusion,attempt,url,jobs';

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

/** A run as `gh run view` gives it, with its repository and workflow file from the Actions API. */
export function fetchRun(id) {
	const run = JSON.parse(gh(['run', 'view', id, '--repo', REPOSITORY, '--json', RUN_FIELDS]));
	const api = JSON.parse(
		gh([
			'api',
			`repos/${REPOSITORY}/actions/runs/${id}`,
			'--jq',
			'{path: .path, repository: .repository.full_name}',
		])
	);
	return { ...run, path: api.path.replace(/@.*$/, ''), repository: api.repository };
}

export function fetchRuns(loamId, ciId) {
	return {
		loam: fetchRun(loamId),
		ci: fetchRun(ciId),
		log: gh(['run', 'view', loamId, '--repo', REPOSITORY, '--log']),
	};
}

const USAGE =
	'usage: node scripts/loam-exit-check.mjs <loam run id> <ci run id> [--phase 2|3|4] [--allow-rerun] [--print-minimums]';

/** The arguments, or null when they are not the usage's: two run ids, and each flag at most once. */
export function parseArgs(argv) {
	const rest = [...argv];
	let phase = 2;
	const at = rest.indexOf('--phase');
	if (at !== -1) {
		const value = rest[at + 1];
		if (!['2', '3', '4'].includes(value)) return null;
		phase = Number(value);
		rest.splice(at, 2);
		if (rest.includes('--phase')) return null;
	}
	const args = rest.filter((arg) => !arg.startsWith('--'));
	const flags = rest.filter((arg) => arg.startsWith('--'));
	const unknown = flags.filter((flag) => !['--allow-rerun', '--print-minimums'].includes(flag));
	if (args.length !== 2 || args.some((arg) => !/^\d+$/.test(arg)) || unknown.length > 0)
		return null;
	return {
		ids: args,
		phase,
		allowRerun: flags.includes('--allow-rerun'),
		printMinimums: flags.includes('--print-minimums'),
	};
}

function main(argv) {
	const parsed = parseArgs(argv);
	if (!parsed) {
		console.error(USAGE);
		return 2;
	}
	const { problems, report, observed } = checkExit({
		...fetchRuns(parsed.ids[0], parsed.ids[1]),
		phase: parsed.phase,
		allowRerun: parsed.allowRerun,
	});
	console.log(report.join('\n'));
	if (parsed.printMinimums)
		console.log(
			`\nThe counts observed, for ${PHASES[parsed.phase].minimumsFile}:\n${JSON.stringify(observed, null, '\t')}`
		);
	if (problems.length > 0) {
		console.error(`\nThe exit check fails, ${problems.length} problem(s):`);
		for (const problem of problems) console.error(`- ${problem}`);
		return 1;
	}
	console.log('\nThe exit check passes: every job a success, every row passing where it names.');
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	process.exitCode = main(process.argv.slice(2));
