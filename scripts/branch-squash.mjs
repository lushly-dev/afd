#!/usr/bin/env node
/**
 * Folds the current branch into one commit on the `main` it has merged, keeping its tree.
 *
 *   pnpm branch:squash [--message <file>]
 *
 * A pull request hands the merge queue one commit of its own. AFD's queue rebases: it lands each
 * of a branch's own commits on main as it is, author kept, and drops its merges of main (#1809).
 * That one commit is then what main receives, so it says what the change is and credits only its
 * author.
 *
 * The new commit has HEAD's tree, so the review and the gates that covered HEAD cover it, and
 * `origin/main` as its one parent. Its author, and the author date, are those of the branch's own
 * commits (its merges are not its own); its committer is the current git identity. Its message is
 * the file `--message` names, or the one commit's own, or the oldest commit's message with each
 * later commit's subject listed below it and each distinct trailer once at the end, cleaned as
 * `git commit -F` cleans one (`#` lines are kept: a wrapped issue number starts many). The
 * message must pass commitlint and the credit check main applies (no co-author line), as the
 * commit-msg hook would.
 *
 * It refuses uncommitted changes, untracked files included; an open merge, rebase, cherry-pick,
 * revert or `git am`, a sequence of cherry-picks or reverts included; a detached HEAD or `main`
 * itself; a branch that has not merged `origin/main` (`pnpm base:sync` merges it, and takes the
 * newest main); and own commits by more than one author, since one commit would credit only one
 * of them. It never fetches or pushes. It moves the branch only if it and the checkout are still
 * as they were read, carries a `pnpm verify` record of the old head to the new one
 * (scripts/verify-record.mjs), and prints the push. A branch that is already one commit on
 * `origin/main` is left as it is unless `--message` is given, and its push is printed too. The
 * push goes to the branch of the same name on origin, never to what the branch tracks.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainProblems } from './commit-credit.mjs';
import { execTool } from './release/exec-tool.mjs';
import {
	carryRecord,
	currentIdentity,
	readRecord,
	recordPath,
	writeRecord,
} from './verify-record.mjs';

export const BASE = 'refs/remotes/origin/main';
/** What an operation left open writes into the git directory. */
const OPEN = {
	MERGE_HEAD: 'a merge',
	CHERRY_PICK_HEAD: 'a cherry-pick',
	REVERT_HEAD: 'a revert',
	'rebase-merge': 'a rebase',
	'rebase-apply': 'a rebase or git am',
	sequencer: 'a cherry-pick or revert of several commits',
};
const TRAILER = /^[A-Za-z0-9][\w-]*[ \t]*:/;

/** Why branch:squash stopped without moving the branch; `lines` say what to do. */
export class SquashStop extends Error {
	constructor(lines) {
		super(lines[0]);
		this.lines = lines;
	}
}

const short = (sha) => sha.slice(0, 12);
const stop = (...lines) => {
	throw new SquashStop(lines);
};

/**
 * A message as git stores one: LF line endings, no trailing spaces, no leading or trailing blank
 * lines and no runs of them, as `git commit -F` cleans a message. It keeps `#` lines, which only
 * an edited message loses. `commit-tree` cleans nothing, so the message is cleaned here.
 */
export function cleanMessage(text) {
	const lines = text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, ''));
	const out = [];
	for (const line of lines)
		if (line !== '' || (out.length > 0 && out.at(-1) !== '')) out.push(line);
	while (out.at(-1) === '') out.pop();
	return out.length > 0 ? `${out.join('\n')}\n` : '';
}

/** A trailer compared without the case of its key or the spacing around its colon. */
const trailerKey = (trailer) =>
	trailer.replace(/^([^:]*?)[ \t]*:[ \t]*/, (_, key) => `${key.toLowerCase()}: `);

/**
 * A message split into its text and its closing trailer block, one entry per trailer with any
 * continuation lines kept on it. A last paragraph is a trailer block when its first line is a
 * trailer and every other line a trailer or a continuation, as git reads it.
 */
export function splitTrailers(message) {
	const paragraphs = cleanMessage(message).replace(/\n$/, '').split('\n\n');
	const last = paragraphs.at(-1).split('\n');
	const block =
		paragraphs.length > 1 &&
		TRAILER.test(last[0]) &&
		last.every((line) => TRAILER.test(line) || /^[ \t]+\S/.test(line));
	if (!block) return { text: paragraphs.join('\n\n'), trailers: [] };
	const trailers = [];
	for (const line of last) {
		if (TRAILER.test(line)) trailers.push(line);
		else trailers[trailers.length - 1] += `\n${line}`;
	}
	return { text: paragraphs.slice(0, -1).join('\n\n'), trailers };
}

