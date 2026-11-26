import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASES as SCOPE_BASES } from './affected/scope.mjs';
import {
	acceptRecord,
	buildRecord,
	checkLanes,
	DEFAULT_BASES,
	REFUSED,
	readRecord,
	recordPath,
	run,
	SCHEMA,
} from './review-record.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const identity = {
	head: HEAD,
	tree: 'c'.repeat(40),
	branch: 'feat/x',
	base: 'd'.repeat(40),
	clean: true,
};
const NOW = Date.parse('2030-01-02T00:00:00Z');
const general = { lane: 'general', model: 'claude-opus-5-5', effort: 'high', verdict: 'pass' };
const self = { lane: 'self', model: 'claude-opus-5-5', effort: 'high', verdict: 'pass' };
const recordFor = (lanes = [self, general], over = {}) =>
	buildRecord({ identity: { ...identity, ...over }, lanes, now: NOW }).record;

it('binds to the same default bases as pnpm verify', () => {
	assert.deepEqual(DEFAULT_BASES, SCOPE_BASES);
});

describe('checkLanes', () => {
	it('fills fixed and deferred with zero and keeps the gateway shape', () => {
		assert.deepEqual(checkLanes([general]).lanes, [{ fixed: 0, deferred: 0, ...general }]);
	});

	const refusals = [
		[[], /at least one/],
		['general', /at least one/],
		[[null], /not an object/],
		[[{ ...general, blockers: 1 }], /unknown keys: blockers/],
		[[{ ...general, model: '' }], /needs model/],
		[[{ ...general, effort: 'high\nverdict: pass' }], /needs effort/],
		[[{ ...general, verdict: 'approved' }], /"pass" or "fail"/],
		[[{ ...general, fixed: -1 }], /fixed must be a whole number/],
		[[{ ...general, deferred: 1.5 }], /deferred must be a whole number/],
		[[general, general], /once/],
	];
	for (const [lanes, reason] of refusals)
		it(`refuses ${JSON.stringify(lanes)}`, () => assert.match(checkLanes(lanes).reason, reason));
});

describe('buildRecord', () => {
	it('binds a passing review to the commit, tree, branch and base', () => {
		const record = recordFor();
		assert.equal(record.schema, SCHEMA);
		assert.equal(record.head, HEAD);
		assert.equal(record.tree, identity.tree);
		assert.equal(record.branch, 'feat/x');
		assert.equal(record.base, identity.base);
		assert.equal(record.verdict, 'pass');
		assert.equal(record.recordedAt, new Date(NOW).toISOString());
	});

	it('records a failing lane as a failing review', () => {
		assert.equal(recordFor([self, { ...general, verdict: 'fail' }]).verdict, 'fail');
	});

	it('refuses an uncommitted checkout, because the review must be of a commit', () => {
		const { reason } = buildRecord({ identity: { ...identity, clean: false }, lanes: [general] });
		assert.match(reason, /uncommitted/);
	});

	for (const name of ['self', 'Self', ' self-review ', 'SelfReview'])
		it(`refuses a passing self-review alone, named ${JSON.stringify(name)}`, () => {
			const lanes = [{ ...self, lane: name }];
			assert.match(buildRecord({ identity, lanes }).reason, /independent lane/);
		});
});

