import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
	hasStaleShape,
	isRemoved,
	manifestShape,
	matchesRecord,
	recordProvenance,
	recordReleaseProvenance,
	violetBeforeRelease,
	violetInitialVersions,
} from './provenance.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const write = (root, file, text) => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(join(root, file), text);
};
const read = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

/** An envelope as every family commits it since #1610: no digest of `adaptations.json`. */
const ENVELOPE = `${JSON.stringify({ records: { adaptations: { manifest: 'adaptations.json' } } }, null, 2)}\n`;

/** A repository with Specimen's provenance layout: one imported manifest, recorded unchanged. */
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'afd-provenance-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const manifest = '{ "name": "@fixture/specimen", "version": "2.2.0-preview" }\n';
	write(root, 'foundations/specimen/package.json', manifest);
	write(
		root,
		'foundations/specimen/provenance/adaptations.json',
		`${JSON.stringify(
			{
				files: [
					{
						path: 'foundations/specimen/package.json',
						staged_sha256: sha(manifest),
						current_import_sha256: sha(manifest),
						import_classification: 'unchanged-staged',
						import_reason: 'Imported',
						stage_reason: 'Staged',
					},
				],
			},
			null,
			2
		)}\n`
	);
	write(root, 'foundations/specimen/provenance/provenance.json', ENVELOPE);
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
	return root;
}

test("a release's Changesets edits are recorded, and the envelope gains no digest", (t) => {
	const root = fixture(t);
	assert.deepEqual(recordReleaseProvenance(root, 'Versioned'), []);
	const versioned = '{ "name": "@fixture/specimen", "version": "2.2.0-preview.0" }\n';
	write(root, 'foundations/specimen/package.json', versioned);
	write(root, 'foundations/specimen/CHANGELOG.md', '# @fixture/specimen\n\n## 2.2.0-preview.0\n');
	// Only Specimen's layout exists here; the FAST-AF family is skipped, not an error.
	assert.deepEqual(recordReleaseProvenance(root, 'Versioned').sort(), [
		'foundations/specimen/CHANGELOG.md',
		'foundations/specimen/package.json',
	]);
	const adaptations = read(root, 'foundations/specimen/provenance/adaptations.json');
	const [manifest, changelog] = adaptations.files;
	assert.equal(manifest.current_import_sha256, sha(versioned));
	assert.equal(manifest.manifest_shape_sha256, manifestShape(Buffer.from(versioned)));
	assert.equal(changelog.manifest_shape_sha256, undefined, 'only manifests have a shape');
	assert.deepEqual(
		[manifest.import_classification, manifest.import_reason],
		['modified-after-staging', 'Versioned']
	);
	assert.deepEqual(
		[changelog.path, changelog.import_classification, changelog.import_reason],
		['foundations/specimen/CHANGELOG.md', 'added-after-import', 'Versioned']
	);
	assert.equal(
		readFileSync(join(root, 'foundations/specimen/provenance/provenance.json'), 'utf8'),
		ENVELOPE
	);
	// A second release appends its reason once.
	write(root, 'foundations/specimen/package.json', versioned.replace('.0"', '.1"'));
	recordProvenance(root, 'specimen', 'Again');
	recordProvenance(root, 'specimen', 'Again');
	assert.equal(
		read(root, 'foundations/specimen/provenance/adaptations.json').files[0].import_reason,
		'Versioned; Again'
	);
});

// #968 added an export to Specimen's manifest and updated the record's digest by hand. `main`
// passed, and every Dependabot update to that manifest then failed (#981, #982).
test('a digest updated by hand leaves a stale shape, which recording again refreshes', (t) => {
	const root = fixture(t);
	const reviewed = '{ "name": "@fixture/specimen", "dependencies": { "lit": "^3.0.0" } }\n';
	write(root, 'foundations/specimen/package.json', reviewed);
	recordProvenance(root, 'specimen', 'Reviewed');
	const records = 'foundations/specimen/provenance/adaptations.json';
	const record = () => read(root, records).files[0];
	assert.ok(!hasStaleShape(record(), Buffer.from(reviewed)));

	// A hand edit: a new field in the manifest, and only the digest in its record.
	const edited = reviewed.replace('"dependencies"', '"exports": {}, "dependencies"');
	write(root, 'foundations/specimen/package.json', edited);
	const adaptations = read(root, records);
	adaptations.files[0].current_import_sha256 = sha(edited);
	write(root, records, `${JSON.stringify(adaptations, null, 2)}\n`);
	assert.ok(matchesRecord(record(), Buffer.from(edited)), 'main passes');
	assert.ok(hasStaleShape(record(), Buffer.from(edited)));
	const bumped = Buffer.from(edited.replace('^3.0.0', '^3.3.1'));
	assert.ok(!matchesRecord(record(), bumped), 'a dependency update fails');

	assert.deepEqual(recordProvenance(root, 'specimen', 'Unused'), [
		'foundations/specimen/package.json',
	]);
	assert.ok(!hasStaleShape(record(), Buffer.from(edited)));
	assert.ok(matchesRecord(record(), bumped));
	assert.equal(
		record().import_reason,
		'Reviewed',
		'the file did not change, so no reason is added'
	);
	assert.equal(
		readFileSync(join(root, 'foundations/specimen/provenance/provenance.json'), 'utf8'),
		ENVELOPE
	);
	// After a dependency update the digest is behind and the shape current: not stale.
	assert.ok(!hasStaleShape(record(), bumped));
	// A file with no shape is never stale.
	assert.ok(!hasStaleShape({ current_import_sha256: sha(edited) }, Buffer.from(edited)));
});

