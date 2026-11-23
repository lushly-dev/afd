#!/usr/bin/env node
/**
 * ceiling-raises: after D115 ends, a ceiling rises only with what the rules it amended ask (Loam's D161, #1929).
 *
 *   node scripts/ceiling-raises.mjs [--base <ref>]     (also run by `budget`)
 *
 * While `D115_ENDS_ON` in `ceiling-amendments.mjs` is `null` the check is inert and says so. Once it holds a
 * date and today (UTC) is after it, the check compares every ceiling row of the sources below on the base with the
 * working tree. A row raised, added or removed needs an entry in `CEILING_AMENDMENTS` (or, when one run spans several
 * merged pull requests, a chain of them) matching its old and new figures, with the measurement, the reason, the
 * section of a specification that records the row and new figure, and who approved it, where and when (phase 0's
 * 8.1, phase 2's 2.4, phase 3's 13 as they were written). A lowering needs nothing. On every run, inert or not, it
 * checks the ledger's entries, that D161 says "D115 ends on <date>", and that a date the base holds is moved or
 * unset only by a change whose D161 no longer records the old date: the base's date is read from git, so a pull request cannot switch
 * the check off by unsetting it.
 *
 * The base: `--base` or `AFD_BASE`; in GitHub Actions, the merge commit's first parent on `pull_request`, the
 * group's `base_sha` on `merge_group`, `before` on `push`; elsewhere the merge base with `origin/main`. A base the
 * shallow checkout lacks is fetched at depth 1 (never into a full clone, which that would make shallow). Under CI a run with no base fails, except a manual one, which has
 * nothing to compare; elsewhere it says it did not check.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CEILING_AMENDMENTS, D115_ENDS_ON } from './ceiling-amendments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../../..');

/** Every object of ceilings the check reads, by repository path and exported name. */
export const SOURCES = Object.freeze([
	{ file: 'endpoints/loam/packages/web/scripts/budget.mjs', name: 'CEILINGS' },
	{
		file: 'endpoints/loam/packages/web/test/browser/first-paint-budget.ts',
		name: 'PAINT_CEILINGS',
	},
]);

export const DECISIONS = 'endpoints/loam/docs/decisions.md';
export const AMENDMENTS_FILE = 'endpoints/loam/packages/web/scripts/ceiling-amendments.mjs';
const SPECIFICATIONS = 'endpoints/loam/docs/phases/';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const APPROVAL_LINK = /^https:\/\/github\.com\/lushly-dev\/afd\/(?:issues|pull)\/\d+(?:#[\w-]+)?$/;

const isDate = (value) =>
	typeof value === 'string' &&
	DATE.test(value) &&
	new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * The rows of `export const <name> = ... { ... }` in `source`: `key: 1_234` lines, comments aside. Any other line
 * in the object is an error, so a row the parser cannot read fails rather than leaving the check.
 * @returns {{ rows: Record<string, number> } | { error: string }}
 */
export function parseCeilings(source, name) {
	const start = source.search(new RegExp(`^export const ${name}\\b[^=]*=`, 'm'));
	if (start < 0) return { error: `no \`export const ${name}\`` };
	const open = source.indexOf('{', start);
	if (open < 0) return { error: `\`${name}\` has no object` };
	const rows = {};
	for (const raw of source.slice(open + 1).split(/\r?\n/)) {
		const line = raw.replace(/\/\/.*$/, '').trim();
		if (line === '') continue;
		if (/^\}/.test(line)) break;
		const row = line.match(/^(\w+):\s*([\d_]+),?$/);
		if (!row) return { error: `\`${name}\` holds a line the check cannot read: ${raw.trim()}` };
		if (row[1] in rows) return { error: `\`${name}\` names \`${row[1]}\` twice` };
		rows[row[1]] = Number(row[2].replaceAll('_', ''));
	}
	if (Object.keys(rows).length === 0) return { error: `\`${name}\` holds no ceiling` };
	return { rows };
}

