/**
 * A record that `pnpm verify` passed on one exact commit, and the rule pre-push accepts it by.
 *
 * `pnpm verify` runs `pnpm check`, which runs every pre-push command and more, then the local
 * suites of each triggered workflow. When it passes in full on a clean checkout, against the
 * default base, it writes this record into the worktree's own git directory, where it cannot be
 * committed. Pre-push (scripts/pre-push.mjs) skips its own commands only when every pushed ref is
 * that commit, its tree and merge base are unchanged, the checkout is still clean and the record
 * is under a day old. Anything else runs pre-push in full. The software factory's merge lane
 * validates each branch this way and then pushes it without running the checks twice.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_BASES } from './affected/scope.mjs';

export const SCHEMA = 1;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CHECK = 'check (ci.yml)';
const ZERO = /^0+$/;

/** Where this worktree keeps its record: inside its git directory, never in the tree. */
export function recordPath(git, root) {
	return resolve(root, git(['rev-parse', '--git-path', 'afd-verify-record.json']).trim());
}

/** The commit, tree, merge base with the default base, and whether the checkout is clean. */
export function currentIdentity(git) {
	let base = null;
	for (const ref of DEFAULT_BASES)
		try {
			base = git(['merge-base', ref, 'HEAD']).trim();
			break;
		} catch {}
	return {
		head: git(['rev-parse', 'HEAD']).trim(),
		tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
		base,
		clean: git(['status', '--porcelain', '--untracked-files=normal']).trim() === '',
	};
}

/** The record for a passing run, or why none may be written. */
export function buildRecord({ before, after, results, scope, defaultBase, now = Date.now() }) {
	if (!defaultBase) return { reason: 'verify ran against a base other than the default' };
	if (!before.clean) return { reason: 'the checkout had uncommitted changes when verify started' };
	if (!after.clean || after.head !== before.head || after.tree !== before.tree)
		return { reason: 'the checkout changed while verify ran' };
	if (!before.base) return { reason: 'there is no default base to bind the record to' };
	if (!results.some((result) => result.name === CHECK))
		return { reason: 'verify skipped pnpm check' };
	if (results.some((result) => !result.ok)) return { reason: 'a verify step failed' };
	return {
		record: {
			schema: SCHEMA,
			head: before.head,
			tree: before.tree,
			base: before.base,
			scope,
			results: results.map(({ name, ok }) => ({ name, ok })),
			finishedAt: new Date(now).toISOString(),
		},
	};
}

export function writeRecord(path, record) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(record, null, '\t')}\n`);
	renameSync(temporary, path);
}

export function readRecord(path) {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Whether pre-push may accept the record for this push.
 * @param {string} updates git's pre-push input: `<local ref> <local sha> <remote ref> <remote sha>` lines
 */
export function acceptRecord({
	record,
	identity,
	updates,
	now = Date.now(),
	maxAgeMs = MAX_AGE_MS,
}) {
	const reject = (reason) => ({ accepted: false, reason });
	const pushed = updates
		.split('\n')
		.map((line) => line.trim().split(/\s+/))
		.filter((fields) => fields.length === 4);
	if (pushed.length === 0) return reject('git named no ref being pushed');
	for (const [localRef, sha] of pushed) {
		if (ZERO.test(sha)) continue; // a deletion pushes no commit
		if (sha !== identity.head) return reject(`${localRef} is not the checked-out commit`);
	}
	if (!record) return reject('no verify record');
	if (record.schema !== SCHEMA) return reject('the verify record has another schema');
	if (record.head !== identity.head) return reject('the verify record is for another commit');
	if (record.tree !== identity.tree) return reject('the verify record is for another tree');
	if (!identity.clean) return reject('the checkout has uncommitted changes');
	if (!identity.base || record.base !== identity.base)
		return reject('the merge base with origin/main moved since verify');
	const age = now - Date.parse(record.finishedAt);
	if (!(age >= 0 && age <= maxAgeMs)) return reject('the verify record is over a day old');
	if (!record.results?.some((result) => result.name === CHECK && result.ok))
		return reject('the verify record does not cover pnpm check');
	if (record.results.some((result) => !result.ok)) return reject('the verify record has a failure');
	return { accepted: true, reason: `pnpm verify passed on ${record.head} at ${record.finishedAt}` };
}
