#!/usr/bin/env node
/**
 * Doc line guard: no line in a shared status document grows without bound.
 *
 * A table cell or sentence that every pull request adds to is one line that every open branch
 * edits, so each merge to `main` puts the others in conflict. Loam's decision-log cell reached
 * 2,049 characters and the parity page's "Updated" cell 2,126 that way
 * (docs/features/active/merge-conflicts/). Such a line names no entry, or only the latest, and
 * links to the rest; this check refuses one that grows back.
 *
 * Policy: scripts/policy/doc-line-limits.json
 *   limit          the longest line allowed, in characters
 *   files          the documents checked, relative to the repository root
 *   capped         summary lines held below the limit, since most of them were a problem well
 *                  before reaching it: `file`, `startsWith` (a prefix matching exactly that one
 *                  line), `max` and `reason`
 *   grandfathered  lines already over the limit when their document joined the check: `file`,
 *                  `startsWith`, `length`, `sha256` of the line's text and `reason`
 *
 * A grandfathered line is frozen: it stays exactly as recorded, or it gets shorter (record its new
 * `length` and `sha256`), and its entry fails once the line is gone or within the limit.
 *
 * The policy only tightens. It is compared with the policy at the merge base with `origin/main`
 * (AFD_BASE overrides the ref, as in scripts/affected.mjs): the limit and a cap may not rise, a
 * document may not leave `files` nor a cap its line while they exist, a grandfathered line may
 * change only by getting shorter, and one may be added only for a document new to `files` or a
 * line a lowered limit newly covers. Without a base to read (no git, no such ref) the comparison
 * is skipped with a note, except under CI, where it fails.
 *
 * Usage: node scripts/check-doc-lines.mjs [--policy <path>]   (paths resolve from the cwd)
 * Exit code 1 = violations found, each printed as file:line.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const policyAt = args.indexOf('--policy');
const policyPath = policyAt >= 0 ? args[policyAt + 1] : 'scripts/policy/doc-line-limits.json';

const problems = [];
const fail = (message) => problems.push(message);

/** Line lengths count characters, not UTF-16 units, so an emoji is one. */
const lengthOf = (line) => [...line].length;
const digestOf = (line) => createHash('sha256').update(line, 'utf8').digest('hex');
const isList = (value) => Array.isArray(value);

function readPolicy() {
	if (!policyPath || !existsSync(resolve(policyPath))) {
		fail(`${policyPath ?? '--policy'}: the policy file is missing`);
		return null;
	}
	let policy;
	try {
		policy = JSON.parse(readFileSync(resolve(policyPath), 'utf8'));
	} catch (error) {
		fail(`${policyPath}: not JSON (${error.message})`);
		return null;
	}
	if (!Number.isInteger(policy.limit) || policy.limit < 1)
		fail(`${policyPath}: "limit" must be a positive whole number`);
	if (!isList(policy.files) || policy.files.length === 0)
		fail(`${policyPath}: "files" must list at least one document`);
	if (!isList(policy.capped))
		fail(`${policyPath}: "capped" must be a list (empty when no line has its own cap)`);
	if (!isList(policy.grandfathered))
		fail(`${policyPath}: "grandfathered" must be a list (empty when no line is exempt)`);
	if (problems.length > 0) return null;

	for (const [kind, entries] of [
		['capped', policy.capped],
		['grandfathered', policy.grandfathered],
	])
		for (const entry of entries) {
			const where = `${policyPath}: ${kind} ${JSON.stringify(entry?.startsWith ?? entry)}`;
			if (
				typeof entry?.file !== 'string' ||
				typeof entry.startsWith !== 'string' ||
				!entry.startsWith
			)
				fail(`${where}: needs "file" and a non-empty "startsWith"`);
			else if (!policy.files.includes(entry.file))
				fail(`${where}: ${entry.file} is not one of "files"; delete the entry`);
			if (typeof entry?.reason !== 'string' || !entry.reason.trim())
				fail(`${where}: needs a "reason"`);
			if (kind === 'capped') {
				if (!Number.isInteger(entry?.max) || entry.max < 1)
					fail(`${where}: needs a whole-number "max"`);
				else if (entry.max >= policy.limit)
					fail(`${where}: its "max" of ${entry.max} is not below the limit of ${policy.limit}`);
			} else {
				if (!Number.isInteger(entry?.length)) fail(`${where}: needs a whole-number "length"`);
				if (typeof entry?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256))
					fail(`${where}: needs the "sha256" of its line's text`);
			}
		}
	return problems.length === 0 ? policy : null;
}

