import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createPublishPlan, saveIntent } from './release-control.mjs';
import { finalizeRelease } from './release-finalize.mjs';
import { notes } from './release-operations/publish.mjs';

const run = (root, command, args) =>
	execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function fixture(t) {
	const base = mkdtempSync(join(tmpdir(), 'afd-finalize-test-')),
		root = join(base, 'repo');
	mkdirSync(root);
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const write = (file, value) => {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
	};
	write('package.json', { name: 'fixture', private: true, packageManager: 'pnpm@10.30.1' });
	write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
	write('packages/a/package.json', { name: '@fixture/a', version: '1.0.0', files: ['index.js'] });
	write('packages/a/index.js', 'export const a = true;\n');
	write(
		'packages/a/CHANGELOG.md',
		'# fixture\n\n## 1.0.0\n\nNotes with `code`, $() and "quotes".\n'
	);
	write('.changeset/config.json', {});
	write('scripts/release/inventory.json', {
		schemaVersion: 1,
		roots: ['packages'],
		units: [
			{
				id: 'a',
				family: 'a',
				protocol: 'npm-changesets',
				sourceRevision: 'fixture',
				authority: 'github: fixture/repository',
				state: 'admitted',
				routes: ['npm-main'],
				gates: ['fixture'],
				fixed: true,
				distributions: [
					{
						name: '@fixture/a',
						registry: 'npm',
						manifest: 'packages/a/package.json',
						format: 'npm',
						initialVersion: '1.0.0',
					},
				],
			},
		],
	});
	run(root, 'git', ['init', '-b', 'main']);
	run(root, 'git', ['config', 'user.name', 'Fixture']);
	run(root, 'git', ['config', 'user.email', 'fixture@example.invalid']);
	run(root, 'git', ['add', '.']);
	run(root, 'git', ['commit', '-m', 'fixture']);
	run(root, 'git', ['remote', 'add', 'origin', 'https://github.com/fixture/repository.git']);
	saveIntent(root, ['a']);
	run(root, 'git', ['add', '.']);
	run(root, 'git', ['commit', '-m', 'reviewed release intent']);
	const plan = createPublishPlan({
		root,
		selectedUnits: ['a'],
		registryEvidence: [{ registry: 'npm', name: '@fixture/a', versions: [] }],
		artifactsDirectory: join(base, 'artifacts'),
	});
	const artifact = plan.artifacts[0],
		tag = '@fixture/a@1.0.0';
	run(root, 'git', ['tag', '-a', tag, '-m', tag]);
	const receipt = {
		binding: plan.binding,
		sourceRevision: plan.sourceRevision,
		intentDigest: plan.intentDigest,
		state: 'complete',
		publishedPackages: [
			{ name: artifact.name, version: artifact.version, tag, notes: notes(root, artifact) },
		],
	};
	const receiptFile = join(base, 'receipt.json');
	writeFileSync(receiptFile, JSON.stringify(receipt));
	const head = run(root, 'git', ['rev-parse', 'HEAD']).trim();
	return { root, base, plan, receipt, receiptFile, head, tag, write };
}
function spy(f, { remote = null, release = null, badIntegrity = false, failRelease = false } = {}) {
	const calls = [],
		effects = [],
		state = { remote, release };
	const command = (program, args, root) => {
		calls.push([program, ...args]);
		if (program === 'npm')
			return JSON.stringify(
				badIntegrity
					? 'sha512-wrong'
					: `sha512-${createHash('sha512').update(readFileSync(f.plan.artifacts[0].file)).digest('base64')}`
			);
		if (program === 'git' && args[0] === 'ls-remote')
			return state.remote ? `${state.remote}\trefs/tags/${f.tag}\n` : '';
		if (program === 'git' && args[0] === 'push') {
			effects.push(['push', ...args]);
			state.remote = f.head;
			return '';
		}
		if (program === 'gh' && args[0] === 'api') {
			if (state.release) return JSON.stringify(state.release);
			const error = new Error('not found');
			error.stderr = 'gh: Not Found (HTTP 404)';
			throw error;
		}
		if (program === 'gh' && args[0] === 'release') {
			effects.push(['release', ...args]);
			if (failRelease) throw new Error('GitHub unavailable');
			const noteFile = args[args.indexOf('--notes-file') + 1];
			assert.equal(readFileSync(noteFile, 'utf8'), f.receipt.publishedPackages[0].notes);
			state.release = {
				tag_name: f.tag,
				body: readFileSync(noteFile, 'utf8'),
				draft: false,
				prerelease: false,
			};
			return '';
		}
		return run(root, program, args);
	};
	return { command, calls, effects, state };
}
const finalize = (f, s) =>
	finalizeRelease({
		root: f.root,
		receipt: f.receipt,
		plan: f.plan,
		receiptFile: f.receiptFile,
		command: s.command,
	});

