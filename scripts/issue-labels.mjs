#!/usr/bin/env node

/**
 * Triage label rules for AFD issues, read from `.github/labels.json`.
 *
 * Usage:
 *   node scripts/issue-labels.mjs check [<n>...] [--json]
 *   node scripts/issue-labels.mjs check --labels <a,b,...> [--assigned]
 *   node scripts/issue-labels.mjs dispatch [--json]
 *   node scripts/issue-labels.mjs labels [--create-missing]
 *
 * `check` reads every open issue (or the numbered ones) and reports each rule an
 * issue breaks, plus the untriaged issues (no status label, or only
 * `status:triage`). With `--labels` it checks a proposed label set without calling
 * GitHub, so a triage write can be verified before it is made.
 *
 * `dispatch` lists the issues a factory cell may take, in dispatch order:
 * `priority:0`, then `priority:1`, then the rest, oldest first. It leaves out
 * anything not planned, `execution:expert-escalation`, assigned issues (the
 * owner's lane), claimed issues, issues breaking a rule, and issues an open PR
 * would close. The factory plugin's `issue-check` shares these rules and messages
 * (endpoints/botcore/plugins/botcore-factory/src/botcore_factory/labels.py); change both.
 *
 * `labels` compares the repository's labels with the file: missing, extra, and
 * changed colors or descriptions. `--create-missing` creates the missing ones
 * (never a `legacy` one); nothing else here writes to GitHub, and it never edits
 * an issue.
 *
 * Exit codes: 0 clean; 1 a violation or difference; 2 usage, file or gh failure.
 * A failed read is exit 2, never an empty, clean result.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFINITIONS_PATH = fileURLToPath(new URL('../.github/labels.json', import.meta.url));
const ISSUE_LIMIT = 2000;
const EXIT_FAIL = 1;
const EXIT_ERROR = 2;

const TRIAGE = 'status:triage';
const PLANNED = 'status:planned';
const IN_PROGRESS = 'status:in-progress';
const DEFERRED = 'status:deferred';
const STATUSES = [TRIAGE, PLANNED, IN_PROGRESS, DEFERRED];
const P0 = 'priority:0';
const P1 = 'priority:1';
const EXPERT = 'execution:expert-escalation';
const NEEDS_OWNER = ['needs:decision', 'needs:operator'];
const NOT_PLANNABLE = ['needs:decision', 'needs:operator', 'blocked'];

/** Every label a rule names; the test keeps each one defined and current in the file. */
export const RULE_LABELS = [
	...STATUSES,
	P0,
	P1,
	'risk:high',
	'risk:medium',
	EXPERT,
	...NOT_PLANNABLE,
];

/** Parse and validate the definitions file text. */
export function parseDefinitions(text) {
	const entries = JSON.parse(text);
	if (!Array.isArray(entries)) throw new Error('labels.json must be a list of labels.');
	const seen = new Set();
	for (const entry of entries) {
		const name = entry?.name;
		if (typeof name !== 'string' || name === '') throw new Error('A label has no name.');
		if (seen.has(name)) throw new Error(`Label ${name} is defined twice.`);
		seen.add(name);
		if (!/^[0-9a-f]{6}$/i.test(String(entry.color))) throw new Error(`${name}: bad color.`);
		if (typeof entry.description !== 'string') throw new Error(`${name}: no description.`);
	}
	return entries;
}

export function loadDefinitions(path = DEFINITIONS_PATH) {
	return parseDefinitions(readFileSync(path, 'utf8'));
}

function facts(issue, definitions) {
	const names = new Set(issue.labels);
	const defined = new Map(definitions.map((entry) => [entry.name, entry]));
	return {
		has: (name) => names.has(name),
		assigned: issue.assigned,
		statuses: STATUSES.filter((name) => names.has(name)),
		executions: [...names].filter((name) => name.startsWith('execution:')),
		unknown: [...names].filter((name) => !defined.has(name)),
		legacy: [...names].filter((name) => defined.get(name)?.legacy),
	};
}

