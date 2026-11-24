import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import {
	hasStaleShape,
	matchesRecord,
	violetBeforeRelease,
	violetInitialVersions,
} from './release/provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'foundations/violet/provenance';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) =>
	createHash('sha1')
		.update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
		.digest('hex');
const record = (name) => JSON.parse(readFileSync(join(root, directory, name), 'utf8'));
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const provenance = record('provenance.json');
const upstream = record('upstream-selected.json');
const adaptations = record('adaptations.json');
const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
const unchanged = new Set(['unchanged', 'moved-unchanged', 'fixture-copy']);
const inventory = json('scripts/release/inventory.json');
const initialVersion = violetInitialVersions(root);
const beforeRelease = (path, bytes) => violetBeforeRelease(root, path, bytes, initialVersion);

test('Violet provenance records are bound by hash and every unit is admitted for the preview', () => {
	const { adaptations: changing, ...frozen } = provenance.records;
	for (const entry of Object.values(frozen))
		assert.equal(sha(readFileSync(join(root, directory, entry.manifest))), entry.sha256);
	// Each row's current_import_sha256 still binds the record to its file (below). The digest of
	// adaptations.json, which changes with every edit, is not committed: its one line made any two
	// branches that recorded different files conflict (#1610).
	assert.equal(changing.manifest, 'adaptations.json');
	assert(
		!('sha256' in changing),
		"do not commit adaptations.json's digest (#1610). A merge made by an older pnpm base:sync " +
			`puts it back: delete records.adaptations.sha256 from ${directory}/provenance.json`
	);
	assert.equal(upstream.revision, provenance.source_revision);
	assert.equal(adaptations.source_revision, provenance.source_revision);
	// Handed over to AFD's release.yml on 2026-11-14 (violet-handoff.md), under the preview npm tag.
	assert.equal(provenance.publication_state, 'preview');
	const architecture = json('architecture.json');
	for (const unit of provenance.units) {
		const manifestPath = `${unit.path}/package.json`;
		const owner = inventory.units.find((item) =>
			item.distributions.some((distribution) => distribution.name === unit.name)
		);
		assert.equal(owner?.id, 'violet-npm', unit.name);
		assert.equal(owner.state, 'admitted', unit.name);
		assert.deepEqual([owner.routes, owner.distTag], [['npm-prerelease'], 'preview'], unit.name);
		assert.equal(owner.family, 'violet', unit.name);
		assert.equal(owner.sourceRevision, provenance.source_revision, unit.name);
		assert.equal(owner.authority, 'github: lushly-dev/afd', unit.name);
		const declared = owner.distributions.find((distribution) => distribution.name === unit.name);
		assert.equal(declared.manifest, manifestPath);
		const manifest = json(manifestPath);
		assert.equal(manifest.name, unit.name);
		assert(semver.gte(manifest.version, declared.initialVersion), `${unit.name} version reset`);
		// One fixed group: every distribution releases at the same version.
		assert.equal(
			manifest.version,
			json(`${provenance.units[0].path}/package.json`).version,
			unit.name
		);
		assert.notEqual(manifest.private, true, unit.name);
		const classified = architecture.units.find((item) => item.manifest === manifestPath);
		assert.deepEqual([classified?.family, classified?.layer], ['violet', unit.layer], unit.name);
	}
});

