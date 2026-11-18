import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	hasStaleShape,
	isRemoved,
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
		if (isRemoved(file)) {
			// A removed file's record is kept as history; the file must stay gone.
			assert(
				!present.includes(file.path),
				`${file.path} is back; run scripts/release/provenance.mjs`
			);
			assert.match(
				file.removed?.on ?? '',
				/^\d{4}-\d{2}-\d{2}$/,
				`${file.path} needs a removal date`
			);
			assert(file.removed.reason && file.removed.import_classification, `${file.path} removal`);
			continue;
		}
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
		if (isRemoved(file)) continue;
		if (!file.upstream_path || file.current_import_sha256 !== file.upstream_sha256) continue;
		const bytes = readFileSync(join(root, file.path));
		assert.equal(blob(bytes), byPath.get(file.upstream_path).git_blob, file.path);
		checked++;
	}
	// Most of the import still matches upstream; the 79 story files now import Specimen's helpers,
	// the label-in-name change (#971) reached six more files, five of them specs, the Lushly
	// repairs (#1191, merged in #1194) reached the data grid, its cell templates and its spec, and
	// the token interface (#1190) adapted the files that hard-coded a typeface or read the
	// generated theme, the Specimen preview and the grid's sizing spec, and the bounded bug fixes
	// (#1158, #1160-#1167) adapted 13 component and spec files, the cross-root ARIA references
	// (#1159) six more, the preview prerelease (#1192) changed fast-element's README install line,
	// and the type alias values (#1147) changed the manifest: 613 together. Microsoft FAST Element
	// 3.0.2-3.1.4, taken into fast-element, changed 85 more: 528. Scoping hydrated views and
	// disconnecting a replaced controller changed five more, a command spec, the scoped mixin, the
	// hydration runtime, render and view: 523. The runtime cleanup (#1385) removed 23 of them and
	// changed 19 more, among them `index.ts` and `fast-element.ts`, which match Microsoft's again,
	// not fast-af's: 481. violet-select's late options (#499) adapted its spec: 480. The Refined
	// design (#1430) restyled 23 components that still matched upstream, and its private-alias
	// fixes (#1436) the carousel and the reasoning block's spec: 455. AFD's theme as the built-in
	// default (D159, #1430) rewrote the literal fallbacks of the gantt's styles and the tab panel,
	// gave the message status its danger colour, took the message media's fallbacks to AFD's values
	// and added a read-only spec to the text area: 450. The form control hosts (#1385) adapted the
	// grid's keyboard resize spec: 449. A removed file's record is kept but not counted.
	assert(checked > 448, `only ${checked} unchanged upstream files`);
});
