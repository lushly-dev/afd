#!/usr/bin/env node
/**
 * Merges the latest `main` into the current branch, resolving provenance-record conflicts.
 *
 *   pnpm base:sync
 *
 * It fetches `main` into `origin/main` with an explicit refspec, so the shared tracking ref is
 * proven to have moved, and merges that SHA (never `git pull`). Any edit to an imported unit
 * changes its provenance records. No unit commits a hash line that every edit rewrites (#1610), so
 * two branches that edit different files of one conflict only where their rows neighbour each
 * other. When every conflict is a record,
 * `scripts/provenance-merge.mjs` merges them and this concludes the merge. When other paths
 * conflict too it leaves the merge open and names them: resolve and stage those, then run it
 * again, and it merges the records and concludes. A real record conflict, one the provenance merge
 * refuses, is left open with its reason.
 *
 * It refuses uncommitted changes, untracked files included (set them aside with a WIP commit,
 * never `git stash`: worktrees share one stash stack), and an in-progress rebase, `git am`,
 * cherry-pick or revert. It finishes only an open merge of the base it merged (remembered in the
 * worktree's git directory) or of the current `origin/main`. It never resets, aborts, stashes or
 * pushes. Exit 0 means the merge is concluded or there was nothing to merge.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordConflict, resolve, UNITS, unitOf } from './provenance-merge.mjs';

export const REFSPEC = '+refs/heads/main:refs/remotes/origin/main';
const BASE = 'refs/remotes/origin/main';
/** The open merge this command started, in the worktree's own git directory. */
const STATE = 'afd-base-sync.json';
const RECORD_DIRS = UNITS.flatMap((unit) => [unit.dir, unit.mirror].filter(Boolean));

/** Each unit's provenance test, keyed by its records' directory (see `UNITS`). */
export const PROVENANCE_TESTS = {
	'foundations/fast-af/provenance': 'node --test scripts/fast-af-provenance.test.mjs',
	'foundations/specimen/provenance': 'node --test scripts/specimen-provenance.test.mjs',
	'foundations/violet/provenance': 'node --test scripts/violet-provenance.test.mjs',
	'endpoints/botcore/provenance':
		'uv --directory endpoints/botcore run --frozen pytest tests/test_provenance.py -q',
};

/** Why base:sync stopped without concluding; `lines` say what to do. */
export class SyncStop extends Error {
	constructor(lines) {
		super(lines[0]);
		this.lines = lines;
	}
}

const short = (sha) => sha.slice(0, 12);
const list = (text) => text.split('\n').filter(Boolean);
const paths = (n) => `${n} ${n === 1 ? 'path' : 'paths'}`;
const AGAIN = 'then run pnpm base:sync again';

/**
 * Syncs the checkout at `root`; `git(args)` runs git there and throws on a non-zero exit. Returns
 * the report's lines, or throws SyncStop with them.
 */
