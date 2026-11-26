#!/usr/bin/env node
/**
 * Loam's exit check: `node scripts/loam-exit-check.mjs <loam run id> <ci run id> [--phase 2|3|4 | --phase 6
 * --milestone m1]`, or `node scripts/loam-exit-check.mjs <loam run id> <ci run id> <loam-desktop run id> --phase 5
 * --milestone a`. Phase 2's, by default, as below; `--phase 3` is phase 3's local part, after this comment's list.
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
 * The hosted part is step 10's: P3-H1 to P3-H5, and P3-E8's two cases left to the server (section 18's "Hosted" for
 * E8), each in the "Hosted" place, the `Hosted development profile` job's criterion step. They are phase 3's own
 * rows (`ownRows`), read when phase 3 is checked as itself: `--phase 3` is the exit, both parts, and phase 4's P4-E14,
 * which reuses "phase 3's local rows", reads the local ones alone.
 *
 * `--phase 4` is step 11 of the phase 4 specification (endpoints/loam/docs/phases/4-settings/spec.md, section
 * 20), its whole exit, which is local (D126). It checks the same two runs by condition 1, then each `P4-E<n>:`
 * row of section 19 in the places its row names, against loam-exit-check.p4.minimums.json, with condition 3
 * over `P4-` titles. E11 is withdrawn (menus are deferred, section 9) and has no count. P4-E14 reuses phase 3's
 * rows and minimums, and through P3-E12 phase 2's, each with condition 3 over its own prefix. E12's budget is
 * section 14's rows under D115, as above: each printed, at or under its own ceiling, and none OVER.
 *
 * `--phase 6 --milestone m1` is step 7 of the phase 6 specification (endpoints/loam/docs/phases/6-hosts/
 * spec.md, sections 5.3, 19 and 20), the table's `'6-m1'` entry: M1 is reached when P6-E1 to P6-E5, P6-E7 to
 * P6-E9 and P6-H1 to P6-H8 pass in their places. It checks the same two runs by condition 1 (the desktop
 * workflow is read only under `--phase 6` without `--milestone`, which is the exit's, step 13), then each of
 * those rows in the places section 19 names, against loam-exit-check.p6.minimums.json's `m1`, with condition 3
 * over every `P6-` title in the log, M1's or not. Since D162 the `Hosted development profile` job runs the
 * frozen lane: "Units" is the `loam` job's unit step for every package but `loam-host` and that job's
 * "The hosted server's unit suites with coverage" for `loam-host`, each counted on its own; "Host path" is its
 * "AFD's host path" step and "Hosted" its criterion step. P6-E9's budget is read under D115, as phase
 * 3's is. No earlier phase's row is read: M1 lists only its own (5.3), and the exit's reuse is step 13's.
 *
 * `--phase 5 --milestone a` is step 8 of the phase 5 specification (endpoints/loam/docs/phases/5-copilot/
 * spec.md, sections 1, 16 and 18), the table's `'5-a'` entry: milestone A, the desktop copilot, is reached when
 * P5-A1 to P5-A9 pass in their places. It takes a third id, a manual run of `loam-desktop.yml`, and holds all
 * three runs to condition 1, on one commit. Each row is counted in the places section 18's Place column names,
 * each in its own run's log: "Kernel units" is the `loam` job's unit step, the kernel package's titles alone;
 * "Chromium" its Chromium step; "Desktop on Linux" (WebKitGTK) and "Desktop on Windows" (WebView2) the
 * desktop workflow's two jobs of those names, each its "Desktop suite under tauri-driver" step. A desktop step
 * that printed no Vitest result line fails by itself, naming the step. Condition 3 reads every `P5-` title in
 * both logs, a row's place or not. Section 16's `budget` rows, and first paint's, are read under D115, as
 * phase 6's are, though no row's place names the budget. loam-exit-check.p5.minimums.json's `a` holds the
 * counts, and while the file says `placeholder` the check fails: step 8 sets them from its manual runs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
		// The exact four jobs `loam.yml` had at phase 2's exit on 2026-11-09, before "Merge queue paths",
		// "Firefox suites", "WebKit suites", and "Hosted development profile" were added (#2181). Accepted for
		// standalone `--phase 2` only.
		phase2HistoricalJobs: [
			'Affected units',
			'Build, unit and Chromium',
			'Editor walk',
			'Mounted against Umbel',
		],
	},
	// Phase 6's steps 11 and 12: the desktop suite and installers (specification, 10.7 and 11.3). Read under
	// `--phase 5 --milestone a` (phase 5's section 18), and by phase 6's exit, step 13 (its section 19).
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
	// Phase 6's section 19, whose frozen lane (D162; its CI split, #2287, 2026-11-23) runs in its own job: `loam-host`'s half of
	// "Units", P6-E7's `local-db` SQLite contract, and the hosted criterion.
	hostUnits: {
		label: 'Units, `loam-host`',
		job: 'Hosted development profile',
		step: "The hosted server's unit suites with coverage",
	},
	host: { label: 'Host path', job: 'Hosted development profile', step: "AFD's host path" },
	hosted: {
		label: 'Hosted',
		job: 'Hosted development profile',
		step: 'Hosted criterion against the development profile',
	},
	// Phase 5's section 18: "Kernel units" is the unit step's kernel package, so another package's titles (the
	// copilot's, the CLI's) cannot stand in for the kernel's.
	kernelUnits: {
		label: 'Kernel units',
		job: LOAM_JOB,
		step: 'Unit suites with coverage',
		within: /^endpoints\/loam\/packages\/kernel test: /,
	},
	// Phase 5's desktop suite, in `loam-desktop.yml`'s run and log (`workflow`): both jobs run a step of one
	// name, so a place names its job too. `silent` is what a step that printed no Vitest result line says.
	desktopLinux: {
		label: 'Desktop on Linux',
		workflow: 'desktop',
		job: 'Desktop on Linux',
		step: 'Desktop suite under tauri-driver',
		silent: 'the WebKitGTK suite printed no result the check can read',
	},
	desktopWindows: {
		label: 'Desktop on Windows',
		workflow: 'desktop',
		job: 'Desktop on Windows',
		step: 'Desktop suite under tauri-driver',
		silent:
			"the step runs `test:desktop` through its medium-integrity launcher (CreateProcessAsUserW, which passes no standard handles of its own): if the step's log holds none of the suite's output, the child's output did not reach the log, which is no test result",
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
 * row. The hosted part, step 10's, is {@link P3_HOSTED_ROWS}.
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

/**
 * Phase 3's hosted part (step 10): section 18's `P3-H` rows, and E8's "Hosted", the two cases step 7 left to the
 * server, each in the hosted criterion's step. Read only when phase 3 is checked as itself (`ownRows`).
 */
