#!/usr/bin/env node
/**
 * Loam phase 2's exit check: `node scripts/loam-exit-check.mjs <loam run id> <ci run id>`.
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
		jobs: ['Affected units', 'Build, unit and Chromium', 'Editor walk', 'Mounted against Umbel'],
	},
	// A manual run's matrix (ci.yml): Node 22, 24 and 26.
	ci: {
		name: 'CI',
		file: 'ci.yml',
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

/** The two ceilings E2 names, as the budget script prints their rows. */
export const BUDGET_ROWS = [
	{ label: 'JavaScript, minified', ceiling: 300_000 },
	{ label: 'JavaScript, gzip', ceiling: 91_000 },
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are what this strips.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const TIMESTAMP = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
/**
 * A Vitest verbose result: pnpm's prefix in a recursive run, a mark, a browser project's name in browser
 * mode, then `<path>.test.<ext> > ` and the title's segments. Console output never has this shape.
 */
const VITEST_RESULT =
	/^(?:[\w./@-]+ [\w-]+(?::[\w-]+)*: )?\s*([^\w\s])\s+(?:\|[\w-]+\|\s+|[\w-]+\s+)?[\w./@-]+\.test\.[cm]?[jt]sx? > (.*)$/u;
/** A node spec result, in the lean-path step only: a mark, the title, its duration, and any directive. */
const NODE_RESULT = /^\s*([^\w\s])\s+(.*?) \(\d+(?:\.\d+)?ms\)(?: # (.+))?$/u;
/** A row title starts a title segment: `P2-E2: `, or several, as `P2-E2: P2-D9: `. */
const ROW_TITLE = /^(?:P2-[ED]\d+: )+/;
const VITEST_STATUS = { '✓': 'pass', '×': 'fail', '↓': 'skip', '□': 'todo' };
const NODE_STATUS = { '✔': 'pass', '✖': 'fail', '﹣': 'skip' };
const RETRIED = /\(retry x\d+\)/;

/**
 * The rows a test claims: those its own title starts with, else those of its nearest describe that starts
 * with any. A describe that groups a scenario's tests does not claim a row for a test that names its own.
 */
function claimedRows(segments) {
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const prefix = ROW_TITLE.exec(segments[index]);
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
 * status, so a change of format fails closed.
 */
export function readTitles(log) {
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
		const rows = claimedRows(segments);
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
	const names = run.jobs.map((job) => job.name);
	for (const name of workflow.jobs)
		if (!names.includes(name)) problems.push(`${where}: job "${name}" is missing`);
	for (const job of run.jobs) {
		if (!workflow.jobs.includes(job.name))
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
export function readMinimums() {
	return JSON.parse(
		readFileSync(join(dirname(fileURLToPath(import.meta.url)), MINIMUMS_FILE), 'utf8')
	).minimums;
}

/**
 * The whole check over the two runs and the Loam run's log. Returns the problems, each naming what is
 * wrong, the report's lines, and the counts observed, in the minimums file's shape.
 */
export function checkExit({ loam, ci, log, minimums = readMinimums(), allowRerun = false }) {
	const problems = [
		...checkRun(loam, WORKFLOWS.loam, { allowRerun }),
		...checkRun(ci, WORKFLOWS.ci, { allowRerun }),
	];
	if (loam.headSha !== ci.headSha)
		problems.push(
			`the runs are of different commits: loam.yml ${loam.headSha}, ci.yml ${ci.headSha}`
		);

	const used = new Set(ROWS.flatMap((row) => row.in));
	for (const key of used) problems.push(...checkStep(loam, LOCATIONS[key]));

	const titles = readTitles(log);
	for (const title of titles)
		if (title.status !== 'pass')
			problems.push(
				`${title.rows.map((row) => `P2-${row}`).join(', ')} is marked ${title.status} in "${title.job}", step "${title.step}": ${title.text}`
			);

	const budget = readBudget(log);
	const report = [];
	const observed = {};
	for (const { row, in: places } of ROWS) {
		if (places.length === 0) {
			report.push(`P2-${row}: this check`);
			continue;
		}
		const counts = places.map((key) => {
			const location = LOCATIONS[key];
			if (location.evidence === 'budget') {
				problems.push(...budget.problems.map((problem) => `P2-${row}: ${problem}`));
				return `${location.label} ${budget.found.join(', ') || 'none'}`;
			}
			const passed = titles.filter(
				(title) =>
					title.status === 'pass' &&
					title.job === location.job &&
					title.step === location.step &&
					title.rows.includes(row)
			).length;
			observed[row] = { ...observed[row], [key]: passed };
			const floor = minimums[row]?.[key];
			if (passed === 0)
				problems.push(
					`P2-${row}: no passing title in ${location.label} ("${location.job}", step "${location.step}")`
				);
			else if (floor === undefined)
				problems.push(`P2-${row}: ${MINIMUMS_FILE} records no minimum for ${location.label}`);
			else if (passed < floor)
				problems.push(
					`P2-${row}: ${passed} passing titles in ${location.label}, fewer than the ${floor} ${MINIMUMS_FILE} records`
				);
			return `${location.label} ${passed}`;
		});
		report.push(`P2-${row}: ${counts.join('; ')}`);
	}

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
	'usage: node scripts/loam-exit-check.mjs <loam run id> <ci run id> [--allow-rerun] [--print-minimums]';

function main(argv) {
	const args = argv.filter((arg) => !arg.startsWith('--'));
	const flags = argv.filter((arg) => arg.startsWith('--'));
	const unknown = flags.filter((flag) => !['--allow-rerun', '--print-minimums'].includes(flag));
	if (args.length !== 2 || args.some((arg) => !/^\d+$/.test(arg)) || unknown.length > 0) {
		console.error(USAGE);
		return 2;
	}
	const { problems, report, observed } = checkExit({
		...fetchRuns(args[0], args[1]),
		allowRerun: flags.includes('--allow-rerun'),
	});
	console.log(report.join('\n'));
	if (flags.includes('--print-minimums'))
		console.log(
			`\nThe counts observed, for ${MINIMUMS_FILE}:\n${JSON.stringify(observed, null, '\t')}`
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
