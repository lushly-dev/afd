#!/usr/bin/env node
/**
 * Doc line guard: no line in a shared status document grows without bound.
 *
 * A table cell or sentence that every pull request adds to is one line that every open branch
 * edits, so each merge to `main` puts the others in conflict. Loam's decision-log cell reached
 * 2,049 characters and the parity page's "Updated" cell 2,126 that way
 * (docs/features/complete/merge-conflicts/). Such a line names no entry and links to where each has
 * its own line; this check refuses one that grows back, and a line too long to be one entry.
 *
 * Policy: scripts/policy/doc-line-limits.json
 *   limit          the longest line allowed, in characters
 *   files          the documents checked, relative to the repository root
 *   directories    optional: folders whose every `.md` file, directly inside, is checked at the
 *                  limit with no exemption. A log kept as one file per entry (Loam's and Umbel's
 *                  session logs) is listed here, so that a new entry adds a file and not a line to
 *                  this policy, which every such pull request would otherwise edit
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
 * document may not leave `files`, a directory `directories`, nor a cap its line while they exist
 * (a cap goes once the limit is at or below it), a grandfathered line may change only by getting
 * shorter, and one may be added only for a document new to `files` or a line a lowered limit
 * newly covers. An entry whose `startsWith` changed is the same exemption only with the same
 * `sha256`, or a shorter line.
 * Without a base to read (no git, no such ref) the comparison is skipped with a note, except
 * under CI, where it fails. Not seen: a capped row given a new label, whose cap then reads as a
 * line that went away; carry the cap over to the new label.
 *
 * Usage: node scripts/check-doc-lines.mjs [--policy <path>]   (paths resolve from the cwd)
 * Exit code 1 = violations found, each printed as file:line.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
/** A folder's path without trailing slashes; empty for no folder, or the root, which is refused. */
const folderOf = (dir) => dir.replace(/\/+$/, '');

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
	if (
		policy.directories !== undefined &&
		(!isList(policy.directories) ||
			!policy.directories.every((dir) => typeof dir === 'string' && folderOf(dir)))
	)
		fail(`${policyPath}: "directories" must be a list of folder paths when it is present`);
	else if (isList(policy.files))
		// A file of a listed folder named in `files` too could be capped or grandfathered there.
		for (const file of policy.files)
			if (
				typeof file === 'string' &&
				policy.directories?.map(folderOf).includes(file.split('/').slice(0, -1).join('/'))
			)
				fail(
					`${policyPath}: ${file} is in a folder listed in "directories", whose files have no exemption; remove it from "files"`
				);
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

/** The `.md` files directly inside each listed directory, sorted; a missing or empty one fails. */
function directoryFiles(policy) {
	const found = [];
	for (const dir of policy.directories ?? []) {
		const path = folderOf(dir);
		if (!existsSync(resolve(path)) || !statSync(resolve(path)).isDirectory()) {
			fail(
				`${path}: listed in "directories" of ${policyPath} but missing; fix the path or remove it`
			);
			continue;
		}
		const names = readdirSync(resolve(path), { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
			.map((entry) => entry.name)
			.sort();
		if (names.length === 0) fail(`${path}: holds no .md file, so nothing was checked`);
		for (const name of names) {
			const file = `${path}/${name}`;
			if (!found.includes(file)) found.push(file);
		}
	}
	return found;
}

function check(policy, documents) {
	const { limit } = policy;
	for (const file of documents) {
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
					`${file}:${index + 1}: ${length} characters, over this line's cap of ${entry.max}. It is a summary: name no entry, and link to where each has its own line. A line every pull request edits conflicts with every open branch`
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
					`${file}:${index + 1}: ${length} characters, over the limit of ${limit}. A line every pull request adds to conflicts with every open branch: give the new entry its own line, and put a record that needs more room in the specification, linked from its line`
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
	const listed = (policy.directories ?? []).map(folderOf);
	for (const dir of isList(before.directories) ? before.directories : [])
		if (typeof dir === 'string' && !listed.includes(folderOf(dir)) && existsSync(resolve(dir)))
			fail(`${policyPath}: ${dir} left "directories" since ${at} but still exists; list it again`);

	for (const old of isList(before.capped) ? before.capped : []) {
		if (!policy.files.includes(old.file) || !existsSync(resolve(old.file))) continue;
		if (policy.limit <= old.max) continue; // The limit itself now holds the line at least as low.
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
		// A removed entry may be taken over by one whose line's opening words changed: the same
		// text under a new prefix, or a shorter line. Each removed entry is taken over once.
		const freed = old
			.filter((entry) => !now.some((other) => other.startsWith === entry.startsWith))
			.sort((a, b) => a.length - b.length);
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
			const same = freed.findIndex((gone) => gone.sha256 === entry.sha256);
			const slot = same >= 0 ? same : freed.findIndex((gone) => gone.length > entry.length);
			if (slot >= 0) freed.splice(slot, 1);
			else
				fail(
					`${policyPath}: ${name} was added to "grandfathered" since ${at}. Only lines over the limit when their document joined the check are exempt: shorten the line instead`
				);
		}
	}
}

const policy = readPolicy();
const documents = policy ? [...policy.files, ...directoryFiles(policy)] : [];
if (policy) check(policy, documents);
if (policy && problems.length === 0) checkTightens(policy);

if (problems.length > 0) {
	for (const problem of problems) console.error(`check-doc-lines: ${problem}`);
	process.exit(1);
}
console.log(
	`check-doc-lines: ${documents.length} documents${policy.directories?.length ? ` (${documents.length - policy.files.length} in ${policy.directories.length} directories)` : ''}, no line over ${policy.limit} characters (${policy.capped.length} capped lower, ${policy.grandfathered.length} grandfathered)`
);