export const P3_HOSTED_ROWS = [
	{ row: 'E8', in: ['hosted'] },
	{ row: 'H1', in: ['hosted'] },
	{ row: 'H2', in: ['hosted'] },
	{ row: 'H3', in: ['hosted'] },
	{ row: 'H4', in: ['hosted'] },
	{ row: 'H5', in: ['hosted'] },
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
 * Milestone M1's rows: section 19 of endpoints/loam/docs/phases/6-hosts/spec.md, by its "Place" column, for
 * the rows 5.3 lists. E6 is M4's and every `P6-H` row past H8 M2's or M4's. E8 is this check. Change a row
 * here only with its spec row.
 */
export const P6_M1_ROWS = [
	// "Units" is two steps since D162: `loam-host`'s suites run in the hosted job, every other package's in the
	// `loam` job. Each row names the halves its test files are in, so a half that drops its suites fails.
	{ row: 'E1', in: ['units', 'hostUnits'] },
	{ row: 'E2', in: ['hostUnits'] },
	{ row: 'E3', in: ['units', 'hostUnits'] },
	{ row: 'E4', in: ['units'] },
	{ row: 'E5', in: ['units', 'hostUnits'] },
	{ row: 'E7', in: ['host'] },
	// "The exit step": this check itself, with `--milestone m1`.
	{ row: 'E8', in: [] },
	// "Budget; Chromium; Hosted".
	{ row: 'E9', in: ['budget', 'chromium', 'hosted'] },
	{ row: 'H1', in: ['hosted'] },
	{ row: 'H2', in: ['hosted'] },
	{ row: 'H3', in: ['hosted'] },
	{ row: 'H4', in: ['hosted'] },
	{ row: 'H5', in: ['hosted'] },
	{ row: 'H6', in: ['hosted'] },
	{ row: 'H7', in: ['hosted'] },
	{ row: 'H8', in: ['hosted'] },
];

/**
 * Section 14's browser rows, which P6-E9 names, by the start of the label the budget script prints: first
 * paint's two, `late`, `late-hosted`, and the projection validator's chunk, which is the kernel's `apps` chunks
 * (step 3's measurement). Under D115, as phase 3's: printed once, at or under its own ceiling.
 */
export const P6_BUDGET_ROWS = [
	'JavaScript, minified',
	'JavaScript, gzip',
	"The kernel's `late` chunk",
	"The kernel's `late-hosted` chunk",
	"The kernel's `apps` chunks",
];

/**
 * Milestone A's rows: section 18 of endpoints/loam/docs/phases/5-copilot/spec.md, by its Place column. Change a
 * row here only with its spec row.
 */
export const P5_A_ROWS = [
	{ row: 'A1', in: ['kernelUnits', 'chromium', 'desktopLinux', 'desktopWindows'] },
	// "Chromium, WebView2, WebKitGTK": the unit titles of P5-A2 (the CLI's, the copilot's, `loam-host`'s in the
	// hosted job) are read by condition 3 and counted in no place.
	{ row: 'A2', in: ['chromium', 'desktopLinux', 'desktopWindows'] },
	// "Desktop": the desktop suite, both jobs; the Rust host's own tests are `cargo test`, with no title read.
	{ row: 'A3', in: ['desktopLinux', 'desktopWindows'] },
	{ row: 'A4', in: ['kernelUnits', 'chromium'] },
	{ row: 'A5', in: ['kernelUnits'] },
	{ row: 'A6', in: ['kernelUnits', 'desktopLinux', 'desktopWindows'] },
	{ row: 'A7', in: ['kernelUnits'] },
	{ row: 'A8', in: ['chromium', 'desktopLinux', 'desktopWindows'] },
	// Linux alone: vitest.desktop.config.ts leaves `test/mail.test.ts` out on Windows, where the engine's
	// `test-world` is refused (the mail plugin's specification, 12.4).
	{ row: 'A9', in: ['desktopLinux'] },
];

/**
 * Section 16's `budget` rows, by the start of the label the budget script prints: first paint's two, which the
 * section keeps, then the copilot's panel and its runtime per provider kind. Under D115, as phase 6's.
 */
export const P5_BUDGET_ROWS = [
	'JavaScript, minified',
	'JavaScript, gzip',
	'The `copilot-panel` chunk',
	'The copilot runtime for `anthropic` and `test`, gzip',
	'The copilot runtime for the OpenAI kinds',
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
/**
 * A row title starts a title segment: `P2-E2: `, or several, as `P2-E2: P2-D9: `; phase 3's `P3-E8: `. Phase 5's
 * may carry a note before its colon, `P5-A2 (D153): `.
 */
const ROW_TITLES = {
	P2: /^(?:P2-[ED]\d+: )+/,
	// The local rows' and step 10's hosted ones (`P3-H1: `).
	P3: /^(?:P3-[EH]\d+: )+/,
	P4: /^(?:P4-E\d+: )+/,
	// Every kind of phase 6's section 19, so condition 3 reads a title of a row M1 does not list too.
	P6: /^(?:P6-[EHMIDX]\d+: )+/,
	// Every milestone's, so condition 3 reads a milestone B or C title too.
	// A note names the case a title proves, as the tests write it (`P5-A2 (D153): `, `(S1)` to `(S3)`): nothing else.
	P5: /^(?:P5-[ABC]\d+(?: \([DST]\d+\))?: )+/,
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
			return [...new Set(prefix[0].replace(/ \([^)]*\)/g, '').match(/P\d-[A-Z]+\d+/g) ?? [])].map(
				(id) => id.slice(3)
			);
	}
	return [];
}

