import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { baseSync, PROVENANCE_TESTS, SyncStop } from './base-sync.mjs';
import { encode, UNITS } from './provenance-merge.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const BOTCORE = 'endpoints/botcore/provenance';
const MIRROR = 'endpoints/botcore/src/botcore/provenance';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

/**
 * Botcore's records for `rows` ([path, hash, extra]), with the packaged mirror. By default the
 * envelope commits the adaptations digest, the shape every unit had before #1610, which a branch
 * cut before it still carries; `digest: false` is every unit's shape since.
 */
const records = (rows, { digest = true } = {}) => {
	const files = rows.map(([path, current, extra = {}]) => ({
		path,
		current_import_sha256: current,
		import_reason: '',
		...extra,
	}));
	const adaptations = encode({ kind: 'reviewed-import-adaptations', files });
	const envelope = encode({
		schema_version: 1,
		records: {
			adaptations: {
				manifest: 'adaptations.json',
				...(digest ? { sha256: sha(adaptations) } : {}),
			},
		},
	});
	const out = {};
	for (const dir of [BOTCORE, MIRROR]) {
		out[`${dir}/adaptations.json`] = adaptations;
		out[`${dir}/provenance.json`] = envelope;
	}
	return out;
};

/** `main` in an upstream repository, and a clone of it on branch `feat`. */
function setup(t, files = {}) {
	const top = mkdtempSync(join(tmpdir(), 'afd-base-sync-'));
	t.after(() => rmSync(top, { recursive: true, force: true }));
	const runner = (cwd) => (args) =>
		execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
			cwd,
			encoding: 'utf8',
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	const write = (root, changes) => {
		for (const [path, text] of Object.entries(changes)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
	};
	const commitIn = (root, git) => (changes, message) => {
		write(root, changes);
		git(['add', '-A']);
		git(['commit', '-q', '-m', message]);
		return git(['rev-parse', 'HEAD']).trim();
	};
	const upstreamRoot = join(top, 'upstream');
	mkdirSync(upstreamRoot);
	const upstream = runner(upstreamRoot);
	upstream(['init', '-q', '-b', 'main']);
	commitIn(upstreamRoot, upstream)(
		{ 'src/a.ts': 'a\n', 'pnpm-lock.yaml': 'lock: 1\n', ...files },
		'base'
	);
	runner(top)(['clone', '-q', upstreamRoot, 'work']);
	const root = join(top, 'work');
	const git = runner(root);
	git(['checkout', '-q', '-b', 'feat']);
	return {
		root,
		git,
		upstream,
		main: commitIn(upstreamRoot, upstream),
		/** Merges main as a harness's own base-sync tool would, leaving any conflict open. */
		plainMerge: () => {
			git(['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
			assert.throws(() => git(['merge', '--no-edit', 'refs/remotes/origin/main']));
		},
		commit: commitIn(root, git),
		write: (changes) => write(root, changes),
		sync: () => baseSync(git, root),
		hook: (name, body) => {
			const dir = join(root, '.git', 'test-hooks');
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
			git(['config', 'core.hooksPath', dir]);
		},
	};
}

/** The SyncStop `run` throws. */
function stop(run) {
	try {
		run();
	} catch (error) {
		if (error instanceof SyncStop) return error.lines.join('\n');
		throw error;
	}
	assert.fail('expected base:sync to stop');
}

const mergeHead = (git) => {
	try {
		return git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).trim();
	} catch {
		return null;
	}
};
const parents = (git) =>
	git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').length - 1;
const unmerged = (git) =>
	git(['diff', '--name-only', '--diff-filter=U']).trim().split('\n').filter(Boolean);

const BASE_ROWS = [
	['a.py', 'a0'],
	['c.py', 'c0'],
];
/** Both sides record a different Botcore file, so the records conflict and nothing else does. */
function recordConflict(
	t,
	{ branchRow = ['a.py', 'a1'], mainRow = ['c.py', 'c1'], digest = true } = {}
) {
	const s = setup(t, records(BASE_ROWS, { digest }));
	const rowsWith = ([path, ...rest]) =>
		BASE_ROWS.map((row) => (row[0] === path ? [path, ...rest] : row));
	s.commit(records(rowsWith(branchRow), { digest }), 'branch');
	s.main(records(rowsWith(mainRow), { digest }), 'main');
	return s;
}

/** A record conflict, and `src/a.ts` conflicting beside it. */
function mixedConflict(t) {
	const s = recordConflict(t);
	s.commit({ 'src/a.ts': 'branch\n' }, 'branch edits a.ts');
	s.main({ 'src/a.ts': 'main\n' }, 'main edits a.ts');
	return s;
}

/** The merge of main is committed, and any records are valid and match their mirror. */
function assertConcluded(s, merged = s.git(['rev-parse', 'refs/remotes/origin/main']).trim()) {
	assert.equal(mergeHead(s.git), null);
	assert.equal(parents(s.git), 2);
	assert.equal(s.git(['status', '--porcelain']).trim(), '');
	assert.equal(s.git(['rev-parse', 'HEAD^2']).trim(), merged);
	for (const name of ['adaptations.json', 'provenance.json']) {
		const path = join(s.root, BOTCORE, name);
		if (!existsSync(path)) continue;
		JSON.parse(readFileSync(path, 'utf8'));
		assert.equal(readFileSync(join(s.root, MIRROR, name), 'utf8'), readFileSync(path, 'utf8'));
	}
}

describe('base:sync', () => {
	it('merges a moved base cleanly and says the lockfile changed', (t) => {
		const s = setup(t);
		s.commit({ 'src/b.ts': 'b\n' }, 'branch');
		const base = s.main({ 'src/c.ts': 'c\n', 'pnpm-lock.yaml': 'lock: 2\n' }, 'main');
		const lines = s.sync().join('\n');
		assert.match(lines, new RegExp(`origin/main @ ${base} \\(moved from `));
		assert.match(lines, /merged into feat @ /);
		assert.match(lines, /pnpm-lock\.yaml changed: run pnpm install --frozen-lockfile/);
		assert.equal(parents(s.git), 2);
		assert.equal(mergeHead(s.git), null);
		assert.equal(s.git(['rev-parse', 'refs/remotes/origin/main']).trim(), base);
	});

	it('does nothing when the branch already holds the base', (t) => {
		const s = setup(t);
		const head = s.commit({ 'src/b.ts': 'b\n' }, 'branch');
		const lines = s.sync().join('\n');
		assert.match(lines, /unchanged since the last fetch/);
		assert.match(lines, /already up to date/);
		assert.doesNotMatch(lines, /pnpm-lock/);
		assert.equal(s.git(['rev-parse', 'HEAD']).trim(), head);
	});

	it('merges two records of a unit that commits no adaptations digest with no conflict (#1610)', (t) => {
		// The same two records conflict when the envelope commits the digest (the test below).
		const s = recordConflict(t, { digest: false });
		const lines = s.sync().join('\n');
		assert.doesNotMatch(lines, /merged the provenance records/, 'git merged them itself');
		assert.ok(lines.includes(`both sides changed ${BOTCORE}: run its provenance test`), lines);
		assertConcluded(s);
		const rows = JSON.parse(readFileSync(join(s.root, BOTCORE, 'adaptations.json'), 'utf8')).files;
		assert.deepEqual(
			rows.map((row) => row.current_import_sha256),
			['a1', 'c1']
		);
		const envelope = JSON.parse(readFileSync(join(s.root, BOTCORE, 'provenance.json'), 'utf8'));
		assert.deepEqual(envelope.records.adaptations, { manifest: 'adaptations.json' });
	});

	it('merges conflicting records alone and concludes the merge', (t) => {
		const s = recordConflict(t);
		const lines = s.sync().join('\n');
		assert.match(
			lines,
			/merged the provenance records .*endpoints\/botcore\/provenance\/adaptations\.json/
		);
		assert.ok(lines.includes(PROVENANCE_TESTS[BOTCORE]), lines);
		assert.equal(mergeHead(s.git), null);
		assert.equal(parents(s.git), 2);
		assert.equal(s.git(['status', '--porcelain']).trim(), '');
		const rows = JSON.parse(readFileSync(join(s.root, BOTCORE, 'adaptations.json'), 'utf8')).files;
		assert.deepEqual(
			rows.map((row) => row.current_import_sha256),
			['a1', 'c1']
		);
		for (const name of ['adaptations.json', 'provenance.json'])
			assert.equal(
				readFileSync(join(s.root, MIRROR, name), 'utf8'),
				readFileSync(join(s.root, BOTCORE, name), 'utf8')
			);
	});

	it('leaves a mixed conflict open, naming every path, and finishes on the next run', (t) => {
		const s = mixedConflict(t);
		const first = stop(s.sync);
		assert.match(first, /origin\/main @ [0-9a-f]{40} \(moved from /);
		assert.match(first, /unmerged: src\/a\.ts/);
		assert.match(
			first,
			/unmerged record \(merged by the next run\): endpoints\/botcore\/provenance\/provenance\.json/
		);
		assert.match(first, /resolve and stage only those paths, then run pnpm base:sync again/);
		const open = mergeHead(s.git);
		assert.ok(open);
		// Running again before resolving changes nothing.
		assert.match(stop(s.sync), /unmerged: src\/a\.ts/);
		assert.equal(mergeHead(s.git), open);
		assert.ok(unmerged(s.git).includes('src/a.ts'));

		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', 'src/a.ts']);
		const second = s.sync().join('\n');
		assert.match(second, /finishing the open merge of [0-9a-f]{40}/);
		assert.match(second, /merged the provenance records/);
		assert.ok(second.includes(PROVENANCE_TESTS[BOTCORE]), second);
		assertConcluded(s);
		assert.equal(readFileSync(join(s.root, 'src/a.ts'), 'utf8'), 'both\n');
	});

	it('refuses records staged with conflict markers, and finishes once the conflict is back', (t) => {
		const s = mixedConflict(t);
		stop(s.sync);
		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', '-A']); // Stages the conflicted records, markers and all.
		const reason = stop(s.sync);
		assert.match(reason, /staged records are not valid JSON/);
		assert.match(reason, /invalid: endpoints\/botcore\/provenance\/provenance\.json/);
		assert.ok(mergeHead(s.git), 'the merge stays open');
		s.git(['checkout', '-m', '--', `${BOTCORE}/provenance.json`, `${MIRROR}/provenance.json`]);
		assert.match(s.sync().join('\n'), /merged the provenance records/);
		assertConcluded(s);
	});

	it('finishes a merge of the base that another tool left open', (t) => {
		const s = mixedConflict(t);
		s.plainMerge();
		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', 'src/a.ts']);
		assert.match(s.sync().join('\n'), /merged the provenance records/);
		assertConcluded(s);
	});

	it('finishes a recorded merge after origin/main has moved on', (t) => {
		const s = mixedConflict(t);
		stop(s.sync);
		const open = mergeHead(s.git);
		s.main({ 'src/later.ts': 'later\n' }, 'later');
		s.git(['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', 'src/a.ts']);
		assert.match(s.sync().join('\n'), /origin\/main has since moved/);
		assertConcluded(s, open);
	});

	it('concludes when the base deleted a record', (t) => {
		const old = { [`${BOTCORE}/old.json`]: '{}\n', [`${MIRROR}/old.json`]: '{}\n' };
		const s = setup(t, { ...records(BASE_ROWS), ...old });
		s.commit({ 'src/a.ts': 'branch\n' }, 'branch');
		s.upstream(['rm', '-q', `${BOTCORE}/old.json`, `${MIRROR}/old.json`]);
		s.main({ 'src/a.ts': 'main\n' }, 'main deletes a record');
		stop(s.sync);
		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', 'src/a.ts']);
		s.sync();
		assertConcluded(s);
		assert.ok(!existsSync(join(s.root, BOTCORE, 'old.json')));
	});

	for (const [starter, start] of [
		['base:sync', (s) => stop(s.sync)],
		['another tool', (s) => s.plainMerge()],
	])
		it(`refuses to replace a record staged by hand in a merge ${starter} left open`, (t) => {
			const s = mixedConflict(t);
			start(s);
			s.write({ 'src/a.ts': 'both\n', [`${BOTCORE}/provenance.json`]: '{"by":"hand"}\n' });
			s.git(['add', 'src/a.ts', `${BOTCORE}/provenance.json`]);
			const reason = stop(s.sync);
			assert.match(reason, /staged by hand: endpoints\/botcore\/provenance\/provenance\.json/);
			assert.match(
				reason,
				/unmerged record: endpoints\/botcore\/src\/botcore\/provenance\/provenance\.json/
			);
			assert.equal(s.git(['show', `:${BOTCORE}/provenance.json`]), '{"by":"hand"}\n', 'kept');
			assert.ok(mergeHead(s.git));
		});

	it('keeps a failed commit open with its output and the test to run, then concludes', (t) => {
		const s = recordConflict(t);
		s.hook('pre-commit', 'echo hook says no; exit 1');
		const reason = stop(s.sync);
		assert.match(reason, /resolved and staged, but its commit failed/);
		assert.match(reason, /hook says no/);
		assert.ok(reason.includes(PROVENANCE_TESTS[BOTCORE]), reason);
		assert.ok(mergeHead(s.git));
		s.hook('pre-commit', 'exit 0');
		const done = s.sync().join('\n');
		assert.ok(done.includes(PROVENANCE_TESTS[BOTCORE]), 'still named on the next run');
		assertConcluded(s);
	});

	it('keeps a merge a hook rejected open, and concludes it on the next run', (t) => {
		const s = setup(t);
		s.commit({ 'src/b.ts': 'b\n' }, 'branch');
		s.main({ 'src/c.ts': 'c\n' }, 'main');
		s.hook('pre-merge-commit', 'echo merge hook says no; exit 1');
		const reason = stop(s.sync);
		assert.match(reason, /git merge stopped without a conflict/);
		assert.match(reason, /merge hook says no/);
		assert.ok(mergeHead(s.git), 'not committed past the hook');
		assert.equal(parents(s.git), 1);
		s.hook('pre-merge-commit', 'exit 0');
		s.sync();
		assertConcluded(s);
	});

	it('concludes a clean merge even when git config says --no-commit', (t) => {
		const s = setup(t);
		s.commit({ 'src/b.ts': 'b\n' }, 'branch');
		s.main({ 'src/c.ts': 'c\n' }, 'main');
		s.git(['config', 'branch.feat.mergeOptions', '--no-commit']);
		s.sync();
		assertConcluded(s);
	});

	it('leaves the merge open with the reason when the records really conflict', (t) => {
		const s = recordConflict(t, {
			branchRow: ['c.py', 'c1', { import_classification: 'modified-after-staging' }],
			mainRow: ['c.py', 'c2', { import_classification: 'unchanged-staged' }],
		});
		const reason = stop(s.sync);
		assert.match(
			reason,
			/the provenance merge refused: both sides changed \$\.files\[c\.py\]\.import_classification/
		);
		assert.ok(mergeHead(s.git), 'the merge stays open');
		assert.ok(unmerged(s.git).includes(`${BOTCORE}/adaptations.json`));
	});

	it('refuses uncommitted changes and untracked files before fetching', (t) => {
		const s = setup(t);
		const before = s.git(['rev-parse', 'refs/remotes/origin/main']).trim();
		s.main({ 'src/c.ts': 'c\n' }, 'main');
		s.write({ 'src/new.ts': 'new\n' });
		assert.match(stop(s.sync), /untracked files \(1 path\).*WIP commit, never git stash/);
		s.write({ 'src/a.ts': 'edited\n' });
		assert.match(stop(s.sync), /uncommitted changes .*WIP commit, never git stash/);
		assert.equal(s.git(['rev-parse', 'refs/remotes/origin/main']).trim(), before, 'not fetched');
		assert.equal(readFileSync(join(s.root, 'src/a.ts'), 'utf8'), 'edited\n');
	});

	it('names an in-progress rebase and cherry-pick, and an open merge of another branch', (t) => {
		const s = setup(t);
		s.git(['checkout', '-q', '-b', 'other']);
		const other = s.commit({ 'src/a.ts': 'other\n' }, 'other');
		s.git(['checkout', '-q', 'feat']);
		s.commit({ 'src/a.ts': 'feat\n' }, 'feat');
		assert.throws(() => s.git(['rebase', 'other']));
		assert.match(stop(s.sync), /a rebase is in progress/);
		s.git(['rebase', '--abort']);
		assert.throws(() => s.git(['cherry-pick', other]));
		assert.match(stop(s.sync), /a cherry-pick( or revert sequence)? is in progress/);
		s.git(['cherry-pick', '--abort']);
		assert.throws(() => s.git(['merge', '--no-edit', 'other']));
		assert.match(stop(s.sync), /open merge of .* not of origin\/main.*finish it yourself/);
		assert.ok(mergeHead(s.git), 'never aborted');
	});

	it('names a cherry-pick sequence paused between picks', (t) => {
		const s = setup(t);
		s.git(['checkout', '-q', '-b', 'other']);
		const first = s.commit({ 'src/a.ts': 'other\n' }, 'first');
		const second = s.commit({ 'src/b.ts': 'b\n' }, 'second');
		s.git(['checkout', '-q', 'feat']);
		s.commit({ 'src/a.ts': 'feat\n' }, 'feat');
		assert.throws(() => s.git(['cherry-pick', first, second]));
		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', 'src/a.ts']);
		s.git(['commit', '-q', '--no-edit']); // Commits the pick by hand; the sequence stays.
		assert.equal(s.git(['status', '--porcelain']).trim(), '');
		assert.match(stop(s.sync), /a cherry-pick or revert sequence is in progress/);
	});

	it('refuses to finish a merge of a topic that has since landed on main', (t) => {
		const s = setup(t);
		s.upstream(['checkout', '-q', '-b', 'topic']);
		const topic = s.main({ 'src/a.ts': 'topic\n' }, 'topic');
		s.upstream(['checkout', '-q', 'main']);
		s.upstream(['merge', '-q', '--no-ff', '--no-edit', 'topic']);
		s.commit({ 'src/a.ts': 'feat\n' }, 'feat');
		s.git(['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
		assert.throws(() => s.git(['merge', '--no-edit', topic]));
		assert.match(stop(s.sync), /open merge of .* not of origin\/main.*finish it yourself/);
		assert.equal(mergeHead(s.git), topic, 'never aborted');
	});

	it('concludes a Health provenance and pin conflict and names Health provenance test', (t) => {
		const HEALTH = 'endpoints/health/provenance';
		const HEALTH_PIN = 'endpoints/health/tests/test_provenance.py';
		const mk = (files) => {
			const text = encode({
				schema_version: 1,
				files: files.map((path) => ({ path, origin: 'authored' })),
			});
			return {
				[`${HEALTH}/provenance.json`]: text,
				[HEALTH_PIN]: `RECORD_SHA256 = "${sha(text)}"\n`,
			};
		};
		const s = setup(t, mk(['a.py']));
		s.commit(mk(['a.py', 'b.py']), 'branch');
		s.main(mk(['a.py', 'c.py']), 'main');
		const lines = s.sync().join('\n');
		assert.match(
			lines,
			/merged the provenance records .*endpoints\/health\/provenance\/provenance\.json/
		);
		assert.ok(lines.includes(PROVENANCE_TESTS[HEALTH]), lines);
		assertConcluded(s);
		const mergedText = readFileSync(join(s.root, HEALTH, 'provenance.json'), 'utf8');
		assert.deepEqual(
			JSON.parse(mergedText).files.map((f) => f.path),
			['a.py', 'b.py', 'c.py']
		);
		assert.equal(
			readFileSync(join(s.root, HEALTH_PIN), 'utf8'),
			`RECORD_SHA256 = "${sha(mergedText)}"\n`
		);
	});

	it('refuses a staged Health pin file that still carries conflict markers', (t) => {
		const HEALTH = 'endpoints/health/provenance';
		const HEALTH_PIN = 'endpoints/health/tests/test_provenance.py';
		const mk = (files) => {
			const text = encode({
				schema_version: 1,
				files: files.map((path) => ({ path, origin: 'authored' })),
			});
			return {
				[`${HEALTH}/provenance.json`]: text,
				[HEALTH_PIN]: `RECORD_SHA256 = "${sha(text)}"\n`,
			};
		};
		const s = setup(t, mk(['a.py']));
		s.commit({ ...mk(['a.py', 'b.py']), 'src/a.ts': 'branch\n' }, 'branch');
		s.main({ ...mk(['a.py', 'c.py']), 'src/a.ts': 'main\n' }, 'main');
		stop(s.sync);
		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', '-A']);
		const reason = stop(s.sync);
		assert.match(reason, /invalid: endpoints\/health\/tests\/test_provenance\.py/);
	});

	it('knows a provenance test for every unit the provenance merge resolves', () => {
		for (const unit of UNITS) assert.ok(PROVENANCE_TESTS[unit.dir], unit.dir);
	});
});