/**
 * The folded commit's message from the branch's own commits, oldest first: one commit's own, or
 * the oldest's text, each later subject as a list item and each distinct trailer once.
 */
export function foldedMessage(messages) {
	if (messages.length === 1) return cleanMessage(messages[0]);
	const parts = messages.map(splitTrailers);
	const sections = [
		parts[0].text,
		parts
			.slice(1)
			.map((part) => `- ${part.text.split('\n')[0]}`)
			.join('\n'),
	];
	const seen = new Set();
	const trailers = [];
	for (const trailer of parts.flatMap((part) => part.trailers)) {
		if (seen.has(trailerKey(trailer))) continue;
		seen.add(trailerKey(trailer));
		trailers.push(trailer);
	}
	if (trailers.length > 0) sections.push(trailers.join('\n'));
	return `${sections.join('\n\n')}\n`;
}

/** The branch's own commits past `base`, oldest first, merges left out. */
function ownCommits(git, base, head) {
	const out = git([
		'log',
		'--reverse',
		'--no-merges',
		'--format=%H%x00%an%x00%ae%x00%aI%x00%B%x1e',
		`${base}..${head}`,
	]);
	return out
		.split('\x1e')
		.map((entry) => entry.replace(/^\n/, ''))
		.filter(Boolean)
		.map((entry) => {
			const [sha, name, email, date, message] = entry.split('\x00');
			return { sha, author: { name, email }, date, message };
		});
}

/**
 * The push for `branch`: to the branch of the same name on origin, whatever it tracks, since a
 * branch made from origin/main tracks main, and a fold of it is a fast-forward of main. Leased on
 * what origin last had, when it has the branch.
 */
function pushLine(git, branch) {
	const ref = `refs/heads/${branch}`;
	let published = '';
	try {
		published = git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]).trim();
	} catch {}
	return published
		? `Push it: git push --force-with-lease=${ref}:${published} origin ${ref}:${ref}`
		: `Push it: git push -u origin ${ref}:${ref}`;
}

function ident(git, variable) {
	const match = git(['var', variable]).match(/^(.*?)\s*<([^>]*)>/);
	return match ? { name: match[1], email: match[2] } : undefined;
}

/**
 * Folds the branch checked out at `root`. `git(args, options)` runs git there and throws on a
 * non-zero exit (`options.env` adds variables); `lint(file)` runs commitlint on a message file and
 * throws with its output. Returns the report's lines, or throws SquashStop with them.
 */
