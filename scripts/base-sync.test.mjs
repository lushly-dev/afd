import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { baseSync, PROVENANCE_TESTS, SyncStop } from './base-sync.mjs';
import { encode, UNITS } from './provenance-merge.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const BOTCORE = 'endpoints/botcore/provenance';
const MIRROR = 'endpoints/botcore/src/botcore/provenance';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

/** Botcore's records for `rows` ([path, hash, extra]), with the packaged mirror. */
const records = (rows) => {
	const files = rows.map(([path, current, extra = {}]) => ({
		path,
		current_import_sha256: current,
		import_reason: '',
		...extra,
	}));
	const adaptations = encode({ kind: 'reviewed-import-adaptations', files });
	const envelope = encode({
		schema_version: 1,
		records: { adaptations: { manifest: 'adaptations.json', sha256: sha(adaptations) } },
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
		main: commitIn(upstreamRoot, upstream),
		commit: commitIn(root, git),
		write: (changes) => write(root, changes),
		sync: () => baseSync(git, root),
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
function recordConflict(t, { branchRow = ['a.py', 'a1'], mainRow = ['c.py', 'c1'] } = {}) {
	const s = setup(t, records(BASE_ROWS));
	const rowsWith = ([path, ...rest]) =>
		BASE_ROWS.map((row) => (row[0] === path ? [path, ...rest] : row));
	s.commit(records(rowsWith(branchRow)), 'branch');
	s.main(records(rowsWith(mainRow)), 'main');
	return s;
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
		const s = recordConflict(t);
		s.commit({ 'src/a.ts': 'branch\n' }, 'branch edits a.ts');
		s.main({ 'src/a.ts': 'main\n' }, 'main edits a.ts');
		const first = stop(s.sync);
		assert.match(first, /unmerged: src\/a\.ts/);
		assert.match(
			first,
			/unmerged record \(merged by the next run\): endpoints\/botcore\/provenance\/provenance\.json/
		);
		assert.match(first, /resolve and stage those paths, then run pnpm base:sync again/);
		const open = mergeHead(s.git);
		assert.ok(open);
		// Running again before resolving changes nothing.
		assert.match(stop(s.sync), /unmerged: src\/a\.ts/);
		assert.equal(mergeHead(s.git), open);
		assert.ok(unmerged(s.git).includes('src/a.ts'));

		s.write({ 'src/a.ts': 'both\n' });
		s.git(['add', 'src/a.ts']);
		const second = s.sync().join('\n');
		assert.match(second, /finishing the open merge of origin\/main/);
		assert.match(second, /merged the provenance records/);
		assert.equal(mergeHead(s.git), null);
		assert.equal(parents(s.git), 2);
		assert.equal(readFileSync(join(s.root, 'src/a.ts'), 'utf8'), 'both\n');
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

	it('refuses tracked changes before fetching', (t) => {
		const s = setup(t);
		const before = s.git(['rev-parse', 'refs/remotes/origin/main']).trim();
		s.main({ 'src/c.ts': 'c\n' }, 'main');
		s.write({ 'src/a.ts': 'edited\n' });
		assert.match(stop(s.sync), /uncommitted changes .*WIP commit, never git stash/);
		assert.equal(s.git(['rev-parse', 'refs/remotes/origin/main']).trim(), before, 'not fetched');
		assert.equal(readFileSync(join(s.root, 'src/a.ts'), 'utf8'), 'edited\n');
	});

	it('names an in-progress cherry-pick and an open merge of another branch', (t) => {
		const s = setup(t);
		s.git(['checkout', '-q', '-b', 'other']);
		const other = s.commit({ 'src/a.ts': 'other\n' }, 'other');
		s.git(['checkout', '-q', 'feat']);
		s.commit({ 'src/a.ts': 'feat\n' }, 'feat');
		assert.throws(() => s.git(['cherry-pick', other]));
		assert.match(stop(s.sync), /a cherry-pick is in progress/);
		s.git(['cherry-pick', '--abort']);
		assert.throws(() => s.git(['merge', '--no-edit', 'other']));
		assert.match(stop(s.sync), /open merge of .* not on origin\/main.*finish it yourself/);
		assert.ok(mergeHead(s.git), 'never aborted');
	});

	it('knows a provenance test for every unit the provenance merge resolves', () => {
		for (const unit of UNITS) assert.ok(PROVENANCE_TESTS[unit.dir], unit.dir);
	});
});
