import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { decide } from './pre-push.mjs';
import {
	acceptRecord,
	buildRecord,
	CHECK,
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

describe('in a repository', () => {
	const repo = () => {
		const root = mkdtempSync(join(tmpdir(), 'afd-verify-record-'));
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
});
