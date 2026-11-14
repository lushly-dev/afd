import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	hasStaleShape,
	matchesRecord,
	PROVENANCE_FAMILIES,
	provenancePaths,
} from './release/provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = PROVENANCE_FAMILIES['fast-af'].directory;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) =>
	createHash('sha1')
		.update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
		.digest('hex');
const record = (name) => JSON.parse(readFileSync(join(root, directory, name), 'utf8'));
const provenance = record('provenance.json');
const upstream = record('upstream-selected.json');
const adaptations = record('adaptations.json');

test("FAST-AF provenance records are bound by hash and match each unit's release state", () => {
	for (const entry of Object.values(provenance.records))
		assert.equal(sha(readFileSync(join(root, directory, entry.manifest))), entry.sha256);
	assert.equal(upstream.revision, provenance.source_revision);
	assert.equal(adaptations.source_revision, provenance.source_revision);
	const inventory = JSON.parse(readFileSync(join(root, 'scripts/release/inventory.json'), 'utf8'));
	const architecture = JSON.parse(readFileSync(join(root, 'architecture.json'), 'utf8'));
	for (const unit of provenance.units) {
		const manifestPath = `${unit.path}/package.json`;
		const owner = inventory.units.find((item) =>
			item.distributions.some((distribution) => distribution.name === unit.name)
		);
		// A preview unit is admitted on the prerelease route; every other unit stays quarantined.
		assert.ok(['preview', 'quarantined'].includes(unit.publication_state), unit.name);
		assert.equal(
			owner?.state,
			unit.publication_state === 'preview' ? 'admitted' : 'quarantined',
			unit.name
		);
		if (unit.publication_state === 'preview')
			assert.deepEqual([owner.routes, owner.distTag], [['npm-prerelease'], 'preview'], unit.name);
		assert.equal(owner.family, 'fast-af', unit.name);
		assert.equal(owner.sourceRevision, provenance.source_revision, unit.name);
		assert.equal(owner.distributions[0].manifest, manifestPath);
		const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
		assert.equal(manifest.private === true, unit.private === true, `${unit.name} private flag`);
		assert.equal(owner.distributions[0].private === true, unit.private === true, unit.name);
		const classified = architecture.units.find((item) => item.manifest === manifestPath);
		assert.deepEqual([classified?.family, classified?.layer], ['fast-af', unit.layer], unit.name);
	}
});

test('upstream license and notice files are imported verbatim', () => {
	for (const path of ['LICENSE', 'NOTICE.md', 'packages/element/LICENSE']) {
		const file = adaptations.files.find((entry) => entry.upstream_path === path);
		assert.equal(file?.path, `foundations/fast-af/${path}`, path);
		assert.equal(file.current_import_sha256, file.upstream_sha256, `${path} must stay verbatim`);
	}
	for (const [copy, original] of [
		['packages/element/packages/fast-element/LICENSE', 'packages/element/LICENSE'],
		['packages/violet-elements/LICENSE', 'LICENSE'],
	])
		assert.equal(
			sha(readFileSync(join(root, 'foundations/fast-af', copy))),
			upstream.files.find((file) => file.path === original).sha256,
			`${copy} is a verbatim copy of ${original}`
		);
});

test('every imported FAST-AF file is present, recorded and unchanged since review', () => {
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	// Untracked-but-unignored files count; an ignored source file would fail as missing.
	const present = provenancePaths(root, 'fast-af');
	const unrecorded = present.filter((path) => !recorded.has(path));
	assert.deepEqual(unrecorded, [], 'record new FAST-AF files in adaptations.json');
	for (const file of adaptations.files) {
		assert(existsSync(join(root, file.path)), `missing or ignored: ${file.path}`);
		assert(present.includes(file.path), `not visible to Git (check .gitignore): ${file.path}`);
		const bytes = readFileSync(join(root, file.path));
		assert(matchesRecord(file, bytes), `${file.path} changed; record the adaptation`);
		assert(
			!hasStaleShape(file, bytes),
			`${file.path}: its record's manifest_shape_sha256 is stale; run scripts/release/provenance.mjs`
		);
		if (file.import_classification === 'unchanged-staged')
			assert.equal(file.current_import_sha256, file.staged_sha256, file.path);
		if (file.stage_classification === 'unchanged-upstream')
			assert.equal(file.staged_sha256, file.upstream_sha256, file.path);
		assert(file.import_reason && file.stage_reason, `${file.path} needs reasons`);
	}
	const accounted = new Set(adaptations.files.map((file) => file.upstream_path).filter(Boolean));
	assert.deepEqual(
		upstream.files.map((file) => file.path).filter((path) => !accounted.has(path)),
		[],
		'every selected upstream file maps to an import'
	);
});

test('upstream Git object ids match the bytes of every file imported unchanged', () => {
	// The FAST-AF revision is not in this repository; unchanged bytes still prove the recorded ids.
	const byPath = new Map(upstream.files.map((file) => [file.path, file]));
	let checked = 0;
	for (const file of adaptations.files) {
		if (!file.upstream_path || file.current_import_sha256 !== file.upstream_sha256) continue;
		const bytes = readFileSync(join(root, file.path));
		assert.equal(blob(bytes), byPath.get(file.upstream_path).git_blob, file.path);
		checked++;
	}
	// Most of the import still matches upstream; the 79 story files now import Specimen's helpers,
	// the label-in-name change (#971) reached six more files, five of them specs, and the token
	// interface (#1190) adapted the files that hard-coded a typeface or read the generated theme
	// (636 on its branch alone; the count after #1194's repairs is set when they merge).
	assert(checked > 634, `only ${checked} unchanged upstream files`);
});