export function baseSync(git, root) {
	const succeeds = (args) => {
		try {
			git(args);
			return true;
		} catch {
			return false;
		}
	};
	const rev = (ref) => {
		try {
			return git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]).trim();
		} catch {
			return null;
		}
	};
	const gitPath = (name) => resolvePath(root, git(['rev-parse', '--git-path', name]).trim());
	const state = {
		read() {
			try {
				return JSON.parse(readFileSync(gitPath(STATE), 'utf8'));
			} catch {
				return null;
			}
		},
		write(value) {
			writeFileSync(gitPath(STATE), `${JSON.stringify(value)}\n`);
		},
		clear() {
			rmSync(gitPath(STATE), { force: true });
		},
	};

	for (const [path, what] of [
		['rebase-merge', 'a rebase'],
		['rebase-apply', 'a rebase or git am'],
		['sequencer', 'a cherry-pick or revert sequence'],
	])
		if (existsSync(gitPath(path)))
			throw new SyncStop([`${what} is in progress: finish it (or abort it yourself), ${AGAIN}`]);
	for (const [head, what] of [
		['CHERRY_PICK_HEAD', 'a cherry-pick'],
		['REVERT_HEAD', 'a revert'],
	])
		if (rev(head))
			throw new SyncStop([`${what} is in progress: finish it (or abort it yourself), ${AGAIN}`]);

	const before = rev('HEAD');
	if (!before) throw new SyncStop(['the branch has no commit to merge into']);
	const open = rev('MERGE_HEAD');
	if (open) {
		const base = rev(BASE);
		const started = state.read();
		if (open !== base && open !== started?.base)
			throw new SyncStop([
				`an open merge of ${short(open)} is in progress, and it is not of origin/main (${base ? short(base) : 'not fetched'}): finish it yourself`,
			]);
		const lines = [
			`finishing the open merge of ${open}${
				base && base !== open
					? ` (origin/main has since moved to ${short(base)}: run pnpm base:sync again afterwards)`
					: ''
			}`,
		];
		return [...lines, ...conclude(open, lines)];
	}

	const dirty = list(git(['status', '--porcelain', '--untracked-files=normal']));
	if (dirty.length)
		throw new SyncStop([
			`the tree has uncommitted changes or untracked files (${paths(dirty.length)}): set them aside with a WIP commit, never git stash, ${AGAIN}`,
		]);
	state.clear(); // A record of a merge that is no longer open.

	const previous = rev(BASE);
	try {
		git(['fetch', '--quiet', 'origin', REFSPEC]);
	} catch {
		try {
			git(['fetch', '--quiet', 'origin', REFSPEC]); // Once more, for a ref-lock race.
		} catch (error) {
			throw new SyncStop([`could not fetch main: ${firstLine(error)}`]);
		}
	}
	const base = rev(BASE);
	const lines = [
		`origin/main @ ${base} (${
			previous === base
				? 'unchanged since the last fetch'
				: `moved from ${previous ? short(previous) : 'no earlier fetch'}`
		})`,
	];
	if (succeeds(['merge-base', '--is-ancestor', base, 'HEAD']))
		return [...lines, 'already up to date: nothing to merge'];
	try {
		// --commit overrides a configured --no-commit, so a clean merge is concluded here.
		git(['merge', '--no-edit', '--commit', base]);
	} catch (error) {
		if (!rev('MERGE_HEAD'))
			throw new SyncStop([...lines, `git merge refused: ${firstLine(error)}`]);
		state.write({ base });
		if (unmergedPaths().length === 0)
			throw new SyncStop([
				...lines,
				`the merge of ${short(base)} is open: git merge stopped without a conflict`,
				...tail(error),
				`fix that, ${AGAIN} to conclude`,
			]);
		return [...lines, ...conclude(base, lines)];
	}
	settled(base, lines);
	return [...lines, ...merged(before, base, [])];

	function unmergedPaths() {
		return list(git(['diff', '--name-only', '--diff-filter=U']));
	}

	/** Every record's index entry: its blob, or `U` while it is unmerged. */
	function recordIndex() {
		const index = {};
		for (const line of list(git(['ls-files', '-s', '--', ...RECORD_DIRS]))) {
			const [meta, path] = line.split('\t');
			const [, blob, stage] = meta.split(' ');
			if (unitOf(path)) index[path] = stage === '0' ? blob : 'U';
		}
		return index;
	}

	/** Every record as git's own merge of HEAD and `mergeHead` left it, in `recordIndex`'s form. */
	function gitMerged(mergeHead) {
		let output;
		try {
			output = git(['merge-tree', '--write-tree', '--name-only', 'HEAD', mergeHead]);
		} catch (error) {
			if (error.status !== 1 || !error.stdout) throw error; // 1: the merge conflicts.
			output = error.stdout;
		}
		const [tree, ...rest] = output.split('\n');
		const conflicted = new Set(rest.slice(0, rest.indexOf('')));
		const index = {};
		for (const line of list(git(['ls-tree', '-r', tree.trim(), '--', ...RECORD_DIRS]))) {
			const [meta, path] = line.split('\t');
			if (unitOf(path)) index[path] = meta.split(' ')[2];
		}
		for (const path of conflicted) if (unitOf(path)) index[path] = 'U';
		return index;
	}

	/** Stops unless HEAD now holds `mergeHead` with no merge open. */
	function settled(mergeHead, lines) {
		if (rev('MERGE_HEAD') || !succeeds(['merge-base', '--is-ancestor', mergeHead, 'HEAD'])) {
			if (rev('MERGE_HEAD')) state.write({ base: mergeHead });
			throw new SyncStop([
				...lines,
				`git returned without concluding the merge of ${short(mergeHead)}: check merge settings in git config, ${AGAIN}`,
			]);
		}
		state.clear();
	}

	/** Resolves the open merge's records and commits it, or throws SyncStop leaving it open. */
	function conclude(mergeHead, lines) {
		const unmerged = unmergedPaths();
		const records = unmerged.filter((path) => unitOf(path));
		const others = unmerged.filter((path) => !unitOf(path));
		if (others.length)
			throw new SyncStop([
				...lines,
				`the merge of ${short(mergeHead)} is open: ${paths(others.length)} conflict outside the provenance records`,
				...others.map((path) => `  unmerged: ${path}`),
				...records.map((path) => `  unmerged record (merged by the next run): ${path}`),
				`resolve and stage only those paths, ${AGAIN} to merge the records and conclude`,
			]);
		const unmergedSet = new Set(unmerged);
		const unstaged = list(git(['diff', '--name-only'])).filter((path) => !unmergedSet.has(path));
		if (unstaged.length)
			throw new SyncStop([
				...lines,
				`the merge of ${short(mergeHead)} is open with unstaged changes: stage them, ${AGAIN}`,
				...unstaged.map((path) => `  unstaged: ${path}`),
			]);
		let written = [];
		if (records.length) {
			// The provenance merge rewrites every record of a unit with an unmerged one, so a record of
			// that unit staged by hand since git merged would be replaced. What git merged is recomputed
			// rather than remembered, so this holds for a merge another tool left open too.
			const open = new Set(records.map((path) => unitOf(path).unit));
			const now = recordIndex();
			const replaced = Object.entries(gitMerged(mergeHead))
				.filter(([path, was]) => open.has(unitOf(path).unit) && now[path] !== was)
				.map(([path]) => path);
			if (replaced.length)
				throw new SyncStop([
					...lines,
					`the merge of ${short(mergeHead)} is open: records staged by hand while others of their unit are still unmerged`,
					...replaced.map((path) => `  staged by hand: ${path}`),
					...records.map((path) => `  unmerged record: ${path}`),
					`resolve and stage that unit's other records by hand too, or restore the conflict with git checkout -m -- <path>, ${AGAIN}`,
				]);
			try {
				written = resolve(git, root);
			} catch (error) {
				if (!(error instanceof RecordConflict)) throw error;
				throw new SyncStop([
					...lines,
					`the merge of ${short(mergeHead)} is open: the provenance merge refused: ${error.message}`,
					...records.map((path) => `  unmerged record: ${path}`),
					`record that file again with its unit's recorder, stage the records, ${AGAIN}`,
				]);
			}
		}
		const broken = list(git(['diff', '--cached', '--name-only', '--diff-filter=d', 'HEAD'])).filter(
			(path) => {
				if (!unitOf(path)) return false;
				try {
					JSON.parse(git(['show', `:${path}`]));
					return false;
				} catch {
					return true;
				}
			}
		);
		if (broken.length)
			throw new SyncStop([
				...lines,
				`the merge of ${short(mergeHead)} is open: staged records are not valid JSON (conflict markers?)`,
				...broken.map((path) => `  invalid: ${path}`),
				`restore the conflict with git checkout -m -- <path> (or fix and stage it), ${AGAIN}`,
			]);
		const report = merged(before, mergeHead, written, true);
		try {
			git(['commit', '--no-edit']);
		} catch (error) {
			throw new SyncStop([
				...lines,
				`the merge of ${short(mergeHead)} is resolved and staged, but its commit failed`,
				...tail(error),
				...report.slice(1),
				`fix that, ${AGAIN} to conclude`,
			]);
		}
		settled(mergeHead, lines);
		return merged(before, mergeHead, written);
	}

	/**
	 * The report for merging `mergeHead` into `from`. Each unit whose records both sides changed
	 * needs its provenance test, however they were merged.
	 */
	function merged(from, mergeHead, written, pending = false) {
		const after = rev('HEAD');
		const out = [
			pending || after !== from
				? `merged into ${git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()} @ ${short(after)}`
				: 'nothing merged',
		];
		if (written.length) out.push(`merged the provenance records ${written.join(', ')}`);
		const fork = git(['merge-base', from, mergeHead]).trim();
		const changed = (to) =>
			new Set(
				list(git(['diff', '--name-only', fork, to]))
					.map((path) => unitOf(path)?.unit.dir)
					.filter(Boolean)
			);
		const theirs = changed(mergeHead);
		const units = new Set([
			...[...changed(from)].filter((dir) => theirs.has(dir)),
			...written.map((path) => unitOf(path).unit.dir),
		]);
		for (const dir of units)
			out.push(`both sides changed ${dir}: run its provenance test: ${PROVENANCE_TESTS[dir]}`);
		const lockfile = pending
			? !succeeds(['diff', '--cached', '--quiet', from, '--', 'pnpm-lock.yaml'])
			: !succeeds(['diff', '--quiet', from, 'HEAD', '--', 'pnpm-lock.yaml']);
		if (lockfile) out.push('pnpm-lock.yaml changed: run pnpm install --frozen-lockfile');
		return out;
	}
}

function firstLine(error) {
	return String(error.stderr || error.message || error)
		.trim()
		.split('\n')[0];
}

/** The last lines a failed git command (or its hook) printed, indented. */
function tail(error, count = 8) {
	const lines = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean);
	return (lines.length ? lines : [firstLine(error)]).slice(-count).map((line) => `  ${line}`);
}

function isEntry() {
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (process.argv[1] && isEntry()) {
	const git = (args, cwd) =>
		execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 64 * 1024 * 1024,
		});
	try {
		const root = git(['rev-parse', '--show-toplevel']).trim();
		for (const line of baseSync((args) => git(args, root), root)) console.log(`base-sync: ${line}`);
	} catch (error) {
		const lines = error instanceof SyncStop ? error.lines : [firstLine(error)];
		for (const line of lines) console.error(`base-sync: ${line}`);
		process.exitCode = 1;
	}
}