/** Every row raised, added or removed between `base` and `head`; a lowering is left out. */
export function ceilingChanges(base, head) {
	const changes = [];
	for (const [row, to] of Object.entries(head)) {
		const from = Object.hasOwn(base, row) ? base[row] : null;
		if (from === null || to > from) changes.push({ row, from, to });
	}
	for (const [row, from] of Object.entries(base))
		if (!Object.hasOwn(head, row)) changes.push({ row, from, to: null });
	return changes;
}

/** The decision log's row for `id` (`| D161 | ...`), or `null`. */
export function decisionRow(decisions, id) {
	return decisions.split(/\r?\n/).find((line) => line.startsWith(`| ${id} |`)) ?? null;
}

/** What is wrong with D115's recorded end date: its form, and D161 stating it as `D115 ends on <date>`. */
export function checkEndDate(endsOn, decisions) {
	if (endsOn === null) return [];
	if (!isDate(endsOn))
		return [`D115_ENDS_ON is ${JSON.stringify(endsOn)}, not a date as YYYY-MM-DD`];
	const d161 = decisionRow(decisions, 'D161');
	if (!d161) return [`${DECISIONS} has no D161 row to record D115's end date`];
	if (!d161.includes(`D115 ends on ${endsOn}`))
		return [
			`D115_ENDS_ON is ${endsOn}, which D161 in ${DECISIONS} does not record as "D115 ends on ${endsOn}"`,
		];
	return [];
}

/**
 * `D115_ENDS_ON` as `source` (a `ceiling-amendments.mjs`) writes it: `null`, a quoted date, or an error, so the
 * base's date can be compared with the working tree's.
 * @returns {{ endsOn: string | null } | { error: string }}
 */
