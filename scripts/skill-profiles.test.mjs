import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { projectText, syncProfiles } from './skill-profiles.mjs';

async function fixture(t) {
	const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'afd-skill-profile-')));
	t.after(() => rm(root, { recursive: true, force: true }));
	async function put(file, content) {
		await mkdir(path.dirname(path.join(root, file)), { recursive: true });
		await writeFile(path.join(root, file), content);
	}
	const manifest = {
		version: 1,
		canonical: {
			owner: 'botcore',
			root: 'bundled',
			skills: ['code-reviewer', 'commit'],
			resources: 'complete-tree',
		},
		profiles: {
			afd: {
				root: '.claude/skills',
				mirror: '.codex/skills',
				projections: [{ name: 'review-code', canonical: 'code-reviewer' }],
				overrides: [{ name: 'do-commit', canonical: 'commit', owner: 'afd' }],
				local: ['afd'],
			},
		},
	};
	await put('skills/exports.json', JSON.stringify(manifest));
	await put(
		'bundled/code-reviewer/SKILL.md',
		'---\nname: code-reviewer\nsource: botcore\ndescription: Review code\n---\nSee [guide](references/guide.md), the `code-reviewer` skill and ../commit/SKILL.md.\n'
	);
	await put('bundled/code-reviewer/references/guide.md', '# Guide\n');
	await put('bundled/code-reviewer/assets/sample.bin', Buffer.from([0, 1, 255]));
	await put('bundled/commit/SKILL.md', '---\nname: commit\n---\nCanonical commit.\n');
	await put(
		'.claude/skills/do-commit/SKILL.md',
		'---\nname: do-commit\nsource: afd\n---\nPreserved workflow.\n'
	);
	await put('.claude/skills/do-commit/references/local.md', 'Preserved local resource.');
	await put('.claude/skills/afd/SKILL.md', 'Local AFD guidance.');
	await mkdir(path.join(root, '.codex'));
	await symlink('../.claude/skills', path.join(root, '.codex/skills'));
	return { root, put, manifest, save: () => put('skills/exports.json', JSON.stringify(manifest)) };
}

test('complete-tree projections are deterministic and preserve aliases, overrides, assets, and Codex mirror', async (t) => {
	const { root } = await fixture(t);
	assert.equal((await syncProfiles(root)).length, 3);
	await syncProfiles(root, { write: true });
	assert.deepEqual(await syncProfiles(root), []);
	const projected = await readFile(path.join(root, '.claude/skills/review-code/SKILL.md'), 'utf8');
	assert.match(projected, /name: review-code/);
	assert.match(projected, /the `review-code` skill and \.\.\/do-commit\/SKILL.md/);
	assert.match(projected, /Generated from skills\/exports.json/);
	assert.deepEqual(
		await readFile(path.join(root, '.claude/skills/review-code/assets/sample.bin')),
		Buffer.from([0, 1, 255])
	);
	assert.equal(
		await readFile(path.join(root, '.claude/skills/do-commit/references/local.md'), 'utf8'),
		'Preserved local resource.'
	);
	assert.equal(
		await readFile(path.join(root, '.claude/skills/do-commit/SKILL.md'), 'utf8'),
		'---\nname: do-commit\nsource: afd\n---\nPreserved workflow.\n'
	);
	assert.equal(await readlink(path.join(root, '.codex/skills')), '../.claude/skills');
});

test('canonical edits and added resources produce check drift without writing', async (t) => {
	const { root, put } = await fixture(t);
	await syncProfiles(root, { write: true });
	await put('bundled/code-reviewer/references/guide.md', 'Updated canonical guide.');
	await put('bundled/code-reviewer/scripts/run.py', 'print("hello")\n');
	assert.deepEqual(await syncProfiles(root), [
		'.claude/skills/review-code/references/guide.md',
		'.claude/skills/review-code/scripts/run.py',
	]);
	assert.equal(
		await readFile(path.join(root, '.claude/skills/review-code/references/guide.md'), 'utf8'),
		'# Guide\n'
	);
	await syncProfiles(root, { write: true });
	assert.deepEqual(await syncProfiles(root), []);
});

test('unknown local resources fail preflight and are never deleted or overwritten', async (t) => {
	const { root, put } = await fixture(t);
	await syncProfiles(root, { write: true });
	await put('.claude/skills/review-code/references/custom.md', 'Consumer customization');
	await put('bundled/code-reviewer/references/guide.md', 'Upstream change');
	await assert.rejects(syncProfiles(root, { write: true }), /Unknown local resource.*custom.md/);
	assert.equal(
		await readFile(path.join(root, '.claude/skills/review-code/references/custom.md'), 'utf8'),
		'Consumer customization'
	);
	assert.equal(
		await readFile(path.join(root, '.claude/skills/review-code/references/guide.md'), 'utf8'),
		'# Guide\n'
	);
});