function statusRule(f) {
	if (f.statuses.length < 2) return null;
	if (f.statuses.length === 2 && f.has(IN_PROGRESS) && f.has(TRIAGE)) {
		return `${TRIAGE} left beside the ${IN_PROGRESS} claim: remove ${TRIAGE}`;
	}
	return `${f.statuses.length} status labels (${f.statuses.join(', ')}): keep exactly one`;
}

function executionRule(f) {
	if (f.executions.length > 1) {
		return `several execution profiles (${f.executions.join(', ')}): keep one execution profile`;
	}
	if (f.has(PLANNED) && f.executions.length === 0) return `${PLANNED} without an execution profile`;
	if (f.has(DEFERRED) && f.executions.length > 0) return `${DEFERRED} keeps ${f.executions[0]}`;
	return null;
}

const RULES = [
	(f) => f.unknown.map((name) => `${name} is not defined in .github/labels.json`),
	(f) => f.legacy.map((name) => `legacy label ${name}: re-evaluate and replace it`),
	statusRule,
	(f) => f.has(P0) && f.has(P1) && `both ${P0} and ${P1}`,
	(f) => f.has(P0) && !f.assigned && `${P0} unassigned`,
	(f) => f.has('risk:high') && f.has('risk:medium') && 'both risk:high and risk:medium',
	executionRule,
	(f) => f.has(EXPERT) && !f.assigned && `${EXPERT} unassigned`,
	(f) => NEEDS_OWNER.filter((name) => f.has(name) && !f.assigned).map((n) => `${n} unassigned`),
	(f) => f.has(PLANNED) && NOT_PLANNABLE.filter(f.has).map((name) => `${PLANNED} with ${name}`),
];

/**
 * The rules one issue breaks.
 * @param {{ labels: string[], assigned: boolean }} issue
 */
export function issueViolations(issue, definitions) {
	const f = facts(issue, definitions);
	return RULES.flatMap((rule) => rule(f) || []);
}

/** True when triage still has to classify the issue. */
export function isUntriaged(labels) {
	const statuses = STATUSES.filter((name) => labels.includes(name));
	return statuses.length === 0 || (statuses.length === 1 && statuses[0] === TRIAGE);
}

function priorityRank(labels) {
	if (labels.includes(P0)) return 0;
	if (labels.includes(P1)) return 1;
	return 2;
}

/**
 * The issues a cell may take, in dispatch order, and why each other planned issue is held back.
 * @param {{ number: number, labels: string[], assigned: boolean, createdAt: string }[]} issues
 * @param {Set<number>} withOpenPr issue numbers an open PR would close
 */
export function dispatchOrder(issues, definitions, withOpenPr = new Set()) {
	const dispatchable = [];
	const held = [];
	for (const issue of issues) {
		if (!issue.labels.includes(PLANNED)) continue;
		const reasons = [];
		if (issue.labels.includes(EXPERT)) reasons.push(`${EXPERT}: the owner's lane`);
		else if (issue.assigned) reasons.push("assigned: the owner's lane");
		if (issue.labels.includes(IN_PROGRESS)) reasons.push('claimed');
		if (withOpenPr.has(issue.number)) reasons.push('an open PR would close it');
		const problems = issueViolations(issue, definitions);
		if (problems.length > 0) reasons.push(`breaks a rule: ${problems.join('; ')}`);
		if (reasons.length > 0) held.push({ number: issue.number, reasons });
		else dispatchable.push(issue);
	}
	dispatchable.sort(
		(a, b) =>
			priorityRank(a.labels) - priorityRank(b.labels) ||
			a.createdAt.localeCompare(b.createdAt) ||
			a.number - b.number
	);
	return { dispatchable, held };
}