function check(policy) {
	const { limit } = policy;
	for (const file of policy.files) {
		if (!existsSync(resolve(file))) {
			fail(`${file}: listed in ${policyPath} but missing; fix the path or remove it`);
			continue;
		}
		const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/);
		if (lines.every((line) => line.trim() === '')) {
			fail(`${file}: empty, so nothing was checked`);
			continue;
		}

		/** The one line each entry names, by index; an entry naming none or several fails. */
		const claimed = new Map();
		const locate = (entry, kind) => {
			const hits = lines.flatMap((line, i) => (line.startsWith(entry.startsWith) ? [i] : []));
			const name = JSON.stringify(entry.startsWith);
			if (hits.length === 0) {
				fail(`${file}: no line starts with ${name}; delete its ${kind} entry`);
				return -1;
			}
			if (hits.length > 1) {
				fail(
					`${file}: ${hits.length} lines start with ${name} (lines ${hits.map((i) => i + 1).join(', ')}); lengthen "startsWith" until it matches one`
				);
				return -1;
			}
			if (claimed.has(hits[0])) {
				fail(`${file}:${hits[0] + 1}: two policy entries match this line; delete one`);
				return -1;
			}
			claimed.set(hits[0], kind);
			return hits[0];
		};

		for (const entry of policy.capped.filter((each) => each.file === file)) {
			const index = locate(entry, 'capped');
			if (index < 0) continue;
			const length = lengthOf(lines[index]);
			if (length > entry.max)
				fail(
					`${file}:${index + 1}: ${length} characters, over this line's cap of ${entry.max}. It is a summary: name no entry, or only the latest, and link to the rest. A line every pull request edits conflicts with every open branch`
				);
		}

		for (const entry of policy.grandfathered.filter((each) => each.file === file)) {
			const index = locate(entry, 'grandfathered');
			if (index < 0) continue;
			const name = JSON.stringify(entry.startsWith);
			const length = lengthOf(lines[index]);
			const digest = digestOf(lines[index]);
			if (length <= limit)
				fail(
					`${file}:${index + 1}: now ${length} characters, within the limit of ${limit}; delete its grandfathered entry (${name})`
				);
			else if (length > entry.length)
				fail(
					`${file}:${index + 1}: a grandfathered line grew from ${entry.length} to ${length} characters. Put the new text on its own line and leave this one as it was`
				);
			else if (length < entry.length)
				fail(
					`${file}:${index + 1}: a grandfathered line shrank from ${entry.length} to ${length} characters; in ${policyPath} set its "length" to ${length} and its "sha256" to ${digest}`
				);
			else if (digest !== entry.sha256)
				fail(
					`${file}:${index + 1}: a grandfathered line was rewritten at the same length (${length}). It is frozen: restore it, or shorten it and record its new "length" and "sha256" (now ${digest})`
				);
		}

		for (const [index, line] of lines.entries()) {
			if (claimed.has(index)) continue;
			const length = lengthOf(line);
			if (length > limit)
				fail(
					`${file}:${index + 1}: ${length} characters, over the limit of ${limit}. A line every pull request adds to conflicts with every open branch: name only the latest entry and link to the rest, or give the new entry its own line`
				);
		}
	}
}

/** The policy at the merge base: `null` when it did not exist there, or why it is unread. */
function basePolicy() {
	const git = (gitArgs) =>
		execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	let top;
	try {
		top = git(['rev-parse', '--show-toplevel']).trim();
	} catch {
		return { unread: 'not a git repository' };
	}
	const refs = [process.env.AFD_BASE, 'origin/main', 'main'].filter(
		(ref) => ref && !/^0+$/.test(ref)
	);
	let base = null;
	for (const ref of refs) {
		try {
			base = git(['merge-base', ref, 'HEAD']).trim();
			break;
		} catch {}
	}
	if (!base) return { unread: `none of ${refs.join(', ')} has a merge base with HEAD` };
	const path = relative(resolve(top), resolve(policyPath)).split(sep).join('/');
	try {
		git(['cat-file', '-e', `${base}:${path}`]);
	} catch {
		return { base, policy: null };
	}
	try {
		return { base, policy: JSON.parse(git(['show', `${base}:${path}`])) };
	} catch (error) {
		return { unread: `${path} at ${base.slice(0, 8)} is not JSON (${error.message})` };
	}
}

