import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
	branchSquash,
	cleanMessage,
	foldedMessage,
	SquashStop,
	splitTrailers,
} from './branch-squash.mjs';
import {
	acceptRecord,
	currentIdentity,
	readRecord,
	recordPath,
	writeRecord,
} from './verify-record.mjs';

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const owner = { name: 'Owner', email: 'owner@example.com' };
const as = ({ name, email }) => ({
	GIT_AUTHOR_NAME: name,
	GIT_AUTHOR_EMAIL: email,
	GIT_COMMITTER_NAME: name,
	GIT_COMMITTER_EMAIL: email,
});

/** `main` upstream, and a clone of it on branch `feat` that tracks `origin/feat`. */
function setup(t) {
	const top = mkdtempSync(join(tmpdir(), 'afd-branch-squash-'));
	t.after(() => rmSync(top, { recursive: true, force: true }));
	const runner =
		(cwd) =>
		(args, options = {}) =>
			execFileSync('git', args, {
				cwd,
				encoding: 'utf8',
				env: { ...env, ...as(owner), ...options.env },
				stdio: ['ignore', 'pipe', 'pipe'],
			});
	const commitIn = (root, git) => (changes, message, who) => {
		for (const [path, text] of Object.entries(changes)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		git(['add', '-A']);
		git(['commit', '-q', '-m', message], { env: who ? as(who) : {} });
		return git(['rev-parse', 'HEAD']).trim();
	};
	const upstreamRoot = join(top, 'upstream');
	mkdirSync(upstreamRoot);
	const upstream = runner(upstreamRoot);
	upstream(['init', '-q', '-b', 'main']);
	commitIn(upstreamRoot, upstream)({ 'a.txt': 'a\n' }, 'chore: base');
	runner(top)(['clone', '-q', upstreamRoot, 'work']);
	const root = join(top, 'work');
	const git = runner(root);
	git(['checkout', '-q', '-b', 'feat']);
	const linted = [];
	return {
		root,
		git,
		linted,
		main: commitIn(upstreamRoot, upstream),
		commit: commitIn(root, git),
		fetch: () => git(['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main']),
		mergeMain: () => git(['merge', '-q', '--no-edit', 'refs/remotes/origin/main']),
		publish: () => git(['push', '-q', '-u', 'origin', 'feat']),
		squash: (options = {}) =>
			branchSquash({
				root,
				git,
				lint: (file) => linted.push(file),
				...options,
			}),
	};
}

/** The lines of the SquashStop `run` throws. */
function stop(run) {
	try {
		run();
	} catch (error) {
		if (error instanceof SquashStop) return error.lines.join('\n');
		throw error;
	}
	assert.fail('expected branch:squash to stop');
}

const show = (git, format, ref = 'HEAD') => git(['log', '-1', `--format=${format}`, ref]).trim();

describe('splitTrailers and foldedMessage', () => {
	it('splits off a closing trailer block, continuation lines kept on their trailer', () => {
		assert.deepEqual(
			splitTrailers('feat: x\n\nWhy.\n\nAssisted-by: Claude Code\nRefs: #1\n  and #2\n'),
			{
				text: 'feat: x\n\nWhy.',
				trailers: ['Assisted-by: Claude Code', 'Refs: #1\n  and #2'],
			}
		);
		assert.deepEqual(splitTrailers('feat: x\n\nNot: a block\nbecause this line is prose\n'), {
			text: 'feat: x\n\nNot: a block\nbecause this line is prose',
			trailers: [],
		});
		assert.deepEqual(splitTrailers('fix: only a subject: with a colon\n'), {
			text: 'fix: only a subject: with a colon',
			trailers: [],
		});
	});
	it("keeps one commit's message, and lists later subjects under the oldest with each trailer once", () => {
		assert.equal(foldedMessage(['fix: y\n\nBody.\n\n']), 'fix: y\n\nBody.\n');
		assert.equal(
			foldedMessage([
				'feat: x\n\nWhy it changes.\n\nAssisted-by: Claude Code\n',
				'fix: review findings\n\nDetail.\n\nAssisted-by: Claude Code\n',
				'docs: record it\n',
			]),
			'feat: x\n\nWhy it changes.\n\n- fix: review findings\n- docs: record it\n\nAssisted-by: Claude Code\n'
		);
	});
	it('reads CRLF messages, and takes a trailer once whatever the case of its key', () => {
		assert.equal(
			foldedMessage([
				'feat: a\n\nBody.\n',
				'fix: b\r\n\r\nAssisted-By:  Claude Code\r\n',
				'fix: c\n\nassisted-by: Codex\n',
			]),
			'feat: a\n\nBody.\n\n- fix: b\n- fix: c\n\nAssisted-By:  Claude Code\nassisted-by: Codex\n'
		);
		assert.equal(
			foldedMessage([
				'feat: a\n\nAssisted-by: Claude Code\n',
				'fix: b\n\nAssisted-By: Claude Code\n',
			]),
			'feat: a\n\n- fix: b\n\nAssisted-by: Claude Code\n'
		);
	});
	it('cleans a message as git commit -F does, keeping a line that starts with an issue number', () => {
		assert.equal(
			cleanMessage('\n\nfeat: a  \r\n\r\n\r\nThis is step 2 of\n#1809 and keeps the author.\n\n'),
			'feat: a\n\nThis is step 2 of\n#1809 and keeps the author.\n'
		);
		assert.equal(cleanMessage(' \n\n'), '');
	});
});

describe('branchSquash', () => {
	it("folds the branch's commits and its merges of main into one commit on origin/main, tree kept", (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b\n\nWhy b.\n\nAssisted-by: Claude Code');
		s.publish();
		const pushed = s.git(['rev-parse', 'HEAD']).trim();
		s.main({ 'c.txt': 'c\n' }, 'chore: main moves');
		s.fetch();
		s.mergeMain();
		const head = s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b\n\nAssisted-by: Claude Code');
		const tree = show(s.git, '%T');
		const base = s.git(['rev-parse', 'refs/remotes/origin/main']).trim();

		const lines = s.squash();
		assert.match(lines[0], /Folded 3 commit\(s\), 2 of them the branch's own/);
		assert.match(lines.join('\n'), new RegExp(`The old head was ${head}`));
		assert.match(
			lines.at(-1),
			new RegExp(
				`^Push it: git push --force-with-lease=refs/heads/feat:${pushed} origin refs/heads/feat:refs/heads/feat$`
			)
		);
		assert.equal(show(s.git, '%T'), tree, 'the tree is the reviewed one');
		assert.equal(show(s.git, '%P'), base, 'one parent, origin/main');
		assert.equal(show(s.git, '%an <%ae>'), 'Owner <owner@example.com>');
		assert.equal(
			show(s.git, '%B'),
			'feat: add b\n\nWhy b.\n\n- fix: tidy b\n\nAssisted-by: Claude Code'
		);
		assert.equal(s.git(['status', '--porcelain']).trim(), '', 'the checkout stays clean');
		assert.equal(s.linted.length, 1, 'commitlint read the message');
		assert.deepEqual(s.squash(), [
			`Already one commit on origin/main (${show(s.git, '%H').slice(0, 12)}): nothing to fold.`,
			`Push it: git push --force-with-lease=refs/heads/feat:${pushed} origin refs/heads/feat:refs/heads/feat`,
		]);
	});

	it('carries a pnpm verify record of the old head to the folded commit', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b');
		const before = currentIdentity(s.git);
		const path = recordPath(s.git, s.root);
		writeRecord(path, {
			schema: 1,
			head: before.head,
			tree: before.tree,
			base: before.base,
			scope: 'affected',
			results: [{ name: 'check (ci.yml)', ok: true }],
			finishedAt: new Date().toISOString(),
		});
		assert.match(s.squash().join('\n'), /record of the old head now covers the folded commit/);
		const after = currentIdentity(s.git);
		const updates = `refs/heads/feat ${after.head} refs/heads/feat ${'0'.repeat(40)}\n`;
		assert.equal(
			acceptRecord({ record: readRecord(path), identity: after, updates }).accepted,
			true
		);
		assert.equal(readRecord(path).carriedFrom, before.head);
	});

	it('takes the whole message from --message, even for one commit, cleaned as git would', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		const file = join(s.root, '..', 'message.txt');
		writeFileSync(
			file,
			'feat: add b, said better\r\n\r\nStep 2 of\r\n#1809.\r\n\r\nAssisted-by: Claude Code\r\n'
		);
		s.squash({ messageFile: file });
		assert.equal(
			show(s.git, '%B'),
			'feat: add b, said better\n\nStep 2 of\n#1809.\n\nAssisted-by: Claude Code'
		);
	});

	it('refuses a branch that has not merged origin/main, which would undo main', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		const head = s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b');
		s.main({ 'c.txt': 'c\n' }, 'chore: main moves');
		s.fetch();
		assert.match(
			stop(() => s.squash()),
			/has not merged origin\/main .*run pnpm base:sync/
		);
		assert.equal(show(s.git, '%H'), head, 'the branch is where it was');
	});

	it('refuses uncommitted work, an open merge, a detached HEAD and main', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		writeFileSync(join(s.root, 'u.txt'), 'untracked\n');
		assert.match(
			stop(() => s.squash()),
			/uncommitted changes/
		);
		rmSync(join(s.root, 'u.txt'));
		s.commit({ 'a.txt': 'feat side\n' }, 'feat: change a');
		s.main({ 'a.txt': 'main side\n' }, 'chore: change a on main');
		s.fetch();
		assert.throws(() => s.mergeMain());
		s.git(['add', '-A']);
		assert.match(
			stop(() => s.squash()),
			/A merge is in progress \(MERGE_HEAD\)/
		);
		s.git(['merge', '--abort']);
		s.git(['checkout', '-q', '--detach']);
		assert.match(
			stop(() => s.squash()),
			/HEAD is detached/
		);
		s.git(['checkout', '-q', 'main']);
		assert.match(
			stop(() => s.squash()),
			/This is main/
		);
	});

	it('refuses a rebase, a cherry-pick and an unfinished sequence of them', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		s.git(['checkout', '-q', '-b', 'side', 'main']);
		const one = s.commit({ 'b.txt': 'side 1\n' }, 'feat: side one');
		const two = s.commit({ 'd.txt': 'd\n' }, 'feat: side two');
		s.git(['checkout', '-q', 'feat']);
		const head = show(s.git, '%H');
		assert.throws(() => s.git(['rebase', '-q', 'side']));
		assert.match(
			stop(() => s.squash()),
			/A rebase is in progress \(rebase-merge\)/
		);
		s.git(['rebase', '--abort']);
		assert.throws(() => s.git(['cherry-pick', one]));
		assert.match(
			stop(() => s.squash()),
			/A cherry-pick is in progress \(CHERRY_PICK_HEAD\)/
		);
		s.git(['cherry-pick', '--abort']);
		assert.equal(show(s.git, '%H'), head, 'nothing moved');
		// Resolving the first of two picks with a commit leaves the sequence open, and the tree clean.
		assert.throws(() => s.git(['cherry-pick', one, two]));
		writeFileSync(join(s.root, 'b.txt'), 'resolved\n');
		s.git(['add', '-A']);
		s.git(['commit', '-q', '--no-edit']);
		const resolved = show(s.git, '%H');
		assert.equal(s.git(['status', '--porcelain']).trim(), '');
		assert.match(
			stop(() => s.squash()),
			/A cherry-pick or revert of several commits is in progress \(sequencer\)/
		);
		assert.equal(show(s.git, '%H'), resolved, 'nothing moved');
		s.git(['cherry-pick', '--quit']);
	});

	it('moves nothing when the checkout or the branch changes while it runs', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		const head = s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b');
		s.git(['branch', 'other', 'main']);
		const switched = stop(() => s.squash({ lint: () => s.git(['checkout', '-q', 'other']) }));
		assert.match(switched, /The checkout changed while branch:squash ran \(now other/);
		assert.equal(s.git(['rev-parse', 'refs/heads/feat']).trim(), head);
		s.git(['checkout', '-q', 'feat']);
		// The branch moves between the last read and the update: update-ref's old value refuses it.
		let moved = '';
		const racing = (args, options) => {
			if (args[0] === 'update-ref' && !moved) {
				moved = s.git(['commit-tree', `${head}^{tree}`, '-p', head, '-m', 'fix: racing']).trim();
				s.git(['update-ref', 'refs/heads/feat', moved]);
			}
			return s.git(args, options);
		};
		assert.throws(() => branchSquash({ root: s.root, git: racing, lint: () => {} }), /update-ref/);
		assert.equal(s.git(['rev-parse', 'refs/heads/feat']).trim(), moved, 'the newer head is kept');
	});

	it('refuses own commits by two authors, and nothing of its own', (t) => {
		const s = setup(t);
		assert.match(
			stop(() => s.squash()),
			/no commits of its own/
		);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		const head = s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b', {
			name: 'Other',
			email: 'other@example.com',
		});
		const text = stop(() => s.squash());
		assert.match(text, /more than one author/);
		assert.match(text, /Other <other@example.com>/);
		assert.equal(show(s.git, '%H'), head);
	});

	it('refuses a co-author line, which main would receive, and a message commitlint refuses', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b\n\nCo-authored-by: Someone <someone@example.com>');
		assert.match(
			stop(() => s.squash()),
			/has the line "Co-authored-by: Someone <someone@example.com>"/
		);
		s.git(['commit', '-q', '--amend', '-m', 'fix: tidy b']);
		const head = show(s.git, '%H');
		const refused = Object.assign(new Error('commitlint failed'), {
			status: 1,
			stdout: '✖ subject may not be empty\n',
		});
		const lint = () => {
			throw refused;
		};
		assert.match(
			stop(() => s.squash({ lint })),
			/commitlint refuses the folded message:\n {2}✖ subject may not be empty/
		);
		const missing = () => {
			throw new Error('commitlint is not installed here: run pnpm install');
		};
		const broken = () => {
			throw Object.assign(new Error('Command failed'), {
				status: 1,
				stdout: '',
				stderr: 'Cannot find module "@commitlint/config-conventional"\n',
			});
		};
		assert.match(
			stop(() => s.squash({ lint: broken })),
			/^commitlint could not run: Cannot find module "@commitlint\/config-conventional"/
		);
		assert.match(
			stop(() => s.squash({ lint: missing })),
			/^commitlint could not run: commitlint is not installed/
		);
		assert.equal(show(s.git, '%H'), head, 'the branch is where it was');
	});

	it('pushes to the branch of the same name, never to the main a new branch tracks', (t) => {
		const s = setup(t);
		s.git(['checkout', '-q', '-b', 'fresh', '--track', 'origin/main']);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b');
		assert.equal(
			s.git(['rev-parse', '--symbolic-full-name', '@{upstream}']).trim(),
			'refs/remotes/origin/main'
		);
		assert.equal(
			s.squash().at(-1),
			'Push it: git push -u origin refs/heads/fresh:refs/heads/fresh'
		);
	});

	it('still reports the move when the verify record cannot be read', (t) => {
		const s = setup(t);
		s.commit({ 'b.txt': 'b\n' }, 'feat: add b');
		const head = s.commit({ 'b.txt': 'b2\n' }, 'fix: tidy b');
		writeFileSync(recordPath(s.git, s.root), '{ not json');
		const lines = s.squash().join('\n');
		assert.match(lines, new RegExp(`The old head was ${head}`));
		assert.match(lines, /The pnpm verify record was not carried \(.*\): pre-push runs its checks/);
		assert.match(lines, /Push it: git push -u origin/);
	});
});