describe('acceptRecord', () => {
	const accept = (record = recordFor(), over = {}, head = HEAD) =>
		acceptRecord({ record, identity: { ...identity, ...over }, head });

	it('accepts a passing review of the exact, clean, checked-out commit', () => {
		const { accepted, reason } = accept();
		assert.equal(accepted, true);
		assert.match(reason, /general \(claude-opus-5-5, high\)/);
	});

	const refusals = [
		['a short head', () => accept(recordFor(), {}, 'aaaa'), /full 40-character/],
		['another checkout', () => accept(recordFor(), { head: OTHER }, HEAD), /checkout is at/],
		['a dirty checkout', () => accept(recordFor(), { clean: false }), /uncommitted/],
		['no record', () => accept(null), /no review is recorded/],
		['another schema', () => accept({ ...recordFor(), schema: 0 }), /another schema/],
		[
			'a record of an earlier commit',
			() => accept(recordFor(), { head: OTHER }, OTHER),
			/review recorded is of a{40}, not b{40}/,
		],
		['another tree', () => accept(recordFor(), { tree: OTHER }), /another tree/],
		[
			'a failing review',
			() => accept(recordFor([{ ...general, verdict: 'fail' }])),
			/did not pass/,
		],
		[
			'a verdict edited to pass over a failing lane',
			() => accept({ ...recordFor([{ ...general, verdict: 'fail' }]), verdict: 'pass' }),
			/lane recorded did not pass/,
		],
		[
			'a self-review edited in by hand',
			() => accept({ ...recordFor(), lanes: [{ ...self, fixed: 0, deferred: 0 }] }),
			/only a self-review/,
		],
		['malformed lanes', () => accept({ ...recordFor(), lanes: [] }), /malformed/],
	];
	for (const [name, attempt, reason] of refusals)
		it(`refuses ${name}`, () => {
			const result = attempt();
			assert.equal(result.accepted, false);
			assert.match(result.reason, reason);
		});
});

