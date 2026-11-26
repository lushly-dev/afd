import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { cleanHookEnvironment, decide, onlyFactoryRefs, runPrePushChecks } from './pre-push.mjs';
import {
	acceptRecord,
	buildRecord,
	CHECK,
	carryRecord,
	currentIdentity,
	MAX_AGE_MS,
	readRecord,
	recordPath,
	SCHEMA,
	writeRecord,
} from './verify-record.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const identity = { head: HEAD, tree: 'c'.repeat(40), base: 'd'.repeat(40), clean: true };
const passing = [
	{ name: CHECK, ok: true },
	{ name: 'rust.yml: cargo test', ok: true },
];
const NOW = Date.parse('2030-01-02T00:00:00Z');
const push = (sha = HEAD, ref = 'refs/heads/feat/x') => `${ref} ${sha} ${ref} ${OTHER}\n`;
const recordFor = (over = {}) =>
	buildRecord({
		before: identity,
		after: identity,
		results: passing,
		scope: 'affected',
		defaultBase: true,
		now: NOW - 1000,
		...over,
	}).record;

describe('buildRecord', () => {
	it('records a full pass on a clean checkout against the default base', () => {
		const record = recordFor();
		assert.equal(record.schema, SCHEMA);
		assert.equal(record.head, HEAD);
		assert.equal(record.tree, identity.tree);
		assert.equal(record.base, identity.base);
		assert.equal(record.finishedAt, new Date(NOW - 1000).toISOString());
	});

	const refusals = [
		[{ defaultBase: false }, /base other than the default/],
		[{ before: { ...identity, clean: false } }, /uncommitted changes when verify started/],
		[{ after: { ...identity, clean: false } }, /changed while verify ran/],
		[{ after: { ...identity, head: OTHER } }, /changed while verify ran/],
		[
			{ before: { ...identity, base: null }, after: { ...identity, base: null } },
			/no default base/,
		],
		[{ results: [{ name: 'rust.yml: cargo test', ok: true }] }, /skipped pnpm check/],
		[
			{
				results: [
					{ name: CHECK, ok: true },
					{ name: 'x', ok: false },
				],
			},
			/step failed/,
		],
	];
	for (const [over, reason] of refusals)
		it(`writes nothing when ${reason.source}`, () => {
			const built = buildRecord({
				before: identity,
				after: identity,
				results: passing,
				scope: 'affected',
				defaultBase: true,
				...over,
			});
			assert.equal(built.record, undefined);
			assert.match(built.reason, reason);
		});
});

describe('acceptRecord', () => {
	const accept = (over = {}) =>
		acceptRecord({ record: recordFor(), identity, updates: push(), now: NOW, ...over });

	it('accepts a current record for the pushed, checked-out commit', () => {
		assert.deepEqual(accept().accepted, true);
		// Deleting a remote branch alongside pushes no other commit.
		assert.equal(accept({ updates: push() + push(ZERO, 'refs/heads/old') }).accepted, true);
	});

	const rejections = [
		[{ updates: '' }, /no ref being pushed/],
		[{ updates: push(OTHER) }, /not the checked-out commit/],
		[{ updates: push() + push(OTHER, 'refs/heads/other') }, /not the checked-out commit/],
		[{ record: null }, /no verify record/],
		[{ record: { ...recordFor(), schema: 0 } }, /another schema/],
		[{ record: { ...recordFor(), head: OTHER } }, /another commit/],
		[{ record: { ...recordFor(), tree: OTHER } }, /another tree/],
		[{ identity: { ...identity, clean: false } }, /uncommitted changes/],
		[{ identity: { ...identity, base: OTHER } }, /merge base with origin\/main moved/],
		[{ now: NOW + MAX_AGE_MS }, /over a day old/],
		[{ now: NOW - 60_000 }, /over a day old/],
		[
			{ record: { ...recordFor(), results: [{ name: 'x', ok: true }] } },
			/does not cover pnpm check/,
		],
		[
			{
				record: {
					...recordFor(),
					results: [
						{ name: CHECK, ok: true },
						{ name: 'x', ok: false },
					],
				},
			},
			/has a failure/,
		],
	];
	for (const [over, reason] of rejections)
		it(`runs the checks when ${reason.source}`, () => {
			const result = accept(over);
			assert.equal(result.accepted, false);
			assert.match(result.reason, reason);
		});
});