/** Refuses a policy looser than the merge base's: this is what keeps the exemptions shrinking. */
function checkTightens(policy) {
	const found = basePolicy();
	if (found.unread) {
		const note = `the policy was not compared with its merge base: ${found.unread}`;
		if (process.env.CI) fail(`${policyPath}: ${note}`);
		else console.log(`check-doc-lines: note: ${note}`);
		return;
	}
	const before = found.policy;
	if (!before || !isList(before.files)) return;
	const at = `the merge base ${found.base.slice(0, 8)}`;
	if (Number.isInteger(before.limit) && policy.limit > before.limit)
		fail(
			`${policyPath}: "limit" rose from ${before.limit} to ${policy.limit} since ${at}; it only comes down`
		);
	for (const file of before.files)
		if (!policy.files.includes(file) && existsSync(resolve(file)))
			fail(`${policyPath}: ${file} left "files" since ${at} but still exists; list it again`);

	for (const old of isList(before.capped) ? before.capped : []) {
		if (!policy.files.includes(old.file) || !existsSync(resolve(old.file))) continue;
		const name = JSON.stringify(old.startsWith);
		const now = policy.capped.find(
			(entry) => entry.file === old.file && entry.startsWith === old.startsWith
		);
		if (now && now.max > old.max)
			fail(
				`${policyPath}: the "max" of ${name} rose from ${old.max} to ${now.max} since ${at}. Shorten the line instead: a cap only comes down`
			);
		const lines = readFileSync(resolve(old.file), 'utf8').split(/\r?\n/);
		if (!now && lines.some((line) => line.startsWith(old.startsWith)))
			fail(
				`${policyPath}: the cap on ${name} was removed since ${at} but its line is still in ${old.file}; restore the entry`
			);
	}

	const lowered = Number.isInteger(before.limit) && policy.limit < before.limit;
	const exempt = isList(before.grandfathered) ? before.grandfathered : [];
	for (const file of policy.files) {
		if (!before.files.includes(file)) continue; // A document new to the check brings its own lines.
		const old = exempt.filter((entry) => entry.file === file);
		const known = new Map(old.map((entry) => [entry.startsWith, entry]));
		const now = policy.grandfathered.filter((entry) => entry.file === file);
		// A removed entry may be taken over by one whose line's opening words changed, no longer.
		const freed = old
			.filter((entry) => !now.some((other) => other.startsWith === entry.startsWith))
			.map((entry) => entry.length)
			.sort((a, b) => a - b);
		for (const entry of now) {
			const name = JSON.stringify(entry.startsWith);
			const was = known.get(entry.startsWith);
			if (was) {
				if (entry.length > was.length)
					fail(
						`${policyPath}: the "length" of ${name} rose from ${was.length} to ${entry.length} since ${at}. Shorten the line instead: a grandfathered line never grows`
					);
				else if (entry.sha256 !== was.sha256 && entry.length === was.length)
					fail(
						`${policyPath}: the "sha256" of ${name} changed since ${at} at the same length. A grandfathered line is frozen: restore it or make it shorter`
					);
				continue;
			}
			if (lowered && entry.length <= before.limit) continue; // Newly covered by the lower limit.
			const slot = freed.findIndex((length) => length >= entry.length);
			if (slot >= 0) freed.splice(slot, 1);
			else
				fail(
					`${policyPath}: ${name} was added to "grandfathered" since ${at}. Only lines over the limit when their document joined the check are exempt: shorten the line instead`
				);
		}
	}
}

const policy = readPolicy();
if (policy) check(policy);
if (policy && problems.length === 0) checkTightens(policy);

if (problems.length > 0) {
	for (const problem of problems) console.error(`check-doc-lines: ${problem}`);
	process.exit(1);
}
console.log(
	`check-doc-lines: ${policy.files.length} documents, no line over ${policy.limit} characters (${policy.capped.length} capped lower, ${policy.grandfathered.length} grandfathered)`
);