test('new canonical skills and unclassified local skills require manifest reconciliation', async (t) => {
	const { root, put } = await fixture(t);
	await put('bundled/new-skill/SKILL.md', 'New canonical skill');
	await assert.rejects(syncProfiles(root), /Canonical catalog drift/);
	await rm(path.join(root, 'bundled/new-skill'), { recursive: true });
	await put('.claude/skills/custom/SKILL.md', 'Custom local skill');
	await assert.rejects(syncProfiles(root), /Unclassified local skill: custom/);
});

test('rejects traversal, external paths, symlink resources and redirected mirror without mutations', async (t) => {
	const { root, manifest, save, put } = await fixture(t);
	for (const invalid of [
		'../external',
		'/tmp/external',
		'bundled/../external',
		'bundled\\external',
	]) {
		manifest.canonical.root = invalid;
		await save();
		await assert.rejects(syncProfiles(root, { write: true }), /repository-relative path/);
	}
	manifest.canonical.root = 'bundled';
	await save();
	await symlink('guide.md', path.join(root, 'bundled/code-reviewer/references/linked.md'));
	await assert.rejects(syncProfiles(root, { write: true }), /Symlink in skill tree/);
	await rm(path.join(root, 'bundled/code-reviewer/references/linked.md'));
	await rm(path.join(root, '.codex/skills'));
	await symlink('../bundled', path.join(root, '.codex/skills'));
	await assert.rejects(syncProfiles(root, { write: true }), /Invalid skill mirror/);
	await rm(path.join(root, '.codex/skills'));
	await symlink('../.claude/skills', path.join(root, '.codex/skills'));
	await put('.claude/skills/review-code/references/guide.md', 'local');
	await rm(path.join(root, '.claude/skills/review-code/references/guide.md'));
	await symlink(
		path.join(root, 'bundled/code-reviewer/references/guide.md'),
		path.join(root, '.claude/skills/review-code/references/guide.md')
	);
	await assert.rejects(syncProfiles(root, { write: true }), /Symlink in skill tree/);
});

test('rewrites exact skill identifiers and explicit short invocations, preserving ordinary words and commands', () => {
	const text =
		'---\nname: hotfix\n---\nUse `commit` first, then `release patch`. Keep the `hotfix` label, git commit, gh pr review and release notes. See ../code-reviewer/SKILL.md and the code-reviewer skill.\n';
	const entry = {
		name: 'do-hotfix',
		canonical: 'hotfix',
		rewrites: {
			'SKILL.md': [
				['`commit`', '`do-commit`'],
				['`release patch`', '`do-release patch`'],
			],
		},
	};
	const output = projectText(text, entry, [['code-reviewer', 'review-code']], 'SKILL.md');
	assert.match(output, /`do-commit` first, then `do-release patch`/);
	assert.match(output, /Keep the `hotfix` label, git commit, gh pr review and release notes/);
	assert.match(output, /\.\.\/review-code\/SKILL.md and the review-code skill/);
	assert.throws(
		() =>
			projectText(
				text,
				{ ...entry, rewrites: { 'SKILL.md': [['missing', 'replacement']] } },
				[],
				'SKILL.md'
			),
		/Stale explicit rewrite/
	);
});

test('CLI JSON reports freshness and actionable drift with nonzero status, bound to the script repository', async (t) => {
	const { root, put } = await fixture(t);
	await put(
		'scripts/skill-profiles.mjs',
		await readFile(new URL('./skill-profiles.mjs', import.meta.url))
	);
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT')
	);
	const run = (...args) =>
		spawnSync(process.execPath, [path.join(root, 'scripts/skill-profiles.mjs'), ...args], {
			cwd: os.tmpdir(),
			env: environment,
			encoding: 'utf8',
		});
	const initial = run('--check', '--json');
	assert.equal(initial.status, 1, initial.stderr);
	assert.equal(initial.stderr, '');
	const initialData = JSON.parse(initial.stdout);
	assert.equal(initialData.success, false);
	assert.equal(initialData.mode, 'check');
	assert.equal(initialData.changed.length, 3);
	assert.ok(initialData.changed.includes('.claude/skills/review-code/SKILL.md'));
	const generated = run('--json', '--write');
	assert.equal(generated.status, 0, generated.stderr);
	assert.deepEqual(JSON.parse(generated.stdout), {
		success: true,
		changed: initialData.changed,
		mode: 'write',
	});
	const current = run('--json');
	assert.equal(current.status, 0, current.stderr);
	assert.deepEqual(JSON.parse(current.stdout), { success: true, changed: [], mode: 'check' });
	await put('bundled/code-reviewer/references/guide.md', 'Canonical drift.');
	const drift = run('--json', '--check');
	assert.equal(drift.status, 1, drift.stderr);
	assert.deepEqual(JSON.parse(drift.stdout), {
		success: false,
		changed: ['.claude/skills/review-code/references/guide.md'],
		mode: 'check',
	});
	assert.equal(
		await readFile(path.join(root, '.claude/skills/review-code/references/guide.md'), 'utf8'),
		'# Guide\n'
	);
	const unsafe = run('--check', '--write', '--json');
	assert.equal(unsafe.status, 1);
	assert.equal(unsafe.stdout, '');
	assert.match(unsafe.stderr, /Usage:/);
});