describe('carryRecord', () => {
	const folded = { ...identity, head: OTHER };
	it('restates a record for a commit with the same tree and base, which pre-push accepts', () => {
		const carried = carryRecord(recordFor(), { from: identity, to: folded });
		assert.equal(carried.head, OTHER);
		assert.equal(carried.carriedFrom, HEAD);
		assert.equal(carried.finishedAt, recordFor().finishedAt);
		assert.equal(
			acceptRecord({ record: carried, identity: folded, updates: push(OTHER), now: NOW }).accepted,
			true
		);
		const again = carryRecord(carried, { from: folded, to: { ...identity, head: 'e'.repeat(40) } });
		assert.equal(again.carriedFrom, HEAD, 'names the commit verify ran on');
	});
	const refusals = [
		['no record', { record: null }],
		['another schema', { record: { ...recordFor(), schema: SCHEMA + 1 } }],
		["another commit's record", { from: { ...identity, head: 'e'.repeat(40) } }],
		['a record of another tree', { record: { ...recordFor(), tree: OTHER } }],
		['a record against another base', { record: { ...recordFor(), base: OTHER } }],
		['a new commit with another tree', { to: { ...folded, tree: OTHER } }],
		['a new commit on another base', { to: { ...folded, base: OTHER } }],
		['a new commit with no base', { to: { ...folded, base: null } }],
		['an unclean checkout after', { to: { ...folded, clean: false } }],
		['an unclean checkout before', { from: { ...identity, clean: false } }],
	];
	for (const [what, over] of refusals)
		it(`carries nothing for ${what}`, () => {
			const { record = recordFor(), from = identity, to = folded } = over;
			assert.equal(carryRecord('record' in over ? over.record : record, { from, to }), null);
		});
});