test('the native core has no AFD edge and the integration uses the workspace AFD core', () => {
	const core = json('foundations/violet/packages/core/package.json');
	// The one exception is Violet's own runtime, for the custom property naming rule its CSS
	// exporter shares (#1786): an import-free module of the same family, with no AFD edge of its own.
	const allowed = { dependencies: ['@lushly-dev/violet-runtime'] };
	for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'])
		assert.deepEqual(
			Object.keys(core[field] ?? {}).filter((name) => name.startsWith('@lushly-dev/')),
			allowed[field] ?? [],
			`core ${field} names another Lushly package`
		);
	const runtime = json('foundations/violet/packages/runtime/package.json');
	assert.deepEqual(
		Object.keys(runtime.dependencies ?? {}),
		[],
		'the runtime core depends on has no dependencies'
	);
	assert.equal(core.exports['./commands'], undefined);
	const afd = json('integrations/violet-afd/package.json');
	assert.equal(afd.dependencies['@lushly-dev/afd-core'], 'workspace:^2.2.0');
	// A workspace range packs as the core version it was built against, and Changesets never counts
	// a release as leaving it; a plain range a fixed-group minor left would major-bump the
	// integration, and with it the whole group.
	const range = afd.peerDependencies['@lushly-dev/violet-core'];
	assert.match(range, /^workspace:[~^]$/);
	const peer = `${range.slice('workspace:'.length)}${core.version}`;
	assert(semver.satisfies(core.version, peer));
	const pendingMinor = readdirSync(join(root, '.changeset'))
		.filter((name) => name.endsWith('.md') && name !== 'README.md')
		.some((name) =>
			/^['"]@lushly-dev\/violet-core['"]: (?:minor|major)$/m.test(
				readFileSync(join(root, '.changeset', name), 'utf8')
			)
		);
	if (pendingMinor)
		assert(
			semver.satisfies(semver.inc(core.version, 'minor'), peer),
			`a pending violet-core minor needs the integration peer (${peer}) to accept it`
		);
	for (const endpoint of ['endpoints/violet-cli', 'endpoints/violet-server'])
		assert.equal(
			json(`${endpoint}/package.json`).dependencies['@lushly-dev/violet-afd'],
			'workspace:*'
		);
});

test('upstream licenses are imported verbatim', () => {
	const core = upstream.files.find((file) => file.path === 'packages/core/LICENSE');
	for (const path of [
		'foundations/violet/packages/core/LICENSE',
		'foundations/violet/packages/runtime/LICENSE',
		'integrations/violet-afd/LICENSE',
		'endpoints/violet-cli/LICENSE',
		'endpoints/violet-server/LICENSE',
	])
		assert.equal(sha(readFileSync(join(root, path))), core.sha256, `${path} must stay verbatim`);
});

test('every imported Violet file is present, recorded and unchanged since review', () => {
	const recorded = new Map(adaptations.files.map((file) => [file.path, file]));
	// Untracked-but-unignored files count; an ignored source file would fail as missing.
	const present = git([
		'ls-files',
		'--cached',
		'--others',
		'--exclude-standard',
		'--',
		'foundations/violet',
		'integrations/violet-afd',
		'endpoints/violet-cli',
		'endpoints/violet-server',
		'tests/consumers/violet',
		'docs/features/complete/platform-monorepo/violet-transition.md',
	])
		.toString()
		.split('\n')
		.filter((path) => path && !path.startsWith(`${directory}/`));
	assert.deepEqual(
		present.filter((path) => !recorded.has(path)),
		[],
		'record new Violet files in adaptations.json'
	);
	const known = new Set(Object.keys(adaptations.classifications));
	for (const file of adaptations.files) {
		assert(existsSync(join(root, file.path)), `missing or ignored: ${file.path}`);
		assert(present.includes(file.path), `not visible to Git (check .gitignore): ${file.path}`);
		assert(known.has(file.classification), `${file.path}: ${file.classification}`);
		const bytes = beforeRelease(file.path, readFileSync(join(root, file.path)));
		assert(matchesRecord(file, bytes), `${file.path} changed; record the adaptation`);
		assert(
			!hasStaleShape(file, bytes),
			`${file.path}: its record's manifest_shape_sha256 is stale; record the manifest's shape again`
		);
		if (unchanged.has(file.classification))
			assert.equal(file.current_import_sha256, file.upstream_sha256, file.path);
		else assert(file.reason, `${file.path} needs a reason`);
		if (file.classification !== 'afd-authored') assert(file.upstream_path, file.path);
	}
	const accounted = new Set(adaptations.files.map((file) => file.upstream_path).filter(Boolean));
	assert.deepEqual(
		upstream.files.map((file) => file.path).filter((path) => !accounted.has(path)),
		[],
		'every selected upstream file maps to an import'
	);
});

test('upstream Git object ids match the bytes of every file imported unchanged', () => {
	// The Violet revision is not in this repository; unchanged bytes still prove the recorded ids.
	const byPath = new Map(upstream.files.map((file) => [file.path, file]));
	let checked = 0;
	for (const file of adaptations.files) {
		if (!unchanged.has(file.classification)) continue;
		assert.equal(
			blob(beforeRelease(file.path, readFileSync(join(root, file.path)))),
			byPath.get(file.upstream_path).git_blob,
			file.path
		);
		checked++;
	}
	assert(checked > 50, `only ${checked} unchanged upstream files`);
});