/** Differences between the definitions and the repository's labels. */
export function labelDifferences(definitions, live) {
	const liveByName = new Map(live.map((label) => [label.name, label]));
	const fileNames = new Set(definitions.map((entry) => entry.name));
	const missing = definitions.filter((entry) => !liveByName.has(entry.name));
	const extra = live.filter((label) => !fileNames.has(label.name)).map((label) => label.name);
	const changed = [];
	for (const entry of definitions) {
		const label = liveByName.get(entry.name);
		if (!label) continue;
		if (label.color.toLowerCase() !== String(entry.color).toLowerCase()) {
			changed.push(`${entry.name}: color ${entry.color} in the file, ${label.color} in GitHub`);
		}
		if ((label.description ?? '') !== entry.description) {
			changed.push(`${entry.name}: description differs from GitHub ("${label.description}")`);
		}
	}
	return { missing, extra, changed };
}

function defaultGh(args) {
	return execFileSync('gh', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 60_000,
	});
}

const FIELDS = 'number,title,state,labels,assignees,createdAt';

function toIssue(raw) {
	return {
		number: raw.number,
		title: raw.title,
		state: raw.state,
		labels: (raw.labels ?? []).map((label) => label.name),
		assigned: (raw.assignees ?? []).length > 0,
		createdAt: raw.createdAt ?? '',
	};
}

function readIssues(ctx, numbers = []) {
	if (numbers.length > 0) {
		return numbers.map((n) => toIssue(JSON.parse(ctx.gh(['issue', 'view', n, '--json', FIELDS]))));
	}
	const rows = JSON.parse(
		ctx.gh(['issue', 'list', '--state', 'open', '--limit', String(ISSUE_LIMIT), '--json', FIELDS])
	);
	if (rows.length >= ISSUE_LIMIT) {
		throw new Error(`gh returned ${rows.length} issues, the read limit; the list may be cut short`);
	}
	return rows.map(toIssue);
}

function readOpenPrIssues(ctx) {
	const rows = JSON.parse(
		ctx.gh([
			'pr',
			'list',
			'--state',
			'open',
			'--limit',
			String(ISSUE_LIMIT),
			'--json',
			'number,closingIssuesReferences',
		])
	);
	if (rows.length >= ISSUE_LIMIT) {
		throw new Error(`gh returned ${rows.length} PRs, the read limit; the list may be cut short`);
	}
	return new Set(rows.flatMap((pr) => (pr.closingIssuesReferences ?? []).map((ref) => ref.number)));
}