/**
 * Reads `gh run view --log`: each line is `<job>\t<step>\t<timestamp> <text>`. Returns each test result
 * whose title claims a row, with its job, step, status and rows. Only a result line counts: Vitest's verbose
 * shape anywhere, node's spec shape in the lean-path step. A status is `pass` only for a passing mark with
 * no retry and no node directive (`# SKIP`, `# TODO`, `# EXPECTED FAILURE`); an unknown mark is its own
 * status, so a change of format fails closed. `prefix` is the phase whose titles it reads, `P2` to `P6`;
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

const TIMESTAMP_CAPTURE = /^\uFEFF?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z ?/;
const STEP_BOUNDARY = /^##\[group\](?:Run |Post )/;

/**
 * Resolves `UNKNOWN STEP` lines that `gh run view --log` emits once GitHub Actions compacts a run's log zip
 * to per-job `<n>_<job>.txt` files (without per-step files, #2181). Lines with an explicit step name are
 * never altered, and jobs without step timestamps keep `UNKNOWN STEP` so checks fail closed.
 */
export function resolveLogSteps(log, run) {
	if (!log.includes('\tUNKNOWN STEP\t') || !Array.isArray(run?.jobs)) return log;
	const stepsByJob = new Map();
	for (const job of run.jobs) {
		const timed = (job.steps ?? [])
			.filter((step) => step.conclusion !== 'skipped' && step.startedAt && step.completedAt)
			.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
			.map((step) => ({
				name: step.name,
				startSec: Date.parse(step.startedAt),
				endSec: Date.parse(step.completedAt),
			}))
			.filter((step) => Number.isFinite(step.startSec) && Number.isFinite(step.endSec));
		if (timed.length > 0) stepsByJob.set(job.name, timed);
	}
	if (stepsByJob.size === 0) return log;
	const cursors = new Map();
	return log
		.split('\n')
		.map((raw) => {
			const first = raw.indexOf('\t');
			if (first === -1) return raw;
			const second = raw.indexOf('\t', first + 1);
			if (second === -1) return raw;
			const step = raw.slice(first + 1, second);
			if (step !== 'UNKNOWN STEP') return raw;
			const job = raw.slice(0, first);
			const steps = stepsByJob.get(job);
			if (!steps) return raw;
			const body = raw.slice(second + 1);
			const stamp = TIMESTAMP_CAPTURE.exec(body);
			if (!stamp) return raw;
			const tsSec = Date.parse(`${stamp[1]}Z`);
			const text = body.slice(stamp[0].length);
			let index = cursors.get(job) ?? 0;
			let advanced = false;
			while (index + 1 < steps.length && tsSec > steps[index].endSec) {
				index += 1;
				advanced = true;
			}
			if (
				!advanced &&
				index + 1 < steps.length &&
				tsSec >= steps[index + 1].startSec &&
				STEP_BOUNDARY.test(text)
			) {
				index += 1;
			}
			cursors.set(job, index);
			const assigned = steps[index];
			if (tsSec < assigned.startSec || tsSec > assigned.endSec) return raw;
			return `${job}\t${assigned.name}\t${body}`;
		})
		.join('\n');
}