test('a removed file keeps its record, classified as removed, and a returning one is restored', (t) => {
	const root = fixture(t);
	const records = 'foundations/specimen/provenance/adaptations.json';
	const record = () => read(root, records).files[0];
	const manifest = readFileSync(join(root, 'foundations/specimen/package.json'));
	// Stage the file before removing it from the working tree so unstaged tracked deletions are covered too.
	execFileSync('git', ['add', 'foundations/specimen/package.json'], { cwd: root });
	rmSync(join(root, 'foundations/specimen/package.json'));
	// Non-ASCII filenames must not be dropped by Git's default path quoting.
	write(root, 'foundations/specimen/café.json', '{}\n');
	// Only an explicit run records a removal: the default and the release path leave the record,
	// so the provenance tests fail on a file deleted by accident.
	assert.deepEqual(recordProvenance(root, 'specimen', 'Not asked'), [
		'foundations/specimen/café.json',
	]);
	assert.deepEqual(recordReleaseProvenance(root, 'Versioned'), []);
	assert.ok(!isRemoved(record()));
	const removed = { today: '2026-11-16', removals: true };
	assert.deepEqual(recordProvenance(root, 'specimen', 'Not needed', removed), [
		'foundations/specimen/package.json',
	]);
	assert.ok(isRemoved(record()));
	assert.deepEqual(record().removed, {
		on: '2026-11-16',
		reason: 'Not needed',
		import_classification: 'unchanged-staged',
	});
	// History stays: the digest and reasons it had are kept.
	assert.equal(record().current_import_sha256, sha(manifest));
	assert.equal(record().import_reason, 'Imported');
	assert.equal(
		readFileSync(join(root, 'foundations/specimen/provenance/provenance.json'), 'utf8'),
		ENVELOPE
	);
	// Recording again changes nothing: the removal is recorded once.
	assert.deepEqual(recordProvenance(root, 'specimen', 'Again', { removals: true }), []);

	// The same bytes come back: the earlier classification returns and the removal is history.
	write(root, 'foundations/specimen/package.json', manifest.toString('utf8'));
	assert.deepEqual(recordProvenance(root, 'specimen', 'Needed after all'), [
		'foundations/specimen/package.json',
	]);
	assert.ok(!isRemoved(record()));
	assert.equal(record().import_classification, 'unchanged-staged');
	assert.equal(record().removed, undefined);
	assert.deepEqual(record().earlier_removals, [
		{ on: '2026-11-16', reason: 'Not needed', import_classification: 'unchanged-staged' },
	]);
});

test('a recorded file that Git ignores is refused, not recorded as removed', (t) => {
	const root = fixture(t);
	write(root, '.gitignore', 'foundations/specimen/package.json\n');
	assert.throws(
		() => recordProvenance(root, 'specimen', 'Ignored', { removals: true }),
		/is on disk but ignored by Git/
	);
	assert.ok(!isRemoved(read(root, 'foundations/specimen/provenance/adaptations.json').files[0]));
});

test('a removed record without its earlier classification is refused when the file returns', (t) => {
	const root = fixture(t);
	const records = 'foundations/specimen/provenance/adaptations.json';
	const adaptations = read(root, records);
	adaptations.files[0].import_classification = 'removed-after-import';
	write(root, records, `${JSON.stringify(adaptations, null, 2)}\n`);
	assert.throws(
		() => recordProvenance(root, 'specimen', 'Back'),
		/without `removed.import_classification`/
	);
});