function report(ctx, issues, json) {
	const results = issues.map((issue) => ({
		number: issue.number,
		title: issue.title,
		untriaged: issue.state === 'OPEN' && isUntriaged(issue.labels),
		problems: issue.state === 'OPEN' ? issueViolations(issue, ctx.definitions) : [],
	}));
	const failing = results.filter((result) => result.problems.length > 0);
	const untriaged = results.filter((result) => result.untriaged).map((result) => result.number);
	if (json) {
		ctx.log(JSON.stringify({ checked: results.length, untriaged, violations: failing }, null, 2));
	} else {
		for (const result of failing) {
			ctx.log(`#${result.number} ${result.title}`);
			for (const problem of result.problems) ctx.log(`  - ${problem}`);
		}
		if (untriaged.length > 0) ctx.log(`Untriaged: ${untriaged.map((n) => `#${n}`).join(', ')}`);
		ctx.log(
			`Checked ${results.length} issue(s): ${failing.length} with violations, ${untriaged.length} untriaged.`
		);
	}
	return failing.length > 0 ? EXIT_FAIL : 0;
}

function runCheck(ctx, values, positionals) {
	if (values.labels !== undefined) {
		const proposed = values.labels
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean);
		const problems = issueViolations(
			{ labels: proposed, assigned: Boolean(values.assigned) },
			ctx.definitions
		);
		// A label set about to be written must leave the issue triaged.
		if (isUntriaged(proposed)) problems.push('no status label other than status:triage');
		for (const problem of problems) ctx.log(`- ${problem}`);
		if (problems.length === 0) ctx.log('Label set satisfies the triage rules.');
		return problems.length > 0 ? EXIT_FAIL : 0;
	}
	const numbers = positionals.map((value) => value.replace(/^#/, ''));
	const bad = numbers.find((value) => !/^[1-9]\d*$/.test(value));
	if (bad !== undefined) {
		ctx.error(`Not an issue number: ${bad}`);
		return EXIT_ERROR;
	}
	return report(ctx, readIssues(ctx, numbers), values.json);
}

function runDispatch(ctx, values) {
	const issues = readIssues(ctx);
	const { dispatchable, held } = dispatchOrder(issues, ctx.definitions, readOpenPrIssues(ctx));
	if (values.json) {
		const rows = dispatchable.map(({ number, title, labels }) => ({ number, title, labels }));
		ctx.log(JSON.stringify({ dispatchable: rows, held }, null, 2));
		return 0;
	}
	for (const issue of dispatchable) {
		const profile = issue.labels.find((name) => name.startsWith('execution:')) ?? '';
		ctx.log(`#${issue.number} ${profile.replace('execution:', '')}  ${issue.title}`);
	}
	for (const { number, reasons } of held) ctx.log(`held #${number}: ${reasons.join('; ')}`);
	ctx.log(`${dispatchable.length} dispatchable, ${held.length} planned but held.`);
	return 0;
}

function runLabels(ctx, values) {
	const live = JSON.parse(
		ctx.gh(['label', 'list', '--limit', '1000', '--json', 'name,color,description'])
	);
	const { missing, extra, changed } = labelDifferences(ctx.definitions, live);
	let remaining = extra.length + changed.length;
	for (const { name, color, description, legacy } of missing) {
		if (!legacy && values['create-missing']) {
			ctx.gh(['label', 'create', name, '--color', color, '--description', description]);
			ctx.log(`created ${name}`);
			continue;
		}
		// A retired label is never recreated; its absence means the file entry should go.
		ctx.log(
			legacy ? `legacy ${name} is gone from GitHub: remove it` : `missing from GitHub: ${name}`
		);
		remaining++;
	}
	for (const name of extra) ctx.log(`not in .github/labels.json: ${name}`);
	for (const line of changed) ctx.log(line);
	if (remaining === 0) ctx.log('GitHub labels match .github/labels.json.');
	return remaining > 0 ? EXIT_FAIL : 0;
}

const OPTIONS = {
	json: { type: 'boolean' },
	labels: { type: 'string' },
	assigned: { type: 'boolean' },
	'create-missing': { type: 'boolean' },
};

/**
 * Run the CLI. GitHub calls go through `deps.gh` so tests supply a fake.
 * Returns the process exit code.
 */
export function run(argv, deps = {}) {
	const ctx = {
		gh: deps.gh ?? defaultGh,
		log: deps.log ?? console.log,
		error: deps.error ?? console.error,
	};
	try {
		const { values, positionals } = parseArgs({
			args: argv,
			options: OPTIONS,
			allowPositionals: true,
		});
		const [command, ...rest] = positionals;
		ctx.definitions = deps.definitions ?? loadDefinitions();
		if (command === 'check') return runCheck(ctx, values, rest);
		if (command === 'dispatch' && rest.length === 0) return runDispatch(ctx, values);
		if (command === 'labels' && rest.length === 0) return runLabels(ctx, values);
		ctx.error('Usage: issue-labels.mjs check [<n>...] [--json] [--labels <a,b> [--assigned]]');
		ctx.error('       issue-labels.mjs dispatch [--json]');
		ctx.error('       issue-labels.mjs labels [--create-missing]');
		return EXIT_ERROR;
	} catch (cause) {
		ctx.error(`issue-labels: ${cause instanceof Error ? cause.message : String(cause)}`);
		return EXIT_ERROR;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = run(process.argv.slice(2));
}