describe('in a repository', () => {
	const repo = () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), 'afd-verify-record-')));
		const git = (args) =>
			execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
				cwd: root,
				encoding: 'utf8',
			});
		git(['init', '-q', '-b', 'main']);
		writeFileSync(join(root, 'a.txt'), 'a\n');
		git(['add', '.']);
		git(['commit', '-q', '-m', 'a']);
		git(['branch', 'origin/main']);
		git(['checkout', '-q', '-b', 'feat']);
		writeFileSync(join(root, 'b.txt'), 'b\n');
		git(['add', '.']);
		git(['commit', '-q', '-m', 'b']);
		return { root, git };
	};

	it('identifies the commit, tree, merge base and cleanliness', (t) => {
		const { root, git } = repo();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const current = currentIdentity(git);
		assert.equal(current.head, git(['rev-parse', 'HEAD']).trim());
		assert.equal(current.base, git(['rev-parse', 'main']).trim());
		assert.equal(current.clean, true);
		writeFileSync(join(root, 'c.txt'), 'untracked\n');
		assert.equal(currentIdentity(git).clean, false);
	});

	it('keeps the record in the git directory, where it cannot be committed', (t) => {
		const { root, git } = repo();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const path = recordPath(git, root);
		assert.equal(path, resolve(root, '.git', 'afd-verify-record.json'));
		writeRecord(path, recordFor());
		assert.deepEqual(readRecord(path), recordFor());
		assert.equal(currentIdentity(git).clean, true);
	});

	it('finds the record of the checkout git runs in, not of the root it is given (#2659)', (t) => {
		const here = repo();
		const there = repo();
		t.after(() => {
			rmSync(here.root, { recursive: true, force: true });
			rmSync(there.root, { recursive: true, force: true });
		});
		const expected = join(there.root, '.git', 'afd-verify-record.json');
		assert.equal(recordPath(there.git, here.root), expected);
		const current = currentIdentity(there.git);
		let read = null;
		decide({
			updates: push(current.head),
			git: there.git,
			read: (path) => {
				read = path;
				return null;
			},
			now: NOW,
		});
		assert.equal(read, expected);
	});

	it('pre-push accepts a record verify would write, and nothing for another commit', (t) => {
		const { root, git } = repo();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const current = currentIdentity(git);
		const record = buildRecord({
			before: current,
			after: current,
			results: passing,
			scope: 'affected',
			defaultBase: true,
			now: NOW,
		}).record;
		const read = () => record;
		assert.equal(decide({ updates: push(current.head), git, read, now: NOW }).accepted, true);
		assert.equal(decide({ updates: push(OTHER), git, read, now: NOW }).accepted, false);
		const broken = decide({
			updates: push(current.head),
			git,
			read: () => {
				throw new Error('bad JSON');
			},
			now: NOW,
		});
		assert.equal(broken.accepted, false);
		assert.match(broken.reason, /could not be read: bad JSON/);
	});

	it('pre-push accepts a push of only factory lane refs, without a record', () => {
		const queue = 'refs/factory/queue/lush/fleet-1';
		const git = () => {
			throw new Error('git must not run for a factory ref');
		};
		const read = () => null;
		const handOff = decide({ updates: push(OTHER, queue), git, read, now: NOW });
		assert.equal(handOff.accepted, true);
		assert.match(handOff.reason, /factory lane refs/);
		assert.equal(onlyFactoryRefs(push(OTHER, 'refs/factory/hosts/air')), true);
		assert.equal(onlyFactoryRefs(push(OTHER, 'refs/factory/other/x')), false);
		assert.equal(onlyFactoryRefs(`${queue} ${ZERO} ${queue} ${OTHER}\n`), true); // a deletion
		assert.equal(onlyFactoryRefs(push(OTHER, queue) + push(OTHER)), false); // with a branch
		assert.equal(onlyFactoryRefs(push(OTHER, 'refs/factory/queue/')), false);
		assert.equal(onlyFactoryRefs(push(OTHER, 'refs/heads/factory/queue/x')), false);
		assert.equal(onlyFactoryRefs(''), false);
		assert.equal(decide({ updates: push(OTHER), git, read, now: NOW }).accepted, false);
	});

	it('pre-push strips GIT_* hook variables before running pre-push-checks so suites cannot write to a decoy repo (#2257)', (t) => {
		const cleaned = cleanHookEnvironment({
			PATH: '/usr/bin',
			GIT_DIR: '/decoy/.git',
			GIT_INDEX_FILE: '/decoy/.git/index',
			Git_Work_Tree: '/decoy',
			CUSTOM_FLAG: '1',
		});
		assert.deepEqual(cleaned, { PATH: '/usr/bin', CUSTOM_FLAG: '1' });

		// Model a real git push hook: GIT_DIR and GIT_INDEX_FILE point at the repo running lefthook.
		const decoy = repo();
		t.after(() => rmSync(decoy.root, { recursive: true, force: true }));
		decoy.git(['config', 'user.name', 'Original Owner']);
		decoy.git(['config', 'user.email', 'owner@example.invalid']);

		// A check that creates its own temp repo without scrubbing GIT_* (the #2257 failure mode).
		const marker = join(decoy.root, 'probe-ran.txt');
		writeFileSync(
			join(decoy.root, 'probe-git.mjs'),
			[
				"import { execFileSync } from 'node:child_process';",
				"import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';",
				"import { tmpdir } from 'node:os';",
				"import { join } from 'node:path';",
				"const dir = mkdtempSync(join(tmpdir(), 'afd-pre-push-probe-'));",
				'try {',
				"  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });",
				"  run(['init', '-q', '-b', 'main']);",
				"  run(['config', 'user.name', 'Test']);",
				"  run(['config', 'user.email', 'test@example.invalid']);",
				"  writeFileSync(join(dir, 'probe.txt'), 'probe\\n');",
				"  run(['add', '.']);",
				"  run(['commit', '-q', '-m', 'probe']);",
				`  writeFileSync(${JSON.stringify(marker)}, 'ran\\n');`,
				'} finally {',
				'  rmSync(dir, { recursive: true, force: true });',
				'}',
			].join('\n')
		);
		writeFileSync(
			join(decoy.root, 'lefthook.yml'),
			'pre-push-checks:\n  parallel: false\n  commands:\n    probe:\n      run: node probe-git.mjs\n'
		);
		decoy.git(['add', 'probe-git.mjs', 'lefthook.yml']);
		decoy.git(['commit', '-q', '-m', 'add pre-push probe']);
		const decoyHeadBefore = decoy.git(['rev-parse', 'HEAD']).trim();

		const decoyGitDir = join(decoy.root, '.git');
		const baseEnv = { ...process.env };
		delete baseEnv.LEFTHOOK;
		delete baseEnv.LEFTHOOK_SKIP;
		runPrePushChecks({
			cwd: decoy.root,
			env: {
				...baseEnv,
				GIT_DIR: decoyGitDir,
				GIT_INDEX_FILE: join(decoyGitDir, 'index'),
			},
			stdio: 'pipe',
		});

		assert.equal(existsSync(marker), true, 'probe command must have executed');
		assert.equal(decoy.git(['rev-parse', 'HEAD']).trim(), decoyHeadBefore);
		assert.equal(decoy.git(['config', '--local', 'user.name']).trim(), 'Original Owner');
		assert.equal(decoy.git(['config', '--local', 'user.email']).trim(), 'owner@example.invalid');
	});
});