/**
 * Condition 1 for one run: this repository, the right workflow file, a manual run on main, completed and a
 * success, on its first attempt unless `allowRerun`, and every job a success.
 */
export function checkRun(run, workflow, { allowRerun = false, historicalJobs = [] } = {}) {
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
	const uniqueNames = new Set(names);
	const matchedHistorical = historicalJobs.find(
		(expected) =>
			names.length === expected.length &&
			uniqueNames.size === expected.length &&
			expected.every((name) => uniqueNames.has(name))
	);
	const expectedJobs = matchedHistorical ?? workflow.jobs;
	// Exactly once each: a job listed twice is not the list, whatever its conclusions.
	for (const name of expectedJobs)
		if (!names.includes(name)) problems.push(`${where}: job "${name}" is missing`);
	for (const name of uniqueNames)
		if (names.filter((entry) => entry === name).length > 1)
			problems.push(`${where}: job "${name}" appears more than once`);
	for (const job of run.jobs) {
		const canonical = canonicalName(job.name);
		if (skippedJobs.includes(canonical)) {
			if (job.conclusion !== 'skipped')
				problems.push(
					`${where}: pull-request-only job "${job.name}" is ${job.conclusion || job.status}, not skipped`
				);
			continue;
		}
		if (!expectedJobs.includes(canonical))
			problems.push(`${where}: job "${job.name}" is not one the check knows`);
		if (job.conclusion !== 'success')
			problems.push(`${where}: job "${job.name}" is ${job.conclusion || job.status}, not success`);
	}
	return problems;
}

