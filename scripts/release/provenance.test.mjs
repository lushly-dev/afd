import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { recordProvenance, recordReleaseProvenance } from './provenance.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const write = (root, file, text) => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(join(root, file), text);
};
const read = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

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
	const adaptations = readFileSync(join(root, 'foundations/specimen/provenance/adaptations.json'));
	write(
		root,
		'foundations/specimen/provenance/provenance.json',
		`${JSON.stringify({ records: { adaptations: { manifest: 'adaptations.json', sha256: sha(adaptations) } } }, null, 2)}\n`
	);
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
	return root;
}

test("a release's Changesets edits are recorded, and the records' digest follows them", (t) => {
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
	assert.deepEqual(
		[manifest.import_classification, manifest.import_reason],
		['modified-after-staging', 'Versioned']
	);
	assert.deepEqual(
		[changelog.path, changelog.import_classification, changelog.import_reason],
		['foundations/specimen/CHANGELOG.md', 'added-after-import', 'Versioned']
	);
	assert.equal(
		read(root, 'foundations/specimen/provenance/provenance.json').records.adaptations.sha256,
		sha(readFileSync(join(root, 'foundations/specimen/provenance/adaptations.json')))
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

test('recording requires a known family and a reason', (t) => {
	const root = fixture(t);
	assert.throws(() => recordProvenance(root, 'violet', 'x'), /No provenance for family: violet/);
	assert.throws(() => recordProvenance(root, 'specimen', ' '), /reason is required/);
});