test('verified receipt pushes exact tag then creates release through a literal notes file', (t) => {
	const f = fixture(t),
		s = spy(f);
	const result = finalize(f, s);
	assert.equal(result.state, 'complete');
	assert.equal(s.effects.length, 2);
	assert.deepEqual(s.effects[0], [
		'push',
		'push',
		'origin',
		`refs/tags/${f.tag}:refs/tags/${f.tag}`,
	]);
	assert.equal(s.effects[1].includes('--verify-tag'), true);
	const noteFile = s.effects[1][s.effects[1].indexOf('--notes-file') + 1];
	assert.equal(existsSync(noteFile), false);
	assert.equal(
		s.calls.some(([program, args]) => program === 'npm' && args === 'publish'),
		false
	);
});
test('existing proven tag and matching release finalize idempotently with no mutation commands', (t) => {
	const f = fixture(t),
		s = spy(f, {
			remote: f.head,
			release: {
				tag_name: f.tag,
				body: f.receipt.publishedPackages[0].notes,
				draft: false,
				prerelease: false,
			},
		});
	finalize(f, s);
	finalize(f, s);
	assert.deepEqual(s.effects, []);
});
test('wrong local candidate tag rejects before effects', (t) => {
	const f = fixture(t);
	run(f.root, 'git', [
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.invalid',
		'commit',
		'--allow-empty',
		'-m',
		'new candidate',
	]);
	const s = spy(f);
	assert.throws(() => finalize(f, s), /Stale release candidate/);
	assert.deepEqual(s.effects, []);
});
test('wrong remote tag and mismatching existing release are never overwritten', (t) => {
	const f = fixture(t),
		s = spy(f, { remote: '0'.repeat(40) });
	assert.throws(() => finalize(f, s), /Remote tag differs/);
	assert.deepEqual(s.effects, []);
	const other = spy(f, {
		remote: f.head,
		release: { tag_name: f.tag, body: 'different', draft: false, prerelease: false },
	});
	assert.throws(() => finalize(f, other), /Existing GitHub release differs/);
	assert.deepEqual(other.effects, []);
});
test('fabricated, incomplete, stale and wrong-integrity receipts fail before effects', (t) => {
	const f = fixture(t),
		s = spy(f);
	f.receipt.binding = 'fabricated';
	assert.throws(() => finalize(f, s), /Invalid.*receipt/);
	assert.deepEqual(s.effects, []);
	f.receipt.binding = f.plan.binding;
	f.receipt.state = 'publishing';
	assert.throws(() => finalize(f, s), /Invalid.*receipt/);
	f.receipt.state = 'complete';
	const integrity = spy(f, { badIntegrity: true });
	assert.throws(() => finalize(f, integrity), /integrity differs/);
	assert.deepEqual(integrity.effects, []);
	f.receipt.publishedPackages[0].notes = 'fabricated notes';
	assert.throws(() => finalize(f, s), /outside the approved plan/);
	assert.deepEqual(s.effects, []);
});
test('partial finalization persists held error and requires reconciliation before retry', (t) => {
	const f = fixture(t),
		s = spy(f, { failRelease: true });
	assert.throws(() => finalize(f, s), /Finalization held.*reconcile/);
	assert.equal(JSON.parse(readFileSync(f.receiptFile)).finalization.state, 'held');
	assert.equal(s.effects[0][0], 'push');
	const retry = spy(f, { remote: f.head });
	assert.throws(() => finalize(f, retry), /unresolved publication receipt/);
	assert.deepEqual(retry.effects, []);
});
test('changed push authority rejects before GitHub or push effects', (t) => {
	const f = fixture(t);
	run(f.root, 'git', [
		'remote',
		'set-url',
		'--push',
		'origin',
		'https://github.com/evil/repository.git',
	]);
	const s = spy(f);
	assert.throws(() => finalize(f, s), /publisher authority/);
	assert.deepEqual(s.effects, []);
});

test('a local tag moved to another commit fails while the approved HEAD remains unchanged', (t) => {
	const f = fixture(t);
	const tree = run(f.root, 'git', ['rev-parse', 'HEAD^{tree}']).trim();
	const other = run(f.root, 'git', ['commit-tree', tree, '-m', 'other root commit']).trim();
	run(f.root, 'git', ['tag', '-fa', f.tag, other, '-m', f.tag]);
	const s = spy(f);
	assert.throws(() => finalize(f, s), /Local tag does not resolve to approved candidate/);
	assert.deepEqual(s.effects, []);
});
