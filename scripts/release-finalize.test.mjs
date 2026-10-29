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
function fixture(t, { twoPackages = false } = {}) {
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
	if (twoPackages) {
		write('packages/b/package.json', { name: '@fixture/b', version: '1.0.0', files: ['index.js'] });
		write('packages/b/index.js', 'export const b = true;\n');
		write('packages/b/CHANGELOG.md', '# fixture\n\n## 1.0.0\n\nSecond package notes\n');
		const path = join(root, 'scripts/release/inventory.json');
		const inventory = JSON.parse(readFileSync(path, 'utf8'));
		inventory.units[0].distributions.push({
			name: '@fixture/b',
			registry: 'npm',
			manifest: 'packages/b/package.json',
			format: 'npm',
			initialVersion: '1.0.0',
		});
		write('scripts/release/inventory.json', inventory);
	}
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
	const tag = '@fixture/a@1.0.0';
	for (const artifact of plan.artifacts)
		run(root, 'git', [
			'tag',
			'-a',
			`${artifact.name}@${artifact.version}`,
			'-m',
			`${artifact.name}@${artifact.version}`,
		]);
	const receipt = {
		binding: plan.binding,
		sourceRevision: plan.sourceRevision,
		intentDigest: plan.intentDigest,
		state: 'complete',
		publishedPackages: plan.artifacts.map((artifact) => ({
			name: artifact.name,
			version: artifact.version,
			tag: `${artifact.name}@${artifact.version}`,
			notes: notes(root, artifact),
		})),
	};
	const receiptFile = join(base, 'receipt.json');
	writeFileSync(receiptFile, JSON.stringify(receipt));
	const head = run(root, 'git', ['rev-parse', 'HEAD']).trim();
	return { root, base, plan, receipt, receiptFile, head, tag, write };
}
function spy(f, { remote = null, release = null, badIntegrity = false, failRelease = false } = {}) {
	const calls = [],
		effects = [],
		state = { remote, release, releases: new Map() };
	const command = (program, args, root) => {
		calls.push([program, ...args]);
		if (program === 'git' && args[0] === 'ls-remote')
			return state.remote ? `${state.remote}\t${args[3]}\n` : '';
		if (program === 'git' && args[0] === 'push') {
			effects.push(['push', ...args]);
			state.remote = f.head;
			return '';
		}
		if (program === 'gh' && args[0] === 'api') {
			const tag = decodeURIComponent(args[1].split('/').at(-1));
			const release = tag === f.tag ? state.release : state.releases.get(tag);
			if (release) return JSON.stringify(release);
			const error = new Error('not found');
			error.stderr = 'gh: Not Found (HTTP 404)';
			throw error;
		}
		if (program === 'gh' && args[0] === 'release') {
			effects.push(['release', ...args]);
			if (failRelease) throw new Error('GitHub unavailable');
			const noteFile = args[args.indexOf('--notes-file') + 1];
			assert.equal(
				readFileSync(noteFile, 'utf8'),
				f.receipt.publishedPackages.find((entry) => entry.tag === args[2]).notes
			);
			const created = {
				tag_name: args[2],
				body: readFileSync(noteFile, 'utf8'),
				draft: false,
				prerelease: false,
			};
			if (args[2] === f.tag) state.release = created;
			else state.releases.set(args[2], created);
			return '';
		}
		return run(root, program, args);
	};
	return {
		command,
		calls,
		effects,
		state,
		readback: (artifact) => ({
			name: artifact.name,
			version: artifact.version,
			dist: {
				integrity: badIntegrity
					? 'sha512-wrong'
					: `sha512-${createHash('sha512').update(readFileSync(artifact.file)).digest('base64')}`,
			},
		}),
	};
}
const finalize = (f, s) =>
	finalizeRelease({
		root: f.root,
		receipt: f.receipt,
		plan: f.plan,
		receiptFile: f.receiptFile,
		command: s.command,
		readback: s.readback,
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
	assert.throws(() => finalize(f, integrity), /readback is missing or uncertain/);
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

test('empty and duplicate completion receipts cannot finalize', (t) => {
	const f = fixture(t);
	const s = spy(f);
	for (const entries of [[], [f.receipt.publishedPackages[0], f.receipt.publishedPackages[0]]]) {
		assert.throws(
			() =>
				finalizeRelease({
					...f,
					receipt: { ...f.receipt, publishedPackages: entries },
					command: s.command,
				}),
			/Invalid/
		);
	}
	assert.deepEqual(s.effects, []);
});

test('one explicit tag batch runs from the built checkout while every target remains the frozen source', (t) => {
	const f = fixture(t, { twoPackages: true });
	const control = join(f.base, 'control');
	run(f.root, 'git', ['worktree', 'add', '--detach', control, f.head]);
	writeFileSync(join(control, 'controller.txt'), 'built checkout');
	run(control, 'git', ['add', '.']);
	run(control, 'git', ['commit', '-m', 'control tooling']);
	const hookHead = run(control, 'git', ['rev-parse', 'HEAD']).trim();
	assert.notEqual(hookHead, f.head);
	const s = spy(f),
		pushes = [];
	const result = finalizeRelease({
		...f,
		pushRoot: control,
		readback: s.readback,
		command: (program, args, directory) => {
			if (program === 'git' && args[0] === 'push') pushes.push({ args, directory });
			return s.command(program, args, directory);
		},
	});
	assert.equal(pushes.length, 1);
	assert.equal(pushes[0].directory, control);
	assert.deepEqual(pushes[0].args, [
		'push',
		'origin',
		'refs/tags/@fixture/a@1.0.0:refs/tags/@fixture/a@1.0.0',
		'refs/tags/@fixture/b@1.0.0:refs/tags/@fixture/b@1.0.0',
	]);
	assert.equal(result.head, f.head);
	assert.equal(result.hookHead, hookHead);
	assert.equal(result.tags.length, 2);
	assert.equal(s.effects.filter((entry) => entry[0] === 'release').length, 2);
});
test('a separate Git store with the same origin cannot supply the push context', (t) => {
	const f = fixture(t),
		foreign = fixture(t),
		s = spy(f);
	assert.throws(
		() =>
			finalizeRelease({ ...f, pushRoot: foreign.root, command: s.command, readback: s.readback }),
		/different Git common/
	);
	assert.deepEqual(s.effects, []);
});