export function branchSquash({ root, git, lint, messageFile }) {
	for (const [name, what] of Object.entries(OPEN))
		if (existsSync(resolve(root, git(['rev-parse', '--git-path', name]).trim())))
			stop(
				`${what[0].toUpperCase()}${what.slice(1)} is in progress (${name}): finish or abort it first.`
			);
	if (git(['status', '--porcelain', '--untracked-files=normal']).trim() !== '')
		stop(
			'The checkout has uncommitted changes. Commit them, or set them aside with a WIP commit',
			'(never git stash: worktrees share one stash stack), then run pnpm branch:squash again.'
		);
	let branch = '';
	try {
		branch = git(['symbolic-ref', '--short', '-q', 'HEAD']).trim();
	} catch {}
	if (!branch) stop('HEAD is detached: check out the branch to fold.');
	if (branch === 'main') stop("This is main: fold a pull request's branch, never main.");
	let base = '';
	try {
		base = git(['rev-parse', '--verify', '-q', `${BASE}^{commit}`]).trim();
	} catch {}
	if (!base) stop('There is no origin/main: run pnpm base:sync, which fetches it and merges it.');
	const head = git(['rev-parse', 'HEAD']).trim();
	try {
		git(['merge-base', '--is-ancestor', base, head]);
	} catch {
		stop(
			`The branch has not merged origin/main (${short(base)}): run pnpm base:sync, then pnpm branch:squash again.`,
			"Folding it onto main as it stands would undo main's newer changes."
		);
	}
	const own = ownCommits(git, base, head);
	if (own.length === 0)
		stop('The branch has no commits of its own past origin/main: there is nothing to fold.');
	const range = git(['rev-list', `${base}..${head}`])
		.split('\n')
		.filter(Boolean);
	const parents = git(['rev-list', '--parents', '-n', '1', head]).trim().split(' ').slice(1);
	if (!messageFile && range.length === 1 && parents.length === 1 && parents[0] === base)
		return [
			`Already one commit on origin/main (${short(head)}): nothing to fold.`,
			pushLine(git, branch),
		];

	const authors = new Map(own.map((commit) => [commit.author.email.toLowerCase(), commit.author]));
	if (authors.size > 1)
		stop(
			"The branch's own commits have more than one author, and one commit would credit only one:",
			...[...authors.values()].map(({ name, email }) => `  ${name} <${email}>`),
			"Make the owner the author of each commit, or land each author's work in its own pull request."
		);
	const author = own[0].author;
	const message = messageFile
		? cleanMessage(readFileSync(messageFile, 'utf8'))
		: foldedMessage(own.map((c) => c.message));
	if (message.trim() === '') stop(`${messageFile} is empty: the commit needs a message.`);
	const committer = ident(git, 'GIT_COMMITTER_IDENT');
	const credit = mainProblems({ message, author, committer });
	if (credit.length > 0)
		stop(
			'The folded commit would credit someone other than its author, on main:',
			...credit.map((problem) => `  ${problem}`),
			'Replace a co-author line with an email-free "Assisted-by: <agent>" trailer in the',
			'commit that carries it, or give the whole message with --message <file>.'
		);

	const scratch = mkdtempSync(join(tmpdir(), 'afd-branch-squash-'));
	try {
		const file = join(scratch, 'message');
		writeFileSync(file, message);
		try {
			lint(file);
		} catch (error) {
			// A refusal is commitlint's own non-zero exit with its report on stdout. Anything else,
			// a missing tool or a broken configuration (exit 1, nothing on stdout), failed to run it.
			const report = String(error.stdout ?? '').trim();
			if (typeof error.status !== 'number' || report === '')
				stop(
					`commitlint could not run: ${String(error.stderr ?? '').trim() || error.message}`,
					'Run pnpm install and check commitlint.config.js, then try again.'
				);
			stop(
				'commitlint refuses the folded message:',
				...report
					.trim()
					.split('\n')
					.map((line) => `  ${line}`),
				'Give the message with --message <file>.'
			);
		}
		// The tree is the commit read above, never HEAD again: the checkout could have moved.
		const tree = git(['rev-parse', `${head}^{tree}`]).trim();
		const folded = git(['commit-tree', tree, '-p', base, '-F', file], {
			env: {
				GIT_AUTHOR_NAME: author.name,
				GIT_AUTHOR_EMAIL: author.email,
				GIT_AUTHOR_DATE: own.at(-1).date,
			},
		}).trim();
		const from = currentIdentity(git);
		let checkedOut = '';
		try {
			checkedOut = git(['symbolic-ref', '--short', '-q', 'HEAD']).trim();
		} catch {}
		if (checkedOut !== branch || from.head !== head || !from.clean)
			stop(
				`The checkout changed while branch:squash ran (now ${checkedOut || 'detached'} at ${short(from.head)}${from.clean ? '' : ', with changes'}): nothing was moved.`,
				'Run pnpm branch:squash again.'
			);
		// The old value guards the move: a branch that changed since it was read is not moved.
		git([
			'update-ref',
			'-m',
			`branch:squash: fold ${range.length} commit(s) onto ${short(base)}`,
			`refs/heads/${branch}`,
			folded,
			head,
		]);
		const lines = [
			`Folded ${range.length} commit(s), ${own.length} of them the branch's own, into ${short(folded)} on origin/main ${short(base)}.`,
			`The tree is unchanged. The old head was ${head} (git reflog ${branch}).`,
		];
		// The branch has moved: from here a failure is reported, never thrown, so these lines print.
		try {
			const path = recordPath(git, root);
			const carried = carryRecord(readRecord(path), { from, to: currentIdentity(git) });
			if (carried) {
				writeRecord(path, carried);
				lines.push('The pnpm verify record of the old head now covers the folded commit.');
			}
		} catch (error) {
			lines.push(
				`The pnpm verify record was not carried (${error.message}): pre-push runs its checks.`
			);
		}
		lines.push(pushLine(git, branch));
		return lines;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const argv = process.argv.slice(2);
	const at = argv.indexOf('--message');
	if (argv.length > 0 && !(argv.length === 2 && at === 0)) {
		console.error('Usage: pnpm branch:squash [--message <file>]');
		process.exit(2);
	}
	const git = (args, options = {}) =>
		execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...options.env },
		});
	const commitlint = join(root, 'node_modules/.bin/commitlint');
	const lint = (file) => {
		if (!existsSync(commitlint) && !existsSync(`${commitlint}.cmd`))
			throw new Error('commitlint is not installed here: run pnpm install');
		execTool(commitlint, ['--edit', file], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
	};
	try {
		const messageFile = at === 0 ? resolve(argv[1]) : undefined;
		for (const line of branchSquash({ root, git, lint, messageFile })) console.log(line);
	} catch (error) {
		if (!(error instanceof SquashStop)) {
			console.error(`branch:squash: ${error.message}`);
			process.exit(2);
		}
		for (const line of error.lines) console.error(line);
		process.exit(1);
	}
}
