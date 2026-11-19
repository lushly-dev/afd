#!/usr/bin/env node
/**
 * Merges the latest `main` into the current branch, resolving provenance-record conflicts.
 *
 *   pnpm base:sync
 *
 * It fetches `main` into `origin/main` with an explicit refspec, so the shared tracking ref is
 * proven to have moved, and merges that SHA (never `git pull`). Any edit to an imported unit
 * changes its provenance records' shared hash lines, so two branches that edit different files of
 * one unit always conflict there; when every conflict is a record, `scripts/provenance-merge.mjs`
 * merges them and this concludes the merge. When other paths conflict too it leaves the merge
 * open and names them: resolve and stage those, then run it again, and it merges the records and
 * concludes. A real record conflict, one the provenance merge refuses, is left open with its
 * reason.
 *
 * It refuses tracked changes (set them aside with a WIP commit, never `git stash`: worktrees share
 * one stash stack) and an in-progress rebase, cherry-pick or revert, and it finishes only an open
 * merge of `origin/main`. It never resets, aborts, stashes or pushes. Exit 0 means the merge is
 * concluded or there was nothing to merge.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordConflict, resolve, unitOf } from './provenance-merge.mjs';

export const REFSPEC = '+refs/heads/main:refs/remotes/origin/main';
const BASE = 'refs/remotes/origin/main';

/** Each unit's provenance test, keyed by its records' directory (see `UNITS`). */
export const PROVENANCE_TESTS = {
	'foundations/fast-af/provenance': 'node --test scripts/fast-af-provenance.test.mjs',
	'foundations/specimen/provenance': 'node --test scripts/specimen-provenance.test.mjs',
	'foundations/violet/provenance': 'node --test scripts/violet-provenance.test.mjs',
	'endpoints/botcore/provenance':
		'(cd endpoints/botcore && uv run --frozen pytest tests/test_provenance.py -q)',
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

	if (['rebase-merge', 'rebase-apply'].some((dir) => existsSync(gitPath(dir))))
		throw new SyncStop([
			'a rebase is in progress: finish it (or abort it yourself), then run pnpm base:sync again',
		]);
	for (const [head, what] of [
		['CHERRY_PICK_HEAD', 'cherry-pick'],
		['REVERT_HEAD', 'revert'],
	])
		if (rev(head))
			throw new SyncStop([
				`a ${what} is in progress: finish it (or abort it yourself), then run pnpm base:sync again`,
			]);

	const before = rev('HEAD');
	if (!before) throw new SyncStop(['the branch has no commit to merge into']);
	const open = rev('MERGE_HEAD');
	if (open) {
		const base = rev(BASE);
		if (!base || !succeeds(['merge-base', '--is-ancestor', open, base]))
			throw new SyncStop([
				`an open merge of ${short(open)}, which is not on origin/main, is in progress: finish it yourself`,
			]);
		return [`finishing the open merge of origin/main @ ${short(open)}`, ...conclude(open)];
	}

	const dirty = list(git(['status', '--porcelain', '--untracked-files=no']));
	if (dirty.length)
		throw new SyncStop([
			`the tree has uncommitted changes (${paths(dirty.length)}): set them aside with a WIP commit, never git stash, then run pnpm base:sync again`,
		]);

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
		git(['merge', '--no-edit', base]);
	} catch (error) {
		if (!rev('MERGE_HEAD'))
			throw new SyncStop([...lines, `git merge refused: ${firstLine(error)}`]);
		return [...lines, ...conclude(base)];
	}
	return [...lines, ...merged(before, [])];

	/** Resolves the open merge's records and commits it, or throws SyncStop leaving it open. */
	function conclude(mergeHead) {
		const unmerged = list(git(['diff', '--name-only', '--diff-filter=U']));
		const records = unmerged.filter((path) => unitOf(path));
		const others = unmerged.filter((path) => !unitOf(path));
		if (others.length)
			throw new SyncStop([
				`the merge of ${short(mergeHead)} is open: ${paths(others.length)} conflict outside the provenance records`,
				...others.map((path) => `  unmerged: ${path}`),
				...records.map((path) => `  unmerged record (merged by the next run): ${path}`),
				'resolve and stage those paths, then run pnpm base:sync again to merge the records and conclude',
			]);
		const unmergedSet = new Set(unmerged);
		const unstaged = list(git(['diff', '--name-only'])).filter((path) => !unmergedSet.has(path));
		if (unstaged.length)
			throw new SyncStop([
				`the merge of ${short(mergeHead)} is open with unstaged changes: stage them, then run pnpm base:sync again`,
				...unstaged.map((path) => `  unstaged: ${path}`),
			]);
		let written = [];
		if (records.length)
			try {
				written = resolve(git, root);
			} catch (error) {
				if (!(error instanceof RecordConflict)) throw error;
				throw new SyncStop([
					`the merge of ${short(mergeHead)} is open: the provenance merge refused: ${error.message}`,
					...records.map((path) => `  unmerged record: ${path}`),
					"record that file again with its unit's recorder, stage the records, then run pnpm base:sync again",
				]);
			}
		try {
			git(['commit', '--no-edit']);
		} catch (error) {
			throw new SyncStop([
				`the merge of ${short(mergeHead)} is resolved and staged, but its commit failed: ${firstLine(error)}`,
				'fix that, then run pnpm base:sync again to conclude',
			]);
		}
		return merged(before, written);
	}

	/** The report once HEAD holds the merge. */
	function merged(from, written) {
		const after = rev('HEAD');
		const out = [
			after === from
				? 'nothing merged'
				: `merged into ${git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()} @ ${short(after)}`,
		];
		if (written.length) {
			out.push(`merged the provenance records ${written.join(', ')}`);
			const units = [...new Set(written.map((path) => unitOf(path).unit.dir))];
			for (const dir of units) out.push(`run its provenance test: ${PROVENANCE_TESTS[dir]}`);
		}
		if (!succeeds(['diff', '--quiet', from, 'HEAD', '--', 'pnpm-lock.yaml']))
			out.push('pnpm-lock.yaml changed: run pnpm install --frozen-lockfile');
		return out;
	}
}

function firstLine(error) {
	return String(error.stderr || error.message || error)
		.trim()
		.split('\n')[0];
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
