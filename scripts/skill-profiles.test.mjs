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
import {
	declaresOwner,
	listingCharacters,
	listingFields,
	projectText,
	syncProfiles,
} from './skill-profiles.mjs';

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
				listingBudget: 1000,
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

test('listing fields follow YAML scalar semantics and fail closed outside the supported subset', () => {
	const doc = (frontmatter) => `---\n${frontmatter}\n---\nBody.\n`;
	assert.deepEqual(
		listingFields(
			doc(
				'name: x\ndescription: >\n  Folded first\n  line.\n\n  Second.\nwhen_to_use: "Use when \\"quoted\\"."\ntriggers:\n  - ignored'
			)
		),
		{ description: 'Folded first line.\nSecond.\n', when_to_use: 'Use when "quoted".' }
	);
	assert.equal(listingFields(doc('description: >\n  Last field.')).description, 'Last field.');
	assert.equal(
		listingFields(doc('description: >-\n  Stripped.\nname: x')).description,
		'Stripped.'
	);
	assert.equal(listingFields(doc('description: |\n  a\n  b\nname: x')).description, 'a\nb\n');
	assert.equal(listingFields(doc("description: 'It''s plain'")).description, "It's plain");
	assert.equal(
		listingFields(doc('description: Plain words # comment\n  continue here')).description,
		'Plain words continue here'
	);
	assert.deepEqual(listingFields('No frontmatter.'), {});
	assert.equal(
		listingFields(`\uFEFF${doc('description: After a BOM')}`).description,
		'After a BOM'
	);
	assert.deepEqual(listingFields(doc('description:\nname: x')), { description: undefined });
	assert.deepEqual(listingFields(doc('description: # only a comment')), { description: undefined });
	assert.equal(listingFields(doc('# comment\n- stray item\ndescription: x')).description, 'x');
	for (const [value, disabled] of [
		['true', true],
		['TRUE # user-only', true],
		['"true"', false],
		['false', false],
	])
		assert.equal(
			listingFields(doc(`disable-model-invocation: ${value}`))['disable-model-invocation'],
			disabled
		);
	for (const unsupported of [
		'description: >2\n  explicit indent',
		'description: >+\n  keep',
		'description: "open\n  quote"',
		'description:\n  nested: map',
		'description: >\n  folded\n    more indented',
		'description: ~',
		'description: null',
		'description: [a, b]',
		'description: &anchor text',
		'description: *alias',
		'description: !tag text',
		'description: plain\n  # comment inside\n  more',
		'"description": quoted key',
		'description : spaced key',
		'description: first\ndescription: second',
		'disable-model-invocation:\n  true',
		'description:\n- a\n- b',
	])
		assert.throws(() => listingFields(doc(unsupported)), /Unsupported|Duplicate/, unsupported);
});

test('override ownership reads metadata.source, with the top-level form for older files', () => {
	const doc = (frontmatter) => `---\nname: x\n${frontmatter}\n---\nBody.\n`;
	assert.equal(declaresOwner(doc('metadata:\n  version: 1.0.0\n  source: afd'), 'afd'), true);
	assert.equal(declaresOwner(doc('source: afd'), 'afd'), true);
	assert.equal(declaresOwner(doc('metadata:\n  source: botcore'), 'afd'), false);
	assert.equal(declaresOwner(doc('metadata:\n  source: afd-extra'), 'afd'), false);
	assert.equal(declaresOwner(doc('description: x\n  source: afd'), 'afd'), false);
	assert.equal(declaresOwner('No frontmatter.', 'afd'), false);
});

test('listing characters count description and when_to_use, skip user-only skills and cap descriptions', () => {
	const doc = (frontmatter) => `---\n${frontmatter}\n---\n`;
	assert.equal(listingCharacters(doc('description: abc\nwhen_to_use: de'), 's'), 5);
	assert.equal(listingCharacters(doc('description: abc\ndisable-model-invocation: true'), 's'), 0);
	assert.equal(listingCharacters(doc('description: abc\ndisable-model-invocation: True'), 's'), 0);
	assert.equal(listingCharacters(doc('description: abc\ndisable-model-invocation: false'), 's'), 3);
	assert.equal(
		listingCharacters(doc('description: abc\ndisable-model-invocation: "true"'), 's'),
		3
	);
	// Hosts list a skill without a description by its first body paragraph.
	assert.equal(listingCharacters('Local guidance without frontmatter.', 's'), 35);
	assert.equal(
		listingCharacters(
			'---\nname: s\n---\n<!-- generated -->\n\n# Title\n\nFirst paragraph\nwraps.\n\nSecond.\n',
			's'
		),
		'First paragraph wraps.'.length
	);
	for (const empty of ['description: ""', 'description: >', 'description:'])
		assert.equal(listingCharacters(`---\n${empty}\n---\nBody text.\n`, 's'), 10, empty);
	assert.equal(listingFields(doc('triggers:\n- a\ndescription: x')).description, 'x');
	for (const disabled of ['', '\ndisable-model-invocation: true'])
		assert.throws(
			() => listingCharacters(doc(`description: ${'x'.repeat(1025)}${disabled}`), 'long'),
			/Description over 1024 characters: long/
		);
	assert.throws(
		() => listingCharacters(doc('description: ~'), 'broken-skill'),
		/Unsupported description value: ~ \(broken-skill\)/
	);
});

test('profiles must declare a listing budget, and an over-budget listing fails before writing', async (t) => {
	const { root, put, manifest, save } = await fixture(t);
	const listings = [];
	await syncProfiles(root, { onListing: (...entry) => listings.push(entry) });
	// review-code's description (11) plus the first paragraphs of do-commit (19) and afd (19).
	assert.deepEqual(listings, [['afd', { characters: 49, budget: 1000, skills: 3 }]]);
	await put(
		'.claude/skills/afd/SKILL.md',
		'---\nname: afd\ndescription: Local AFD guidance\n---\n'
	);
	manifest.profiles.afd.listingBudget = 20;
	await save();
	await assert.rejects(
		syncProfiles(root, { write: true }),
		/over budget for afd: 48 description characters exceed listingBudget 20.*\(largest: do-commit \(19\), afd \(18\), review-code \(11\)\)/
	);
	await assert.rejects(readFile(path.join(root, '.claude/skills/review-code/SKILL.md')), {
		code: 'ENOENT',
	});
	for (const invalid of [undefined, 0, 1.5, '100']) {
		manifest.profiles.afd.listingBudget = invalid;
		await save();
		await assert.rejects(syncProfiles(root), /listingBudget must be a positive integer: afd/);
	}
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
	const human = run();
	assert.equal(human.status, 0, human.stderr);
	assert.equal(
		human.stdout,
		'Skill profiles match canonical sources.\nSkill listing (afd): 49 of 1000 description characters across 3 skills.\n'
	);
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