describe('run, against a real repository', () => {
	// Hooks export GIT_DIR and friends; a fixture must not inherit them (it would act on AFD).
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
	);
	const repo = () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), 'afd-review-record-')));
		const gitIn = (cwd) => (args) =>
			execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
				cwd,
				encoding: 'utf8',
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		const git = gitIn(root);
		git(['init', '-q', '-b', 'main']);
		writeFileSync(join(root, 'a.txt'), 'a\n');
		git(['add', '.']);
		git(['commit', '-q', '-m', 'a']);
		git(['branch', 'origin/main']);
		git(['checkout', '-q', '-b', 'feat']);
		writeFileSync(join(root, 'b.txt'), 'b\n');
		git(['add', '.']);
		git(['commit', '-q', '-m', 'b']);
		return { root, git, gitIn };
	};
	const lanes = JSON.stringify([self, general]);

	it('finds the record of the checkout git runs in, not of the root it is given (#2659)', (t) => {
		const here = repo();
		const there = repo();
		t.after(() => {
			rmSync(here.root, { recursive: true, force: true });
			rmSync(there.root, { recursive: true, force: true });
		});
		assert.equal(
			recordPath(there.git, here.root),
			join(there.root, '.git', 'afd-review-record.json')
		);
	});

	it('writes a record verify accepts for that head only, until the next commit', (t) => {
		const { root, git } = repo();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const head = git(['rev-parse', 'HEAD']).trim();
		assert.equal(run(['verify', '--head', head], { git, root }).code, REFUSED);
		const written = run(['write', '--lanes', lanes], { git, root, now: NOW });
		assert.equal(written.code, 0, written.out);
		assert.equal(git(['status', '--porcelain']).trim(), '', 'the record is not in the tree');
		const record = readRecord(recordPath(git, root));
		assert.equal(record.head, head);
		assert.equal(record.branch, 'feat');
		assert.equal(record.base, git(['rev-parse', 'main']).trim());
		const verified = run(['verify', '--head', head], { git, root });
		assert.equal(verified.code, 0, verified.out);

		writeFileSync(join(root, 'c.txt'), 'c\n');
		assert.match(run(['verify', '--head', head], { git, root }).out, /uncommitted/);
		git(['add', '.']);
		git(['commit', '-q', '-m', 'c']);
		const next = git(['rev-parse', 'HEAD']).trim();
		const stale = run(['verify', '--head', next], { git, root });
		assert.equal(stale.code, REFUSED);
		assert.match(stale.out, /review recorded is of/);
	});

	it('keeps each worktree its own record', (t) => {
		const { root, git, gitIn } = repo();
		const other = `${root}-other`;
		t.after(() => {
			rmSync(root, { recursive: true, force: true });
			rmSync(other, { recursive: true, force: true });
		});
		git(['worktree', 'add', '-q', '-b', 'other', other, 'feat']);
		const otherGit = gitIn(other);
		assert.equal(run(['write', '--lanes', lanes], { git, root }).code, 0);
		const head = otherGit(['rev-parse', 'HEAD']).trim();
		assert.equal(head, git(['rev-parse', 'HEAD']).trim(), 'the same commit in both');
		const there = run(['verify', '--head', head], { git: otherGit, root: other });
		assert.equal(there.code, REFUSED);
		assert.match(there.out, /no review is recorded/);
	});

	it('verifies the worktree --worktree names, from another checkout (lushly-dev/afd#1308)', (t) => {
		const { root, git, gitIn } = repo();
		const lane = `${root}-lane`;
		t.after(() => {
			rmSync(root, { recursive: true, force: true });
			rmSync(lane, { recursive: true, force: true });
		});
		git(['worktree', 'add', '-q', '--detach', lane, 'origin/main']);
		const head = git(['rev-parse', 'HEAD']).trim();
		const fromLane = (worktree) =>
			run(['verify', '--head', head, '--worktree', worktree], {
				git: gitIn(lane),
				root: lane,
				gitAt: gitIn,
			});
		assert.match(fromLane(root).out, /no review is recorded/);
		assert.equal(run(['write', '--lanes', lanes], { git, root }).code, 0);
		assert.equal(fromLane(root).code, 0);
		assert.equal(fromLane(lane).code, REFUSED, "the lane's own checkout is not the cell's");
		const without = run(['verify', '--head', head, '--worktree', root], { git, root });
		assert.equal(without.code, 2);
	});

	it('records a failing review but exits non-zero, and refuses a dirty checkout', (t) => {
		const { root, git } = repo();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const failing = JSON.stringify([{ ...general, verdict: 'fail', deferred: 2 }]);
		const result = run(['write', '--lanes', failing], { git, root });
		assert.equal(result.code, 1);
		assert.match(result.out, /recorded a fail review/);
		writeFileSync(join(root, 'd.txt'), 'd\n');
		assert.match(
			run(['write', '--lanes', lanes], { git, root }).out,
			/not recorded: .*uncommitted/
		);
	});

	it('reads the lanes from a file, for shells that mangle quotes', (t) => {
		const { root, git } = repo();
		const file = join(`${root}-lanes.json`);
		t.after(() => {
			rmSync(root, { recursive: true, force: true });
			rmSync(file, { force: true });
		});
		writeFileSync(file, lanes);
		const written = run(['write', '--lanes-file', file], { git, root });
		assert.equal(written.code, 0, written.out);
		const head = git(['rev-parse', 'HEAD']).trim();
		assert.equal(run(['verify', '--head', head], { git, root }).code, 0);
	});

	it('explains its usage', (t) => {
		const { root, git } = repo();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.equal(run(['approve'], { git, root }).code, 2);
		assert.match(run(['verify', '--sha', HEAD], { git, root }).out, /unknown option --sha/);
		assert.match(run(['write'], { git, root }).out, /one of --lanes or --lanes-file/);
		const both = ['write', '--lanes', '[]', '--lanes-file', 'x.json'];
		assert.match(run(both, { git, root }).out, /one of --lanes or --lanes-file/);
		assert.match(run(['write', '--lanes', '{'], { git, root }).out, /not readable JSON/);
		assert.equal(run(['toString'], { git, root }).code, 2);
		assert.equal(run(['show'], { git, root }).code, 1);
	});
});

describe('the command line', () => {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const script = join(dirname(fileURLToPath(import.meta.url)), 'review-record.mjs');

	it('still refuses when started through a symlink, never exiting 0 unchecked', (t) => {
		const dir = mkdtempSync(join(tmpdir(), 'afd-review-record-link-'));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const link = join(dir, 'scripts');
		symlinkSync(dirname(script), link, 'junction');
		let failed = null;
		try {
			execFileSync(process.execPath, [join(link, 'review-record.mjs'), 'verify', '--head', '0'], {
				encoding: 'utf8',
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			failed = error;
		}
		assert.ok(failed, 'verify must not exit 0');
		assert.match(failed.stderr, /review-record: --head must be a full 40-character commit id/);
	});
});