/** A location's step, from its own run's jobs: present, and a success. */
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
/** Phase 6's, one object per milestone under `minimums`: `{ "minimums": { "m1": { "E1": { "units": n } } } }`. */
export const P6_MINIMUMS_FILE = 'loam-exit-check.p6.minimums.json';
/** Phase 5's, in phase 6's shape, by milestone: `{ "minimums": { "a": { "A1": { "kernelUnits": n } } } }`. */
export const P5_MINIMUMS_FILE = 'loam-exit-check.p5.minimums.json';
function readMinimumsFile(file) {
	// Named from this folder; an absolute name is read as it is, which is what `path.relative`
	// gives for a file on another Windows drive (#2624).
	return JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), file), 'utf8'));
}
export function readMinimums(file = MINIMUMS_FILE) {
	return readMinimumsFile(file).minimums;
}
/**
 * Whether a minimums file holds placeholders, not a manual run's counts: its `placeholder` is true, or lists the
 * milestone's key, so one milestone's counts can be set while a later one's are still placeholders. Any other value
 * of the field fails safe: it is read as placeholders.
 */
export function minimumsArePlaceholders(file, key) {
	const { placeholder } = readMinimumsFile(file);
	if (placeholder === undefined || placeholder === false) return false;
	if (placeholder === true) return true;
	// Any other value is a mistake made by hand, read as placeholders, so it can never let a run pass.
	if (!Array.isArray(placeholder) || !placeholder.every((entry) => typeof entry === 'string'))
		return true;
	return key !== undefined && placeholder.includes(key);
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
 * milestones are entries of their own, `'6-<milestone>'`, whose minimums are `minimumsKey`'s object in the file.
 */
export const PHASES = {
	2: { prefix: 'P2', rows: ROWS, minimumsFile: MINIMUMS_FILE, line: {} },
	3: {
		prefix: 'P3',
		rows: P3_ROWS,
		// Step 10's hosted part: read when phase 3 is checked as itself, never when another phase reuses its local rows.
		ownRows: P3_HOSTED_ROWS,
		minimumsFile: P3_MINIMUMS_FILE,
		budgetRows: P3_BUDGET_ROWS,
		line: { E16: 'this check, the local part' },
		ownLine: { E16: 'this check, both parts' },
	},
	4: {
		prefix: 'P4',
		rows: P4_ROWS,
		minimumsFile: P4_MINIMUMS_FILE,
		budgetRows: P4_BUDGET_ROWS,
		line: { E11: 'withdrawn, menus are deferred (section 9)' },
	},
	'6-m1': {
		prefix: 'P6',
		rows: P6_M1_ROWS,
		minimumsFile: P6_MINIMUMS_FILE,
		minimumsKey: 'm1',
		budgetRows: P6_BUDGET_ROWS,
		line: { E8: 'this check, milestone m1' },
	},
	// Milestone A reads the desktop run too (`desktop`), and section 16's budget though no row names it
	// (`budgetLine`, the report's and each problem's label for it).
	'5-a': {
		prefix: 'P5',
		rows: P5_A_ROWS,
		minimumsFile: P5_MINIMUMS_FILE,
		minimumsKey: 'a',
		budgetRows: P5_BUDGET_ROWS,
		budgetLine: "Section 16's bundle rows",
		desktop: true,
		line: {},
	},
};

/** A phase's minimums as its file records them: the whole file's, or its milestone's object. */
function fileMinimums(id) {
	const { minimumsFile, minimumsKey } = PHASES[id];
	const minimums = readMinimums(minimumsFile);
	return minimumsKey === undefined ? minimums : (minimums[minimumsKey] ?? {});
}

/** The counts observed in the shape the phase's minimums file holds them. */
export function minimumsShape(id, observed) {
	const { minimumsKey } = PHASES[id];
	return minimumsKey === undefined ? observed : { [minimumsKey]: observed };
}

/**
 * A phase's rows: its `rows`, then its `ownRows` when it is checked as itself (`reused` false), as phase 3's hosted
 * part is.
 */
function rowsOf(id, reused) {
	const { rows, ownRows } = PHASES[id];
	return reused || !ownRows ? rows : [...rows, ...ownRows];
}

/**
 * Whether a title ran in a place only the phase's `ownRows` name, none of its `rows`: phase 3's hosted step. Another
 * phase that reuses it reads its local rows alone, so condition 3 there leaves such a title to the phase's own check.
 */
function ranOnlyInOwnPlaces(id, title) {
	const local = new Set(PHASES[id].rows.flatMap((row) => row.in));
	return (PHASES[id].ownRows ?? []).some(({ in: places }) =>
		places.some((key) => !local.has(key) && ranIn(title, LOCATIONS[key]))
	);
}

/** Every place a phase reads, its reused phases' included: its rows', and the budget's for a `budgetLine`. */
function placesOf(id, reused = false) {
	return [
		...rowsOf(id, reused).flatMap((row) => (row.reuse ? placesOf(row.reuse, true) : row.in)),
		...(PHASES[id].budgetLine ? ['budget'] : []),
	];
}

/** Titles read from each run's log, each marked with the workflow it ran in (`run`, as `LOCATIONS` names it). */
function titlesOf(logs, prefix) {
	return Object.entries(logs).flatMap(([run, log]) =>
		readTitles(log, prefix).map((title) => ({ ...title, run }))
	);
}

/** Whether a title ran in a place: its run, job and step, and the place's file or package if it names one. */
function ranIn(title, location) {
	return (
		title.run === (location.workflow ?? 'loam') &&
		title.job === location.job &&
		title.step === location.step &&
		(!location.within || location.within.test(title.text))
	);
}

/** The Vitest result lines a place's step printed, any title's: none means the step's output was not read. */
function resultLines(log, location) {
	return stepText(log, location).filter((text) => VITEST_RESULT.test(text.trimEnd())).length;
}

/**
 * Conditions 2 and 3 over one phase's rows: each row's passing titles counted in each place it names, against
 * its minimums; a reused phase checked whole, its row problems prefixed with the row that reuses it. Returns
 * the title problems (condition 3, this phase's and each reused phase's, in that order), the row problems,
 * the report's lines and the counts observed for this phase's own rows.
 */
function checkPhase(id, { log, desktopLog, minimumsOf, reused = false }) {
	const { prefix, minimumsFile, budgetRows, budgetLine } = PHASES[id];
	const rows = rowsOf(id, reused);
	const line = reused ? PHASES[id].line : { ...PHASES[id].line, ...PHASES[id].ownLine };
	const titles = titlesOf(
		desktopLog === undefined ? { loam: log } : { loam: log, desktop: desktopLog },
		prefix
	).filter((title) => !(reused && ranOnlyInOwnPlaces(id, title)));
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
			const inner = checkPhase(reuse, { log, desktopLog, minimumsOf, reused: true });
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
				(title) => title.status === 'pass' && title.rows.includes(row) && ranIn(title, location)
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
	if (budgetLine) {
		problems.push(...budget.problems.map((problem) => `${budgetLine}: ${problem}`));
		report.push(`${budgetLine}: ${LOCATIONS.budget.label} ${budget.found.join(', ') || 'none'}`);
	}
	return { titleIssues, problems: [...problems, ...nested], report, observed };
}

/**
 * The whole check over the runs and their logs: the Loam run's, and for a phase that reads it (`desktop`) the
 * desktop run's. Returns the problems, each naming what is wrong, the report's lines, and the counts observed
 * for the phase's own rows, in the minimums file's shape. `minimums` is the phase's own (its file by default),
 * `phase2Minimums` phase 2's when another phase reuses it, and `minimumsByPhase` any phase's, by number; each
 * defaults to the committed file, which fails the check while it says `placeholder`.
 */
export function checkExit({
	loam,
	ci,
	desktop,
	log,
	desktopLog,
	phase = 2,
	minimums,
	phase2Minimums,
	minimumsByPhase = {},
	allowRerun = false,
}) {
	// A phase this check has no rows for is refused, never read as phase 2's: phases 5 and 6 only by a milestone.
	if (!Object.hasOwn(PHASES, phase)) {
		const milestones = PHASE_MILESTONES[String(phase)];
		throw new Error(
			`The exit check has no rows for phase ${phase}${milestones ? `; phase ${phase} takes --milestone ${milestones.join('|')}` : ''}`
		);
	}
	const readsDesktop = PHASES[phase].desktop === true;
	const given = { ...minimumsByPhase };
	if (phase2Minimums !== undefined) given[2] = phase2Minimums;
	if (minimums !== undefined) given[phase] = minimums;
	const minimumsOf = (id) => given[id] ?? fileMinimums(id);
	const problems = [
		...checkRun(loam, WORKFLOWS.loam, {
			allowRerun,
			historicalJobs: phase === 2 ? [WORKFLOWS.loam.phase2HistoricalJobs] : [],
		}),
		...checkRun(ci, WORKFLOWS.ci, { allowRerun }),
	];
	const withDesktop = readsDesktop && desktop !== undefined && desktopLog !== undefined;
	if (readsDesktop && !withDesktop)
		problems.push(
			`phase ${phase} reads three runs: no ${WORKFLOWS.desktop.file} run and log were given, the third id`
		);
	if (withDesktop) problems.push(...checkRun(desktop, WORKFLOWS.desktop, { allowRerun }));
	if (loam.headSha !== ci.headSha)
		problems.push(
			`the runs are of different commits: loam.yml ${loam.headSha}, ci.yml ${ci.headSha}`
		);
	if (withDesktop && desktop.headSha !== loam.headSha)
		problems.push(
			`the runs are of different commits: loam.yml ${loam.headSha}, ${WORKFLOWS.desktop.file} ${desktop.headSha}`
		);
	// Each phase read from its committed file, a reused one included: one holding placeholders fails.
	const phasesRead = (id) => [
		id,
		...PHASES[id].rows.flatMap((row) => (row.reuse ? phasesRead(row.reuse) : [])),
	];
	for (const id of new Set(phasesRead(phase)))
		if (
			given[id] === undefined &&
			minimumsArePlaceholders(PHASES[id].minimumsFile, PHASES[id].minimumsKey)
		)
			problems.push(
				`${PHASES[id].minimumsFile} holds placeholder counts, not a manual run's: set them from the runs' --print-minimums`
			);

	const resolvedLog = resolveLogSteps(log, loam);
	const resolvedDesktopLog = withDesktop ? resolveLogSteps(desktopLog, desktop) : undefined;
	for (const key of new Set(placesOf(phase))) {
		const location = LOCATIONS[key];
		if (location.workflow !== 'desktop') {
			problems.push(...checkStep(loam, location));
			continue;
		}
		if (!withDesktop) continue;
		const stepProblems = checkStep(desktop, location);
		problems.push(...stepProblems);
		// A step that ran, passed and printed nothing the check reads: said once, naming why, before its rows'
		// counts. A missing job is condition 1's, and a missing or failed step `checkStep`'s.
		const ran = desktop.jobs.some((entry) => entry.name === location.job);
		// Only a Vitest step says why it would be silent; a location of another kind is read as its rows say.
		if (
			location.silent &&
			ran &&
			stepProblems.length === 0 &&
			resultLines(resolvedDesktopLog, location) === 0
		)
			problems.push(
				`${location.label}: step "${location.step}" of ${WORKFLOWS.desktop.file}'s "${location.job}" printed no Vitest result line; ${location.silent}`
			);
	}

	const own = checkPhase(phase, { log: resolvedLog, desktopLog: resolvedDesktopLog, minimumsOf });
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
			...(withDesktop ? [header(desktop, WORKFLOWS.desktop)] : []),
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

/** The runs and their logs: the desktop run's only when its id is given, as the third. */
export function fetchRuns(loamId, ciId, desktopId) {
	return {
		loam: fetchRun(loamId),
		ci: fetchRun(ciId),
		log: gh(['run', 'view', loamId, '--repo', REPOSITORY, '--log']),
		...(desktopId === undefined
			? {}
			: {
					desktop: fetchRun(desktopId),
					desktopLog: gh(['run', 'view', desktopId, '--repo', REPOSITORY, '--log']),
				}),
	};
}

const USAGE = [
	'usage: node scripts/loam-exit-check.mjs <loam run id> <ci run id> [--phase 2|3|4 | --phase 6 --milestone m1] [--allow-rerun] [--print-minimums]',
	'       node scripts/loam-exit-check.mjs <loam run id> <ci run id> <loam-desktop run id> --phase 5 --milestone a [--allow-rerun] [--print-minimums]',
].join('\n');

/** Each phase's milestones the check has rows for; a phase listed here is read only by one of them. */
export const PHASE_MILESTONES = { 5: ['a'], 6: ['m1'] };

/**
 * The arguments, or null when they are not the usage's: two run ids, or three for a phase that reads the
 * desktop run, and each flag at most once; `--milestone` only with `--phase 5` or `6`, each of which needs one
 * of its own until its exit is written. A milestone is the table's `'<phase>-<milestone>'`.
 */
export function parseArgs(argv) {
	// Each flag's value is read where the flag stands in `argv`, before anything is removed, so one flag
	// never takes a value that followed another.
	const taken = new Set();
	const take = (flag, values) => {
		const at = argv.indexOf(flag);
		if (at === -1) return undefined;
		const value = argv[at + 1];
		taken.add(at).add(at + 1);
		if (!values.includes(value) || argv.indexOf(flag, at + 1) !== -1) return null;
		return value;
	};
	const phaseValue = take('--phase', ['2', '3', '4', '5', '6']);
	const milestone = take('--milestone', Object.values(PHASE_MILESTONES).flat());
	if (phaseValue === null || milestone === null) return null;
	const rest = argv.filter((_, index) => !taken.has(index));
	const milestones = PHASE_MILESTONES[phaseValue];
	if ((milestones !== undefined) !== (milestone !== undefined)) return null;
	if (milestones !== undefined && !milestones.includes(milestone)) return null;
	const phase =
		phaseValue === undefined
			? 2
			: milestones !== undefined
				? `${phaseValue}-${milestone}`
				: Number(phaseValue);
	const args = rest.filter((arg) => !arg.startsWith('--'));
	const flags = rest.filter((arg) => arg.startsWith('--'));
	const unknown = flags.filter((flag) => !['--allow-rerun', '--print-minimums'].includes(flag));
	const ids = PHASES[phase].desktop === true ? 3 : 2;
	if (args.length !== ids || args.some((arg) => !/^\d+$/.test(arg)) || unknown.length > 0)
		return null;
	if (new Set(flags).size !== flags.length) return null;
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
		...fetchRuns(...parsed.ids),
		phase: parsed.phase,
		allowRerun: parsed.allowRerun,
	});
	console.log(report.join('\n'));
	if (parsed.printMinimums)
		console.log(
			`\nThe counts observed, for ${PHASES[parsed.phase].minimumsFile}:\n${JSON.stringify(minimumsShape(parsed.phase, observed), null, '\t')}`
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
