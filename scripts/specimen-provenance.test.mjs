import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'foundations/specimen/provenance';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const record = (name) => JSON.parse(readFileSync(join(root, directory, name), 'utf8'));
const provenance = record('provenance.json');
const upstream = record('upstream-selected.json');
const adaptations = record('adaptations.json');
const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });

test('Specimen provenance records are bound by hash and remain quarantined', () => {
	for (const entry of Object.values(provenance.records))
		assert.equal(sha(readFileSync(join(root, directory, entry.manifest))), entry.sha256);
	assert.equal(upstream.revision, provenance.source_revision);
	assert.equal(adaptations.source_revision, provenance.source_revision);
	assert.equal(provenance.publication_state, 'quarantined');
	const inventory = JSON.parse(readFileSync(join(root, 'scripts/release/inventory.json'), 'utf8'));
	for (const unit of provenance.units) {
		const owner = inventory.units.find((item) =>
			item.distributions.some((distribution) => distribution.name === unit.name)
		);
		assert.equal(owner?.state, 'quarantined', unit.name);
		assert.equal(owner.sourceRevision, provenance.source_revision, unit.name);
		assert.equal(owner.distributions[0].manifest, `${unit.path}/package.json`);
	}
});

test('every imported Specimen file is present, recorded and unchanged since review', () => {
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	const paths = [
		'foundations/specimen',
		'integrations/specimen-afd',
		'endpoints/specimen-cli',
		'docs/features/active/specimens',
		'docs/features/active/platform-monorepo/specimen-transition.md',
		'tests/consumers/specimen',
	];
	// Untracked-but-unignored files count; an ignored source file would fail as missing.
	const present = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths])
		.toString()
		.split('\n')
		.filter((path) => path && !path.startsWith(`${directory}/`));
	const unrecorded = present.filter((path) => !recorded.has(path));
	assert.deepEqual(unrecorded, [], 'record new Specimen files in adaptations.json');
	for (const file of adaptations.files) {
		assert(existsSync(join(root, file.path)), `missing or ignored: ${file.path}`);
		assert(present.includes(file.path), `not visible to Git (check .gitignore): ${file.path}`);
		assert.equal(
			sha(readFileSync(join(root, file.path))),
			file.current_import_sha256,
			`${file.path} changed; record the adaptation`
		);
		if (file.import_classification === 'unchanged-staged')
			assert.equal(file.current_import_sha256, file.staged_sha256, file.path);
		if (file.stage_classification === 'unchanged-upstream')
			assert.equal(file.staged_sha256, file.upstream_sha256, file.path);
		if (
			file.import_classification !== 'unchanged-staged' ||
			file.stage_classification.includes('modified')
		)
			assert(file.import_reason && file.stage_reason, `${file.path} needs reasons`);
	}
	const upstreamPaths = new Set(upstream.files.map((file) => file.path));
	const accounted = new Set(adaptations.files.map((file) => file.upstream_path).filter(Boolean));
	assert.deepEqual(
		[...upstreamPaths].filter((path) => !accounted.has(path)),
		[],
		'every selected upstream file maps to an import'
	);
});

test('upstream hashes match the immutable source objects when the revision is available', (t) => {
	try {
		git(['cat-file', '-e', `${upstream.revision}^{commit}`]);
	} catch {
		t.skip('source revision not fetched (shallow checkout); hashes were verified at import');
		return;
	}
	assert.equal(
		git(['rev-parse', `${upstream.revision}^{tree}`])
			.toString()
			.trim(),
		upstream.git_tree
	);
	for (const file of upstream.files)
		assert.equal(sha(git(['cat-file', 'blob', file.git_blob])), file.sha256, file.path);
});