export function parseEndDate(source) {
	const match = source.match(/^export const D115_ENDS_ON\s*=\s*(null|'[^']*'|"[^"]*");\s*$/m);
	if (!match)
		return { error: 'no `export const D115_ENDS_ON = null` or quoted date the check can read' };
	return { endsOn: match[1] === 'null' ? null : match[1].slice(1, -1) };
}

/**
 * A change of the end date the base holds: once set, a pull request that unsets or moves it must also rewrite
 * D161's "D115 ends on <date>", so the check cannot be switched off from inside the change it checks.
 */
export function checkEndDateChange(baseEndsOn, endsOn, decisions) {
	if (baseEndsOn === null || baseEndsOn === endsOn) return [];
	if (!decisionRow(decisions, 'D161')?.includes(`D115 ends on ${baseEndsOn}`)) return [];
	return [
		`D115_ENDS_ON on the base is ${baseEndsOn} and this change makes it ${JSON.stringify(endsOn)}, while D161 still records "D115 ends on ${baseEndsOn}": the date moves only with the owner's new decision`,
	];
}

/** GitHub's anchor for a Markdown heading's text. */
export function headingAnchor(heading) {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.replace(/\s/g, '-');
}

/** The text of the section `anchor` names in `markdown`, to the next heading of its level or above, or `null`. */
export function sectionText(markdown, anchor) {
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex(
		(line) => /^#{1,6} /.test(line) && headingAnchor(line.replace(/^#+ /, '')) === anchor
	);
	if (start < 0) return null;
	const level = lines[start].match(/^#+/)[0].length;
	let end = start + 1;
	while (end < lines.length && !(lines[end].match(/^(#+) /)?.[1].length <= level)) end++;
	return lines.slice(start, end).join('\n');
}

/**
 * What is wrong with one ledger entry, on its own. `readRepoFile(path)` returns a file's text or `null`.
 * @returns {string[]}
 */
export function checkAmendment(entry, { readRepoFile, decisions, today }) {
	const problems = [];
	const at = `CEILING_AMENDMENTS entry for ${JSON.stringify(entry?.row)}`;
	if (typeof entry !== 'object' || entry === null) return [`${at}: not an object`];
	const { row, from, to, measured, reason, amendment, approvedBy, approval, approvedOn } = entry;
	const figure = (value) => value === null || (Number.isInteger(value) && value > 0);
	if (typeof row !== 'string' || !/^\w+$/.test(row))
		problems.push(`${at}: \`row\` is not a row name`);
	if (!figure(from) || !figure(to))
		problems.push(`${at}: \`from\` and \`to\` are whole bytes or null`);
	if (from === null && to === null) problems.push(`${at}: \`from\` and \`to\` are both null`);
	if (from !== null && to !== null && to <= from)
		problems.push(`${at}: \`to\` ${to} is not above \`from\` ${from}; a lowering needs no entry`);
	if (to !== null) {
		if (!Number.isInteger(measured) || measured > to || (from !== null && measured <= from))
			problems.push(
				`${at}: \`measured\` must be what the step measured, above \`from\` and at or under \`to\``
			);
	}
	if (typeof reason !== 'string' || reason.trim().length < 20)
		problems.push(`${at}: \`reason\` must say why the step needs it (phase 0's 8.1)`);
	const [path, anchor] = typeof amendment === 'string' ? amendment.split('#') : [];
	const file =
		typeof path === 'string' && path.startsWith(SPECIFICATIONS) && path.endsWith('.md')
			? readRepoFile(path)
			: null;
	const text = file !== null && anchor ? sectionText(file, anchor) : null;
	if (text === null)
		problems.push(
			`${at}: \`amendment\` must be \`<a specification under ${SPECIFICATIONS}>#<a heading's anchor in it>\` that exists`
		);
	else {
		if (!text.includes(row))
			problems.push(`${at}: ${path}#${anchor} does not name the row \`${row}\``);
		if (to !== null && !text.includes(to.toLocaleString('en-US')))
			problems.push(
				`${at}: ${path}#${anchor} does not record the new ceiling ${to.toLocaleString('en-US')}`
			);
	}
	if (approvedBy !== 'coordinator' && approvedBy !== 'owner')
		problems.push(
			`${at}: \`approvedBy\` is 'coordinator' or 'owner' (phase 3's 13, phase 0's 8.1)`
		);
	const decision = typeof approval === 'string' && /^D\d+$/.test(approval);
	if (!(typeof approval === 'string' && APPROVAL_LINK.test(approval)) && !decision)
		problems.push(
			`${at}: \`approval\` links the issue or pull request comment, or names a decision`
		);
	else if (decision && !decisionRow(decisions, approval)?.includes(row))
		problems.push(
			`${at}: \`approval\` names ${approval}, which ${DECISIONS} does not hold as a decision naming \`${row}\``
		);
	if (!isDate(approvedOn) || approvedOn > today)
		problems.push(`${at}: \`approvedOn\` is the approval's date, YYYY-MM-DD, not after today`);
	return problems;
}

/**
 * The whole check, on what it is given. `readBase(file)` returns the base's text of a source, `null` when the base
 * lacks the file, and throws when there is no base to read.
 * @returns {{ state: 'inert' | 'within' | 'checked', notes: string[], failures: string[] }}
 */
export function checkCeilingRaises({
	endsOn,
	amendments,
	today,
	decisions,
	readRepoFile,
	readHead,
	readBase,
	sources = SOURCES,
}) {
	const failures = [...checkEndDate(endsOn, decisions)];
	// The base's date, read whatever this tree says, so unsetting it here cannot switch the check off.
	const baseAmendments = readBase(AMENDMENTS_FILE);
	const baseDate = baseAmendments === null ? { endsOn: null } : parseEndDate(baseAmendments);
	if ('error' in baseDate) failures.push(`${AMENDMENTS_FILE} on the base: ${baseDate.error}`);
	else failures.push(...checkEndDateChange(baseDate.endsOn, endsOn, decisions));
	const seen = new Set();
	for (const entry of amendments) {
		failures.push(...checkAmendment(entry, { readRepoFile, decisions, today }));
		const key = JSON.stringify([entry?.row, entry?.from, entry?.to]);
		if (seen.has(key)) failures.push(`CEILING_AMENDMENTS holds ${key} twice`);
		seen.add(key);
	}
	if (endsOn === null)
		return {
			state: 'inert',
			notes: [
				"inert: D115's end date is not set (D115_ENDS_ON is null until the owner names it and D161 records it), so no ceiling change is checked",
			],
			failures,
		};
	if (today <= endsOn)
		return {
			state: 'within',
			notes: [
				`D115 holds until the end of ${endsOn} (UTC); today is ${today}, so no ceiling change is checked`,
			],
			failures,
		};
	const notes = [
		`D115 ended on ${endsOn}: every ceiling raised, added or removed needs its amendment`,
	];
	const base = {};
	const head = {};
	for (const { file, name } of sources) {
		const headText = readHead(file);
		const parsedHead =
			headText === null ? { error: `${file} is missing` } : parseCeilings(headText, name);
		if ('error' in parsedHead) {
			failures.push(`${file}: ${parsedHead.error}`);
			continue;
		}
		const baseText = readBase(file);
		const parsedBase = baseText === null ? { rows: {} } : parseCeilings(baseText, name);
		if ('error' in parsedBase) {
			failures.push(`${file} on the base: ${parsedBase.error}`);
			continue;
		}
		for (const [into, rows] of [
			[head, parsedHead.rows],
			[base, parsedBase.rows],
		])
			for (const [row, value] of Object.entries(rows)) {
				if (Object.hasOwn(into, row))
					failures.push(`${file}: \`${row}\` is a row of another source too`);
				into[row] = value;
			}
	}
	const changes = ceilingChanges(base, head);
	for (const change of changes) {
		const what =
			change.from === null
				? `adds \`${change.row}\` at ${change.to}`
				: change.to === null
					? `removes \`${change.row}\` (${change.from})`
					: `raises \`${change.row}\` from ${change.from} to ${change.to}`;
		const entry = coveringEntries(amendments, change);
		if (!entry)
			failures.push(
				`this change ${what} after D115 ended (${endsOn}) with no CEILING_AMENDMENTS entry: record the amendment with its reason, approved by the coordinator or the owner (phase 0's 8.1, phase 2's 2.4, phase 3's 13), or move code out instead`
			);
		else
			for (const step of entry)
				notes.push(
					`${what}: amended in ${step.amendment}, approved by the ${step.approvedBy} (${step.approval})`
				);
	}
	if (changes.length === 0) notes.push('no ceiling is raised, added or removed');
	return { state: 'checked', notes, failures };
}

/**
 * The entries that take `change.row` from `change.from` to `change.to`: one, or a chain when one run compares
 * several merged pull requests (a push of the queue's group), each raising it in turn. `null` when none does.
 */
export function coveringEntries(amendments, { row, from, to }) {
	const steps = amendments.filter((entry) => entry?.row === row);
	const walk = (at, used) => {
		for (const step of steps) {
			if (used.includes(step) || step.from !== at) continue;
			if (step.to === to) return [...used, step];
			if (step.to !== null && (to === null || step.to < to)) {
				const found = walk(step.to, [...used, step]);
				if (found) return found;
			}
		}
		return null;
	};
	return walk(from, []);
}

// A hook exports GIT_DIR and its relatives, which would point git at another repository than `cwd`'s.
// No terminal prompt: a fetch that needs credentials fails instead of waiting.
const GIT_ENV = () => ({
	...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
	GIT_TERMINAL_PROMPT: '0',
});

const git = (args, cwd) =>
	execFileSync('git', args, {
		cwd,
		env: GIT_ENV(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 1e8,
	});

/** The base commit to compare with, or `null` with the reason. */
export function resolveBase({ argv = process.argv, env = process.env, cwd = REPO_ROOT } = {}) {
	const flag = argv.indexOf('--base');
	const given = flag >= 0 ? argv[flag + 1] : env.AFD_BASE;
	const event =
		env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)
			? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
			: {};
	let ref = given || null;
	if (!ref && env.GITHUB_ACTIONS === 'true') {
		if (env.GITHUB_EVENT_NAME === 'pull_request') {
			// The checkout is the merge commit; a shallow clone grafts away its parents, but the object names them.
			// Anything but a two-parent merge falls back to the event's base.
			const parents = [
				...git(['cat-file', '-p', 'HEAD'], cwd).matchAll(/^parent ([0-9a-f]{40})$/gm),
			];
			ref = parents.length === 2 ? parents[0][1] : (event.pull_request?.base?.sha ?? null);
		} else if (env.GITHUB_EVENT_NAME === 'merge_group') ref = event.merge_group?.base_sha ?? null;
		else if (env.GITHUB_EVENT_NAME === 'push' && !/^0+$/.test(event.before ?? '0'))
			ref = event.before;
		if (!ref)
			return { sha: null, reason: `a ${env.GITHUB_EVENT_NAME} run has no base to compare with` };
	}
	if (!ref) {
		try {
			ref = git(['merge-base', 'HEAD', 'origin/main'], cwd).trim();
		} catch {
			return { sha: null, reason: 'no merge base with origin/main (fetch it, or pass --base)' };
		}
	}
	try {
		git(['cat-file', '-e', `${ref}^{commit}`], cwd);
	} catch {
		// A depth-1 fetch makes a full clone shallow (and a worktree's, for every worktree): only on CI's checkout
		// or in a clone that is shallow already.
		const shallow = git(['rev-parse', '--is-shallow-repository'], cwd).trim() === 'true';
		if (env.GITHUB_ACTIONS !== 'true' && !shallow)
			return {
				sha: null,
				reason: `the base ${ref} is not in this clone: fetch it, then run again`,
			};
		try {
			git(['fetch', '--no-tags', '--depth=1', 'origin', ref], cwd);
		} catch {
			return { sha: null, reason: `the base ${ref} could not be read or fetched` };
		}
	}
	return { sha: git(['rev-parse', `${ref}^{commit}`], cwd).trim(), reason: null };
}

/** Runs the check on this repository and prints it; returns the number of failures. */
export function runCeilingRaiseCheck({
	argv = process.argv,
	env = process.env,
	cwd = REPO_ROOT,
	endsOn = D115_ENDS_ON,
	amendments = CEILING_AMENDMENTS,
	today = new Date().toISOString().slice(0, 10),
	log = console.log,
	error = console.error,
} = {}) {
	const readRepoFile = (path) => {
		const full = join(cwd, path);
		return existsSync(full) ? readFileSync(full, 'utf8') : null;
	};
	let base;
	const readBase = (file) => {
		base ??= resolveBase({ argv, env, cwd });
		if (base.sha === null) throw new Error(base.reason);
		// The base has no such file: a source this change adds. Any other failure throws.
		if (git(['ls-tree', base.sha, '--', file], cwd).trim() === '') return null;
		return git(['show', `${base.sha}:${file}`], cwd);
	};
	let result;
	try {
		result = checkCeilingRaises({
			endsOn,
			amendments,
			today,
			decisions: readRepoFile(DECISIONS) ?? '',
			readRepoFile,
			readHead: readRepoFile,
			readBase,
		});
	} catch (failure) {
		const manual =
			env.GITHUB_EVENT_NAME === 'workflow_dispatch' || env.GITHUB_EVENT_NAME === 'schedule';
		if (manual || env.CI !== 'true') {
			log(
				`ceiling-raises: not checked: ${failure.message}${manual ? ' (a manual run compares nothing)' : ''}`
			);
			return 0;
		}
		error(`ceiling-raises: ${failure.message}; under CI the check needs a base to compare with`);
		return 1;
	}
	for (const note of result.notes) log(`ceiling-raises: ${note}`);
	for (const failure of result.failures) error(`ceiling-raises: ${failure}`);
	return result.failures.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	process.exitCode = runCeilingRaiseCheck() > 0 ? 1 : 0;