test("recording keeps the envelope's bytes, which hold no adaptations digest (#1610)", (t) => {
	const root = mkdtempSync(join(tmpdir(), 'afd-provenance-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const directory = 'foundations/fast-af/provenance';
	write(root, `${directory}/adaptations.json`, `${JSON.stringify({ files: [] }, null, 2)}\n`);
	write(root, `${directory}/provenance.json`, ENVELOPE);
	write(root, 'foundations/fast-af/src/a.ts', 'export const a = 1;\n');
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
	assert.deepEqual(recordProvenance(root, 'fast-af', 'Added'), ['foundations/fast-af/src/a.ts']);
	assert.equal(read(root, `${directory}/adaptations.json`).files[0].import_reason, 'Added');
	assert.equal(readFileSync(join(root, directory, 'provenance.json'), 'utf8'), ENVELOPE);
});

for (const family of ['fast-af', 'specimen'])
	test(`the recorder removes a ${family} digest an older base:sync merged back (#1610)`, (t) => {
		const root = mkdtempSync(join(tmpdir(), 'afd-provenance-'));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const directory = `foundations/${family}/provenance`;
		const adaptations = `${JSON.stringify({ files: [] }, null, 2)}\n`;
		write(root, `${directory}/adaptations.json`, adaptations);
		// The old resolver's output: every record's sha256 recomputed, adaptations.json's included.
		const merged = {
			records: { adaptations: { manifest: 'adaptations.json', sha256: sha(adaptations) } },
		};
		write(root, `${directory}/provenance.json`, `${JSON.stringify(merged, null, 2)}\n`);
		execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
		const heard = [];
		const onDigest = (outcome) => heard.push(outcome);
		// Nothing to record: the repair alone.
		assert.deepEqual(recordProvenance(root, family, 'Repair', { onDigest }), []);
		assert.deepEqual(heard, ['removed']);
		assert.equal(readFileSync(join(root, directory, 'provenance.json'), 'utf8'), ENVELOPE);
		assert.equal(readFileSync(join(root, directory, 'adaptations.json'), 'utf8'), adaptations);
		assert.deepEqual(recordProvenance(root, family, 'Again', { onDigest }), []);
		assert.deepEqual(heard, ['removed'], 'a second run finds nothing to repair');
	});

test('recording requires a known family and a reason', (t) => {
	const root = fixture(t);
	assert.throws(() => recordProvenance(root, 'violet', 'x'), /No provenance for family: violet/);
	assert.throws(() => recordProvenance(root, 'specimen', ' '), /reason is required/);
});

test('a manifest whose dependency ranges alone changed still matches its record', () => {
	const reviewed = `${JSON.stringify(
		{
			name: '@fixture/specimen',
			scripts: { test: 'vitest' },
			dependencies: { lit: '^3.0.0' },
			devDependencies: { typescript: '~5.9.3', vitest: '^3.2.0' },
		},
		null,
		'\t'
	)}\n`;
	const file = {
		current_import_sha256: sha(reviewed),
		manifest_shape_sha256: manifestShape(Buffer.from(reviewed)),
	};
	const edit = (from, to) => Buffer.from(reviewed.replace(from, to));
	assert.ok(matchesRecord(file, Buffer.from(reviewed)));
	// A Dependabot update: ranges move, nothing else does.
	assert.ok(matchesRecord(file, edit('~5.9.3', '~7.0.2')));
	assert.ok(matchesRecord(file, edit('^3.0.0', '^3.3.1')));
	// Anything else is an adaptation to record: a dependency added or renamed, or another field.
	assert.ok(!matchesRecord(file, edit('"lit"', '"lit-html"')));
	assert.ok(!matchesRecord(file, edit('"vitest": "^3.2.0"', '"vitest": "^3.2.0",\n\t\t"x": "1"')));
	assert.ok(!matchesRecord(file, edit('"test": "vitest"', '"test": "vitest run"')));
	// A record without a shape (any file but a manifest) matches its digest only.
	assert.ok(
		!matchesRecord({ current_import_sha256: file.current_import_sha256 }, edit('~5.9.3', '~7.0.2'))
	);
});

test('violetBeforeRelease reverses Changesets version and changelog edits without external deps', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'afd-violet-before-release-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	write(
		root,
		'scripts/release/inventory.json',
		JSON.stringify({
			units: [
				{
					id: 'violet-npm',
					distributions: [
						{
							name: '@lushly-dev/violet-cli',
							manifest: 'endpoints/violet-cli/package.json',
							initialVersion: '0.3.0-preview',
						},
					],
				},
			],
		})
	);
	const versions = violetInitialVersions(root);
	assert.equal(versions.get('endpoints/violet-cli'), '0.3.0-preview');

	const pkg =
		'{\n  "name": "@lushly-dev/violet-cli",\n  "version": "0.3.0-preview.10",\n  "dependencies": { "@lushly-dev/violet-core": "workspace:^0.3.0-preview.10" }\n}\n';
	write(root, 'endpoints/violet-cli/package.json', pkg);
	const prePkg = violetBeforeRelease(
		root,
		'endpoints/violet-cli/package.json',
		Buffer.from(pkg),
		versions
	).toString('utf8');
	assert.ok(prePkg.includes('"version": "0.3.0-preview"'));
	assert.ok(prePkg.includes('"workspace:^0.3.0-preview"'));

	// Prerelease precedence: 0.3.0-preview.10 > 0.3.0-preview.2 > 0.3.0-preview > 0.2.0.
	const log =
		'# @lushly-dev/violet-cli\n\n## 0.3.0-preview.10\n\n- Tenth\n\n## 0.3.0-preview.2\n\n- Second\n\n## 0.2.0\n\n- Older\n';
	const preLog = violetBeforeRelease(
		root,
		'endpoints/violet-cli/CHANGELOG.md',
		Buffer.from(log),
		versions
	).toString('utf8');
	assert.equal(preLog, '# @lushly-dev/violet-cli\n\n## 0.2.0\n\n- Older\n');

	// Non-release files pass through unchanged.
	const src = Buffer.from('export const x = 1;\n');
	assert.deepEqual(
		violetBeforeRelease(root, 'endpoints/violet-cli/src/bin.ts', src, versions),
		src
	);
});
