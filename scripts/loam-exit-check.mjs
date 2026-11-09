#!/usr/bin/env node
/**
 * Loam phase 2's exit check: `node scripts/loam-exit-check.mjs <loam run id> <ci run id>`.
 *
 * Step 14 of the phase 2 specification (endpoints/loam/docs/phases/2-scope-projects/spec.md, section 16)
 * runs `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`, which opens every gate, and then this. It
 * fails, naming what is wrong, unless:
 *
 * 1. by `gh run view <id> --json jobs`, every job of both runs says `success`, none `skipped` or
 *    `cancelled`, and each run holds exactly the jobs its workflow has, so a renamed or missing job fails;
 * 2. by `gh run view <loam id> --log`, each exit row's `P2-E<n>:` or `P2-D<n>:` title passes in the log of
 *    each job and step its row names, read from the log and not assumed from the job's success;
 * 3. no such title anywhere in that log is marked skipped, todo or failed.
 *
 * It prints a short report for STATUS.md's exit line: each job's conclusion, and each row's passing titles
 * counted where its row names. `ci.yml`'s log cannot show a title, since lefthook prints only a summary,
 * so its jobs prove the whole workspace by their conclusions alone, and `loam.yml`'s "AFD's lean path" step
 * shows E2's and E11's AFD side.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
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
const TITLE = /(?<![\w-])P2-([ED]\d+):/g;
/** Vitest's verbose marks, then node's spec marks; node marks a todo as passing and says `# TODO`. */
const MARK = /(?:^|\s)([✓✔×✖↓□﹣])\s/u;
const STATUS = {
	'✓': 'pass',
	'✔': 'pass',
	'×': 'fail',
	'✖': 'fail',
	'↓': 'skip',
	'﹣': 'skip',
	'□': 'todo',
};

/**
 * The rows a test claims: those of its own title, else those of its nearest describe that names any. Vitest's
 * verbose line is `file > describe > ... > test`, so a describe that groups a scenario's tests does not claim
 * a row for a test that names its own; node's spec line is the test's title alone.
 */
function claimedRows(title) {
	const segments = title.split(' > ');
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const rows = [...new Set([...segments[index].matchAll(TITLE)].map((match) => match[1]))];
		if (rows.length > 0) return rows;
	}
	return [];
}

/**
 * Reads `gh run view --log`: each line is `<job>\t<step>\t<timestamp> <text>`. Returns each line that
 * carries a `P2-` title after a test's mark, with its job, step, status and rows.
 */
export function readTitles(log) {
	const titles = [];
	for (const raw of log.split('\n')) {
		const [job, step, ...rest] = raw.split('\t');
		if (rest.length === 0) continue;
		const text = rest.join('\t').replace(ANSI, '').replace(TIMESTAMP, '').trimEnd();
		const mark = MARK.exec(text);
		if (!mark) continue;
		const after = text.slice(mark.index + mark[0].length);
		const rows = claimedRows(after);
		if (rows.length === 0) continue;
		let status = STATUS[mark[1]];
		if (/ # SKIP\b/.test(after)) status = 'skip';
		else if (/ # TODO\b/.test(after)) status = 'todo';
		titles.push({ job, step, status, rows, text: after });
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

/** Condition 1 for one run: the right workflow, a manual run on main, completed, every job a success. */
export function checkRun(run, workflow) {
	const problems = [];
	const where = `${workflow.file} run ${run.databaseId}`;
	if (run.workflowName !== workflow.name)
		problems.push(`${where} is a run of "${run.workflowName}", not "${workflow.name}"`);
	if (run.event !== 'workflow_dispatch')
		problems.push(
			`${where} was triggered by ${run.event}, not workflow_dispatch, so its gates were not all open`
		);
	if (run.headBranch !== 'main') problems.push(`${where} ran on ${run.headBranch}, not main`);
	if (run.status !== 'completed') problems.push(`${where} is ${run.status}, not completed`);
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

/**
 * The whole check over the two runs and the Loam run's log. Returns the problems, each naming what is
 * wrong, and the report's lines.
 */
export function checkExit({ loam, ci, log }) {
	const problems = [...checkRun(loam, WORKFLOWS.loam), ...checkRun(ci, WORKFLOWS.ci)];
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
			if (passed === 0)
				problems.push(
					`P2-${row}: no passing title in ${location.label} ("${location.job}", step "${location.step}")`
				);
			return `${location.label} ${passed}`;
		});
		report.push(`P2-${row}: ${counts.join('; ')}`);
	}

	const jobs = (run, workflow) =>
		`${workflow.file} run ${run.databaseId} (${run.event} on ${run.headBranch} at ${String(run.headSha).slice(0, 8)}): ${run.jobs.map((job) => `${job.name} ${job.conclusion || job.status}`).join(', ')}`;
	return {
		problems,
		report: [jobs(loam, WORKFLOWS.loam), jobs(ci, WORKFLOWS.ci), ...report],
	};
}

const RUN_FIELDS =
	'databaseId,workflowName,event,headBranch,headSha,status,conclusion,attempt,url,jobs';

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

export function fetchRuns(loamId, ciId, repository = REPOSITORY) {
	const view = (id) =>
		JSON.parse(gh(['run', 'view', id, '--repo', repository, '--json', RUN_FIELDS]));
	return {
		loam: view(loamId),
		ci: view(ciId),
		log: gh(['run', 'view', loamId, '--repo', repository, '--log']),
	};
}

function main(argv) {
	const args = argv.filter((arg) => !arg.startsWith('--'));
	const repository = argv.find((arg) => arg.startsWith('--repo='))?.slice('--repo='.length);
	if (args.length !== 2 || args.some((arg) => !/^\d+$/.test(arg))) {
		console.error(
			'usage: node scripts/loam-exit-check.mjs <loam run id> <ci run id> [--repo=owner/name]'
		);
		return 2;
	}
	const { problems, report } = checkExit(fetchRuns(args[0], args[1], repository));
	console.log(report.join('\n'));
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
